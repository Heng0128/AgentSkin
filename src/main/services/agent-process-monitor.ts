// SPDX-License-Identifier: MPL-2.0

/**
 * # Agent Process Monitor
 *
 * Periodically polls each agent's running PIDs (via
 * `adapter.findRunningPids()`) and emits lifecycle events **only on
 * transitions** — a steady "running" or steady "exited" is silent.
 *
 * ## Why this exists
 *
 * Before this module, the agent engine could tell YOU "the app needs a
 * restart" at apply-time, but had no way to learn asynchronously that
 * the user just closed (or crashed) the agent. Consequences:
 *
 *   - The UI's "LIVE" badge stayed green even when the agent had exited.
 *   - Persisted `port` state in `AgentEngineService` could go stale
 *     (CDP port belongs to a dead process).
 *
 * With the monitor, the engine layer subscribes to `agent_exited` and
 * `agent_started` transitions and reacts (clear port, re-inject on
 * restart, update UI).
 *
 * ## Lifecycle
 *
 *   ```
 *   [unknown] --first poll finds PIDs--> [running]
 *   [running] --all PIDs gone----------> [exited]   → onAgentExited
 *   [exited]  --PIDs reappear----------> [running]  → onAgentStarted
 *   [running] --PIDs change (restart)--> [running]  → onAgentRestarted
 *   ```
 *
 * ## Design choices
 *
 *   - **Polling, not WMI events**: `findRunningPids` is the cheapest
 *     cross-platform check the adapter contract already exposes. No
 *     per-process handle, no ETW, no /proc polling. 5s interval is a
 *     good balance between responsiveness and CPU.
 *   - **Per-agent tickers**: one `setInterval` per watched agent, not a
 *     global one. Isolates timer drift and lets us add an agent without
 *     restarting others.
 *   - **Epoch guard**: each `start(appId, epoch)` call stamps the
 *     watcher. Stale timers (from a previous boot/apply) self-exit on
 *     the next tick.
 *   - **PID-diff restart detection**: when known PIDs vanish and new
 *     PIDs appear within the same tick, we emit `agent_restarted`
 *     instead of separate exit+start — lets UI skip the flicker.
 *
 * Inspired by: WorkBuddy Skin Studio's process lifecycle monitoring.
 */

import type { ApplicationAdapter } from '../../adapters/base';
import type { AgentId } from '../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single observed agent's current process state. */
interface AgentProcessState {
  appId: AgentId;
  runningPids: number[];
  /** epoch bumps each time start() is called — stale timers self-exit */
  epoch: number;
}

/** Events emitted on state transitions. */
export type AgentProcessEvent =
  | {
      type: 'agent_started';
      agentId: AgentId;
      pids: number[];
      timestamp: string;
    }
  | {
      type: 'agent_exited';
      agentId: AgentId;
      /** last known PIDs, useful for crash forensics */
      lastPids: number[];
      timestamp: string;
    }
  | {
      type: 'agent_restarted';
      agentId: AgentId;
      /** PIDs before the restart */
      prevPids: number[];
      /** PIDs after the restart */
      nextPids: number[];
      timestamp: string;
    }
  | {
      type: 'agent_monitor_error';
      agentId: AgentId;
      error: string;
      timestamp: string;
    };

export interface AgentProcessMonitorDeps {
  /** Adapter factory — returns the registered adapter for an agent. */
  adapter: (appId: AgentId) => ApplicationAdapter;
  /** Returns the platform string passed to findRunningPids (e.g. 'win32'). */
  platform: string;
  /** Optional executable hint passed to findRunningPids (adapter-scoped). */
  executable?: string;
  /** Lifecycle event sink. */
  onEvent: (event: AgentProcessEvent) => void;
  /** Best-effort log sink (defaults to noop). */
  log?: (line: string) => void;
  /** Polling interval in ms (default 5000). */
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------

export class AgentProcessMonitor {
  /** Per-app state map — only registered agents are polled. */
  private readonly states = new Map<AgentId, AgentProcessState>();
  /** Per-app epoch — guards stale timers. */
  private readonly epochs = new Map<AgentId, number>();
  /** Per-app timer handle — cleared on stop. */
  private readonly timers = new Map<AgentId, ReturnType<typeof setInterval>>();
  private readonly deps: Required<Pick<AgentProcessMonitorDeps, 'log' | 'pollIntervalMs'>> &
    AgentProcessMonitorDeps;

