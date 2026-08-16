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

import { readFile } from 'node:fs/promises';
import {
  DEFAULT_VERIFY_DELAY_MS,
  RENDERER_CONFIG_GLOBAL,
  SESSION_DISABLED_KEY,
} from '../../../shared/injection-constants';
import {
  ADOPT_LAYER_BODY,
  buildClearEngineInjectionExpression,
  CLEAR_ADAPTERS_BODY,
} from '../../../shared/injection-runtime';
import { mainWarnFromCatch } from '../../logger';
import type { CdpSession } from '../cdp-client';
import { injectCssLayer } from './css-inject';
import { injectHeroBlob, injectHeroFromDataUrl } from './hero-inject';
import { waitForTheme } from './shared';
import type { ThemeVerification } from './types';

// ---------------------------------------------------------------------------
// Persistence-script identifier tracking (P1 audit #8)
// ---------------------------------------------------------------------------

/**
 * Tracks the `Page.addScriptToEvaluateOnNewDocument` identifier returned by
 * CDP for each agent's persistence script, keyed by agent id.
 *
 * Why this exists: every `apply` call previously registered a fresh
 * persistence script via `Page.addScriptToEvaluateOnNewDocument` without
 * ever calling `Page.removeScriptToEvaluateOnNewDocument`. After N theme
 * switches the target carried N scripts, all of which executed on every
 * navigation (only the last one's CSS won, but the first N-1 still wasted
 * execution time and memory — each can be 500KB+ with a base64 hero).
 *
 * Lifecycle:
 *   - {@link registerEnginePersistence} removes any previously-tracked
 *     identifiers for the agent (best-effort — the target may have changed
 *     since the last apply, in which case the old identifiers are already
 *     gone with the old target) before registering the new script.
 *   - The new identifier is recorded here so the next apply (or a restore
 *     via {@link removeEngineInjection}) can clean it up.
 *
 * Module-scoped because there is one CDP injection module per process and
 * the identifiers are per-target (not per-session), so any session on the
 * same target can remove a script registered by a previous session.
 */
const persistenceScriptIds = new Map<string, Set<string>>();

/**
 * Remove all previously-registered persistence scripts for an agent from the
 * given session's target. Best-effort: identifiers from a previous target
 * (e.g. after an app restart) are invalid and the CDP call silently fails,
 * which is fine — the old target is gone and took its scripts with it.
 */
async function removeOldPersistenceScripts(session: CdpSession, agent: string): Promise<void> {
  const ids = persistenceScriptIds.get(agent);
  if (!ids?.size) return;
  for (const identifier of ids) {
    try {
      await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    } catch {
      // Identifier may be from a previous target — silently ignore.
    }
  }
  ids.clear();
}

