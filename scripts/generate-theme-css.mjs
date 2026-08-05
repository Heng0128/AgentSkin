// SPDX-License-Identifier: MPL-2.0
//
// # generate-theme-css.mjs
//
// Regenerates the per-agent CSS files (assets/css/<agent>.css, plus per-scheme
// variants under assets/css/<schemeId>/) for every built-in theme under
// themes/<id>/ from the manifest colors.
//
// The pure per-agent CSS generators (traeworkCss / qoderworkCss /
// workbuddyCss / doubaoCss / codexCss / zcodeCss) live in
// `./theme-generators.mjs` so the main process can import them without
// triggering this build loop. This file is the disk-I/O driver: reads
// manifests, resolves color schemes, writes (or verifies) the CSS files.
//
// Hero artwork is NOT embedded in the CSS. The engine converts the bundle's
// assets.images.hero into an object URL and exposes it as --agentskin-art on
// <html>, so the CSS references var(--agentskin-art, none).
//
// Usage:  node scripts/generate-theme-css.mjs [--verify]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext, GENERATORS } from './theme-generators.mjs';

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');

// ---------------------------------------------------------------------------
// Color scheme resolution (disk I/O — kept here, not in the pure module)
// ---------------------------------------------------------------------------

function loadColorSchemes(id, themeDir, manifest) {
  const schemes = [{ id: 'default', mode: manifest.mode, colors: manifest.colors }];
  for (const schemeId of manifest.colorSchemes ?? []) {
    const schemePath = path.join(themeDir, 'color-schemes', `${schemeId}.json`);
    if (!fs.existsSync(schemePath)) {
      throw new Error(`themes/${id}: declared color scheme "${schemeId}" has no color-schemes/${schemeId}.json`);
    }
    const scheme = JSON.parse(fs.readFileSync(schemePath, 'utf8').replace(/^\uFEFF/, ''));
    schemes.push({ id: schemeId, mode: scheme.mode, colors: scheme.colors });
  }
  return schemes;
}

let count = 0;
let stale = 0;
const verifyMode = process.argv.includes('--verify') || process.argv.includes('-v');

for (const id of fs.readdirSync(THEMES_DIR).sort()) {
  const themeDir = path.join(THEMES_DIR, id);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, ''));
  // Flat / CSS-only themes (e.g. the WeChat skin) ship hand-written CSS and
  // declare "art": false; the art-based generator must not clobber them.
  if (manifest.art === false) {
    console.log(`[generate-theme-css] ${id}: skipped (flat theme, art=false)`);
    continue;
  }
  const schemes = loadColorSchemes(id, themeDir, manifest);
  for (const scheme of schemes) {
    const ctx = buildContext(id, manifest, scheme);
    // The default scheme keeps the historical flat layout (assets/css/<agent>.css);
    // each alternative scheme gets its own directory (assets/css/<schemeId>/).
    const isDefault = scheme.id === 'default';
    const cssDir = path.join(themeDir, 'assets', 'css', isDefault ? '' : scheme.id);
    if (!verifyMode) fs.mkdirSync(cssDir, { recursive: true });
    for (const [agent, generate] of Object.entries(GENERATORS)) {
      const css = generate(ctx);
      const cssPath = path.join(cssDir, `${agent}.css`);
      if (verifyMode) {
        if (!fs.existsSync(cssPath)) {
          console.error(`[generate-theme-css:verify] ${id}/${scheme.id}/${agent}.css MISSING — run 'npm run generate:theme-css'`);
          stale++;
          continue;
        }
        const actual = fs.readFileSync(cssPath, 'utf8');
        // Compare against the same trailing-newline normalization used when
        // writing (writeFileSync appends '\n' when the template lacks one).
        const expected = css.endsWith('\n') ? css : `${css}\n`;
        if (actual !== expected) {
          console.error(`[generate-theme-css:verify] ${id}/${scheme.id}/${agent}.css STALE — run 'npm run generate:theme-css'`);
          stale++;
        }
      } else {
        fs.writeFileSync(cssPath, css.endsWith('\n') ? css : `${css}\n`, 'utf8');
        count += 1;
      }
    }
    if (!verifyMode) {
      console.log(`[generate-theme-css] ${id}/${scheme.id} (${ctx.mode})${manifest.dynamic ? ` [dynamic:${manifest.dynamic}]` : ''}`);
    }
  }
}

if (verifyMode) {
  if (stale > 0) {
    console.error(`\n[generate-theme-css:verify] ${stale} CSS file(s) stale or missing.`);
    process.exit(1);
  }
  console.log(`[generate-theme-css:verify] all CSS files up-to-date.`);
} else {
  console.log(`[generate-theme-css] wrote ${count} CSS files.`);
}
