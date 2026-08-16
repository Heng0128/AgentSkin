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
  const packagedDir = path.join(process.resourcesPath, 'engines', appId);
  const devDir = path.join(__dirname, '..', '..', '..', 'engines', appId);
  const probeFile = path.join(packagedDir, 'adapter.mjs');
  try {
    await fs.access(probeFile);
    return packagedDir;
  } catch {
    return devDir;
  }
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
  heroDataUrl: string | null,
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
    if (!paletteCss) return null;

    // Load engine files
    const [tokensCss, adapterJs, cosmeticCss] = await Promise.all([
      fs.readFile(tokensPath, 'utf8'),
      fs.readFile(adapterPath, 'utf8'),
      fs.readFile(cosmeticPath, 'utf8'),
    ]);

    const themeId = bundle.theme?.id ?? 'unknown';
    return await injectThemeViaEngine(session, {
      paletteCss,
      tokensCss,
      cosmeticCss,
      adapterJs,
      // 4th layer: the full per-agent theme CSS (native token overrides +
      // visual styles). Injected AFTER engine layers so theme-specific
      // --dbx-*/--vscode-* values take precedence over engine var() mappings.
      themeCss: targetTheme.css,
      // 5th (final) layer: user-authored custom CSS, if any. Appended last so
      // it beats every theme layer at equal specificity.
      customCss: deps.customThemeCss?.() || undefined,
      heroDataUrl,
      agent: appId,
      themeId,
      verifyDelayMs: deps.verifyDelayMs ?? 500,
      verifyIntervalMs: deps.verifyIntervalMs ?? 50,
    });
  } catch (error) {
    deps.log(`[hardening] ${appId}: engine injection failed: ${toMessage(error)}`);
    return null;
  }
}
