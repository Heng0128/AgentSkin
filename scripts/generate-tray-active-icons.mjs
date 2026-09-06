// SPDX-License-Identifier: MPL-2.0
// Generates "active" tray-icon variants by compositing a status dot badge
// onto the existing tray icons. Run with Node 22 (sharp requirement).
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sharp = require('sharp');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.resolve(__dirname, '..', 'assets', 'runtime');

// Emerald = the app's "running / success" accent (see design/components.ts).
const EMERALD = '#22c55e';
const RING = '#09090b'; // matches the dark tray-icon backdrop for contrast.

function dotSvg(size, cx, cy, ringR, dotR, dotColor, ringColor) {
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">` +
      (ringColor ? `<circle cx="${cx}" cy="${cy}" r="${ringR}" fill="${ringColor}"/>` : '') +
      `<circle cx="${cx}" cy="${cy}" r="${dotR}" fill="${dotColor}"/>` +
      `</svg>`,
  );
}

async function compose(baseFile, outFile, overlay) {
  const base = path.join(runtime, baseFile);
  const out = path.join(runtime, outFile);
  await sharp(base)
    .composite([{ input: overlay, top: 0, left: 0 }])
    .png()
    .toFile(out);
  const meta = await sharp(out).metadata();
  console.log(`wrote ${outFile} (${meta.width}x${meta.height})`);
}

async function main() {
  // Windows coloured tray icon: 32x32, emerald dot with a dark contrast ring.
  await compose('tray-icon.png', 'tray-icon-active.png', dotSvg(32, 24, 24, 8, 5.5, EMERALD, RING));

  // macOS template images are alpha masks (system-tinted), so the badge is a
  // plain monochrome dot in the free bottom-right corner.
  await compose(
    'trayTemplate.png',
    'trayTemplate-active.png',
    dotSvg(18, 13.5, 13.5, 0, 4.5, '#000000', null),
  );
  await compose(
    'trayTemplate@2x.png',
    'trayTemplate-active@2x.png',
    dotSvg(36, 27, 27, 0, 9, '#000000', null),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
