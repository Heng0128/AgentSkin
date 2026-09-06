// SPDX-License-Identifier: MPL-2.0

/**
 * # RFC 2026-08-17 P2 · Real reload-persistence verification (all live agents)
 *
 * MANUAL integration test (NOT part of `npm run check`). Verifies the
 * new-document persistence landed in `injector.mjs`/`renderer-payload.mjs`
 * (P1+P3) against real running agents:
 *
 *   R1 apply   → verify theme adopted
 *   R2 reload  → verify theme AUTO-RESTORED by the persistence script
 *   R3 restore → engine removes the persistence script + sets disabled flag
 *   R4 reload  → verify theme NOT re-injected
 *   R5 restore again in finally (idempotent cleanup)
 *
 * The apply/restore calls go through the real product path:
 *   ApplicationAdapter → themeRuntime(agentskin-core-runtime) → applySkin /
 *   restoreSkin → engine applyTheme / removeTheme (the modified code).
 *
 * Run explicitly (manual gate): `AGENTSKIN_MANUAL=1 npx vitest run src/main/cdp/live-reload-persistence.manual.test.ts`
 * Without `AGENTSKIN_MANUAL=1` the suite is skipped so `npm run check` never
 * touches live agents (the vitest `main` project glob would otherwise collect
 * `*.manual.test.ts` and run real apply/reload/restore on every running app).
 *
 * Environment variables:
 *   AGENTSKIN_THEMES_PATH — override themes directory (default: ~/AppData/Roaming/AgentSkin/themes)
 */

import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getAdapter, registerBuiltinAdapters } from '../../adapters/registry';
import { resolveLivePort } from '../../shared/cdp-discovery';
import { ThemeLibrary } from '../theme-library';
import { type CdpSession, connectCdp } from './cdp-client';

const THEMES_ROOT =
  process.env.AGENTSKIN_THEMES_PATH ||
  path.join(os.homedir(), 'AppData', 'Roaming', 'AgentSkin', 'themes');
// Theme to apply during the live smoke. Override via `THEME_ID=<id>`; defaults
// to an installed theme so the smoke doesn't fail on a missing bundle.
const THEME_ID = process.env.THEME_ID ?? 'aurora-dusk';
const ALL_AGENT_IDS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'] as const;
// Optional env override: `AGENTS=qoderwork,workbuddy npx vitest ...` to probe a
// subset without touching agents that are busy (e.g. traework mid-session).
const AGENT_IDS = (
  process.env.AGENTS
    ? process.env.AGENTS.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : ALL_AGENT_IDS
) as readonly string[];
const ALL_STYLE_IDS = AGENT_IDS.map((id) => `'agentskin-theme-style-${id}'`).join(',');
// Manual gate: the suite only runs when explicitly requested via
// `AGENTSKIN_MANUAL=1`, so `npm run check` skips it (see header note).
const MANUAL = process.env.AGENTSKIN_MANUAL === '1';

const noop = (): void => {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  r1Adopted: number;
  r2AutoRestored: number;
  r4Absent: boolean;
  restored: string;
  error?: string;
}

/**
 * Positive probe for the ENGINE path: theme is applied when the engine's
 * `<style id="agentskin-theme-style-<agentId>">` element exists with content
 * AND `window.__AGENTSKIN__.hosts[agentId]` host state is mounted.
 *
 * The engine never uses adoptedStyleSheets (that is the legacy main-process
 * mechanism), so adopted-sheet count is only a legacy fallback positive.
 */
async function verifyApplied(agentId: string, port: number): Promise<number> {
  const session = await openMainSession(agentId, port);
  try {
    const raw = await session.evaluate(`(() => {
      const appId = ${JSON.stringify(agentId)};
      const el = document.getElementById('agentskin-theme-style-' + appId);
      const state = window.__AGENTSKIN__?.hosts?.[appId];
      const adopted = (document.adoptedStyleSheets || []).filter((s) => !!s.__agentskin).length;
      return JSON.stringify({
        stylePresent: !!el,
        styleContent: (el?.textContent ?? '').length > 0,
        statePresent: !!state,
        adopted,
      });
    })()`);
    const v = JSON.parse(raw) as {
      stylePresent: boolean;
      styleContent: boolean;
      statePresent: boolean;
      adopted: number;
    };
    if (v.stylePresent && v.styleContent && v.statePresent) return 1;
    return v.adopted;
  } finally {
    session.close();
  }
}

/** Negative probe: no engine <style>, no __AGENTSKIN__ host state, no legacy adopted sheet. */
async function verifyNotApplied(agentId: string, port: number): Promise<boolean> {
  const session = await openMainSession(agentId, port);
  try {
    const raw = await session.evaluate(`(() => {
      const styleIds = [${ALL_STYLE_IDS}];
      const stylePresent = styleIds.some((id) => !!document.getElementById(id));
      const statePresent = !!Object.values(window.__AGENTSKIN__?.hosts ?? {}).length;
      let adopted = false;
      for (const sheet of document.adoptedStyleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (typeof rule.cssText === 'string' && rule.cssText.includes('agentskin')) { adopted = true; break; }
          }
        } catch { /* cross-origin sheet */ }
        if (adopted) break;
      }
      return JSON.stringify({ stylePresent, statePresent, adopted });
    })()`);
    const v = JSON.parse(raw) as { stylePresent: boolean; statePresent: boolean; adopted: boolean };
    return !v.stylePresent && !v.statePresent && !v.adopted;
  } finally {
    session.close();
  }
}

