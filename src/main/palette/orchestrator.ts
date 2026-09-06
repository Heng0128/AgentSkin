// SPDX-License-Identifier: MPL-2.0

/**
 * # Engine Injection Orchestrator
 *
 * Loads engine files from disk, builds the palette CSS via {@link buildPaletteCss},
 * and delegates the actual CDP injection to `injectThemeViaEngine`.
 *
 * Extracted from the former `palette-builder.ts` (P3 of the god-object
 * teardown) to separate the **orchestration** concern (this module — filesystem
 * reads + CDP delegation) from the **generation** concern (`generator.ts` —
 * pure CSS transformation).
 *
 * Shared adapter engine: the former 7 separate modules (style-injector,
 * adapter-engine, token-discovery, self-heal, deep-core, visual-engine,
 * verify-and-feedback) are now consolidated into the unified engine at
 * `engines/unified/engine.mjs`.  See {@link getSharedModuleList} for the
 * module list and {@link buildApplyExpression} for concatenation.
 *
 * Stateless w.r.t. `applyEpoch` — the caller (hardeningPass) is responsible
 * for `isEpochCurrent` checks before/after this call.
 *
 * Call chain:
 *   AgentEngineService.hardeningPass → tryEngineInjection → injectThemeViaEngine (cdp-inject)
 *                                                  └→ buildPaletteCss (generator.ts)
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ResolvedThemeTarget, ThemeBundle } from '../../legacy/agentskin-core-runtime';
import { toMessage } from '../../shared/errors';
import { buildContrastFallbackExpression } from '../../shared/injection-runtime';
import { sanitizeCSS } from '../../shared/safe-css';
import type { CdpSession } from '../cdp/cdp-client';
import { type InjectEngineResult, injectThemeViaEngine } from '../cdp/cdp-inject';
import { PersistenceSessionManager } from '../cdp/injection/persistence-session-manager';
import { buildPaletteCss } from './generator';

// ---------------------------------------------------------------------------
// Dependency injection interface
// ---------------------------------------------------------------------------

export interface EngineInjectionDeps {
  /**
   * Resolve the engine directory for an agent. In packaged builds this is
   * `process.resourcesPath/engines/<agent>/`; in dev it falls back to the
   * project root. Injected so unit tests can stub the filesystem.
   */
  resolveEngineDir(appId: string): Promise<string>;
  /** Logger sink (usually `AgentEngineService.log`). */
  log(line: string): void;
  /** Global user-authored custom CSS (custom.css), empty when unset. Injected
   *  as the final CSS layer so user overrides win over every theme layer. */
  customThemeCss?: () => string;
  /** Per-agent min verify delay (default 500ms, RFC §4.8 fast-path tuning). */
  verifyDelayMs?: number;
  /** Per-agent verification poll interval (default 50ms, RFC §4.8). */
  verifyIntervalMs?: number;
  /**
   * Phase 4 (RFC — addScriptToEvaluateOnNewDocument persistence): when true,
   * the orchestrator additionally registers the unified engine factory
   * and the agent adapter-config via CDP `Page.addScriptToEvaluateOnNewDocument`,
   * then generates and registers a self-healing bootstrap (via the engine's
   * installPersistScript) so the adapter auto-re-injects on SPA navigation and
   * page reload. Default false — the existing Runtime.evaluate path (which
   * already runs through injectThemeViaEngine) is kept as fallback for the
   * current page. The CDP-registered scripts only fire on *future* documents.
   * Best-effort: CDP registration failures are logged but never throw.
   */
  usePersistScript?: boolean;
}

// ---------------------------------------------------------------------------
// Module list & layer order
// ---------------------------------------------------------------------------

/**
 * Descriptor for a shared engine module loaded from disk.
 *
 * The unified engine at `engines/unified/engine.mjs` replaces the former
 * 7 separate shared modules (style-injector, adapter-engine, token-discovery,
 * self-heal, deep-core, visual-engine, verify-and-feedback).
 */
export interface AssetModule {
  /** Stable identifier used in logging and error messages. */
  id: string;
  /** Relative path from project root to the .mjs source file. */
  file: string;
  /**
   * Injection layer this module belongs to.  The unified engine spans the
   * `engine` layer which formerly covered token-discovery → self-heal → deep-core
   * → visual-engine → verify — all now consolidated into one IIFE.
   */
  layer: 'engine' | 'adapter' | 'theme' | 'custom';
}

