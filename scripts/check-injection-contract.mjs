// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Contract Assertion
 *
 * Run via: `node scripts/check-injection-contract.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Asserts the cross-process injection contract stays in sync across four
 * structural sources:
 *
 * 1. src/shared/types.ts `AgentId` union
 *    (the canonical agent list — every other source must match this set)
 * 2. src/shared/injection-constants.ts HOST_CLASS_PREFIX
 *    (the main-process source of truth for the host class prefix)
 * 3. engines/<agent>/adapter.mjs const HOST_CLASS + required engine files
 *    (the renderer runtime truth, eval'd into the page)
 * 4. themes/<theme>/assets/css/<agent>.css scope selector + per-theme coverage
 *    (the packaged theme CSS fallback)
 *
 * Additionally asserts the STRUCTURAL SELECTOR LIST is consistent:
 *   - The `AgentId` union from types.ts matches the engines/ directory listing.
 *   - The SCOPE_SELECTORS map covers exactly the engines/ agent set.
 *   - Each theme's CSS file set exactly matches the engines/ agent set
 *     (no missing agent, no extra unknown agent).
 *   - Each engine directory has the required files (adapter.mjs, tokens.css,
 *     cosmetic.css).
 *
 * If any of these drift (typo, rename, missing file, missing agent), theme
 * application silently fails — the host class on html won't match the CSS
 * selector, or a theme will be missing CSS for a newly-added agent. This
 * script makes such drift a build error.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

// ---------------------------------------------------------------------------
// Scope selectors per agent (declared early so engine + theme checks share it)
// ---------------------------------------------------------------------------

/**
 * Known scope selectors per agent. Most agents use the host class
 * (`html.codedrobe-host-<agent>`), but WorkBuddy historically uses
 * `body[data-application-name="workbuddy"]`. Both are valid engine contracts;
 * we just need each theme CSS to use at least one of them.
 */
function htmlHostClass(agent, prefix) {
  return `${prefix}${agent}`;
}

function buildScopeSelectors(prefix, agents) {
  const map = {};
  for (const agent of agents) {
    if (agent === 'workbuddy') {
      map[agent] = [htmlHostClass(agent, prefix), 'data-application-name="workbuddy"'];
    } else {
      map[agent] = [htmlHostClass(agent, prefix)];
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// 1. Extract the canonical AgentId union from src/shared/types.ts
// ---------------------------------------------------------------------------

const typesPath = join(root, 'src/shared/types.ts');
const typesSrc = readFileSync(typesPath, 'utf8');
const agentIdMatch = /export type AgentId = ([^;]+);/.exec(typesSrc);
if (!agentIdMatch) {
  fail(`Could not extract AgentId union from ${typesPath}`);
  process.exit(1);
}
const CANONICAL_AGENTS = agentIdMatch[1]
  .split('|')
  .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
  .filter(Boolean);
const CANONICAL_AGENT_SET = new Set(CANONICAL_AGENTS);

// ---------------------------------------------------------------------------
// 2. Extract HOST_CLASS_PREFIX from injection-constants.ts
// ---------------------------------------------------------------------------

const constantsPath = join(root, 'src/shared/injection-constants.ts');
const constantsSrc = readFileSync(constantsPath, 'utf8');
const prefixMatch = /export const HOST_CLASS_PREFIX = '([^']+)';/.exec(constantsSrc);
if (!prefixMatch) {
  fail(`Could not extract HOST_CLASS_PREFIX from ${constantsPath}`);
  process.exit(1);
}
const HOST_CLASS_PREFIX = prefixMatch[1];

// ---------------------------------------------------------------------------
// 3. Verify engines/ directory structure + adapter HOST_CLASS
// ---------------------------------------------------------------------------

const enginesDir = join(root, 'engines');
const REQUIRED_ENGINE_FILES = ['adapter.mjs', 'tokens.css', 'cosmetic.css'];
let engineAgents = [];
if (!existsSync(enginesDir)) {
  fail(`engines/ directory missing at ${enginesDir}`);
} else {
  engineAgents = readdirSync(enginesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (engineAgents.length === 0) {
    fail('engines/ has no agent subdirectories');
  }

  // Structural assertion: engines/ agent set must match the canonical AgentId union.
  const engineAgentSet = new Set(engineAgents);
  for (const agent of CANONICAL_AGENT_SET) {
    if (!engineAgentSet.has(agent)) {
      fail(
        `engines/${agent}/ missing — AgentId union in src/shared/types.ts declares '${agent}' ` +
        `but no engine directory exists. Add engines/${agent}/ with adapter.mjs, tokens.css, cosmetic.css.`,
      );
    }
  }
  for (const agent of engineAgents) {
    if (!CANONICAL_AGENT_SET.has(agent)) {
      fail(
        `engines/${agent}/ exists but '${agent}' is not in the AgentId union ` +
        `(src/shared/types.ts). Either add it to the union or remove the directory.`,
      );
    }
  }

  for (const agent of engineAgents) {
    // Required engine files (adapter.mjs, tokens.css, cosmetic.css).
    for (const requiredFile of REQUIRED_ENGINE_FILES) {
      const requiredPath = join(enginesDir, agent, requiredFile);
      if (!existsSync(requiredPath)) {
        fail(`engines/${agent}/${requiredFile} missing — every engine must define all three: ${REQUIRED_ENGINE_FILES.join(', ')}`);
      }
    }

    const adapterPath = join(enginesDir, agent, 'adapter.mjs');
    if (!existsSync(adapterPath)) {
      // Already reported above; skip the HOST_CLASS check.
      continue;
    }
    const adapterSrc = readFileSync(adapterPath, 'utf8');

    // adapter.mjs typically defines `const HOST_CLASS = 'codedrobe-host-<agent>';`.
    // WorkBuddy is an exception — it scopes via body[data-application-name]
    // and may not define HOST_CLASS. Skip the strict check for agents that
    // have a documented alternative scope.
    const SCOPE_SELECTORS = buildScopeSelectors(HOST_CLASS_PREFIX, CANONICAL_AGENTS);
    const hasAltScope = (SCOPE_SELECTORS[agent] || []).some((s) => !s.startsWith(HOST_CLASS_PREFIX));
    const hostClassMatch = /const\s+HOST_CLASS\s*=\s*['"]([^'"]+)['"]/.exec(adapterSrc);
    if (!hostClassMatch) {
      if (hasAltScope) {
        // Acceptable — this agent uses a non-host-class scope (e.g. WorkBuddy).
      } else {
        fail(`engines/${agent}/adapter.mjs: no const HOST_CLASS = '...' found`);
        continue;
      }
    } else {
      const actual = hostClassMatch[1];
      const expected = `${HOST_CLASS_PREFIX}${agent}`;
      if (actual !== expected) {
        fail(
          `engines/${agent}/adapter.mjs: HOST_CLASS='${actual}' but expected '${expected}' ` +
          `(must be ${HOST_CLASS_PREFIX}<agentId> to match injection-constants.ts)`,
        );
      }
    }

    // Also verify the engine's safeHostClass equivalent (if present) matches
    // the regex sanitization in hostClassFor(). The adapter typically uses a
    // literal host class, but if it has a safeHostClass function, check it.
    const safeFnMatch = /function\s+safeHostClass\s*\([^)]*\)\s*\{[^}]*`([^`]+)`[^}]*\}/.exec(adapterSrc);
    if (safeFnMatch) {
      const template = safeFnMatch[1];
      if (!template.startsWith(HOST_CLASS_PREFIX)) {
        warn(
          `engines/${agent}/adapter.mjs: safeHostClass template '${template}' ` +
          `does not start with HOST_CLASS_PREFIX '${HOST_CLASS_PREFIX}'`,
        );
      }
    }
  }
}

