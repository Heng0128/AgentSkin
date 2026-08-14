// SPDX-License-Identifier: MPL-2.0

/**
 * # hash
 *
 * Renderer-side hashing utilities for stable identifier generation.
 *
 * Uses the Web Crypto API (`crypto.subtle.digest`) — available in Electron
 * renderer processes. Produces the same output as the main-process
 * `createHash('sha256')` used by `electron-scanner.ts`, keeping IDs
 * consistent across both layers.
 */

/** SHA-256 hex digest (first 16 chars) of a UTF-8 string. */
export async function sha256Hex16(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hex.slice(0, 16);
}
