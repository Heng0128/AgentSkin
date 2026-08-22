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

/** AAA: normal-text minimum ratio per WCAG 2.1 SC 1.4.6. */
const WCAG_AAA_RATIO = 7.0;

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
 * @param {Record<string, any>} colors
 * @returns {'AA' | 'AAA' | 'none'}
 */
function resolveLevel(colors) {
  const lvl = colors?._wcag?.level;
  if (lvl === 'AAA' || lvl === 'none') return lvl;
  return 'AA';
}

// ---------------------------------------------------------------------------
// Exported functions
// ---------------------------------------------------------------------------

/**
 * Validate foreground/background contrast.
 *
 * @param {Record<string, any>} manifest
 *   Manifest-shaped object; reads `manifest.colors.{foreground,background,_wcag}`.
 * @returns {{ wcag: { ratio: number, passesAA: boolean, passesAAA: boolean },
 *             apca: { lc: number, passesLc60: boolean, passesLc90: boolean },
 *             level: 'AA' | 'AAA' } | null}
 *   Returns `null` when level==='none' or either color is missing.
 */
export function checkThemeContrast(manifest) {
  const colors = manifest?.colors;
  if (!colors?.background || !colors.foreground) return null;

  const level = resolveLevel(colors);
  if (level === 'none') return null;

  const ratio = contrastRatio(colors.foreground, colors.background);
  const lc = Math.round(apcaContrast(colors.foreground, colors.background));

  const passesAA = ratio >= WCAG_AA_RATIO;
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
 * @param {Record<string, any>} manifest
 * @returns {Array<{ name: string, fg: string, bg: string, ratio: number,
 *                   passesAA: boolean }>}
 *   Empty array when `extended` is absent.
 */
export function checkExtendedContrast(manifest) {
  const colors = manifest?.colors;
  if (!colors?.background || !colors.foreground) return [];

  const ext = colors.extended;
  if (!ext || typeof ext !== 'object') return [];

  const bg = colors.background;
  const fg = colors.foreground;

  // Use the same algorithm as the runtime engine (extended-colors.mjs autoOnColor)
  // to ensure CI validation matches actual generated --agentskin-ext-on-* values.
  const onFor = autoOnColor;

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
      passesAA: ratio >= WCAG_AA_RATIO,
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
      `WCAG AA contrast requirement not met (ratio ${wcag.ratio}:1 < ${WCAG_AA_RATIO}:1)`,
    );
}
