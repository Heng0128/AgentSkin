// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/unified-background
 *
 * 统一背景协调器（RFC 2026-08-18 §4.3，P3）。
 *
 * ## 问题
 *
 * 当应用把界面拆成多个独立渲染表面（vscode-work 系的多个 webview/BrowserView、
 * doubao 的 boot 页 + 主窗口、WorkBuddy 的多 target），壁纸注入器为每个表面
 * 各自铺一份「position:fixed;inset:0」的全视口背景。每个表面有独立的视口坐标
 * 系，背景图在表面接缝处会错位/不连续。
 *
 * ## 方案
 *
 * 背景本体只在「主坐标系」上铺一次（主 renderer，沿用现有 full-bleed 注入，
 * 含 scrim/guard/parallax）。每个 secondary 表面注入一份轻量 **continuation**
 * 图层（{@link WALLPAPER_CONTINUATION_ID}）：不重复挂 scrim/guard，只把与主
 * 表面相同的媒体「搬到」主表面的宿主窗口矩形位置，使共享图在整个窗口内连续。
 * 偏移由**宿主窗口矩形**（非 CDP 文档内 rect）计算——跨文档无法直接比较各自的
 * getBoundingClientRect，必须由调用方提供每个表面相对宿主窗口的边界
 * （{@link WallpaperInjectorDeps.resolveSurfaceRects}）。偏移来源缺失时回退为
 * 各自独立铺满（现状），符合 RFC R3 兜底。
 *
 * ## 边界
 *
 * - 单 renderer 应用不进入共享路径（{@link computeUnifiedPlan} 返回 disabled）。
 * - 仅图片壁纸且具备共享 URL 时启用 continuation（视频/web 的 secondary 维持
 *   现状 full-bleed——视频无法用 CSS background 静态 continuation）。
 * - 挂载/移除表达式为纯函数，可独立单测。
 *
 * 依赖：仅 type 依赖 `injector-types`（`SurfaceRect`/`ResolveSurfaceRects`），
 * 运行时无循环依赖。
 */

import { WALLPAPER_CONTINUATION_ID } from '../../shared/injection-constants';
import { computeContinuationLayout, type SurfaceRect } from '../../shared/surface-rect';
import type { WallpaperRenderOptions } from '../../shared/types';
import type { CdpTarget } from '../cdp/cdp-targets';
import { buildMediaElementCss } from '../cdp/wallpaper/css-render';

// ---------------------------------------------------------------------------
// Plan — multi-surface detection
// ---------------------------------------------------------------------------

/** 统一背景编排结果：主表面 + 一系列 continuation 表面。 */
export interface UnifiedPlan<T = CdpTarget> {
  /** 是否进入共享路径（≥2 个技能连接的表面）。false = 退化为现状。 */
  enabled: boolean;
  /** 主 renderer（承载真实整窗背景，params 里 index 0）。 */
  primary: T | undefined;
  /** 需要 continuation 的副表面（index 1..n）。 */
  secondaries: T[];
}

/**
 * 纯函数：给定有序目标集（主在前，来自 resolvePageTargets），判定是否进入
 * 统一背景共享路径。单目标/空集 → disabled（不变更现状行为）。
 */
export function computeUnifiedPlan<T>(targets: readonly T[]): UnifiedPlan<T> {
  const [primary, ...secondaries] = targets;
  if (!primary) return { enabled: false, primary: undefined, secondaries: [] };
  return { enabled: secondaries.length > 0, primary, secondaries };
}

// ---------------------------------------------------------------------------
// Offset math — host-window coordinate deltas
// (computeContinuationLayout 迁移至 src/shared/surface-rect，此处 re-export 保持
//  既有调用方 `unified-background` 的 import 兼容)
// ---------------------------------------------------------------------------

export { computeContinuationLayout };

// ---------------------------------------------------------------------------
// Mount / remove expressions (pure, unit-testable)
// ---------------------------------------------------------------------------

export interface ContinuationMountOptions {
  /** 与主表面共享的背景图片源（http URL 或 data: URL）。 */
  src: string;
  /** 主表面容器的宿主窗口矩形。 */
  primaryRect: SurfaceRect;
  /** 当前副表面的宿主窗口矩形。 */
  secondaryRect: SurfaceRect;
  /** 渲染设置（对齐/位置/滤镜），与主表面的 buildMediaElementCss 一致以对齐裁切。 */
  render?: WallpaperRenderOptions;
}

/**
 * 构建在副表面挂载 continuation 图层的表达式（IIFE，CDP evaluate 使用）。
 * 复制主表面的媒体元素，用 computed layout 重定位到主容器位置；自带媒体同源
 * 与同 object-fit，因此图在副视口内显示的就是「主背景图在此窗口坐标上的切面」。
 * 不挂 scrim/guard——那些只在主表面存在，避免重复叠暗。
 */
export function buildContinuationMountJs(opts: ContinuationMountOptions): string {
  const layout = computeContinuationLayout(opts.primaryRect, opts.secondaryRect);
  const mediaCss = buildMediaElementCss(opts.render);
  return `(async () => {
    try {
      var prev = document.getElementById('${WALLPAPER_CONTINUATION_ID}');
      if (prev) prev.remove();
      var cont = document.createElement('div');
      cont.id = '${WALLPAPER_CONTINUATION_ID}';
      cont.setAttribute('aria-hidden', 'true');
      cont.style.cssText =
        'position:fixed!important;' +
        'left:${layout.left}px!important;' +
        'top:${layout.top}px!important;' +
        'width:${layout.width}px!important;' +
        'height:${layout.height}px!important;' +
        'z-index:-2!important;pointer-events:none!important;overflow:hidden!important;';
      var img = document.createElement('img');
      img.src = ${JSON.stringify(opts.src)};
      img.style.cssText = ${JSON.stringify(mediaCss)};
      cont.appendChild(img);
      document.documentElement.prepend(cont);
      img.style.setProperty('opacity', '1', 'important');
      return 'ok';
    } catch (e) { return 'err:' + e.message; }
  })()`;
}

/** 移除副表面上的 continuation 图层（幂等）。 */
export function buildContinuationRemoveJs(): string {
  return `(() => {
    var el = document.getElementById('${WALLPAPER_CONTINUATION_ID}');
    if (el) el.remove();
    return 'removed';
  })()`;
}

// ---------------------------------------------------------------------------
// CDP rect reader — 迁移至 src/main/cdp/surface-rect.ts
// (readSurfaceRect 依赖 CdpSession，归属 cdp 层；此处 re-export 保持既有
//  调用方经 `unified-background` import 的兼容)
// ---------------------------------------------------------------------------

export { readSurfaceRect } from '../cdp/surface-rect';
