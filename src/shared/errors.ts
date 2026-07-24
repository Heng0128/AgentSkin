// SPDX-License-Identifier: MPL-2.0

/**
 * Shared error helpers. Imported by main, legacy, and renderer layers.
 */

/**
 * Safely extract a human-readable message from any thrown value.
 *
 * Handles Error instances, strings, plain objects with a `message` property,
 * and anything else (via String()). Replaces the unsafe `(e as Error).message`
 * pattern which returns undefined when `e` is not an Error instance.
 */
export function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(e);
}
