// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # runtime-check-all
//
// CLI entry point for the runtime quality gate. Connects to a local AI
// agent via CDP (Chrome DevTools Protocol), reads its agentskin manifest
// for selector baselines, invokes the runtime validator, and writes a
// structured JSON report to stdout.
//
// Usage:
//   node scripts/runtime-check-all.mjs \
//     --agent doubao \
//     --port 61607 \
//     --manifest themes/midnight-aurora/manifest.json \
//     --timeout 10000
//
// Exit codes:
//   0 — validator ran and overall result is "pass"
//   1 — validator ran and overall result is "fail"
//   2 — unrecoverable error (bad arguments, CDP unreachable, missing file)

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRuntimeQuality } from './lib/runtime-validator.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const agentId = getArg('agent');
const port = Number(getArg('port'));
const manifestArg = getArg('manifest');
const timeoutMs = Number(getArg('timeout') ?? '10000');
const jsonOutput = hasFlag('json');

if (!agentId) {
  console.error('Error: --agent is required (e.g. --agent doubao)');
  process.exit(2);
}

if (!Number.isInteger(port) || port <= 0) {
  console.error('Error: --port must be a positive integer (e.g. --port 61607)');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Manifest discovery
// ---------------------------------------------------------------------------

function resolveManifestPath() {
  if (manifestArg) return path.resolve(process.cwd(), manifestArg);
  const themesDir = path.resolve(process.cwd(), 'themes');
  if (!existsSync(themesDir)) return null;
  let best = null;
  let bestMtime = 0;
  try {
    for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('_')) continue;
      const mp = path.join(themesDir, entry.name, 'manifest.json');
      if (!existsSync(mp)) continue;
      const st = statSync(mp);
      if (st.mtimeMs > bestMtime) {
        bestMtime = st.mtimeMs;
        best = mp;
      }
    }
  } catch {
    // themes/ unreadable — return null
  }
  return best;
}

function defaultSelectors() {
  return ['#composer', '#sidebar', '#response-area', '#chat-input'];
}

function loadSelectors(manifestPath) {
  if (!manifestPath || !existsSync(manifestPath)) return defaultSelectors();
  let raw;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return defaultSelectors();
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return defaultSelectors();
  }
  const target = manifest?.targets?.[agentId];
  if (target && Array.isArray(target.selectors) && target.selectors.length > 0) {
    return target.selectors;
  }
  return defaultSelectors();
}

// ---------------------------------------------------------------------------
// CDP connection
// ---------------------------------------------------------------------------

async function connectCdp(portValue) {
  const versionResp = await fetch(`http://127.0.0.1:${portValue}/json/version`);
  const version = await versionResp.json();
  if (!version.webSocketDebuggerUrl) {
    throw new Error('CDP /json/version missing webSocketDebuggerUrl');
  }

  const targetsResp = await fetch(`http://127.0.0.1:${portValue}/json`);
  const targets = await targetsResp.json();
  const page = targets.find(
    (t) =>
      t.type === 'page' &&
      t.webSocketDebuggerUrl &&
      !/^(devtools|chrome|about:)$/i.test(t.url ?? ''),
  );
  if (!page) {
    throw new Error('No page target found via CDP /json');
  }

  // Node.js >= 21 ships a global WebSocket; fall back to a helpful error.
  const WS = globalThis.WebSocket;
  if (!WS) {
    throw new Error('globalThis.WebSocket not available (Node >= 21 required)');
  }

  const ws = new WS(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(e.message ?? new Error('WS error')), { once: true });
  });

  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  // Enable Runtime so we can evaluate expressions.
  await send('Runtime.enable').catch(() => {});

  return {
    send,
    close() {
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const manifestPath = resolveManifestPath();
  const selectors = loadSelectors(manifestPath);

  let cdp;
  try {
    cdp = await connectCdp(port);
  } catch (err) {
    console.error(`Error: CDP connection failed: ${err.message}`);
    console.error(`  Is the AI agent running with --remote-debugging-port=${port}?`);
    process.exit(2);
  }

  let result;
  try {
    result = await validateRuntimeQuality(cdp, selectors, {});
  } finally {
    cdp.close();
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const lines = [
      '',
      `Runtime Quality Gate — Agent: ${agentId}`,
      '',
      `  Component hit : score ${result.component.score}  ${result.component.passed ? 'PASS' : 'FAIL'}`,
      `  Contrast      : score ${result.contrast.score}  ${result.contrast.passed ? 'PASS' : 'FAIL'}`,
      `  Viewport      : ${result.viewport.passed ? 'PASS (no overflow)' : 'FAIL (horizontal overflow)'}`,
      '',
      `  Overall       : ${result.overall.toUpperCase()}`,
      '',
    ];
    console.log(lines.join('\n'));
  }

  process.exit(result.overall === 'pass' ? 0 : 1);
}

main().catch((err) => {
  console.error(`Error: ${err.stack ?? err}`);
  process.exit(2);
});
