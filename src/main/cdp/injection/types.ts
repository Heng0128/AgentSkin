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
  /**
   * Whether #root or body has a blob: background
   */
  heroBlobActive: boolean;
  /**
   * 2026-08-23: whether `--agentskin-art` resolves to an actual `url(blob:)`
   * value. Unlike `heroBlobActive` (which only reads root/body backgroundImage
   * and is always false when the theme paints hero on a z-index:-1 pseudo
   * element), this directly inspects the art CSS variable. Lets the watchdog
   * decide whether hero image re-injection is needed.
   */
  artResolved?: boolean;
  /** Number of adoptedStyleSheets with __agentskin flag */
  adoptedSheetCount: number;
  /**
   * Per-layer presence tracking — keyed by layer name (palette, tokens,
   * cosmetic, theme, custom). Each value is the CSSRule count for that layer's
   * adoptedStyleSheet, or 0 if the layer is absent. The watchdog uses this to
   * decide whether a re-injection is needed (any required layer missing or
   * ruleCount === 0 → re-inject).
   */
  layers?: Record<string, number>;
  /**
   * 2a multi-asset: resolved `--agentskin-asset-<id>` values (truncated),
   * keyed by the full custom property name (e.g. `--agentskin-asset-mascot`).
   * Only present when the renderer is a modern build that reports it.
   */
  assets?: Record<string, string>;
  /** 2a multi-asset: number of non-empty `--agentskin-asset-*` variables. */
  assetsActive?: number;
}
