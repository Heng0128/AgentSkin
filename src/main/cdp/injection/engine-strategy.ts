// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/engine-strategy
 *
 * Multi-layer engine theme injection via CDP.
 *
 * Injects theme using the L3/L4/L5 architecture:
 *   Layer 0: palette.css   — per-theme color identity (--agentskin-* + -raw RGB values)
 *   Layer 1: tokens.css    — per-agent native token overrides (theme-agnostic, uses var(--agentskin-*))
 *   Layer 2: cosmetic.css  — per-agent visual polish (theme-agnostic)
 *   Layer 3: theme.css     — per-agent theme CSS (theme-specific native tokens + visual styles)
 *   Layer 4: adapter.mjs   — JS heuristic positioning + L4 token auto-discovery + MutationObserver self-healing
 *
 * The theme layer (3) is injected AFTER the engine layers so theme-specific
 * native token overrides (--dbx, --vscode, etc.) take precedence over the
 * engine's theme-agnostic var() mappings. Each CSS layer is a separate
 * adoptedStyleSheet for independent lifecycle. The adapter runs as evaluated
 * JS and creates its own sheet + observers.
 *
 * Also handles persistence via `Page.addScriptToEvaluateOnNewDocument` so
 * the engine re-applies itself automatically on every navigation/reload.
 *
 * For the simpler single-stylesheet injection strategy, see
 * {@link ./cdp-strategy}.
 */

import {
  DEFAULT_VERIFY_DELAY_MS,
  RENDERER_CONFIG_GLOBAL,
  SESSION_DISABLED_KEY,
} from '../../../shared/injection-constants';
import {
  buildClearEngineInjectionExpression,
  CLEAR_ADAPTERS_BODY,
  isThemeFullyApplied,
} from '../../../shared/injection-runtime';
import { mainWarnFromCatch } from '../../logger';
import type { CdpSession } from '../cdp-client';
import { injectCssLayer } from './css-inject';
import { injectHeroBlob, injectHeroFromDataUrl, transferImageSet } from './hero-inject';
import { waitForTheme } from './shared';
import type { ThemeVerification } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectEngineOptions {
  /** Per-theme palette CSS (~1KB, defines --agentskin-* tokens including -raw RGB values). */
  paletteCss: string;
  /** Per-agent engine tokens.css (pure token overrides). */
  tokensCss: string;
  /** Per-agent engine cosmetic.css (visual polish, allowed to degrade). */
  cosmeticCss: string;
  /** Per-agent engine adapter.mjs source (JS heuristic + L4 auto-discovery + self-healing). */
  adapterJs: string;
  /**
   * Per-agent theme CSS (the full resolved target CSS, e.g. doubao.css).
   * Injected as a 4th "theme" layer AFTER cosmetic to provide native token
   * overrides (--dbx-*, --vscode-*) and visual styles that the engine
   * layers don't cover. Optional — omitted when no per-agent CSS exists.
   */
  themeCss?: string;
  /**
   * Global user-authored custom CSS (custom.css). Injected as the 5th and
   * LAST CSS layer so it beats every theme layer at equal specificity —
   * the "user override wins" guarantee. Optional — omitted when unset.
   */
  customCss?: string;
  /**
   * Full image set as data URLs (id → data URL). When provided, every entry is
   * injected as `--agentskin-asset-<id>` and `hero` is also aliased to
   * `--agentskin-art` (2a multi-asset). Takes precedence over heroDataUrl/heroPath.
   */
  imageDataUrls?: Record<string, string> | null;
  /** Hero image as data URL (data:image/webp;base64,...). */
  heroDataUrl?: string | null;
  /** Absolute path to hero.webp (alternative to heroDataUrl). */
  heroPath?: string | null;
  /** Agent identifier for logging (e.g. "doubao"). */
  agent?: string;
  /** Theme identifier for logging (e.g. "midnight-aurora"). */
  themeId?: string;
  /** Delay between injection and verification in ms (default DEFAULT_VERIFY_DELAY_MS). */
  verifyDelayMs?: number;
  /** Poll interval for the verification loop (default 50ms, RFC §4.8). */
  verifyIntervalMs?: number;
  /** Verification timeout in ms (default 3000). Shorter values speed up tests. */
  verifyTimeoutMs?: number;
}