  constructor(deps: AgentProcessMonitorDeps) {
    this.deps = {
      log: deps.log ?? (() => {}),
      pollIntervalMs: deps.pollIntervalMs ?? 5000,
      ...deps,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Watch an agent. No-op if already watching (idempotent). */
  start(appId: AgentId): void {
    const epoch = (this.epochs.get(appId) ?? 0) + 1;
    this.epochs.set(appId, epoch);

    if (this.states.has(appId)) {
      // already watching — just bump the epoch so stale timers die
      this.states.set(appId, { ...this.states.get(appId)!, epoch });
      return;
    }

    this.states.set(appId, { appId, runningPids: [], epoch });
    this.deps.log(`[proc-mon] ${appId}: watching (epoch=${epoch})`);

    // First tick immediately so we don't wait a full interval for the
    // initial state — but don't emit (state transitions only).
    void this.tick(appId, epoch);

    const timer = setInterval(() => {
      void this.tick(appId, epoch);
    }, this.deps.pollIntervalMs);
    this.timers.set(appId, timer);
  }

  /** Stop watching an agent. Idempotent. */
  stop(appId: AgentId): void {
    const timer = this.timers.get(appId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(appId);
    }
    this.states.delete(appId);
    this.epochs.delete(appId);
    this.deps.log(`[proc-mon] ${appId}: stopped`);
  }

  /** Stop all watchers. */
  stopAll(): void {
    for (const appId of [...this.timers.keys()]) {
      this.stop(appId);
    }
  }

  /** Current snapshot of a watched agent (used by tests + UI introspection). */
  snapshot(appId: AgentId): { runningPids: number[]; epoch: number } | null {
    const s = this.states.get(appId);
    if (!s) return null;
    return { runningPids: [...s.runningPids], epoch: s.epoch };
  }

  /** IDs currently being watched. */
  watchedApps(): AgentId[] {
    return [...this.states.keys()];
  }

  // -----------------------------------------------------------------------
  // Tick
  // -----------------------------------------------------------------------

  private async tick(appId: AgentId, expectedEpoch: number): Promise<void> {
    // Stale timer guard — the app was restarted with a new epoch.
    if (this.epochs.get(appId) !== expectedEpoch) return;

    const state = this.states.get(appId);
    if (!state) return;

    let pids: number[] = [];
    try {
      const adapter = this.deps.adapter(appId);
      pids = await adapter.findRunningPids(this.deps.platform, this.deps.executable);
    } catch (err) {
      this.deps.log(
        `[proc-mon] ${appId}: findRunningPids failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      this.emit({
        type: 'agent_monitor_error',
        agentId: appId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const prev = state.runningPids;
    const prevAlive = prev.length > 0;
    const nextAlive = pids.length > 0;

    // State machine
    if (!prevAlive && nextAlive) {
      // exited (or unknown) → running
      this.emit({
        type: 'agent_started',
        agentId: appId,
        pids,
        timestamp: new Date().toISOString(),
      });
    } else if (prevAlive && !nextAlive) {
      // running → exited
      this.emit({
        type: 'agent_exited',
        agentId: appId,
        lastPids: prev,
        timestamp: new Date().toISOString(),
      });
    } else if (prevAlive && nextAlive && !this.samePids(prev, pids)) {
      // running → running but PIDs changed = restart
      this.emit({
        type: 'agent_restarted',
        agentId: appId,
        prevPids: prev,
        nextPids: pids,
        timestamp: new Date().toISOString(),
      });
    }
    // else: steady state, no emit

    state.runningPids = pids;
  }

  private samePids(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    const sa = new Set(a);
    return b.every((p) => sa.has(p));
  }

  private emit(event: AgentProcessEvent): void {
    try {
      this.deps.onEvent(event);
    } catch (err) {
      // UI / handler callback failure must not break the ticker.
      // Log the error so it can be diagnosed in production.
      this.deps.log(
        `[proc-mon] onEvent handler threw for ${event.agentId} (${event.type}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
