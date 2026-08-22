// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/css-render
 *
 * CSS rendering helpers for wallpaper media elements. Builds the cssText
 * and tile-container styles used by video and image wallpaper injectors.
 *
 * Extracted from the split of {@link ./shared}.
 */

import type { WallpaperRenderOptions } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Render-option → CSS mapping (alignment / position / flip / filters)
// ---------------------------------------------------------------------------

/**
 * 对齐方式 → object-fit 映射（对齐 Wallpaper Engine 渲染面板）：
 *   stretch → fill（拉伸填满，可能变形）
 *   fit     → contain（完整显示，留边）
 *   fill    → cover（裁剪铺满 —— 默认，与历史行为一致）
 *   center  → none（原尺寸居中，溢出裁切）
 *   tile    → none（交给容器 background-repeat 平铺，见 buildTileContainerCss）
 */
export function alignmentObjectFit(alignment: WallpaperRenderOptions['alignment']): string {
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

/** 翻转 → transform（挂媒体元素自身；与容器的视差 transform 互不冲突）。 */
export function buildFlipTransform(render: WallpaperRenderOptions): string {
  const sx = render.flipH ? -1 : 1;
  const sy = render.flipV ? -1 : 1;
  if (sx === 1 && sy === 1) return '';
  return `scaleX(${sx}) scaleY(${sy})`;
}

/**
 * 滤镜 → filter（挂媒体元素自身，绝不挂 agent 壳 —— 壳的 filter 会被
 * WALLPAPER_TRANSPARENCY_CSS 的 filter:none 清除）。tint 用 sepia+saturate+
 * hue-rotate 组合近似主题色着色。默认全部缺省时返回 ''（无滤镜）。
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

/** 主题配色 tint → filter 片段（sepia 全色 + 高饱和 + 色相旋转到目标色相）。 */
export function buildTintFilter(tint: string): string {
  const hue = hexHue(tint);
  return `sepia(1) saturate(2.5) hue-rotate(${Math.round(hue)}deg)`;
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

/**
 * 构建媒体元素（img/video）的完整 style cssText，参数化对齐/位置/翻转/滤镜。
 * 默认（无 render）输出与历史完全一致的 CSS：object-fit:cover、居中、
 * 无 transform、无 filter。
 */
export function buildMediaElementCss(render: WallpaperRenderOptions | undefined): string {
  const r = render ?? {};
  const fit = alignmentObjectFit(r.alignment);
  const objectPosition = buildObjectPosition(r);
  const flip = buildFlipTransform(r);
  const filter = buildFilter(r);
  return (
    'position:absolute!important;inset:0!important;width:100%!important;height:100%!important;' +
    `object-fit:${fit}!important;` +
    `object-position:${objectPosition}!important;` +
    'pointer-events:none!important;opacity:0;transition:opacity 0.3s ease;' +
    (flip ? `transform:${flip}!important;` : '') +
    (filter ? `filter:${filter}!important;` : '')
  );
}

/**
 * tile 平铺模式（仅图片）：把 src 设到容器 background-repeat，隐藏媒体元素。
 * 返回 { containerBackground, hideElement }。
 */
export function buildTileContainerCss(
  src: string,
  render: WallpaperRenderOptions,
): { containerBackground: string; hideElement: boolean } {
  const x = render.positionX ?? 0;
  const y = render.positionY ?? 0;
  const background = `url("${src}") ${x}% ${y}% / auto repeat`;
  return { containerBackground: background, hideElement: true };
}
