// SPDX-License-Identifier: MPL-2.0

/**
 * # Concurrency Metrics IPC
 *
 * Bridges the AgentEngineService's periodic concurrency-metrics broadcast
 * to the renderer via Electron IPC.
 *
 * ## Channel topology
 *
 * - `diagnostics:concurrency-metrics` (SEND_ONLY, main → renderer):
 *   The AgentEngineService pushes a `ConcurrencyMetrics` payload every 5s
 *   via `webContents.send`. The renderer subscribes through the preload
 *   bridge (`onDiagnosticsConcurrencyMetrics`) and merges it into the
 *   diagnosticsStore via `updateConcurrencyMetrics`. This channel must NOT
 *   be registered with `ipcMain.handle` — doing so would cause renderer
 *   `invoke()` calls to hang forever.
 *
 * ## Renderer-side primitives
 *
 * Two concurrency primitive sizes live on the renderer side
 * (`companionBusyByAgent` in wallpaperStore, `switchEpochByAgent` in
 * environmentStore). The main process cannot read them directly, so the
 * boot sequence wires a manual forwarding path (setInterval in the renderer)
 * that calls `core.updateConcurrencyMetricsFromRenderer(...)`. This keeps the
 * renderer-side complexity out of the main process while still surfacing the
 * values in the unified metrics payload.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';

/**
 * Register the concurrency-metrics IPC bridge.
 *
 * 1. Starts the 5-second periodic broadcast timer on `ctx.core`. The timer
 *    delivers each payload to the main window's webContents if it exists and
 *    has not been destroyed.
 *
 * 2. Registers an `ipcMain.on` handler (no `invoke` — this is fire-and-forget
 *    from the renderer) so the renderer can push its two renderer-side
 *    primitive sizes back to the main process for inclusion in the next
 *    broadcast.
 */
export function registerConcurrencyMetricsIpc(ctx: MainContext): void {
  // Start periodic broadcast (every 5s + immediate first shot).
  // Fan-out to mainWindow + studioWindow so the Studio diagnostics panel
  // sees the same live metrics without waiting for its own poll tick.
  ctx.core.startConcurrencyMetricsTimer((metrics) => {
    if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
      ctx.mainWindow.webContents.send(IpcChannel.DIAGNOSTICS_CONCURRENCY_METRICS, metrics);
    }
    if (ctx.studioWindow && !ctx.studioWindow.isDestroyed()) {
      ctx.studioWindow.webContents.send(IpcChannel.DIAGNOSTICS_CONCURRENCY_METRICS, metrics);
    }
  });

  // Renderer → main: push renderer-side primitive sizes so they can be
  // included in the unified metrics payload. Fire-and-forget (no ack needed —
  // the values are cached and will appear in the next 5s broadcast).
  ipcMain.on(
    IpcChannel.DIAGNOSTICS_UPDATE_RENDERER_CONCURRENCY,
    (_event, payload: { companionBusy: number; switchEpoch: number }) => {
      if (
        payload &&
        typeof payload.companionBusy === 'number' &&
        typeof payload.switchEpoch === 'number'
      ) {
        ctx.core.updateConcurrencyMetricsFromRenderer(payload.companionBusy, payload.switchEpoch);
      }
    },
  );
}
