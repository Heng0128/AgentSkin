// SPDX-License-Identifier: MPL-2.0
// Generates proper 512x512 theme icons with transparent backgrounds.
// Replaces the 1x1 placeholder PNGs in themes/*/icon.png.

import fs from 'node:fs';
import path from 'node:path';

// ---------- minimal PNG encoder (RGBA, colortype 6) ----------
import zlib from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba(y, raw.subarray(y * (width * 4 + 1) + 1, y * (width * 4 + 1) + 1 + width * 4));
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mix(c1, c2, t) {
  return [Math.round(lerp(c1[0], c2[0], t)), Math.round(lerp(c1[1], c2[1], t)), Math.round(lerp(c1[2], c2[2], t)), 255];
}
function setPx(buf, i, c) { buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3]; }

// ---------- Icon generators ----------

/**
 * Generate a theme icon: centered shape on fully transparent background.
 * @param size - canvas size (512)
 * @param drawFn - callback drawing the icon content onto a filled RGBA buffer
 */
function generateIcon(size, drawFn) {
  return makePng(size, size, (y, row) => {
    // Fill with transparent pixels first
    for (let x = 0; x < size; x++) {
      setPx(row, x * 4, [0, 0, 0, 0]);
    }
    // Then draw the icon
    drawFn(y, row, size);
  });
}

// Arctic White: geometric "A" shape in blue on transparent bg
function arcticWhiteIcon(y, row, size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.38; // main radius
  for (let x = 0; x < size; x++) {
    const i = x * 4;
    const dx = (x - cx) / r, dy = (y - cy) / r;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Draw a stylized "A" shape
    let alpha = 0;
    const leftBar = Math.abs(dx + 0.3) < 0.15 && dy > -0.8 && dy < 0.7;
    const rightBar = Math.abs(dx - 0.3) < 0.15 && dy > -0.8 && dy < 0.7;
    const crossBar = Math.abs(dy + 0.15) < 0.06 && Math.abs(dx) < 0.35;
    const tip = Math.abs(dx) < 0.12 && dy > -1.0 && dy < -0.6;

    if (leftBar || rightBar || crossBar || tip) {
      // Gradient from light blue to deep blue
      const t = (dy + 1) / 2;
      const c = mix([47, 107, 255], [100, 160, 255], t);
      c[3] = 255;
      setPx(row, i, c);
      alpha = 1;
    }

    // Soft edge anti-aliasing
    if (!alpha && dist < 1.1 && dist >= 1.0) {
      const edgeAlpha = Math.round((1.1 - dist) * 2550);
      setPx(row, i, [47, 107, 255, edgeAlpha]);
    }
  }
}

// Cyber Neon: glowing cyan/magenta circle on transparent bg
function cyberNeonIcon(y, row, size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.35;
  for (let x = 0; x < size; x++) {
    const i = x * 4;
    const dx = (x - cx) / r, dy = (y - cy) / r;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.95) {
      // Inner glow - cyan
      const t = dist;
      const c = mix([0, 240, 255], [255, 0, 229], t * 0.3);
      c[3] = 255;
      setPx(row, i, c);
    } else if (dist < 1.0) {
      // Edge ring - magenta glow
      const edgeAlpha = Math.round((1.0 - dist) * 2550);
      setPx(row, i, [255, 0, 229, edgeAlpha]);
    } else if (dist < 1.15) {
      // Outer glow fade
      const glowAlpha = Math.round((1.15 - dist) * 1000);
      setPx(row, i, [0, 240, 255, glowAlpha]);
    }
  }
}

// Sakura: soft pink circle with purple accent on transparent bg
function sakuraIcon(y, row, size) {
  const cx = size / 2, cy = size / 2;
  const r = size * 0.35;
  for (let x = 0; x < size; x++) {
    const i = x * 4;
    const dx = (x - cx) / r, dy = (y - cy) / r;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 0.9) {
      // Soft pink fill
      const t = (dy + 1) / 2;
      const c = mix([255, 94, 176], [160, 107, 255], t * 0.4);
      c[3] = 255;
      setPx(row, i, c);
    } else if (dist < 1.0) {
      // Soft edge
      const edgeAlpha = Math.round((1.0 - dist) * 2550);
      setPx(row, i, [255, 94, 176, edgeAlpha]);
    } else if (dist < 1.12) {
      // Outer glow - purple
      const glowAlpha = Math.round((1.12 - dist) * 800);
      setPx(row, i, [160, 107, 255, glowAlpha]);
    }
  }
}

// ---------- Main ----------

const themesDir = path.resolve('themes');
const themes = [
  { id: 'arctic-white', iconFn: arcticWhiteIcon, accent: '#2f6bff' },
  { id: 'cyber-neon', iconFn: cyberNeonIcon, accent: '#00f0ff' },
  { id: 'sakura', iconFn: sakuraIcon, accent: '#ff5fb0' },
];

const SIZE = 512;

for (const theme of themes) {
  const iconPath = path.join(themesDir, theme.id, 'icon.png');
  const png = generateIcon(SIZE, theme.iconFn);
  fs.writeFileSync(iconPath, png);
  console.log(`Wrote ${iconPath} (${png.length} bytes) - ${theme.accent} on transparent bg`);
}

console.log('Done. All theme icons generated with transparent backgrounds.');
