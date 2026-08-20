// SPDX-License-Identifier: MPL-2.0
/**
 * probe-deep-core-inject.mjs — Verify DeepCore can be injected into a running Agent
 *
 * Usage: node debug-tools/probe-deep-core-inject.mjs <port> [agentId]
 * Example: node debug-tools/probe-deep-core-inject.mjs 52013 codex
 *
 * Steps:
 *   1. Connect to CDP WebSocket
 *   2. Read engines/shared/deep-core.mjs source
 *   3. Runtime.evaluate the source (simulating orchestrator source-concatenation)
 *   4. Check window.DeepCore exists
 *   5. Try new DeepCore() with test config
 *   6. Report success / errors
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.argv[2];
const AGENT_ID = process.argv[3] || 'unknown';

if (!PORT) {
  console.error('Usage: node probe-deep-core-inject.mjs <port> [agentId]');
  console.error('Example: node probe-deep-core-inject.mjs 52013 codex');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(
  join(here, '../engines/shared/deep-core.mjs'),
  'utf-8',
);

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

async function run() {
  const url = `ws://127.0.0.1:${PORT}/json/list`;
  // First, get the page target
  const http = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await http.json();
  const page = targets.find(t => t.type === 'page');
  if (!page) {
    console.error(`No page target found on port ${PORT}`);
    process.exit(1);
  }

  const wsUrl = page.webSocketDebuggerUrl;
  if (!wsUrl) {
    console.error(`No webSocketDebuggerUrl for target on port ${PORT}`);
    process.exit(1);
  }

  const cdp = await CDP.connect(wsUrl);
  const result = { agent: AGENT_ID, port: PORT, steps: {} };

  try {
    // Step 1: Inject deep-core.mjs source
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: DEEP_CORE_SRC,
      returnByValue: false,
    });
    result.steps.inject = { ok: !evalResult?.exceptionDetails };
    if (evalResult?.exceptionDetails) {
      result.steps.inject.error = evalResult.exceptionDetails.text;
    }

    // Step 2: Check window.DeepCore exists
    const checkResult = await cdp.send('Runtime.evaluate', {
      expression: 'typeof window.DeepCore',
      returnByValue: true,
    });
    result.steps.classAvailable = checkResult?.result?.value;
    result.steps.classOk = checkResult?.result?.value === 'function';

    // Step 3: Check all expected globals
    const globalsResult = await cdp.send('Runtime.evaluate', {
      expression: `JSON.stringify({
        DeepCore: typeof window.DeepCore,
        SafeAttachShadowPatcher: typeof window.SafeAttachShadowPatcher,
        FragmentRegistry: typeof window.FragmentRegistry,
        adoptedStyleSheets: !!document.adoptedStyleSheets
      })`,
      returnByValue: true,
    });
    result.steps.globals = JSON.parse(globalsResult?.result?.value || '{}');

    // Step 4: Try constructing DeepCore with test config
    if (result.steps.classOk) {
      const constructResult = await cdp.send('Runtime.evaluate', {
        expression: `(() => {
          try {
            const dc = new DeepCore({
              shadowMode: 'open-only',
              routes: [],
              fragments: { 'test-frag': '.test { color: red; }' },
              exposedState: [],
              enabled: true
            }, { agent: '${AGENT_ID}', themeId: 'test' });
            return { ok: true, hasDispose: typeof dc.dispose === 'function', marker: !!window['__agentskin_${AGENT_ID}_adapter__'] };
          } catch (e) {
            return { ok: false, error: e.message };
          }
        })()`,
        returnByValue: true,
      });
      result.steps.construct = constructResult?.result?.value;

      // Step 5: Test FragmentRegistry
      if (result.steps.construct?.ok) {
        const fragResult = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            try {
              FragmentRegistry.activate('test-frag');
              const count = document.adoptedStyleSheets.length;
              const hasFragment = document.adoptedStyleSheets.some(s => s.__agentskin_fragment === 'test-frag');
              return { ok: true, sheetCount: count, hasFragment };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          })()`,
          returnByValue: true,
        });
        result.steps.fragment = fragResult?.result?.value;

        // Step 6: Test dispose
        const disposeResult = await cdp.send('Runtime.evaluate', {
          expression: `(() => {
            try {
              const dc = window.__AGENTSKIN_DEEP_CORE__;
              if (dc) {
                dc.dispose();
                return { ok: true, cleaned: !window.__AGENTSKIN_DEEP_CORE__ };
              }
              return { ok: false, error: 'no instance' };
            } catch (e) {
              return { ok: false, error: e.message };
            }
          })()`,
          returnByValue: true,
        });
        result.steps.dispose = disposeResult?.result?.value;
      }
    }

    console.log(JSON.stringify(result, null, 2));

    // Overall pass/fail
    const passed = result.steps.classOk &&
      result.steps.construct?.ok &&
      result.steps.fragment?.ok;
    result.overall = passed ? 'PASS' : 'FAIL';
    console.log(`\n>>> ${result.agent} (:${result.port}) — ${result.overall}`);

  } catch (err) {
    console.error('Probe error:', err.message);
    result.error = err.message;
    console.log(JSON.stringify(result, null, 2));
  } finally {
    cdp.close();
  }
}

run().catch(e => { console.error(e); process.exit(1); });
