// SPDX-License-Identifier: MPL-2.0
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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { buildThemePackage } from './build-theme-package.mjs';

// Threshold for external-mode: base64 inflates ~33%, so a 2MB raw file becomes
// ~2.66MB base64. Staying well under the 8MB cumulative ceiling avoids tripping
// MAX_THEME_IMAGE_BASE64 at install time.
const HERO_EXTERNAL_THRESHOLD = 2 * 1024 * 1024; // 2MB

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
    // Read hero image if declared in manifest (path relative to theme directory)
    if (manifest.hero) {
      const heroPath = join(themeDir, manifest.hero);
      if (existsSync(heroPath)) {
        const ext = extname(heroPath).toLowerCase();
        const mimeMap = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.webp': 'image/webp',
          '.gif': 'image/gif',
        };
        const mimeType = mimeMap[ext];
        if (mimeType) {
          const filename = manifest.hero.split('/').pop() || `hero${ext}`;
          const fileSize = statSync(heroPath).size;
          if (fileSize > HERO_EXTERNAL_THRESHOLD) {
            // External-file mode: skip base64, reference the file directly.
            // Avoids tripping MAX_THEME_IMAGE_BASE64 (8MB) at install time.
            request.images = {
              hero: {
                filename,
                mimeType,
                file: heroPath,
              },
            };
            console.log(
              `[external] ${id}: hero ${(fileSize / 1024 / 1024).toFixed(1)}MB > 2MB, using external-file mode`,
            );
          } else {
            const base64 = readFileSync(heroPath).toString('base64');
            request.images = {
              hero: {
                filename,
                mimeType,
                base64,
              },
            };
          }
        }
      }
    }
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