/**
 * Return the list of shared engine modules to load and concatenate before
 * the agent adapter.  After the 2026-08-31 unification, this is a single
 * entry: the unified engine that merges all 7 former shared modules.
 *
 * Layer ownership (5-layer architecture, RFC 2026-08-31):
 *   palette  → engine-strategy (14 tokens)
 *   tokens   → engine-strategy (native token overrides)
 *   cosmetic → engine-strategy (visual tweaks)
 *   theme    → engine-strategy (per-agent theme CSS)
 *   custom   → engine-strategy + adapter (user CSS + visual + adapter + DeepCore)
 */
export function getSharedModuleList(): AssetModule[] {
  return [
    { id: 'self-heal-patrol', file: 'engines/shared/self-heal-patrol.mjs', layer: 'engine' },
    { id: 'unified-engine', file: 'engines/unified/engine.mjs', layer: 'engine' },
  ];
}

/**
 * Compute and return the canonical layer injection order.
 *
 * Preserves the 5-layer ownership model — only the number of shared modules
 * between `cosmetic` and `theme` changed (from 7 separate files to 1 unified engine).
 */
export function computeLayerOrder(): string[] {
  return ['palette', 'tokens', 'cosmetic', 'theme', 'custom'];
}

/**
 * Build the final JavaScript expression that will be evaluated in-page via
 * CDP Runtime.evaluate.  Concatenates (in order):
 *
 *   1. Unified engine.mjs (adapter factory + sheet manager + token discovery
 *      + self-heal + DeepCore + visual CSS + persist + patrol)
 *   2. adapter-config.mjs (optional per-agent config, may be empty)
 *   3. adapter.mjs (thin per-agent wrapper / legacy IIFE)
 *
 * The `\n;` separator guarantees each module gets its own statement context
 * while remaining valid as a single script body.
 */
export function buildApplyExpression(parts: {
  unifiedEngineSource: string;
  adapterConfigSource: string;
  adapterJs: string;
}): string {
  const chain: string[] = [];
  if (parts.unifiedEngineSource) chain.push(parts.unifiedEngineSource);
  if (parts.adapterConfigSource) chain.push(parts.adapterConfigSource);
  chain.push(parts.adapterJs);
  return chain.join('\n;');
}

// ---------------------------------------------------------------------------
// Default engine dir resolver
// ---------------------------------------------------------------------------

/**
 * Default engine dir resolver used by the production orchestrator.
 * Tries `process.resourcesPath/engines/<agent>/adapter.mjs` first (packaged),
 * falls back to `<projectRoot>/engines/<agent>/` (dev mode).
 */
export async function resolveEngineDirDefault(appId: string): Promise<string> {
  // Packaged: engines ship under process.resourcesPath/engines/<appId>.
  const packagedDir = path.join(process.resourcesPath, 'engines', appId);
  const probeFile = path.join(packagedDir, 'adapter.mjs');
  try {
    await fs.access(probeFile);
    return packagedDir;
  } catch {
    // not packaged — fall through to dev/preview paths
  }

  // Dev / preview: engine sources live in the project root `engines/<appId>`.
  // `__dirname` resolves to `out/main` after electron-vite build, so relative
  // traversal is fragile; `app.getAppPath()` returns the project root in both
  // `electron-vite dev` and `electron-vite preview` (unpackaged) runs. Probe
  // several likely roots and return the first that contains adapter.mjs.
  const candidates = (
    await import('electron').catch(() => ({ app: undefined }))
  ).app?.getAppPath?.();
  const roots = [
    candidates,
    path.resolve(process.cwd()),
    path.join(__dirname, '..', '..'), // out/main -> project root
    path.join(__dirname, '..', '..', '..'),
  ].filter((r): r is string => !!r && typeof r === 'string');
  for (const root of roots) {
    const candidate = path.join(root, 'engines', appId);
    try {
      await fs.access(path.join(candidate, 'adapter.mjs'));
      return candidate;
    } catch {
      // try next root
    }
  }
  return devDirFallback(appId);
}

/** Last-resort dev dir (kept for legacy callers/tests). */
function devDirFallback(appId: string): string {
  return path.join(__dirname, '..', '..', '..', 'engines', appId);
}

// ---------------------------------------------------------------------------
// Engine injection orchestration
// ---------------------------------------------------------------------------

/**
 * Attempt engine-based multi-layer injection (L3/L4/L5 architecture).
 * Loads palette from the resolved per-agent CSS + `engines/{appId}/` files
 * from app resources. Returns null if engine files are not available
 * (triggers legacy fallback in the caller).
 *
 * Stateless w.r.t. `applyEpoch` — the caller (hardeningPass) is responsible
 * for `isEpochCurrent` checks before/after this call.
 */
