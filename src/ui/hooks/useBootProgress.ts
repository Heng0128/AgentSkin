// SPDX-License-Identifier: MPL-2.0

/**
 * # useBootProgress
 *
 * Thin subscription hook over `bootProgressStore`. Subscribes to the
 * `runtime:log` IPC stream and feeds each line into the store's reducer
 * (`applyLine`), firing the optional lifecycle callback (boot toasts) and
 * scheduling cleanup for finished agents.
 *
 * The parsing/progress logic now lives in `src/ui/stores/bootProgressStore.ts`
 * (Phase A2 refactor); this hook only wires the IPC subscription to it.
 */

import { useEffect } from 'react';
import {
  type AgentProgress,
  type BootPhase,
  type ProgressMap,
  type StructuredEvent,
  useBootProgressStore,
} from '@/stores/bootProgressStore';

// Re-export types for backward compatibility with existing consumers
// (AgentStatusBar / EnvironmentCard / EnvironmentGrid / useAppController).
export type { AgentProgress, BootPhase, ProgressMap, StructuredEvent };

export function useBootProgress(
  onLog: (listener: (line: string) => void) => () => void,
  onEvent?: (event: StructuredEvent) => void,
) {
  const progress = useBootProgressStore((s) => s.progress);
  const applyLine = useBootProgressStore((s) => s.applyLine);
  const scheduleCleanup = useBootProgressStore((s) => s.scheduleCleanup);

  useEffect(() => {
    const listener = (line: string) => {
      const event = applyLine(line);
      if (!event) return;
      onEvent?.(event);
      if (
        event.type === 'boot_done' ||
        event.type === 'theme_apply' ||
        event.type === 'theme_restore'
      ) {
        scheduleCleanup();
      }
    };
    return onLog(listener);
  }, [onLog, applyLine, scheduleCleanup, onEvent]);

  return progress;
}
