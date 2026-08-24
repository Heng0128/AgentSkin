// SPDX-License-Identifier: MPL-2.0

/**
 * Status Sync: MCP -> GUI
 *
 * When MCP tools perform write operations (apply, restore, import, delete),
 * the GUI should reflect the state change in real-time.
 *
 * This module provides a helper that MCP tool handlers can call after
 * write operations to trigger the same status notification that IPC handlers use.
 */

import { notifyStatusChanged } from '../main-context';

/**
 * Notify GUI of a status change after an MCP write operation.
 *
 * This mirrors what theme-ipc.ts does after apply/restore:
 *   - calls notifyStatusChanged() to fan-out STATUS_CHANGED to all windows
 *   - non-blocking (fire-and-forget, errors swallowed)
 *
 * @param operation - human-readable operation name for logging
 */
export function syncStatusToGui(operation: string): void {
  try {
    notifyStatusChanged();
  } catch {
    // Non-critical: GUI sync failure should not fail the MCP operation
  }
}
