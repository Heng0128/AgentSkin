// SPDX-License-Identifier: MPL-2.0

/**
 * # Specificity Budget Checker (λ P0-1 CLI)
 *
 * Standalone CLI that imports the 6 CSS generators, produces a small simulated
 * CSS output for each adapter, and validates it against the adapter's
 * `SpecificityProfile` (hardcoded here — see `src/compiler/specificity.ts`
 * for the canonical source).
 *
 * Exits 1 if any adapter violates its budget. Exits 0 when all pass.
 *
 * > **Note**: This script does NOT modify any generator files. It only reads
 * > them to perform a specificity audit. The canonical profiles live in
 * > `src/compiler/specificity.ts` and are the source of truth for the
 * > compiler emit pipeline (λ S4 integration).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Specificity calculation (mirror of src/compiler/specificity.ts)
// ---------------------------------------------------------------------------

/**
 * Calculate CSS selector specificity [a, b, c].
 * Mirrors the W3C algorithm in src/compiler/specificity.ts.
 * Uses strip-then-check to avoid matching fragments of class names as elements.
 * @returns {[number, number, number]} Tuple of [id, class/attr/pseudo, element]
 */
function calculateSpecificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;

  const cleaned = selector.replace(/"[^"]*"/g, '').replace(/'[^']*'/g, '');
  const parts = cleaned.split(/\s*[>+~]\s*|\s+/).filter(Boolean);

  for (const part of parts) {
    const idMatches = part.match(/#[a-zA-Z_-][\w-]*/g);
    if (idMatches) a += idMatches.length;

    const classMatches = part.match(/\.[a-zA-Z_-][\w-]*/g);
    if (classMatches) b += classMatches.length;

    const attrMatches = part.match(/\[[^\]]+\]/g);
    if (attrMatches) b += attrMatches.length;

    const pseudoElemMatches = part.match(/::[a-zA-Z-][\w-]*/g);
    if (pseudoElemMatches) c += pseudoElemMatches.length;

    // Strip pseudo-elements first so '::' is not matched as ':'.
    const withoutPseudoElem = part.replace(/::[a-zA-Z-][\w-]*/g, '');
    const pseudoClassMatches = withoutPseudoElem.match(/:[a-zA-Z-][\w-]*(?:\([^)]*\))?/g);
    if (pseudoClassMatches) b += pseudoClassMatches.length;

    // Element selectors: strip everything else, check what remains.
    let remaining = part;
    remaining = remaining.replace(/#[a-zA-Z_-][\w-]*/g, '');
    remaining = remaining.replace(/\.[a-zA-Z_-][\w-]*/g, '');
    remaining = remaining.replace(/\[[^\]]+\]/g, '');
    remaining = remaining.replace(/::[a-zA-Z-][\w-]*/g, '');
    remaining = remaining.replace(/:[a-zA-Z-][\w-]*(?:\([^)]*\))?/g, '');
    remaining = remaining.trim();

    if (remaining && remaining !== '*' && /^[a-zA-Z][\w-]*$/.test(remaining)) {
      c++;
    }
  }

  return [a, b, c];
}

// ---------------------------------------------------------------------------
// Hardcoded profiles (mirror of src/compiler/specificity.ts)
// ---------------------------------------------------------------------------

const PROFILES = {
  codex: {
    scopeStrategy: 'host-class-only',
    importantBudget: 150,
    maxSpecificity: [0, 1, 0],
    hostSelector: ':root.agentskin-host-codex',
  },
  doubao: {
    scopeStrategy: 'host-root',
    importantBudget: 650,
    maxSpecificity: [0, 2, 1],
    hostSelector: 'html.agentskin-host-doubao:root',
  },
  qoderwork: {
    scopeStrategy: 'host-root',
    importantBudget: 200,
    maxSpecificity: [0, 2, 1],
    hostSelector: 'html.agentskin-host-qoderwork:root',
  },
  zcode: {
    scopeStrategy: 'host-root',
    importantBudget: 200,
    maxSpecificity: [0, 2, 1],
    hostSelector: 'html.agentskin-host-zcode:root',
  },
  workbuddy: {
    scopeStrategy: 'body-descendant',
    importantBudget: 250,
    maxSpecificity: [0, 1, 2],
    hostSelector: 'html.agentskin-host-workbuddy body[data-application-name]',
  },
  traework: {
    scopeStrategy: 'body-descendant',
    importantBudget: 250,
    maxSpecificity: [0, 1, 2],
    hostSelector: 'html.agentskin-host-traework body',
  },
};

const ADAPTER_IDS = ['codex', 'doubao', 'qoderwork', 'zcode', 'workbuddy', 'traework'];

// ---------------------------------------------------------------------------
// Generator file CSS extraction
// ---------------------------------------------------------------------------

