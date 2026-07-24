// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-inject
 *
 * Enhanced theme injection via CDP that supplements @agentskin/core's
 * applyTheme with three capabilities the core lacks:
 *
 * 1. **Hero blob URL injection** — converts a local hero image to an
 *    in-memory Blob URL, bypassing file:// CSP restrictions (critical for
 *    Doubao which blocks file:// in background-image).
 *
 * 2. **adoptedStyleSheets injection** — uses the Constructable Stylesheet
 *    API (`new CSSStyleSheet()` + `document.adoptedStyleSheets`) which is
 *    invisible to MutationObserver-based anti-tamper (Doubao removes
 *    `<style>` elements within ~50ms of insertion).
 *
 * 3. **Post-injection verification** — reads back computed styles to
 *    confirm the theme actually took effect, with optional retry.
 *
 * These run AFTER core's applyTheme as a "hardening" pass. If core already
 * succeeded the verification will simply confirm; if core's injection was
 * stripped (Doubao) this re-injects via the stealth channel.
 *
 * Wallpaper injection (video / image) was extracted to
 * {@link ./cdp-wallpaper-inject} — it shares only the CDP session transport
 * and runs on a separate lifecycle.
 */

import { readFileSync, existsSync } from 'node:fs';
import type { CdpSession } from './cdp-client';
import {
  DEFAULT_VERIFY_DELAY_MS,
  RENDERER_CONFIG_GLOBAL,
  SESSION_DISABLED_KEY,
  SHEET_OWNED_FLAG,
} from '../shared/injection-constants';
import {
  ADOPT_LAYER_BODY,
  CLEAR_ADAPTERS_BODY,
  buildAdoptLayerExpression,
  buildAdoptOwnedSheetExpression,
  buildClearEngineInjectionExpression,
} from '../shared/injection-runtime';

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
  /** Host class to add to <html> (e.g. "codedrobe-host-doubao"). */
  hostClass?: string;
  /** Number of verification retries (default 1). */
  retries?: number;
  /** Delay between injection and verification in ms (default 400). */
  verifyDelayMs?: number;
}

export interface InjectThemeResult {
  /** Whether the CSS stylesheet was successfully adopted. */
  cssInjected: boolean;
  /** Whether the hero blob URL was set on --codedrobe-art. */
  heroInjected: boolean;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all checks passed. */
  success: boolean;
}

export interface ThemeVerification {
  /** --agentskin-accent value on :root */
  accent: string;
  /** --codedrobe-art value (truncated) */
  codedrobeArt: string;
  /** Whether #root or body has a blob: background */
  heroBlobActive: boolean;
  /** Number of adoptedStyleSheets with __agentskin flag */
  adoptedSheetCount: number;
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
  const { css, heroPath, heroDataUrl, hostClass, retries = 1, verifyDelayMs = 400 } = options;
  const hasHero = !!(heroPath || heroDataUrl);

  try {
    await session.send('Runtime.enable');
  } catch {
    return { cssInjected: false, heroInjected: false, verification: null, success: false };
  }

  // --- Step 1: Host class ---
  if (hostClass) {
    try {
      await session.evaluate(
        `document.documentElement.classList.add('${hostClass}'); 'ok'`,
      );
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

  const success = cssInjected && (!hasHero || heroInjected) && (verification?.heroBlobActive ?? !hasHero);

  return { cssInjected, heroInjected, verification, success };
}

// ---------------------------------------------------------------------------
// Engine-based multi-layer injection (L3/L4/L5 architecture)
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
  /** Hero image as data URL (data:image/webp;base64,...). */
  heroDataUrl?: string | null;
  /** Absolute path to hero.webp (alternative to heroDataUrl). */
  heroPath?: string | null;
  /** Agent identifier for logging (e.g. "doubao"). */
  agent?: string;
  /** Theme identifier for logging (e.g. "midnight-aurora"). */
  themeId?: string;
  /** Delay between injection and verification in ms (default 500). */
  verifyDelayMs?: number;
}

export interface InjectEngineResult {
  /** Number of CSS layers successfully adopted. */
  layersInjected: number;
  /** Whether the adapter JS executed successfully. */
  adapterApplied: boolean;
  /** Whether the hero blob URL was set. */
  heroInjected: boolean;
  /** Verification read-back values. */
  verification: ThemeVerification | null;
  /** Whether all critical checks passed. */
  success: boolean;
}

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
  const { paletteCss, tokensCss, cosmeticCss, themeCss, adapterJs, heroDataUrl, heroPath, agent, themeId, verifyDelayMs = 500 } = options;

