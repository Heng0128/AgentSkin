// SPDX-License-Identifier: MPL-2.0

/**
 * # useBootProgress
 *
 * Parses `[STRUCTURED]|{json}` log lines emitted by AgentEngineService and
 * exposes a per-agent progress map so the UI can show real-time boot/apply
 * phases (detecting → spawning → cdp-ready → injecting → scheme-sync → done)
 * instead of a single opaque spinner.
 *
 * The structured events are carried over the existing `runtime:log` IPC
 * channel — this hook subscribes via `onRuntimeLog` and filters for the
 * `[STRUCTURED]|` prefix, so no new IPC channel is needed.
 *
 * Lifecycle:
 *   - boot_start / boot_agent_start  → mark agent as "in progress"
 *   - cdp_* / inject_* / scheme_sync → update phase + progress
 *   - boot_agent_done / boot_agent_failed / theme_apply / theme_restore → mark agent done
 *   - boot_done / theme_apply / theme_restore → clear all stale entries
 *
 * scheme_sync is a non-blocking background task that fires AFTER the apply
 * response has already returned. Its events only UPDATE existing in-flight
 * entries — they never create new ones or regress a terminal (done/failed)
 * state. This prevents environments from getting stuck on "同步外观模式…"
 * when late stability-check events (2s/5s/10s) arrive after theme_apply.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { AgentId } from '@shared/types';

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
      // the UI transitions out of the "syncing" phase. Without this, the
      // phase stayed at 'scheme_sync' forever because boot_done (the only
      // cleanup trigger) is no longer emitted.
      return event.phase === 'done' ? 'done' : 'scheme_sync';
    case 'theme_apply':
    case 'theme_restore':
    case 'boot_agent_done':
      return 'done';
    default:
      return null;
  }
}

export function useBootProgress(
  onLog: (listener: (line: string) => void) => () => void,
  onEvent?: (event: StructuredEvent) => void,
) {
  const [progress, setProgress] = useState<ProgressMap>(new Map());
  // R6-17: 存储 setTimeout timer ID 以便 cleanup。原实现 setTimeout 无 cleanup，
  // 组件卸载后可能触发 setState 警告。
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // R6-17: 组件卸载时清理 setTimeout，防止 setState 警告。
  useEffect(() => {
    return () => {
      if (cleanupTimerRef.current !== null) {
        clearTimeout(cleanupTimerRef.current);
        cleanupTimerRef.current = null;
      }
    };
  }, []);

  const listener = useCallback(
    (line: string) => {
      const event = parseStructured(line);
      if (!event) return;

      // Fire the event callback before phase filtering so boot-lifecycle
      // toasts (boot_start / boot_agent_done / boot_agent_failed) are emitted
      // even for events that don't map to a progress phase.
      onEvent?.(event);

      const phase = phaseFor(event);
      if (!phase) return;

      const appId = event.agentId as AgentId;
      const updatedAt = Date.now();

      setProgress((prev) => {
        const existing = prev.get(appId);

        // scheme_sync is a non-blocking background task that fires AFTER the
        // apply response has already returned. Its events must NEVER create
        // new progress entries or regress an agent that already reached a
        // terminal state (done/failed). Without this guard, late stability-
        // check events (2s/5s/10s after apply) would overwrite the 'done'
        // phase and show "同步外观模式…" forever — exactly the bug where
        // environments were stuck on this label.
        if (event.type === 'scheme_sync') {
          if (!existing) return prev; // stale echo, no in-flight entry
          if (existing.phase === 'done' || existing.phase === 'failed') return prev;
        }

        const next = new Map(prev);
        next.set(appId, {
          phase,
          progress: event.progress ?? prev.get(appId)?.progress ?? 0,
          reason: event.reason,
          subPhase: event.phase,
          updatedAt,
        });
        return next;
      });

      // Clean up finished agents after a short visibility window. Previously
      // only boot_done triggered cleanup, but boot_done is no longer emitted
      // (boot-time auto-restore was removed). theme_apply / theme_restore now
      // serve as the completion signal for user-initiated operations.
      if (
        event.type === 'boot_done' ||
        event.type === 'theme_apply' ||
        event.type === 'theme_restore'
      ) {
        // R6-17: 存储 timer ID 以便在组件卸载时清理。
        if (cleanupTimerRef.current !== null) {
          clearTimeout(cleanupTimerRef.current);
        }
        cleanupTimerRef.current = setTimeout(() => {
          cleanupTimerRef.current = null;
          setProgress((prev) => {
            const next = new Map(prev);
            for (const [id, p] of next) {
              if (p.phase === 'done' || p.phase === 'failed') next.delete(id);
            }
            return next;
          });
        }, 1500);
      }
    },
    [onEvent],
  );

  useEffect(() => onLog(listener), [onLog, listener]);

  return progress;
}
