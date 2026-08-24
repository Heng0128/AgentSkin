// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/shared
 *
 * Barrel module: re-exports the public API of the injection sub-modules
 * and owns the remaining helpers (verification, delay).
 *
 * For the focused sub-modules, see:
 *   - {@link ./types}       — ThemeVerification interface
 *   - {@link ./hero-inject} — hero image → Blob URL injection
 *   - {@link ./css-inject}  — adoptedStylesheets CSS injection
 */

import { toMessage } from '../../../shared/errors';
import { isThemeFullyApplied } from '../../../shared/injection-runtime';
import { mainWarn } from '../../logger';
import { PerformanceRecorder } from '../../services/performance';
import type { CdpSession } from '../cdp-client';

// ===========================================================================
// Re-exports — sub-module public API (preserves existing import contracts)
// ===========================================================================

import type { ThemeVerification } from './types';

export { injectCssAdopted, injectCssLayer } from './css-inject';
export {
  type ImageSetResult,
  injectHeroBlob,
  injectHeroFromDataUrl,
  transferHeroBase64,
  transferImageSet,
} from './hero-inject';
export type { ThemeVerification } from './types';

// ===========================================================================
// Verification
// ===========================================================================

/**
 * CDP evaluate expression body for verifyTheme.
 * Collects core token values, per-layer adoption status, and hero state.
 *
 * Per-layer tracking reads `sheet.cssRules.length` for each owned sheet that
 * carries a `__agentskin_layer` flag — this lets the watchdog detect partial
 * injection (e.g. palette adopted but tokens missing) instead of relying on
 * a single aggregate count.
 */
const VERIFY_THEME_BODY = [
  'const rootCs = getComputedStyle(document.documentElement);',
  'const root = document.getElementById("root") || document.body;',
  'const rootBg = getComputedStyle(root).backgroundImage || "";',
  'const bodyBg = getComputedStyle(document.body).backgroundImage || "";',
  'const sheets = document.adoptedStyleSheets || [];',
  'const owned = sheets.filter(function(s) { return s.__agentskin === true; });',
  // Per-layer: map layerName → cssRule count
  'const layers = {};',
  'for (var i = 0; i < owned.length; i++) {',
  '  var ln = owned[i].__agentskin_layer;',
  '  if (ln) layers[ln] = owned[i].cssRules.length;',
  '}',
  'var accent = rootCs.getPropertyValue("--agentskin-accent").trim();',
  'var agentskinArt = rootCs.getPropertyValue("--agentskin-art").trim().slice(0, 60);',
  'var assets = {};',
  'for (var j = 0; j < rootCs.length; j++) {',
  '  var nm = rootCs[j];',
  '  if (nm.indexOf("--agentskin-asset-") === 0) {',
  '    var v = rootCs.getPropertyValue(nm).trim();',
  '    if (v) assets[nm] = v.slice(0, 60);',
  '  }',
  '}',
  'return JSON.stringify({',
  '  accent: accent,',
  '  agentskinArt: agentskinArt,',
  '  // artResolved: 2026-08-23 hero 修复 —— 直接看 --agentskin-art 是否已是',
  '  // 有效 url(blob:)。原 heroBlobActive 只看 root/body 的 backgroundImage，',
  '  // 对 z-index:-1 伪元素背景恒为 false，导致 watchdog 在 CSS 层存在时跳过',
  '  // 硬化、hero 大图 Blob 丢失后不再补注入 → 背景剩纯色块。',
  '  artResolved: agentskinArt.indexOf("url(") === 0 && agentskinArt.indexOf("blob:") >= 0,',
  '  heroBlobActive: rootBg.indexOf("blob:") >= 0 || bodyBg.indexOf("blob:") >= 0,',
  '  adoptedSheetCount: owned.length,',
  '  layers: layers,',
  '  assets: assets,',
  '  assetsActive: Object.keys(assets).length,',
  '});',
].join('\n');

export async function verifyTheme(session: CdpSession): Promise<ThemeVerification | null> {
  try {
    const raw = await session.evaluate(`(() => { ${VERIFY_THEME_BODY} })()`);
    return JSON.parse(raw) as ThemeVerification;
  } catch (error) {
    mainWarn('Inject.Verify', `theme-verify CDP evaluate failed: ${toMessage(error)}`);
    return null;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Exponential backoff with jitter. Used by retry loops to avoid
 * bombarding an unresponsive target with fixed-interval attempts.
 *
 * @param attempt  0-based attempt number
 * @param base     base delay in ms (default 500)
 * @param max      cap in ms (default 8000)
 */
export function backoffDelay(attempt: number, base = 500, max = 8000): Promise<void> {
  const exp = Math.min(max, base * 2 ** attempt);
  const jitter = Math.floor(Math.random() * exp * 0.3);
  const ms = Math.min(max, exp + jitter);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll `verifyTheme` until it succeeds or `timeoutMs` is reached.
 *
 * Replaces the pattern of `await delay(fixedMs); verifyTheme()` with a
 * smarter approach: returns as soon as the theme is verified (fast path)
 * and waits up to `timeoutMs` if the theme takes longer to apply (slow path).
 *
 * The `minDelayMs` parameter (default 0) can be used to enforce a minimum
 * wait before starting to poll, which is useful when the caller knows the
 * theme takes at least that long to apply.
 *
 * Returns the first non-null `ThemeVerification`, or null if timeout is reached.
 */
export async function waitForTheme(
  session: CdpSession,
  options: { timeoutMs?: number; intervalMs?: number; minDelayMs?: number } = {},
): Promise<ThemeVerification | null> {
  const { timeoutMs = 3000, intervalMs = 50, minDelayMs = 0 } = options;
  const t0 = performance.now();

  if (minDelayMs > 0) {
    await delay(minDelayMs);
  }

  // Use a single monotonic clock source (performance.now()) for both the
  // timeout check and the trace step. Mixing with Date.now() would risk
  // clock-skew divergence (NTP sync, DTP adjustments).
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const verification = await verifyTheme(session);
    if (verification && isThemeFullyApplied(verification)) {
      PerformanceRecorder.recordNamedStep('waitForTheme', performance.now() - t0);
      return verification;
    }
    await delay(intervalMs);
  }

  // Final attempt after timeout
  const verification = await verifyTheme(session);
  PerformanceRecorder.recordNamedStep(
    'waitForTheme',
    performance.now() - t0,
    verification !== null,
    verification === null ? 'theme not verified within timeout' : undefined,
  );
  return verification;
}
