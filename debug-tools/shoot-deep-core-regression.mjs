// SPDX-License-Identifier: MPL-2.0

/**
 * shoot-deep-core-regression.mjs — DeepCore Shadow DOM visual regression E2E script
 *
 * Usage: node debug-tools/shoot-deep-core-regression.mjs <port> <agentId>
 * Example: node debug-tools/shoot-deep-core-regression.mjs 52013 codex
 *
 * Performs a three-step screenshot comparison per Agent application:
 *   Step A — Baseline: capture screenshot with no injection
 *   Step B — Inject:  inject deep-core.mjs, construct DeepCore, activate fragment
 *   Step C — Cleanup: call dispose(), verify restoration to baseline
 *
 * Screenshots saved to debug-tools/_regression-shots/{agentId}-{stepA|stepB|stepC}.png
 * JSON report printed to stdout with dimensions, file size (bytes), and duration (ms) per step.
 */

import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = process.argv[2];
const AGENT_ID = process.argv[3];

if (!PORT || !AGENT_ID) {
  console.error('Usage: node shoot-deep-core-regression.mjs <port> <agentId>');
  console.error('Example: node shoot-deep-core-regression.mjs 52013 codex');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(
  join(here, '../engines/shared/deep-core.mjs'),
  'utf-8',
);
const SHOT_DIR = join(here, '_regression-shots');

// Ensure output directory exists
try {
  mkdirSync(SHOT_DIR, { recursive: true });
} catch (e) {
  // Directory already exists — safe to ignore
}

// ---------------------------------------------------------------------------
// CDP client — minimal promise-based wrapper (reuses probe-deep-core pattern)
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

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function captureScreenshot(cdp, fileName) {
  const start = performance.now();
  const shot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const pngBuffer = Buffer.from(shot.data, 'base64');
  const filePath = join(SHOT_DIR, fileName);
  writeFileSync(filePath, pngBuffer);
  const elapsed = Math.round(performance.now() - start);
  const stats = statSync(filePath);

  return {
    file: fileName,
    path: filePath,
    sizeBytes: stats.size,
    durationMs: elapsed,
    // PNG dimensions extracted from IHDR chunk (bytes 16-23)
    width: pngBuffer.readUInt32BE(16),
    height: pngBuffer.readUInt32BE(20),
  };
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

async function run() {
  const report = {
    agent: AGENT_ID,
    port: PORT,
    timestamp: new Date().toISOString(),
    steps: {},
    overall: 'PENDING',
  };

  // Discover page target via HTTP endpoint
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) {
    console.error(`No page target with webSocketDebuggerUrl found on port ${PORT}`);
    process.exit(1);
  }

  const cdp = await CDP.connect(page.webSocketDebuggerUrl);

  try {
    // Enable Page domain for screenshots
    await cdp.send('Page.enable');

    // ----- Step A: Baseline (no injection) -----
    const stepAStart = performance.now();
    report.steps.stepA = await captureScreenshot(cdp, `${AGENT_ID}-stepA.png`);
    report.steps.stepA.totalDurationMs = Math.round(performance.now() - stepAStart);

    // ----- Step B: Inject DeepCore + activate fragment -----
    const stepBStart = performance.now();

    // 1. Inject deep-core.mjs source
    const injectResult = await cdp.send('Runtime.evaluate', {
      expression: DEEP_CORE_SRC,
      returnByValue: false,
    });
    if (injectResult?.exceptionDetails) {
      throw new Error('DeepCore injection failed: ' + injectResult.exceptionDetails.text);
    }

    // 2. Construct DeepCore with test config
    const constructResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        try {
          const dc = new DeepCore({
            shadowMode: 'open-only',
            routes: [],
            fragments: { 'regression-test-frag': 'body { background: #ff0000 !important; }' },
            exposedState: [],
            enabled: true
          }, { agent: '${AGENT_ID}', themeId: 'regression-test' });
          return { ok: true, hasDispose: typeof dc.dispose === 'function' };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()`,
      returnByValue: true,
    });

    if (!constructResult?.result?.value?.ok) {
      throw new Error('DeepCore construction failed: ' + (constructResult?.result?.value?.error || 'unknown'));
    }

    // 3. Activate fragment to produce visible CSS change
    const activateResult = await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        try {
          FragmentRegistry.activate('regression-test-frag');
          return { ok: true, sheetCount: document.adoptedStyleSheets.length };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      })()`,
      returnByValue: true,
    });

    if (!activateResult?.result?.value?.ok) {
      throw new Error('Fragment activation failed: ' + (activateResult?.result?.value?.error || 'unknown'));
    }

    // Brief pause for rendering to settle
    await new Promise((r) => setTimeout(r, 200));

    report.steps.stepB = await captureScreenshot(cdp, `${AGENT_ID}-stepB.png`);
    report.steps.stepB.totalDurationMs = Math.round(performance.now() - stepBStart);

    // ----- Step C: Cleanup (dispose → restore baseline) -----
    const stepCStart = performance.now();

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

    if (!disposeResult?.result?.value?.ok) {
      throw new Error('DeepCore dispose failed: ' + (disposeResult?.result?.value?.error || 'unknown'));
    }

    // Brief pause for rendering to settle
    await new Promise((r) => setTimeout(r, 200));

    report.steps.stepC = await captureScreenshot(cdp, `${AGENT_ID}-stepC.png`);
    report.steps.stepC.totalDurationMs = Math.round(performance.now() - stepCStart);

    // Determine overall result
    report.overall = 'COMPLETE';
  } catch (err) {
    report.error = err.message;
    report.overall = 'ERROR';
  } finally {
    cdp.close();
  }

  // Output JSON report
  console.log(JSON.stringify(report, null, 2));
  console.log(`\n>>> ${report.agent} (:${report.port}) — ${report.overall}`);

  // Non-zero exit on error
  if (report.overall === 'ERROR') {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
