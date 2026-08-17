// SPDX-License-Identifier: MPL-2.0
// ONE-OFF debug script: reproduce the manual-test flow (apply → reload → restore
// → reload) on qoderwork with per-step flag/style/state diagnostics.
// Deleted after diagnosis.

import { registerBuiltinAdapters, getAdapter } from "../src/adapters/registry";
import { resolveLivePort } from "../src/shared/cdp-discovery";
import { ThemeLibrary } from "../src/main/theme-library";
import { CdpSession, listCdpTargets } from "../src/engine/src/cdp/session.mjs";

const THEMES_ROOT = "C:/Users/snowb/AppData/Roaming/AgentSkin/themes";
const AGENT_ID = process.env.AGENT_ID ?? "qoderwork";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

registerBuiltinAdapters();

async function openSession(port) {
  const targets = (await listCdpTargets(port)).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  const target = targets[0];
  if (!target) throw new Error("no page target");
  return new CdpSession(target, 10000).open();
}

async function readState(session, appId) {
  const raw = await session.evaluate(`(() => {
    const el = document.getElementById('agentskin-theme-style-' + ${JSON.stringify(appId)});
    const state = window.__AGENTSKIN__?.hosts?.[${JSON.stringify(appId)}];
    return JSON.stringify({
      stylePresent: !!el,
      styleContent: (el?.textContent ?? '').length > 0,
      statePresent: !!state,
      disabled: (() => { try { return sessionStorage.getItem('__agentskin_disabled__'); } catch { return 'n/a'; } })(),
    });
  })()`);
  return JSON.parse(raw);
}

async function reloadAndSettle(session, settleMs = 2000) {
  await session.send("Page.reload", {});
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      if ((await session.evaluate("document.readyState")) === "complete") break;
    } catch {
      /* nav */
    }
    await sleep(250);
  }
  await sleep(settleMs);
}

async function main() {
  const adapter = getAdapter(AGENT_ID);
  const port = await resolveLivePort(adapter, AGENT_ID, () => {});
  console.log(`[${AGENT_ID}] port=${port}`);
  const library = new ThemeLibrary(THEMES_ROOT);
  const themeA = (await library.find("sakura-noir")).bundle;

  let session = await openSession(port);
  console.log("[baseline]", await readState(session, AGENT_ID));

  // R1: apply (real path)
  await adapter.applyTheme(themeA, { port, launch: false, appPath: null, restartExisting: false });
  console.log("[R1 after apply]", await readState(session, AGENT_ID));

  // R2: reload → persistence script should auto-restore
  await reloadAndSettle(session);
  console.log("[R2 after reload]", await readState(session, AGENT_ID));

  // R3: restore (real path)
  await adapter.restoreTheme(port);
  console.log("[R3 after restore]", await readState(session, AGENT_ID));

  // R4: reload → must NOT re-inject
  await reloadAndSettle(session);
  console.log("[R4 after remove+reload]", await readState(session, AGENT_ID));

  session.close();
}

main().catch((e) => {
  console.error("DEBUG FAILED:", e);
  process.exit(1);
});
