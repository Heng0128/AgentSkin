// SPDX-License-Identifier: MPL-2.0
// scripts/validate-adapter.mjs — Adapter onboarding validation CLI
// Usage: node scripts/validate-adapter.mjs <agent-id>
// Checks adapter file presence, config shape, shared-engine usage, and anti-patterns.
// Exit 0 on success, exit 1 + error messages on failure.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENGINES_DIR = path.join(PROJECT_ROOT, 'engines');

const REQUIRED_CONFIG_FIELDS = ['agentId', 'hostClass', 'marker', 'selectors'];
const EXPECTED_ADAPTER_MAX_LINES = 150;

// ─── Helpers ──────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  process.exitCode = 1;
}

function ok(msg) {
  console.error(`  PASS: ${msg}`);
}

// ─── Main ──────────────────────────────────────────────────────────────────

const agentId = process.argv[2];
if (!agentId) {
  console.error('Usage: node scripts/validate-adapter.mjs <agent-id>');
  console.error('Example: node scripts/validate-adapter.mjs zcode');
  process.exit(1);
}

console.error(`\n=== validate-adapter: ${agentId} ===\n`);
process.exitCode = 0;

const adapterConfigPath = path.join(ENGINES_DIR, agentId, 'adapter-config.mjs');
const adapterPath = path.join(ENGINES_DIR, agentId, 'adapter.mjs');
const tokensPath = path.join(ENGINES_DIR, agentId, 'tokens.css');
const cosmeticPath = path.join(ENGINES_DIR, agentId, 'cosmetic.css');

// Check 1: adapter-config.mjs exists
let configContent = null;
if (existsSync(adapterConfigPath)) {
  ok('adapter-config.mjs exists');
  configContent = readFileSync(adapterConfigPath, 'utf8');
} else {
  // adapter-config is optional — some adapters use legacy IIFE pattern (traework)
  if (existsSync(adapterPath)) {
    ok('adapter-config.mjs absent (legacy IIFE adapter, using adapter.mjs)');
  } else {
    fail(`engines/${agentId}/adapter-config.mjs not found`);
    fail(`engines/${agentId}/adapter.mjs not found`);
    console.error(`\nResult: FAIL (no adapter files for agent "${agentId}")`);
    process.exit(1);
  }
}

// Check 2: adapter.mjs exists + uses shared engine
let adapterContent = null;
if (existsSync(adapterPath)) {
  ok('adapter.mjs exists');
  adapterContent = readFileSync(adapterPath, 'utf8');

  // Check 2a: uses shared engine (config-driven adapters)
  const usesSharedEngine = adapterContent.includes('__agentskin_shared_engine__');
  const usesCreateAdapter = adapterContent.includes('createAdapter');
  if (usesSharedEngine && usesCreateAdapter) {
    ok('adapter.mjs uses shared engine (createAdapter)');
  } else if (configContent === null) {
    // Legacy IIFE adapter without config — standalone pattern acceptable
    ok('adapter.mjs uses legacy standalone pattern (no config)');
  } else {
    fail(
      'adapter.mjs does not reference __agentskin_shared_engine__.createAdapter — config-driven adapters must use shared engine',
    );
  }

  // Check 2b: reads config from correct global
  if (configContent !== null) {
    const expectedConfigGlobal = `__agentskin_${agentId}_config__`;
    if (adapterContent.includes(expectedConfigGlobal)) {
      ok(`adapter.mjs reads from window.${expectedConfigGlobal}`);
    } else {
      fail(`adapter.mjs does not reference window.${expectedConfigGlobal}`);
    }
  }
} else {
  fail(`engines/${agentId}/adapter.mjs not found`);
}

