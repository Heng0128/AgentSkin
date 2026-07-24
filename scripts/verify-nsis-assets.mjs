// SPDX-License-Identifier: MPL-2.0
//
// Build-time guard for NSIS skin assets.
//
// Ensures build/nsis/{header,sidebar,uninstaller-sidebar}.bmp exist with the
// exact dimensions NSIS expects, and that the generated build/brand.nsh
// (the single-source palette consumed by installer.nsh) is present.
//
// Exits non-zero on any failure so the release build aborts early instead of
// shipping a missing / stale / wrong-sized installer skin.
//
// Run:  node scripts/verify-nsis-assets.mjs

import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NSS = path.join(ROOT, 'build/nsis');
const BRAND_NSH = path.join(ROOT, 'build/brand.nsh');

const EXPECT = [
  { name: 'header', w: 150, h: 57 },
  { name: 'sidebar', w: 164, h: 314 },
  { name: 'uninstaller-sidebar', w: 164, h: 314 },
];

function bmpSize(buf) {
  if (buf.length < 26) return null;
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) return null; // 'BM'
  return { w: buf.readInt32LE(18), h: buf.readInt32LE(22) };
}

let failed = false;

for (const e of EXPECT) {
  const p = path.join(NSS, `${e.name}.bmp`);
  try {
    await access(p);
  } catch {
    console.error(`[verify-nsis-assets] MISSING: ${path.relative(ROOT, p)} — run "npm run icons:nsis" first`);
    failed = true;
    continue;
  }
  const buf = await readFile(p);
  const size = bmpSize(buf);
  if (!size) {
    console.error(`[verify-nsis-assets] NOT A BMP: ${e.name}.bmp`);
    failed = true;
    continue;
  }
  if (size.w !== e.w || size.h !== e.h) {
    console.error(`[verify-nsis-assets] SIZE MISMATCH ${e.name}.bmp: expected ${e.w}x${e.h}, got ${size.w}x${size.h}`);
    failed = true;
    continue;
  }
  console.log(`[verify-nsis-assets] ok ${e.name}.bmp ${size.w}x${size.h}`);
}

try {
  await access(BRAND_NSH);
  console.log(`[verify-nsis-assets] ok ${path.relative(ROOT, BRAND_NSH)}`);
} catch {
  console.error(`[verify-nsis-assets] MISSING: ${path.relative(ROOT, BRAND_NSH)} — run "npm run icons:nsis" first`);
  failed = true;
}

if (failed) {
  console.error('[verify-nsis-assets] FAILED — aborting release build');
  process.exit(1);
}
console.log('[verify-nsis-assets] all assets present and valid');
