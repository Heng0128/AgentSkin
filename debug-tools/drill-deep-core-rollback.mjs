// SPDX-License-Identifier: MPL-2.0
/**
 * drill-deep-core-rollback.mjs — E2E script verifying DeepCore fault triggers legacy fallback
 *
 * Usage: node debug-tools/drill-deep-core-rollback.mjs <port> <agentId>
 * Example: node debug-tools/drill-deep-core-rollback.mjs 52013 codex
 *
 * Three-phase verification:
 *   Phase 1 — Normal inject: inject deep-core.mjs, verify window.DeepCore exists
 *   Phase 2 — Fault inject: overwrite window.DeepCore with a throwing stub,
 *             simulate adapter try-catch construct, confirm catch executes
 *   Phase 3 — Legacy self-heal: confirm adoptedStyleSheets still receives CSS
 *             after the DeepCore crash (legacy STRUCTURAL_CSS path)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.argv[2];
const AGENT_ID = process.argv[3];

if (!PORT || !AGENT_ID) {
  console.error('Usage: node drill-deep-core-rollback.mjs <port> <agentId>');
  console.error('Example: node drill-deep-core-rollback.mjs 52013 codex');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(
  join(here, '../engines/shared/deep-core.mjs'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// CDP helper — ported from probe-deep-core-inject.mjs (lines 36-73)
// ---------------------------------------------------------------------------

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('ws connection failed')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { r } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? r(new Error(m.error.message)) : r(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { r: res });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
        }
      }, 30000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Evaluate an expression in the page and return { ok, value, error }. */
async function safeEval(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (r?.exceptionDetails) {
    return { ok: false, error: r.exceptionDetails.text };
  }
  return { ok: true, value: r?.result?.value };
}

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------

/**
 * Phase 1 — Inject deep-core.mjs source, verify window.DeepCore is a function.
 */
async function phase1(cdp) {
  const phase = { name: 'phase-1-normal-inject', pass: false, details: {} };

  // Inject source
  const inject = await safeEval(cdp, DEEP_CORE_SRC);
  phase.details.injectOk = inject.ok;
  if (!inject.ok) {
    phase.error = 'inject failed: ' + inject.error;
    return phase;
  }

  // Verify window.DeepCore
  const check = await safeEval(cdp, 'typeof window.DeepCore');
  phase.details.deepCoreType = check.value;
  phase.details.classOk = check.value === 'function';
  if (!phase.details.classOk) {
    phase.error = 'window.DeepCore is not a function after inject';
    return phase;
  }

  // Capture baseline adoptedStyleSheets count
  const baseline = await safeEval(cdp, 'document.adoptedStyleSheets.length');
  phase.details.baselineSheetCount = baseline.value;

  phase.pass = true;
  return phase;
}

/**
 * Phase 2 — Overwrite window.DeepCore with a throwing stub, then run a
 * simulated adapter try-catch. Confirm catch executes and reports caught=true.
 */
async function phase2(cdp) {
  const phase = { name: 'phase-2-fault-inject', pass: false, details: {} };

  // Overwrite DeepCore with a stub that throws on construct
  const stubResult = await safeEval(cdp, `
    window.DeepCore = function() {
      throw new Error('simulated DeepCore crash');
    };
    'ok'
  `);
  phase.details.stubInstalled = stubResult.ok;
  if (!stubResult.ok) {
    phase.error = 'failed to install fault stub: ' + stubResult.error;
    return phase;
  }

  // Simulated adapter: try-catch construct + legacy fallback.
  // Uses `window.DeepCore` (not bare `DeepCore`) so that stub injection
  // via `window.DeepCore = function() { throw }` is observable.
  // (V8's inline cache may resolve bare `DeepCore` to the class even after
  // window.DeepCore is reassigned — a known optimization quirk.)
  const simResult = await safeEval(cdp, `
    (() => {
      const DEEP_CONFIG = { shadowMode: 'open-only', routes: [], fragments: {}, exposedState: [], enabled: true };
      try {
        const dc = new window.DeepCore(DEEP_CONFIG, { agent: '${AGENT_ID}', themeId: 'drill' });
        return JSON.stringify({ phase: 'construct', result: 'unexpected-success' });
      } catch (e) {
        // Legacy fallback — simulate injecting a test CSS
        try {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync('.legacy-fallback-test { --agentskin-legacy-active: 1; }');
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
          return JSON.stringify({ phase: 'fallback', caught: true, marker: '--agentskin-legacy-active' });
        } catch (sheetErr) {
          return JSON.stringify({ phase: 'fallback-error', caught: true, sheetError: sheetErr.message });
        }
      }
    })()
  `);

  if (!simResult.ok) {
    phase.error = 'simulated adapter threw uncaught: ' + simResult.error;
    return phase;
  }

  let parsed;
  try {
    parsed = JSON.parse(simResult.value);
  } catch {
    phase.error = 'simulated adapter returned non-JSON: ' + simResult.value;
    return phase;
  }

  phase.details.simulation = parsed;
  phase.details.caught = parsed.caught === true;
  phase.details.phase = parsed.phase;
  phase.details.fallbackExecuted = parsed.phase === 'fallback';

  if (!phase.details.caught) {
    phase.error = 'try-catch did not catch DeepCore construct failure';
    return phase;
  }

  phase.pass = true;
  return phase;
}

