// SPDX-License-Identifier: MPL-2.0
//
// Generate NSIS installer skin bitmaps (24-bit BMP, no alpha) AND a
// generated NSIS include (build/brand.nsh) that carries the brand palette.
//
// SINGLE SOURCE OF TRUTH: scripts/branding.config.mjs
//   - BMP gradients / dimensions / sidebar texts  -> from BRAND
//   - NSIS color defines (BR_*, MUI_BGCOLOR, MUI_TEXTCOLOR) -> build/brand.nsh
//     (installer.nsh does `!include "brand.nsh"`)
//
// NSIS classic wizard requires:
//   installerHeader      = 150 x 57   (top-right small banner)
//   installerSidebar     = 164 x 314  (left side banner, install wizard)
//   uninstallerSidebar   = 164 x 314  (left side banner, uninstall wizard)
//
// Technique: build each scene as an SVG at 4x the target resolution
// (the brand mark is embedded as a data-URI <image> so no post-render
// compositing is needed), render with sharp, then downscale with a
// Lanczos kernel for crisp, anti-aliased text and smooth gradients.
//
// Run:  node scripts/generate-nsis-assets.mjs
// Out:  build/nsis/{header,sidebar,uninstaller-sidebar}.bmp
//       build/brand.nsh

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BRAND, hexToNsis, hexToRgb } from './branding.config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICON = path.join(ROOT, 'assets/branding/icon.png');
const OUT_DIR = path.join(ROOT, 'build/nsis');
const OUT_NSH = path.join(ROOT, 'build/brand.nsh');
const SCALE = 4;

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const esc = (s) => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));

let ICON_DATA_URI = '';

// ---- BMP encoder (24-bit, bottom-up, 4-byte row alignment) ----
function encodeBmp24(width, height, rgbaBuf) {
  const rowSize = Math.floor((24 * width + 31) / 32) * 4;
  const pixelArraySize = rowSize * height;
  const fileSize = 14 + 40 + pixelArraySize;
  const out = Buffer.alloc(fileSize);
  let p = 0;
  out.writeUInt8(0x42, p++);
  out.writeUInt8(0x4d, p++);
  out.writeUInt32LE(fileSize, p);
  p += 4;
  out.writeUInt16LE(0, p);
  p += 2;
  out.writeUInt16LE(0, p);
  p += 2;
  out.writeUInt32LE(54, p);
  p += 4;
  out.writeUInt32LE(40, p);
  p += 4;
  out.writeInt32LE(width, p);
  p += 4;
  out.writeInt32LE(height, p);
  p += 4;
  out.writeUInt16LE(1, p);
  p += 2;
  out.writeUInt16LE(24, p);
  p += 2;
  out.writeUInt32LE(0, p);
  p += 4;
  out.writeUInt32LE(pixelArraySize, p);
  p += 4;
  out.writeInt32LE(2835, p);
  p += 4;
  out.writeInt32LE(2835, p);
  p += 4;
  out.writeUInt32LE(0, p);
  p += 4;
  out.writeUInt32LE(0, p);
  p += 4;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = p;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      out.writeUInt8(rgbaBuf[i + 2], p++);
      out.writeUInt8(rgbaBuf[i + 1], p++);
      out.writeUInt8(rgbaBuf[i], p++);
    }
    while (p - rowStart < rowSize) out.writeUInt8(0, p++);
  }
  return out;
}

// ---- Geometry (scaled space) ----
function sidebarGeom(w, h) {
  const iconSize = Math.round(h * 0.3);
  const iconTop = Math.round(h * 0.15);
  const iconLeft = Math.round((w - iconSize) / 2);
  const titleY = iconTop + iconSize + Math.round(h * 0.065);
  const dividerY = titleY + Math.round(h * 0.038);
  const subY = dividerY + Math.round(h * 0.05);
  const verY = h - Math.round(h * 0.055);
  return { iconSize, iconLeft, iconTop, titleY, dividerY, subY, verY };
}

