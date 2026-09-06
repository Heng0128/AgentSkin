// SPDX-License-Identifier: MPL-2.0

/**
 * Misc facet — pet floating companion, MCP client, and runtime tweak session.
 *
 * These small, independent feature domains don't warrant their own dedicated
 * facet files but still need a home outside the core injection facades.
 */

import { ipcRenderer } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { ToolOverride, TweakSession } from '../../shared/types/override';

export const misc = {
  // --- Pet (floating desktop companion) ---
  /** Show the floating pet window with the given pet id. */
  petShow: (petId: string) => ipcRenderer.send(IpcChannel.PET_SHOW, petId),
  /** Hide the floating pet window. */
  petHide: () => ipcRenderer.send(IpcChannel.PET_HIDE),
  /** Move the floating pet window to a new position. */
  petMove: (req: { x: number; y: number }) => ipcRenderer.send(IpcChannel.PET_MOVE, req),
  /** Switch the active pet. */
  petSet: (req: { petId: string }) => ipcRenderer.send(IpcChannel.PET_SET, req),

  // --- MCP (Model Context Protocol) ---
  getMcpStatus: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.MCP_GET_STATUS) as Promise<{
      running: boolean;
      url: string | null;
    }>,
  startMcp: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.MCP_START) as Promise<{
      ok: boolean;
      url?: string;
      error?: string;
      alreadyRunning?: boolean;
    }>,
  stopMcp: () =>
    // TODO: type-guard — 待渐进式加固
    ipcRenderer.invoke(IpcChannel.MCP_STOP) as Promise<{
      ok: boolean;
      error?: string;
      alreadyStopped?: boolean;
    }>,

  // --- Workspace live tweak (tweak-injector.ts) ---
  pushTweak: (session: TweakSession, overrides: ToolOverride) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_PUSH, session, overrides) as Promise<boolean>,
  saveTweakAsCustomCss: (session: TweakSession, overrides: ToolOverride) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_SAVE, session, overrides) as Promise<boolean>,
  resetTweak: (session: TweakSession) =>
    ipcRenderer.invoke(IpcChannel.WORKSPACE_TWEAK_RESET, session) as Promise<boolean>,
};
