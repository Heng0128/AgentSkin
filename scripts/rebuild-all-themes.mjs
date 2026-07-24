/**
 * rebuild-all-themes.mjs — Batch rebuild all 18 .agentskin-theme packages
 * from their manifest.json + assets/css/*.css (already regenerated).
 *
 * Usage: node scripts/rebuild-all-themes.mjs [outputDir]
 * Default output: themes/{id}/{id}.agentskin-theme
 */
import { readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { writeThemePackage } from '../src/engine/src/theme/package.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const THEMES_DIR = join(ROOT, 'themes');
const OUT_DIR = process.argv[2] ? resolve(process.argv[2]) : null;

const dirs = readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.'))
  .map(d => d.name);

let ok = 0, fail = 0;

for (const id of dirs) {
  const themeDir = join(THEMES_DIR, id);
  const manifestPath = join(themeDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.log(`[skip] ${id}: no manifest.json`);
    continue;
  }

  const outFile = OUT_DIR
    ? join(OUT_DIR, `${id}.codedrobe-theme`)
    : join(themeDir, `${id}.codedrobe-theme`);

  try {
    const res = await writeThemePackage(manifestPath, outFile, { force: true });
    const sizeKB = (res.bundle ? JSON.stringify(res.bundle).length : 0) / 1024;
    console.log(`[ok] ${id} → ${res.output} (~${sizeKB.toFixed(0)} KB)`);
    ok++;
  } catch (err) {
    console.error(`[FAIL] ${id}: ${err.message}`);
    fail++;
  }
}

console.log(`\n[rebuild-all] done: ${ok} ok, ${fail} failed, ${dirs.length} total`);
