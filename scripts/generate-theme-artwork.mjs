// SPDX-License-Identifier: MPL-2.0
//
// # generate-theme-artwork.mjs
//
// Generates proper hero.webp (1920×1080), preview.png (1280×720), and
// icon.png (128×128) for themes that currently have placeholder or missing
// artwork. Uses the cloned source-project materials under sources/.
//
// Key rule: preview is derived from hero (downscaled), but they are
// different files. Preview must never be used as hero (would be blurry).
//
// Usage:  node scripts/generate-theme-artwork.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const SOURCES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'sources');

// Map theme ID → best source image for hero artwork
const HERO_SOURCES = {
  'tokyo-night': path.join(SOURCES_DIR, 'tokyo-night-vscode-theme', 'static', 'ss_tokyo_night.png'),
  catppuccin: path.join(SOURCES_DIR, 'catppuccin', 'assets', 'banners', 'banner-v2.jpg'),
  dracula: path.join(SOURCES_DIR, 'dracula-theme', '.github', 'dracula-pro.png'),
  // Nord has no artwork — will be generated from palette below
};

//Nord北极色板 — 用于生成 hero（无原始图片素材时）
const NORD_PALETTE = {
  polarNight: ['#2e3440', '#3b4252', '#434c5e', '#4c566a'],
  snowStorm: ['#d8dee9', '#e5e9f0', '#eceff4'],
  frost: ['#8fbcbb', '#88c0d0', '#81a1c1', '#5e81ac'],
  aurora: ['#bf616a', '#d08770', '#ebcb8b', '#a3be8c', '#b48ead'],
};

async function generateNordHero(outputPath) {
  // 生成一个基于 Nord 色板的抽象艺术 hero
  const W = 1920;
  const H = 1080;
  const channels = 4; // RGBA

  // 创建渐变背景
  const buffer = Buffer.alloc(W * H * channels);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * channels;

      // 基础渐变：从 polar night 深色到稍亮的蓝色
      const t = y / H;
      const baseR = 0x2e + (0x4c - 0x2e) * t * 0.5;
      const baseG = 0x34 + (0x56 - 0x34) * t * 0.5;
      const baseB = 0x40 + (0x6a - 0x40) * t * 0.5;

      // 添加 frost 色调的抽象形状
      const cx = W * 0.7;
      const cy = H * 0.3;
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const maxDist = Math.sqrt(W ** 2 + H ** 2) * 0.4;
      const glow = Math.max(0, 1 - dist / maxDist);

      // aurora 色调的极光带
      const auroraX = x / W;
      const auroraY = y / H;
      const aurora =
        Math.sin(auroraX * 6 + auroraY * 2) * 0.5 + Math.sin(auroraX * 3 - auroraY * 4) * 0.3;

      // 混合颜色
      const frostMix = glow * 0.15;
      const auroraMix = Math.max(0, aurora) * glow * 0.25;

      // aurora 颜色映射
      const auroraColors = [
        [0xbf, 0x61, 0x6a], // red
        [0xd0, 0x87, 0x70], // orange
        [0xeb, 0xcb, 0x8b], // yellow
        [0xa3, 0xbe, 0x8c], // green
        [0xb4, 0x8e, 0xad], // purple
      ];
      const colorIdx = Math.floor(auroraX * auroraColors.length) % auroraColors.length;
      const [ar, ag, ab] = auroraColors[colorIdx];

      const frostR = 0x88;
      const frostG = 0xc0;
      const frostB = 0xd0;

      buffer[idx] = Math.min(255, baseR + frostR * frostMix + ar * auroraMix);
      buffer[idx + 1] = Math.min(255, baseG + frostG * frostMix + ag * auroraMix);
      buffer[idx + 2] = Math.min(255, baseB + frostB * frostMix + ab * auroraMix);
      buffer[idx + 3] = 255; // alpha
    }
  }

  await sharp(buffer, {
    raw: { width: W, height: H, channels: 4 },
  })
    .webp({ quality: 85 })
    .toFile(outputPath);
}