// Build the SCOPE_SELECTORS map from the canonical agent list (not hardcoded).
const SCOPE_SELECTORS = buildScopeSelectors(HOST_CLASS_PREFIX, CANONICAL_AGENTS);

// Structural assertion: SCOPE_SELECTORS must cover exactly the canonical agents.
const scopeSelectorAgents = new Set(Object.keys(SCOPE_SELECTORS));
for (const agent of CANONICAL_AGENT_SET) {
  if (!scopeSelectorAgents.has(agent)) {
    fail(`SCOPE_SELECTORS missing entry for '${agent}' — every AgentId must have a scope selector list.`);
  }
}
for (const agent of scopeSelectorAgents) {
  if (!CANONICAL_AGENT_SET.has(agent)) {
    fail(`SCOPE_SELECTORS has entry for '${agent}' but it is not in the AgentId union.`);
  }
}

// ---------------------------------------------------------------------------
// 4. Verify each theme CSS: scope selector + per-theme coverage
// ---------------------------------------------------------------------------

const themesDir = join(root, 'themes');
if (!existsSync(themesDir)) {
  warn('themes/ directory missing — skipping theme CSS checks');
} else {
  const themeDirs = readdirSync(themesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const theme of themeDirs) {
    const cssDir = join(themesDir, theme, 'assets/css');
    if (!existsSync(cssDir)) continue;

    const cssFiles = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
    const cssAgents = new Set(cssFiles.map((f) => f.replace(/\.css$/, '')));

    // Structural assertion: every theme must have CSS for every canonical agent.
    for (const agent of CANONICAL_AGENT_SET) {
      if (!cssAgents.has(agent)) {
        fail(
          `themes/${theme}/assets/css/${agent}.css missing — every theme must ship CSS ` +
          `for every AgentId (expected: ${[...CANONICAL_AGENT_SET].sort().join(', ')}).`,
        );
      }
    }
    // And no extra CSS files for unknown agents.
    for (const agent of cssAgents) {
      if (!CANONICAL_AGENT_SET.has(agent)) {
        fail(
          `themes/${theme}/assets/css/${agent}.css exists but '${agent}' is not in the AgentId union ` +
          `(src/shared/types.ts). Either add it to the union or remove the file.`,
        );
      }
    }

    for (const cssFile of cssFiles) {
      const agent = cssFile.replace(/\.css$/, '');
      const cssPath = join(cssDir, cssFile);
      const cssSrc = readFileSync(cssPath, 'utf8');

      const acceptedScopes = SCOPE_SELECTORS[agent];
      if (!acceptedScopes) {
        // Already reported above as a structural violation; skip the scope check.
        continue;
      }

      // CSS must contain at least one accepted scope selector.
      const hasAnyScope = acceptedScopes.some((sel) => cssSrc.includes(sel));
      if (!hasAnyScope) {
        fail(
          `themes/${theme}/assets/css/${cssFile}: no recognized scope selector found ` +
          `(expected one of: ${acceptedScopes.join(', ')}) — scope drift will silent-break this theme`,
        );
      }

      // Warn if CSS references a host class for a *different* agent
      // (copy-paste mistake between theme files).
      const expectedHostClass = htmlHostClass(agent, HOST_CLASS_PREFIX);
      const allHostClassRefs = new Set(cssSrc.match(new RegExp(`${escapeRegex(HOST_CLASS_PREFIX)}[a-z]+`, 'g')) || []);
      for (const ref of allHostClassRefs) {
        if (ref !== expectedHostClass) {
          warn(
            `themes/${theme}/assets/css/${cssFile}: references '${ref}' ` +
            `(expected only '${expectedHostClass}' for this agent)`,
          );
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (warnings.length > 0) {
  console.warn('⚠ Injection contract warnings:');
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (errors.length > 0) {
  console.error('✖ Injection contract violations:');
  for (const e of errors) console.error(`  - ${e}`);
  console.error(`\n${errors.length} violation(s). Fix the above or update src/shared/types.ts / src/shared/injection-constants.ts.`);
  process.exit(1);
}

console.log(
  `✓ Injection contract OK — HOST_CLASS_PREFIX='${HOST_CLASS_PREFIX}', ` +
  `${engineAgents.length} engines verified, ` +
  `agents=[${CANONICAL_AGENTS.sort().join(', ')}].`,
);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