export async function tryEngineInjection(
  session: CdpSession,
  appId: string,
  bundle: ThemeBundle,
  targetTheme: ResolvedThemeTarget,
  imageDataUrls: Record<string, string> | null,
  imageFilePaths: Record<string, string> | null | undefined,
  deps: EngineInjectionDeps,
): Promise<InjectEngineResult | null> {
  try {
    const engineDir = await deps.resolveEngineDir(appId);

    const tokensPath = path.join(engineDir, 'tokens.css');
    const adapterPath = path.join(engineDir, 'adapter.mjs');
    const cosmeticPath = path.join(engineDir, 'cosmetic.css');

    // Check all engine files exist
    const [tokensExists, adapterExists, cosmeticExists] = await Promise.all([
      fs
        .access(tokensPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(adapterPath)
        .then(() => true)
        .catch(() => false),
      fs
        .access(cosmeticPath)
        .then(() => true)
        .catch(() => false),
    ]);
    if (!tokensExists || !adapterExists || !cosmeticExists) {
      return null; // Engine files not available → legacy fallback
    }

    // Build palette CSS from the resolved per-agent CSS so agent-specific
    // palette overrides (e.g. doubao's darker --agentskin-code-bg) are
    // respected and --agentskin-*-raw RGB triplets are derived for the
    // engine tokens.css that references var(--agentskin-accent-raw) etc.
    const paletteCss = buildPaletteCss(targetTheme.css);
    if (!paletteCss) {
      throw new Error(
        `Failed to build palette CSS for agent=${appId} theme=${bundle.theme?.id ?? 'unknown'}: ` +
          'theme CSS is empty or has fewer than 6 --agentskin-* declarations (malformed theme)',
      );
    }

    // Load unified engine (merges former 7 shared modules into one IIFE).
    // 2026-08-31 Engine Unification (RFC-2026-08-31):
    // engines/unified/engine.mjs replaces:
    //   style-injector.mjs     (sheet manager)
    //   adapter-engine.mjs     (createAdapter factory)
    //   token-discovery.mjs    (native token scan)
    //   self-heal.mjs          (AdaptiveMutationObserver + patrol)
    //   deep-core.mjs          (shadow DOM patches + fragment registry)
    //   visual-engine.mjs      (--ag-* variables + static visual CSS)
    //   verify-and-feedback.mjs (boundary checks + essentials verify)
    const sharedModules = getSharedModuleList();
    const projectRootForEngines = path.join(__dirname, '../../../../');

    // Read all shared modules (self-heal-patrol + unified engine)
    const sharedSources = await Promise.all(
      sharedModules.map((m) =>
        fs.readFile(path.join(projectRootForEngines, m.file), 'utf8').catch(() => ''),
      ),
    );
    const selfHealPatrolSource = sharedSources[0] || '';
    const unifiedEngineSource = sharedSources[1] || '';

    // Agent-specific adapter-config.mjs (optional).  When present it is
    // concatenated AFTER the unified engine and BEFORE adapter.mjs so that
    // the adapter's thin wrapper can reference the exported config object.
    const adapterConfigPath = path.join(engineDir, 'adapter-config.mjs');

    const [tokensCss, adapterJs, cosmeticCss, adapterConfigSource] = await Promise.all([
      fs.readFile(tokensPath, 'utf8'),
      fs.readFile(adapterPath, 'utf8'),
      fs.readFile(cosmeticPath, 'utf8'),
      fs.readFile(adapterConfigPath, 'utf8').catch(() => ''),
    ]);

    // Source concatenation — self-heal-patrol + unified engine → adapter-config → adapter.
    // Order preserved per LayerOwnership: self-heal-patrol (globals) + engine.mjs
    // (factory + all subsystems) come first, then optional per-agent config,
    // then the adapter thin wrapper.
    const finalAdapterJs = buildApplyExpression({
      unifiedEngineSource: selfHealPatrolSource + '\n;' + unifiedEngineSource,
      adapterConfigSource,
      adapterJs,
    });

    // Append WCAG AA contrast fallback IIFE after the adapter chain
    const contrastFallbackExpr = buildContrastFallbackExpression();
    const finalJsWithFallback = `${finalAdapterJs}\n;(${contrastFallbackExpr});`;

    const themeId = bundle.theme?.id ?? 'unknown';

    // P4: Sanitize user-authored custom CSS before it reaches CDP injection.
    // The custom layer is the final (5th) layer and would otherwise bypass all
    // theme-layer safety checks. sanitizeCSS strips dangerous properties
    // (behavior, -webkit-app-region), external URLs, and JS payloads while
    // preserving cosmetic declarations. Blocked content is logged so the user
    // can see why their CSS was trimmed.
    const rawCustomCss = deps.customThemeCss?.() || undefined;
    let customCss: string | undefined;
    if (rawCustomCss) {
      const { clean, blocked, reasons } = sanitizeCSS(rawCustomCss);
      customCss = clean || undefined;
      if (blocked) {
        deps.log(
          `[safe-css] ${appId}: stripped ${reasons.length} threat(s) from custom CSS: ${reasons.join(', ')}`,
        );
      }
    } else {
      customCss = undefined;
    }

    // 2026-09-01: 原子化注入 — 主进程侧预先将 hero 图片转为 data URL。
    // 优先使用已嵌入的 data URL (imageDataUrls.hero), 否则使用文件路径 (imageFilePaths.hero)。
    // 主进程会在 resolveHeroDataUrl 中读取文件并转为 base64 data URL。
    const heroDataUrl = imageDataUrls?.hero ?? null;

    const result = await injectThemeViaEngine(session, {
      paletteCss,
      tokensCss,
      cosmeticCss,
      adapterJs: finalJsWithFallback,
      // 4th layer: the full per-agent theme CSS (native token overrides +
      // visual styles). Injected AFTER engine layers so theme-specific
      // --dbx-*/--vscode-* values take precedence over engine var() mappings.
      themeCss: targetTheme.css,
      // 5th (final) layer: sanitized user-authored custom CSS, if any.
      customCss,
      // Hero image: data URL (preferred, atomic) — inlined into the single evaluate IIFE.
      // For file-path heroes, the main process reads the file synchronously via resolveHeroDataUrl.
      heroDataUrl,
      heroPath: !heroDataUrl && imageFilePaths?.hero ? imageFilePaths.hero : undefined,
      agent: appId,
      themeId,
      verifyDelayMs: deps.verifyDelayMs ?? 500,
      verifyIntervalMs: deps.verifyIntervalMs ?? 50,
    });

    // Phase 4: requestAnimationFrame-level persistence. When the caller opts
    // in via `usePersistScript`, we additionally register the engine factory
    // and agent config via CDP `Page.addScriptToEvaluateOnNewDocument` so that
    // future navigations / SPA route changes get a fresh adapter instance
    // without a re-trip through the apply path. Best-effort: any CDP failure
    // is logged but never thrown (return value already reflects the current
    // page's result).
    if (deps.usePersistScript) {
      await registerAdapterPersistScripts(
        session,
        appId,
        unifiedEngineSource,
        adapterConfigSource || undefined,
        deps,
      );
    }

    return result;
  } catch (error) {
    // Distinguish between "engine files not available" (return null → caller
    // falls back to legacy) and "engine injection failed" (re-throw → caller
    // notifies the user and then falls back). The former is an expected
    // condition for agents without engine support; the latter is a real
    // failure (malformed theme, CDP layer adoption failure) that the user
    // should know about.
    const message = toMessage(error);
    deps.log(`[hardening] ${appId}: engine injection failed: ${message}`);
    throw new Error(`Engine injection failed for agent=${appId}: ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Module-level PersistenceSessionManager singleton
// ---------------------------------------------------------------------------

/**
 * Module-level PersistenceSessionManager instance.  Cross apply/remove calls
 * reuse the long-lived session.  Obtained via {@link getPersistenceManager};
 * replaceable in tests.
 */
let gPersistenceManager: PersistenceSessionManager | null = null;

export function getPersistenceManager(): PersistenceSessionManager {
  if (!gPersistenceManager) {
    gPersistenceManager = new PersistenceSessionManager();
  }
  return gPersistenceManager;
}

/** Test/cleanup helper: reset the singleton. */
export function resetPersistenceManager(): void {
  gPersistenceManager = null;
}

// ---------------------------------------------------------------------------
// Phase 4 — addScriptToEvaluateOnNewDocument persistence
// ---------------------------------------------------------------------------

/**
 * Unified engine namespace marker.  The unified engine registers its subsystems
 * under the `window.__agentskin__` namespace (e.g. `__agentskin__.engine`,
 * `__agentskin__.sheetManager`).  We use the namespace marker here.
 *
 * Historical note: older engine versions also set bare globals like
 * `__agentskin_unified_engine__` and `__agentskin_shared_engine__` for
 * backward-compat.  These are now enumerated in
 * `LEGACY_BARE_GLOBALS` (injection-runtime.ts) and cleaned up during theme
 * restore / switch.  New code should reference `window.__agentskin__`.
 *
 * Only the DATA-ONLY subset of the agent config reaches the page here —
 * function hooks (`applyHeuristicOverride`, `onReinject`, `onHealthCheck`)
 * never survive JSON serialization and must be delivered via
 * `Page.addScriptToEvaluateOnNewDocument` registration of the
 * adapter-config source itself (step 2 below).
 */
const PERSIST_ENGINE_MARKER = '__agentskin__';

/**
 * Register the unified engine factory and a self-healing bootstrap via CDP
 * `Page.addScriptToEvaluateOnNewDocument`. Best-effort — every step is wrapped
 * in try/catch; a failure is logged and the function returns gracefully so the
 * caller can still rely on the Runtime.evaluate path having themed the current
 * page.
 *
 * The unified engine's `installPersistScript` is used (same API as the former
 * adapter-engine). It gates itself with `__agentskin_persist_active__` and
 * creates a fresh adapter via `createAdapter(window.__ADAPTER_ENGINE_CONFIG__)`.
 *
 * @param session      operation-scoped CDP session.
 * @param appId        agent id (for logging).
 * @param engineSource full source of unified engine.mjs (browser-side factory).
 * @param configSource source of adapter-config.mjs, when present.
 * @param deps         dependency-injection bag (log sink at minimum).
 */
export async function registerAdapterPersistScripts(
  session: CdpSession,
  appId: string,
  engineSource: string,
  configSource: string | undefined,
  deps: EngineInjectionDeps,
): Promise<void> {
  // Step 0: enable the Page domain so addScriptToEvaluateOnNewDocument is accepted.
  try {
    await session.send('Page.enable');
  } catch (err) {
    deps.log(`[persist] ${appId}: Page.enable failed: ${toMessage(err)}`);
    return;
  }

  const pm = getPersistenceManager();
  const targetId = 'primary';

  try {
    // Step 1: register the unified engine source through PersistenceSessionManager.
    // The manager stores the session under `${appId}:${targetId}` so that
    // subsequent addScript calls reuse the same long-lived CDP binding.
    if (engineSource) {
      await pm.addScript(appId, targetId, engineSource, session);
    }

    // Step 2: register the agent config IIFE. Its `window.<agent>_config__`
    // global also carries the non-serializable hooks (applyHeuristicOverride
    // etc.) — these are what the persist bootstrap merges back into the
    // JSON data-only config (see unified engine installPersistScript).
    if (configSource) {
      await pm.addScript(appId, targetId, configSource, session);
    }

    deps.log(`[persist] ${appId}: persistence session registered for target=${targetId}`);
  } catch (err) {
    deps.log(`[persist] ${appId}: persistence registration failed: ${toMessage(err)}`);
  }

  try {
    // Step 3: build a JSON-serializable DATA-ONLY snapshot of the agent
    // config. The full object contains functions that never survive
    // JSON.stringify, so we read `window.<agent>_config__` in-page and
    // strip non-serializable entries.
    const dataConfigJson = await session.evaluate(`(() => {
      const re = /^__agentskin_.+_config__$/;
      for (const k in window) {
        if (!re.test(k)) continue;
        const cfg = window[k];
        if (!cfg || typeof cfg !== 'object') continue;
        const data = {};
        for (const key in cfg) {
          if (typeof cfg[key] === 'function') continue;
          data[key] = cfg[key];
        }
        return JSON.stringify(data);
      }
      return 'null';
    })()`);

    if (dataConfigJson === 'null' || dataConfigJson === 'undefined') {
      deps.log(
        `[persist] ${appId}: no agent config global found on window — persist bootstrap skipped`,
      );
      return;
    }

    // Step 4: invoke the engine's installPersistScript(data) in-page to get a
    // self-contained IIFE that gates itself with a persist marker, reads
    // window.__ADAPTER_ENGINE_CONFIG__ (set by the IIFE), and bootstraps a
    // fresh adapter. Registration below runs that IIFE on every future doc.
    const persistSource = await session.evaluate(`(() => {
      const eng = window[${JSON.stringify(PERSIST_ENGINE_MARKER)}];
      if (!eng || typeof eng.installPersistScript !== 'function') {
        return 'no-engine';
      }
      return eng.installPersistScript(${dataConfigJson});
    })()`);

    if (persistSource === 'no-engine') {
      deps.log(`[persist] ${appId}: engine factory not present — persist bootstrap skipped`);
      return;
    }

    // Step 5: register the persist IIFE through PersistenceSessionManager.
    await pm.addScript(appId, targetId, persistSource, session);

    deps.log(`[persist] ${appId}: registerAdapterPersistScripts succeeded`);
  } catch (err) {
    deps.log(`[persist] ${appId}: registerAdapterPersistScripts failed: ${toMessage(err)}`);
  }
}
