// SPDX-License-Identifier: MPL-2.0

/**
 * # snapshot-to-override
 *
 * Extracts a ToolOverride baseline from a CDP theme snapshot.
 * Pure function — no side effects, fully unit-testable.
 */

import type { ThemeVisualLandmark, ThemeVisualSnapshot } from '@shared/types';
import type { ToolOverride } from '@shared/types/override';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Find the first style value matching one of the given property names. */
function findStyle(landmark: ThemeVisualLandmark, ...props: string[]): string | undefined {
  for (const { property, value } of landmark.styles) {
    if (props.includes(property)) return value;
  }
  return undefined;
}

/** Parse a CSS length value (e.g. "14px", "1.2rem") and return the numeric part. */
function parsePx(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^([\d.]+)px$/);
  if (match) return Number.parseFloat(match[1]);
  return undefined;
}

/** Extract the primary font family from a CSS font-family value (first in comma list). */
function primaryFontFamily(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const first = value
    .split(',')[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, '');
  return first || undefined;
}

/** Check if a string looks like a CSS color (hex/rgb/hsl/named). */
function isColorValue(value: string): boolean {
  const v = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^(?:rgb|rgba|hsl|hsla)\(/i.test(v) || /^[a-z]+$/.test(v);
}

/** Extract the first color from a box-shadow value (e.g. "0 2px 8px rgba(0,0,0,.15)" → "rgba(0,0,0,.15)"). */
function extractColorFromShadow(shadow: string): string | undefined {
  const match = shadow.match(/(?:rgb|rgba|hsl|hsla)\([^)]+\)|#[0-9a-f]{3,8}/i);
  return match?.[0];
}

// ---------------------------------------------------------------------------
// Individual extractors
// ---------------------------------------------------------------------------

/** Background → body/:root background-color. */
export function pickBackground(snap: ThemeVisualSnapshot): string | undefined {
  for (const lm of snap.landmarks) {
    if (lm.selector === 'body' || lm.selector === ':root' || lm.selector === 'html') {
      const bg = findStyle(lm, 'background-color') ?? findStyle(lm, 'background');
      if (bg && isColorValue(bg)) return bg;
    }
  }
  // Fallback: first landmark with a valid background-color.
  for (const lm of snap.landmarks) {
    const bg = findStyle(lm, 'background-color');
    if (bg && isColorValue(bg)) return bg;
  }
  return undefined;
}

/** Foreground → body/:root color. */
export function pickForeground(snap: ThemeVisualSnapshot): string | undefined {
  for (const lm of snap.landmarks) {
    if (lm.selector === 'body' || lm.selector === ':root' || lm.selector === 'html') {
      const fg = findStyle(lm, 'color');
      if (fg) return fg;
    }
  }
  // Fallback: first landmark with a color.
  for (const lm of snap.landmarks) {
    const fg = findStyle(lm, 'color');
    if (fg) return fg;
  }
  return undefined;
}

/** Accent → border-color or color extracted from box-shadow. */
export function pickAccent(snap: ThemeVisualSnapshot): string | undefined {
  // Prefer interactive / accent-prone selectors.
  const preferred = [
    '.chat-input-box',
    '.agent-card',
    '.accent',
    '[data-accent]',
    'button',
    '.btn',
  ];
  for (const sel of preferred) {
    const lm = snap.landmarks.find((l) => l.selector === sel);
    if (lm) {
      const border = findStyle(lm, 'border-color');
      if (border && isColorValue(border)) return border;
      const shadow = findStyle(lm, 'box-shadow');
      if (shadow) {
        const color = extractColorFromShadow(shadow);
        if (color) return color;
      }
    }
  }
  // Fallback: any landmark with a valid border-color.
  for (const lm of snap.landmarks) {
    const border = findStyle(lm, 'border-color');
    if (border && isColorValue(border)) return border;
  }
  return undefined;
}

/** Most common border-radius across all landmarks. */
export function modeBorderRadius(snap: ThemeVisualSnapshot): string | undefined {
  const counts = new Map<string, number>();
  for (const lm of snap.landmarks) {
    const v = findStyle(lm, 'border-radius');
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

/** Most common font-family across all landmarks. */
export function modeFontFamily(snap: ThemeVisualSnapshot): string | undefined {
  const counts = new Map<string, number>();
  for (const lm of snap.landmarks) {
    const raw = findStyle(lm, 'font-family');
    const fam = primaryFontFamily(raw);
    if (fam) counts.set(fam, (counts.get(fam) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [val, count] of counts) {
    if (count > bestCount) {
      best = val;
      bestCount = count;
    }
  }
  return best;
}

/** Average font-size across all landmarks, rounded to nearest 2px. */
export function averageFontSize(snap: ThemeVisualSnapshot): number | undefined {
  const sizes: number[] = [];
  for (const lm of snap.landmarks) {
    const px = parsePx(findStyle(lm, 'font-size'));
    if (px !== undefined) sizes.push(px);
  }
  if (sizes.length === 0) return undefined;
  const avg = sizes.reduce((a, b) => a + b, 0) / sizes.length;
  return Math.round(avg / 2) * 2;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Extract override baseline from snapshot.
 *
 * Strategy:
 * 1. Background → landmarks[body/:root].styles['background-color']
 * 2. Foreground → landmarks[body/:root].styles['color']
 * 3. Accent → landmarks[.chat-input-box/.agent-card].styles['border-color' or 'box-shadow']
 * 4. Radius → most common border-radius across all landmarks
 * 5. Font family → most common font-family
 * 6. Font size → average font-size (rounded to nearest 2px)
 */
export function extractOverrideFromSnapshot(snap: ThemeVisualSnapshot): ToolOverride {
  const override: ToolOverride = {};

  const bg = pickBackground(snap);
  if (bg) override.background = bg;

  const fg = pickForeground(snap);
  if (fg) override.foreground = fg;

  const accent = pickAccent(snap);
  if (accent) override.accent = accent;

  const radius = modeBorderRadius(snap);
  if (radius) override.radius = radius;

  const fontFam = modeFontFamily(snap);
  if (fontFam) override.fontFam = fontFam;

  const fontSize = averageFontSize(snap);
  if (fontSize !== undefined) override.fontSize = fontSize;

  return override;
}
