// SPDX-License-Identifier: MPL-2.0

/**
 * # Visual Analyzer IPC (Stub)
 *
 * Registers handlers for the VISUAL_ANALYSIS_* channel family. The full Visual
 * Analyzer feature (CDP-based target extraction, theme export from existing
 * agent styling) is not yet implemented in the main process. These stubs:
 *
 *   1. Prevent renderer-side `ipcRenderer.invoke` calls from hanging
 *      indefinitely (Electron rejects with "No handler registered" after ~30s).
 *   2. Return empty/placeholder data so the UI degrades gracefully
 *      (shows empty states, no crash).
 *   3. Centralize the placeholder shapes so the full implementation can
 *      replace them inline without touching preload or renderer.
 *
 * TODO(Phase 3): Replace stubs with real implementations that read
 * from `agents-profiles/<id>.json` and perform CDP extraction.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';

export function registerVisualAnalyzerIpc(): void {
  // List available agent profile ids (from agents-profiles/ directory).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_LIST, () => {
    // Stub: return empty array. Real impl reads agents-profiles/*.json.
    return [] as string[];
  });

  // Get a single agent profile by id.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_GET, (_event, _agentName: string) => {
    // Stub: return null. Real impl reads agents-profiles/<agentName>.json.
    return null;
  });

  // Detect whether an agent process is currently running.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_DETECT, (_event, _agentName: string) => {
    // Stub: return not-running status. Field names must match AgentSkinClient contract.
    return { running: false, port: undefined, title: undefined };
  });

  // Trigger a CDP-based extraction from a running agent.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_CDP_EXTRACT, (_event, _agentName: string) => {
    // Stub: return a "not implemented" signal. Field name must match `message` per contract.
    return { ok: false, message: 'Visual Analyzer is not yet implemented' };
  });

  // Subscribe to extraction progress events. Stub: no-op registration.
  //
  // NOTE: The preload API subscribes via `ipcRenderer.on(IpcChannel.VISUAL_ANALYSIS_STATUS, ...)`
  // which expects main-process PUSH events (webContents.send), not invoke/handle request/response.
  // Registering `ipcMain.handle` here creates a channel direction mismatch — the renderer's
  // subscription will never fire. The full implementation should emit progress via:
  //   webContents.send(IpcChannel.VISUAL_ANALYSIS_STATUS, { agent, step, progress })
  // Intentionally NO handle registered for this channel. The subscription stub lives in
  // the preload layer (returns a no-op unsubscribe) so renderer code does not crash.

  // Export a visual analysis theme as a .agentskin-theme package.
  ipcMain.handle(
    IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME,
    (_event, _agentName: string, _themeData: unknown) => {
      // Stub: return failure. Field name must match `path` per contract.
      return { ok: false, path: undefined };
    },
  );
}
