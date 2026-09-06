// SPDX-License-Identifier: MPL-2.0
//
// # normalize-hero-images.mjs
//
// Hero artwork is shipped LOSSLESS — the exact file the theme author provided
// (Wallpaper-style). With external-file asset mode (theme-installer reads the
// hero as a `{ file }` reference, never inlining base64), there is no reason
// to downscale or re-encode: 4K/8K wallpaper art stays pixel-perfect and the
// theme bundle stays tiny.
//
// What this script still does (safety only — never changes pixels):
//   - validates each hero decodes as a supported image (sharp metadata)
//   - rejects / warns on undeclared formats and unsupported containers
//   - reports resolution so authors can spot accidental upscales
//
// It does NOT downscale, re-encode, or alter the original file in any way.
//
// Usage:  node scripts/normalize-hero-images.mjs

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const SUPPORTED = new Set(['png', 'jpeg', 'jpg', 'webp', 'gif', 'avif']);

let total = 0;
let warnings = 0;

for (const id of fs.readdirSync(THEMES_DIR).sort()) {
  const assetsDir = path.join(THEMES_DIR, id, 'assets');
  if (!fs.existsSync(assetsDir)) continue;
  const heroFile = fs
    .readdirSync(assetsDir)
    .find((f) => /^hero\.(png|jpe?g|webp|gif|avif)$/i.test(f));
  if (!heroFile) {
    console.warn(`[normalize-hero-images] ${id}: no hero image found`);
    warnings++;
    continue;
  }

  const heroPath = path.join(assetsDir, heroFile);
  const before = fs.statSync(heroPath).size;
  const ext = path.extname(heroFile).toLowerCase().replace('.', '');

  if (!SUPPORTED.has(ext)) {
    console.warn(
      `[normalize-hero-images] ${id}: unsupported hero format '.${ext}' — engine will reject the package`,
    );
    warnings++;
    continue;
  }

  // Read fully into memory once (also releases the fd on Windows).
  const sourceBuffer = fs.readFileSync(heroPath);
  let meta;
  try {
    meta = await sharp(sourceBuffer).metadata();
  } catch (error) {
    console.warn(
      `[normalize-hero-images] ${id}: hero is not a decodable image — ${String(error).slice(0, 120)}`,
    );
    warnings++;
    continue;
  }

  if (!meta.width || !meta.height) {
    console.warn(`[normalize-hero-images] ${id}: hero has no dimensions (${meta.format})`);
    warnings++;
    continue;
  }

  total++;
  // Informational only — no pixel changes.
  console.log(
    `[normalize-hero-images] ${id}: ${heroFile} ${meta.width}x${meta.height} ` +
      `${(before / 1024).toFixed(0)}KB ${meta.format} — kept LOSSLESS (no re-encode)`,
  );
}

console.log(
  `[normalize-hero-images] done: ${total} heroes verified lossless, ${warnings} warnings. ` +
    `Heroes are NEVER re-encoded or downscaled.`,
);
