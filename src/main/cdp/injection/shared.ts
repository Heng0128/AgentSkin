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
import { SHEET_OWNED_FLAG } from '../../../shared/injection-constants';
import { mainWarn } from '../../logger';
import { PerformanceRecorder } from '../../services/performance';
import type { CdpSession } from '../cdp-client';

// ===========================================================================
// Re-exports — sub-module public API (preserves existing import contracts)
// ===========================================================================

import type { ThemeVerification } from './types';

export { injectCssAdopted, injectCssLayer } from './css-inject';
export {
  injectHeroBlob,
  injectHeroFromDataUrl,
  transferHeroBase64,
} from './hero-inject';
export type { ThemeVerification } from './types';

// ===========================================================================
// Verification
// ===========================================================================

export async function verifyTheme(session: CdpSession): Promise<ThemeVerification | null> {
  try {
    const raw = await session.evaluate(`(() => {
      const rootCs = getComputedStyle(document.documentElement);
      const root = document.getElementById('root') || document.body;
      const rootBg = getComputedStyle(root).backgroundImage || '';
      const bodyBg = getComputedStyle(document.body).backgroundImage || '';
      const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
      return JSON.stringify({
        accent: rootCs.getPropertyValue('--agentskin-accent').trim(),
        agentskinArt: rootCs.getPropertyValue('--agentskin-art').trim().slice(0, 60),
        heroBlobActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
        adoptedSheetCount: adopted,
      });
    })()`);

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

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const verification = await verifyTheme(session);
    if (verification && verification.adoptedSheetCount > 0) {
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