/** Record a freshly-registered persistence-script identifier for an agent. */
function trackPersistenceScript(agent: string, identifier: string): void {
  let set = persistenceScriptIds.get(agent);
  if (!set) {
    set = new Set();
    persistenceScriptIds.set(agent, set);
  }
  set.add(identifier);
}

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
    heroDataUrl,
    heroPath,
    agent,
    themeId,
    verifyDelayMs = DEFAULT_VERIFY_DELAY_MS,
    verifyIntervalMs = 50,
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

  // --- Step 2: Hero blob URL ---
  let heroInjected = false;
  let heroBlobUrl = '';
  if (heroDataUrl) {
    heroInjected = await injectHeroFromDataUrl(session, heroDataUrl);
    if (heroInjected) {
      heroBlobUrl =
        (await session.evaluate(
          `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim().replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '')`,
        )) || '';
    }
  } else if (heroPath) {
    heroInjected = await injectHeroBlob(session, heroPath);
    if (heroInjected) {
      heroBlobUrl =
        (await session.evaluate(
          `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim().replace(/^url\\(["']?/, '').replace(/["']?\\)$/, '')`,
        )) || '';
    }
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

  // --- Step 5b: Register persistence via Page.addScriptToEvaluateOnNewDocument ---
  // The Runtime.evaluate injection above is ephemeral — it lives only in the
  // current document. When the agent navigates, reloads, or React remounts the
  // root, the adoptedStyleSheets and adapter marker are gone and the theme
  // disappears. Registering a script on new documents makes the engine
  // re-apply itself automatically on every navigation/reload, so the mjs
  // files stay "applied" for the lifetime of the CDP target.
  await registerEnginePersistence(session, options);

  // --- Step 6: Verify (polling with timeout) ---
  const verification = await waitForTheme(session, {
    timeoutMs: 3000,
    intervalMs: verifyIntervalMs,
    minDelayMs: verifyDelayMs,
  });

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
  const {
    paletteCss,
    tokensCss,
    cosmeticCss,
    themeCss,
    customCss,
    adapterJs,
    heroDataUrl,
    heroPath,
    agent,
    themeId,
  } = options;

  // Resolve the hero data URL up front so the persisted script can set
  // --agentskin-art without re-reading the file (which it can't do from a
  // page context). If a heroPath was given instead, read it now.
  let resolvedHeroDataUrl = heroDataUrl ?? null;
  if (!resolvedHeroDataUrl && heroPath) {
    try {
      const data = await readFile(heroPath);
      const mime = heroPath.endsWith('.png')
        ? 'image/png'
        : heroPath.endsWith('.jpg') || heroPath.endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/webp';
      resolvedHeroDataUrl = `data:${mime};base64,${data.toString('base64')}`;
    } catch (err) {
      resolvedHeroDataUrl = null;
      mainWarnFromCatch('cdp/engine', err, `read hero file failed for agent=${agent ?? 'unknown'}`);
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
    ...(customCss ? [['custom', customCss] as [string, string]] : []),
  ]);
  const configJson = JSON.stringify({
    heroBlobUrl: '',
    agent: agent || '',
    themeId: themeId || '',
  });
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
      document.documentElement.style.setProperty('--agentskin-art', 'url(' + url + ')');
    } catch (e) { /* best-effort */ }
  }

  function applyAdapter() {
    try {
      // Set config so the adapter can read heroBlobUrl/agent/themeId.
      window.${RENDERER_CONFIG_GLOBAL} = CONFIG;
      // Read back the hero blob URL we just set so the adapter picks it up.
      var artUrl = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim()
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
      await session.evaluate(
        `(() => { try { sessionStorage.removeItem('${SESSION_DISABLED_KEY}'); } catch (e) { console.warn('[engine-strategy] sessionStorage.removeItem failed:', e); } return 'ok'; })()`,
      );
    } catch {
      // sessionStorage may not be available yet — non-fatal, the script
      // itself has a try/catch around the flag check.
    }
    // P1 audit #8: remove any persistence scripts previously registered for
    // this agent before adding the new one. Without this, every theme switch
    // piled a new script onto the target and all old scripts kept executing
    // on every navigation (wasting memory + execution time, only the last
    // one's CSS won). The old identifiers may be from a previous target
    // (after an app restart) — those are already gone, removal is a no-op.
    const agentKey = agent || '__unknown__';
    await removeOldPersistenceScripts(session, agentKey);
    const result = await session.send<{ identifier?: string }>(
      'Page.addScriptToEvaluateOnNewDocument',
      {
        source: persistenceScript,
        runImmediately: false,
      },
    );
    if (result?.identifier) {
      trackPersistenceScript(agentKey, result.identifier);
    }
  } catch (err) {
    // Best-effort — the current document is already themed by the
    // synchronous Runtime.evaluate pass. Persistence only affects future
    // navigations, so a failure here is non-fatal. Log for diagnostics.
    mainWarnFromCatch(
      'cdp/engine',
      err,
      `register persistence failed for agent=${agent ?? 'unknown'}`,
    );
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
 * P1 audit #8: when `agent` is provided, also removes the tracked
 * `Page.addScriptToEvaluateOnNewDocument` identifiers for that agent so the
 * script is fully torn down (not just disabled via sessionStorage). This
 * closes the leak where N theme switches left N dead scripts on the target.
 *
 * Best-effort: never throws — callers use it in fire-and-forget restore paths.
 */
export async function removeEngineInjection(session: CdpSession, agent?: string): Promise<void> {
  // 1. Remove the tracked persistence-script identifiers from the target.
  //    P1 audit #8: previously we only set a sessionStorage disable flag,
  //    which left the script registered on the target forever. After N
  //    theme switches the target carried N dead scripts. Now we remove them
  //    explicitly so the target is clean.
  if (agent) {
    await removeOldPersistenceScripts(session, agent);
  }

  // 2. Set the disable flag in sessionStorage as a belt-and-suspenders
  //    fallback. This persists across navigations within the same tab/session,
  //    so any persistence script we couldn't remove (e.g. registered by a
  //    previous process incarnation whose identifiers we never tracked) will
  //    still skip re-application on future navigations.
  try {
    await session.send('Runtime.enable');
    await session.evaluate(`(() => {
      try { sessionStorage.setItem('${SESSION_DISABLED_KEY}', '1'); } catch (e) { console.warn('[engine-strategy] sessionStorage.setItem failed:', e); }
      return 'ok';
    })()`);
  } catch {
    // Best-effort — target may not have sessionStorage yet.
  }

  // 3. Tear down the engine layers + adapter from the current document.
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
 * Drop module-scoped tracking state for a single agent. Called when a theme
 * is fully removed from an agent (restore + no future re-apply scheduled) so
 * stale script identifiers or cached values do not accumulate across the
 * uptime of a long-running tray app.
 */
export function cleanupEngineInjectionForAgent(agent: string): void {
  persistenceScriptIds.delete(agent);
}

/**
 * Drop ALL module-scoped tracking state. Called only on app shutdown to
 * release references before GC; without this, the maps retain identifiers
 * for every agent that was ever themed during the process lifetime.
 */
export function disposeEngineInjectionState(): void {
  persistenceScriptIds.clear();
}