export interface InjectEngineResult {
  /** Number of CSS layers successfully adopted. */
  layersInjected: number;
  /** Whether the adapter JS executed successfully. */
  adapterApplied: boolean;
  /** Whether the hero blob URL was set. */
  heroInjected: boolean;
  /** 2a multi-asset: number of `--agentskin-asset-<id>` assets injected. */
  imagesInjected: number;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all critical checks passed. */
  success: boolean;
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Inject theme using the multi-layer engine architecture:
 *   Layer 0: palette.css   — per-theme color identity (--agentskin-* + -raw RGB values)
 *   Layer 1: tokens.css    — per-agent native token overrides (theme-agnostic, uses var(--agentskin-*))
 *   Layer 2: cosmetic.css  — per-agent visual polish (theme-agnostic)
 *   Layer 3: theme.css     — per-agent theme CSS (theme-specific native tokens + visual styles)
 *   Layer 4: adapter.mjs   — JS heuristic positioning + L4 token auto-discovery + MutationObserver self-healing
 *
 * The theme layer (3) is injected AFTER the engine layers so theme-specific
 * native token overrides (--dbx, --vscode, etc.) take precedence over the
 * engine's theme-agnostic var() mappings. Each CSS layer is a separate
 * adoptedStyleSheet for independent lifecycle. The adapter runs as evaluated
 * JS and creates its own sheet + observers.
 */
export async function injectThemeViaEngine(
  session: CdpSession,
  options: InjectEngineOptions,
): Promise<InjectEngineResult> {
  const {
    paletteCss,
    tokensCss,
    cosmeticCss,
    themeCss,
    customCss,
    adapterJs,
    imageDataUrls,
    heroDataUrl,
    heroPath,
    agent,
    themeId,
    verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
    verifyIntervalMs = 50,
    verifyTimeoutMs = 3000,
  } = options;

  try {
    await session.send('Runtime.enable');
  } catch (err) {
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `Runtime.enable failed for agent=${agent ?? 'unknown'} theme=${themeId ?? 'unknown'}`,
    );
    return {
      layersInjected: 0,
      adapterApplied: false,
      heroInjected: false,
      imagesInjected: 0,
      verification: null,
      success: false,
    };
  }

  // --- Step 1: Cleanup previous adapter instance ---
  try {
    await session.evaluate(`(() => { ${CLEAR_ADAPTERS_BODY}; return 'cleaned'; })()`);
  } catch (err) {
    // Non-fatal — stale adapter cleanup is best-effort. Log for diagnostics.
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `cleanup previous adapter failed for agent=${agent ?? 'unknown'}`,
    );
  }

  // --- Step 1b: Clear the disabled flag ---
  // A `removeTheme` sets `SESSION_DISABLED_KEY` so any unreachable persistence
  // script skips on the next navigation. If it is still set when we apply, the
  // adapter's `ensure()` short-circuits and the theme never takes effect (seen
  // on Doubao after a restore left stale `__agentskin_disabled__`). Best-effort.
  try {
    await session.evaluate(`(() => {
      try { sessionStorage.removeItem(${JSON.stringify(SESSION_DISABLED_KEY)}); } catch (e) {}
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }

  // --- Step 2: Image blob URLs (multi-asset, else single hero) ---
  const imageSet = imageDataUrls && Object.keys(imageDataUrls).length > 0 ? imageDataUrls : null;
  let heroInjected = false;
  let imagesInjected = 0;
  let heroBlobUrl = '';
  if (imageSet) {
    const result = await transferImageSet(session, imageSet);
    imagesInjected = result.injectedIds.length;
    heroInjected = result.heroInjected;
  } else if (heroDataUrl) {
    heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
    imagesInjected = heroInjected ? 1 : 0;
  } else if (heroPath) {
    heroInjected = await injectHeroBlob(session, heroPath);
    imagesInjected = heroInjected ? 1 : 0;
  }
  if (heroInjected) {
    heroBlobUrl =
      (await session.evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim().replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '')`,
      )) || '';
  }

  // --- Step 3: Set config for adapter ---
  const configJson = JSON.stringify({ heroBlobUrl, agent: agent || '', themeId: themeId || '' });
  try {
    await session.evaluate(`window.${RENDERER_CONFIG_GLOBAL} = ${configJson}; 'ok'`);
  } catch (err) {
    // Non-fatal — adapter will run with defaults. Log for diagnostics.
    mainWarnFromCatch('cdp/engine', err, `set config failed for agent=${agent ?? 'unknown'}`);
  }

  // --- Step 4: Inject CSS layers as separate adoptedStyleSheets ---
  // The custom layer is appended LAST so it wins at equal specificity over
  // palette/tokens/cosmetic/theme (adoptedStyleSheets order = priority).
  const layers: [string, string][] = [
    ['palette', paletteCss],
    ['tokens', tokensCss],
    ['cosmetic', cosmeticCss],
    ...(themeCss ? [['theme', themeCss] as [string, string]] : []),
    ...(customCss ? [['custom', customCss] as [string, string]] : []),
  ];

  let layersInjected = 0;
  for (const [layerName, layerCss] of layers) {
    const ok = await injectCssLayer(session, layerName, layerCss);
    if (ok) layersInjected++;
  }

  // --- Step 5: Execute adapter.mjs (Layer 1: structural + L4/L5) ---
  let adapterApplied = false;
  try {
    const adapterResult = await session.evaluate(adapterJs);
    adapterApplied = adapterResult === 'applied' || adapterResult === 'already-applied';
  } catch (err) {
    adapterApplied = false;
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `adapter evaluate failed for agent=${agent ?? 'unknown'} theme=${themeId ?? 'unknown'}`,
    );
  }

  // --- Step 5b (removed, RFC 2026-08-18 P2) ---
  // This engine used to register its own new-document persistence via
  // `registerEnginePersistence` (a `Page.addScriptToEvaluateOnNewDocument`).
  // P2 retired it: the registration ran on the operation-scoped pooled session,
  // and since `Page.addScriptToEvaluateOnNewDocument` registrations are
  // **session-bound** (verified 2026-08-17), closing that session at the epoch
  // boundary dropped the script before the next navigation — it never survived
  // reload. The core runtime (@agentskin/engine `injector.mjs`) owns the single
  // authoritative persistence on a dedicated long-lived `persistenceSessions`;
  // this engine only injects the current document. `removeEngineInjection`
  // below still sets the shared `SESSION_DISABLED_KEY` as belt-and-suspenders.

  // --- Step 6: Verify (polling with timeout) ---
  const verification = await waitForTheme(session, {
    timeoutMs: verifyTimeoutMs,
    intervalMs: verifyIntervalMs,
    minDelayMs: verifyDelayMs,
  });

  const success =
    layersInjected >= 2 &&
    adapterApplied &&
    verification !== null &&
    isThemeFullyApplied(verification);

  return { layersInjected, adapterApplied, heroInjected, imagesInjected, verification, success };
}

