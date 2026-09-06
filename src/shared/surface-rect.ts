// SPDX-License-Identifier: MPL-2.0

/**
 * # shared/surface-rect
 *
 * 宿主窗口坐标系下的表面矩形模型与纯几何定位数学（RFC 2b §1/§2.2）。
 *
 * 壁纸统一背景（`unified-background`）与主题装饰 overlay（2b）共用同一套
 * 宿主坐标模型：所有 CDP target 落在宿主窗口的坐标（`x/y/width/height` 像素），
 * 跨文档不得直接比较各自的 `getBoundingClientRect`（每个 surface 有独立视口
 * 坐标系），必须换算到宿主坐标。
 *
 * ## 分层归属（C4）
 *
 * 本模块**仅**含纯类型与纯几何函数，运行时零依赖（除自身）。因此可安全被
 * `src/main/`（壁纸层、cdp 注入层）import，符合 `shared → *` 依赖方向。
 * CDP 读取 rect 的能力（依赖 `CdpSession`）不在本模块——见
 * `src/main/cdp/surface-rect.ts`。
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 宿主窗口坐标系下的表面矩形（统一背景偏移来源 / 主题装饰锚点，RFC §2.2）。 */
export interface SurfaceRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// 壁纸 continuation 偏移数学（迁移自 wallpaper/unified-background §4.3）
// ---------------------------------------------------------------------------

/**
 * 纯函数：计算副表面上 continuation 图层的摆放矩形。
 *
 * 主表面的 full-bleed 容器占据宿主窗口的 `[primaryRect.x, primaryRect.y,
 * +width, +height]`。从副表面的坐标系看（其原点=宿主坐标 `secondaryRect.x/y`），
 * 主容器出现在 `(primaryRect.x - secondaryRect.x, primaryRect.y - secondaryRect.y)`。
 * 把尺寸按主容器等宽等高放置，两者同源、同 object-fit，即可让共享图在接缝处连续。
 */
export function computeContinuationLayout(
  primaryRect: SurfaceRect,
  secondaryRect: SurfaceRect,
): { left: number; top: number; width: number; height: number } {
  return {
    left: primaryRect.x - secondaryRect.x,
    top: primaryRect.y - secondaryRect.y,
    width: primaryRect.width,
    height: primaryRect.height,
  };
}

// ---------------------------------------------------------------------------
// 锚点面布局数学（2b decorations.layouts）
// ---------------------------------------------------------------------------

/**
 * 锚点面内的五宫格位置：水平 × 竖直 对齐。缺省 b 语义为「右下」（贴合绝大多数
 * 装饰素材直觉，RFC 2b §2.2 示例）。
 */
export type AnchorPositionVertical = 'top' | 'center' | 'bottom';
export type AnchorPositionHorizontal = 'left' | 'center' | 'right';
export type AnchorPosition = `${AnchorPositionVertical}${Capitalize<AnchorPositionHorizontal>}`;

/** 横向对齐 → 用于确定 overlay 左边界相对锚点面的算法选择。 */
type AnchorHorizontalKind =
  | { kind: 'edge'; fromGap: number } // left/right：贴边，gap 为锚点边界到 overlay 边界的间距
  | { kind: 'center' };

/**
 * 计算一个 overlay 在锚点面 rect 内的摆放矩形（宿主坐标）。`anchor` 为锚点元素
 * 的宿主坐标矩形；`position` 为五宫格对齐；`offset` 为相对锚点位置的像素偏移
 * （`x` 沿右为正，`y` 沿下为正）；`size` 决定 overlay 尺寸（`width`/`height` 为
 * `null` 时表示 auto，CSS 侧回退为内容/等比分自适应）。
 *
 * 返回 `{ left, top, width, height }`，其中 `width`/`height` 可能为 `null`（auto）。
 */
export function computeAnchorLayout(opts: {
  anchor: SurfaceRect;
  position?: AnchorPosition;
  offset?: { x?: number; y?: number };
  size?: { width?: number | null; height?: number | null };
}): { left: number; top: number; width: number | null; height: number | null } {
  const position: AnchorPosition = opts.position ?? 'bottomRight';
  const offsetX = opts.offset?.x ?? 0;
  const offsetY = opts.offset?.y ?? 0;
  const width = opts.size?.width ?? null;
  const height = opts.size?.height ?? null;

  // 竖直：top=锚点顶、bottom=锚点底、center=锚点中心
  const top = position.startsWith('top')
    ? opts.anchor.y + offsetY
    : position.startsWith('bottom')
      ? opts.anchor.y + opts.anchor.height + offsetY
      : opts.anchor.y + opts.anchor.height / 2 + offsetY;

  // 横向：left=锚点左、right=锚点右、center=锚点中心
  const horizontal: AnchorHorizontalKind = position.endsWith('Left')
    ? { kind: 'edge', fromGap: -1 } // 以左边界为对齐点
    : position.endsWith('Right')
      ? { kind: 'edge', fromGap: 1 } // 以右边界为对齐点
      : { kind: 'center' };

  // 只对无 auto 尺寸的轴做「贴边」，避免 auto（null）下 left 语义歧义：
  // - 横向 edge：left = 锚点边界 + offsetX（右边界时以宽度折算）
  // - 横向 center：left = 锚点中心 + offsetX（减去半宽）
  let left: number;
  if (horizontal.kind === 'edge') {
    if (position.endsWith('Left')) {
      left = opts.anchor.x + offsetX;
    } else {
      const w = width ?? 0;
      left = opts.anchor.x + opts.anchor.width + offsetX - w;
    }
  } else {
    const w = width ?? 0;
    left = opts.anchor.x + opts.anchor.width / 2 + offsetX - w / 2;
  }

  return { left, top, width, height };
}