/**
 * Read a generator file and count the !important declarations + selectors.
 * This is a lightweight static check — we don't execute the generator,
 * we just analyze the CSS template strings and raw text.
 */
function analyzeGenerator(adapterId) {
  const genPath = resolve(root, 'scripts', 'generators', `${adapterId}Css.mjs`);

  let content;
  try {
    content = readFileSync(genPath, 'utf8');
  } catch {
    return { error: `Generator not found: ${genPath}` };
  }

  // Count !important in the raw file.
  const importantCount = (content.match(/!important/g) || []).length;

  // Extract selectors from template literals and string concatenations.
  // In the generators, selectors appear as: `${host} selector {`
  const selectorPattern = /`[^`]*?([a-zA-Z*.#:[][^{;]*?)\s*\{/g;
  const selectors = new Set();
  for (let m = selectorPattern.exec(content); m !== null; m = selectorPattern.exec(content)) {
    const sel = m[1].trim();
    // Clean up template expressions — extract only the selector fragment.
    const cleaned = sel.replace(/\$\{[^}]+\}/g, '').trim();
    if (cleaned) {
      cleaned.split(',').forEach((s) => {
        const t = s.trim();
        if (t) selectors.add(t);
      });
    }
  }

  // Also check lines that look like direct selector usage in template strings.
  const hostVarPattern = /\$\{host\}([.#\w[\]:]+\s*[{,])/g;
  for (let m = hostVarPattern.exec(content); m !== null; m = hostVarPattern.exec(content)) {
    const sel = m[1].replace(/[{}]/g, '').trim();
    if (sel) selectors.add(sel);
  }

  const overflowSelectors = [];
  for (const sel of selectors) {
    const spec = calculateSpecificity(sel);
    const max = PROFILES[adapterId].maxSpecificity;
    if (
      spec[0] > max[0] ||
      (spec[0] === max[0] && spec[1] > max[1]) ||
      (spec[0] === max[0] && spec[1] === max[1] && spec[2] > max[2])
    ) {
      overflowSelectors.push({ selector: sel, specificity: spec });
    }
  }

  return {
    importantCount,
    selectorCount: selectors.size,
    overflowSelectors,
  };
}

// ---------------------------------------------------------------------------
// Main report
// ---------------------------------------------------------------------------

function main() {
  const results = {};
  let anyViolated = false;

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  λ P0-1 Specificity Budget Report                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  for (const id of ADAPTER_IDS) {
    const profile = PROFILES[id];
    const analysis = analyzeGenerator(id);
    results[id] = analysis;

    if (analysis.error) {
      console.log(`  ${id.padEnd(12)} ERROR: ${analysis.error}`);
      anyViolated = true;
      continue;
    }

    const budgetExceeded = analysis.importantCount > profile.importantBudget;
    const hasOverflow = analysis.overflowSelectors.length > 0;
    const violated = budgetExceeded || hasOverflow;
    if (violated) anyViolated = true;

    const status = violated ? 'FAIL' : 'OK  ';
    const icon = violated ? '✗' : '✓';
    console.log(
      `  ${icon} ${id.padEnd(12)} ${status}  !important: ${String(analysis.importantCount).padStart(4)}/${profile.importantBudget.padEnd?.(3) ?? profile.importantBudget}  selectors: ${analysis.selectorCount}`,
    );

    if (budgetExceeded) {
      console.log(
        `    ↳ !important over budget by ${analysis.importantCount - profile.importantBudget}`,
      );
    }

    if (hasOverflow) {
      console.log(
        `    ↳ ${analysis.overflowSelectors.length} selector(s) exceed maxSpecificity [${profile.maxSpecificity.join(',')}]`,
      );
      for (const ov of analysis.overflowSelectors.slice(0, 3)) {
        console.log(`       "${ov.selector}" → [${ov.specificity.join(',')}]`);
      }
      if (analysis.overflowSelectors.length > 3) {
        console.log(`       ... and ${analysis.overflowSelectors.length - 3} more`);
      }
    }
  }

  console.log();
  console.log(`  Host selectors:`);
  for (const id of ADAPTER_IDS) {
    const profile = PROFILES[id];
    const spec = calculateSpecificity(profile.hostSelector);
    console.log(`    ${id.padEnd(12)} ${profile.hostSelector.padEnd(50)} [${spec.join(',')}]`);
  }

  console.log();
  if (anyViolated) {
    console.log('  ⚠  One or more adapters exceed their specificity budget.');
    console.log('     Run with λ S4 emit.ts integration to auto-fix via @layer agentskin.');
    process.exit(1);
  } else {
    console.log('  ✓ All adapters within specificity budget.');
    process.exit(0);
  }
}

main();
