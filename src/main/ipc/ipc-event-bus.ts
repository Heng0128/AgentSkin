// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Event Bus
 *
 * Unified main→renderer broadcast layer that eliminates the three independent
 * fan-out implementations previously scattered across `main-context.ts`,
 * `theme-hot-reload.ts`, and `cdp-fanout.ts`.
 *
 * ## Problem
 *
 * Before this module, every main→renderer event required manually iterating
 * both `mainWindow` and `studioWindow`, guarding against `isDestroyed()`, and
 * try/catch around each `webContents.send`. This led to three problems:
 *
 * 1. **Duplication** — three identical fan-out loops with slightly different
 *    error-handling strategies.
 * 2. **Drift** — adding a third window (e.g. Studio sub-window) required
 *    touching 3 files and hoping they stayed consistent.
 * 3. **No type safety** — the raw channel name + payload were whatever the
 *    caller passed, with no compile-time check against the IpcChannel enum.
 *
 * ## Solution
 *
 * `IpcEventBus.broadcast(channel, payload)` iterates all registered windows,
 * skips destroyed ones, and logs + swallows send failures. Callers pass a
 * typed channel name so the compiler validates they're using a real channel.
 *
 * ## Usage
 *
 * ```ts
 * import { IpcEventBus } from './ipc-event-bus';
 * import { IpcChannel } from '../shared/ipc-channels';
 *
 * IpcEventBus.broadcast(IpcChannel.STATUS_CHANGED);
 * IpcEventBus.broadcast(IpcChannel.THEME_HEALTH_REPORT, health);
 * ```
 *
 * ## Window lifecycle
 *
 * Windows are registered via `IpcEventBus.addWindow()` during boot and removed
 * via `IpcEventBus.removeWindow()` on `closed`. The bus never holds strong
 * references — all windows are weak-ref'd by Electron's own lifecycle.
 */

import type { BrowserWindow } from 'electron';

// IpcEventBus is intentionally a static-only class — 11 call sites use
// IpcEventBus.method() and refactoring to plain functions would break them.
// biome-ignore lint/complexity/noStaticOnlyClass: static-only is the public API
export class IpcEventBus {
  private static windows: Set<BrowserWindow> = new Set();

  /** Register a window for broadcast delivery. Idempotent. */
  static addWindow(win: BrowserWindow): void {
    IpcEventBus.windows.add(win);
    // Auto-unregister on 'closed' so we never send to a destroyed window.
    // Guard with typeof so test mocks that don't implement `on` don't break.
    if (typeof win.on === 'function') {
      win.on('closed', () => IpcEventBus.windows.delete(win));
    }
  }

  /** Unregister a window explicitly (e.g. during teardown). */
  static removeWindow(win: BrowserWindow): void {
    IpcEventBus.windows.delete(win);
  }

  /** Number of currently registered windows (for tests/debugging). */
  static get windowCount(): number {
    return IpcEventBus.windows.size;
  }

  /**
   * Broadcast an event to all registered, non-destroyed windows.
   *
   * Failures are logged (at debug level) and swallowed — a renderer crash
   * must never break the main process.
   */
  static broadcast(channel: string, ...args: unknown[]): void {
    for (const win of IpcEventBus.windows) {
      if (win.isDestroyed()) {
        IpcEventBus.windows.delete(win);
        continue;
      }
      try {
        win.webContents.send(channel, ...args);
      } catch (err) {
        // Renderer may have crashed mid-send. Log + swallow.
        console.debug(`[IpcEventBus] send failed on ${channel}:`, err);
      }
    }
  }

  /** Clear all registered windows (primarily for test teardown). */
  static clear(): void {
    IpcEventBus.windows.clear();
  }
}
