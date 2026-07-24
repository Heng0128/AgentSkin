// SPDX-License-Identifier: MPL-2.0
/**
 * Generate tray icons from the main app icon.
 * Runs during build to create tray-icon.png and trayTemplate.png.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICON_PATH = path.join(ROOT, 'assets', 'branding', 'app-icon.png');
const OUTPUT_DIR = path.join(ROOT, 'assets', 'runtime');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Try sharp first, fallback to canvas, then placeholder
let sharp;
try {
  sharp = await import('sharp');
} catch {
  // No sharp available, try canvas
  let canvas;
  try {
    canvas = await import('canvas');
  } catch {
    // Last resort: placeholder
    console.warn('[tray-icon-gen] No image library available, creating placeholder tray icons');
    const placeholder = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(path.join(OUTPUT_DIR, 'tray-icon.png'), placeholder);
    fs.writeFileSync(path.join(OUTPUT_DIR, 'trayTemplate.png'), placeholder);
    console.log('[tray-icon-gen] placeholder tray icons written to assets/runtime/');
    process.exit(0);
  }

  // Use canvas to resize
  const src = fs.readFileSync(ICON_PATH);
  const img = await canvas.loadImage(src);

  // Windows tray: 16x16
  const winCanvas = canvas.createCanvas(16, 16);
  const winCtx = winCanvas.getContext('2d');
  winCtx.clearRect(0, 0, 16, 16);
  winCtx.drawImage(img, 0, 0, 16, 16);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'tray-icon.png'), winCanvas.toBuffer('image/png'));
  console.log('[tray-icon-gen] Written tray-icon.png (16x16 via canvas)');

  // macOS tray: 16x16 grayscale
  const macCanvas = canvas.createCanvas(16, 16);
  const macCtx = macCanvas.getContext('2d');
  macCtx.clearRect(0, 0, 16, 16);
  macCtx.drawImage(img, 0, 0, 16, 16);
  const macImageData = macCtx.getImageData(0, 0, 16, 16);
  for (let i = 0; i < macImageData.data.length; i += 4) {
    const avg = macImageData.data[i] * 0.299 + macImageData.data[i + 1] * 0.587 + macImageData.data[i + 2] * 0.114;
    macImageData.data[i] = avg;
    macImageData.data[i + 1] = avg;
    macImageData.data[i + 2] = avg;
  }
  macCtx.putImageData(macImageData, 0, 0);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'trayTemplate.png'), macCanvas.toBuffer('image/png'));
  console.log('[tray-icon-gen] Written trayTemplate.png (16x16 grayscale via canvas)');

  process.exit(0);
}

// Use sharp
const src = fs.readFileSync(ICON_PATH);

const winTray = await sharp.default(src)
  .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer();
fs.writeFileSync(path.join(OUTPUT_DIR, 'tray-icon.png'), winTray);
console.log('[tray-icon-gen] Written tray-icon.png (16x16)');

const macTray = await sharp.default(src)
  .resize(16, 16, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .grayscale()
  .png()
  .toBuffer();
fs.writeFileSync(path.join(OUTPUT_DIR, 'trayTemplate.png'), macTray);
console.log('[tray-icon-gen] Written trayTemplate.png (16x16 grayscale)');
