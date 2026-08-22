// SPDX-License-Identifier: MPL-2.0

/**
 * Generate minimal PNG placeholder images for bridge themes.
 * Uses only Node.js built-in zlib — no external dependencies.
 * Produces solid-color icon.png (64x64) and gradient preview.png (160x120).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function crc32(buf) {
  let crc = 0xffffffff;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPNG(width, height, pixelFn) {
  // Build raw image data with filter byte (0) at start of each row
  const rawData = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    rawData[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y, width, height);
      const offset = rowStart + 1 + x * 4;
      rawData[offset] = r;
      rawData[offset + 1] = g;
      rawData[offset + 2] = b;
      rawData[offset + 3] = 255;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const compressed = zlib.deflateSync(rawData, { level: 9 });

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

const themes = [
  {
    dir: 'themes/github-noir',
    accent: '#3fb950',
    background: '#090d0a',
  },
  {
    dir: 'themes/obsidian-poise',
    accent: '#c8a96b',
    background: '#0b0d10',
  },
  {
    dir: 'themes/sweet-strawberry-code',
    accent: '#ff6b8a',
    background: '#fff7f9',
  },
];

for (const theme of themes) {
  const themeDir = join(root, theme.dir);
  const [ar, ag, ab] = hexToRgb(theme.accent);
  const [br, bg, bb] = hexToRgb(theme.background);

  // icon.png: 64x64 solid accent color
  const iconPNG = createPNG(64, 64, () => [ar, ag, ab]);
  writeFileSync(join(themeDir, 'icon.png'), iconPNG);
  console.log(`  icon.png -> ${theme.dir}/icon.png (${iconPNG.length} bytes)`);

  // preview.png: 160x120 diagonal gradient from background to accent
  const previewPNG = createPNG(160, 120, (x, y) => {
    const t = (x / 159 + y / 119) / 2;
    return [lerp(br, ar, t), lerp(bg, ag, t), lerp(bb, ab, t)];
  });
  writeFileSync(join(themeDir, 'preview.png'), previewPNG);
  console.log(`  preview.png -> ${theme.dir}/preview.png (${previewPNG.length} bytes)`);
}

console.log('\nDone — 6 PNG files generated.');
