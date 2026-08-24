// SPDX-License-Identifier: MPL-2.0

/**
 * # Community Color Bridge
 *
 * Converts DreamSkin's 10-color palette into AgentSkin's 14-token system.
 *
 * DreamSkin themes expose a `displayMeta.colors` map with up to 8 semantic
 * color keys (accent, secondary, background, text, muted, panel, panelAlt,
 * line) plus an `appearance` field (auto/light/dark). AgentSkin's theme
 * engine expects 14 CSS-variable tokens. This module derives the 6 missing
 * tokens (codeBackground, codeForeground, inputBackground, buttonBackground,
 * buttonForeground, focusRing) from the 8 provided colors using brightness
 * adjustment and contrast calculation.
 *
 * ## Mapping
 *
 * | DreamSkin color   | AgentSkin token        | Derivation                          |
 * |-------------------|------------------------|-------------------------------------|
 * | accent            | accent                 | Direct                              |
 * | secondary         | secondary              | Direct                              |
 * | background        | background             | Direct                              |
 * | text              | foreground             | Direct                              |
 * | muted             | muted                  | Direct                              |
 * | panel             | surface                | Direct                              |
 * | panelAlt          | surfaceElevated        | Direct                              |
 * | line              | border                 | Direct                              |
 * | —                 | codeBackground         | surface ± brightness                |
 * | —                 | codeForeground         | foreground (passthrough)            |
 * | —                 | inputBackground        | surface (passthrough)               |
 * | —                 | buttonBackground       | accent (passthrough)                |
 * | —                 | buttonForeground       | contrast color of accent            |
 * | —                 | focusRing              | accent @ 50% opacity                |
 */

import type { CommunityTheme } from '../../shared/types/community';

// --- Constants ---------------------------------------------------------------------------

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

/** Brightness adjustment (±RGB units) for derived code background. */
const CODE_BG_BRIGHTNESS_SHIFT = 2;

/** Opacity suffix for focusRing (0x80 = 50%). */
const FOCUS_RING_OPACITY = '80';

// --- Public API ---------------------------------------------------------------------------

/**
 * Bridge a DreamSkin community theme's 10-color palette to AgentSkin's
 * 14-token system.
 *
 * Pure function — no I/O, no side effects. Falls back to sensible defaults
 * when individual colors are missing or malformed.
 *
 * @param theme - A `CommunityTheme` from the DreamSkin API.
 * @returns A complete `AgentSkinTokens` map with all 14 keys populated.
 */
export function bridgeColors(theme: CommunityTheme): AgentSkinTokens {
  const colors = theme.displayMeta?.colors ?? {};
  const appearance = normalizeAppearance(theme.displayMeta?.appearance);

  // 8 direct mappings from DreamSkin → AgentSkin.
  // Every key has a fallback default, so the object is structurally complete
  // even though TypeScript sees `Partial<AgentSkinTokens>`.
  const base = {
    accent: parseHex(colors.accent) ?? defaultAccent(appearance),
    secondary: parseHex(colors.secondary) ?? defaultSecondary(appearance),
    foreground: parseHex(colors.text) ?? defaultForeground(appearance),
    muted: parseHex(colors.muted) ?? '#6b7280',
    surface: parseHex(colors.panel) ?? defaultSurface(appearance),
    surfaceElevated: parseHex(colors.panelAlt) ?? defaultSurfaceElevated(appearance),
    border: parseHex(colors.line) ?? defaultBorder(appearance),
    background: parseHex(colors.background) ?? defaultBackground(appearance),
  } as const;

  // 6 derived tokens + 8 base tokens = 14.
  return {
    ...base,
    // codeBackground: surface shifted slightly toward the opposite luminance.
    codeBackground: adjustBrightness(
      base.surface,
      appearance === 'dark' ? -CODE_BG_BRIGHTNESS_SHIFT : CODE_BG_BRIGHTNESS_SHIFT,
    ),
    // codeForeground: same as foreground (code text uses the main text color).
    codeForeground: base.foreground,
    // inputBackground: identical to surface.
    inputBackground: base.surface,
    // buttonBackground: accent drives the primary button.
    buttonBackground: base.accent,
    // buttonForeground: black or white depending on accent luminance.
    buttonForeground: getContrastColor(base.accent),
    // focusRing: accent at 50% opacity.
    focusRing: base.accent + FOCUS_RING_OPACITY,
  };
}

// --- Appearance helpers -------------------------------------------------------------------

/**
 * Normalize the DreamSkin `appearance` field. The API may return `auto`
 * (meaning "follow system") — we treat it as `light` for color derivation
 * purposes since the actual system-mode resolution happens at apply time.
 */
function normalizeAppearance(
  appearance: string | undefined,
): 'light' | 'dark' {
  if (appearance === 'dark') return 'dark';
  return 'light';
}

// --- Default palettes ---------------------------------------------------------------------

/** Fallback accent when the theme provides none. */
function defaultAccent(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#60a5fa' : '#4f8cff';
}

/** Fallback secondary when the theme provides none. */
function defaultSecondary(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#93b5d6' : '#7ba7d8';
}

/** Fallback foreground (text) when the theme provides none. */
function defaultForeground(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#eef2f7' : '#1f2937';
}

/** Fallback surface when the theme provides none. */
function defaultSurface(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#1e293b' : '#ffffff';
}

/** Fallback elevated surface when the theme provides none. */
function defaultSurfaceElevated(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#334155' : '#f8fafc';
}

/** Fallback border when the theme provides none. */
function defaultBorder(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#374151' : '#e5e7eb';
}

/** Fallback background when the theme provides none. */
function defaultBackground(appearance: 'light' | 'dark'): string {
  return appearance === 'dark' ? '#0f172a' : '#f8fafc';
}

// --- Color utilities ----------------------------------------------------------------------

/**
 * Parse a hex color string. Accepts `#RGB`, `#RRGGBB`, and `#RRGGBBAA`
 * (alpha is discarded). Returns `null` for any non-hex input so callers
 * can fall back to defaults.
 */
export function parseHex(value: string | undefined): string | null {
  if (!value) return null;

  const trimmed = value.trim();
  const match = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!match) return null;

  let hex = match[1].toLowerCase();

  // Expand short form (#RGB → #RRGGBB).
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  // Strip alpha channel if present (#RRGGBBAA → #RRGGBB).
  return '#' + hex.slice(0, 6);
}

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
 * better contrast against the given background color. Uses Rec. 601
 * luminance weights (sufficient for text-on-solid decisions).
 */
export function getContrastColor(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5 ? '#000000' : '#ffffff';
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
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.round(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

/** Clamp a numeric value to the inclusive [min, max] range. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
