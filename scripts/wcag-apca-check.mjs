// SPDX-License-Identifier: MPL-2.0
//
// # wcag-apca-check.mjs
//
// Validates `manifest.colors.foreground` against `colors.background` using
// both WCAG 2.1 (ratio) and APCA (Lc) methods. Also walks any `extended`
// colors and verifies auto-generated on-color contrast. All functions are
// pure: a manifest in, structured result out.

import { apcaContrast, autoOnColor, contrastRatio } from './extended-colors.mjs';

// ---------------------------------------------------------------------------
// Thresholds (WCAG 2.1 + APCA common text body reference)
// ---------------------------------------------------------------------------

/** AA: normal-text minimum ratio per WCAG 2.1 SC 1.4.3. */
const WCAG_AA_RATIO = 4.5;

/** Decorative/large-text minimum ratio per WCAG 2.1 SC 1.4.3.
 *  Used when a theme declares `_wcag.level = 'decorative'` to opt into a
 *  relaxed contrast standard (large text / decorative elements). */
const WCAG_DECORATIVE_RATIO = 3.0;

/** AAA: normal-text minimum ratio per WCAG 2.1 SC 1.4.6. */
const WCAG_AAA_RATIO = 7.0;

/** Critical threshold — below this ratio text is essentially unreadable. */
const CRITICAL_RATIO = 2.0;

/** APCA Lc — body text minimum (≈ 75 Lc is the published reference baseline,
 *  but 60 Lc is widely used as the "good enough" pragmatic floor). */
const APCA_LC60 = 60;

/** APCA Lc — strong body text comfortably perceptible. */
const APCA_LC90 = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pick the declared level from `manifest.colors._wcag.level`.
 * Falls back to 'AA' when the key is absent (per manifesto schema default).
 *
 * Supported levels:
 *   - 'AA' (default) → 4.5:1 normal-text standard
 *   - 'AAA'          → 7.0:1 enhanced standard
 *   - 'none'         → skip contrast check entirely
 *   - 'decorative'   → 3.0:1 large-text / decorative standard
 *
 * @param {Record<string, any>} colors
 * @returns {'AA' | 'AAA' | 'none' | 'decorative'}
 */
function resolveLevel(colors) {
  const lvl = colors?._wcag?.level;
  if (lvl === 'AAA' || lvl === 'none' || lvl === 'decorative') return lvl;
  return 'AA';
}

/**
 * Return the minimum contrast ratio required for a given WCAG level.
 *
 * @param {'AA' | 'AAA' | 'none' | 'decorative'} level
 * @returns {number} Minimum contrast ratio for the level.
 */
