// SPDX-License-Identifier: MPL-2.0

/**
 * # fallback-image — scene 壁纸兜底图选择（纯函数）
 *
 * Wallpaper Engine 的 scene 壁纸在渲染失败 / iframe 被 agent CSP 拦截时，
 * 注入器会用静态图兜底。此前直接用 workshop 的 `preview.jpg`（低分辨率
 * 缩略图，常见 512×288），而壁纸目录里往往有更大更清晰的 hero/screenshot
 * 图。本模块在兜底时扫描目录、挑**文件最大**的可解码图，提升注入清晰度。
 *
 * 纯函数 + 可注入的 `sizeOf`，vitest 无需 electron 依赖即可测试。
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

/** 浏览器可直接解码的图片扩展名（与 we/parser.ts 的 BROWSER_DECODABLE_IMAGE 一致）。 */
export const FALLBACK_IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'];

/** 文件大小解析函数（测试可注入假大小）。默认 fs.stat().size。 */
export type FileSizeOf = (file: string) => Promise<number>;

export async function defaultSizeOf(file: string): Promise<number> {
  const st = await stat(file);
  return st.size;
}

/**
 * 在壁纸目录中挑选最大的可解码图片作为兜底静态图。
 *
 * - 扫描 `dir` 下扩展名匹配的文件，按 `sizeOf` 取最大者（含 fallback 本身，
 *   保证目录里只有 preview 时返回 preview）。
 * - 目录不可读 / 无匹配文件 / 全部比 fallback 小 → 返回 `fallback`（绝不抛错，
 *   保持原兜底语义）。
 */
export async function pickLargestFallbackImage(
  dir: string,
  fallback: string | null,
  sizeOf: FileSizeOf = defaultSizeOf,
): Promise<string | null> {
  if (!fallback) return null;
  let best = { file: fallback, size: 0 };
  try {
    const st = await sizeOf(fallback);
    best = { file: fallback, size: st };
  } catch {
    // fallback 不可读 → 返回原值（后续注入会自行失败）。
    return fallback;
  }
  try {
    const names = await readdir(dir);
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      if (!FALLBACK_IMAGE_EXTENSIONS.includes(ext)) continue;
      const file = path.join(dir, name);
      try {
        const size = await sizeOf(file);
        if (size > best.size) best = { file, size };
      } catch {
        // 单个文件不可读 → 跳过。
      }
    }
  } catch {
    // 目录不可读 → 回退 fallback。
    return fallback;
  }
  return best.file;
}
