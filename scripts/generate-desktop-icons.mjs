// SPDX-License-Identifier: MPL-2.0  —  Desktop icon asset generator.
//
// Renders the AgentSkin SVG brand assets into PNG, Windows ICO, macOS ICNS
//   and Electron tray images via sharp (prebuilt librsvg).
// Pure Node.js; runs on any OS supported by Electron.
//
// Iconography
//   • icon.svg            → 1024×1024 master PNG + multi-slot .ico + .icns
//   • trayTemplate.svg    → macOS tray template (mask) 18/36px
//   • icon.svg            → Electron tray icon 32px (Windows/Linux)
//
// Usage:
//   node scripts/generate-desktop-icons.mjs     # regenerate
//   npm run icons                                # same via package.json
//
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const runtimeAssets = path.join(assets, 'runtime');
const source = path.join(assets, 'branding', 'icon.svg');
const traySource = path.join(assets, 'branding', 'trayTemplate.svg');
const themeFileSource = path.join(assets, 'branding', 'theme-file.svg');
const work = await mkdtemp(path.join(os.tmpdir(), 'agentskin-icons-'));

// Transparent background — the brand SVG is fully self-contained.
const PNG_BG = { r: 0, g: 0, b: 0, alpha: 0 };

async function renderSVG(input, size) {
  // Resize at high fidelity with transparent canvas, then strip the alpha-free
  // premultiplied buffer.  Contain keeps the 1:1 aspect ratio centred with
  // letterboxing on either axis (not expected here since viewBox is square).
  return sharp(input)
    .resize(size, size, { fit: 'contain', background: PNG_BG })
    .png()
    .toBuffer();
}

async function renderToFile(input, size, output) {
  await sharp(await renderSVG(input, size))
    .png()
    .toFile(output);
}

async function writeIco(entries, output) {
  const images = await Promise.all(entries.map(async ({ size, file }) => ({
    size,
    data: await readFile(file),
  })));
  const headerSize = 6 + images.length * 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt8(0, entry + 2);
    header.writeUInt8(0, entry + 3);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  await writeFile(output, Buffer.concat([header, ...images.map(({ data }) => data)]));
}

try {
  await mkdir(runtimeAssets, { recursive: true });

  // Master app-icon PNG at 1024² — used as the 1× slot in ICO/ICNS; copied to
  // assets/branding/icon.png and assets/runtime/icon.png (Electron BrowserWindow).
  const master = await renderSVG(source, 1024);
  await writeFile(path.join(assets, 'branding', 'icon.png'), master);
  await writeFile(path.join(runtimeAssets, 'icon.png'), master);
  // Also write the legacy 512px app-icon.png used by install-progress.tsx.
  const payload512 = await sharp(master)
    .resize(512, 512, { fit: 'fill' }).png().toBuffer();
  await writeFile(path.join(assets, 'branding', 'app-icon.png'), payload512);

  // .ico payload (7 size slots 16…256, all 32-bit RGBA PNG-compressed).
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const icoEntries = icoSizes.map((size) => ({ size, file: path.join(work, `icon-${size}.png`) }));
  for (const { size, file } of icoEntries) await renderToFile(source, size, file);
  await writeIco(icoEntries, path.join(assets, 'branding', 'icon.ico'));

  // .agentskin-theme document icon (Windows file association).
  const themeIcoEntries = icoSizes.map((size) => ({ size, file: path.join(work, `theme-file-${size}.png`) }));
  for (const { size, file } of themeIcoEntries) await renderToFile(themeFileSource, size, file);
  await writeIco(themeIcoEntries, path.join(assets, 'branding', 'theme-file.ico'));

  // macOS template tray images (mask — single channel, solid black shape).
  await renderToFile(traySource, 18, path.join(runtimeAssets, 'trayTemplate.png'));
  await renderToFile(traySource, 36, path.join(runtimeAssets, 'trayTemplate@2x.png'));
  // macOS "active" tray image — same shape, distinct file watched by tray-manager.ts.
  await copyFile(path.join(runtimeAssets, 'trayTemplate.png'), path.join(runtimeAssets, 'trayTemplate-active.png'));
  await copyFile(path.join(runtimeAssets, 'trayTemplate@2x.png'), path.join(runtimeAssets, 'trayTemplate-active@2x.png'));

  // Electron tray icon (actual colour — used on Windows + Linux).
  await renderToFile(source, 32, path.join(runtimeAssets, 'tray-icon.png'));
  // Non-template (Windows/Linux) "active" tray icon — identical to the base file;
  // retained as a separate path so tray-manager can mutate state without re-rendering.
  await copyFile(path.join(runtimeAssets, 'tray-icon.png'), path.join(runtimeAssets, 'tray-icon-active.png'));

  // macOS tray template-payload ICNS chunks, written directly (same layout
  // iconutil emits, so no macOS-only toolchain is needed): base 16/32 slots
  // plus the ic07..ic14 128..1024 and retina slots.
  const icnsTypes = [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32],
    ['ic12', 64],
    ['ic07', 128],
    ['ic13', 256],
    ['ic08', 256],
    ['ic14', 512],
    ['ic09', 512],
    ['ic10', 1024],
  ];
  const writeIcns = async (svg, name, output) => {
    const chunks = [];
    for (const [type, size] of icnsTypes) {
      const file = path.join(work, `${name}-${type}.png`);
      await renderToFile(svg, size, file);
      const data = await readFile(file);
      const header = Buffer.alloc(8);
      header.write(type, 0, 'ascii');
      header.writeUInt32BE(data.length + 8, 4);
      chunks.push(header, data);
    }
    const body = Buffer.concat(chunks);
    const fileHeader = Buffer.alloc(8);
    fileHeader.write('icns', 0, 'ascii');
    fileHeader.writeUInt32BE(body.length + 8, 4);
    await writeFile(output, Buffer.concat([fileHeader, body]));
  };
  await writeIcns(source, 'AgentSkin', path.join(assets, 'branding', 'icon.icns'));
  // .agentskin-theme document icon (macOS CFBundleTypeIconFile).
  await writeIcns(themeFileSource, 'AgentSkinThemeFile', path.join(assets, 'branding', 'theme-file.icns'));

  console.log('Generated AgentSkin PNG, ICO, tray, and macOS ICNS assets.');
} finally {
  await rm(work, { recursive: true, force: true });
}
