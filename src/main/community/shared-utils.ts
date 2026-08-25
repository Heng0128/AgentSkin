// SPDX-License-Identifier: MPL-2.0

/**
 * # Shared Utilities
 *
 * Common utility functions shared between community theme converters.
 */

/**
 * Normalize a title/name to a safe AgentSkin-compatible slug.
 *
 * Rules:
 * - Lowercase
 * - Only `[a-z0-9-]` characters
 * - Leading/trailing dashes stripped
 * - Collapses consecutive dashes
 * - Truncated to 100 characters
 *
 * @param rawTitle - Raw title string to normalize.
 * @param fallback - Fallback slug when input is empty (defaults to "theme").
 * @returns Normalized slug (e.g. "Cyber Neon" → "cyber-neon").
 */
export function normalizeTitle(rawTitle: string, fallback = 'theme'): string {
  if (typeof rawTitle !== 'string' || rawTitle.length === 0) {
    return fallback;
  }
  return (
    rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-{2,}/g, '-')
      .slice(0, 100) || fallback
  );
}