function sidebarSvg(w, h, opts) {
  const g = sidebarGeom(w, h);
  const cx = w / 2;
  const glowR = g.iconSize * 1.5;
  const glowCx = cx,
    glowCy = g.iconTop + g.iconSize / 2;
  const top = hexToRgb(opts.top);
  const bottom = hexToRgb(opts.bottom);
  const mid = mix(top, bottom, 0.6);
  const ACCENT = hexToRgb(BRAND.accent);
  const ACCENT_LIGHT = hexToRgb(BRAND.accentLight);
  const iconImg = `<image href="${ICON_DATA_URI}" x="${g.iconLeft}" y="${g.iconTop}" width="${g.iconSize}" height="${g.iconSize}"/>`;
  return (
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0%" stop-color="${rgb(top)}"/>` +
    `<stop offset="55%" stop-color="${rgb(mid)}"/>` +
    `<stop offset="100%" stop-color="${rgb(bottom)}"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="${glowCx}" cy="${glowCy}" r="${glowR}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="${rgba(ACCENT, 0.55)}"/>` +
    `<stop offset="45%" stop-color="${rgba(ACCENT, 0.18)}"/>` +
    `<stop offset="100%" stop-color="${rgba(ACCENT, 0)}"/>` +
    `</radialGradient>` +
    `<radialGradient id="halo" cx="${glowCx}" cy="${glowCy}" r="${g.iconSize * 0.95}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="${rgba(ACCENT_LIGHT, 0.32)}"/>` +
    `<stop offset="100%" stop-color="${rgba(ACCENT_LIGHT, 0)}"/>` +
    `</radialGradient>` +
    `<pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse">` +
    `<circle cx="2" cy="2" r="1.2" fill="${rgba([255, 255, 255], 0.05)}"/>` +
    `</pattern>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#glow)"/>` +
    `<rect x="${g.iconLeft - g.iconSize * 0.28}" y="${g.iconTop - g.iconSize * 0.28}" width="${g.iconSize * 1.56}" height="${g.iconSize * 1.56}" fill="url(#halo)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#dots)"/>` +
    iconImg +
    `<rect x="0" y="0" width="${Math.round(w * 0.02)}" height="${h}" fill="${rgba(ACCENT_LIGHT, 0.9)}"/>` +
    `<rect x="0" y="${h - Math.round(h * 0.014)}" width="${w}" height="${Math.round(h * 0.014)}" fill="${rgba(ACCENT, 0.55)}"/>` +
    `<text x="${cx}" y="${g.titleY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(h * 0.058)}" font-weight="700" fill="#FFFFFF" letter-spacing="${Math.round(h * 0.004)}">${esc(opts.title)}</text>` +
    `<line x1="${cx - Math.round(w * 0.17)}" y1="${g.dividerY}" x2="${cx + Math.round(w * 0.17)}" y2="${g.dividerY}" stroke="${rgba([255, 255, 255], 0.18)}" stroke-width="${Math.max(1, Math.round(h * 0.004))}"/>` +
    `<text x="${cx}" y="${g.subY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(h * 0.03)}" font-weight="400" fill="${rgba([255, 255, 255], 0.62)}" letter-spacing="${Math.round(h * 0.002)}">${esc(opts.subtitle)}</text>` +
    `<text x="${cx}" y="${g.verY}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(h * 0.026)}" font-weight="500" fill="${rgba([255, 255, 255], 0.45)}" letter-spacing="${Math.round(h * 0.004)}">${esc(opts.version)}</text>` +
    `</svg>`
  );
}

