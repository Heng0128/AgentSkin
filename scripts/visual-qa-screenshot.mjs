// SPDX-License-Identifier: MPL-2.0

/**
 * # Visual QA — Runtime Screenshot Verification
 *
 * Run via: `node scripts/visual-qa-screenshot.mjs --port <CDP_PORT> [--agent <id>]`
 *
 * Provides runtime visual QA by:
 * 1. Capturing a baseline screenshot (before injection)
 * 2. Capturing a result screenshot (after injection, triggered manually or via flag)
 * 3. Computing pixel-level diff between the two screenshots
 * 4. Generating an HTML report with before / after / diff visualisation
 *
 * The script connects to a running application via Chrome DevTools Protocol (CDP)
 * WebSocket. It uses `Page.captureScreenshot` to obtain PNG frames, decodes them
 * with `pngjs` (already a project dependency), and performs a per-pixel RGBA
 * comparison. Identical pixels are rendered as a greyscale delta; changed pixels
 * are highlighted in red. An overall similarity score (0–100%) is computed.
 *
 * ## CLI options
 *
 * | Flag | Default | Description |
 * |------|---------|-------------|
 * | `--port` | — | CDP port of the target application (required) |
 * | `--agent` | `unknown` | Agent identifier for labelling the report |
 * | `--output` | `test-output/visual-qa/` | Directory for PNG files and HTML report |
 * | `--delay` | `2000` | Milliseconds to wait between before/after captures |
 * | `--trigger` | — | JS expression to eval before the "after" capture (e.g. theme apply) |
 *
 * ## Output
 *
 * - `baseline.png` — the pre-injection screenshot
 * - `result.png`   — the post-injection screenshot
 * - `diff.png`     — red-highlighted diff map
 * | `report.html`  — self-contained HTML report
 *
 * If only `--port` is given (no `--trigger`), the script captures two screenshots
 * separated by `--delay` ms and diffs them. This is useful for quick regression
 * checks where the injection is triggered externally between the two captures.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments in the form `--key value` or `--key=value`.
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--(\w[\w-]*)(?:=(.*))?$/u.exec(argv[i]);
    if (m) {
      const key = m[1];
      let val;
      if (m[2] !== undefined) val = m[2];
      else if (argv[i + 1] && !argv[i + 1].startsWith('--')) val = argv[++i];
      else val = 'true';
      args[key] = val;
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// CDP client (minimal — only what we need for screenshots)
// ---------------------------------------------------------------------------

/**
 * Minimal CDP WebSocket client.
 *
 * Handles message correlation (id ↔ pending promise) and provides a typed
 * `send(method, params)` that resolves with the result object.
 */
class CdpClient {
  /**
   * @param {string} wsUrl — Full WebSocket URL (e.g. ws://127.0.0.1:9222/devtools/page/XYZ)
   */
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', (ev) => reject(new Error(`WS error: ${ev.type}`)), {
        once: true,
      });
      this.ws.addEventListener('message', (ev) => this.#onMessage(ev.data));
    });
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return; // ignore malformed
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  }

  /**
   * Send a CDP command and await the result.
   * @param {string} method - CDP domain method (e.g. "Page.captureScreenshot")
   * @param {object} [params={}]
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<any>}
   */
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------

/**
 * Discover the first available page target via CDP HTTP endpoint.
 * @param {number} port - CDP port
 * @returns {Promise<string|null>} webSocketDebuggerUrl or null
 */