  try {
    await session.send('Runtime.enable');
  } catch {
    return { layersInjected: 0, adapterApplied: false, heroInjected: false, verification: null, success: false };
  }

  // --- Step 1: Cleanup previous adapter instance ---
  try {
    await session.evaluate(`(() => { ${CLEAR_ADAPTERS_BODY}; return 'cleaned'; })()`);
  } catch {
    // Non-fatal — stale adapter cleanup is best-effort.
  }

  // --- Step 2: Hero blob URL ---
  let heroInjected = false;
  let heroBlobUrl = '';
  if (heroDataUrl) {
    heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
    if (heroInjected) {
      heroBlobUrl = await session.evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').trim().replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '')`,
      ) || '';
    }
  } else if (heroPath && existsSync(heroPath)) {
    heroInjected = await injectHeroBlob(session, heroPath);
    if (heroInjected) {
      heroBlobUrl = await session.evaluate(
        `getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').trim().replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '')`,
      ) || '';
    }
  }

  // --- Step 3: Set config for adapter ---
  const configJson = JSON.stringify({ heroBlobUrl, agent: agent || '', themeId: themeId || '' });
  try {
    await session.evaluate(`window.${RENDERER_CONFIG_GLOBAL} = ${configJson}; 'ok'`);
  } catch {
    // Non-fatal — adapter will run with defaults.
  }

  // --- Step 4: Inject CSS layers as separate adoptedStyleSheets ---
  const layers: [string, string][] = [
    ['palette', paletteCss],
    ['tokens', tokensCss],
    ['cosmetic', cosmeticCss],
    ...(themeCss ? [['theme', themeCss] as [string, string]] : []),
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
  } catch {
    adapterApplied = false;
  }

  // --- Step 5b: Register persistence via Page.addScriptToEvaluateOnNewDocument ---
  // The Runtime.evaluate injection above is ephemeral — it lives only in the
  // current document. When the agent navigates, reloads, or React remounts the
  // root, the adoptedStyleSheets and adapter marker are gone and the theme
  // disappears. Registering a script on new documents makes the engine
  // re-apply itself automatically on every navigation/reload, so the mjs
  // files stay "applied" for the lifetime of the CDP target.
  await registerEnginePersistence(session, options);

  // --- Step 6: Verify ---
  await delay(verifyDelayMs);
  const verification = await verifyTheme(session);

  const success = layersInjected >= 2 && adapterApplied && verification !== null;

  return { layersInjected, adapterApplied, heroInjected, verification, success };
}

/**
 * Register a self-contained re-application script via
 * `Page.addScriptToEvaluateOnNewDocument` so the engine layers (palette,
 * tokens, cosmetic, theme CSS) and adapter.mjs are re-applied automatically
 * whenever the target navigates or reloads. Without this, the injection
 * performed by `injectThemeViaEngine` is lost on every navigation.
 *
 * The registered script:
 *   1. Waits for `document.documentElement` (new documents may not have it yet)
 *   2. Re-injects each CSS layer as an adoptedStyleSheet (idempotent — the
 *      adapter.mjs already removes same-named layers before re-adding)
 *   3. Re-runs the adapter.mjs (idempotent — the adapter checks its marker
 *      and returns 'already-applied' if already running)
 *
 * Best-effort: failures here do NOT fail the overall injection because the
 * synchronous Runtime.evaluate pass has already applied the theme to the
 * current document. Persistence only matters for future navigations.
 */
