// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Scheme Constants
 *
 * Extracted from `theme-library.ts` (P4 of the god-object teardown).
 *
 * Defines the custom protocol scheme used to stream extracted theme cover
 * and icon images to the renderer. The cover bytes are extracted to a disk
 * cache at catalog-build time (see {@link './utils.ts'}) and served on
 * demand so the renderer never holds the base64 blob in its JS heap.
 */

/** Scheme used to stream extracted theme cover images to the renderer. */
export const THEME_SCHEME = 'agentskin-theme';

/** Streamable cover URL served by the agentskin-theme:// protocol. */
export function themeCoverUrl(id: string): string {
  return `${THEME_SCHEME}://cover/${encodeURIComponent(id)}`;
}

/** Streamable icon URL served by the agentskin-theme:// protocol. */
export function themeIconUrl(id: string): string {
  return `${THEME_SCHEME}://icon/${encodeURIComponent(id)}`;
}
