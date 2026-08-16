// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Session Pool
 *
 * Reuses a target's WebSocket session across the fan-out sub-tasks within a
 * single apply/restore operation. WorkBuddy exposes 13+ CDP targets; the
 * secondary-inject pass and the hardening pass both connect to the same
 * webview/iframe targets, so without a pool each target is handshaked twice
 * per apply (~200ms each). The pool collapses duplicate connects into one.
 *
 * ## Lifecycle & safety
 *
 * - **Per-agent, per-target** keyed by `targetId` (falling back to the WS URL).
 * - **Epoch-bound**: the owner (`AgentEngineService`) calls {@link invalidateEpoch}
 *   on every epoch bump, so pooled sessions are closed at each apply/restore
 *   boundary and **never leak across operations** (RFC §4.1). This prevents
 *   cross-epoch command cross-talk and stale-session reuse against a target
 *   that navigated between operations.
 * - **Caller contract**: a pooled session is owned by the pool — callers must
 *   NOT call `session.close()`; the pool closes it on epoch invalidation /
 *   dispose. The {@link acquireSession} helper returns a `pooled` flag so the
 *   fan-out `finally` blocks can skip closing pooled sessions.
 * - **Concurrency**: the CDP client's `send`/`evaluate` are concurrency-safe
 *   (unique command ids + a pending map), so pooled sessions may be shared by
 *   overlapping sub-tasks without protocol corruption.
 *
 * Remote-disconnect auto-removal is handled two ways: the CDP client rejects
 * all pending commands on socket close, and the pool's per-session heartbeat
 * (RFC §4.7) pings every 5s, discarding the session after 2 consecutive
 * failures so a silently-dead socket is rebuilt on the next acquire.
 */

import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';

/** Heartbeat cadence (RFC §4.7) — a lightweight ping every 5s. */
const HEARTBEAT_INTERVAL_MS = 5000;
/** Consecutive heartbeat failures before a session is marked dirty + discarded. */
const HEARTBEAT_FAIL_THRESHOLD = 2;

interface PooledEntry {
  session: CdpSession;
  lastUsedAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
}

/** A session plus whether the caller owns its lifecycle (`pooled` = do not close). */
export interface SessionHandle {
  session: CdpSession | null;
  pooled: boolean;
}

/**
 * Acquire a session (possibly pooled) for `targetKey`. When `pool` is provided
 * the session is cached and must not be closed by the caller; otherwise a
 * one-shot session is returned and the caller closes it as before.
 */
export async function acquireSession(
  pool: CdpSessionPool | undefined,
  appId: AgentId,
  targetKey: string,
  open: () => Promise<CdpSession | null>,
): Promise<SessionHandle> {
  if (pool) {
    const session = await pool.acquire(appId, targetKey, open);
    return { session, pooled: true };
  }
  const session = await open();
  return { session, pooled: false };
}

/** Per-target key for a CDP target (id preferred, WS URL as fallback). */
export function targetKeyFor(
  id: string | null | undefined,
  webSocketDebuggerUrl: string | null | undefined,
): string {
  return id || webSocketDebuggerUrl || 'unknown-target';
}

/**
 * Per-agent, per-target CDP session pool. See module doc for lifecycle rules.
 */
export class CdpSessionPool {
  private readonly pools = new Map<AgentId, Map<string, PooledEntry>>();

  /** Acquire a pooled session for `targetKey`, creating it via `open` on first use. */
  async acquire(
    appId: AgentId,
    targetKey: string,
    open: () => Promise<CdpSession | null>,
  ): Promise<CdpSession | null> {
    let byTarget = this.pools.get(appId);
    if (!byTarget) {
      byTarget = new Map();
      this.pools.set(appId, byTarget);
    }
    const existing = byTarget.get(targetKey);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.session;
    }
    const session = await open();
    if (!session) return null;
    const entry: PooledEntry = {
      session,
      lastUsedAt: Date.now(),
      heartbeatTimer: null,
      consecutiveFailures: 0,
    };
    entry.heartbeatTimer = this.startHeartbeat(appId, targetKey, entry);
    byTarget.set(targetKey, entry);
    return session;
  }

  /** Drop and close a specific pooled session (e.g. after a hard failure). */
  invalidateTarget(appId: AgentId, targetKey: string): void {
    const byTarget = this.pools.get(appId);
    const entry = byTarget?.get(targetKey);
    if (!entry) return;
    this.discard(appId, targetKey, entry);
  }

  /**
   * Close and clear every pooled session for an agent. Called on epoch bump so
   * sessions never survive across apply/restore operations.
   */
  invalidateEpoch(appId: AgentId): void {
    const byTarget = this.pools.get(appId);
    if (!byTarget) return;
    for (const entry of byTarget.values()) {
      this.stopHeartbeat(entry);
      try {
        entry.session.close();
      } catch {
        /* already closed */
      }
    }
    byTarget.clear();
    this.pools.delete(appId);
  }

  /** Close and clear every pooled session (service dispose). */
  dispose(): void {
    for (const appId of [...this.pools.keys()]) {
      this.invalidateEpoch(appId);
    }
  }

  /** Number of pooled sessions for an agent (diagnostics). */
  poolSize(appId: AgentId): number {
    return this.pools.get(appId)?.size ?? 0;
  }

  // -------------------------------------------------------------------------
  // Heartbeat (RFC §4.7)
  // -------------------------------------------------------------------------

  /** Start a 5s heartbeat that pings the session and discards it on repeated failure. */
  private startHeartbeat(
    appId: AgentId,
    targetKey: string,
    entry: PooledEntry,
  ): ReturnType<typeof setInterval> | null {
    return setInterval(() => {
      void this.ping(appId, targetKey, entry);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async ping(appId: AgentId, targetKey: string, entry: PooledEntry): Promise<void> {
    try {
      await entry.session.send('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
        awaitPromise: false,
      });
      entry.consecutiveFailures = 0;
    } catch {
      entry.consecutiveFailures++;
      if (entry.consecutiveFailures >= HEARTBEAT_FAIL_THRESHOLD) {
        mainWarn(
          'SessionPool',
          `agent=${appId} target=${targetKey} heartbeat failed ${entry.consecutiveFailures}x — discarding session`,
        );
        this.discard(appId, targetKey, entry);
      }
    }
  }

  /** Stop + close + remove a pooled session (used by invalidateTarget and heartbeat discard). */
  private discard(appId: AgentId, targetKey: string, entry: PooledEntry): void {
    const byTarget = this.pools.get(appId);
    if (byTarget?.get(targetKey) === entry) {
      byTarget.delete(targetKey);
    }
    this.stopHeartbeat(entry);
    try {
      entry.session.close();
    } catch {
      /* already closed */
    }
  }

  private stopHeartbeat(entry: PooledEntry): void {
    if (entry.heartbeatTimer !== null) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }
  }
}