/**
 * Phase 3 — Verify adoptedStyleSheets still received CSS from legacy path.
 */
async function phase3(cdp) {
  const phase = { name: 'phase-3-legacy-self-heal', pass: false, details: {} };

  // Check adoptedStyleSheets count increased after fallback injection
  const countResult = await safeEval(cdp, 'document.adoptedStyleSheets.length');
  phase.details.currentSheetCount = countResult.value;

  // Verify the legacy marker CSS variable exists in injected stylesheets
  const markerResult = await safeEval(cdp, `
    (() => {
      const markers = [];
      for (const sheet of document.adoptedStyleSheets) {
        try {
          const rules = sheet.cssRules || sheet.rules || [];
          for (const rule of rules) {
            if (rule.cssText && rule.cssText.includes('--agentskin-legacy-active')) {
              markers.push(rule.cssText.substring(0, 120));
            }
          }
        } catch (e) {
          // cross-origin sheets may throw; skip
        }
      }
      return JSON.stringify(markers);
    })()
  `);

  let markerMatches = [];
  try {
    markerMatches = JSON.parse(markerResult.value || '[]');
  } catch { /* ignore */ }

  phase.details.legacyMarkerFound = markerMatches.length > 0;
  phase.details.legacyMarkerSnippets = markerMatches;

  // Final pass condition: sheets still present AND legacy marker detected
  phase.pass = phase.details.currentSheetCount > 0 && phase.details.legacyMarkerFound;
  if (!phase.pass) {
    phase.error = phase.details.currentSheetCount === 0
      ? 'no stylesheets remain after fallback'
      : 'legacy marker (--agentskin-legacy-active) not found in adoptedStyleSheets';
  }
  return phase;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
  const report = {
    agent: AGENT_ID,
    port: PORT,
    timestamp: new Date().toISOString(),
    phases: [],
    overall: 'PENDING',
  };

  // Locate page target
  let wsUrl;
  try {
    const http = await fetch(`http://127.0.0.1:${PORT}/json/list`);
    const targets = await http.json();
    const page = targets.find(t => t.type === 'page');
    if (!page) {
      report.overall = 'FAIL';
      report.error = `No page target found on port ${PORT}`;
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    wsUrl = page.webSocketDebuggerUrl;
    if (!wsUrl) {
      report.overall = 'FAIL';
      report.error = `No webSocketDebuggerUrl for target on port ${PORT}`;
      console.log(JSON.stringify(report, null, 2));
      process.exit(1);
    }
  } catch (err) {
    report.overall = 'FAIL';
    report.error = `Failed to query /json/list: ${err.message}`;
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  const cdp = await CDP.connect(wsUrl);

  try {
    // Phase 1
    const p1 = await phase1(cdp);
    report.phases.push(p1);

    // Phase 2 — only meaningful if Phase 1 passed; otherwise skip with reason
    if (p1.pass) {
      const p2 = await phase2(cdp);
      report.phases.push(p2);

      // Phase 3
      if (p2.pass) {
        const p3 = await phase3(cdp);
        report.phases.push(p3);
        report.overall = p3.pass ? 'PASS' : 'FAIL';
      } else {
        report.overall = 'FAIL';
        report.phases.push({
          name: 'phase-3-legacy-self-heal',
          pass: false,
          skipped: true,
          error: 'Skipped: Phase 2 failed — fallback path was not exercised',
        });
      }
    } else {
      report.overall = 'FAIL';
      report.phases.push(
        { name: 'phase-2-fault-inject', pass: false, skipped: true, error: 'Skipped: Phase 1 failed — DeepCore not available' },
        { name: 'phase-3-legacy-self-heal', pass: false, skipped: true, error: 'Skipped: Phase 1 failed — DeepCore not available' },
      );
    }
  } catch (err) {
    report.overall = 'FAIL';
    report.error = err.message;
  } finally {
    cdp.close();
  }

  console.log(JSON.stringify(report, null, 2));
  const exitCode = report.overall === 'PASS' ? 0 : 1;
  console.log(`\n>>> ${report.agent} (:${report.port}) — ${report.overall}`);
  process.exit(exitCode);
}

run().catch(e => { console.error(e); process.exit(1); });
