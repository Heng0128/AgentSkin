// SPDX-License-Identifier: MPL-2.0

/**
 * # Palette Builder
 *
 * Extracted from `AgentEngineService` (P1-1 of the god-object teardown).
 *
 * Owns two concerns that used to live as private methods on the orchestrator:
 *   - {@link buildPaletteCss}: pure transformation — per-agent theme CSS →
 *     palette.css with derived `--agentskin-*-raw` RGB triplets.
 *   - {@link tryEngineInjection}: loads engine files from disk and calls
 *     `injectThemeViaEngine`. Stateless except for filesystem reads.
 *
 * Both are pure / side-effect-free (besides fs reads) and have zero
 * dependency on `applyEpoch`, `applyingTheme`, or `state` — which is why
 * they were the easiest piece to peel off the god object.
 *
 * Call chain:
 *   AgentEngineService.hardeningPass → tryEngineInjection → injectThemeViaEngine (cdp-inject)
 *                                                  └→ buildPaletteCss
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { CdpSession } from './cdp-client';
import {
  type InjectEngineResult,
  injectThemeViaEngine,
} from './cdp-inject';
import type { ResolvedThemeTarget, ThemeBundle } from '../legacy/agentskin-core-runtime';
import { toMessage } from '../shared/errors';

// ---------------------------------------------------------------------------
// Hex → RGB triplet conversion (for engine tokens.css var(--agentskin-*-raw))
// ---------------------------------------------------------------------------

/**
 * Convert a hex color (`#rgb` or `#rrggbb`) to an `r, g, b` triplet string.
 * Returns null for non-hex values so callers can skip deriving a `-raw` var
 * when the source color is itself a `var()` or `color-mix()`.
 */
function hexToRgbTriple(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const h = m[1];
  let r: number, g: number, b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  }
  return `${r}, ${g}, ${b}`;
}

// ---------------------------------------------------------------------------
// Palette CSS construction
// ---------------------------------------------------------------------------

/**
 * Build a palette.css from the per-agent theme CSS's `--agentskin-*` tokens.
 *
 * Extracts `--agentskin-*` variables from the resolved per-agent CSS (not the
 * first target) so agent-specific palette overrides (e.g. doubao's darker
 * `--agentskin-code-bg`) are respected. Also derives `--agentskin-*-raw` RGB
 * triplets from hex colors when missing — these are required by engine
 * `tokens.css` which uses `var(--agentskin-accent-raw)` for `rgba()` patterns.
 *
 * Returns null if the input is empty or has fewer than 6 `--agentskin-*`
 * declarations (treated as a malformed theme → caller falls back).
 */
export function buildPaletteCss(agentCss: string): string | null {
  if (!agentCss) return null;

  const varRe = /--agentskin-([\w-]+)\s*:\s*([^;]+)/g;
  const tokens = new Map<string, string>();
  let match: RegExpExecArray | null;
  while ((match = varRe.exec(agentCss)) !== null) {
    const name = match[1].trim();
    const value = match[2].trim();
    if (!tokens.has(name)) tokens.set(name, value);
  }
  if (tokens.size < 6) return null;

  // Derive -raw RGB triplets from hex colors when missing. Engine tokens.css
  // references var(--agentskin-accent-raw) etc. for rgba(var(--...-raw), alpha)
  // patterns; without these, native token overrides using -raw variants break.
  const rawBases = ['accent', 'secondary', 'text', 'muted', 'surface', 'surface-elevated', 'bg', 'border'];
  for (const base of rawBases) {
    const rawKey = `${base}-raw`;
    if (tokens.has(rawKey)) continue;
    const hexVal = tokens.get(base);
    if (!hexVal) continue;
    const rgb = hexToRgbTriple(hexVal);
    if (rgb) tokens.set(rawKey, rgb);
  }

  const declarations = [...tokens.entries()].map(
    ([name, value]) => `  --agentskin-${name}: ${value};`,
  );
  return `:root {\n${declarations.join('\n')}\n}\n`;
}

// ---------------------------------------------------------------------------
// Engine injection orchestration (loads files + delegates to cdp-inject)
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
}

/**
 * Default engine dir resolver used by the production orchestrator.
 * Tries `process.resourcesPath/engines/<agent>/adapter.mjs` first (packaged),
 * falls back to `<projectRoot>/engines/<agent>/` (dev mode).
 */
export async function resolveEngineDirDefault(appId: string): Promise<string> {
  const packagedDir = path.join(process.resourcesPath, 'engines', appId);
  const devDir = path.join(__dirname, '..', '..', 'engines', appId);
  const probeFile = path.join(packagedDir, 'adapter.mjs');
  try {
    await fs.access(probeFile);
    return packagedDir;
  } catch {
    return devDir;
  }
}

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
      fs.access(tokensPath).then(() => true).catch(() => false),
      fs.access(adapterPath).then(() => true).catch(() => false),
      fs.access(cosmeticPath).then(() => true).catch(() => false),
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
      heroDataUrl,
      agent: appId,
      themeId,
      verifyDelayMs: 500,
    });
  } catch (error) {
    deps.log(`[hardening] ${appId}: engine injection failed: ${toMessage(error)}`);
    return null;
  }
}
