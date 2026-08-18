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
  /**
   * 2a multi-asset: resolved `--agentskin-asset-<id>` values (truncated),
   * keyed by the full custom property name (e.g. `--agentskin-asset-mascot`).
   * Only present when the renderer is a modern build that reports it.
   */
  assets?: Record<string, string>;
  /** 2a multi-asset: number of non-empty `--agentskin-asset-*` variables. */
  assetsActive?: number;
}
