// SPDX-License-Identifier: MPL-2.0

/**
 * # Environment IPC
 *
 * Persists environment presets in the MAIN process (userData/env-presets.json),
 * completing the Workspace "做实" work (strategic audit P0-3): presets are no
 * longer kept in the renderer's localStorage.
 *
 *   - env-preset:get  → returns the persisted preset array
 *   - env-preset:set  → writes the full preset array (renderer is source of truth)
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { EnvironmentPreset } from '../../ui/types/environment';
import { loadEnvPresets, saveEnvPresets } from '../env-preset-store';
import type { MainContext } from '../main-context';

export function registerEnvironmentIpc(ctx: MainContext): void {
  ipcMain.handle(IpcChannel.ENV_PRESET_GET, async () => {
    return loadEnvPresets(ctx.userDataRoot);
  });

  ipcMain.handle(IpcChannel.ENV_PRESET_SET, async (_event, presets: EnvironmentPreset[]) => {
    const ok = await saveEnvPresets(ctx.userDataRoot, Array.isArray(presets) ? presets : []);
    return { ok };
  });
}