async function generateIconFromManifest(manifest, outputPath) {
  const accent = manifest.colors?.accent || '#4a90d9';
  const secondary = manifest.colors?.secondary || accent;
  const bg = manifest.colors?.background || '#1e1e2e';

  const W = 128;
  const H = 128;
  const channels = 4;
  const buffer = Buffer.alloc(W * H * channels);

  // 解析颜色
  const parseHex = (hex) => {
    const m = /^#([0-9a-f]{6})/i.exec(hex);
    if (m) {
      return [
        parseInt(m[1].slice(0, 2), 16),
        parseInt(m[1].slice(2, 4), 16),
        parseInt(m[1].slice(4, 6), 16),
      ];
    }
    return [0x4a, 0x90, 0xd9];
  };

  const [br, bg_, bb] = parseHex(bg);
  const [ar, ag, ab] = parseHex(accent);
  const [sr, sg, sb] = parseHex(secondary);

  const radius = 28;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * channels;

      // 圆角矩形
      const dx = Math.min(x, W - 1 - x);
      const dy = Math.min(y, H - 1 - y);
      const corner = Math.min(dx, dy);

      if (corner < 6) {
        // 圆角外部 — 透明
        buffer[idx + 3] = 0;
        continue;
      }

      if (corner < radius) {
        // 圆角渐变
        const edge = radius - corner;
        if (edge > 4) {
          buffer[idx + 3] = 0;
          continue;
        }
      }

      // 背景到 accent 的对角线渐变
      const t = (x + y) / (W + H);
      const r = Math.round(br + (ar - br) * t);
      const g = Math.round(bg_ + (ag - bg_) * t);
      const b = Math.round(bb + (ab - bb) * t);

      // 添加 accent 色的装饰条
      const inBar = y > H * 0.6 && x > W * 0.2 && x < W * 0.8;
      if (inBar) {
        buffer[idx] = ar;
        buffer[idx + 1] = ag;
        buffer[idx + 2] = ab;
      } else {
        buffer[idx] = r;
        buffer[idx + 1] = g;
        buffer[idx + 2] = b;
      }
      buffer[idx + 3] = 255;
    }
  }

  await sharp(buffer, {
    raw: { width: W, height: H, channels: 4 },
  })
    .png()
    .toFile(outputPath);
}

async function processTheme(id) {
  const themeDir = path.join(THEMES_DIR, id);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn(`[generate-artwork] ${id}: no manifest, skipping`);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // --- Hero ---
  const heroPath = path.join(themeDir, 'hero.webp');
  const heroSource = HERO_SOURCES[id];

  if (id === 'nord-focus') {
    // Nord 没有原始图片素材 — 从色板生成抽象 hero
    if (!fs.existsSync(heroPath)) {
      console.log(`[generate-artwork] ${id}: generating nord hero from palette...`);
      await generateNordHero(heroPath);
    } else {
      console.log(`[generate-artwork] ${id}: hero already exists, skipping`);
    }
  } else if (heroSource && fs.existsSync(heroSource)) {
    if (path.resolve(heroSource) === path.resolve(heroPath)) {
      console.log(`[generate-artwork] ${id}: hero is source file already`);
    } else if (!fs.existsSync(heroPath)) {
      console.log(`[generate-artwork] ${id}: creating hero from ${path.basename(heroSource)}...`);
      await sharp(heroSource)
        .resize(1920, 1080, { fit: 'cover', position: 'center' })
        .webp({ quality: 85 })
        .toFile(heroPath);
    } else {
      console.log(`[generate-artwork} ${id}: hero already exists, skipping`);
    }
  } else {
    console.warn(`[generate-artwork] ${id}: no hero source available, skipping`);
  }

  // --- Preview (1280×720) ---
  // Preview 从 hero 派生，但必须是不同文件
  const previewPath = path.join(themeDir, 'preview.png');
  const heroForPreview = fs.existsSync(heroPath)
    ? heroPath
    : heroSource && fs.existsSync(heroSource)
      ? heroSource
      : null;

  if (heroForPreview && !fs.existsSync(previewPath)) {
    console.log(`[generate-artwork] ${id}: generating preview from hero...`);
    await sharp(heroForPreview)
      .resize(1280, 720, { fit: 'cover', position: 'center' })
      .png()
      .toFile(previewPath);
  } else if (fs.existsSync(previewPath)) {
    console.log(`[generate-artwork] ${id}: preview already exists, skipping`);
  } else {
    console.warn(`[generate-artwork] ${id}: cannot generate preview (no source)`);
  }

  // --- Icon ---
  const iconPath = path.join(themeDir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    console.log(`[generate-artwork] ${id}: generating icon from palette...`);
    await generateIconFromManifest(manifest, iconPath);
  } else {
    const stat = fs.statSync(iconPath);
    if (stat.size < 200) {
      console.log(`[generate-artwork] ${id}: replacing placeholder icon...`);
      await generateIconFromManifest(manifest, iconPath);
    } else {
      console.log(`[generate-artwork] ${id}: icon exists (${stat.size}B), skipping`);
    }
  }
}

const THEMES_TO_PROCESS = ['tokyo-night', 'catppuccin', 'dracula', 'nord-focus'];

for (const id of THEMES_TO_PROCESS) {
  try {
    await processTheme(id);
  } catch (error) {
    console.error(`[generate-artwork] ${id}: ERROR - ${error.message}`);
  }
}

console.log('\nDone. Verify with:');
console.log('  node scripts/normalize-hero-images.mjs');
console.log('  node scripts/update-theme-manifests.mjs');
console.log('  node scripts/check-themes.mjs');
