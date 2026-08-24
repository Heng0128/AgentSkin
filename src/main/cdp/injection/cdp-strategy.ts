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

import { DEFAULT_VERIFY_DELAY_MS } from '../../../shared/injection-constants';
import type { CdpSession } from '../cdp-client';
import { injectCssAdopted } from './css-inject';
import {
  injectHeroBlob,
  injectHeroFromDataUrl,
  injectHeroFromProtocolUrl,
  transferImageSet,
} from './hero-inject';
import { backoffDelay, verifyTheme, waitForTheme } from './shared';
import type { ThemeVerification } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectThemeOptions {
  /** CSS text to inject (the agent-specific stylesheet). */
  css: string;
  /**
   * Full image set as data URLs (id → data URL). When provided, every entry is
   * injected as `--agentskin-asset-<id>` and `hero` is also aliased to
   * `--agentskin-art` (2a multi-asset). Takes precedence over heroDataUrl/heroPath.
   */
  imageDataUrls?: Record<string, string> | null;
  /** Absolute path to hero.webp (or null to skip file-based art injection). */
  heroPath?: string | null;
  /**
   * agentskin-theme://hero/<id> protocol URL for external-file hero originals.
   * When set, the renderer streams the ORIGINAL wallpaper file directly from
   * disk (zero compression, no base64 over CDP) — the correct path for
   * multi-MB 4K/8K backdrops where CDP chunk transfer times out.
   */
  heroProtocolUrl?: string | null;
  /** Hero image as data URL (alternative to heroPath; used by engine). */
  heroDataUrl?: string | null;
  /** Host class to add to <html> (e.g. "agentskin-host-doubao"). */
  hostClass?: string;
  /** Number of verification retries (default 1). */
  retries?: number;
  /** Delay between injection and verification in ms (default DEFAULT_VERIFY_DELAY_MS). */
  verifyDelayMs?: number;
  /** Poll interval for the verification loop (default 50ms, RFC §4.8). */
  verifyIntervalMs?: number;
}

export interface InjectThemeResult {
  /** Whether the CSS stylesheet was successfully adopted. */
  cssInjected: boolean;
  /** Whether the hero blob URL was set on <html> via --agentskin-art. */
  heroInjected: boolean;
  /** 2a multi-asset: number of `--agentskin-asset-<id>` assets injected. */
  imagesInjected: number;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all checks passed. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Inject theme CSS + art into a live page via CDP, then verify.
 * Best-effort: never throws — returns a result object with success=false
 * on failure so callers can decide whether to retry or report.
 */
export async function injectThemeViaCdp(
  session: CdpSession,
  options: InjectThemeOptions,
): Promise<InjectThemeResult> {
  const {
    css,
    imageDataUrls,
    heroPath,
    heroProtocolUrl,
    heroDataUrl,
    hostClass,
    retries = 1,
    verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
    verifyIntervalMs = 50,
  } = options;
  const imageSet = imageDataUrls && Object.keys(imageDataUrls).length > 0 ? imageDataUrls : null;
  const hasImage = !!(imageSet || heroPath || heroDataUrl);
  const hasHero = !!(heroPath || heroDataUrl || imageSet?.hero);

  try {
    await session.send('Runtime.enable');
  } catch {
    return {
      cssInjected: false,
      heroInjected: false,
      imagesInjected: 0,
      verification: null,
      success: false,
    };
  }

  // --- Step 1: Host class ---
  if (hostClass) {
    try {
      await session.evaluate(`document.documentElement.classList.add('${hostClass}'); 'ok'`);
    } catch {
      // Non-fatal — host class is a progressive enhancement hook.
    }
  }

  // --- Step 2: Image blob URLs (multi-asset + hero are independent) ---
  // The creative asset set and the hero backdrop are decoupled: a theme may
  // embed creative images as data URLs while its hero is an external file
  // (lossless 4K/8K wallpaper mode, heroPath/heroProtocolUrl) — or vice versa.
  // Inject both when both are present instead of treating them as mutually
  // exclusive.
  //
  // Hero priority: heroProtocolUrl (agentskin-theme://hero/<id>, streams the
  // ORIGINAL file from disk — zero CDP base64, never times out on 4K/8K) →
  // heroDataUrl (embedded base64) → heroPath (file read + chunked transfer).
  let heroInjected = false;
  let imagesInjected = 0;
  if (imageSet) {
    const result = await transferImageSet(session, imageSet);
    imagesInjected = result.injectedIds.length;
    heroInjected = result.heroInjected;
  }
  if (!heroInjected && heroProtocolUrl) {
    heroInjected = await injectHeroFromProtocolUrl(session, heroProtocolUrl);
    imagesInjected += heroInjected ? 1 : 0;
  } else if (!heroInjected && heroDataUrl) {
    heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
    imagesInjected += heroInjected ? 1 : 0;
  } else if (!heroInjected && heroPath) {
    heroInjected = await injectHeroBlob(session, heroPath);
    imagesInjected += heroInjected ? 1 : 0;
  }

  // --- Step 3: CSS via adoptedStyleSheets ---
  let cssInjected = await injectCssAdopted(session, css);

  // --- Step 4: Verify (+ retry with polling) ---
  let verification = await waitForTheme(session, {
    timeoutMs: 3000,
    intervalMs: verifyIntervalMs,
    minDelayMs: verifyDelayMs,
  });

  if (!verification?.heroBlobActive && heroInjected) {
    // Hero might have been GC'd or page re-rendered; retry once.
    for (let i = 0; i < retries && !verification?.heroBlobActive; i++) {
      if (imageSet) {
        const result = await transferImageSet(session, imageSet);
        imagesInjected = result.injectedIds.length;
        heroInjected = result.heroInjected;
      } else if (heroDataUrl) {
        heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
      } else if (heroPath) {
        heroInjected = await injectHeroBlob(session, heroPath);
      }
      if (!cssInjected) {
        cssInjected = await injectCssAdopted(session, css);
      }
      await backoffDelay(i, verifyDelayMs, 8000);
      verification = await verifyTheme(session);
    }
  }

  const success =
    cssInjected &&
    (!hasImage || (hasHero ? heroInjected : imagesInjected > 0)) &&
    (verification?.heroBlobActive ?? !hasHero);

  return { cssInjected, heroInjected, imagesInjected, verification, success };
}
