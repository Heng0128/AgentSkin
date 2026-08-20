// SPDX-License-Identifier: MPL-2.0
/**
 * perf-deep-core-baseline.mjs — Measure DeepCore injection performance baseline
 *
 * Usage: node debug-tools/perf-deep-core-baseline.mjs <port> <agentId>
 * Example: node debug-tools/perf-deep-core-baseline.mjs 52013 codex
 *
 * Measures 5 key metrics (3 runs each, median):
 *   - injectTime: deep-core.mjs source Runtime.evaluate execution time (ms)
 *   - constructTime: new DeepCore() construction time (ms)
 *   - fragmentActivateTime: FragmentRegistry.activate() first call time (ms)
 *   - memoryDeltaMB: JS Heap usage delta via performance.memory (MB)
 *   - disposeTime: dc.dispose() cleanup time (ms)
 *
 * Output: JSON to stdout + saved to debug-tools/_perf-results/{agentId}-baseline.json
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.argv[2];
const AGENT_ID = process.argv[3];
const RUNS = 3;
const MEASUREMENT_TIMEOUT_MS = 15_000;

if (!PORT || !AGENT_ID) {
  console.error('Usage: node perf-deep-core-baseline.mjs <port> <agentId>');
  console.error('Example: node perf-deep-core-baseline.mjs 52013 codex');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(
  join(here, '../engines/shared/deep-core.mjs'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// CDP helper — reused from probe-deep-core-inject.mjs (lines 36-73)
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
      const { r, timer } = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(timer);
      m.error ? r(new Error(m.error.message)) : r(m.result);
    }
  }
  send(method, params = {}, timeoutMs = MEASUREMENT_TIMEOUT_MS) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout ${method} (${timeoutMs}ms)`));
        }
      }, timeoutMs);
      this.pending.set(id, { r: res, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

const MEMORY_PROBE = `JSON.stringify({ used: performance.memory?.usedJSHeapSize, total: performance.memory?.totalJSHeapSize })`;

// ---------------------------------------------------------------------------
// Single measurement round — full DeepCore lifecycle
// ---------------------------------------------------------------------------
async function measureRound(cdp, agentId) {
  const result = {};

  // --- Memory before injection ---
  const memBefore = await cdp.send('Runtime.evaluate', {
    expression: MEMORY_PROBE,
    returnByValue: true,
  });

  // --- injectTime: round-trip proxy for Runtime.evaluate execution ---
  // Measures Node.js → CDP → browser eval → CDP → Node.js.
  // WebSocket overhead on localhost is typically < 1ms.
  {
    const t0 = Date.now();
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: DEEP_CORE_SRC,
      returnByValue: false,
    });
    result.injectTime = Date.now() - t0;
    if (evalResult?.exceptionDetails) {
      throw new Error(`inject failed: ${evalResult.exceptionDetails.text}`);
    }
  }

  // --- constructTime: new DeepCore() measured inside browser ---
  {
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const t0 = performance.now();
        new DeepCore({
          shadowMode: 'open-only',
          routes: [],
          fragments: { 'test-frag': '.test { color: red; }' },
          exposedState: [],
          enabled: true
        }, { agent: '${agentId}', themeId: 'perf-test' });
        return { elapsed: performance.now() - t0 };
      })()`,
      returnByValue: true,
    });
    result.constructTime = evalResult?.result?.value?.elapsed;
    if (result.constructTime == null) {
      throw new Error(`construct failed: ${JSON.stringify(evalResult?.result)}`);
    }
  }

  // --- fragmentActivateTime: FragmentRegistry.activate() first call ---
  {
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const t0 = performance.now();
        FragmentRegistry.activate('test-frag');
        return { elapsed: performance.now() - t0 };
      })()`,
      returnByValue: true,
    });
    result.fragmentActivateTime = evalResult?.result?.value?.elapsed;
    if (result.fragmentActivateTime == null) {
      throw new Error(`fragment activate failed: ${JSON.stringify(evalResult?.result)}`);
    }
  }

  // --- disposeTime: dc.dispose() cleanup ---
  {
    const evalResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        const t0 = performance.now();
        const dc = window.__AGENTSKIN_DEEP_CORE__;
        if (dc) dc.dispose();
        return { elapsed: performance.now() - t0 };
      })()`,
      returnByValue: true,
    });
    result.disposeTime = evalResult?.result?.value?.elapsed;
    if (result.disposeTime == null) {
      throw new Error(`dispose failed: ${JSON.stringify(evalResult?.result)}`);
    }
  }

  // --- Memory after full lifecycle ---
  const memAfter = await cdp.send('Runtime.evaluate', {
    expression: MEMORY_PROBE,
    returnByValue: true,
  });

  // --- memoryDeltaMB: heap delta (graceful degradation) ---
  try {
    const before = JSON.parse(memBefore?.result?.value || '{}');
    const after = JSON.parse(memAfter?.result?.value || '{}');
    if (before.used != null && after.used != null) {
      result.memoryDeltaMB = Math.round(((after.used - before.used) / (1024 * 1024)) * 100) / 100;
    } else {
      result.memoryDeltaMB = null;
      result.memoryNote = 'performance.memory not available (Chrome/Electron flag required)';
    }
  } catch {
    result.memoryDeltaMB = null;
    result.memoryNote = 'failed to parse memory data';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run() {
  // Discover page target
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
  const allRuns = [];

  try {
    for (let i = 0; i < RUNS; i++) {
      const round = await measureRound(cdp, AGENT_ID);
      allRuns.push(round);
    }
  } catch (err) {
    console.error('Measurement error:', err.message);
    process.exit(1);
  } finally {
    cdp.close();
  }

  // --- Build report with medians ---
  const metrics = {};
  const timedMetrics = ['injectTime', 'constructTime', 'fragmentActivateTime', 'disposeTime'];

  for (const key of timedMetrics) {
    const values = allRuns.map(r => r[key]).filter(v => v != null);
    metrics[key] = {
      median: values.length > 0 ? median(values) : null,
      unit: 'ms',
      values,
    };
  }

  // Memory delta (may be null if performance.memory unavailable)
  const memValues = allRuns.map(r => r.memoryDeltaMB).filter(v => v != null);
  metrics.memoryDeltaMB = {
    median: memValues.length > 0 ? median(memValues) : null,
    unit: 'MB',
    values: memValues,
    note: allRuns.find(r => r.memoryNote)?.memoryNote || null,
  };

  const report = {
    agent: AGENT_ID,
    port: PORT,
    timestamp: new Date().toISOString(),
    runs: RUNS,
    metrics,
  };

  // --- Output to stdout ---
  console.log(JSON.stringify(report, null, 2));

  // --- Save to file ---
  const outDir = join(here, '_perf-results');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${AGENT_ID}-baseline.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.error(`\nSaved to ${outFile}`);
}

run().catch(e => { console.error(e); process.exit(1); });
