// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/cdp-strategy
 *
 * Simple theme injection via CDP using adoptedStyleSheets + hero blob URLs.
 *
 * This is the "lightweight" injection strategy — it injects a single CSS
 * stylesheet and optional hero art, then verifies the result. Used as a
 * "hardening" pass AFTER @agentskin/engine's applyTheme: if core already
 * succeeded the verification will simply confirm; if core's injection was
 * stripped (e.g. Doubao removes `<style>` elements within ~50ms) this
 * re-injects via the stealth adoptedStyleSheets channel.
 *
 * For the multi-layer engine injection strategy (palette + tokens + cosmetic
 * + theme + adapter), see {@link ./engine-strategy}.
 */

import { existsSync } from 'node:fs';
import { DEFAULT_VERIFY_DELAY_MS } from '../../../shared/injection-constants';
import type { CdpSession } from '../cdp-client';
import {
  delay,
  injectCssAdopted,
  injectHeroBlob,
  injectHeroFromDataUrl,
  type ThemeVerification,
  verifyTheme,
} from './shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectThemeOptions {
  /** CSS text to inject (the agent-specific stylesheet). */
  css: string;
  /** Absolute path to hero.webp (or null to skip file-based art injection). */
  heroPath?: string | null;
  /** Hero image as data URL (alternative to heroPath; used by engine). */
  heroDataUrl?: string | null;
  /** Host class to add to <html> (e.g. "agentskin-host-doubao"). */
  hostClass?: string;
  /** Number of verification retries (default 1). */
  retries?: number;
  /** Delay between injection and verification in ms (default DEFAULT_VERIFY_DELAY_MS). */
  verifyDelayMs?: number;
}

export interface InjectThemeResult {
  /** Whether the CSS stylesheet was successfully adopted. */
  cssInjected: boolean;
  /** Whether the hero blob URL was set on <html> via --agentskin-art. */
  heroInjected: boolean;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all checks passed. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Inject theme CSS + hero art into a live page via CDP, then verify.
 * Best-effort: never throws — returns a result object with success=false
 * on failure so callers can decide whether to retry or report.
 */
export async function injectThemeViaCdp(
  session: CdpSession,
  options: InjectThemeOptions,
): Promise<InjectThemeResult> {
  const {
    css,
    heroPath,
    heroDataUrl,
    hostClass,
    retries = 1,
    verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
  } = options;
  const hasHero = !!(heroPath || heroDataUrl);

  try {
    await session.send('Runtime.enable');
  } catch {
    return { cssInjected: false, heroInjected: false, verification: null, success: false };
  }

  // --- Step 1: Host class ---
  if (hostClass) {
    try {
      await session.evaluate(`document.documentElement.classList.add('${hostClass}'); 'ok'`);
    } catch {
      // Non-fatal — host class is a progressive enhancement hook.
    }
  }

  // --- Step 2: Hero blob URL ---
  let heroInjected = false;
  if (heroDataUrl) {
    heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
  } else if (heroPath && existsSync(heroPath)) {
    heroInjected = await injectHeroBlob(session, heroPath);
  }

  // --- Step 3: CSS via adoptedStyleSheets ---
  let cssInjected = await injectCssAdopted(session, css);

  // --- Step 4: Verify (+ retry) ---
  await delay(verifyDelayMs);
  let verification = await verifyTheme(session);

  if (!verification?.heroBlobActive && heroInjected) {
    // Hero might have been GC'd or page re-rendered; retry once.
    for (let i = 0; i < retries && !verification?.heroBlobActive; i++) {
      if (heroDataUrl) {
        await injectHeroFromDataUrl(session, heroDataUrl);
      } else if (heroPath && existsSync(heroPath)) {
        await injectHeroBlob(session, heroPath);
      }
      if (!cssInjected) {
        cssInjected = await injectCssAdopted(session, css);
      }
      await delay(verifyDelayMs);
      verification = await verifyTheme(session);
    }
  }

  const success =
    cssInjected && (!hasHero || heroInjected) && (verification?.heroBlobActive ?? !hasHero);

  return { cssInjected, heroInjected, verification, success };
}
