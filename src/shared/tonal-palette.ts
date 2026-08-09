// SPDX-License-Identifier: MPL-2.0

/**
 * # Tonal Palette Generator
 *
 * Given a single accent color, derive a Material You–style 11-step tonal
 * palette (050–900–A*). Used by ImageToThemePanel's "衍生色阶" action to
 * expand a single user-chosen accent into a complete lightness ramp.
 *
 * ## Algorithm
 *
 * Material Design 3's color system uses HCT (Hue-Chroma-Tone), but for a
 * pure-TS implementation we approximate it with perceptual HSL + a
 * saturation attenuation curve:
 *
 *   1. Parse the input hex → HSL.
 *   2. For each tonal step T in {10, 20, …, 99}, map T → lightness via
 *      a perceptual-ish curve (not linear — HSL lightness is notoriously
 *      non-uniform).
 *   3. Scale saturation down at both extremes (very dark / very light
 *      steps desaturate towards grey).
 *   4. HSL → hex for the final swatch.
 *
 * The resulting palette is deterministic, monotonic in lightness, and
 * keeps the input hue within ±5° across all steps (well inside the
 * just-noticeable-difference threshold).
 *
 * Inspired by:
 *   - Material You / Material Design 3 color system
 *   - Adobe Leonardo's "themed color" generation
 *
 * Pure module — no I/O, no Electron deps. Lives in the shared layer
 * (src/shared) so both the main and renderer processes can import it
 * without a `@main` path alias.
 */

// ---------------------------------------------------------------------------
// Color conversion helpers (hex ↔ rgb ↔ hsl)
// ---------------------------------------------------------------------------

export interface HslColor {
  /** Hue in degrees [0, 360) */
  h: number;
  /** Saturation as fraction [0, 1] */
  s: number;
  /** Lightness as fraction [0, 1] */
  l: number;
}

export function hexToHsl(hex: string): HslColor {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;

  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToHex(c: HslColor): string {
  // Clamp inputs to valid range to guard against floating-point drift.
  const h = ((c.h % 360) + 360) % 360;
  const s = Math.min(1, Math.max(0, c.s));
  const l = Math.min(1, Math.max(0, c.l));

  const c_ = (1 - Math.abs(2 * l - 1)) * s;
  const x = c_ * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c_ / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c_, x, 0];
  else if (h < 120) [r, g, b] = [x, c_, 0];
  else if (h < 180) [r, g, b] = [0, c_, x];
  else if (h < 240) [r, g, b] = [0, x, c_];
  else if (h < 300) [r, g, b] = [x, 0, c_];
  else [r, g, b] = [c_, 0, x];

  const toHex = (v: number) => {
    const rounded = Math.round((v + m) * 255);
    return Math.min(255, Math.max(0, rounded)).toString(16).padStart(2, '0');
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace('#', '').trim();
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const n = parseInt(expanded.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

// ---------------------------------------------------------------------------
// Tonal palette contract
// ---------------------------------------------------------------------------

/** MD3 tonal step stops. 0 and 100 are pure black/white by spec — we expose
 *  the 11 usable stops that map to real colored swatches. */
export const TONAL_STEPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99] as const;
export type TonalStep = (typeof TONAL_STEPS)[number];

/** Generated palette: map of tonal step → hex color string. */
export type TonalPalette = Record<TonalStep, string>;

// ---------------------------------------------------------------------------
// Perceptual lightness lookup
// ---------------------------------------------------------------------------
//
// A fixed lookup table (calibrated against MD3's M3-Reference-Palette) gives
// predictable semantics: step 50 lands near L≈0.5 (intuitive "mid"), step 99
// near 0.97 (bright but not pure white), step 10 near 0.10 (dark but not
// pure black). A pow curve was tried but produced unpredictable mappings
// (e.g. #808080 landed closest to step 30, not 50).

const STEP_TO_LIGHTNESS: Record<TonalStep, number> = {
  10: 0.105,
  20: 0.175,
  30: 0.255,
  40: 0.345,
  50: 0.455,
  60: 0.565,
  70: 0.675,
  80: 0.775,
  90: 0.865,
  95: 0.925,
  99: 0.975,
};

// ---------------------------------------------------------------------------
// Saturation attenuation
// ---------------------------------------------------------------------------
//
// Human vision is less sensitive to saturation at brightness extremes. To
// mimic Material You's "desaturate to neutral at 050 and 990", scale the
// base saturation down parabolically as |L − 0.5| grows.

function attenuatedSaturation(baseSat: number, lightness: number): number {
  const distFromMid = Math.abs(lightness - 0.5) * 2; // 0 at mid, 1 at extremes
  const factor = 1 - 0.45 * distFromMid * distFromMid;
  return baseSat * factor;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive an 11-step tonal palette from a single accent hex.
 *
 * @param inputHex  Any valid CSS hex string (#RGB, #RRGGBB, case-insensitive).
 * @returns         A `TonalPalette` with 11 stops from 100 (dark) to 990 (light).
 *
 * The input color总是会出现在最接近的 step 中（由 ImageToThemePanel 选择
 * 命中 step；不强制重写该 step 以保留用户原始输入的任何细微差别）。
 */
export function deriveTonalPalette(inputHex: string): TonalPalette {
  const { h, s, l: _l } = hexToHsl(inputHex);
  const palette = {} as TonalPalette;

  for (const step of TONAL_STEPS) {
    const lightness = STEP_TO_LIGHTNESS[step as TonalStep];
    const sat = attenuatedSaturation(s, lightness);
    palette[step as TonalStep] = hslToHex({ h, s: sat, l: lightness });
  }

  return palette;
}

/**
 * Convenience: derive the palette & return as an ordered array of swatch
 * objects (step + hex), sorted from darkest to lightest. Handy for canvas
 * stripe rendering.
 */
export function toSwatchStrip(palette: TonalPalette): Array<{ step: TonalStep; hex: string }> {
  return TONAL_STEPS.map((step) => ({ step, hex: palette[step] }));
}

/**
 * Pick the tonal step whose hex is perceptually closest to the user input.
 * Used to highlight the "source step" in the UI when rendering the strip.
 */
export function closestStep(palette: TonalPalette, targetHex: string): TonalStep {
  const target = hexToHsl(targetHex);
  let bestStep: TonalStep = 50;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const step of TONAL_STEPS) {
    const c = hexToHsl(palette[step]);
    // Handle hue wrapping: distance between 359° and 1° should be 2°, not 358°
    const rawDh = Math.abs(c.h - target.h);
    const dh = Math.min(rawDh, 360 - rawDh) / 360;
    const ds = Math.abs(c.s - target.s);
    const dl = Math.abs(c.l - target.l);
    // Weight lightness heavily (human vision is most sensitive to L).
    const dist = dh + ds + dl * 3;
    if (dist < bestDist) {
      bestDist = dist;
      bestStep = step as TonalStep;
    }
  }
  return bestStep;
}
