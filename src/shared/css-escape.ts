// SPDX-License-Identifier: MPL-2.0

/**
 * # cssEscape
 *
 * Escape a string for use as a CSS selector (attribute value).
 * Shared utility — used by both treatment-classifier and transform-ledger
 * to safely inject `data-as-ref` selectors.
 */

export function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
