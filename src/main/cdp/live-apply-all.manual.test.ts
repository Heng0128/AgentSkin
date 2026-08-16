// SPDX-License-Identifier: MPL-2.0

/**
 * # Batch 6 · Real apply + hot-switch + restore (all 6 agents)
 *
 * MANUAL integration test (NOT part of `npm run check`). For each of the 6
 * agents with a live CDP port: applies a real installed theme (B1), hot-
 * switches to a second theme (B2), verifies via `waitForTheme`, then restores
 * the original theme per-agent in `finally`.
 *
 * Run explicitly (manual gate): `AGENTSKIN_MANUAL=1 npx vitest run src/main/cdp/live-apply-all.manual.test.ts`
 * Without `AGENTSKIN_MANUAL=1` the suite is skipped so `npm run check` never
 * touches live agents (the vitest `main` project glob would otherwise collect
 * `*.manual.test.ts` and run real apply/hot-switch/restore on every running app).
 */

import { describe, expect, it } from 'vitest';
import { getAdapter, registerBuiltinAdapters } from '../../adapters/registry';
import { resolveLivePort } from '../../shared/cdp-discovery';
import { ThemeLibrary } from '../theme-library';
import { connectCdp } from './cdp-client';
import { waitForTheme } from './injection/shared';

const THEMES_ROOT = 'C:/Users/snowb/AppData/Roaming/AgentSkin/themes';
const AGENT_IDS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
// Manual gate: the suite only runs when explicitly requested via
// `AGENTSKIN_MANUAL=1`, so `npm run check` skips it (see header note).
const MANUAL = process.env.AGENTSKIN_MANUAL === '1';

const noop = (): void => {};

registerBuiltinAdapters();

async function openMainSession(agentId: string, port: number) {
  const targets = (await getAdapter(agentId)!.findTargets(port, 1200)) as {
    webSocketDebuggerUrl?: string;
  }[];
  const wsUrl = targets.find((t) => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  if (!wsUrl) throw new Error('no webSocketDebuggerUrl in targets');
  return connectCdp(wsUrl, 5000, 8000);
}

interface AgentResult {
  agentId: string;
  port: number | null;
  b1Adopted: number;
  b2Adopted: number;
  restored: string;
  error?: string;
}

async function verifyApplied(agentId: string, port: number): Promise<number> {
  const session = await openMainSession(agentId, port);
  try {
    // Codex injects via <style id="agentskin-theme-style-codex">, not
    // adoptedStyleSheets with __agentskin flag. Use a dedicated probe.
    if (agentId === 'codex') {
      const raw = await session.evaluate(`(() => {
        const el = document.getElementById('agentskin-theme-style-codex');
        return JSON.stringify({
          stylePresent: !!el,
          styleContent: (el?.textContent ?? '').length > 0,
        });
      })()`);
      const v = JSON.parse(raw) as { stylePresent: boolean; styleContent: boolean };
      // The codex target CSS is injected as a <style> element (design tokens),
      // not adoptedStyleSheets. Presence of non-empty content = theme applied.
      return v.stylePresent && v.styleContent ? 1 : 0;
    }
    const v = await waitForTheme(session, { timeoutMs: 5000, intervalMs: 50 });
    return v?.adoptedSheetCount ?? 0;
  } finally {
    session.close();
  }
}

describe.skipIf(!MANUAL)('batch-6 real apply on all agents (manual)', () => {
  it('applies + hot-switches + restores a real theme on every live agent', async () => {
    const library = new ThemeLibrary(THEMES_ROOT);
    const themeA = (await library.find('sakura-noir')).bundle;
    const themeB = (await library.find('ocean-tide')).bundle;

    const results: AgentResult[] = [];
    for (const agentId of AGENT_IDS) {
      const adapter = getAdapter(agentId);
      if (!adapter) {
        results.push({
          agentId,
          port: null,
          b1Adopted: 0,
          b2Adopted: 0,
          restored: 'adapter-missing',
        });
        continue;
      }

      let port: number | null = null;
      try {
        port = await resolveLivePort(adapter, agentId, noop);
      } catch (error) {
        results.push({
          agentId,
          port: null,
          b1Adopted: 0,
          b2Adopted: 0,
          restored: 'port-error',
          error: String(error),
        });
        console.log(`[probe] ${agentId}: port discovery failed (${String(error)})`);
        continue;
      }
      if (port == null) {
        results.push({ agentId, port: null, b1Adopted: 0, b2Adopted: 0, restored: 'no-port' });
        console.log(`[skipped] ${agentId}: no live CDP port`);
        continue;
      }

      let b1Adopted = 0;
      let b2Adopted = 0;
      let restored = 'ok';
      try {
        const resA = await adapter.applyTheme(themeA, {
          port,
          launch: false,
          appPath: null,
          restartExisting: false,
        });
        b1Adopted = await verifyApplied(agentId, port);
        console.log(
          `[B1] ${agentId}: applied sakura-noir adopted=${b1Adopted} res=${JSON.stringify(resA).slice(0, 120)}`,
        );

        const resB = await adapter.applyTheme(themeB, {
          port,
          launch: false,
          appPath: null,
          restartExisting: false,
        });
        b2Adopted = await verifyApplied(agentId, port);
        console.log(
          `[B2] ${agentId}: hot-switched to ocean-tide adopted=${b2Adopted} res=${JSON.stringify(resB).slice(0, 120)}`,
        );
      } catch (error) {
        restored = `apply-error: ${String(error)}`;
        console.log(`[apply] ${agentId}: FAILED (${String(error)})`);
      } finally {
        try {
          const r = await adapter.restoreTheme(port);
          console.log(`[restore] ${agentId}: restored=${r?.renderer?.restored ?? false}`);
          if (r?.renderer && r.renderer.restored === false) restored = 'restore-false';
        } catch (error) {
          restored = `restore-error: ${String(error)}`;
          console.log(`[restore] ${agentId}: FAILED (${String(error)})`);
        }
      }
      results.push({ agentId, port, b1Adopted, b2Adopted, restored });
    }

    console.log(`\n[summary] ${results.length} agents probed`);
    for (const r of results) {
      console.log(
        `        ${r.agentId}: port=${r.port ?? 'none'} B1=${r.b1Adopted} B2=${r.b2Adopted} restored=${r.restored}`,
      );
    }

    const ran = results.filter((r) => r.port != null);
    for (const r of ran) {
      expect(r.b1Adopted, `${r.agentId} B1 should adopt stylesheets`).toBeGreaterThan(0);
      expect(r.b2Adopted, `${r.agentId} B2 hot-switch should adopt stylesheets`).toBeGreaterThan(0);
      expect(r.restored, `${r.agentId} should be restored`).toBe('ok');
    }
  }, 120000);
});
