// SPDX-License-Identifier: MPL-2.0

/**
 * # generate-theme-assets.mjs — procedural theme icon / preview / hero art.
 *
 * Renders a theme's brand artwork (icon.png, preview.png, hero.webp) from its
 * palette via sharp (prebuilt librsvg). Each theme gets a soft two-stop
 * gradient background with a radial accent glow — enough to look deliberate
 * in the catalog and on the agent desktop without shipping external art.
 *
 * Usage:
 *   node scripts/generate-theme-assets.mjs            # regenerate all built-in themes
 *   node scripts/generate-theme-assets.mjs <themeId>  # regenerate one theme
 *
 * The theme manifest's colors (accent / background) drive the palette; the
 * optional `assets.heroTint` in each theme's config below tunes the second
 * gradient stop for light themes (see sakura-pastel).
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');

/** Built-in theme artwork palettes. `bgDeep` is the gradient's dark stop. */
const THEME_ART = {
  'nordic-minimal': { bgDeep: '#090d11', glow: 'rgba(127, 168, 189, 0.55)' },
  'deepspace-nebula': { bgDeep: '#060410', glow: 'rgba(139, 124, 247, 0.55)' },
  'sakura-pastel': { bgDeep: '#f3e3df', glow: 'rgba(224, 138, 168, 0.45)' },
};

/** Escape a color into an SVG stop value (raw hex works; rgba needs quotes). */
function svgColor(color) {
  return color.includes('(') ? `rgba(${color.slice(5, -1)})` : color;
}

/** Build the shared gradient + glow SVG at the requested viewport. */
function artSvg(width, height, bg, bgDeep, glow, tint) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${svgColor(bg)}"/>
      <stop offset="100%" stop-color="${svgColor(bgDeep)}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.72" cy="0.22" r="0.62">
      <stop offset="0%" stop-color="${svgColor(glow)}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${svgColor(glow)}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="tint" cx="0.28" cy="0.9" r="0.55">
      <stop offset="0%" stop-color="${svgColor(tint)}" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="${svgColor(tint)}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <rect width="100%" height="100%" fill="url(#glow)"/>
  <rect width="100%" height="100%" fill="url(#tint)"/>
</svg>`;
}

async function themeConfig(themeDir) {
  const manifest = JSON.parse(
    await readFile(path.join(themeDir, 'manifest.json'), 'utf8').catch(() => '{}'),
  );
  const colors = manifest.colors ?? {};
  const bg = colors.background ?? '#101014';
  const accent = colors.accent ?? '#8888ff';
  const secondary = colors.secondary ?? accent;
  const isLight = manifest.mode === 'light';
  const art = THEME_ART[manifest.id] ?? {};
  const bgDeep = art.bgDeep ?? (isLight ? '#e8e0dc' : '#050508');
  const glow = art.glow ?? `rgba(${hexToRgbTriple(accent)}, 0.5)`;
  return { id: manifest.id, bg, bgDeep, glow, accent, secondary, isLight };
}

function hexToRgbTriple(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length !== 6) return '136, 136, 255';
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

async function renderAssets(themeId) {
  const themeDir = path.join(THEMES_DIR, themeId);
  const config = await themeConfig(themeDir);
  const tint = config.isLight ? config.secondary : config.accent;

  const heroSvg = artSvg(1920, 1080, config.bg, config.bgDeep, config.glow, tint);
  const previewSvg = artSvg(1280, 720, config.bg, config.bgDeep, config.glow, tint);
  // Icon: square crop of the same look with a centred soft glow so it reads
  // as a mark at 128px.
  const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="ibg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${svgColor(config.bg)}"/>
      <stop offset="100%" stop-color="${svgColor(config.bgDeep)}"/>
    </linearGradient>
    <radialGradient id="iglow" cx="0.5" cy="0.42" r="0.6">
      <stop offset="0%" stop-color="${svgColor(config.glow)}" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="${svgColor(config.glow)}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="128" height="128" rx="20" fill="url(#ibg)"/>
  <rect width="128" height="128" rx="20" fill="url(#iglow)"/>
</svg>`;

  await mkdir(themeDir, { recursive: true });
  await writeFile(path.join(themeDir, 'icon.png'), await sharp(Buffer.from(iconSvg)).png().toBuffer());
  await writeFile(path.join(themeDir, 'preview.png'), await sharp(Buffer.from(previewSvg)).png().toBuffer());
  await writeFile(path.join(themeDir, 'hero.webp'), await sharp(Buffer.from(heroSvg)).webp({ quality: 90 }).toBuffer());
  console.log(`[theme-assets] ${config.id} → icon.png, preview.png, hero.webp (${config.isLight ? 'light' : 'dark'})`);
}

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('-'));
const ids = only ? [only] : Object.keys(THEME_ART);
for (const id of ids) {
  await renderAssets(id);
}
