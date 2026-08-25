// SPDX-License-Identifier: MPL-2.0

/**
 * # Shared Color Utilities
 *
 * Common color manipulation functions shared between community theme converters.
 * Extracted from community-color-bridge.ts and dsh-skin-converter.ts to
 * eliminate duplication.
 *
 * ## Exports
 *
 * - `AGENTSKIN_TOKEN_KEYS`, `AgentSkinTokenKey`, `AgentSkinTokens` — 14-token contract
 * - `adjustBrightness` — shift RGB channels
 * - `getContrastColor` — black or white based on luminance
 * - `wcagLuminance` — WCAG 2.1 relative luminance
 * - `hexToRgb` / `rgbToHex` — color format conversion
 * - `clamp` — numeric range clamping
 */

/**
 * AgentSkin's 14 semantic token keys. Order matches the canonical token
 * contract (THEME_SPEC.md) and is consumed by the palette builder.
 */
export const AGENTSKIN_TOKEN_KEYS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
] as const;

export type AgentSkinTokenKey = (typeof AGENTSKIN_TOKEN_KEYS)[number];
export type AgentSkinTokens = Record<AgentSkinTokenKey, string>;

/**
 * Adjust a hex color's brightness by adding `amount` to each RGB channel.
 * Positive values lighten, negative values darken. Channels are clamped to
 * [0, 255].
 */
export function adjustBrightness(hex: string, amount: number): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  const adjusted = {
    r: clamp(rgb.r + amount, 0, 255),
    g: clamp(rgb.g + amount, 0, 255),
    b: clamp(rgb.b + amount, 0, 255),
  };

  return rgbToHex(adjusted.r, adjusted.g, adjusted.b);
}

/**
 * Determine whether black (`#000000`) or white (`#ffffff`) text will have
 * better contrast against the given background color.
 *
 * Uses WCAG 2.1 relative luminance (sRGB linearization + 0.2126/0.7152/0.0722
 * weights), matching `scripts/utils/color-utils.mjs` luminance().
 */
export function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';

  const luminance = wcagLuminance(rgb.r, rgb.g, rgb.b);
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Compute WCAG 2.1 relative luminance for RGB channels (0–255).
 *
 * Each sRGB channel is linearized (gamma-expanded) then combined with the
 * luminance weights (0.2126 R + 0.7152 G + 0.0722 B). Matches the canonical
 * implementation in `scripts/utils/color-utils.mjs`.
 */
export function wcagLuminance(r: number, g: number, b: number): number {
  const [lr, lg, lb] = [r / 255, g / 255, b / 255].map((s) =>
    s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** Convert a `#rrggbb` string to an `{ r, g, b }` object. */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) return null;

  return {
    r: parseInt(match[1], 16),
    g: parseInt(match[2], 16),
    b: parseInt(match[3], 16),
  };
}

/** Convert r, g, b channel values (0-255) to a `#rrggbb` string. */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
}

/** Clamp a numeric value to the inclusive [min, max] range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
