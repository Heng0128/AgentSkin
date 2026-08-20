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
 * 1. src/shared/types/agent.ts `AgentId` union
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

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}
function warn(msg) {
  warnings.push(msg);
}

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
// 1. Extract the canonical AgentId union from src/shared/types/agent.ts
//    (types.ts is now a barrel re-export; the canonical union lives in
//    src/shared/types/agent.ts. We tolerate the legacy location as a fallback)
// ---------------------------------------------------------------------------

function findAgentIdUnion() {
  const candidates = [join(root, 'src/shared/types/agent.ts'), join(root, 'src/shared/types.ts')];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    const m = /export type AgentId = ([^;]+);/.exec(src);
    if (m) return { path: p, union: m[1] };
  }
  return null;
}

const agentIdFound = findAgentIdUnion();
if (!agentIdFound) {
  fail(
    "Could not extract AgentId union from src/shared/types/agent.ts or src/shared/types.ts\n    Fix: Ensure src/shared/types/agent.ts contains \"export type AgentId = 'agent1' | 'agent2';\"; check for syntax errors if the file was recently edited",
  );
  console.error('\n--- Injection Contract FAIL ---');
  for (const e of errors) console.error('[FAIL]', e);
  process.exit(1);
}
const CANONICAL_AGENTS = agentIdFound.union
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
  fail(
    `Could not extract HOST_CLASS_PREFIX from ${constantsPath}\n    Fix: Ensure src/shared/injection-constants.ts contains "export const HOST_CLASS_PREFIX = 'codedrobe-host';" or similar valid declaration`,
  );
  console.error('\n--- Injection Contract FAIL ---');
  for (const e of errors) console.error('[FAIL]', e);
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
  fail(
    `engines/ directory missing at ${enginesDir}\n    Fix: Create the engines/ directory at the project root and add one subdirectory per agent (e.g. engines/catdesk/, engines/workbuddy/) each containing adapter.mjs, tokens.css, cosmetic.css`,
  );
} else {
  engineAgents = readdirSync(enginesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // Exclude non-agent shared directories (e.g. engines/shared/ for deep-core.mjs)
    .filter((name) => !['shared', '_shared'].includes(name));

  if (engineAgents.length === 0) {
    fail(
      'engines/ has no agent subdirectories\n    Fix: Create at least one agent engine directory (e.g. engines/catdesk/) containing adapter.mjs, tokens.css, cosmetic.css. The agent name must match an entry in the AgentId union in src/shared/types/agent.ts',
    );
  }

  // Structural assertion: engines/ agent set must match the canonical AgentId union.
  const engineAgentSet = new Set(engineAgents);
  for (const agent of CANONICAL_AGENT_SET) {
    if (!engineAgentSet.has(agent)) {
      fail(
        `engines/${agent}/ missing — AgentId union in src/shared/types.ts declares '${agent}' ` +
          `but no engine directory exists.\n    Fix: Create engines/${agent}/ directory with adapter.mjs (containing const HOST_CLASS = 'codedrobe-host-${agent}'), tokens.css, and cosmetic.css`,
      );
    }
  }
  for (const agent of engineAgents) {
    if (!CANONICAL_AGENT_SET.has(agent)) {
      fail(
        `engines/${agent}/ exists but '${agent}' is not in the AgentId union ` +
          `(src/shared/types.ts).\n    Fix: Either add '${agent}' to the AgentId union in src/shared/types/agent.ts, or remove the engines/${agent}/ directory if it is no longer needed`,
      );
    }
  }

  for (const agent of engineAgents) {
    // Required engine files (adapter.mjs, tokens.css, cosmetic.css).
    for (const requiredFile of REQUIRED_ENGINE_FILES) {
      const requiredPath = join(enginesDir, agent, requiredFile);
      if (!existsSync(requiredPath)) {
        fail(
          `engines/${agent}/${requiredFile} missing — every engine must define all three: ${REQUIRED_ENGINE_FILES.join(', ')}\n    Fix: Create engines/${agent}/${requiredFile} — copy from another agent's ${requiredFile} as a starting template if unsure of the expected structure`,
        );
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
    const hasAltScope = (SCOPE_SELECTORS[agent] || []).some(
      (s) => !s.startsWith(HOST_CLASS_PREFIX),
    );
    const hostClassMatch = /const\s+HOST_CLASS\s*=\s*['"]([^'"]+)['"]/.exec(adapterSrc);
    if (!hostClassMatch) {
      if (hasAltScope) {
        // Acceptable — this agent uses a non-host-class scope (e.g. WorkBuddy).
      } else {
        fail(
          `engines/${agent}/adapter.mjs: no const HOST_CLASS = '...' found\n    Fix: Add 'const HOST_CLASS = "codedrobe-host-${agent}";' at the top of engines/${agent}/adapter.mjs — the value must match '<HOST_CLASS_PREFIX><agentId>' from src/shared/injection-constants.ts`,
        );
        continue;
      }
    } else {
      const actual = hostClassMatch[1];
      const expected = `${HOST_CLASS_PREFIX}${agent}`;
      if (actual !== expected) {
        fail(
          `engines/${agent}/adapter.mjs: HOST_CLASS='${actual}' but expected '${expected}' ` +
            `(must be ${HOST_CLASS_PREFIX}<agentId> to match injection-constants.ts)\n    Fix: Change HOST_CLASS in engines/${agent}/adapter.mjs from '${actual}' to '${expected}' (the value must be '<HOST_CLASS_PREFIX><agentId>')`,
        );
      }
    }

    // Also verify the engine's safeHostClass equivalent (if present) matches
    // the regex sanitization in hostClassFor(). The adapter typically uses a
    // literal host class, but if it has a safeHostClass function, check it.
    const safeFnMatch = /function\s+safeHostClass\s*\([^)]*\)\s*\{[^}]*`([^`]+)`[^}]*\}/.exec(
      adapterSrc,
    );
    if (safeFnMatch) {
      const template = safeFnMatch[1];
      if (!template.startsWith(HOST_CLASS_PREFIX)) {
        warn(
          `engines/${agent}/adapter.mjs: safeHostClass template '${template}' ` +
            `does not start with HOST_CLASS_PREFIX '${HOST_CLASS_PREFIX}'\n    Fix: Ensure the template literal in safeHostClass() starts with '${HOST_CLASS_PREFIX}' to maintain scope selector consistency`,
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
    fail(
      `SCOPE_SELECTORS missing entry for '${agent}' — every AgentId must have a scope selector list.\n    Fix: Add a scope selector entry for '${agent}' in buildScopeSelectors() (or SCOPE_SELECTORS map) — typically ['${HOST_CLASS_PREFIX}${agent}'], or include 'data-application-name="${agent}"' if it uses an alternative scope`,
    );
  }
}
for (const agent of scopeSelectorAgents) {
  if (!CANONICAL_AGENT_SET.has(agent)) {
    fail(
      `SCOPE_SELECTORS has entry for '${agent}' but it is not in the AgentId union.\n    Fix: Remove '${agent}' from the scope selectors in buildScopeSelectors(), or add '${agent}' to the AgentId union in src/shared/types/agent.ts if it is a valid agent`,
    );
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

    // Check both the flat default layout (assets/css/<agent>.css) and every
    // alternative color-scheme directory (assets/css/<schemeId>/<agent>.css).
    // Each variant is generated from the same templates and must carry the
    // agent's scope selector, otherwise a scheme variant silently stops
    // targeting its agent.
    const cssLayouts = [
      'default',
      ...readdirSync(cssDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name),
    ];

    for (const layout of cssLayouts) {
      const layoutDir = layout === 'default' ? cssDir : join(cssDir, layout);
      if (!existsSync(layoutDir)) continue;

      const cssFiles = readdirSync(layoutDir).filter((f) => f.endsWith('.css'));
      const cssAgents = new Set(cssFiles.map((f) => f.replace(/\.css$/, '')));
      const label = layout === 'default' ? 'assets/css' : `assets/css/${layout}`;

      // Structural assertion: every theme must have CSS for every canonical agent.
      for (const agent of CANONICAL_AGENT_SET) {
        if (!cssAgents.has(agent)) {
          fail(
            `themes/${theme}/${label}/${agent}.css missing — every theme must ship CSS ` +
              `for every AgentId (expected: ${[...CANONICAL_AGENT_SET].sort().join(', ')}).\n    Fix: Create themes/${theme}/${label}/${agent}.css with the appropriate scope selector (e.g. 'html.${HOST_CLASS_PREFIX}${agent}') and required design tokens — copy from another agent's CSS in the same theme as a template`,
          );
        }
      }
      // And no extra CSS files for unknown agents.
      for (const agent of cssAgents) {
        if (!CANONICAL_AGENT_SET.has(agent)) {
          fail(
            `themes/${theme}/${label}/${agent}.css exists but '${agent}' is not in the AgentId union ` +
              `(src/shared/types.ts).\n    Fix: Either add '${agent}' to the AgentId union in src/shared/types/agent.ts, or delete themes/${theme}/${label}/${agent}.css if it is a leftover from a renamed/removed agent`,
          );
        }
      }

      for (const cssFile of cssFiles) {
        const agent = cssFile.replace(/\.css$/, '');
        const cssPath = join(layoutDir, cssFile);
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
            `themes/${theme}/${label}/${cssFile}: no recognized scope selector found ` +
              `(expected one of: ${acceptedScopes.join(', ')}) — scope drift will silent-break this theme\n    Fix: Ensure the CSS root selector in themes/${theme}/${label}/${cssFile} matches one of the expected scope selectors (e.g. add 'html.${HOST_CLASS_PREFIX}${agent}{ ... }' or the correct host class to the file)`,
          );
        }

        // Warn if CSS references a host class for a *different* agent
        // (copy-paste mistake between theme files).
        const expectedHostClass = htmlHostClass(agent, HOST_CLASS_PREFIX);
        const allHostClassRefs = new Set(
          cssSrc.match(new RegExp(`${escapeRegex(HOST_CLASS_PREFIX)}[a-z]+`, 'g')) || [],
        );
        for (const ref of allHostClassRefs) {
          if (ref !== expectedHostClass) {
            warn(
              `themes/${theme}/${label}/${cssFile}: references '${ref}' ` +
                `(expected only '${expectedHostClass}' for this agent)\n    Fix: Replace '${ref}' with '${expectedHostClass}' in themes/${theme}/${label}/${cssFile} — this is likely a copy-paste error from another agent's CSS`,
            );
          }
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
  console.error(
    `\n${errors.length} violation(s). Fix the above or update src/shared/types.ts / src/shared/injection-constants.ts.`,
  );
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
