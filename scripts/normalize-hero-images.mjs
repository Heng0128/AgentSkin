// SPDX-License-Identifier: MPL-2.0
//
// # normalize-hero-images.mjs
//
// Keeps the shipped hero artwork lean so the seeded .codedrobe-theme bundles
// (which embed the art as base64) stay small:
//
//   - any image wider than 1920px is downscaled to 1920px (cover art for a
//     desktop window never needs more)
//   - PNG/JPEG artwork above the size budget is re-encoded as WebP (q82),
//     which the engine, the catalog cover <img> and Chromium all support
//
// Idempotent: already-small WebP files pass through untouched. Run it after
// fetching new artwork, before update-theme-manifests.mjs (the manifest hero
// field must point at the final filename).
//
// Usage:  node scripts/normalize-hero-images.mjs

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const MAX_WIDTH = 1920;
const SIZE_BUDGET = 420 * 1024; // re-encode anything above ~420KB

for (const id of fs.readdirSync(THEMES_DIR).sort()) {
  const assetsDir = path.join(THEMES_DIR, id, 'assets');
  if (!fs.existsSync(assetsDir)) continue;
  const heroFile = fs.readdirSync(assetsDir).find((f) => /^hero\.(png|jpe?g|webp)$/i.test(f));
  if (!heroFile) {
    console.warn(`[normalize-hero-images] ${id}: no hero image found`);
    continue;
  }

  const heroPath = path.join(assetsDir, heroFile);
  const before = fs.statSync(heroPath).size;
  // Read fully into memory first: on Windows libvips would otherwise hold an
  // open fd on the source, and unlinking it afterwards fails with EBUSY.
  const sourceBuffer = fs.readFileSync(heroPath);
  const meta = await sharp(sourceBuffer).metadata();

  let pipeline = sharp(sourceBuffer);
  if ((meta.width ?? 0) > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  const ext = path.extname(heroFile).toLowerCase();
  let outPath = heroPath;
  let action = 'kept';

  if (before > SIZE_BUDGET || (meta.width ?? 0) > MAX_WIDTH) {
    if (ext === '.webp') {
      pipeline = pipeline.webp({ quality: 82 });
      action = 're-encoded webp';
    } else {
      // PNG/JPEG photographic art compresses far better as WebP.
      outPath = path.join(assetsDir, 'hero.webp');
      pipeline = pipeline.webp({ quality: 82 });
      action = `converted ${ext.slice(1)}→webp`;
    }
    // sharp refuses to read and write the same file, so stage via a temp
    // file and rename it into place (rename overwrites the target).
    const tempPath = path.join(assetsDir, `.hero-tmp-${Date.now()}.webp`);
    await pipeline.toFile(tempPath);
    fs.renameSync(tempPath, outPath);
    if (outPath !== heroPath) fs.rmSync(heroPath, { force: true });
  }

  const after = fs.statSync(outPath).size;
  console.log(
    `[normalize-hero-images] ${id}: ${path.basename(outPath)} ` +
      `${(before / 1024).toFixed(0)}KB → ${(after / 1024).toFixed(0)}KB (${action})`,
  );
}
