// SPDX-License-Identifier: MPL-2.0

/**
 * # Trusted Sender
 *
 * Minimal main-process guard for high-sensitivity IPC channels. The main
 * window's `webContents.id` is recorded when the window is created; handlers
 * that could be abused by third-party content embedded in a webview/iframe
 * call {@link assertTrustedSender} to reject calls from any other sender.
 *
 * Keeping this in its own module (instead of `ipc-validators.ts`) avoids an
 * ESM import cycle: `main-context` already imports from `ipc/bundle-ipc`,
 * which imports `ipc-validators` — importing `ctx` from `main-context` there
 * would create a cycle. This module has no dependencies on `main-context`.
 */

/** webContents.id of the trusted main window, or null until set. */
let trustedSenderId: number | null = null;

/** Record the trusted main window's webContents id (called at window creation). */
export function setTrustedSenderId(id: number | null): void {
  trustedSenderId = id;
}

/**
 * Structural subset of `IpcMainInvokeEvent` needed for the sender check.
 * Uses `parent` (not `isMainFrame`) because Electron's `WebFrameMain` exposes
 * `parent: WebFrameMain | null` — the main frame has `parent === null`. This
 * shape is structurally assignable to the real `WebFrameMain` type.
 */
interface SenderLike {
  sender: { id: number };
  senderFrame: { parent: unknown | null } | null;
}

/** True when the IPC event originates from the trusted main window's top frame. */
export function isTrustedSender(event: SenderLike): boolean {
  // 1. The sender webContents must be the recorded main window.
  if (trustedSenderId === null || event.sender.id !== trustedSenderId) return false;
  // 2. The caller must be the top-level frame, not an embedded iframe. Iframes
  //    share the parent webContents.id, so the id check alone cannot exclude
  //    them; an attacker-injected iframe would otherwise pass the webContents
  //    gate and reach high-sensitivity handlers. The main frame is the only
  //    one whose `parent` is null.
  return event.senderFrame?.parent == null;
}

/**
 * Reject IPC calls from an untrusted sender. Throws so the underlying
 * `ipcMain.handle` rejects the promise (renderer gets a catchable error).
 */
export function assertTrustedSender(event: SenderLike): void {
  if (!isTrustedSender(event)) {
    throw new Error('Untrusted IPC sender');
  }
}
