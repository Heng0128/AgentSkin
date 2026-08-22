// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper render CSS helpers (renderer-side)
 *
 * The desktop UI background (`dynamic-background.tsx`) applies the same
 * alignment / position / flip / filter / speed semantics as the CDP wallpaper
 * injectors, so "同一个壁纸在桌面 UI 和 agent 窗口效果一致".
 *
 * These pure functions mirror the canonical mappings in
 * `src/main/cdp/wallpaper/shared.ts` (alignmentObjectFit, buildObjectPosition,
 * buildFlipTransform, buildFilter, buildTintFilter, hexHue). The renderer must
 * NOT import from `src/main/` — both the main-process injectors and this UI
 * helper derive from the same WE spec, and their outputs are kept identical.
 */

import type { CSSProperties } from 'react';

import type { WallpaperRenderOptions } from '@shared/types';

/**
 * 对齐方式 → object-fit 映射（对齐 Wallpaper Engine 渲染面板）：
 *   stretch → fill（拉伸填满，可能变形）
 *   fit     → contain（完整显示，留边）
 *   fill    → cover（裁剪铺满 —— 默认，与历史行为一致）
 *   center  → none（原尺寸居中，溢出裁切）
 *   tile    → none（平铺交给 CSS background-repeat，这里按 cover 兜底）
 */
export function alignmentObjectFit(
  alignment: WallpaperRenderOptions['alignment'],
): NonNullable<CSSProperties['objectFit']> {
  switch (alignment) {
    case 'stretch':
      return 'fill';
    case 'fit':
      return 'contain';
    case 'center':
      return 'none';
    case 'tile':
      return 'none';
    default:
      return 'cover';
  }
}

/** 位置偏移 → object-position（默认 0 时 = 50% 50% 居中，与历史一致）。 */
export function buildObjectPosition(render: WallpaperRenderOptions): string {
  const x = render.positionX ?? 0;
  const y = render.positionY ?? 0;
  return `calc(50% + ${x}%) calc(50% + ${y}%)`;
}

/** 翻转 → transform（挂媒体元素自身）。 */
export function buildFlipTransform(render: WallpaperRenderOptions): string {
  const sx = render.flipH ? -1 : 1;
  const sy = render.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return '';
  return `scaleX(${sx}) scaleY(${sy})`;
}

/** 解析 hex 色的色相角（0-360），用于 tint 的 hue-rotate。非法值 → 0。 */
export function hexHue(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 0xff) / 255;
  const g = ((n >> 8) & 0xff) / 255;
  const b = (n & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  let h: number;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const deg = h * 60;
  return deg < 0 ? deg + 360 : deg;
}

/** 主题配色 tint → filter 片段（sepia 全色 + 高饱和 + 色相旋转到目标色相）。 */
export function buildTintFilter(tint: string): string {
  const hue = hexHue(tint);
  return `sepia(1) saturate(2.5) hue-rotate(${Math.round(hue)}deg)`;
}

/**
 * 滤镜 → filter 字符串。全部缺省或为中性值时返回 ''（无滤镜，与历史一致）。
 */
export function buildFilter(render: WallpaperRenderOptions): string {
  const parts: string[] = [];
  if (render.brightness !== undefined && render.brightness !== 100)
    parts.push(`brightness(${(render.brightness / 100).toFixed(2)})`);
  if (render.contrast !== undefined && render.contrast !== 100)
    parts.push(`contrast(${(render.contrast / 100).toFixed(2)})`);
  if (render.saturation !== undefined && render.saturation !== 100)
    parts.push(`saturate(${(render.saturation / 100).toFixed(2)})`);
  if (render.hueRotate !== undefined && render.hueRotate !== 0)
    parts.push(`hue-rotate(${render.hueRotate}deg)`);
  if (render.sepia !== undefined && render.sepia > 0)
    parts.push(`sepia(${(render.sepia / 100).toFixed(2)})`);
  if (render.grayscale !== undefined && render.grayscale > 0)
    parts.push(`grayscale(${(render.grayscale / 100).toFixed(2)})`);
  if (render.blur !== undefined && render.blur > 0) parts.push(`blur(${render.blur}px)`);
  if (render.tint) parts.push(buildTintFilter(render.tint));
  return parts.length ? parts.join(' ') : '';
}

/**
 * 组装媒体元素（img/video）的 React style：object-position + （stretch/fit/
 * center 时的）object-fit + 翻转 + 滤镜。
 *   - object-position 始终写入（默认 0 = 50% 50% 居中，与 CDP 注入器一致）。
 *   - object-fit 仅在对齐为 stretch/fit/center 时显式写入；fill（默认）与
 *     tile 由 className 的 object-cover 兜底 / 容器平铺路径处理。
 *   - 无翻转/滤镜时不写 transform/filter（默认即无，与历史一致）。
 */
export function buildMediaElementStyle(render: WallpaperRenderOptions | undefined): CSSProperties {
  const r = render ?? {};
  const style: CSSProperties = {
    objectPosition: buildObjectPosition(r),
  };
  const alignment = r.alignment;
  if (alignment === 'stretch' || alignment === 'fit' || alignment === 'center') {
    style.objectFit = alignmentObjectFit(alignment);
  }
  const flip = buildFlipTransform(r);
  const filter = buildFilter(r);
  if (flip) style.transform = flip;
  if (filter) style.filter = filter;
  return style;
}

/** iframe 元素的翻转/滤镜 style（web/scene 渲染器外框；filter 同时上翻转移位修正）。 */
export function buildIframeElementStyle(render: WallpaperRenderOptions | undefined): CSSProperties {
  const r = render ?? {};
  const style: CSSProperties = {};
  const flip = buildFlipTransform(r);
  const filter = buildFilter(r);
  // 滤镜会随自身 transform 平移 —— 加 translateZ(0) 固定像素对齐。
  if (flip || filter) style.transform = `${flip} translateZ(0)`;
  if (filter) style.filter = filter;
  return style;
}
