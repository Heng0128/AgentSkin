// SPDX-License-Identifier: MPL-2.0

/**
 * # Decoration Types
 *
 * Defines the data model for AI-generated decorative assets that can be
 * applied to a theme. Decorations are generated once (via image analysis
 * or builtin templates) and then cached locally for repeated use — no
 * external API key required.
 *
 * ## Design principles
 *
 *   - **One-time generation**: AI (or template) produces candidate PNG/SVG
 *     decorations once; subsequent switches are pure-local.
 *   - **No API key**: builtin decorations work offline without any LLM.
 *   - **Theme-scoped storage**: decorations live alongside the theme
 *     directory so they travel with import/export.
 */

/** Supported decoration file formats. */
export type DecorationFormat = 'png' | 'svg';

/**
 * A single decorative asset — either an AI-generated PNG or a builtin SVG
 * template rendered to a data URL.
 */
export interface DecorationAsset {
  /** Unique id (slug) for this decoration within the theme. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** File format. */
  format: DecorationFormat;
  /** Intrinsic width in pixels (SVG = viewBox width). */
  width: number;
  /** Intrinsic height in pixels (SVG = viewBox height). */
  height: number;
  /**
   * Base64 data URL (`data:image/png;base64,…` or
   * `data:image/svg+xml;base64,…`). Populated after generation / cache load.
   */
  dataUrl: string;
  /** Unix epoch (ms) when this decoration was generated. */
  generatedAt: number;
  /**
   * SHA-256 hex digest of the source image that triggered generation.
   * Used as the cache key so re-analysing the same image returns the
   * cached result without regeneration.
   */
  sourceImageHash: string;
}

/**
 * Predefined slot positions where a decoration can be placed on the agent
 * window. Maps to CSS `background-position` anchors.
 */
export type DecorationPosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'center';

/**
 * Binds a {@link DecorationAsset} to a specific position on the agent
 * window with transform parameters.
 */
export interface DecorationSlot {
  /** Unique id for this slot assignment. */
  id: string;
  /** Anchor position on the window. */
  position: DecorationPosition;
  /** Reference to the {@link DecorationAsset.id} used in this slot. */
  assetId: string;
  /** Opacity multiplier in [0, 1]. */
  opacity: number;
  /** Scale factor (1 = native size). */
  scale: number;
  /** Horizontal offset in px from the anchor. */
  offsetX: number;
  /** Vertical offset in px from the anchor. */
  offsetY: number;
}

/**
 * Output of the image-analysis step that drives decoration generation.
 * Pure data — no I/O — so it can be unit-tested directly.
 */
export interface DecorationPrompt {
  /** Detected palette mood (drives colour choices for the decoration). */
  mood: 'warm' | 'cool' | 'neutral' | 'vibrant' | 'muted';
  /** Average luminance [0, 1] of the source image. */
  luminance: number;
  /** Dominant hue in degrees [0, 360). */
  dominantHue: number;
  /** Suggested decoration keywords (for template matching / future AI). */
  keywords: string[];
}

/**
 * Result of the generation step: a list of candidate decorations.
 */
export interface DecorationGenerateResult {
  /** Generated candidate decorations. */
  assets: DecorationAsset[];
  /** Whether builtin templates were used (true) or AI was used (false). */
  usedBuiltin: boolean;
}
