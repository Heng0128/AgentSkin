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
