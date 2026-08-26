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
import type { CdpSession } from '../cdp/cdp-client';
import { type InjectEngineResult, injectThemeViaEngine } from '../cdp/cdp-inject';
import { themeHeroUrl } from '../theme/scheme';
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

    // Load engine files (+ shared runtime modules if present).
    // Injection order matters: adopted-sheets-manager → token-discovery → deep-core → adapter.
    const sharedDir = path.join(__dirname, '../../../../engines/shared');
    const adoptedSheetsManagerPath = path.join(sharedDir, 'adopted-sheets-manager.mjs');
    const tokenDiscoveryPath = path.join(sharedDir, 'token-discovery.mjs');
    const deepCorePath = path.join(sharedDir, 'deep-core.mjs');

    const [
      tokensCss,
      adapterJs,
      cosmeticCss,
      adoptedSheetsSource,
      tokenDiscoverySource,
      deepCoreSource,
    ] = await Promise.all([
      fs.readFile(tokensPath, 'utf8'),
      fs.readFile(adapterPath, 'utf8'),
      fs.readFile(cosmeticPath, 'utf8'),
      fs.readFile(adoptedSheetsManagerPath, 'utf8').catch(() => ''),
      fs.readFile(tokenDiscoveryPath, 'utf8').catch(() => ''),
      fs.readFile(deepCorePath, 'utf8').catch(() => ''),
    ]);

    // Source concatenation — prepend shared modules into the evaluate context
    // so adapter.mjs can reference them without import.
    // Order: adopted-sheets-manager (setter guard) → token-discovery (token scan) → deep-core → adapter.
    const parts = [];
    if (adoptedSheetsSource) parts.push(adoptedSheetsSource);
    if (tokenDiscoverySource) parts.push(tokenDiscoverySource);
    if (deepCoreSource) parts.push(deepCoreSource);
    parts.push(adapterJs);
    const finalAdapterJs = parts.join('\n;');

    const themeId = bundle.theme?.id ?? 'unknown';
    return await injectThemeViaEngine(session, {
      paletteCss,
      tokensCss,
      cosmeticCss,
      adapterJs: finalAdapterJs,
      // 4th layer: the full per-agent theme CSS (native token overrides +
      // visual styles). Injected AFTER engine layers so theme-specific
      // --dbx-*/--vscode-* values take precedence over engine var() mappings.
      themeCss: targetTheme.css,
      // 5th (final) layer: user-authored custom CSS, if any. Appended last so
      // it beats every theme layer at equal specificity.
      customCss: deps.customThemeCss?.() || undefined,
      imageDataUrls: imageDataUrls ?? undefined,
      // External-file hero (lossless 4K/8K wallpaper mode): stream the real
      // file via the chunked CDP transfer (injectHeroBlob → transferHeroBase64,
      // WALLPAPER_CHUNK_SIZE=512KB keeps every evaluate inside the CDP timeout).
      // NOTE: agentskin-theme:// protocol URLs are NOT used for target apps —
      // their pages run under their own CSP which blocks the custom scheme
      // (verified: blockedReason=csp). Only used when no embedded hero data URL
      // is present (imageDataUrls.hero wins — legacy embedded bundles keep
      // their existing behavior).
      heroPath: !imageDataUrls?.hero && imageFilePaths?.hero ? imageFilePaths.hero : undefined,
      agent: appId,
      themeId,
      verifyDelayMs: deps.verifyDelayMs ?? 500,
      verifyIntervalMs: deps.verifyIntervalMs ?? 50,
    });
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
