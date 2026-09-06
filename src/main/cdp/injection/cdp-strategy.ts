// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/cdp-strategy
 *
 * Lightweight theme injection via CDP using a single `<style>` element + hero
 * blob URLs. Aligned with engine-strategy's injection mechanism to eliminate
 * dual-path coverage conflicts (adoptedStyleSheets vs `<style>`).
 *
 * 2026-09-01: Migrated from adoptedStyleSheets to `<style>` element injection
 * (buildStyleExpression) to unify all CSS injection paths. This eliminates the
 * coverage/override issue where two different mechanisms ran sequentially on
 * the same target.
 *
 * Used as a fallback path when engine files are NOT available (legacy targets,
 * missing engine/ folder). When engine files exist, engine-strategy's
 * injectThemeViaEngine handles the injection.
 *
 * Doubao-specific recovery (when `<style>` is stripped within ~50ms) is handled
 * post-verify in cdp-fanout via a best-effort adoptedStyleSheet re-inject.
 */

import { DEFAULT_VERIFY_DELAY_MS } from '../../../shared/injection-constants';
import type { CdpSession } from '../cdp-client';
import { injectCssStyle } from './css-inject';
import {
  injectHeroAssets,
  injectHeroBlob,
  injectHeroFromDataUrl,
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
  /** Agent identifier for performance trace attribution (optional). */
  agentId?: string;
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
    agentId,
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
  // Delegates to the shared `injectHeroAssets` kernel so the priority ordering
  // (imageSet → heroProtocolUrl → heroDataUrl → heroPath) and idempotency gate
  // (hasActiveHeroArt short-circuit) are defined exactly once, alongside
  // engine-strategy's apply path.
  let { heroInjected, imagesInjected } = await injectHeroAssets(session, {
    imageSet,
    heroProtocolUrl,
    heroDataUrl,
    heroPath,
  });

  // --- Step 3: CSS via <style> element (unified with engine-strategy) ---
  // 2026-09-01: 统一为 <style> 元素方案，消除 adoptedStyleSheet 与 <style> 的覆盖冲突
  let cssInjected = await injectCssStyle(session, css);

  // --- Step 4: Verify (+ retry with polling) ---
  let { verification } = await waitForTheme(session, {
    timeoutMs: 3000,
    intervalMs: verifyIntervalMs,
    minDelayMs: verifyDelayMs,
    agentId,
  });

  if (verification && !verification.heroBlobActive && heroInjected) {
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
        cssInjected = await injectCssStyle(session, css);
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
