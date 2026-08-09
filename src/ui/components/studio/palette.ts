// SPDX-License-Identifier: MPL-2.0

import { hexToRgb, rgbToHex } from '@/utils/color-theory';

import type { ThemeVisualSnapshot } from '@shared/types';

// ---------------------------------------------------------------------------
// P4 helpers — derive a coherent `--agentskin-*` palette from a snapshot
// ---------------------------------------------------------------------------

/** Mix hex colors A and B by t (0 = A, 1 = B). */
export function hexMix(a: string, b: string, t: number): string {
  const A = hexToRgb(a) || [0, 0, 0];
  const B = hexToRgb(b) || [255, 255, 255];
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return rgbToHex([m(A[0], B[0]), m(A[1], B[1]), m(A[2], B[2])]);
}

/** Hex → rgba() string. */
export function toRgba(hex: string, alpha: number): string {
  const rgb = hexToRgb(hex) || [0, 0, 0];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/** Perceptual lightness estimate (linear sRGB, 0-1). Used for dark/light decisions. */
export function lumOf(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0.5;
  const [r, g, b] = rgb.map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Build the full `--agentskin-*` token set from the three core keys.
 * Shared by {@link buildStudioPalette} (snapshot-driven) and the fit-generator
 * (10-key palette-driven) so both produce identical token math.
 */
export function buildSkinTokens(input: {
  bg: string;
  fg: string;
  accent: string;
}): Record<string, string> {
  const { bg, fg, accent } = input;
  const dark = lumOf(bg) < 0.5;
  const surface = dark ? hexMix(bg, '#ffffff', 0.12) : hexMix(bg, '#000000', 0.06);
  const surfaceElev = dark ? hexMix(bg, '#ffffff', 0.2) : hexMix(bg, '#000000', 0.1);
  const muted = dark ? hexMix(fg, '#000000', 0.4) : hexMix(fg, '#ffffff', 0.45);
  const codeBg = dark ? hexMix(bg, '#000000', 0.3) : hexMix(bg, '#ffffff', 0.55);
  const inputBg = dark ? hexMix(surface, '#ffffff', 0.06) : hexMix(surface, '#000000', 0.04);
  return {
    '--agentskin-accent': accent,
    '--agentskin-secondary': accent,
    '--agentskin-bg': bg,
    '--agentskin-surface': surface,
    '--agentskin-surface-elevated': surfaceElev,
    '--agentskin-text': fg,
    '--agentskin-muted': muted,
    '--agentskin-border': toRgba(accent, dark ? 0.18 : 0.3),
    '--agentskin-code-bg': codeBg,
    '--agentskin-code-fg': fg,
    '--agentskin-input-bg': inputBg,
    '--agentskin-button-bg': accent,
    '--agentskin-focus-ring': toRgba(accent, dark ? 0.38 : 0.5),
    '--agentskin-selection': toRgba(accent, 0.32),
  };
}

/** Pull bg / fg / accent out of a snapshot's computed styles. */
function paletteFromSnapshot(snapshot: ThemeVisualSnapshot): {
  bg: string;
  fg: string;
  accent: string;
} {
  const find = (sel: string) => snapshot.landmarks.find((l) => l.selector === sel || l.tag === sel);
  const root = find(':root') || find('html') || snapshot.landmarks[0];
  const map = new Map((root?.styles ?? []).map((s) => [s.property, s.value]));
  const clean = (v: string | undefined) =>
    v && !/transparent|rgba\(0, 0, 0, 0\)/.test(v) ? v : undefined;
  const scan = (prop: string): string | undefined => {
    for (const l of snapshot.landmarks) {
      const f = l.styles.find((s) => s.property === prop && clean(s.value));
      if (f) return f.value;
    }
    return undefined;
  };
  const bg = clean(map.get('background-color')) || scan('background-color') || '#201a40';
  const fg = clean(map.get('color')) || scan('color') || '#e8e2ff';
  const accent = scan('border-color') || scan('outline') || bg;
  return { bg, fg, accent };
}

/** Build the full `--agentskin-*` token set sent to the export builder. */
export function buildStudioPalette(snapshot: ThemeVisualSnapshot): Record<string, string> {
  return buildSkinTokens(paletteFromSnapshot(snapshot));
}

// ---------------------------------------------------------------------------
// P4 helpers — merge user overrides into the skin token set (for export)
// ---------------------------------------------------------------------------

/** Maps a semantic palette key (or `--agentskin-*` key) to its token CSS var. */
const SKIN_TOKEN_MAP: Record<string, string> = {
  accent: '--agentskin-accent',
  secondary: '--agentskin-secondary',
  background: '--agentskin-bg',
  bg: '--agentskin-bg',
  foreground: '--agentskin-text',
  text: '--agentskin-text',
  surface: '--agentskin-surface',
  surfaceElevated: '--agentskin-surface-elevated',
  'surface-elevated': '--agentskin-surface-elevated',
  muted: '--agentskin-muted',
  border: '--agentskin-border',
  codeBackground: '--agentskin-code-bg',
  'code-bg': '--agentskin-code-bg',
  codeForeground: '--agentskin-code-fg',
  'code-fg': '--agentskin-code-fg',
  inputBackground: '--agentskin-input-bg',
  'input-bg': '--agentskin-input-bg',
  buttonBackground: '--agentskin-button-bg',
  'button-bg': '--agentskin-button-bg',
  focusRing: '--agentskin-focus-ring',
  'focus-ring': '--agentskin-focus-ring',
};

/**
 * Merge studio tool overrides into the base `--agentskin-*` token set produced
 * by {@link buildStudioPalette}. This is what makes a user's image-to-theme
 * palette, preset load, or toolbox tuning actually reach the exported
 * `.agentskin-theme` package — previously the export used the snapshot-default
 * palette and silently dropped every user edit.
 *
 * Priority: a full `colors` palette wins; otherwise the four role fields
 * (accent/background/foreground/surface) rebuild the token set via
 * {@link buildSkinTokens}.
 */
export function mergeOverridesToSkinTokens(
  base: Record<string, string>,
  overrides:
    | {
        colors?: Record<string, string>;
        accent?: string;
        background?: string;
        foreground?: string;
        surface?: string;
      }
    | null
    | undefined,
): Record<string, string> {
  if (!overrides) return base;
  const next = { ...base };

  if (overrides.colors && Object.keys(overrides.colors).length > 0) {
    for (const [rawKey, value] of Object.entries(overrides.colors)) {
      if (!value) continue;
      const norm = rawKey.startsWith('--agentskin-') ? rawKey.slice('--agentskin-'.length) : rawKey;
      const cssVar =
        SKIN_TOKEN_MAP[norm] ?? (rawKey.startsWith('--') ? rawKey : `--agentskin-${norm}`);
      next[cssVar] = value;
    }
    return next;
  }

  const bg = overrides.background ?? base['--agentskin-bg'];
  const fg = overrides.foreground ?? base['--agentskin-text'];
  const accent = overrides.accent ?? base['--agentskin-accent'];
  if (!bg && !fg && !accent) return base;
  return {
    ...base,
    ...buildSkinTokens({
      bg: bg || '#201a40',
      fg: fg || '#e8e2ff',
      accent: accent || bg || '#9d8bff',
    }),
  };
}
