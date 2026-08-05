// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper-theme — 壁纸取色 → 主题工程（pywal 式联动）
 *
 * 从壁纸预览图提取主色，生成一份可直接安装进 ThemeLibrary 的
 * `.agentskin-theme` 目录包（manifest + 6 agent CSS + icon/preview）。
 *
 * 分工：
 *   - 像素采样（本模块）：`nativeImage` 解码 + 降采样 → 去重加权颜色样本。
 *     纯函数 `sampleFromBitmap` 供 vitest 直接喂合成像素。
 *   - 主题派生：复用 `theme-from-image.ts` 的 `deriveThemeFromImage`（纯 TS）。
 *   - 6 agent CSS：动态 import `scripts/theme-generators.mjs` 的纯生成函数
 *     （与 `generate-theme-css.mjs` 同一来源，保证一致性）。
 *
 * 产物写到 `<userData>/wallpaper-themes/<id>/`（独立于内置 themes/，
 * seeder 不扫描），随后由调用方经 ThemePackageLoader + ThemeInstaller
 * 安装进 userData/themes 持久化，即可通过正常主题 apply 链路使用。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
// 静态 import：electron-vite build 会把 scripts/theme-generators.mjs 打进
// out/main/index.js（动态 import 变量 URL 不会被 rollup 处理，打包后
// scripts/ 不在 asar 会导致运行时 import 失败）。生成器是纯函数、无 I/O。
import { buildContext, GENERATORS } from '../../../scripts/theme-generators.mjs';
import { toMessage } from '../../shared/errors';
import { deriveThemeFromImage, type ImagePixelSample } from './theme-from-image';

/** 降采样目标：最长边像素数（median-cut 的输入规模，够聚类、快）。 */
const SAMPLE_MAX_EDGE = 48;

// ---------------------------------------------------------------------------
// 像素采样（纯逻辑，可单测）
// ---------------------------------------------------------------------------

export interface SampledColor {
  r: number;
  g: number;
  b: number;
  weight: number;
}

/**
 * 把 BGRA 位图降采样为去重加权颜色样本。`bgra` 为 `width*height*4` 字节
 * （nativeImage.toBitmap() 的输出格式，小端 BGRA）。跳过 alpha≈0 像素；
 * 颜色按 4bit/通道量化后合并（`r>>4,g>>4,b>>4`），weight = 出现次数。
 * 纯函数——不依赖 Electron，vitest 可直接测。
 */
export function sampleFromBitmap(width: number, height: number, bgra: Uint8Array): SampledColor[] {
  const buckets = new Map<string, SampledColor>();
  const stride = 4;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    // BGRA：b,g,r,a（小端）。alpha < 8 视同全透明（跳过）。
    const a = bgra[o + 3] ?? 0;
    if (a < 8) continue;
    const r = bgra[o + 2] ?? 0;
    const g = bgra[o + 1] ?? 0;
    const b = bgra[o] ?? 0;
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.weight += 1;
      // 累积真实均值通道（解量化时用累计值，不直接舍入到 16 级）。
      bucket.r += r;
      bucket.g += g;
      bucket.b += b;
    } else {
      buckets.set(key, { r, g, b, weight: 1 });
    }
  }
  // 把累积和转回均值；量化 key 已含 4bit 信息，均值还原近似真实色。
  return [...buckets.values()].map((c) => ({
    r: Math.round(c.r / c.weight),
    g: Math.round(c.g / c.weight),
    b: Math.round(c.b / c.weight),
    weight: c.weight,
  }));
}

/**
 * 解码图片文件 → 降采样颜色样本。失败（非图片 / 解码空）返回 null。
 * 使用 Electron nativeImage（主进程唯一可用解码器，不经 CSP/CORS）。
 */
