// SPDX-License-Identifier: MPL-2.0

/**
 * # Batch 8 · Doubao full-chain ENGINE injection (manual)
 *
 * Doubao is a strong-adversary app: its renderer strips `<style>` elements
 * within ~50ms and it can carry a stale `__agentskin_disabled__` flag that
 * short-circuits the engine adapter's `ensure()`. Core-only verification
 * (`adapter.applyTheme`) therefore reports R1=0 / R2=0 on Doubao even though
 * the engine (adoptedStyleSheets + adapter self-heal) is the operative channel
 * for this app.
 *
 * This test drives the REAL engine path end-to-end for Doubao only:
 *   B1) load an installed theme + resolve the Doubao target
 *   B2) `tryEngineInjection` (engine files + palette + injectThemeViaEngine)
 *   B3) assert the engine sheets are adopted (`adoptedSheetCount > 0`)
 *   B4) verify the stale `__agentskin_disabled__` flag was cleared by apply
 *
 * It deliberately does NOT walk the core+persistence flow (covered by
 * batch-7); it proves the hardening/watchdog lane can take over the
 * strong-adversary app once the disabled flag is cleared on apply.
 *
 * Run explicitly (manual gate):
 *   `AGENTSKIN_MANUAL=1 npx vitest run src/main/cdp/live-doubao-engine.manual.test.ts`
 * Without `AGENTSKIN_MANUAL=1` the suite is skipped so `npm run check` never
 * touches live agents.
 *
 * Environment variables:
 *   AGENTSKIN_THEMES_PATH — override themes directory (default: ~/AppData/Roaming/AgentSkin/themes)
 */

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdapter, registerBuiltinAdapters } from '../../adapters/registry';
import { resolveThemeTargetFor } from '../../legacy/agentskin-core-runtime';
import { resolveLivePort } from '../../shared/cdp-discovery';
import { SESSION_DISABLED_KEY } from '../../shared/injection-constants';
import { type EngineInjectionDeps, tryEngineInjection } from '../palette/orchestrator';
import { ThemeLibrary } from '../theme-library';
import { connectCdp } from './cdp-client';
import { waitForTheme } from './injection/shared';

const THEMES_ROOT = process.env.AGENTSKIN_THEMES_PATH || path.join(os.homedir(), 'AppData', 'Roaming', 'AgentSkin', 'themes');
const THEME_ID = process.env.THEME_ID ?? 'aurora-dusk';
const MANUAL = process.env.AGENTSKIN_MANUAL === '1';
const noop = (): void => {};

registerBuiltinAdapters();

async function openMainSession(port: number) {
  const targets = (await getAdapter('doubao')!.findTargets(port, 1200)) as {
    webSocketDebuggerUrl?: string;
  }[];
  const wsUrl = targets.find((t) => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('no webSocketDebuggerUrl in doubao targets');
  return connectCdp(wsUrl, 5000, 8000);
}

/** Read the live `sessionStorage.__agentskin_disabled__` on the main page. */
async function readDisabledFlag(session: Awaited<ReturnType<typeof openMainSession>>) {
  const raw = await session.evaluate(`(() => {
    let v = 'n/a';
    try { v = sessionStorage.getItem(${JSON.stringify(SESSION_DISABLED_KEY)}) ?? 'null'; } catch {}
    return v;
  })()`);
  return String(raw);
}

describe.skipIf(!MANUAL)('batch-8 doubao full-chain engine injection (manual)', () => {
  it('engine injection takes over and clears the disabled flag on Doubao', async () => {
    // Skipped unless Doubao actually has a live CDP port.
    const port = await resolveLivePort(getAdapter('doubao')!, 'doubao', noop).catch(() => null);
    if (port == null) {
      console.log('[skip] doubao: no live CDP port');
      return;
    }

    const library = new ThemeLibrary(THEMES_ROOT);
    const bundle = (await library.find(THEME_ID)).bundle;
    const targetTheme = resolveThemeTargetFor(bundle, 'doubao');
    if (!targetTheme?.css) {
      console.log(`[skip] doubao: theme '${THEME_ID}' resolved no css for doubao`);
      return;
    }

    const deps: EngineInjectionDeps = {
      // vitest is not an Electron process — `process.resourcesPath` is
      // undefined, so point at the dev engine dir directly.
      resolveEngineDir: (_appId) =>
        Promise.resolve(path.join(__dirname, '..', '..', '..', 'engines', 'doubao')),
      log: (line) => console.log(`[engine] ${line}`),
      verifyIntervalMs: 50,
    };

    const session = await openMainSession(port);
    try {
      // B0: record stale disabled state before apply.
      const beforeDisabled = await readDisabledFlag(session);
      console.log(`[B0] doubao: disabled-before=${beforeDisabled}`);

      // B2: full engine injection (engine files + palette + injectThemeViaEngine).
      const result = await tryEngineInjection(session, 'doubao', bundle, targetTheme, null, deps);
      console.log(
        `[B2] doubao: layers=${result?.layersInjected ?? 'null'} ` +
          `adapter=${result?.adapterApplied ?? false} success=${result?.success ?? false}`,
      );
      expect(result).not.toBeNull();
      expect(result!.success).toBe(true);

      // B3: engine sheets adopted (the watchdog's skip/re-inject focal point).
      const verification = await waitForTheme(session, { timeoutMs: 5000, intervalMs: 50 });
      console.log(`[B3] doubao: adoptedSheetCount=${verification?.adoptedSheetCount}`);
      expect(verification?.adoptedSheetCount ?? 0).toBeGreaterThan(0);

      // B4: apply must have cleared the stale disabled flag.
      const afterDisabled = await readDisabledFlag(session);
      console.log(`[B4] doubao: disabled-after=${afterDisabled}`);
      expect(String(afterDisabled)).not.toBe('1');
    } finally {
      // Restore / tear down the engine layers regardless of outcome.
      try {
        const r = await getAdapter('doubao')!.restoreTheme(port);
        console.log(`[restore] doubao: restored=${r?.renderer?.restored ?? false}`);
      } catch (error) {
        console.log(`[restore] doubao: FAILED (${String(error)})`);
      }
      session.close();
    }
  }, 90000);
});