async function discoverPageTarget(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json`);
    if (!resp.ok) return null;
    const targets = await resp.json();
    const page = targets.find(
      (t) =>
        t.type === 'page' &&
        t.webSocketDebuggerUrl &&
        !/^(devtools|chrome|about:)/iu.test(t.url || ''),
    );
    return page ? page.webSocketDebuggerUrl : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

/**
 * Capture a PNG screenshot via CDP.
 *
 * @param {string} wsUrl — Target WebSocket debugger URL
 * @returns {Promise<{ png: PNG, width: number, height: number }>} Decoded PNG and dimensions
 */
async function captureScreenshot(wsUrl) {
  const client = new CdpClient(wsUrl);
  await client.connect();

  try {
    await client.send('Page.enable');
    const result = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    });
    if (!result?.data) throw new Error('CDP returned empty screenshot data');

    const buf = Buffer.from(result.data, 'base64');
    const png = PNG.sync.read(buf);
    return { png, width: png.width, height: png.height };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Pixel diff
// ---------------------------------------------------------------------------

/**
 * Compute pixel-level diff between two PNG images of equal dimensions.
 *
 * Algorithm (per-pixel, RGBA):
 * - For each pixel, compute the max channel-wise absolute difference.
 * - If the max delta exceeds `threshold` (default 8 / 255), the pixel is
 *   considered "changed" and painted red in the diff image.
 * - Otherwise the pixel is painted a neutral grey (visual context).
 *
 * The function also computes an overall similarity score:
 *   score = (1 - changedPixels / totalPixels) * 100
 *
 * @param {PNG} baseline - The reference image
 * @param {PNG} result - The comparison image
 * @param {object} [opts]
 * @param {number} [opts.threshold=8] - Per-channel delta threshold (0–255)
 * @param {number} [opts.highlightR=220] - Red channel for changed pixels
 * @param {number} [opts.highlightG=40] - Green channel for changed pixels
 * @param {number} [opts.highlightB=40] - Blue channel for changed pixels
 * @returns {{ diff: PNG, changedPixels: number, totalPixels: number, similarity: number }}
 */
export function computePixelDiff(baseline, result, opts = {}) {
  const threshold = opts.threshold ?? 8;
  const highlightR = opts.highlightR ?? 220;
  const highlightG = opts.highlightG ?? 40;
  const highlightB = opts.highlightB ?? 40;

  if (baseline.width !== result.width || baseline.height !== result.height) {
    throw new Error(
      `Dimension mismatch: baseline=${baseline.width}x${baseline.height}, result=${result.width}x${result.height}`,
    );
  }

  const { width, height } = baseline;
  const diff = new PNG({ width, height });
  let changedPixels = 0;
  const totalPixels = width * height;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dr = Math.abs(baseline.data[idx] - result.data[idx]);
      const dg = Math.abs(baseline.data[idx + 1] - result.data[idx + 1]);
      const db = Math.abs(baseline.data[idx + 2] - result.data[idx + 2]);
      const da = Math.abs(baseline.data[idx + 3] - result.data[idx + 3]);
      const maxDelta = Math.max(dr, dg, db, da);

      if (maxDelta > threshold) {
        changedPixels++;
        diff.data[idx] = highlightR;
        diff.data[idx + 1] = highlightG;
        diff.data[idx + 2] = highlightB;
        diff.data[idx + 3] = 255;
      } else {
        // Neutral grey for unchanged pixels (provides visual context)
        const grey = 240;
        diff.data[idx] = grey;
        diff.data[idx + 1] = grey;
        diff.data[idx + 2] = grey;
        diff.data[idx + 3] = 255;
      }
    }
  }

  const similarity = ((totalPixels - changedPixels) / totalPixels) * 100;
  return { diff, changedPixels, totalPixels, similarity };
}

// ---------------------------------------------------------------------------
// HTML report
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained HTML report with before / after / diff images.
 *
 * Images are embedded as base64 data URIs so the report works offline.
 *
 * @param {object} params
 * @param {Buffer} params.baselinePng - Encoded baseline PNG
 * @param {Buffer} params.resultPng - Encoded result PNG
 * @param {Buffer} params.diffPng - Encoded diff PNG
 * @param {number} params.changedPixels
 * @param {number} params.totalPixels
 * @param {number} params.similarity
 * @param {string} params.agent
 * @param {string} params.timestamp - ISO timestamp
 * @returns {string} Full HTML document
 */
export function generateHtmlReport(params) {
  const {
    baselinePng,
    resultPng,
    diffPng,
    changedPixels,
    totalPixels,
    similarity,
    agent,
    timestamp,
  } = params;

  const baselineUri = `data:image/png;base64,${baselinePng.toString('base64')}`;
  const resultUri = `data:image/png;base64,${resultPng.toString('base64')}`;
  const diffUri = `data:image/png;base64,${diffPng.toString('base64')}`;

  const similarityClass = similarity >= 99.5 ? 'ok' : similarity >= 95 ? 'warn' : 'fail';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Visual QA Report — ${escapeHtml(agent)}</title>
<style>
  :root { --bg: #0f1117; --surface: #1a1d27; --border: #2a2d3a; --text: #e4e6f0; --muted: #8b8fa8; --ok: #3ecf8e; --warn: #f5a623; --fail: #e74c3c; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); padding: 32px; }
  h1 { font-size: 24px; margin-bottom: 8px; }
  .subtitle { color: var(--muted); font-size: 14px; margin-bottom: 24px; }
  .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }
  .card__label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
  .card__value { font-size: 28px; font-weight: 700; }
  .card__value.ok { color: var(--ok); }
  .card__value.warn { color: var(--warn); }
  .card__value.fail { color: var(--fail); }
  .gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
  .frame { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .frame__label { padding: 12px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--border); }
  .frame__img { width: 100%; height: auto; display: block; image-rendering: auto; }
  footer { margin-top: 32px; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<h1>Visual QA Report</h1>
<p class="subtitle">Agent: <strong>${escapeHtml(agent)}</strong> &middot; Generated: ${escapeHtml(timestamp)}</p>

<div class="metrics">
  <div class="card">
    <div class="card__label">Similarity</div>
    <div class="card__value ${similarityClass}">${similarity.toFixed(2)}%</div>
  </div>
  <div class="card">
    <div class="card__label">Changed Pixels</div>
    <div class="card__value ${similarityClass}">${changedPixels.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card__label">Total Pixels</div>
    <div class="card__value">${totalPixels.toLocaleString()}</div>
  </div>
  <div class="card">
    <div class="card__label">Verdict</div>
    <div class="card__value ${similarityClass}">${similarity >= 99.5 ? 'PASS' : similarity >= 95 ? 'WARN' : 'FAIL'}</div>
  </div>
</div>

<div class="gallery">
  <div class="frame">
    <div class="frame__label">Baseline (before)</div>
    <img class="frame__img" src="${baselineUri}" alt="Baseline screenshot">
  </div>
  <div class="frame">
    <div class="frame__label">Result (after)</div>
    <img class="frame__img" src="${resultUri}" alt="Result screenshot">
  </div>
  <div class="frame">
    <div class="frame__label">Diff map (red = changed)</div>
    <img class="frame__img" src="${diffUri}" alt="Diff map">
  </div>
</div>

<footer>AgentSkin Visual QA &middot; Pixel diff threshold: 8/255 per channel</footer>
</body>
</html>`;
}