/**
 * Tear down the engine layers + adapter from the current document.
 * Called during theme restore so the engine doesn't re-apply itself on the
 * next navigation.
 *
 * This mirrors `injectThemeViaEngine`'s apply path: every DOM-bearing target
 * that received engine injection must be cleaned up here, otherwise stale
 * adoptedStyleSheets and adapter markers survive restore.
 *
 * RFC 2026-08-18 P2: this engine no longer registers its own new-document
 * persistence (that is core-owned on dedicated long-lived sessions), so there
 * are no tracked script identifiers to remove. It still sets the shared
 * `SESSION_DISABLED_KEY` as belt-and-suspenders so any core persistence script
 * that could not be explicitly removed skips on future navigations.
 *
 * Best-effort: never throws — callers use it in fire-and-forget restore paths.
 */
export async function removeEngineInjection(session: CdpSession): Promise<void> {
  // 1. Set the disable flag in sessionStorage as a belt-and-suspenders
  //    fallback, mirroring core's removeTheme. This persists across
  //    navigations within the same tab/session, so any persistence script we
  //    couldn't remove (e.g. registered by a previous process incarnation
  //    whose identifiers were never tracked) still skips re-application on
  //    future navigations.
  try {
    await session.send('Runtime.enable');
    await session.evaluate(`(() => {
      try { sessionStorage.setItem('${SESSION_DISABLED_KEY}', '1'); } catch (e) { console.warn('[engine-strategy] sessionStorage.setItem failed:', e); }
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }

  // 2. Tear down the engine layers + adapter from the current document.
  //    Delegates to the shared kernel so owned-sheet / adapter-marker /
  //    host-class cleanup is defined exactly once.
  try {
    await session.evaluate(buildClearEngineInjectionExpression());
  } catch {
    // Best-effort — target may have navigated away.
  }
}

// ---------------------------------------------------------------------------
// Lifecycle cleanup (module-scoped maps)
// ---------------------------------------------------------------------------

/**
 * RFC 2026-08-18 P2: this engine no longer owns module-scoped persistence
 * state — new-document persistence is core-owned (dedicated long-lived
 * sessions). These lifecycle hooks are retained because the service layer
 * (agent-engine-service) calls them on theme removal / shutdown; they now
 * have nothing to clear, so they are documented no-ops.
 */
export function cleanupEngineInjectionForAgent(_agent: string): void {
  // No-op since P2 — persistence state is core-owned.
}

/**
 * RFC 2026-08-18 P2: no-op counterpart of {@link cleanupEngineInjectionForAgent}
 * for full-shutdown cleanup. Retained for service-layer lifecycle symmetry.
 */
export function disposeEngineInjectionState(): void {
  // No-op since P2 — persistence state is core-owned.
}