export function sampleFromImagePath(filePath: string): ImagePixelSample | null {
  const image = nativeImage.createFromPath(filePath);
  if (image.isEmpty()) return null;
  const size = image.getSize();
  if (!size || size.width <= 0 || size.height <= 0) return null;
  // 等比例缩到最长边 SAMPLE_MAX_EDGE。
  const scale = Math.min(1, SAMPLE_MAX_EDGE / Math.max(size.width, size.height));
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const resized = image.resize({ width, height });
  if (resized.isEmpty()) return null;
  const bitmap = resized.toBitmap(); // BGRA
  const colors = sampleFromBitmap(width, height, new Uint8Array(bitmap));
  return { colors, width, height };
}

// ---------------------------------------------------------------------------
// 主题工程构建
// ---------------------------------------------------------------------------

/** 构建壁纸主题工程所需的全部输入。 */
export interface BuildWallpaperThemeInput {
  /** 壁纸库条目 id（用于生成稳定主题 id，避免每次重装新 id）。 */
  wallpaperId: string;
  /** 壁纸显示标题（进主题 displayName）。 */
  title: string;
  /** 预览图绝对路径（image 壁纸即媒体本身）。 */
  previewPath: string;
  /** 输出根目录（<userData>/wallpaper-themes）。 */
  outRoot: string;
  /** 壁纸视频绝对路径（视频壁纸时提供）。存在时视频被拷入主题包并声明
   *  `theme.wallpaper.video`，使主题自带壁纸（apply 时自动注入，无需
   *  渲染层重应用壁纸）。 */
  videoPath?: string;
}

export interface BuiltWallpaperTheme {
  themeId: string;
  /** 生成的目录包根路径。 */
  packagePath: string;
  /** 派生的 mode（dark/light）。 */
  mode: 'dark' | 'light';
}

/** 把任意字符串压成 safe theme id（字母数字 + 连字符，首字符字母数字）。 */
function slugify(input: string): string {
  const slug =
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'theme';
  return slug.slice(0, 40);
}

/** 主色 icon（128×128 纯色圆角方块）。nativeImage 从 buffer 构造。 */
function buildIconPng(r: number, g: number, b: number): Buffer {
  // 预乘 BGRA 像素：圆角 20px 方块，其余透明。
  const size = 128;
  const radius = 20;
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 圆角判断：四个角的 1/4 圆外 → 透明。
      const dx = Math.min(x, size - 1 - x);
      const dy = Math.min(y, size - 1 - y);
      const inCorner = dx < radius && dy < radius;
      const inRadius = inCorner ? (radius - dx) ** 2 + (radius - dy) ** 2 <= radius * radius : true;
      if (!inRadius) continue;
      const o = (y * size + x) * 4;
      px[o] = b; // B
      px[o + 1] = g; // G
      px[o + 2] = r; // R
      px[o + 3] = 255; // A
    }
  }
  return nativeImage.createFromBuffer(px, { width: size, height: size }).toPNG();
}

/** 主色占位 preview（480×300 纯色渐变占位，仅当预览图复制失败时）。 */
function buildPreviewPng(r: number, g: number, b: number): Buffer {
  const width = 480;
  const height = 300;
  const px = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const rr = Math.round(r * (1 - t) + Math.max(0, r - 40) * t);
    const gg = Math.round(g * (1 - t) + Math.max(0, g - 40) * t);
    const bb = Math.round(b * (1 - t) + Math.max(0, b - 40) * t);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      px[o] = bb;
      px[o + 1] = gg;
      px[o + 2] = rr;
      px[o + 3] = 255;
    }
  }
  return nativeImage.createFromBuffer(px, { width, height }).toPNG();
}

const AGENT_IDS = Object.keys(GENERATORS);

/**
 * 构建壁纸主题目录包并落盘。返回主题 id + 包路径；CSS 生成失败时抛错。
 *
 * 流程：采样 → deriveThemeFromImage → 6 agent CSS（theme-generators）→
 * manifest + icon/preview + assets/css/*.css 写入 outRoot/<themeId>/。
 */
