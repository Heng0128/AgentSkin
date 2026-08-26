// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp/surface-rect
 *
 * 宿主坐标几何的 CDP 读取能力（迁移自 `wallpaper/unified-background`）。
 *
 * 依赖 `CdpSession`，因此归属 cdp 层（`src/main/cdp/`），被壁纸层与主题装饰
 * 注入层共用；纯类型与几何数学见 `src/shared/surface-rect`（C4：main → shared）。
 *
 * 注意返回值是**该页面文档内坐标**——跨 surface 不可直接比较，主 surface 之外
 * 的宿主坐标务必用宿主窗口矩形（`ResolveSurfaceRects`），而非 CDP rect。
 */

import type { SurfaceRect } from '../../shared/surface-rect';
import type { CdpSession } from './cdp-client';

/**
 * 经 CDP 读取某个页面内元素的 getBoundingClientRect。返回的是该页面文档内坐标
 * ——跨表面不可直接比较，仅作尺寸兜底/诊断。host 相对坐标务必用
 * 宿主窗口矩形（`resolveSurfaceRects`）。
 */
export async function readSurfaceRect(
  session: CdpSession,
  selector: string,
): Promise<SurfaceRect | null> {
  try {
    const raw = await session.evaluate(`(() => {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var r = el.getBoundingClientRect();
      return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
    })()`);
    if (!raw) return null;
    // TODO: type-guard — 待渐进式加固
    const parsed = JSON.parse(raw) as SurfaceRect | null;
    if (!parsed || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.width)) return null;
    return parsed;
  } catch {
    return null;
  }
}
