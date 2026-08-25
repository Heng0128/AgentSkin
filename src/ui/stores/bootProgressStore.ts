// SPDX-License-Identifier: MPL-2.0

/**
 * # bootProgressStore
 *
 * Per-agent boot/apply progress, parsed from the `runtime:log` IPC stream.
 *
 * Extracted from `useBootProgress` (Phase A2). Owns the progress map and the
 * pure parsing logic (parseStructured / phaseFor). The actual IPC subscription
 * (`onRuntimeLog`) is applied by the caller via `applyLine(line)` — the store
 * is a pure reducer so it is trivially testable in isolation.
 */

import type { AgentId } from '@shared/types';
import { create } from 'zustand';

/** Current phase of an agent's boot/apply lifecycle. */
export type BootPhase =
  | 'boot_start'
  | 'cdp_resolving'
  | 'cdp_killing'
  | 'cdp_spawning'
  | 'cdp_ready'
  | 'cdp_timeout'
  | 'cdp_spawn_failed'
  | 'inject_start'
  | 'inject_done'
  | 'inject_failed'
  | 'scheme_sync'
  | 'done'
  | 'failed';

export interface AgentProgress {
  phase: BootPhase;
  /** 0..100 progress within the current agent's restore/apply. */
  progress: number;
  /** Free-form reason for failure/timeout phases. */
  reason?: string;
  /** Sub-phase discriminator (e.g. scheme_sync: start|stable|drifted|done). */
  subPhase?: string;
  /** Epoch ms of the last update. */
  updatedAt: number;
}

export type ProgressMap = Map<AgentId, AgentProgress>;

export interface StructuredEvent {
  type: string;
  agentId: string;
  themeId?: string;
  timestamp: string;
  phase?: string;
  progress?: number;
  reason?: string;
  agentCount?: number;
}

const STRUCTURED_PREFIX = '[STRUCTURED]|';

function parseStructured(line: string): StructuredEvent | null {
  // The renderer wraps each log line as `[time] [Renderer] [INFO] <raw>`,
  // so the structured prefix sits at the end of the message.
  const idx = line.indexOf(STRUCTURED_PREFIX);
  if (idx < 0) return null;
  try {
    return JSON.parse(line.slice(idx + STRUCTURED_PREFIX.length)) as StructuredEvent;
  } catch {
    return null;
  }
}

/** Map a raw event type to a UI-facing BootPhase. */
function phaseFor(event: StructuredEvent): BootPhase | null {
  switch (event.type) {
    case 'boot_agent_start':
      return 'boot_start';
    case 'cdp_resolving':
      return 'cdp_resolving';
    case 'cdp_killing':
      return 'cdp_killing';
    case 'cdp_spawning':
      return 'cdp_spawning';
    case 'cdp_ready':
      return 'cdp_ready';
    case 'cdp_timeout':
      return 'cdp_timeout';
    case 'cdp_spawn_failed':
      return 'cdp_spawn_failed';
    case 'inject_start':
      return 'inject_start';
    case 'inject_done':
      return 'inject_done';
    case 'inject_failed':
      return 'inject_failed';
    case 'apply_failed':
    case 'restore_failed':
    case 'boot_agent_failed':
      return 'failed';
    case 'scheme_sync':
      // scheme_sync is a NON-BLOCKING background task that runs AFTER the
      // apply response has already returned. Its subPhase 'done' means the
      // stability window confirmed the scheme stuck — map that to 'done' so
      // the UI transitions out of the "syncing" phase.
      return event.phase === 'done' ? 'done' : 'scheme_sync';
    case 'theme_apply':
    case 'theme_restore':
    case 'boot_agent_done':
      return 'done';
    default:
      // Log unknown event types to aid debugging when main process adds new events.
      console.warn('[bootProgressStore] unknown event type:', (event as { type?: string }).type);
      return null;
  }
}

/** How long finished agents stay visible before cleanup. */
const CLEANUP_DELAY = 1500;

interface BootProgressState {
  progress: ProgressMap;

  /** Feed one runtime-log line into the reducer. Returns the parsed event
   *  (or null) so callers can fire lifecycle callbacks (e.g. boot toasts). */
  applyLine: (line: string) => StructuredEvent | null;
  /** Clear finished agents after a short visibility window. */
  scheduleCleanup: () => void;
}

export const useBootProgressStore = create<BootProgressState>((set) => {
  let cleanupTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    progress: new Map(),

    applyLine: (line) => {
      const event = parseStructured(line);
      if (!event) return null;

      const phase = phaseFor(event);
      if (!phase) return event;

      const appId = event.agentId as AgentId;
      const updatedAt = Date.now();

      set((s) => {
        const existing = s.progress.get(appId);

        // scheme_sync must never create new entries or regress a terminal
        // state (done/failed) — see comment in phaseFor.
        if (event.type === 'scheme_sync') {
          if (!existing) return s;
          if (existing.phase === 'done' || existing.phase === 'failed') return s;
        }

        // Skip update if nothing actually changed — prevents unnecessary
        // re-renders in consumers subscribed to `progress`. The Map reference
        // stays identical so useSyncExternalStore / zustand shallow compare
        // short-circuits the subscription notification entirely.
        if (
          existing &&
          existing.phase === phase &&
          existing.progress === (event.progress ?? existing.progress) &&
          existing.reason === event.reason &&
          existing.subPhase === event.phase
        ) {
          return s;
        }

        const next = new Map(s.progress);
        next.set(appId, {
          phase,
          progress: event.progress ?? existing?.progress ?? 0,
          reason: event.reason,
          subPhase: event.phase,
          updatedAt,
        });
        return { progress: next };
      });

      return event;
    },

    scheduleCleanup: () => {
      if (cleanupTimer !== null) {
        clearTimeout(cleanupTimer);
      }
      cleanupTimer = setTimeout(() => {
        cleanupTimer = null;
        set((s) => {
          const next = new Map(s.progress);
          for (const [id, p] of next) {
            if (p.phase === 'done' || p.phase === 'failed') next.delete(id);
          }
          return { progress: next };
        });
      }, CLEANUP_DELAY);
    },
  };
});