/** Trigger Page.reload and wait for the document to settle (session survives nav). */
async function reloadAndSettle(session: CdpSession, settleMs = 1200): Promise<void> {
  await session.send('Page.reload', {});
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const state = await session.evaluate('document.readyState');
      if (state === 'complete') break;
    } catch {
      // Execution context destroyed mid-navigation — retry.
    }
    await sleep(250);
  }
  // Give the persistence script / self-heal loop time to (re)inject.
  await sleep(settleMs);
}

/** Temporary diagnostics: read persistence-script globals to see why R2 failed. */
async function dumpPersistDiag(agentId: string, port: number): Promise<void> {
  const session = await openMainSession(agentId, port);
  try {
    const raw = await session.evaluate(`(() => {
      const el = document.getElementById('agentskin-theme-style-${agentId}');
      const hosts = Object.keys(window.__AGENTSKIN__?.hosts ?? {});
      return JSON.stringify({
        ran: window.__AGENTSKIN_PERSIST_RAN__ ?? null,
        err: window.__AGENTSKIN_PERSIST_ERR__ ?? null,
        stylePresent: !!el,
        styleLen: (el?.textContent ?? '').length,
        hosts,
        disabled: (() => { try { return sessionStorage.getItem('__agentskin_disabled__'); } catch { return 'n/a'; } })(),
      });
    })()`);
    console.log(`[diag] ${agentId}: ${raw}`);
  } catch (error) {
    console.log(`[diag] ${agentId}: evaluate failed (${String(error)})`);
  } finally {
    session.close();
  }
}

describe.skipIf(!MANUAL)('batch-7 real reload-persistence on all agents (manual)', () => {
  it('applies, auto-restores across reload, and stops restoring after remove', async () => {
    const library = new ThemeLibrary(THEMES_ROOT);
    const themeA = (await library.find(THEME_ID)).bundle;

    const results: AgentResult[] = [];
    for (const agentId of AGENT_IDS) {
      const adapter = getAdapter(agentId);
      if (!adapter) {
        results.push({
          agentId,
          port: null,
          r1Adopted: 0,
          r2AutoRestored: 0,
          r4Absent: true,
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
          r1Adopted: 0,
          r2AutoRestored: 0,
          r4Absent: true,
          restored: 'port-error',
          error: String(error),
        });
        console.log(`[probe] ${agentId}: port discovery failed (${String(error)})`);
        continue;
      }
      if (port == null) {
        results.push({
          agentId,
          port: null,
          r1Adopted: 0,
          r2AutoRestored: 0,
          r4Absent: true,
          restored: 'no-port',
        });
        console.log(`[skipped] ${agentId}: no live CDP port`);
        continue;
      }

      let r1Adopted = 0;
      let r2AutoRestored = 0;
      let r4Absent = false;
      let restored = 'ok';
      try {
        // R1: apply a real theme (engine registers new-document persistence).
        await adapter.applyTheme(themeA, {
          port,
          launch: false,
          appPath: null,
          restartExisting: false,
        });
        r1Adopted = await verifyApplied(agentId, port);
        console.log(`[R1] ${agentId}: applied sakura-noir adopted=${r1Adopted}`);

        // R2: reload → the persistence script must auto-restore the theme.
        const session = await openMainSession(agentId, port);
        try {
          await reloadAndSettle(session);
        } finally {
          session.close();
        }
        r2AutoRestored = await verifyApplied(agentId, port);
        console.log(`[R2] ${agentId}: after reload auto-restored=${r2AutoRestored}`);
        if (r2AutoRestored === 0) await dumpPersistDiag(agentId, port);

        // R3: restore — engine removes the persistence script + sets disabled flag.
        const r = await adapter.restoreTheme(port);
        restored = r?.renderer?.restored === false ? 'restore-false' : 'ok';

        // R4: reload again → the theme must NOT re-inject.
        const session2 = await openMainSession(agentId, port);
        try {
          await reloadAndSettle(session2);
        } finally {
          session2.close();
        }
        r4Absent = await verifyNotApplied(agentId, port);
        console.log(`[R4] ${agentId}: after remove+reload absent=${r4Absent}`);
      } catch (error) {
        restored = `flow-error: ${String(error)}`;
        console.log(`[flow] ${agentId}: FAILED (${String(error)})`);
      } finally {
        try {
          await adapter.restoreTheme(port);
        } catch (error) {
          restored = `restore-error: ${String(error)}`;
          console.log(`[restore] ${agentId}: FAILED (${String(error)})`);
        }
      }
      results.push({ agentId, port, r1Adopted, r2AutoRestored, r4Absent, restored });
    }

    console.log(`\n[summary] ${results.length} agents probed`);
    for (const r of results) {
      console.log(
        `        ${r.agentId}: port=${r.port ?? 'none'} R1=${r.r1Adopted} R2-autoRestored=${r.r2AutoRestored} R4-absent=${r.r4Absent} restored=${r.restored}`,
      );
    }

    const ran = results.filter((r) => r.port != null);
    for (const r of ran) {
      expect(r.r1Adopted, `${r.agentId} R1 should adopt stylesheets`).toBeGreaterThan(0);
      expect(
        r.r2AutoRestored,
        `${r.agentId} R2 should AUTO-RESTORE after reload (persistence)`,
      ).toBeGreaterThan(0);
      expect(r.r4Absent, `${r.agentId} R4 should NOT re-inject after remove + reload`).toBe(true);
      expect(r.restored, `${r.agentId} should be restored`).toBe('ok');
    }
  }, 240000);
});
