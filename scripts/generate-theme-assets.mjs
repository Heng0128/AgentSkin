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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
  return {
    id: manifest.id,
    signature: manifest.signature ?? null,
    bg,
    bgDeep,
    glow,
    accent,
    secondary,
    isLight,
  };
}

function hexToRgbTriple(hex) {
  let h = (hex || '').replace('#', '');
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  if (h.length !== 6) return '136, 136, 255';
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

/**
 * # Aurora‑Glass procedural artwork
 *
 * Renders a catalog preview that *shows* the theme's signature instead of a
 * flat gradient: a frosted‑glass app window floating over a living aurora
 * (drifting cyan / violet / coral light bands + star field). The glass panel
 * carries the same three craft cues as the injected CSS:
 *   - specular rim‑light along the top edge (glass catching light),
 *   - an iridescent sheen stripe on the primary send button,
 *   - accent‑tinted chat bubbles + a code block to read as a real AI app.
 *
 * `hero.webp` is intentionally NOT emitted for this theme: the aurora is
 * generated live in CSS (see theme-utils `auroraGlassSignature`), and the
 * manifest declares no `hero`, so a static hero would be dead weight.
 */

const AG = {
  cyan: '#6ee7d3',
  cyanDeep: '#39b9c9',
  violet: '#9b8cff',
  violetDeep: '#6f5cff',
  coral: '#ff9bd0',
  coralDeep: '#ff7aa8',
};

const r = (x, y, w, h, rx, fill, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
const circ = (cx, cy, rad, fill, extra = '') =>
  `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}" ${extra}/>`;

function auroraGlassPreviewSvg(W, H) {
  const stars = [
    [120, 90, 1.6, 0.7],
    [260, 150, 1.2, 0.5],
    [420, 80, 1.4, 0.6],
    [560, 200, 1.0, 0.4],
    [700, 110, 1.8, 0.8],
    [860, 70, 1.2, 0.5],
    [980, 180, 1.5, 0.6],
    [1100, 100, 1.3, 0.55],
    [1180, 220, 1.6, 0.7],
    [180, 300, 1.1, 0.45],
    [330, 260, 1.3, 0.5],
    [640, 300, 1.0, 0.4],
    [900, 260, 1.4, 0.6],
    [1060, 300, 1.2, 0.5],
    [1150, 340, 1.5, 0.65],
    [80, 420, 1.2, 0.5],
    [240, 470, 1.0, 0.4],
    [520, 440, 1.3, 0.55],
    [780, 470, 1.1, 0.45],
    [1000, 430, 1.4, 0.6],
    [1150, 480, 1.2, 0.5],
    [160, 560, 1.3, 0.55],
    [420, 600, 1.0, 0.4],
    [700, 580, 1.4, 0.6],
    [940, 610, 1.1, 0.45],
    [1120, 560, 1.3, 0.55],
    [60, 640, 1.2, 0.5],
    [300, 660, 1.0, 0.4],
  ];
  const starSvg = stars
    .map(([x, y, rad, op]) => circ(x, y, rad, `rgba(255,255,255,${op})`))
    .join('');

  const WX = 140,
    WY = 70,
    WW = 1000,
    WH = 580,
    WR = 26;
  const SX = 168,
    SY = 98,
    SW = 232,
    SH = 524,
    SR = 16;

  // sidebar nav rows
  const navX = SX + 16,
    navW = SW - 32,
    navRh = 36,
    navGap = 10,
    navY0 = SY + 70;
  let nav = '';
  for (let i = 0; i < 5; i++) {
    const y = navY0 + i * (navRh + navGap);
    const active = i === 1;
    if (active) {
      nav += r(navX, y, navW, navRh, 10, 'rgba(110,231,211,0.18)');
      nav += r(navX, y + 9, 3, navRh - 18, 1.5, AG.cyan);
    } else {
      nav += r(navX, y, navW, navRh, 10, 'rgba(255,255,255,0.04)');
    }
    nav += circ(navX + 18, y + navRh / 2, 7, active ? AG.cyan : 'rgba(255,255,255,0.3)');
    nav += r(
      navX + 36,
      y + navRh / 2 - 3,
      active ? 120 : 90,
      8,
      4,
      active ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.28)',
    );
  }

  // conversation bubble text lines
  const aLines = [360, 380, 400]
    .map((y, i) => r(460, y, [360, 330, 250][i], 7, 3.5, 'rgba(255,255,255,0.32)'))
    .join('');
  const uLines = [300, 320]
    .map((y, i) => r(740, y, [330, 250][i], 7, 3.5, 'rgba(110,231,211,0.45)'))
    .join('');

  // code block lines (one cyan token, one violet token)
  const codeLines = [
    r(460, 400, 180, 8, 4, 'rgba(205,217,232,0.5)'),
    r(460, 418, 300, 8, 4, 'rgba(205,217,232,0.35)'),
    r(484, 436, 140, 8, 4, 'rgba(110,231,211,0.75)'),
    r(484, 454, 260, 8, 4, 'rgba(205,217,232,0.35)'),
    r(460, 472, 220, 8, 4, 'rgba(155,140,255,0.65)'),
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="bgv" cx="0.5" cy="0.36" r="0.82">
      <stop offset="0%" stop-color="#12203c"/>
      <stop offset="60%" stop-color="#0a0e1a"/>
      <stop offset="100%" stop-color="#05070f"/>
    </radialGradient>
    <linearGradient id="gCyan" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${AG.cyan}"/><stop offset="100%" stop-color="${AG.cyanDeep}"/>
    </linearGradient>
    <linearGradient id="gViolet" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${AG.violet}"/><stop offset="100%" stop-color="${AG.violetDeep}"/>
    </linearGradient>
    <linearGradient id="gCoral" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${AG.coral}"/><stop offset="100%" stop-color="${AG.coralDeep}"/>
    </linearGradient>
    <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="58"/>
    </filter>
    <filter id="winShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="26"/>
    </filter>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="16%" stop-color="#ffffff" stop-opacity="0.1"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="46%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="54%" stop-color="#ffffff" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="glassFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.03"/>
    </linearGradient>
    <linearGradient id="sideFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.07"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.02"/>
    </linearGradient>
    <linearGradient id="accentFill" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${AG.cyan}"/><stop offset="100%" stop-color="${AG.violet}"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bgv)"/>

  <g filter="url(#soft)" opacity="0.9">
    <ellipse cx="360" cy="190" rx="470" ry="120" fill="url(#gCyan)" opacity="0.55"/>
    <ellipse cx="900" cy="130" rx="520" ry="130" fill="url(#gViolet)" opacity="0.5"/>
    <ellipse cx="760" cy="330" rx="500" ry="110" fill="url(#gCoral)" opacity="0.3"/>
    <ellipse cx="1050" cy="440" rx="430" ry="120" fill="url(#gCyan)" opacity="0.4"/>
  </g>

  <g>${starSvg}</g>

  <rect x="${WX - 6}" y="${WY + 10}" width="${WW}" height="${WH}" rx="${WR}" fill="#000000" opacity="0.5" filter="url(#winShadow)"/>
  <rect x="${WX}" y="${WY}" width="${WW}" height="${WH}" rx="${WR}" fill="url(#glassFill)" stroke="#ffffff" stroke-opacity="0.12" stroke-width="1.5"/>
  <rect x="${WX}" y="${WY}" width="${WW}" height="240" rx="${WR}" fill="url(#rim)"/>

  ${circ(WX + WW - 30, WY + 30, 6, 'rgba(255,255,255,0.35)')}
  ${circ(WX + WW - 54, WY + 30, 6, 'rgba(255,255,255,0.25)')}
  ${circ(WX + WW - 78, WY + 30, 6, 'rgba(255,255,255,0.18)')}

  <rect x="${SX}" y="${SY}" width="${SW}" height="${SH}" rx="${SR}" fill="url(#sideFill)" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1"/>
  ${circ(SX + 26, SY + 30, 13, 'url(#accentFill)')}
  ${r(SX + 48, SY + 22, 120, 14, 7, 'rgba(255,255,255,0.5)')}
  ${nav}

  ${r(440, 100, 220, 12, 6, 'rgba(255,255,255,0.55)')}
  ${r(440, 124, 140, 8, 4, 'rgba(255,255,255,0.3)')}

  ${r(440, 170, 430, 84, 16, 'rgba(255,255,255,0.05)', 'stroke="#ffffff" stroke-opacity="0.05" stroke-width="1"')}
  ${circ(470, 194, 11, 'rgba(155,140,255,0.85)')}
  ${aLines}

  ${r(720, 276, 396, 64, 16, 'rgba(110,231,211,0.14)', 'stroke="rgba(110,231,211,0.22)" stroke-width="1"')}
  ${circ(750, 300, 11, 'rgba(110,231,211,0.85)')}
  ${uLines}

  ${r(440, 360, 676, 150, 14, '#070b14', 'stroke="rgba(110,231,211,0.14)" stroke-width="1"')}
  ${r(440, 360, 676, 26, 14, 'rgba(255,255,255,0.04)')}
  ${circ(462, 373, 4, 'rgba(255,255,255,0.3)')}
  ${circ(478, 373, 4, 'rgba(255,255,255,0.22)')}
  ${circ(494, 373, 4, 'rgba(255,255,255,0.16)')}
  ${codeLines}

  ${r(440, 534, 676, 66, 16, 'rgba(22,32,58,0.7)', 'stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"')}
  ${r(464, 558, 260, 8, 4, 'rgba(255,255,255,0.22)')}
  ${r(464, 576, 180, 8, 4, 'rgba(255,255,255,0.16)')}
  ${r(1040, 548, 60, 40, 12, 'url(#accentFill)')}
  ${r(1040, 548, 60, 40, 12, 'url(#sheen)')}
  ${circ(1070, 568, 5, '#0a0e1a')}
</svg>`;
}

function auroraGlassIconSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="ibg" cx="0.5" cy="0.4" r="0.75">
      <stop offset="0%" stop-color="#12203c"/><stop offset="100%" stop-color="#05070f"/>
    </radialGradient>
    <radialGradient id="ig1" cx="0.3" cy="0.28" r="0.7">
      <stop offset="0%" stop-color="#6ee7d3" stop-opacity="0.85"/><stop offset="100%" stop-color="#6ee7d3" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ig2" cx="0.78" cy="0.78" r="0.7">
      <stop offset="0%" stop-color="#9b8cff" stop-opacity="0.8"/><stop offset="100%" stop-color="#9b8cff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="irim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="iorb" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6ee7d3"/><stop offset="100%" stop-color="#9b8cff"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="26" fill="url(#ibg)"/>
  <rect width="128" height="128" rx="26" fill="url(#ig1)"/>
  <rect width="128" height="128" rx="26" fill="url(#ig2)"/>
  <rect width="128" height="128" rx="26" fill="url(#irim)" opacity="0.6"/>
  <path d="M30 36 Q64 14 98 36 Q66 48 30 36 Z" fill="#ffffff" opacity="0.22"/>
  <circle cx="64" cy="66" r="13" fill="url(#iorb)"/>
  <circle cx="59" cy="61" r="3.4" fill="#ffffff" opacity="0.85"/>
</svg>`;
}

async function renderAuroraGlassAssets(themeDir, config) {
  await mkdir(themeDir, { recursive: true });
  await writeFile(
    path.join(themeDir, 'icon.png'),
    await sharp(Buffer.from(auroraGlassIconSvg())).png().toBuffer(),
  );
  await writeFile(
    path.join(themeDir, 'preview.png'),
    await sharp(Buffer.from(auroraGlassPreviewSvg(1280, 720)))
      .png()
      .toBuffer(),
  );
  console.log(
    `[theme-assets] ${config.id} → icon.png, preview.png (aurora-glass crafted; hero skipped — CSS aurora is live)`,
  );
}

async function renderAssets(themeId) {
  const themeDir = path.join(THEMES_DIR, themeId);
  const config = await themeConfig(themeDir);
  if (config.signature === 'aurora-glass') {
    await renderAuroraGlassAssets(themeDir, config);
    return;
  }
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
  await writeFile(
    path.join(themeDir, 'icon.png'),
    await sharp(Buffer.from(iconSvg)).png().toBuffer(),
  );
  await writeFile(
    path.join(themeDir, 'preview.png'),
    await sharp(Buffer.from(previewSvg)).png().toBuffer(),
  );
  await writeFile(
    path.join(themeDir, 'hero.webp'),
    await sharp(Buffer.from(heroSvg)).webp({ quality: 90 }).toBuffer(),
  );
  console.log(
    `[theme-assets] ${config.id} → icon.png, preview.png, hero.webp (${config.isLight ? 'light' : 'dark'})`,
  );
}

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith('-'));
// Default: every theme directory with a manifest (THEME_ART entries tune the
// gradient stops; unlisted themes fall back to manifest-derived colors).
const { readdirSync, existsSync } = await import('node:fs');
const allIds = readdirSync(THEMES_DIR).filter((id) =>
  existsSync(path.join(THEMES_DIR, id, 'manifest.json')),
);
const ids = only ? [only] : allIds;
for (const id of ids) {
  await renderAssets(id);
}