export async function buildWallpaperTheme(
  input: BuildWallpaperThemeInput,
): Promise<BuiltWallpaperTheme> {
  const sample = sampleFromImagePath(input.previewPath);
  if (!sample || sample.colors.length === 0) {
    throw new Error(`无法从壁纸「${input.title}」解码出颜色`);
  }
  const derived = deriveThemeFromImage(sample);

  // 6 agent CSS：与 generate-theme-css.mjs 同一来源（静态 import 的纯模块）。
  const ctx = buildContext('wallpaper-theme', {
    displayName: `壁纸·${input.title}`,
    mode: derived.mode,
    colors: derived,
  });

  // 稳定 id：`wallpaper-<slug>`，同一壁纸重复取色覆盖式重装。
  const themeId = `wallpaper-${slugify(input.wallpaperId)}`;
  const packagePath = path.join(input.outRoot, themeId);
  const cssDir = path.join(packagePath, 'assets', 'css');
  await fs.mkdir(cssDir, { recursive: true });

  for (const agent of AGENT_IDS) {
    const generate = GENERATORS[agent as keyof typeof GENERATORS];
    if (!generate) continue;
    const css = generate(ctx);
    await fs.writeFile(path.join(cssDir, `${agent}.css`), css, 'utf8');
  }

  // icon / preview：preview 优先复制壁纸预览图（失败则纯色占位）。
  const accent = derived.accent.replace('#', '');
  const accentRgb = {
    r: parseInt(accent.slice(0, 2), 16) || 136,
    g: parseInt(accent.slice(2, 4), 16) || 136,
    b: parseInt(accent.slice(4, 6), 16) || 255,
  };
  await fs.writeFile(
    path.join(packagePath, 'icon.png'),
    buildIconPng(accentRgb.r, accentRgb.g, accentRgb.b),
  );
  try {
    await fs.copyFile(input.previewPath, path.join(packagePath, 'preview.png'));
  } catch {
    await fs.writeFile(
      path.join(packagePath, 'preview.png'),
      buildPreviewPng(accentRgb.r, accentRgb.g, accentRgb.b),
    );
  }

  // 视频壁纸：把视频拷入 wallpaper/ 并声明 theme.wallpaper.video，使主题
  // 自带壁纸（apply 时经 theme-apply-flow 自动注入 theme:<id>）。
  let wallpaper: Record<string, string> | undefined;
  if (input.videoPath) {
    const ext = path.extname(input.videoPath).toLowerCase() || '.mp4';
    const videoRel = `wallpaper/video${ext}`;
    await fs.mkdir(path.join(packagePath, 'wallpaper'), { recursive: true });
    try {
      await fs.copyFile(input.videoPath, path.join(packagePath, videoRel));
      wallpaper = { video: videoRel, poster: 'preview.png' };
    } catch {
      // 视频拷贝失败 → 不声明 wallpaper，主题退化为纯色版（壁纸由渲染层
      // "重应用"绕行恢复）。
      wallpaper = undefined;
    }
  }

  const manifest = {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    id: themeId,
    name: `壁纸·${input.title}`,
    displayName: `壁纸·${input.title}`,
    version: '1.0.0',
    description: `由壁纸「${input.title}」自动取色生成（AgentSkin 壁纸联动）。`,
    author: { name: 'AgentSkin Wallpaper' },
    mode: derived.mode,
    category: 'art',
    tags: ['wallpaper', 'auto'],
    unofficial: true,
    icon: 'icon.png',
    preview: 'preview.png',
    targets: Object.fromEntries(
      AGENT_IDS.map((agent) => [agent, { css: `assets/css/${agent}.css` }]),
    ),
    colors: derived,
    ...(wallpaper ? { wallpaper } : {}),
  };
  await fs.writeFile(
    path.join(packagePath, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  return { themeId, packagePath, mode: derived.mode };
}

/** 清理壁纸主题目录包（重建时先删旧目录，避免残留旧 agent CSS）。 */
export async function removeWallpaperTheme(outRoot: string, themeId: string): Promise<void> {
  try {
    await fs.rm(path.join(outRoot, themeId), { recursive: true, force: true });
  } catch (error) {
    // 删除失败仅警告，buildWallpaperTheme 会以递归 mkdir 覆盖。
    console.warn(`[wallpaper-theme] cleanup failed for ${themeId}: ${toMessage(error)}`);
  }
}
