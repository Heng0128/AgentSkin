// SPDX-License-Identifier: MPL-2.0

/**
 * # color-theory.mjs
 *
 * Pure functional color utilities for generating harmonious theme palettes
 * from agent profile token data. Designed to work identically in the browser
 * renderer and in Node.js scripts (e.g. build-theme-package.mjs).
 *
 * All functions accept / return 6-digit hex strings (e.g. `#a1b2c3`) and have
 * zero side-effects.
 */

// ---------------------------------------------------------------------------
// Internal converters — hex ⇄ rgb ⇄ hsl
// ---------------------------------------------------------------------------

/** Parse any hex string (3/4/6/8-digit, with/without #) to [r, g, b] 0-255. */
export function hexToRgb(hex) {
  let h = (hex || '').replace('#', '');
  if (!h) return null;
  if (h.length === 3 || h.length === 4)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
      .slice(0, 6);
  if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Format [r, g, b] as #rrggbb. */
export function rgbToHex(rgb) {
  if (!rgb || rgb.length < 3) return '#000000';
  return (
    '#' +
    rgb
      .slice(0, 3)
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/** Convert #hex → [h (0-360), s (0-1), l (0-1)]. */
export function hexToHsl(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return [0, 0, 0];
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return [h, s, l];
}

/** Convert [h (0-360), s (0-1), l (0-1)] → #hex. */
export function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

/** Convert #hex → [h (0-360), s (0-1), v (0-1)]. */
export function hexToHsv(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return [0, 0, 0];
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  return [h, s, v];
}

/** Pick black or white text for legibility over a hex background (WCAG 1.4.3). */
export function textOn(hex) {
  if (!hex) return '#ffffff';
  return relLuminance(hex) > 0.179 ? '#000000' : '#ffffff';
}

// ---------------------------------------------------------------------------
// Harmony generators — return arrays of HSL offsets
// ---------------------------------------------------------------------------

/** Complementary: base + (base + 180). */
export function complementary() {
  return [0, 180];
}

/** Split-complementary: base + 150, base + 210. */
export function splitComplementary() {
  return [0, 150, 210];
}

/** Triadic: base, base + 120, base + 240. */
export function triadic() {
  return [0, 120, 240];
}

/** Analogous: base - 30, base, base + 30. */
export function analogous() {
  return [-30, 0, 30];
}

/** Tetradic: base, base + 90, base + 180, base + 270. */
export function tetradic() {
  return [0, 90, 180, 270];
}

/** Monochromatic: same hue, 4 lightness steps. Returns [offsetH, saturation, lightness] patches. */
export function monochromatic() {
  return null; // handled specially
}

export const HARMONY_FNS = {
  complementary,
  splitComplementary,
  triadic,
  analogous,
  tetradic,
};

// ---------------------------------------------------------------------------
// Raw color derivation from a base hue
// ---------------------------------------------------------------------------

/**
 * Given a base hex and a harmony name, return an array of hex colors.
 * The base color's hue is used; saturation/lightness vary per harmony type.
 *
 * @param {string} baseHex
 * @param {keyof typeof HARMONY_FNS} harmony
 * @param {object} [opts]
 * @param {number} [opts.sat=0.55]  — peak saturation
 * @param {number} [opts.light=0.55] — peak lightness
 * @returns {string[]} hex strings
 */
export function harmonyPalette(baseHex, harmony, opts = {}) {
  const { sat = 0.55, light = 0.55 } = opts;
  const [h] = hexToHsl(baseHex);

  if (harmony === 'monochromatic') {
    return [0.3, 0.45, 0.55, 0.7].map((l) => hslToHex(h, sat * 0.8, l));
  }

  const offsets = HARMONY_FNS[harmony]?.();
  if (!offsets) return [baseHex];

  return offsets.map((off, i) => {
    // Vary lightness slightly among harmony members to create depth
    const lmod = (i % 2 === 0 ? 0 : 0.08) * (i % 3 === 2 ? -1 : 1);
    return hslToHex(h + off, sat, Math.max(0.15, Math.min(0.85, light + lmod)));
  });
}

// ---------------------------------------------------------------------------
// WCAG contrast
// ---------------------------------------------------------------------------

/** WCAG 2.1 relative luminance. */
export function relLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(hexA, hexB) {
  const la = relLuminance(hexA);
  const lb = relLuminance(hexB);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Semantic hue classification
// ---------------------------------------------------------------------------

/**
 * Classify a hex into a semantic role based on hue + saturation.
 * Returns one of: 'warm-red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'neutral'.
 */
export function classifyHue(hex) {
  const [h, s, l] = hexToHsl(hex);
  if (s < 0.08 || l < 0.08 || l > 0.95) return 'neutral';
  if (h < 15 || h >= 345) return 'warm-red';
  if (h < 40) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 165) return 'green';
  if (h < 195) return 'teal';
  if (h < 260) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/**
 * Score a 10-key palette (background, foreground, surface, border, accent,
 * muted, error, warning, success, info) out of 100.
 *
 * - Contrast score (0-50): WCAG ratios for key pairs.
 * - Harmony score (0-30): How well accent and semantic colors relate to background/hue.
 * - Semantic consistency (0-20): error must be warm-red, success green, info blue/teal.
 *
 * @param {Record<string, string>} palette
 * @returns {{ total: number, contrast: number, harmony: number, semantic: number }}
 */
export function scorePalette(palette) {
  const contrast = scoreContrast(palette);
  const harmony = scoreHarmony(palette);
  const semantic = scoreSemantic(palette);
  // Components are already weighted (contrast 0-50, harmony 0-30, semantic
  // 0-20 → max 100). Summing — NOT re-weighting by 0.5/0.3/0.2 — keeps the
  // documented 100-point scale so the AAA/AA/LOW badges are reachable.
  const total = Math.min(100, Math.round(contrast + harmony + semantic));
  return { contrast, harmony, semantic, total };
}

function scoreContrast(p) {
  let pts = 0;
  // Required pairs with WCAG thresholds
  const pairs = [
    { a: p.foreground, b: p.background, threshold: 4.5, weight: 18 },
    { a: p.accent, b: p.background, threshold: 3.0, weight: 12 },
    { a: p.surface, b: p.foreground, threshold: 3.0, weight: 8 },
    { a: p.muted, b: p.background, threshold: 3.0, weight: 6 },
    { a: p.error, b: p.background, threshold: 3.0, weight: 6 },
  ];
  for (const { a, b, threshold, weight } of pairs) {
    if (!a || !b) continue;
    const ratio = contrastRatio(a, b);
    if (ratio >= threshold) pts += weight;
    else pts += weight * Math.max(0, ratio / threshold);
  }
  return pts;
}

function scoreHarmony(p) {
  // Pick the accent hue and compare semantic colors for coherence.
  const [_accentH, accentS] = hexToHsl(p.accent || '#888888');
  if (accentS < 0.1) return 15; // neutral accent → acceptable but not exciting

  let pts = 25; // start generous
  const bgLum = relLuminance(p.background || '#141418');
  const dark = bgLum < 0.4;

  // Accent should be visible on background
  const accentContrast = contrastRatio(p.accent, p.background || '#141418');
  if (accentContrast < 2.5) pts -= 10;
  else if (accentContrast > 4) pts += 5;

  // Semantic colors shouldn't all desaturate into grey
  const scores = [p.error, p.warning, p.success, p.info].map((c) => hexToHsl(c || '#888')[1]);
  const avgSat = scores.reduce((a, b) => a + b, 0) / 4;
  if (avgSat < 0.15) pts -= 8;

  // Lightness range should be reasonable
  const _fL = dark ? 0.85 : 0.15;
  const fgLum = relLuminance(p.foreground || (dark ? '#e0e0e0' : '#1a1a1a'));
  const target = dark ? 0.7 : 0.2;
  pts -= Math.abs(fgLum - target) * 15;

  return Math.max(0, Math.min(30, pts));
}

function scoreSemantic(p) {
  let pts = 0;
  const ERROR_HUES = ['warm-red', 'orange'];
  const SUCCESS_HUES = ['green', 'teal'];
  const INFO_HUES = ['blue', 'teal', 'purple'];
  const WARNING_HUES = ['orange', 'yellow'];

  if (p.error && ERROR_HUES.includes(classifyHue(p.error))) pts += 6;
  else if (p.error) pts += 2;

  if (p.success && SUCCESS_HUES.includes(classifyHue(p.success))) pts += 6;
  else if (p.success) pts += 2;

  if (p.info && INFO_HUES.includes(classifyHue(p.info))) pts += 4;
  else if (p.info) pts += 1;

  if (p.warning && WARNING_HUES.includes(classifyHue(p.warning))) pts += 4;
  else if (p.warning) pts += 1;

  return Math.min(20, pts);
}

// ---------------------------------------------------------------------------
// Palette assembly
// ---------------------------------------------------------------------------

/**
 * Generate a full 10-key palette from a base hue, scheme preference, and
 * semantic override colors.
 *
 * @param {object} opts
 * @param {number} opts.baseHue        — 0-360
 * @param {'dark'|'light'} opts.scheme
 * @param {Record<string, string>} [opts.semanticOverrides] — pre-classified semantic colors from agent profile
 * @param {string} [opts.accentHint]   — optional hex to influence accent
 * @returns {Record<string,string>} palette compatible with agentskin tokens
 */
export function assemblePalette({ baseHue, scheme, semanticOverrides = {}, accentHint }) {
  const dark = scheme === 'dark';

  const bg = hslToHex(baseHue, dark ? 0.12 : 0.1, dark ? 0.07 : 0.97);
  const fg = hslToHex(baseHue, dark ? 0.12 : 0.1, dark ? 0.92 : 0.12);
  const surface = hslToHex(baseHue, dark ? 0.13 : 0.11, dark ? 0.12 : 0.94);
  const border = hslToHex(baseHue, dark ? 0.14 : 0.12, dark ? 0.22 : 0.85);
  const muted = hslToHex(baseHue, dark ? 0.1 : 0.09, dark ? 0.55 : 0.5);

  // Accent — use hint if provided, otherwise a vivid shift from background hue
  const accentHue = accentHint ? hexToHsl(accentHint)[0] : (baseHue + 30) % 360;
  const accent = accentHint || hslToHex(accentHue, 0.6, dark ? 0.6 : 0.5);

  // Semantic — prefer profile-synthesized colors, fall back to hue-based
  const error = semanticOverrides.error || hslToHex(5, 0.65, dark ? 0.55 : 0.5);
  const warning = semanticOverrides.warning || hslToHex(35, 0.7, dark ? 0.6 : 0.55);
  const success = semanticOverrides.success || hslToHex(145, 0.55, dark ? 0.55 : 0.45);
  const info = semanticOverrides.info || hslToHex(210, 0.6, dark ? 0.6 : 0.55);

  return {
    background: bg,
    foreground: fg,
    surface,
    border,
    accent,
    muted,
    error,
    warning,
    success,
    info,
  };
}

// ---------------------------------------------------------------------------
// Top-level: generate N palette proposals from a single profile
// ---------------------------------------------------------------------------

const HARMONY_KEYS = [
  'complementary',
  'splitComplementary',
  'triadic',
  'analogous',
  'tetradic',
  'monochromatic',
];

/**
 * Given an agent profile object (raw JSON), derive base hues from accent
 * colors in the palette, then generate `count` candidate palettes.
 *
 * @param {object} profile — loaded from agents-profiles/{id}-profile.json
 * @param {object} [opts]
 * @param {number} [opts.count=6]
 * @param {'dark'|'light'} [opts.scheme='dark']
 * @param {number} [opts.seed] — optional seed for deterministic output
 * @returns {Array<{ palette: Record<string,string>, score: object, harmony: string, sourceHue: number }>}
 */
export function generatePalettes(profile, opts = {}) {
  const { count = 6, scheme = 'dark', seed } = opts;

  const rng = mulberry32(seed ?? Math.floor(Math.random() * 2 ** 31));

  // Candidate accent hues harvested from the profile. These only anchor the
  // START hue; proposals are then spread evenly across the wheel so we always
  // emit `count` DISTINCT, visibly different palettes.
  const hues = extractHueCandidates(profile);
  const startHue = hues.length ? hues[Math.floor(rng() * hues.length)] : rng() * 360;

  const results = [];
  const seen = new Set();

  // Guarantee exactly `count` distinct proposals by spacing base hues evenly
  // (step = 360/count) with sub-step jitter. The old collision loop let the
  // near-grayscale background dominate the dedup key, so it could only ever
  // emit as many palettes as there were distinct candidate accents — usually
  // just 2 — no matter what `count` was requested.
  const step = 360 / Math.max(1, count);
  for (let i = 0; i < count; i++) {
    const baseHue = (startHue + i * step + (rng() - 0.5) * step * 0.8 + 360) % 360;

    const harmony = HARMONY_KEYS[Math.floor(rng() * HARMONY_KEYS.length)];
    const accentHint = hslToHex(baseHue, 0.65, scheme === 'dark' ? 0.62 : 0.5);

    const semanticOverrides = extractSemanticColors(profile, scheme);
    const palette = assemblePalette({
      baseHue,
      scheme,
      semanticOverrides,
      accentHint,
    });

    // Dedup safety net (rare now that hues are spread); key on the three
    // hue-bearing roles so near-identical palettes don't double up.
    const key = `${palette.background}|${palette.surface}|${palette.accent}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const s = scorePalette(palette);
    results.push({ palette, score: s, harmony, sourceHue: baseHue });
  }

  return results.sort((a, b) => b.score.total - a.score.total);
}

/**
 * Extract hue candidates from profile: accent tree, semantic accent vars,
 * and the core accent token.
 */
function extractHueCandidates(profile) {
  const hues = [];
  if (!profile) return hues;

  const tt = profile.tokenTree;
  if (!tt) return hues;

  // Core accent
  const coreDark = profile.tokens?.core?.dark?.accent;
  if (coreDark) {
    const hsl = hexToHsl(parseColorToHex(coreDark));
    if (hsl[1] > 0.1) hues.push(hsl[0]);
  }

  // Token tree accent category
  for (const scheme of ['dark', 'light', 'neutral']) {
    const accentArr = tt.accent?.[scheme];
    if (Array.isArray(accentArr)) {
      for (const e of accentArr.slice(0, 8)) {
        if (e.normalized && e.normalized.length >= 6) {
          const hsl = hexToHsl(`#${e.normalized}`);
          if (hsl[1] > 0.15) hues.push(hsl[0]);
        }
      }
    }
    const semanticArr = tt.semantic?.[scheme];
    if (Array.isArray(semanticArr)) {
      for (const e of semanticArr.slice(0, 5)) {
        if (e.normalized && e.normalized.length >= 6) {
          const hsl = hexToHsl(`#${e.normalized}`);
          if (hsl[1] > 0.1) hues.push(hsl[0]);
        }
      }
    }
  }

  return hues;
}

/**
 * Extract usable semantic colors (error/warning/success/info) from a profile
 * by classifying the normalized hex of semantic category entries.
 */
function extractSemanticColors(profile, _scheme) {
  const result = {};
  if (!profile) return result;
  const tt = profile.tokenTree;
  if (!tt) return result;

  const buckets = { error: [], warning: [], success: [], info: [] };
  for (const sch of ['dark', 'light', 'neutral']) {
    const entries = tt.semantic?.[sch];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (!e.normalized || e.normalized.length < 6) continue;
      const hex = `#${e.normalized}`;
      const cls = classifyHue(hex);
      if (buckets.error.length < 3 && (cls === 'warm-red' || cls === 'orange')) {
        buckets.error.push(hex);
      }
      if (buckets.warning.length < 3 && (cls === 'orange' || cls === 'yellow')) {
        buckets.warning.push(hex);
      }
      if (buckets.success.length < 3 && (cls === 'green' || cls === 'teal')) {
        buckets.success.push(hex);
      }
      if (buckets.info.length < 3 && (cls === 'blue' || cls === 'teal')) {
        buckets.info.push(hex);
      }
    }
  }

  if (buckets.error.length > 0) result.error = pickBest(buckets.error, 'error');
  if (buckets.warning.length > 0) result.warning = pickBest(buckets.warning, 'warning');
  if (buckets.success.length > 0) result.success = pickBest(buckets.success, 'success');
  if (buckets.info.length > 0) result.info = pickBest(buckets.info, 'info');

  return result;
}

function pickBest(colors, _role) {
  // Pick the most saturated one
  return colors.sort((a, b) => hexToHsl(b)[1] - hexToHsl(a)[1])[0];
}

/** Try to parse arbitrary CSS color value to hex (best-effort). */
function parseColorToHex(value) {
  if (!value) return '#888888';
  if (/^#/.test(value)) {
    const hex = value.slice(1);
    if (hex.length >= 6) return `#${hex.slice(0, 6)}`;
    if (hex.length === 3)
      return (
        '#' +
        hex
          .split('')
          .map((c) => c + c)
          .join('')
      );
  }
  const m = value.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(',').map(Number);
    if (parts.length >= 3 && !parts.slice(0, 3).some(Number.isNaN)) {
      return rgbToHex(parts.slice(0, 3));
    }
  }
  return '#888888';
}

/** Small seeded PRNG for deterministic palette generation. */
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
