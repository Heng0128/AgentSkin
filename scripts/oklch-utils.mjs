// SPDX-License-Identifier: MPL-2.0
//
// # oklch-utils.mjs — OKLCH color space conversions and perceptual adjustments.
//
// Pure functions for converting between HEX and OKLCH, and for manipulating
// colors in OKLCH space (lightness, hue, chroma). Used by the Leonardo
// wrapper and theme generators for perceptually uniform color operations.
//
// No external dependencies — all math is implemented directly to avoid
// adding `colord` as a project dependency.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EPSILON = 216 / 24389; // 0.008856...
const KAPPA = 24389 / 27; // 903.3...

// D65 white point
const D65_X = 0.95047;
const D65_Y = 1.0;
const D65_Z = 1.08883;

// ---------------------------------------------------------------------------
// HEX ↔ RGB
// ---------------------------------------------------------------------------

/**
 * Normalize any hex input to 6-digit lowercase hex.
 * @param {string} hex
 * @returns {string} e.g. '#ff8800'
 * @throws {Error} on invalid input
 */
export function normalizeHex(hex) {
  if (typeof hex !== 'string') {
    throw new Error(`Expected string, got ${typeof hex}`);
  }
  const raw = hex.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (m) return `#${m[1].toLowerCase()}`;
  m = /^#([0-9a-f]{3})$/i.exec(raw);
  if (m) {
    const [r, g, b] = m[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  m = /^([0-9a-f]{6})$/i.exec(raw);
  if (m) return `#${m[1].toLowerCase()}`;
  throw new Error(`Invalid hex color: ${hex}`);
}

/**
 * HEX → RGB [r, g, b] with values 0-255.
 * @param {string} hex
 * @returns {[number, number, number]}
 */
export function hexToRgb(hex) {
  const h = normalizeHex(hex);
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/**
 * RGB [r, g, b] (0-255) → HEX.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string} e.g. '#ff8800'
 */
export function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v) => clamp(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ---------------------------------------------------------------------------
// RGB ↔ Linear RGB (gamma decode/encode)
// ---------------------------------------------------------------------------

/**
 * sRGB gamma decode: 0-255 → 0-1 linear.
 * @param {number} c - 0-255
 * @returns {number} 0-1
 */
function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/**
 * sRGB gamma encode: 0-1 linear → 0-255.
 * @param {number} c - 0-1
 * @returns {number} 0-255
 */
function linearToSrgb(c) {
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return s * 255;
}

// ---------------------------------------------------------------------------
// Linear RGB ↔ XYZ (D65)
// ---------------------------------------------------------------------------

/**
 * Linear RGB → XYZ (D65).
 * @param {number} lr - linear red 0-1
 * @param {number} lg - linear green 0-1
 * @param {number} lb - linear blue 0-1
 * @returns {[number, number, number]} XYZ
 */
function linearRgbToXyz(lr, lg, lb) {
  const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
  const y = 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb;
  const z = 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb;
  return [x, y, z];
}

/**
 * XYZ (D65) → Linear RGB.
 * @param {number} x
 * @param {number} y
 * @number {number} z
 * @returns {[number, number, number]} linear RGB 0-1
 */
function xyzToLinearRgb(x, y, z) {
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [lr, lg, lb];
}

// ---------------------------------------------------------------------------
// XYZ ↔ OKLAB
// ---------------------------------------------------------------------------

/**
 * XYZ → OKLAB.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @returns {[number, number, number]} L (0-1), a, b
 */
function xyzToOklab(x, y, z) {
  // Normalize by D65
  const l_ = Math.cbrt(x / D65_X);
  const m_ = Math.cbrt(y / D65_Y);
  const s_ = Math.cbrt(z / D65_Z);

  const l = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  return [l, a, b];
}

/**
 * OKLAB → XYZ.
 * @param {number} l
 * @param {number} a
 * @param {number} b
 * @returns {[number, number, number]} XYZ
 */
function oklabToXyz(l, a, b) {
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const x = D65_X * l3;
  const y = D65_Y * m3;
  const z = D65_Z * s3;

  return [x, y, z];
}

// ---------------------------------------------------------------------------
// OKLAB ↔ OKLCH
// ---------------------------------------------------------------------------

/**
 * OKLAB → OKLCH.
 * @param {number} l - lightness 0-1
 * @param {number} a
 * @param {number} b
 * @returns {[number, number, number]} L (0-1), C (0-0.4), H (0-360)
 */
function oklabToOklch(l, a, b) {
  const c = Math.sqrt(a * a + b * b);
  let h = Math.atan2(b, a) * (180 / Math.PI);
  if (h < 0) h += 360;
  return [l, c, h];
}

/**
 * OKLCH → OKLAB.
 * @param {number} l
 * @param {number} c
 * @param {number} h
 * @returns {[number, number, number]} L, a, b
 */
function oklchToOklab(l, c, h) {
  const hRad = h * (Math.PI / 180);
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  return [l, a, b];
}

// ---------------------------------------------------------------------------
// Public API: HEX ↔ OKLCH
// ---------------------------------------------------------------------------

/**
 * Convert HEX color to OKLCH array.
 *
 * @param {string} hex - Color in hex format (e.g. '#6366f1').
 * @returns {[number, number, number]} [L (0-1), C (0-0.4), H (0-360)].
 */
export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const [x, y, z] = linearRgbToXyz(lr, lg, lb);
  const [l, a, b_] = xyzToOklab(x, y, z);
  return oklabToOklch(l, a, b_);
}

/**
 * Convert OKLCH values to HEX color.
 *
 * @param {number} l - Lightness (0-1).
 * @param {number} c - Chroma (0-0.4).
 * @param {number} h - Hue (0-360).
 * @returns {string} Hex color string.
 */
export function oklchToHex(l, c, h) {
  // Gamut mapping: binary-search for the maximum chroma that stays within sRGB.
  // OKLCH chroma at high values can produce colors outside the sRGB triangle;
  // clamping RGB post-conversion silently destroys hue (e.g. → #ffffff).
  let lo = 0;
  let hi = c;
  const [okl, aFull, bFull] = oklchToOklab(l, c, h);

  // Check if full chroma fits; if so skip the search
  const [x0, y0, z0] = oklabToXyz(okl, aFull, bFull);
  const [lr0, lg0, lb0] = xyzToLinearRgb(x0, y0, z0);
  if (
    lr0 >= -1e-6 &&
    lr0 <= 1 + 1e-6 &&
    lg0 >= -1e-6 &&
    lg0 <= 1 + 1e-6 &&
    lb0 >= -1e-6 &&
    lb0 <= 1 + 1e-6
  ) {
    const r = linearToSrgb(lr0);
    const g = linearToSrgb(lg0);
    const bl = linearToSrgb(lb0);
    return rgbToHex(r, g, bl);
  }

  // Binary search for max in-gamut chroma (10 iterations → ~0.1% precision)
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    const [aMid, bMid] = [aFull * (mid / c), bFull * (mid / c)];
    const [x1, y1, z1] = oklabToXyz(okl, aMid, bMid);
    const [lr1, lg1, lb1] = xyzToLinearRgb(x1, y1, z1);
    if (
      lr1 >= -1e-6 &&
      lr1 <= 1 + 1e-6 &&
      lg1 >= -1e-6 &&
      lg1 <= 1 + 1e-6 &&
      lb1 >= -1e-6 &&
      lb1 <= 1 + 1e-6
    ) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const finalC = lo;
  const [a2, b2] = [aFull * (finalC / c), bFull * (finalC / c)];
  const [x2, y2, z2] = oklabToXyz(okl, a2, b2);
  const [lr2, lg2, lb2] = xyzToLinearRgb(x2, y2, z2);
  const r = linearToSrgb(lr2);
  const g = linearToSrgb(lg2);
  const bl = linearToSrgb(lb2);
  return rgbToHex(r, g, bl);
}

// ---------------------------------------------------------------------------
// Public API: OKLCH adjustments
// ---------------------------------------------------------------------------

/**
 * Adjust lightness of a color in OKLCH space (perceptually uniform).
 *
 * @param {string} hex - Input color.
 * @param {number} deltaL - Lightness delta (-1 to 1, e.g. +0.1 = lighter).
 * @returns {string} Adjusted hex color.
 */
export function adjustLightness(hex, deltaL) {
  try {
    const [l, c, h] = hexToOklch(hex);
    const newL = Math.max(0, Math.min(1, l + deltaL));
    return oklchToHex(newL, c, h);
  } catch {
    return hex;
  }
}

/**
 * Rotate hue of a color in OKLCH space (preserves perceived saturation).
 *
 * @param {string} hex - Input color.
 * @param {number} deltaH - Hue rotation in degrees (e.g. 30 = shift 30°).
 * @returns {string} Adjusted hex color.
 */
export function rotateHue(hex, deltaH) {
  try {
    const [l, c, h] = hexToOklch(hex);
    let newH = (h + deltaH) % 360;
    if (newH < 0) newH += 360;
    return oklchToHex(l, c, newH);
  } catch {
    return hex;
  }
}

/**
 * Adjust chroma (saturation) of a color in OKLCH space.
 *
 * @param {string} hex - Input color.
 * @param {number} deltaC - Chroma delta (e.g. +0.05 = more saturated).
 * @returns {string} Adjusted hex color.
 */
export function adjustChroma(hex, deltaC) {
  try {
    const [l, c, h] = hexToOklch(hex);
    const newC = Math.max(0, Math.min(0.4, c + deltaC));
    return oklchToHex(l, newC, h);
  } catch {
    return hex;
  }
}

// ---------------------------------------------------------------------------
// Public API: Color ramp generation
// ---------------------------------------------------------------------------

/**
 * Generate a perceptual lightness ramp (50-900) in OKLCH space.
 *
 * Lightness values are distributed to match Material Design's 50-900 scale,
 * interpolated in OKLCH for perceptual uniformity.
 *
 * @param {string} hex - Base color.
 * @returns {{ 50: string, 100: string, ..., 900: string }} Ramp map.
 */
export function generateRamp(hex) {
  let l, c, h;
  try {
    [l, c, h] = hexToOklch(hex);
  } catch {
    const empty = {};
    for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]) {
      empty[step] = hex;
    }
    return empty;
  }

  // Generate ramp with monotonically increasing perceptual luminance from
  // step 50 (darkest) to step 900 (lightest). The base color lands at step 500.
  // For light base colors (L > 0.6), the curve is inverted so the base sits
  // at the light end and darker steps extend below it.
  const stepOrder = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

  // Fixed lightness anchors: step 50 = darkest, step 900 = lightest
  // These are inverted from the "tint" convention - here step 50 is dark
  const darkAnchors = { 50: 0.05, 100: 0.1, 200: 0.2, 300: 0.35, 400: 0.5 };

  const targets = {};
  for (const step of [50, 100, 200, 300, 400]) {
    targets[step] = darkAnchors[step];
  }

  // Step 500 = base lightness, clamped to stay above step 400
  targets[500] = Math.max(l, darkAnchors[400] + 0.02);

  // Steps 600-900: progressively lighter than the base
  targets[600] = Math.min(0.98, targets[500] + 0.12);
  targets[700] = Math.min(0.98, targets[600] + 0.1);
  targets[800] = Math.min(0.98, targets[700] + 0.1);
  targets[900] = Math.min(0.98, targets[800] + 0.1);

  const ramp = {};
  for (const step of stepOrder) {
    const targetL = targets[step];
    const distFromBase = Math.abs(targetL - l);
    const chromaScale = Math.max(0.3, 1 - distFromBase);
    const stepC = Math.min(0.4, c * chromaScale);
    ramp[step] = oklchToHex(targetL, stepC, h);
  }

  return ramp;
}
