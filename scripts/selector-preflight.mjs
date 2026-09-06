// SPDX-License-Identifier: MPL-2.0
//
// # selector-preflight
//
// Unified compatibility preflight — validates that an agent's critical CSS
// selectors match the target application's DOM before theme application.
//
// Selectors are sourced from the canonical contract file:
//   src/engine/src/contracts/selector-contract.json
//
// Two modes:
//   1. Static (no --port): validates selector syntax only.
//   2. Runtime (--port <cdpPort>): connects to a live CDP session and
//      verifies selector matches against the actual DOM.
//
// Usage:
//   node scripts/selector-preflight.mjs --agent traework --threshold 85
//   node scripts/selector-preflight.mjs --agent codex --port 9222 --threshold 90
//   node scripts/selector-preflight.mjs --verify-contract
//
// Exit codes:
//   0 — hit rate >= threshold (preflight passed) or contract is in sync
//   1 — hit rate < threshold (preflight failed)
//   2 — unrecoverable error (bad arguments, CDP unreachable, contract drift)

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Contract loading
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = resolve(__dirname, '../src/engine/src/contracts/selector-contract.json');

/**
 * Load and parse the selector contract JSON.
 * @returns {object} Parsed contract object
 */
function loadContract() {
  try {
    const raw = readFileSync(CONTRACT_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to load selector contract: ${err.message}`);
  }
}

/**
 * Extract flat selector strings from the contract for a given agent.
 * Each entry's `selector` field is a comma-separated fallback chain;
 * we split and trim each fallback into individual selectors.
 *
 * @param {object} contract
 * @param {string} agentId
 * @returns {string[]} Individual CSS selector strings
 */
function extractSelectors(contract, agentId) {
  const agentSelectors = contract.selectors?.[agentId];
  if (!agentSelectors) return [];

  const result = [];
  for (const entry of Object.values(agentSelectors)) {
    if (!entry.selector) continue;
    for (const sel of entry.selector.split(',')) {
      const trimmed = sel.trim();
      if (trimmed) result.push(trimmed);
    }
  }
  return result;
}

/** @type {object | null} Cached contract singleton */
let _contractCache = null;

/**
 * Get cached contract (load once per process).
 * @returns {object}
 */
function getContract() {
  if (!_contractCache) {
    _contractCache = loadContract();
  }
  return _contractCache;
}

/**
 * Get valid agent IDs from the contract.
 * @returns {string[]}
 */
export function getValidAgentIds() {
  return Object.keys(getContract().selectors ?? {});
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function getArg(name) {
  const args = process.argv.slice(2);
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

// ---------------------------------------------------------------------------
// Contract verification (--verify-contract)
// ---------------------------------------------------------------------------

/**
 * Compare the contract against the selectivity-registry from the engine.
 * Reports agents and semantic names that exist in one but not the other.
 *
 * @param {object} contract
 * @param {{ registryAgentIds: string[], registryKeys: Record<string, string[]> }} registry
 * @returns {{ inSync: boolean, onlyInContract: string[], onlyInRegistry: string[], keyDiffs: Array<{ agent: string, onlyInContract: string[], onlyInRegistry: string[] }> }}
 */
function verifyContract(contract, registry) {
  const contractAgents = Object.keys(contract.selectors ?? {}).sort();
  const registryAgents = [...registry.registryAgentIds].sort();

  const onlyInContract = contractAgents.filter((a) => !registryAgents.includes(a));
  const onlyInRegistry = registryAgents.filter((a) => !contractAgents.includes(a));

  const keyDiffs = [];
  for (const agent of contractAgents) {
    if (!registry.registryKeys[agent]) continue;
    const contractKeys = Object.keys(contract.selectors[agent]).sort();
    const registryKeys = [...registry.registryKeys[agent]].sort();
    const missing = contractKeys.filter((k) => !registryKeys.includes(k));
    const extra = registryKeys.filter((k) => !contractKeys.includes(k));
    if (missing.length > 0 || extra.length > 0) {
      keyDiffs.push({ agent, onlyInContract: missing, onlyInRegistry: extra });
    }
  }

  return {
    inSync: onlyInContract.length === 0 && onlyInRegistry.length === 0 && keyDiffs.length === 0,
    onlyInContract,
    onlyInRegistry,
    keyDiffs,
  };
}

/**
 * Try to import the selectivity-registry from the engine source.
 * Falls back gracefully if the module cannot be loaded (e.g., plain Node context).
 *
 * @returns {Promise<{ registryAgentIds: string[], registryKeys: Record<string, string[]> } | null>}
 */
async function tryLoadRegistryAnalysis() {
  try {
    // Use file:// URL import path resolution to the registry module
    const registryUrl = resolve(__dirname, '../src/engine/src/runtime/selectivity-registry.mjs');
    const mod = await import('file://' + registryUrl);
    if (mod.listRegisteredAgents && mod.listSemanticNames) {
      const registryAgentIds = mod.listRegisteredAgents();
      const registryKeys = {};
      for (const agent of registryAgentIds) {
        registryKeys[agent] = mod.listSemanticNames(agent);
      }
      return { registryAgentIds, registryKeys };
    }
  } catch {
    // Module not loadable in this context — verification will skip registry comparison
  }
  return null;
}

// ---------------------------------------------------------------------------
// Static selector syntax validation
// ---------------------------------------------------------------------------

/**
 * Lightweight CSS selector syntax check.
 * Returns true if the selector appears syntactically valid.
 *
 * This is a heuristic check — it catches common errors (unbalanced brackets,
 * empty selectors, invalid combinators) but does not replace a full CSS parser.
 */
function isValidSelectorSyntax(selector) {
  if (!selector || selector.trim() === '') return false;

  // Check balanced brackets and parentheses.
  let bracketDepth = 0;
  let parenDepth = 0;
  for (const ch of selector) {
    if (ch === '[') bracketDepth++;
    else if (ch === ']') bracketDepth--;
    else if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth--;
    if (bracketDepth < 0 || parenDepth < 0) return false;
  }
  if (bracketDepth !== 0 || parenDepth !== 0) return false;

  // Must start with a valid character: . # [ * : : : - _ a-zA-Z
  if (!/^.[-a-zA-Z_0-9*[#:\s.>~+]/.test(selector) && !/^[a-zA-Z]/.test(selector)) {
    return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// CDP connection (runtime mode)
// ---------------------------------------------------------------------------

async function connectCdp(portValue, timeoutMs = 10000) {
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

  await send('Runtime.enable').catch(() => {});

  return {
    send,
    close() {
      try {
        ws.close();
      } catch {
        // ignore
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Selector probing (runtime)
// ---------------------------------------------------------------------------

/**
 * Probe a single selector against a live CDP session.
 * Returns { kind: 'hit'|'miss'|'invalid', count }.
 */
async function probeSelector(cdp, selector) {
  const expr = `(() => {
    const sel = ${JSON.stringify(selector)};
    try {
      document.createElement('div').querySelector(sel);
    } catch (e) {
      return JSON.stringify({ kind: 'invalid', count: 0, error: String(e.message) });
    }
    let count = 0;
    try {
      count = document.querySelectorAll(sel).length;
    } catch {
      return JSON.stringify({ kind: 'invalid', count: 0, error: 'querySelectorAll threw' });
    }
    return JSON.stringify({ kind: count > 0 ? 'hit' : 'miss', count });
  })()`;

  const result = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  const raw = result?.result?.value;
  if (typeof raw !== 'string') {
    return { kind: 'miss', count: 0, error: 'unexpected CDP result' };
  }
  try {
    const parsed = JSON.parse(raw);
    return { kind: parsed.kind, count: parsed.count, error: parsed.error };
  } catch {
    return { kind: 'miss', count: 0, error: 'failed to parse CDP result' };
  }
}

// ---------------------------------------------------------------------------
// Preflight logic
// ---------------------------------------------------------------------------

/**
 * Run the preflight check for an agent.
 * @param {string} agentId
 * @param {number|null} cdpPort
 * @param {number} threshold
 * @returns {Promise<{report: object, exitCode: number}>}
 */
export async function runPreflight(agentId, cdpPort, threshold) {
  const contract = getContract();
  const selectors = extractSelectors(contract, agentId);
  const results = [];

  if (cdpPort) {
    // Runtime mode: connect to CDP and probe selectors.
    let cdp;
    try {
      cdp = await connectCdp(cdpPort);
    } catch (err) {
      throw new Error(`CDP connection failed: ${err.message}`);
    }
    try {
      for (const selector of selectors) {
        const probe = await probeSelector(cdp, selector);
        results.push({ selector, kind: probe.kind, count: probe.count });
      }
    } finally {
      cdp.close();
    }
  } else {
    // Static mode: syntax check only.
    for (const selector of selectors) {
      const valid = isValidSelectorSyntax(selector);
      results.push({
        selector,
        kind: valid ? 'hit' : 'invalid',
        count: valid ? 1 : 0,
      });
    }
  }

  const hitCount = results.filter((r) => r.kind === 'hit').length;
  const total = results.length;
  const hitRate = total > 0 ? Math.round((hitCount / total) * 1000) / 10 : 0;
  const passed = hitRate >= threshold;

  const report = {
    agent: agentId,
    threshold,
    hitRate,
    passed,
    mode: cdpPort ? 'runtime' : 'static',
    results,
    timestamp: new Date().toISOString(),
  };

  return { report, exitCode: passed ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // --verify-contract mode: compare contract against registry, then exit
  if (hasFlag('verify-contract')) {
    const contract = getContract();
    const registry = await tryLoadRegistryAnalysis();

    if (!registry) {
      console.log('Contract loaded successfully. Registry module not loadable in this context.');
      console.log(`Contract agents: ${getValidAgentIds().join(', ')}`);
      process.exit(0);
    }

    const diff = verifyContract(contract, registry);

    if (diff.inSync) {
      console.log('Contract is in sync with selectivity-registry.');
      process.exit(0);
    }

    console.log('Contract drift detected:');
    if (diff.onlyInContract.length > 0) {
      console.log(`  In contract but not registry: ${diff.onlyInContract.join(', ')}`);
    }
    if (diff.onlyInRegistry.length > 0) {
      console.log(`  In registry but not contract: ${diff.onlyInRegistry.join(', ')}`);
    }
    for (const kd of diff.keyDiffs) {
      if (kd.onlyInContract.length > 0) {
        console.log(
          `  [${kd.agent}] In contract but not registry: ${kd.onlyInContract.join(', ')}`,
        );
      }
      if (kd.onlyInRegistry.length > 0) {
        console.log(
          `  [${kd.agent}] In registry but not contract: ${kd.onlyInRegistry.join(', ')}`,
        );
      }
    }
    process.exit(2);
  }

  const agentId = getArg('agent');
  const portArg = getArg('port');
  const thresholdArg = getArg('threshold');
  const timeoutArg = getArg('timeout');
  const validAgentIds = getValidAgentIds();

  if (!agentId) {
    console.error('Error: --agent is required (e.g. --agent traework)');
    console.error(`Valid agents: ${validAgentIds.join(', ')}`);
    process.exit(2);
  }

  if (!validAgentIds.includes(agentId)) {
    console.error(`Error: unknown agent "${agentId}". Valid: ${validAgentIds.join(', ')}`);
    process.exit(2);
  }

  const threshold = Number(thresholdArg ?? '85');
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
    console.error('Error: --threshold must be a number between 0 and 100');
    process.exit(2);
  }

  const cdpPort = portArg ? Number(portArg) : null;
  if (cdpPort !== null && (!Number.isInteger(cdpPort) || cdpPort <= 0 || cdpPort > 65535)) {
    console.error('Error: --port must be a valid TCP port (1-65535)');
    process.exit(2);
  }

  const _timeoutMs = Number(timeoutArg ?? '10000');

  let outcome;
  try {
    outcome = await runPreflight(agentId, cdpPort, threshold);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
  }

  console.log(JSON.stringify(outcome.report, null, 2));
  process.exit(outcome.exitCode);
}

// Only run main when executed directly (not when imported for testing).
import { pathToFileURL } from 'node:url';

if (pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(`Error: ${err.stack ?? err}`);
    process.exit(2);
  });
}