/**
 * Escape special HTML characters to prevent XSS in the report.
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full visual QA pipeline.
 *
 * @param {object} config
 * @param {number} config.port - CDP port
 * @param {string} config.agent - Agent identifier
 * @param {string} config.outputDir - Output directory
 * @param {number} config.delayMs - Delay between captures
 * @param {string} [config.trigger] - Optional JS expression to eval before "after" capture
 * @returns {Promise<{ similarity: number, reportPath: number }>}
 */
async function runVisualQa(config) {
  const { port, agent, outputDir, delayMs, trigger } = config;

  // Discover target
  const wsUrl = await discoverPageTarget(port);
  if (!wsUrl) {
    throw new Error(
      `No page target found on CDP port ${port}. Is the application running with --remote-debugging-port?`,
    );
  }

  // Ensure output dir
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  // Capture baseline
  console.log('  Capturing baseline screenshot...');
  const { png: baselinePng } = await captureScreenshot(wsUrl);

  // Optionally trigger injection
  if (trigger) {
    console.log(`  Evaluating trigger: ${trigger}`);
    const client = new CdpClient(wsUrl);
    await client.connect();
    try {
      await client.send('Runtime.enable');
      await client.send('Runtime.evaluate', { expression: trigger });
    } finally {
      client.close();
    }
  }

  // Wait for rendering
  console.log(`  Waiting ${delayMs}ms for rendering...`);
  await new Promise((r) => setTimeout(r, delayMs));

  // Capture result
  console.log('  Capturing result screenshot...');
  const { png: resultPng } = await captureScreenshot(wsUrl);

  // Compute diff
  console.log('  Computing pixel diff...');
  const { diff, changedPixels, totalPixels, similarity } = computePixelDiff(baselinePng, resultPng);

  // Encode PNGs
  const baselineBuf = PNG.sync.write(baselinePng);
  const resultBuf = PNG.sync.write(resultPng);
  const diffBuf = PNG.sync.write(diff);

  // Write PNG files
  const baselinePath = join(outputDir, 'baseline.png');
  const resultPath = join(outputDir, 'result.png');
  const diffPath = join(outputDir, 'diff.png');
  writeFileSync(baselinePath, baselineBuf);
  writeFileSync(resultPath, resultBuf);
  writeFileSync(diffPath, diffBuf);

  // Generate HTML report
  const timestamp = new Date().toISOString();
  const html = generateHtmlReport({
    baselinePng: baselineBuf,
    resultPng: resultBuf,
    diffPng: diffBuf,
    changedPixels,
    totalPixels,
    similarity,
    agent,
    timestamp,
  });
  const reportPath = join(outputDir, 'report.html');
  writeFileSync(reportPath, html, 'utf8');

  return { similarity, reportPath, changedPixels, totalPixels };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const port = Number(args.port);
  if (!port || Number.isNaN(port)) {
    console.error(
      'Usage: node scripts/visual-qa-screenshot.mjs --port <CDP_PORT> [--agent <id>] [--output <dir>] [--delay <ms>] [--trigger <js>]',
    );
    console.error('');
    console.error('Example:');
    console.error('  node scripts/visual-qa-screenshot.mjs --port 52743 --agent workbuddy');
    console.error(
      '  node scripts/visual-qa-screenshot.mjs --port 9222 --trigger "document.body.classList.toggle(\'dark\')" --delay 3000',
    );
    process.exit(1);
  }

  const agent = args.agent || 'unknown';
  const outputDir = args.output || join(ROOT, 'test-output', 'visual-qa');
  const delayMs = Number(args.delay) || 2000;
  const trigger = args.trigger;

  console.log(`\n=== AgentSkin Visual QA ===`);
  console.log(`  Agent:     ${agent}`);
  console.log(`  CDP port:  ${port}`);
  console.log(`  Output:    ${outputDir}`);
  console.log(`  Delay:     ${delayMs}ms`);
  if (trigger) console.log(`  Trigger:   ${trigger}`);
  console.log('');

  try {
    const result = await runVisualQa({ port, agent, outputDir, delayMs, trigger });

    console.log(`\n--- Results ---`);
    console.log(`  Similarity:     ${result.similarity.toFixed(2)}%`);
    console.log(
      `  Changed pixels: ${result.changedPixels.toLocaleString()} / ${result.totalPixels.toLocaleString()}`,
    );
    console.log(`  Report:         ${result.reportPath}`);
    console.log('');

    // Exit with non-zero if similarity is below 95% (CI gate)
    if (result.similarity < 95) {
      console.error('✖ Visual QA FAIL — similarity below 95% threshold');
      process.exit(1);
    }

    console.log('✓ Visual QA PASS');
  } catch (err) {
    console.error(`\n✖ Error: ${err.message}`);
    process.exit(1);
  }
}

// Run only when invoked directly (not imported for testing)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main();
}

// Exports for testing (re-export already-exported functions for convenience)
export { CdpClient, captureScreenshot, discoverPageTarget, parseArgs, runVisualQa };