async function registerEnginePersistence(
  session: CdpSession,
  options: InjectEngineOptions,
): Promise<void> {
  const { paletteCss, tokensCss, cosmeticCss, themeCss, adapterJs, heroDataUrl, heroPath, agent, themeId } = options;

  // Resolve the hero data URL up front so the persisted script can set
  // --codedrobe-art without re-reading the file (which it can't do from a
  // page context). If a heroPath was given instead, read it now.
  let resolvedHeroDataUrl = heroDataUrl ?? null;
  if (!resolvedHeroDataUrl && heroPath && existsSync(heroPath)) {
    try {
      const data = readFileSync(heroPath);
      const mime = heroPath.endsWith('.png') ? 'image/png'
        : heroPath.endsWith('.jpg') || heroPath.endsWith('.jpeg') ? 'image/jpeg'
        : 'image/webp';
      resolvedHeroDataUrl = `data:${mime};base64,${data.toString('base64')}`;
    } catch {
      resolvedHeroDataUrl = null;
    }
  }

  // Build the persistence script. Each layer is embedded as a JSON string
  // literal so the script is fully self-contained — no external lookups,
  // no closure variables, works in a fresh document context.
  const layersJson = JSON.stringify([
    ['palette', paletteCss],
    ['tokens', tokensCss],
    ['cosmetic', cosmeticCss],
    ...(themeCss ? [['theme', themeCss] as [string, string]] : []),
  ]);
  const configJson = JSON.stringify({ heroBlobUrl: '', agent: agent || '', themeId: themeId || '' });
  const heroDataUrlJson = JSON.stringify(resolvedHeroDataUrl);
  // The adapter.mjs is an IIFE that returns 'applied' / 'already-applied'.
  // Wrap it so we can invoke it from the persistence script.
  const adapterWrapper = `(function(){ ${adapterJs} })()`;

  // The persistence script. Runs in the page's main world on every new
  // document. Must be self-contained and idempotent.
  // Checks sessionStorage for a disable flag so {@link removeEngineInjection}
  // can stop re-application without tracking CDP script identifiers (which are
  // per-session and not easily reusable across connect/disconnect cycles).
  const persistenceScript = `(function() {
  'use strict';
  // Restore tears down the theme by setting this flag. The flag persists
  // across navigations within the same tab/session (sessionStorage scope),
  // so the persistence script will skip re-application on future navigations
  // until a new apply clears the flag.
  try {
    if (sessionStorage.getItem('${SESSION_DISABLED_KEY}') === '1') return;
  } catch (e) { /* sessionStorage may not be available in some contexts */ }
  var LAYERS = ${layersJson};
  var CONFIG = ${configJson};
  var HERO_DATA_URL = ${heroDataUrlJson};
  var ADAPTER = ${JSON.stringify(adapterWrapper)};

  function applyLayers() {
    if (!document || !document.adoptedStyleSheets) return 0;
    var injected = 0;
    for (var i = 0; i < LAYERS.length; i++) {
      var layerName = LAYERS[i][0];
      var layerCss = LAYERS[i][1];
      try {
        ${ADOPT_LAYER_BODY}
        injected++;
      } catch (e) { /* best-effort */ }
    }
    return injected;
  }

  function applyHero() {
    if (!HERO_DATA_URL || !HERO_DATA_URL.startsWith('data:')) return;
    try {
      var comma = HERO_DATA_URL.indexOf(',');
      var mime = (/^data:([^;,]+)/.exec(HERO_DATA_URL) || [])[1] || 'image/webp';
      var b64 = HERO_DATA_URL.slice(comma + 1);
      var binary = atob(b64);
      var bytes = new Uint8Array(binary.length);
      for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      var blob = new Blob([bytes], { type: mime });
      var url = URL.createObjectURL(blob);
      document.documentElement.style.setProperty('--codedrobe-art', 'url(' + url + ')');
    } catch (e) { /* best-effort */ }
  }

  function applyAdapter() {
    try {
      // Set config so the adapter can read heroBlobUrl/agent/themeId.
      window.${RENDERER_CONFIG_GLOBAL} = CONFIG;
      // Read back the hero blob URL we just set so the adapter picks it up.
      var artUrl = getComputedStyle(document.documentElement).getPropertyValue('--codedrobe-art').trim()
        .replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '');
      if (artUrl) {
        window.${RENDERER_CONFIG_GLOBAL} = Object.assign({}, CONFIG, { heroBlobUrl: artUrl });
      }
      // Evaluate the adapter IIFE.
      //
      // Why eval and not import()/postMessage? (evaluated 2026-07-25)
      //
      //   import() — requires serving the adapter from a URL (file:// or a
      //     custom agentskin:// scheme). Doubao/WorkBuddy ship strict CSP
      //     that blocks dynamic import from non-https origins; per-app CSP
      //     modification is fragile and defeats the stealth injection channel.
      //     Also async, which breaks first-paint timing.
      //
      //   postMessage — the bridge script itself would still be a CDP-injected
      //     string (same "code as string" problem, just moved). Async, so
      //     can't guarantee timing. Adds complexity without solving type safety.
      //
      //   The real concern is type safety, not eval itself. The fix is to
      //   compile engines/<agent>/adapter.mjs from TypeScript source so the
      //   adapter is type-checked at build time, while keeping the CDP
      //   evaluate as the runtime transport (it bypasses CSP by design).
      (0, eval)(ADAPTER);
    } catch (e) { /* best-effort */ }
  }

  function applyAll() {
    if (!document.documentElement) return;
    applyLayers();
    applyHero();
    applyAdapter();
  }

  // On new documents, document.documentElement may not exist yet. Wait for it.
  if (document.documentElement) {
    applyAll();
  } else {
    // Use a MutationObserver to apply as soon as <html> appears.
    var obs = new MutationObserver(function() {
      if (document.documentElement) {
        obs.disconnect();
        applyAll();
      }
    });
    obs.observe(document, { childList: true, subtree: false });
  }
})();`;

  try {
    await session.send('Page.enable');
    // Clear the disable flag so the persistence script will re-apply on
    // future navigations. This must happen BEFORE registering the script
    // so the script's first execution (on the next navigation) sees no flag.
    try {
      await session.evaluate(`(() => { try { sessionStorage.removeItem('${SESSION_DISABLED_KEY}'); } catch (e) {} return 'ok'; })()`);
    } catch {
      // sessionStorage may not be available yet — non-fatal, the script
      // itself has a try/catch around the flag check.
    }
    await session.send('Page.addScriptToEvaluateOnNewDocument', {
      source: persistenceScript,
      runImmediately: false,
    });
  } catch {
    // Best-effort — the current document is already themed by the
    // synchronous Runtime.evaluate pass. Persistence only affects future
    // navigations, so a failure here is non-fatal.
  }
}

