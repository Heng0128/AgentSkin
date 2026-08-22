// SPDX-License-Identifier: MPL-2.0

/**
 * Shared error helpers. Imported by main, legacy, and renderer layers.
 */

import { isIpcTimeoutError, type SerializedIpcTimeoutError } from './withTimeout';

/**
 * Safely extract a human-readable message from any thrown value.
 *
 * Handles serialized IpcTimeoutError (cross-IPC) first so the renderer sees
 * a friendly "[超时] CH — retry" style message instead of the raw
 * "channel 'CH' timed out after 30000ms" string that toMessage would otherwise
 * produce and that friendlyMessage would then discard (no `Error:` prefix to
 * strip → falls back to the generic `actionFailed`).
 *
 * Also handles Error instances, strings, plain objects with a `message`
 * property, and anything else (via String()).
 */
export function toMessage(e: unknown): string {
  if (isIpcTimeoutError(e)) {
    const detail = e as SerializedIpcTimeoutError;
    const channel = detail.channel ?? 'IPC';
    const seconds = Math.round((detail.ms ?? 0) / 1000);
    return `Error: [Timeout] ${channel} — did not complete in ${seconds}s`;
  }
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(e);
}
