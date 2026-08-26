// SPDX-License-Identifier: MPL-2.0

/**
 * # Performance IPC
 *
 * Read-write IPC handler for the Diagnostics tab. Provides:
 *
 *   - Read: renderer-poll handlers (`performance:get`, `performance:get-timeouts`,
 *     `performance:get-memory`) that return recent traces and aggregate stats.
 *   - Push: main → renderer subscription (`performance:new-trace`) that fires
 *     when a new trace is finalized, so the UI can incrementally update instead
 *     of waiting for the next poll tick.
 *
 * The push path is wired by subscribing to `performanceLogger.subscribeTrace()`
 * and fanning out to the main window + studio window (same pattern as
 * `concurrency-metrics-ipc`).
 *
 * No write handlers exist — only `ThemeApplyTrace` producers (the apply/restore
 * flows) call `PerformanceLogger.log()` directly.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';
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

export function registerPerformanceIpc(ctx: MainContext): void {
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
    // This channel floors at 0 (not 1): count <= 0 or non-numeric means "all".
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return all;
    return all.slice(-Math.min(count, all.length));
  });

  // Push channel: subscribe to new traces and fan-out to main + studio windows.
  // The unsubscribe function is tracked so it can be called on app shutdown
  // (though in practice the logger singleton lives for the process lifetime).
  performanceLogger.subscribeTrace((trace) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(IpcChannel.PERFORMANCE_NEW_TRACE, trace);
    }
    if (ctx.studioWindow && !ctx.studioWindow.isDestroyed()) {
      ctx.studioWindow.webContents.send(IpcChannel.PERFORMANCE_NEW_TRACE, trace);
    }
  });
}
