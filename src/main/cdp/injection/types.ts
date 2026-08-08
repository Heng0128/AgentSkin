// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/types
 *
 * Shared types for theme injection. Extracted from the split of
 * {@link ./shared}.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ThemeVerification {
  /** --agentskin-accent value on :root */
  accent: string;
  /** --agentskin-art value (truncated) */
  agentskinArt: string;
  /** Whether #root or body has a blob: background */
  heroBlobActive: boolean;
  /** Number of adoptedStyleSheets with __agentskin flag */
  adoptedSheetCount: number;
}
