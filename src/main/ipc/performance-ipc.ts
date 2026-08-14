// SPDX-License-Identifier: MPL-2.0

/**
 * # Performance IPC
 *
 * Read-only IPC handler for the Diagnostics tab. Returns recently completed
 * theme-apply traces and aggregate statistics from the {@link PerformanceLogger}
 * singleton. The UI polls this on a fixed cadence (5s) for a low-fidelity
 * update; future iterations may push live updates via
 * `webContents.send`.
 *
 * No write handlers exist — only `ThemeApplyTrace` producers (the apply/restore
 * flows) call `PerformanceLogger.log()` directly.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import {
  type IpcTimeoutEvent,
  type MemorySample,
  type PerformanceHistoryResponse,
  performanceLogger,
} from '../services/performance';

/** Maximum allowed count to prevent a runaway renderer from pulling the
 *  entire history in one call (history is bounded to 50 anyway). */
const MAX_COUNT = 50;

/** Clamp an arbitrary renderer-provided count to [1, max].
 *  Non-numbers, NaN, Infinity, and out-of-range values all resolve to
 *  `fallback` (the default argument the caller would have used). */
function clampCount(value: unknown, max: number, fallback = 10): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(1, value));
}

export function registerPerformanceIpc(): void {
  ipcMain.handle(
    IpcChannel.PERFORMANCE_GET,
    (_event, count: unknown): PerformanceHistoryResponse => {
      return performanceLogger.getHistory(clampCount(count, MAX_COUNT));
    },
  );

  ipcMain.handle(
    IpcChannel.PERFORMANCE_GET_TIMEOUTS,
    (_event, count: unknown): IpcTimeoutEvent[] => {
      return performanceLogger.getRecentTimeouts(clampCount(count, MAX_COUNT));
    },
  );

  ipcMain.handle(IpcChannel.PERFORMANCE_CLEAR_TIMEOUTS, (): { ok: true } => {
    performanceLogger.clearTimeouts();
    return { ok: true };
  });

  ipcMain.handle(IpcChannel.PERFORMANCE_GET_MEMORY, (_event, count: unknown): MemorySample[] => {
    const all = performanceLogger.getMemorySamples();
    const n = clampCount(count, all.length);
    // clampCount floors at 1; 0 / negatives mean "return all" for this channel.
    if (n >= all.length || n <= 0) return all;
    return all.slice(-n);
  });
}
