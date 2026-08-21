// SPDX-License-Identifier: MPL-2.0
//
// # leonardo-wrapper.mjs — contrast-driven color generation for the 14-token system.
//
// Wraps `@adobe/leonardo-contrast-colors` (Theme / Color / BackgroundColor API)
// to generate WCAG-compliant palettes for AgentSkin's 14-token contract.
// All functions are pure: inputs in, token map out. No I/O, no side effects.

import { BackgroundColor, Color, Theme } from '@adobe/leonardo-contrast-colors';

// ---------------------------------------------------------------------------
// 14-token contract — maps each token to its target contrast ratio against
// the background. Positive ratios = darker than bg (light theme);
// negative ratios = lighter than bg (dark theme).
// ---------------------------------------------------------------------------

/** Default contrast ratios for light theme tokens (WCAG AA baseline). */
const LIGHT_TOKEN_RATIOS = {
  accent: 4.5,
  secondary: 3.0,
  background: 1.0,
  foreground: 12.0,
  muted: 4.5,
  surface: 1.05,
  surfaceElevated: 1.1,
  border: 1.5,
  codeBackground: 1.02,
  codeForeground: 10.0,
  inputBackground: 1.03,
  buttonBackground: 1.2,
  buttonForeground: 4.5,
  focusRing: 3.0,
};

/** Default contrast ratios for dark theme tokens. */
const DARK_TOKEN_RATIOS = {
  accent: 4.5,
  secondary: 3.0,
  background: 1.0,
  foreground: 14.0,
  muted: 5.5,
  surface: 1.4,
  surfaceElevated: 1.8,
  border: 2.0,
  codeBackground: 1.2,
  codeForeground: 12.0,
  inputBackground: 1.5,
  buttonBackground: 2.5,
  buttonForeground: 4.5,
  focusRing: 3.0,
};

/** Fallback palette when Leonardo fails on invalid input. */
const FALLBACK_PALETTE = {
  accent: '#4a90d9',
  secondary: '#7a8a99',
  background: '#1e1e1e',
  foreground: '#e0e0e0',
  muted: '#888888',
  surface: '#2a2a2a',
  surfaceElevated: '#333333',
  border: '#4a90d92e',
  codeBackground: '#161616',
  codeForeground: '#cdd6e0',
  inputBackground: '#2a2a2a',
  buttonBackground: '#4a90d918',
  buttonForeground: '#4a90d9',
  focusRing: '#4a90d960',
};

const TOKEN_KEYS = Object.keys(FALLBACK_PALETTE);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a hex color to valid 6-digit format.
 * @param {string} hex
 * @returns {string} normalized hex or '#000000' on failure.
 */
