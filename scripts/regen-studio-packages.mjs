// SPDX-License-Identifier: MPL-2.0
//
// # regen-studio-packages.mjs
//
// Batch-regenerates all 15 `.agentskin-theme` Studio package directories
// under `themes/<id>/` from the canonical `manifest.json` colors. Uses the
// patched `buildThemePackage` (deriveTokens selection/focus-ring 派生 +
// valueForToken 优先级规则数组 + buttonForeground luminance 派生).
//
// Usage:  node scripts/regen-studio-packages.mjs [--dry-run]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildThemePackage } from './build-theme-package.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const AGENT_ID = 'traework';

const dryRun = process.argv.includes('--dry-run');

function colorsToRootTokens(colors) {
  return {
    '--agentskin-accent': colors.accent,
    '--agentskin-secondary': colors.secondary,
    '--agentskin-bg': colors.background,
    '--agentskin-surface': colors.surface,
    '--agentskin-surface-elevated': colors.surfaceElevated,
    '--agentskin-text': colors.foreground,
    '--agentskin-muted': colors.muted,
    '--agentskin-border': colors.border || colors.accent,
    '--agentskin-code-bg': colors.codeBackground || colors.codeBg || colors.background,
    '--agentskin-code-fg': colors.codeForeground || colors.codeFg || colors.foreground,
    '--agentskin-input-bg': colors.inputBackground || colors.inputBg || colors.surface,
    '--agentskin-button-bg': colors.buttonBackground || colors.buttonBg || colors.accent,
  };
}

const dirs = fs.readdirSync(THEMES_DIR).filter((name) => {
  const manifestPath = path.join(THEMES_DIR, name, 'manifest.json');
  return fs.existsSync(manifestPath);
});

let ok = 0;
let fail = 0;

for (const id of dirs.sort()) {
  const themeDir = path.join(THEMES_DIR, id);
  const manifest = JSON.parse(fs.readFileSync(path.join(themeDir, 'manifest.json'), 'utf8'));
  if (!manifest.colors) {
    console.warn(`[regen] ${id}: no colors — skip`);
    continue;
  }
  const outDir = themeDir;
  if (dryRun) {
    console.log(`[regen:dry] ${id} → ${path.join(outDir, `${id}.agentskin-theme`)}`);
    ok++;
    continue;
  }
  try {
    const pkgDir = await buildThemePackage(
      {
        agentId: AGENT_ID,
        meta: { id, name: manifest.displayName || manifest.name || id, author: manifest.author?.name || 'AgentSkin Studio' },
        root: colorsToRootTokens(manifest.colors),
        signature: {},
      },
      outDir,
    );
    ok++;
    console.log(`[regen] ${id} → ${path.basename(pkgDir)}`);
  } catch (err) {
    fail++;
    console.error(`[regen] ${id} FAIL — ${err.message}`);
  }
}

console.log(`\n[regen] done: ${ok} ok, ${fail} failed, ${dirs.length} total`);
if (fail > 0) process.exit(1);
