// SPDX-License-Identifier: MPL-2.0

/**
 * # Quick Apply IPC
 *
 * Registers the `QUICK_APPLY_SUBMIT` and `QUICK_APPLY_UNDO` IPC channels.
 *
 * - `QUICK_APPLY_SUBMIT` — renderer sends an image path, the full Quick Apply
 *   pipeline runs (decode → extract → install → apply), and progress events
 *   are pushed back via `webContents.send(QUICK_APPLY_PROGRESS)`.
 * - `QUICK_APPLY_UNDO` — renderer asks to restore the target agent to its
 *   native look (revert the last quick-apply).
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { QuickApplyRequest } from '../../shared/types/ipc';
import type { MainContext } from '../main-context';
import { notifyStatusChanged } from '../main-context';
import { createQuickApplyDeps } from '../quick-apply/quick-apply-deps';
import { createQuickApplyEngine } from '../quick-apply/quick-apply-engine';
import { assertAgentId } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

/**
 * Register the Quick Apply IPC handlers.
 *
 * @param ctx  The MainContext with library and core services.
 */
export function registerQuickApplyIpc(ctx: MainContext): void {
  const engine = createQuickApplyEngine(
    createQuickApplyDeps(ctx, (progress) => {
      ctx.mainWindow?.webContents.send(IpcChannel.QUICK_APPLY_PROGRESS, progress);
    }),
  );

  // --- QUICK_APPLY_SUBMIT ---
  ipcMain.handle(IpcChannel.QUICK_APPLY_SUBMIT, async (_event, request: QuickApplyRequest) => {
    return withMonitoredTimeout(
      IpcChannel.QUICK_APPLY_SUBMIT,
      60_000,
      (async () => {
        // Validate appId.
        if (!request || typeof request.targetAppId !== 'string') {
          return { success: false, error: 'Missing targetAppId' };
        }
        assertAgentId(request.targetAppId);
        if (typeof request.imagePath !== 'string' || !request.imagePath) {
          return { success: false, error: 'Missing imagePath' };
        }

        const result = await engine.run(request);

        // Notify status changed after a successful apply.
        if (result.success) {
          void notifyStatusChanged();
        }

        return result;
      })(),
    );
  });

  // --- QUICK_APPLY_UNDO ---
  ipcMain.handle(IpcChannel.QUICK_APPLY_UNDO, async (_event, appId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.QUICK_APPLY_UNDO,
      30_000,
      (async () => {
        assertAgentId(appId);
        const result = await engine.undo(appId);
        if (result.success) {
          void notifyStatusChanged();
        }
        return result;
      })(),
    );
  });
}