// Check 3: Config has required fields
if (configContent !== null) {
  const configGlobal = `__agentskin_${agentId}_config__`;
  if (configContent.includes(configGlobal)) {
    ok(`config exports via window.${configGlobal}`);
  } else {
    fail(`adapter-config.mjs does not export window.${configGlobal}`);
  }

  for (const field of REQUIRED_CONFIG_FIELDS) {
    // Look for field in config object literal pattern: fieldName: or "fieldName":
    const fieldPattern = new RegExp(`\\b${field}\\s*:`);
    if (fieldPattern.test(configContent)) {
      ok(`config has required field: ${field}`);
    } else {
      fail(`config missing required field: ${field}`);
    }
  }

  // Check 3b: selectors has rootContainer
  const rootContainerPattern = /rootContainer\s*:/;
  if (rootContainerPattern.test(configContent)) {
    ok('selectors has rootContainer');
  } else {
    fail('selectors missing rootContainer (required for progressive rendering)');
  }

  // Check 3c: selectors has at least one route:* key
  const routeKeyPattern = /route:/;
  if (routeKeyPattern.test(configContent)) {
    ok('selectors has route:* key(s)');
  } else {
    console.error(
      `  WARN: selectors has no route:* keys (optional — only needed for route-aware adapters)`,
    );
  }
}

// Check 4: No duplicate standalone MutationObserver (should use shared engine)
if (adapterContent !== null) {
  // Count standalone `new MutationObserver` calls — shared engine provides observer.
  // Exempt observers marked with APP-SPECIFIC comment (app-unique behavior the
  // shared engine cannot handle, e.g. Doubao data-theme resets).
  const lines = adapterContent.split('\n');
  let standaloneMO = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/new\s+MutationObserver\s*\(/.test(lines[i])) {
      // Look back up to 2 lines for APP-SPECIFIC exemption comment
      const lookBack = lines.slice(Math.max(0, i - 2), i);
      const isAppSpecific = lookBack.some((l) => l.includes('APP-SPECIFIC'));
      if (!isAppSpecific) standaloneMO++;
    }
  }
  if (standaloneMO > 0) {
    fail(
      `adapter.mjs has ${standaloneMO} standalone MutationObserver (should use shared engine's AdaptiveMutationObserver)`,
    );
  } else {
    ok('adapter.mjs has no standalone MutationObserver');
  }

  // Check 4b: Idempotent guard present
  const hasGuard =
    adapterContent.includes('window[MARKER]') || adapterContent.includes('if (window[');
  if (hasGuard) {
    ok('adapter.mjs has idempotent guard');
  } else {
    console.error('  WARN: adapter.mjs has no idempotent guard (window[MARKER] check)');
  }
}

// Check 5: File size budget
if (adapterContent !== null) {
  const lineCount = adapterContent.split('\n').length;
  if (lineCount <= EXPECTED_ADAPTER_MAX_LINES) {
    ok(`adapter.mjs is ${lineCount} lines (within ${EXPECTED_ADAPTER_MAX_LINES} budget)`);
  } else {
    fail(
      `adapter.mjs is ${lineCount} lines (exceeds ${EXPECTED_ADAPTER_MAX_LINES} budget — move logic to adapter-config.mjs)`,
    );
  }
}

if (configContent !== null) {
  const lineCount = configContent.split('\n').length;
  console.error(`  INFO: adapter-config.mjs is ${lineCount} lines`);
}

// Check 6: Tokens + cosmetic files exist (required by orchestrator)
if (existsSync(tokensPath)) {
  ok('tokens.css exists');
} else {
  fail('tokens.css missing (required by orchestrator.ts)');
}

if (existsSync(cosmeticPath)) {
  ok('cosmetic.css exists');
} else {
  fail('cosmetic.css missing (required by orchestrator.ts)');
}

// Check 7: SPDX header present
if (adapterContent?.includes('SPDX-License-Identifier')) {
  ok('adapter.mjs has SPDX header');
} else if (adapterContent !== null) {
  console.error('  WARN: adapter.mjs missing SPDX-License-Identifier header');
}

if (configContent?.includes('SPDX-License-Identifier')) {
  ok('adapter-config.mjs has SPDX header');
} else if (configContent !== null) {
  console.error('  WARN: adapter-config.mjs missing SPDX-License-Identifier header');
}

// ─── Summary ───────────────────────────────────────────────────────────────

if (process.exitCode === 0) {
  console.error(`\nResult: PASS — adapter "${agentId}" is valid\n`);
} else {
  console.error(`\nResult: FAIL — adapter "${agentId}" has issues\n`);
}

process.exit(process.exitCode);