function headerSvg(w, h, opts) {
  const iconSize = Math.round(h * 0.42);
  const iconLeft = Math.round(h * 0.16);
  const iconTop = Math.round((h - iconSize) / 2);
  const textX = iconLeft + iconSize + Math.round(h * 0.12);
  const textY = Math.round(h * 0.66);
  const top = hexToRgb(opts.top);
  const bottom = hexToRgb(opts.bottom);
  const ACCENT_LIGHT = hexToRgb(BRAND.accentLight);
  const iconImg = `<image href="${ICON_DATA_URI}" x="${iconLeft}" y="${iconTop}" width="${iconSize}" height="${iconSize}"/>`;
  return (
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">` +
    `<defs>` +
    `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0%" stop-color="${rgb(top)}"/>` +
    `<stop offset="100%" stop-color="${rgb(bottom)}"/>` +
    `</linearGradient>` +
    `<radialGradient id="glow" cx="${iconLeft + iconSize / 2}" cy="${h / 2}" r="${h * 1.4}" gradientUnits="userSpaceOnUse">` +
    `<stop offset="0%" stop-color="${rgba(ACCENT_LIGHT, 0.5)}"/>` +
    `<stop offset="100%" stop-color="${rgba(ACCENT_LIGHT, 0)}"/>` +
    `</radialGradient>` +
    `</defs>` +
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
    `<rect width="${w}" height="${h}" fill="url(#glow)"/>` +
    iconImg +
    `<text x="${textX}" y="${textY}" text-anchor="start" font-family="Segoe UI, Arial, sans-serif" font-size="${Math.round(h * 0.34)}" font-weight="700" fill="#FFFFFF" letter-spacing="${Math.round(h * 0.01)}">AgentSkin</text>` +
    `</svg>`
  );
}

async function render(name, tw, th, svgBuilder, opts) {
  const w = tw * SCALE,
    h = th * SCALE;
  const svg = svgBuilder(w, h, opts);
  const rgbaBuf = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .resize(tw, th, { kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const bmp = encodeBmp24(tw, th, rgbaBuf);
  await writeFile(path.join(OUT_DIR, `${name}.bmp`), bmp);
  console.log(`  ${name}.bmp  ${tw}x${th}  (${(bmp.length / 1024).toFixed(1)} KB)`);
}

function emitBrandNsh() {
  const lines = [
    '; AUTO-GENERATED by scripts/generate-nsis-assets.mjs -- do not edit by hand.',
    '; Single source of truth: scripts/branding.config.mjs',
    '!ifndef AGENTSKIN_BRAND_INCLUDED',
    '!define AGENTSKIN_BRAND_INCLUDED',
    '',
    `!define BR_PRIMARY   ${hexToNsis(BRAND.primary)}`,
    `!define BR_ACCENT    ${hexToNsis(BRAND.accent)}`,
    `!define BR_SURFACE   ${hexToNsis(BRAND.surface)}`,
    `!define BR_TEXT      ${hexToNsis(BRAND.text)}`,
    `!define BR_TEXTLIGHT ${hexToNsis(BRAND.textLight)}`,
    '',
    '; MUI window background / text (consumed by installer.nsh MUI pages)',
    `!define MUI_BGCOLOR  ${hexToNsis(BRAND.surface)}`,
    `!define MUI_TEXTCOLOR ${hexToNsis(BRAND.text)}`,
    '',
    '!endif',
    '',
  ];
  return writeFile(OUT_NSH, lines.join('\n'));
}

async function main() {
  const iconBuf = await readFile(ICON);
  ICON_DATA_URI = `data:image/png;base64,${iconBuf.toString('base64')}`;
  await mkdir(OUT_DIR, { recursive: true });

  let version = 'v0.0.0';
  try {
    const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
    version = `v${pkg.version}`;
  } catch (_e) {}

  console.log('Generating NSIS skin assets ->', path.relative(ROOT, OUT_DIR));

  await render(BRAND.bmp.sidebar.name, BRAND.bmp.sidebar.w, BRAND.bmp.sidebar.h, sidebarSvg, {
    top: BRAND.sidebar.top,
    bottom: BRAND.sidebar.bottom,
    title: BRAND.title,
    subtitle: BRAND.subtitle,
    version,
  });

  await render(
    BRAND.bmp.uninstallerSidebar.name,
    BRAND.bmp.uninstallerSidebar.w,
    BRAND.bmp.uninstallerSidebar.h,
    sidebarSvg,
    {
      top: BRAND.uninstallerSidebar.top,
      bottom: BRAND.uninstallerSidebar.bottom,
      title: BRAND.title,
      subtitle: BRAND.uninstallSubtitle,
      version,
    },
  );

  await render(BRAND.bmp.header.name, BRAND.bmp.header.w, BRAND.bmp.header.h, headerSvg, {
    top: BRAND.header.top,
    bottom: BRAND.header.bottom,
  });

  await emitBrandNsh();
  console.log('  brand.nsh  (BR_* + MUI colors)');

  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