/**
 * Remove the persistence script registered by {@link registerEnginePersistence}
 * and tear down the engine layers + adapter from the current document.
 * Called during theme restore so the engine doesn't re-apply itself on the
 * next navigation.
 *
 * This mirrors `injectThemeViaEngine`'s apply path: every DOM-bearing target
 * that received engine injection must be cleaned up here, otherwise stale
 * adoptedStyleSheets and adapter markers survive restore.
 *
 * Best-effort: never throws — callers use it in fire-and-forget restore paths.
 */
export async function removeEngineInjection(session: CdpSession): Promise<void> {
  // 1. Set the disable flag in sessionStorage. This persists across navigations
  //    within the same tab/session, so the persistence script registered by
  //    `registerEnginePersistence` will skip re-application on future
  //    navigations. We use sessionStorage instead of tracking CDP script
  //    identifiers because identifiers are per-session and not easily reusable
  //    across connect/disconnect cycles.
  try {
    await session.send('Runtime.enable');
    await session.evaluate(`(() => {
      try { sessionStorage.setItem('${SESSION_DISABLED_KEY}', '1'); } catch (e) {}
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

/**
 * Inject a single named CSS layer as an adoptedStyleSheet.
 * Each layer is tagged with __agentskin_layer for independent lifecycle management.
 * Delegates to {@link buildAdoptLayerExpression} in the shared injection kernel
 * so the adoption logic is defined exactly once across the codebase.
 */
async function injectCssLayer(session: CdpSession, layerName: string, css: string): Promise<boolean> {
  try {
    const result = await session.evaluate(buildAdoptLayerExpression(layerName, css));
    return result.startsWith('ok:');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Hero blob injection
// ---------------------------------------------------------------------------

async function injectHeroBlob(session: CdpSession, heroPath: string): Promise<boolean> {
  try {
    const data = readFileSync(heroPath);
    const base64 = data.toString('base64');
    const mime = heroPath.endsWith('.png') ? 'image/png'
      : heroPath.endsWith('.jpg') || heroPath.endsWith('.jpeg') ? 'image/jpeg'
      : 'image/webp';

    const result = await session.evaluate(`(async () => {
      try {
        const b64 = "${base64}";
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: '${mime}' });
        const url = URL.createObjectURL(blob);
        document.documentElement.style.setProperty('--codedrobe-art', 'url(' + url + ')');
        return 'ok:' + url.slice(0, 40);
      } catch(e) { return 'err:' + e.message; }
    })()`);

    return result.startsWith('ok:');
  } catch {
    return false;
  }
}

/**
 * Inject hero art from a data URL (data:image/webp;base64,...).
 * Used by the engine integration where ResolvedThemeTarget provides
 * imageDataUrls.hero as a data URL rather than a file path.
 */
async function injectHeroFromDataUrl(session: CdpSession, dataUrl: string): Promise<boolean> {
  try {
    // Extract mime and base64 payload from the data URL
    const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(dataUrl);
    if (!match) return false;
    const mime = match[1] || 'image/webp';
    const base64 = match[2];
    // For large images, chunk the base64 to avoid expression size limits.
    // CDP Runtime.evaluate handles up to ~100MB expressions, so direct is fine
    // for typical hero images (<500KB → ~680KB base64).
    const result = await session.evaluate(`(async () => {
      try {
        const b64 = ${JSON.stringify(base64)};
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: '${mime}' });
        const url = URL.createObjectURL(blob);
        document.documentElement.style.setProperty('--codedrobe-art', 'url(' + url + ')');
        return 'ok:' + url.slice(0, 40);
      } catch(e) { return 'err:' + e.message; }
    })()`);

    return result.startsWith('ok:');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// adoptedStyleSheets CSS injection
// ---------------------------------------------------------------------------

/**
 * Inject CSS as an unnamed owned adoptedStyleSheet.
 * Clears all previously-owned sheets first, then adds the new one.
 * Delegates to {@link buildAdoptOwnedSheetExpression} in the shared kernel.
 */
async function injectCssAdopted(session: CdpSession, css: string): Promise<boolean> {
  try {
    const result = await session.evaluate(buildAdoptOwnedSheetExpression(css));
    return result.startsWith('ok:');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

async function verifyTheme(session: CdpSession): Promise<ThemeVerification | null> {
  try {
    const raw = await session.evaluate(`(() => {
      const rootCs = getComputedStyle(document.documentElement);
      const root = document.getElementById('root') || document.body;
      const rootBg = getComputedStyle(root).backgroundImage || '';
      const bodyBg = getComputedStyle(document.body).backgroundImage || '';
      const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
      return JSON.stringify({
        accent: rootCs.getPropertyValue('--agentskin-accent').trim(),
        codedrobeArt: rootCs.getPropertyValue('--codedrobe-art').trim().slice(0, 60),
        heroBlobActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
        adoptedSheetCount: adopted,
      });
    })()`);

    return JSON.parse(raw) as ThemeVerification;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
