/**
 * rebuild-all-themes.mjs — Batch rebuild all .agentskin-theme packages
 * from their manifest.json (already regenerated).
 *
 * Reuses scripts/build-theme-package.mjs (the Studio export builder) to
 * produce directory-based packages with consistent extension and layout.
 *
 * Usage: node scripts/rebuild-all-themes.mjs [outputDir]
 * Default output: themes/{id}/*.agentskin-theme/
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildThemePackage } from './build-theme-package.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const THEMES_DIR = join(ROOT, 'themes');
const OUT_DIR = process.argv[2] ? resolve(process.argv[2]) : null;

const dirs = readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map((d) => d.name);

let ok = 0,
  fail = 0;

for (const id of dirs) {
  const themeDir = join(THEMES_DIR, id);
  const manifestPath = join(themeDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log(`[skip] ${id}: no manifest.json`);
    continue;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const c = manifest.colors || {};
    const agentId = Object.keys(manifest.targets ?? {})[0] || 'traework';
    const tokens = {
      '--agentskin-accent': c.accent,
      '--agentskin-secondary': c.secondary,
      '--agentskin-bg': c.background,
      '--agentskin-surface': c.surface,
      '--agentskin-surface-elevated': c.surfaceElevated,
      '--agentskin-text': c.foreground,
      '--agentskin-muted': c.muted,
      '--agentskin-border': c.border,
      '--agentskin-code-bg': c.codeBackground,
      '--agentskin-code-fg': c.codeForeground,
      '--agentskin-input-bg': c.inputBackground,
      '--agentskin-button-bg': c.buttonBackground,
      '--agentskin-focus-ring': c.focusRing,
      '--agentskin-selection': c.selection,
    };
    // Remove undefined entries so build-theme-package.mjs falls back to defaults
    for (const k of Object.keys(tokens)) {
      if (tokens[k] == null) delete tokens[k];
    }
    const request = {
      agentId,
      root: tokens,
      meta: {
        id: manifest.id || id,
        name: manifest.name || manifest.displayName || id,
        author: manifest.author?.name || 'AgentSkin',
      },
    };
    const outBase = OUT_DIR || themeDir;
    const pkgDir = await buildThemePackage(request, outBase);
    console.log(`[ok] ${id} → ${pkgDir}`);
    ok++;
  } catch (err) {
    console.error(`[FAIL] ${id}: ${err.message}`);
    fail++;
  }
}

console.log(`\n[rebuild-all] done: ${ok} ok, ${fail} failed, ${dirs.length} total`);
