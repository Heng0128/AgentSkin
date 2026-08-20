// SPDX-License-Identifier: MPL-2.0

/**
 * # Coordinator IPC
 *
 * IPC handlers for the AppRunStateCoordinator: pushes state changes to the
 * renderer and handles snapshot/query requests.
 *
 * ## Design
 *
 * - `COORDINATOR_STATUS` (SEND_ONLY): pushed by the coordinator's
 *   `onStatusChange` listener whenever state changes. The renderer subscribes
 *   via `onCoordinatorStatus`.
 * - `COORDINATOR_SNAPSHOT` (INVOKE): one-shot full snapshot on renderer boot.
 * - `COORDINATOR_QUERY` (INVOKE): point query for a single app.
 *
 * ## Dependencies
 *
 * The coordinator is a process-wide singleton. This module registers a
 * listener on its `onStatusChange` EventEmitter at initialization time and
 * forwards events to the renderer via `webContents.send`.
 */

import { type BrowserWindow, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AppRunState } from '../services/app-run-state-coordinator';
import { getAppRunStateCoordinator } from '../services/app-run-state-coordinator';
import { assertTrustedSender } from './trusted-sender';
import { withMonitoredTimeout } from './with-monitored-timeout';

/** Bounded timeout for snapshot/query operations. */
const QUERY_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Main window reference (injected via `configureCoordinatorIpc`). */
let mainWindow: BrowserWindow | null = null;

/** Unsubscribe function for the coordinator's status-change listener. */
let unsubStatusChange: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Inject the main window reference for status push. */
export function configureCoordinatorIpc(win: BrowserWindow | null): void {
  mainWindow = win;
}

// ---------------------------------------------------------------------------
// Push to renderer
// ---------------------------------------------------------------------------

/** Push a coordinator state change to the renderer via `COORDINATOR_STATUS`.
 *  Best-effort — no-op when the main window is unavailable. */
function pushCoordinatorStatus(appId: string, state: AppRunState): void {
  const win = mainWindow;
  if (win && !win.isDestroyed()) {
    win.webContents.send(IpcChannel.COORDINATOR_STATUS, { appId, state });
  }
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

/** Register all coordinator IPC handlers and subscribe to coordinator events.
 *  Should be called once during app initialization (after main window creation).
 *  @param win Optional main window reference for status push. If not provided,
 *  the coordinator will attempt to push but silently no-op. */
export function registerCoordinatorIpc(win?: BrowserWindow | null): void {
  if (unsubStatusChange) return; // 防止重复注册导致订阅泄漏和重复推送
  const coordinator = getAppRunStateCoordinator();
  if (win) {
    mainWindow = win;
  }

  // Subscribe to coordinator state changes and forward to renderer.
  unsubStatusChange = coordinator.onStatusChange((event) => {
    pushCoordinatorStatus(event.appId, event.state);
  });

  // One-shot full snapshot on renderer boot / window restore.
  ipcMain.handle(IpcChannel.COORDINATOR_SNAPSHOT, (event) => {
    assertTrustedSender(event);
    return withMonitoredTimeout(
      IpcChannel.COORDINATOR_SNAPSHOT,
      QUERY_TIMEOUT_MS,
      Promise.resolve(coordinator.getSnapshot()),
    );
  });

  // Point query for a single app.
  ipcMain.handle(IpcChannel.COORDINATOR_QUERY, (event, appId: string) => {
    assertTrustedSender(event);
    return withMonitoredTimeout(
      IpcChannel.COORDINATOR_QUERY,
      QUERY_TIMEOUT_MS,
      Promise.resolve(coordinator.getState(appId)),
    );
  });
}

/** Unsubscribe from coordinator events (for testing or app shutdown). */
export function disposeCoordinatorIpc(): void {
  if (unsubStatusChange) {
    unsubStatusChange();
    unsubStatusChange = null;
  }
  ipcMain.removeHandler(IpcChannel.COORDINATOR_SNAPSHOT);
  ipcMain.removeHandler(IpcChannel.COORDINATOR_QUERY);
}