function ratioForLevel(level) {
  if (level === 'AAA') return WCAG_AAA_RATIO;
  if (level === 'decorative') return WCAG_DECORATIVE_RATIO;
  return WCAG_AA_RATIO;
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Validate foreground/background contrast.
 *
 * The pass/fail threshold is determined by `manifest.colors._wcag.level`:
 *   - 'AA' (default) → 4.5:1
 *   - 'AAA'          → 7.0:1
 *   - 'decorative'   → 3.0:1
 *   - 'none'         → returns null (skip check)
 *
 * @param {Record<string, any>} manifest
 *   Manifest-shaped object; reads `manifest.colors.{foreground,background,_wcag}`.
 * @returns {{ wcag: { ratio: number, passesAA: boolean, passesAAA: boolean },
 *             apca: { lc: number, passesLc60: boolean, passesLc90: boolean },
 *             level: 'AA' | 'AAA' | 'decorative' } | null}
 *   Returns `null` when level==='none' or either color is missing.
 */
export function checkThemeContrast(manifest) {
  const colors = manifest?.colors;
  if (!colors?.background || !colors.foreground) return null;

  const level = resolveLevel(colors);
  if (level === 'none') return null;

  const ratio = contrastRatio(colors.foreground, colors.background);
  const lc = Math.round(apcaContrast(colors.foreground, colors.background));

  // passesAA uses the level-aware threshold (4.5 for AA, 3.0 for decorative).
  const passesAA = ratio >= ratioForLevel(level);
  const passesAAA = ratio >= WCAG_AAA_RATIO;
  const passesLc60 = lc >= APCA_LC60;
  const passesLc90 = lc >= APCA_LC90;

  return {
    wcag: { ratio: Math.round(ratio * 100) / 100, passesAA, passesAAA },
    apca: { lc, passesLc60, passesLc90 },
    level,
  };
}

/**
 * Walk any `manifest.colors.extended` entries and verify each extended color
 * against its auto-generated on-color via `autoOnColor(hex)` (luminance > 0.45
 * → black text, else white text). This matches the runtime engine's
 * `--agentskin-ext-on-*` derivation in `extended-colors.mjs` exactly.
 *
 * Uses the same level-aware threshold as `checkThemeContrast` so that
 * decorative themes are not penalized for lower-contrast accent colors.
 *
 * @param {Record<string, any>} manifest
 * @returns {Array<{ name: string, fg: string, bg: string, ratio: number,
 *                   passesAA: boolean }>}
 *   Empty array when `extended` is absent or level==='none'.
 */
export function checkExtendedContrast(manifest) {
  const colors = manifest?.colors;
  if (!colors?.background || !colors.foreground) return [];

  const level = resolveLevel(colors);
  if (level === 'none') return [];

  const ext = colors.extended;
  if (!ext || typeof ext !== 'object') return [];

  // Use the same algorithm as the runtime engine (extended-colors.mjs autoOnColor)
  // to ensure CI validation matches actual generated --agentskin-ext-on-* values.
  const onFor = autoOnColor;
  const requiredRatio = ratioForLevel(level);

  const out = [];
  for (const [name, hex] of Object.entries(ext)) {
    if (typeof hex !== 'string') continue;
    const onColor = onFor(hex);
    const ratio = contrastRatio(hex, onColor);
    out.push({
      name,
      fg: hex,
      bg: onColor,
      ratio: Math.round(ratio * 100) / 100,
      passesAA: ratio >= requiredRatio,
    });
  }
  return out;
}

/**
 * Format a `checkThemeContrast` result into a human-readable string.
 *
 * @param {ReturnType<typeof checkThemeContrast> |
 *         ReturnType<typeof checkExtendedContrast>} result
 * @returns {string}
 */
export function formatContrastReport(result) {
  if (result === null) return 'WCAG/APCA — level=none, skipped.';

  // Extended-contrast array path
  if (Array.isArray(result)) {
    if (result.length === 0) return 'Extended colors — none declared.';
    const lines = result.map(
      (r) =>
        `  ${r.name.padEnd(12)} ${r.fg} on ${r.bg}  ${r.ratio.toFixed(2)}:1  ${r.passesAA ? 'AA ok' : 'AA FAIL'}`,
    );
    return [`Extended-color contrast (${result.length}):`, ...lines].join('\n');
  }

  // Single theme path
  const { wcag, level } = result;
  const wcagStatus =
    level === 'AAA' ? (wcag.passesAAA ? 'PASS' : 'FAIL') : wcag.passesAA ? 'PASS' : 'FAIL';
  return [
    `Foreground/Background contrast`,
    `  WCAG 2.1 ratio : ${wcag.ratio}:1  (level ${level})  ${wcagStatus}`,
  ].join('\n');
}

/**
 * Assert that `manifest.colors.foreground` / `background` fulfill the declared
 * WCAG level. Throws when they don't; does nothing otherwise.
 *
 * The threshold is level-aware: decorative themes only need 3.0:1, while
 * AA (default) requires 4.5:1 and AAA requires 7.0:1.
 *
 * @param {Record<string, any>} manifest
 * @returns {void}
 * @throws {Error}
 */
export function assertContrast(manifest) {
  const r = checkThemeContrast(manifest);
  if (r === null) return; // level=none or colors missing → not assertable
  const { wcag, level } = r;
  if (level === 'AAA' && !wcag.passesAAA)
    throw new Error(
      `WCAG AAA contrast requirement not met (ratio ${wcag.ratio}:1 < ${WCAG_AAA_RATIO}:1)`,
    );
  if (!wcag.passesAA)
    throw new Error(
      `WCAG ${level} contrast requirement not met (ratio ${wcag.ratio}:1 < ${ratioForLevel(level)}:1)`,
    );
}

// ---------------------------------------------------------------------------
// Tiered contrast classification
// ---------------------------------------------------------------------------

/**
 * Classify a contrast ratio into a severity tier.
 *
 * @param {number} ratio - WCAG 2.1 contrast ratio.
 * @returns {'critical' | 'insufficient' | 'pass'}
 *   - `critical`  — ratio < 2.0  (text essentially unreadable)
 *   - `insufficient` — 2.0 ≤ ratio < 4.5  (below WCAG AA)
 *   - `pass`      — ratio ≥ 4.5  (meets WCAG AA)
 */
export function classifyContrast(ratio) {
  if (ratio < CRITICAL_RATIO) return 'critical';
  if (ratio < WCAG_AA_RATIO) return 'insufficient';
  return 'pass';
}

/**
 * Check a single foreground/background pair and return a tiered result
 * with a human-readable message.
 *
 * @param {string} foreground - Foreground (text) hex color.
 * @param {string} background - Background hex color.
 * @returns {{ ratio: number, level: 'critical' | 'insufficient' | 'pass', message: string }}
 */
export function checkContrastTiered(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  const rounded = Math.round(ratio * 100) / 100;
  const level = classifyContrast(ratio);

  let message;
  if (level === 'critical') {
    message = `对比度 ${rounded}:1 过低，文字完全不可读（前景 ${foreground} / 背景 ${background}）`;
  } else if (level === 'insufficient') {
    message = `对比度 ${rounded}:1 低于 WCAG AA 标准 4.5:1（前景 ${foreground} / 背景 ${background}）`;
  } else {
    message = `对比度 ${rounded}:1 满足 WCAG AA 标准`;
  }

  return { ratio: rounded, level, message };
}

// ---------------------------------------------------------------------------
// Enhanced contrast checking — single pair and full-theme batch
// ---------------------------------------------------------------------------

/**
 * Check a single foreground/background color pair against WCAG and APCA.
 *
 * Provides a comprehensive contrast report for an arbitrary color pair,
 * suitable for validating individual token combinations (e.g. accent on
 * background, muted on surface).
 *
 * @param {string} foreground - Foreground (text) hex color.
 * @param {string} background - Background hex color.
 * @returns {{ ratio: number, passesAA: boolean, passesAAA: boolean, passesAPCA: boolean }}
 */
export function checkContrast(foreground, background) {
  const ratio = contrastRatio(foreground, background);
  const lc = Math.round(apcaContrast(background, foreground));

  return {
    ratio,
    passesAA: ratio >= WCAG_AA_RATIO,
    passesAAA: ratio >= WCAG_AAA_RATIO,
    passesAPCA: lc >= APCA_LC60,
  };
}

/**
 * Batch-check all meaningful color pairs in a theme token map.
 *
 * Given a set of theme tokens (token ID → hex color), checks contrast for all
 * token pairs where one token is a foreground-type and the other is a
 * background-type. This catches accessibility issues across the entire theme.
 *
 * Recognized token categories:
 *   - background: bg, surface, surface-elevated, code-bg, button-bg, input-bg
 *   - foreground: text, muted, accent, secondary, code-fg, border, success, error, warning, info
 *
 * @param {Record<string, string>} themeTokens - Map of token ID → hex color.
 * @param {'light' | 'dark'} scheme - Color scheme (affects semantic reference values).
 * @returns {{ errors: Array<{ fg: string, bg: string, ratio: number, level: 'critical' | 'insufficient' | 'pass', message: string }>,
 *             warnings: Array<{ fg: string, bg: string, ratio: number, level: 'critical' | 'insufficient' | 'pass', message: string }> }}
 *   `errors` contains critical-level results (ratio < 2.0).
 *   `warnings` contains insufficient-level results (2.0 ≤ ratio < 4.5).
 *   Pass-level results are omitted.
 */
export function checkThemeContrastBatch(themeTokens, _scheme) {
  // Categorize tokens by their visual role
  const bgPatterns = [
    '--agentskin-bg',
    '--agentskin-surface',
    '--agentskin-surface-elevated',
    '--agentskin-code-bg',
    '--agentskin-button-bg',
    '--agentskin-input-bg',
  ];

  const fgPatterns = [
    '--agentskin-text',
    '--agentskin-muted',
    '--agentskin-accent',
    '--agentskin-secondary',
    '--agentskin-code-fg',
    '--agentskin-border',
    '--agentskin-success',
    '--agentskin-error',
    '--agentskin-warning',
    '--agentskin-info',
  ];

  const bgTokens = bgPatterns.filter((p) => themeTokens[p]);
  const fgTokens = fgPatterns.filter((p) => themeTokens[p]);

  /** @type {Array<{ fg: string, bg: string, ratio: number, level: 'critical' | 'insufficient' | 'pass', message: string }>} */
  const errors = [];
  /** @type {Array<{ fg: string, bg: string, ratio: number, level: 'critical' | 'insufficient' | 'pass', message: string }>} */
  const warnings = [];

  for (const fg of fgTokens) {
    for (const bg of bgTokens) {
      const tiered = checkContrastTiered(themeTokens[fg], themeTokens[bg]);
      if (tiered.level === 'critical') {
        errors.push({ fg, bg, ...tiered });
      } else if (tiered.level === 'insufficient') {
        warnings.push({ fg, bg, ...tiered });
      }
      // pass results are not collected
    }
  }

  // Also check the primary foreground/background pair directly
  if (themeTokens['--agentskin-text'] && themeTokens['--agentskin-bg']) {
    const primary = checkContrastTiered(
      themeTokens['--agentskin-text'],
      themeTokens['--agentskin-bg'],
    );
    if (primary.level === 'critical') {
      errors.unshift({ fg: '--agentskin-text', bg: '--agentskin-bg', ...primary });
    } else if (primary.level === 'insufficient') {
      warnings.unshift({ fg: '--agentskin-text', bg: '--agentskin-bg', ...primary });
    }
  }

  return { errors, warnings };
}

// Re-export for backward compatibility and convenience
export { apcaContrast, autoOnColor } from './extended-colors.mjs';
// Export the decorative ratio so check-themes.mjs can use it as the warning floor.
export { WCAG_DECORATIVE_RATIO };
