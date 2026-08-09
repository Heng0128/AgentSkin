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
  type PerformanceHistoryResponse,
  performanceLogger,
} from '../services/performance';

/** Maximum allowed count to prevent a runaway renderer from pulling the
 *  entire history in one call (history is bounded to 50 anyway). */
const MAX_COUNT = 50;

/** Cap for timeout-event queries — a separate, tighter bound than traces. */
const MAX_TIMEOUT_COUNT = 50;

export function registerPerformanceIpc(): void {
  ipcMain.handle(
    IpcChannel.PERFORMANCE_GET,
    (_event, count: unknown): PerformanceHistoryResponse => {
      const n = Math.min(
        MAX_COUNT,
        Math.max(1, typeof count === 'number' && Number.isFinite(count) ? count : 10),
      );
      return performanceLogger.getHistory(n);
    },
  );

  ipcMain.handle(
    IpcChannel.PERFORMANCE_GET_TIMEOUTS,
    (_event, count: unknown): IpcTimeoutEvent[] => {
      const n = Math.min(
        MAX_TIMEOUT_COUNT,
        Math.max(1, typeof count === 'number' && Number.isFinite(count) ? count : 10),
      );
      return performanceLogger.getRecentTimeouts(n);
    },
  );

  ipcMain.handle(IpcChannel.PERFORMANCE_CLEAR_TIMEOUTS, (): { ok: true } => {
    performanceLogger.clearTimeouts();
    return { ok: true };
  });
}