function safeHex(hex) {
  if (typeof hex !== 'string') return '#000000';
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#000000';
  if (m[1].length === 3) {
    const [r, g, b] = m[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return `#${m[1]}`.toLowerCase();
}

/**
 * Build a Leonardo Theme for a single named color with given ratios.
 * @param {string} name color name (e.g. 'accent')
 * @param {string} baseHex base color
 * @param {number[]} ratios target contrast ratios
 * @param {string} bgHex background color
 * @param {number} lightness 0-100
 * @returns {Theme|null}
 */
function buildSingleColorTheme(name, baseHex, ratios, bgHex, lightness) {
  try {
    const color = new Color({
      name,
      colorKeys: [baseHex],
      colorSpace: 'OKLCH',
      ratios,
      output: 'HEX',
    });

    const backgroundColor = new BackgroundColor({
      name: 'background',
      colorKeys: [bgHex],
      colorSpace: 'OKLCH',
      ratios: [1],
      output: 'HEX',
    });

    return new Theme({
      colors: [color],
      backgroundColor,
      lightness,
      contrast: 1,
      output: 'HEX',
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a 14-token palette from a base color using contrast-driven ratios.
 *
 * Uses Leonardo's Theme/Color API to compute each token's value at its target
 * contrast ratio against the derived background. Falls back to a safe default
 * palette if any step fails.
 *
 * @param {string} baseHex - Base accent color (e.g. '#6366f1').
 * @param {object} [options]
 * @param {number[]} [options.ratios] - Custom ratio map (partial override).
 * @param {'light'|'dark'} [options.theme='dark'] - Theme mode.
 * @param {string} [options.background] - Override background color.
 * @param {string} [options.foreground] - Override foreground color.
 * @param {number} [options.lightness=15] - Leonardo lightness (0-100).
 * @returns {{ accent: string, secondary: string, background: string, ... }}
 */
export function generate14TokenPalette(baseHex, options = {}) {
  const { theme = 'dark', lightness = 15 } = options;
  const base = safeHex(baseHex);

  if (base === '#000000') return { ...FALLBACK_PALETTE };

  const ratios =
    theme === 'light'
      ? { ...LIGHT_TOKEN_RATIOS, ...options.ratios }
      : { ...DARK_TOKEN_RATIOS, ...options.ratios };

  try {
    // Build color configs for all tokens that derive from the base.
    // foreground is included so Leonardo computes it at its target ratio
    // (14.0 dark / 12.0 light), giving different values per theme.
    const colorConfigs = TOKEN_KEYS.filter((k) => k !== 'background').map((name) => {
      const ratio = ratios[name] ?? 4.5;
      return new Color({
        name,
        colorKeys: [base],
        colorSpace: 'OKLCH',
        ratios: [ratio],
        output: 'HEX',
      });
    });

    const bgHex = options.background ?? (theme === 'light' ? '#ffffff' : '#0a0a0a');
    const backgroundColor = new BackgroundColor({
      name: 'background',
      colorKeys: [bgHex],
      colorSpace: 'OKLCH',
      ratios: [1],
      output: 'HEX',
    });

    // Light theme needs high lightness for Leonardo to produce dark tokens
    const themeLightness = theme === 'light' ? 100 : lightness;

    const themeObj = new Theme({
      colors: colorConfigs,
      backgroundColor,
      lightness: themeLightness,
      contrast: 1,
      output: 'HEX',
    });

    // Extract contrastColorPairs: { token100: '#xxx', ... }
    const pairs = themeObj.contrastColorPairs;
    const result = { ...FALLBACK_PALETTE };

    // Map Leonardo output keys back to token names
    for (const key of TOKEN_KEYS) {
      if (key === 'background') {
        result.background = pairs['background100'] ?? pairs['background25'] ?? bgHex;
        continue;
      }
      // Leonardo names like "accent100", "accent200" based on ratio order
      const match = Object.keys(pairs).find((k) => k.startsWith(key) && /\d+$/.test(k));
      if (match) {
        result[key] = pairs[match];
      }
    }

    // Ensure foreground has maximum contrast
    if (options.foreground) {
      result.foreground = safeHex(options.foreground);
    }

    return result;
  } catch {
    return { ...FALLBACK_PALETTE };
  }
}

/**
 * Suggest a foreground color that meets the target contrast ratio against
 * a given background. Uses Leonardo's contrast calculation to validate.
 *
 * @param {string} bgHex - Background color.
 * @param {number} [targetRatio=4.5] - Minimum WCAG contrast ratio.
 * @returns {string} A foreground hex color meeting the ratio.
 */
export function suggestForeground(bgHex, targetRatio = 4.5) {
  const bg = safeHex(bgHex);
  if (bg === '#000000') return '#e0e0e0';

  try {
    const bgLum = relativeLuminance(bg);
    const isLight = bgLum > 0.5;

    // Strategy: use the maximally-contrasting extreme (black for light
    // backgrounds, white for dark backgrounds), then lighten/darken it
    // just enough to land precisely on the target ratio.  Starting from
    // the extreme guarantees the result stays close to pure black/white
    // — the most readable choice — while still satisfying the target.
    //
    // WCAG contrast: CR = (L_lighter + 0.05) / (L_darker + 0.05)
    // Target foreground luminance to achieve exactly targetRatio:
    const idealFgLum = isLight
      ? (bgLum + 0.05) / targetRatio - 0.05 // need darker fg
      : targetRatio * (bgLum + 0.05) - 0.05; // need lighter fg

    // If the ideal lies outside [0, 1], the target is physically
    // impossible; return the extreme (best achievable contrast).
    if (idealFgLum <= 0) return '#000000';
    if (idealFgLum >= 1) return '#ffffff';

    return fineTuneForeground(bgLum, idealFgLum, isLight, targetRatio);
  } catch {
    return '#e0e0e0';
  }
}

/**
 * Find a grayscale hex on the given side of the ideal luminance that meets
 * the target contrast ratio.
 *
 * Search strategy: start from the extreme end (v=0 for light backgrounds,
 * v=255 for dark backgrounds) and move toward the ideal.  The extreme
 * always gives the maximum possible contrast, so if the target is
 * achievable the search finds the most readable result first (pure black
 * on light backgrounds, pure white on dark backgrounds).
 *
 * @param {number} bgLum - background relative luminance
 * @param {number} idealFgLum - ideal foreground luminance for exact target match
 * @param {boolean} isLight - true if bg is light (fg must be darker)
 * @param {number} targetRatio - minimum WCAG contrast ratio
 * @returns {string} grayscale hex
 */
function fineTuneForeground(bgLum, idealFgLum, isLight, targetRatio) {
  // Determine search range and direction
  // Light bg: fg must be dark → search v from 0 upward (black first)
  // Dark bg: fg must be light → search v from 255 downward (white first)
  const start = isLight ? 0 : 255;
  const step = isLight ? 1 : -1;

  // Search from the extreme inward, up to 256 steps (covers entire range)
  for (let i = 0; i <= 255; i++) {
    const v = start + step * i;
    if (v < 0 || v > 255) break;
    const hex = v.toString(16).padStart(2, '0');
    const fg = `#${hex}${hex}${hex}`;
    const fgLum = relativeLuminance(fg);
    const ratio = contrastRatio(bgLum, fgLum);
    if (ratio >= targetRatio) return fg;
  }

  // Fallback: target is physically impossible; return extreme (best contrast)
  return isLight ? '#000000' : '#ffffff';
}

/**
 * Generate a full Leonardo Theme with multiple named colors.
 *
 * @param {object} params
 * @param {string} params.base - Base color for all tokens.
 * @param {Array<{name: string, colorKeys: string[], ratios: number[]}>} [params.colorConfigs]
 * @param {number} [params.contrast=1] - Global contrast multiplier.
 * @param {number} [params.lightness=15] - Theme lightness (0-100).
 * @param {string} [params.light] - Light theme background.
 * @param {string} [params.dark] - Dark theme background.
 * @param {string} [params.output='HEX'] - Output color space.
 * @returns {object} Theme result with contrastColors and contrastColorPairs.
 */
export function generateLeonardoTheme(params) {
  const {
    base = '#6366f1',
    colorConfigs = [],
    contrast = 1,
    lightness = 15,
    light,
    dark,
    output = 'HEX',
  } = params;

  const baseSafe = safeHex(base);

  try {
    const colors = colorConfigs.map(
      (cfg) =>
        new Color({
          name: cfg.name || 'color',
          colorKeys: cfg.colorKeys || [baseSafe],
          colorSpace: cfg.colorSpace || 'OKLCH',
          ratios: cfg.ratios || [3, 4.5, 7],
          output: cfg.output || output,
        }),
    );

    // If no configs provided, create a default single-color theme
    if (colors.length === 0) {
      colors.push(
        new Color({
          name: 'primary',
          colorKeys: [baseSafe],
          colorSpace: 'OKLCH',
          ratios: [3, 4.5, 7],
          output,
        }),
      );
    }

    const bgHex = dark || light || '#0a0a0a';
    const backgroundColor = new BackgroundColor({
      name: 'background',
      colorKeys: [bgHex],
      colorSpace: 'OKLCH',
      ratios: [1],
      output,
    });

    const theme = new Theme({
      colors,
      backgroundColor,
      lightness,
      contrast,
      output,
    });

    return {
      contrastColors: theme.contrastColors,
      contrastColorPairs: theme.contrastColorPairs,
      contrastColorValues: theme.contrastColorValues,
    };
  } catch (err) {
    return {
      contrastColors: [{ background: bgHex }],
      contrastColorPairs: { background: bgHex },
      contrastColorValues: [bgHex],
      error: err.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal math helpers (pure, no dependencies)
// ---------------------------------------------------------------------------

/**
 * Compute relative luminance per WCAG 2.x.
 * @param {string} hex
 * @returns {number} 0-1
 */
function relativeLuminance(hex) {
  const h = safeHex(hex);
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;

  const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * Convert a relative luminance (0-1) to a grayscale hex.
 *
 * Applies the inverse WCAG gamma curve to map from linear luminance to
 * sRGB value, so that relativeLuminance(luminanceToHex(x)) ≈ x.
 *
 * @param {number} l - relative luminance, 0-1
 * @returns {string} hex color (e.g. '#808080')
 */
function luminanceToHex(l) {
  const lum = Math.max(0, Math.min(1, l));
  // Inverse gamma: linear -> sRGB
  const srgb = lum <= 0.0031308 ? lum * 12.92 : 1.055 * lum ** (1 / 2.4) - 0.055;
  const v = Math.round(Math.max(0, Math.min(1, srgb)) * 255);
  const hex = v.toString(16).padStart(2, '0');
  return `#${hex}${hex}${hex}`;
}

/**
 * WCAG contrast ratio between two relative luminances.
 * @param {number} l1
 * @param {number} l2
 * @returns {number}
 */
function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}
