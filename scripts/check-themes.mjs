// SPDX-License-Identifier: MPL-2.0

/**
 * # check-themes
 *
 * A3 — CI/husky gate for the themes directory. Runs on `themes/**` changes.
 *
 * Checks (beyond the runtime loader's schema validation, which runs in-app):
 *   1. Every `themes/<id>/manifest.json` parses and its `id` matches the
 *      directory name.
 *   2. Every CSS file referenced by `manifest.targets` exists.
 *   3. Each agent CSS declares ALL 14 required `--agentskin-*` tokens
 *      (the same set `scripts/generate-theme-css.mjs` emits — this is the
 *      "14 variables" contract from THEME_SPEC.md). A theme that omits one
 *      renders broken on that agent.
 *   4. `color-scheme` in each agent CSS matches `manifest.mode`
 *      (dark → `color-scheme: dark`, light → `color-scheme: light`).
 *      A mismatch breaks the agent's native UI chrome (scrollbars, form
 *      controls, shadow DOM surfaces) which do not follow CSS variables.
 *   5. `themes/<id>/palette.css` (when present, the generated token source)
 *      also declares the 14 tokens.
 *
 * Exit code is non-zero on any failure so the pre-commit hook blocks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');

/** The 14 required design tokens every agent CSS must declare (no hero art —
 *  `--agentskin-art` is injected at runtime, not authored in the theme). */
const REQUIRED_TOKENS = [
  '--agentskin-bg',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
  '--agentskin-button-bg',
  '--agentskin-input-bg',
];

/**
 * Tokens the generated `palette.css` must carry. It is the seed file
 * (written by `scripts/generate-theme-css.mjs`) and only holds the 12 core
 * tokens + `-raw` RGB derivations — `button-bg`/`input-bg` are derived from
 * accent/surface in the per-agent CSS layer, so they are NOT required here.
 */
const PALETTE_TOKENS = REQUIRED_TOKENS.filter(
  (t) => t !== '--agentskin-button-bg' && t !== '--agentskin-input-bg',
);

function tokenPattern(token) {
  // Match a declaration inside any block: `--agentskin-bg: <value>;`
  return new RegExp(`${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:`);
}

async function checkTokenCoverage(cssPath, label, errors, tokens = REQUIRED_TOKENS) {
  let css;
  try {
    css = await fs.readFile(cssPath, 'utf8');
  } catch (e) {
    errors.push(`${label}: file not found (${e.message})`);
    return;
  }
  const missing = tokens.filter((t) => !tokenPattern(t).test(css));
  if (missing.length > 0) {
    errors.push(`${label}: missing ${missing.length} required token(s): ${missing.join(', ')}`);
  }
  return css;
}

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`check-themes: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  const errors = [];
  let checked = 0;

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue; // shared layer, not a theme package
    const themeDir = path.join(THEMES_DIR, entry.name);
    const manifestPath = path.join(themeDir, 'manifest.json');

    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a theme package (e.g. docs/scratch dir)
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      errors.push(`${entry.name}: manifest.json is not valid JSON`);
      continue;
    }

    if (manifest.id !== entry.name) {
      errors.push(`${entry.name}: manifest.id "${manifest.id}" != directory name`);
    }
    if (!manifest.colors || typeof manifest.colors.background !== 'string') {
      errors.push(`${entry.name}: colors.background missing`);
    }
    checked++;

    // 1) target CSS files: existence + token coverage + color-scheme match.
    const targets = manifest.targets ?? {};
    const agentIds = Object.keys(targets);

    // Resolve the scheme list: 'default' (manifest colors) + each declared
    // color scheme (its mode may differ from the manifest mode).
    const schemeIds = ['default', ...(manifest.colorSchemes ?? [])];
    const schemeModes = new Map();
    for (const schemeId of schemeIds) {
      if (schemeId === 'default') {
        schemeModes.set('default', manifest.mode);
        continue;
      }
      try {
        const scheme = JSON.parse(
          await fs.readFile(path.join(themeDir, 'color-schemes', `${schemeId}.json`), 'utf8'),
        );
        schemeModes.set(schemeId, scheme.mode ?? manifest.mode);
      } catch {
        errors.push(`${entry.name}: cannot read color-schemes/${schemeId}.json`);
      }
    }

    for (const agentId of agentIds) {
      const config = targets[agentId];
      if (!config || typeof config.css !== 'string') {
        errors.push(`${entry.name}: targets.${agentId} missing css path`);
        continue;
      }
      // Default scheme CSS lives at the manifest-referenced path (e.g.
      // assets/css/<agent>.css); alternative schemes at assets/css/<schemeId>/<agent>.css.
      for (const schemeId of schemeIds) {
        const cssPath =
          schemeId === 'default'
            ? path.join(themeDir, config.css)
            : path.join(
                themeDir,
                'assets',
                'css',
                schemeId,
                path.basename(config.css),
              );
        const label = `${entry.name}/${schemeId}/${agentId} (${cssPath})`;
        const css = await checkTokenCoverage(cssPath, label, errors);
        const mode = schemeModes.get(schemeId);
        if (css && mode === 'dark' && !/color-scheme:\s*dark/.test(css)) {
          errors.push(`${label}: mode=dark but CSS lacks "color-scheme: dark"`);
        }
        if (css && mode === 'light' && !/color-scheme:\s*light/.test(css)) {
          errors.push(`${label}: mode=light but CSS lacks "color-scheme: light"`);
        }
      }
    }

    // 2) generated palette files (when present) must declare the core tokens.
    for (const schemeId of schemeIds) {
      const paletteName = schemeId === 'default' ? 'palette.css' : `palette.${schemeId}.css`;
      const palettePath = path.join(themeDir, paletteName);
      if (
        (await fs.stat(palettePath).then(() => true).catch(() => false)) === true
      ) {
        await checkTokenCoverage(palettePath, `${entry.name}/${paletteName}`, errors, PALETTE_TOKENS);
      }
    }
  }

  if (errors.length > 0) {
    console.error(`check-themes: ${errors.length} issue(s) in ${checked} theme(s):`);
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log(`check-themes: OK — ${checked} theme(s) pass (schema+assets+14 tokens+color-scheme)`);
}

main().catch((e) => {
  console.error(`check-themes: unexpected error: ${e.stack ?? e}`);
  process.exit(1);
});
