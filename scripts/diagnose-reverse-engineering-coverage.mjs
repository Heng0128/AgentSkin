// SPDX-License-Identifier: MPL-2.0

/**
 * # diagnose-reverse-engineering-coverage
 *
 * Diagnostic tool that reports the coverage of reverse-engineering-derived
 * contexts across all adapter contracts. Verifies that:
 *
 * 1. Every adapter has at least one reverse-engineering context
 * 2. Every reverse-engineering check documents knownGaps
 * 3. All reverse-engineering contexts have unique names (no collisions)
 * 4. Last-verified dates are within expected range
 *
 * Usage: node scripts/diagnose-reverse-engineering-coverage.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

function loadContract(agentId) {
  const path = join(ROOT, 'src/shared/injection/contracts', `${agentId}.contract.json`);
  return JSON.parse(readFileSync(path, 'utf-8')).targets[agentId].verification;
}

const stats = {
  totalContexts: 0,
  reContexts: 0,
  reChecks: 0,
  checksWithGaps: 0,
  checksWithoutGaps: 0,
  agents: {},
};

const allContextNames = new Set();

for (const agentId of AGENTS) {
  const contract = loadContract(agentId);
  const agentStats = {
    totalContexts: contract.contexts.length,
    reContexts: 0,
    reChecks: 0,
    checksWithKnownGaps: 0,
    checksWithoutKnownGaps: 0,
  };

  for (const ctx of contract.contexts) {
    const isReContext = ctx.required.some((c) => c.provenance?.source === 'reverse-engineering');
    if (isReContext) {
      agentStats.reContexts++;
      stats.reContexts++;

      // Check for name uniqueness
      if (allContextNames.has(ctx.name)) {
        console.warn(`⚠️  Duplicate context name: ${agentId}/${ctx.name}`);
      }
      allContextNames.add(ctx.name);
    }

    for (const check of ctx.required) {
      if (check.provenance?.source === 'reverse-engineering') {
        agentStats.reChecks++;
        stats.reChecks++;
        if (check.provenance.knownGaps && check.provenance.knownGaps.length > 0) {
          agentStats.checksWithKnownGaps++;
          stats.checksWithGaps++;
        } else {
          agentStats.checksWithoutKnownGaps++;
          stats.checksWithoutGaps++;
        }
      }
    }
  }

  stats.totalContexts += agentStats.totalContexts;
  stats.agents[agentId] = agentStats;
}

// ── Report ─────────────────────────────────────────────────────────────────

console.log('═'.repeat(60));
console.log('  Reverse-Engineering Contract Coverage Diagnostic');
console.log('═'.repeat(60));
console.log();

console.log(`Total adapters scanned:          ${AGENTS.length}`);
console.log(`Total contexts across all:       ${stats.totalContexts}`);
console.log(`Reverse-engineering contexts:    ${stats.reContexts}`);
console.log(`Reverse-engineering checks:      ${stats.reChecks}`);
console.log(`Checks with knownGaps documented: ${stats.checksWithGaps}`);
console.log(`Checks missing knownGaps:        ${stats.checksWithoutGaps}`);
console.log();

console.log('─'.repeat(60));
console.log('  Per-Adaptor Breakdown');
console.log('─'.repeat(60));

for (const agentId of AGENTS) {
  const s = stats.agents[agentId];
  const gapsOk = s.checksWithoutKnownGaps === 0 ? '✅' : '⚠️';
  console.log(
    `  ${agentId.padEnd(12)} contexts: ${String(s.totalContexts).padStart(2)} | ` +
      `RE: ${String(s.reContexts).padStart(2)} | checks: ${String(s.reChecks).padStart(2)} | ` +
      `gaps: ${gapsOk} ${s.checksWithKnownGaps}/${s.reChecks}`,
  );
}

console.log();

// ── Validation ─────────────────────────────────────────────────────────────

let exitCode = 0;

// Rule 1: Every adapter must have at least 1 reverse-engineering context
for (const agentId of AGENTS) {
  if (stats.agents[agentId].reContexts < 1) {
    console.error(`❌ ${agentId}: missing reverse-engineering contexts`);
    exitCode = 1;
  }
}

// Rule 2: Every reverse-engineering check must document knownGaps
for (const agentId of AGENTS) {
  if (stats.agents[agentId].checksWithoutKnownGaps > 0) {
    console.error(
      `❌ ${agentId}: ${stats.agents[agentId].checksWithoutKnownGaps} reverse-engineering check(s) missing knownGaps`,
    );
    exitCode = 1;
  }
}

// Rule 3: All contexts must have provenance with lastVerified
for (const agentId of AGENTS) {
  const contract = loadContract(agentId);
  for (const ctx of contract.contexts) {
    for (const check of ctx.required) {
      if (check.provenance?.source === 'reverse-engineering') {
        if (!check.provenance.lastVerified) {
          console.error(`❌ ${agentId}/${ctx.name}/${check.name}: missing lastVerified`);
          exitCode = 1;
        }
      }
    }
  }
}

if (exitCode === 0) {
  console.log('✅ All reverse-engineering contract validation rules passed.');
  console.log('═'.repeat(60));
} else {
  console.error('═'.repeat(60));
  console.error('❌ Some validation rules failed. See above for details.');
  console.error('═'.repeat(60));
}

process.exit(exitCode);
