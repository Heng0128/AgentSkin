// SPDX-License-Identifier: MPL-2.0

/**
 * # Deep Link Handler
 *
 * Bridges the {@link DeepLinkManager} to the rest of the main process by
 * routing parsed deep link commands to their corresponding actions:
 *
 *   - `apply`    — Apply a theme to an agent. If the agent is running with a
 *                  live CDP port, perform a fast-path apply; otherwise
 *                  surface the `requires-restart` result to the UI.
 *   - `restore`  — Restore an agent to its native appearance.
 *   - `install`  — Download + install a theme from a remote URL.
 *   - `open`     — Open a local theme file (delegates to the file-open flow).
 *   - `navigate` — Send the renderer a navigation request.
 *
 * The handler is registered during {@link registerDeepLinkHandler}, which
 * is called after boot completes. Any deep links that arrived before boot
 * are flushed by the DeepLinkManager's queue.
 */

import type { DeepLinkCommand } from '../shared/deep-link-commands';
import { IpcChannel } from '../shared/ipc-channels';
import { isAgentId } from '../shared/types';
import { deepLinkManager } from './deep-link-manager';
import { ctx, sendLog } from './main-context';

/**
 * Handle an `apply` deep link command. Applies the theme to the target agent
 * using the existing apply flow through `ctx.core`.
 */
async function handleApply(cmd: Extract<DeepLinkCommand, { command: 'apply' }>): Promise<void> {
  const { themeId, appId, schemeId } = cmd;
  sendLog(
    `[deep-link] apply: theme=${themeId} app=${appId ?? 'none'} scheme=${schemeId ?? 'none'}`,
  );

  // If no app specified, push to renderer and let the user pick.
  if (!appId) {
    sendDeepLinkToRenderer({ type: 'apply', themeId, schemeId });
    surfaceMainWindow();
    return;
  }

  if (!isAgentId(appId)) {
    sendLog(`[deep-link] apply: invalid agent id "${appId}"`);
    return;
  }

  if (!ctx.core) {
    sendLog('[deep-link] apply: core not ready, pushing to renderer');
    sendDeepLinkToRenderer({ type: 'apply', themeId, appId, schemeId });
    surfaceMainWindow();
    return;
  }

  try {
    const result = await ctx.core.apply({ themeId, appId, schemeId, restartExisting: false });
    sendLog(`[deep-link] apply result: ${result.status}`);
    // Notify the renderer of the result for UI updates.
    sendDeepLinkToRenderer({ type: 'apply-result', themeId, appId, status: result.status });
  } catch (error) {
    sendLog(`[deep-link] apply failed: ${(error as Error).message}`);
    sendDeepLinkToRenderer({
      type: 'apply-error',
      themeId,
      appId,
      error: (error as Error).message,
    });
  }
}

/**
 * Handle a `restore` deep link command. Restores the agent to its native
 * appearance, optionally scoped to a specific app.
 */
async function handleRestore(cmd: Extract<DeepLinkCommand, { command: 'restore' }>): Promise<void> {
  const { appId } = cmd;
  sendLog(`[deep-link] restore: app=${appId ?? 'all'}`);

  if (!ctx.core) {
    sendLog('[deep-link] restore: core not ready, pushing to renderer');
    sendDeepLinkToRenderer({ type: 'restore', appId });
    surfaceMainWindow();
    return;
  }

  try {
    if (appId) {
      if (!isAgentId(appId)) {
        sendLog(`[deep-link] restore: invalid agent id "${appId}"`);
        return;
      }
      await ctx.core.restore(appId);
    } else {
      await ctx.core.restoreAll();
    }
    sendLog('[deep-link] restore completed');
  } catch (error) {
    sendLog(`[deep-link] restore failed: ${(error as Error).message}`);
  }
}

/**
 * Handle an `install` deep link command. Downloads and installs a theme
 * from a remote URL.
 */
async function handleInstall(cmd: Extract<DeepLinkCommand, { command: 'install' }>): Promise<void> {
  const { url } = cmd;
  sendLog(`[deep-link] install: url=${url}`);

  // Delegate to the renderer — theme installation requires UI confirmation
  // (license check, overwrite prompt, etc.) that lives in the React layer.
  sendDeepLinkToRenderer({ type: 'install', url });
  surfaceMainWindow();
}

/**
 * Handle an `open` deep link command. Opens a local theme file.
 */
async function handleOpen(cmd: Extract<DeepLinkCommand, { command: 'open' }>): Promise<void> {
  const filePath = cmd.path;
  sendLog(`[deep-link] open: path=${filePath}`);

  // Delegate to the file-open queue (same as drag-drop / double-click).
  ctx.fileOpens.handlePath(filePath);
  surfaceMainWindow();
}

/**
 * Handle a `navigate` deep link command. Sends the renderer a signal to
 * switch to the requested page.
 */
async function handleNavigate(
  cmd: Extract<DeepLinkCommand, { command: 'navigate' }>,
): Promise<void> {
  const { page } = cmd;
  sendLog(`[deep-link] navigate: page=${page}`);
  sendDeepLinkToRenderer({ type: 'navigate', page });
  surfaceMainWindow();
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Deep link event payload sent to the renderer via IPC. */
export type DeepLinkEvent =
  | { type: 'apply'; themeId: string; appId?: string; schemeId?: string }
  | { type: 'apply-result'; themeId: string; appId: string; status: string }
  | { type: 'apply-error'; themeId: string; appId: string; error: string }
  | { type: 'restore'; appId?: string }
  | { type: 'install'; url: string }
  | { type: 'navigate'; page: string };

/**
 * Send a deep link event to all windows. The renderer subscribes via
 * preload to handle navigation and in-app prompts.
 */
export function sendDeepLinkToRenderer(event: DeepLinkEvent): void {
  const payload = event as Record<string, unknown>;
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(IpcChannel.DEEP_LINK, payload);
  }
  if (ctx.studioWindow && !ctx.studioWindow.isDestroyed()) {
    ctx.studioWindow.webContents.send(IpcChannel.DEEP_LINK, payload);
  }
}

/** Show + focus the main window so the user sees the result of a deep link. */
function surfaceMainWindow(): void {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.show();
    ctx.mainWindow.focus();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the deep link handler. This connects the DeepLinkManager to the
 * main-process action handlers. Any buffered deep links are flushed.
 *
 * Called from the IPC boot step after ctx.core is initialized.
 */
export function registerDeepLinkHandler(): void {
  deepLinkManager.setHandler((command, _rawUrl) => {
    // Fire-and-forget: the handler is sync but each command handler is async.
    // Errors are caught inside each handler.
    switch (command.command) {
      case 'apply':
        void handleApply(command);
        break;
      case 'restore':
        void handleRestore(command);
        break;
      case 'install':
        void handleInstall(command);
        break;
      case 'open':
        void handleOpen(command);
        break;
      case 'navigate':
        void handleNavigate(command);
        break;
    }
  });
  sendLog('[deep-link] handler registered');
}
