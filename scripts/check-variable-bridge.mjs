// SPDX-License-Identifier: MPL-2.0

/**
 * # check-variable-bridge (C10 — Variable bridge contract)
 *
 * Run via: `node scripts/check-variable-bridge.mjs`
 * Exits non-zero on violation so it can gate `npm run check`.
 *
 * Validates the optional `variableBridge` manifest field that maps client-native
 * CSS variables onto agentskin tokens / literal colors (the Codex双层解耦模式).
 *
 * Checks:
 *   1. Schema shape: every bridge entry value must be a non-empty string.
 *   2. Circular dependency: following `var(--key)` chains within the bridge map
 *      must not loop back to themselves (A → B → A). CSS would silently ignore
 *      such a cycle, so fail fast at build time.
 *   3. Target usage: each bridge native key (e.g. `--color-background-surface`)
 *      should be referenced somewhere in the theme's generated CSS files
 *      (`var(--color-background-surface)`). An un-referenced key means the bridge
 *      has no effect — likely a typo or dead mapping.
 *   4. Agentskin token resolution: bridge values that reference
 *      `var(--agentskin-*)` must point to a known agentskin token; an unknown
 *      token renders as `var(--unknown)` → initial value (invisible breakage).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');

// Known agentskin tokens (the 14-contract set + derived surfacing tokens).
const AGENTSKIN_TOKENS = new Set([
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
  '--agentskin-text-shadow',
]);

/** Extract every `var(--name)` token reference from a CSS/value string. */
function extractVarRefs(value) {
  const refs = new Set();
  const re = /var\(\s*(--[a-z][\w-]*)/g;
  let m = re.exec(value);
  while (m !== null) {
    refs.add(m[1]);
    m = re.exec(value);
  }
  return refs;
}

/**
 * Detect circular dependencies in the bridge map.
 *
 * A bridge value like `var(--color-x)` where `--color-x` is ALSO a bridge key
 * creates a chain. If following chains leads back to the start key, it's a
 * circular definition. Returns an array of human-readable cycle descriptions.
 */
function detectCircular(bridge) {
  const keys = Object.keys(bridge);
  const keySet = new Set(keys);
  const cycles = [];

  for (const start of keys) {
    const visited = new Set();
    let current = start;
    while (keySet.has(current)) {
      if (visited.has(current)) {
        cycles.push(`${start} → ... → ${current} (cycle)`);
        break;
      }
      visited.add(current);
      const refs = extractVarRefs(bridge[current]);
      // Find which ref is also a bridge key (chain target); undefined = chain ends.
      let next = null;
      for (const r of refs) {
        if (keySet.has(r)) {
          next = r;
          break;
        }
      }
      if (next === null) break; // chain ends at literal/agentskin token → no cycle
      current = next;
    }
  }
  return cycles;
}

/**
 * Check that each bridge key is referenced in at least one CSS file.
 *
 * The native variable is only useful if something consumes it. We scan all
 * `var(--<key>)` references across the theme's generated CSS files.
 */
async function checkTargetUsage(themeDir, bridge, agentTargets, colorSchemes) {
  const warnings = [];
  // Collect all CSS files declared by targets.
  const cssPaths = [];
  for (const [agentId, config] of Object.entries(agentTargets)) {
    if (!config || typeof config.css !== 'string') continue;
    cssPaths.push(path.join(themeDir, config.css));
    // Also scan per-scheme variants if present.
    for (const schemeId of colorSchemes ?? []) {
      cssPaths.push(path.join(themeDir, 'assets', 'css', schemeId, path.basename(config.css)));
    }
  }
  // Read all CSS content once.
  let allCss = '';
  for (const cssPath of cssPaths) {
    try {
      allCss += (await fs.readFile(cssPath, 'utf8')) + '\n';
    } catch {
      // missing file → check-themes will report separately; skip here
    }
  }
  if (!allCss) return warnings; // no CSS to check against

  for (const key of Object.keys(bridge)) {
    // Look for `var(--key)` usage in the CSS.
    const re = new RegExp(`var\\(\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[),]`);
    if (!re.test(allCss)) {
      warnings.push(
        `${key} is declared in variableBridge but never referenced in any CSS file ` +
          `(likely dead mapping or typo)`,
      );
    }
  }
  return warnings;
}

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`check-variable-bridge: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  const errors = [];
  const warnings = [];
  let checked = 0;

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue;
    const themeDir = path.join(THEMES_DIR, entry.name);
    const manifestPath = path.join(themeDir, 'manifest.json');

    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a theme package
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      continue; // check-themes handles invalid JSON
    }

    const bridge = manifest.variableBridge;
    if (!bridge) continue; // field absent → nothing to validate (backward compatible)
    checked++;

    // --- 1. Schema shape: values must be non-empty strings ---
    for (const [k, v] of Object.entries(bridge)) {
      if (typeof v !== 'string' || v.trim() === '') {
        errors.push(
          `${entry.name}: variableBridge["${k}"] must be a non-empty string (got ${typeof v})`,
        );
        continue;
      }
      if (!k.startsWith('--')) {
        errors.push(
          `${entry.name}: variableBridge key "${k}" must start with "--" (CSS custom property)`,
        );
      }
    }

    // --- 2. Circular dependency ---
    const cycles = detectCircular(bridge);
    for (const c of cycles) {
      errors.push(`${entry.name}: variableBridge circular dependency: ${c}`);
    }

    // --- 3. Agentskin token resolution ---
    for (const [k, v] of Object.entries(bridge)) {
      if (typeof v !== 'string') continue;
      for (const ref of extractVarRefs(v)) {
        if (ref.startsWith('--agentskin-') && !AGENTSKIN_TOKENS.has(ref)) {
          warnings.push(
            `${entry.name}: variableBridge["${k}"] references unknown agentskin token ${ref}`,
          );
        }
      }
    }

    // --- 4. Target usage (referenced in CSS?) ---
    const usageWarnings = await checkTargetUsage(
      themeDir,
      bridge,
      manifest.targets ?? {},
      manifest.colorSchemes ?? [],
    );
    for (const w of usageWarnings) {
      warnings.push(`${entry.name}: ${w}`);
    }
  }

  for (const w of warnings) {
    console.warn(`  ⚠ ${w}`);
  }

  if (errors.length > 0) {
    console.error(
      `check-variable-bridge: ${errors.length} error(s) in ${checked} theme(s) with variableBridge:`,
    );
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn(`check-variable-bridge: ${warnings.length} warning(s) (non-blocking).`);
  }

  if (checked === 0) {
    console.log('check-variable-bridge: OK — no themes declare variableBridge (skipped).');
  } else {
    console.log(`check-variable-bridge: OK — ${checked} theme(s) with variableBridge pass.`);
  }
}

main().catch((e) => {
  console.error(`check-variable-bridge: unexpected error: ${e.stack ?? e}`);
  process.exit(1);
});
