// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-wallpaper — 运行期主题壁纸注册
 *
 * 把已安装主题捆绑的视频壁纸（`theme.wallpaper.video`）注册进
 * WallpaperService，使 `theme:<id>` 壁纸条目在 UI 中可浏览、apply 时可注入。
 *
 * 现状背景：boot 时内置主题的注册硬编码在 `boot-sequence.ts`，且路径拼接
 * `themesDir/theme.id/video` 只对 app 包内 themes/ 成立。运行期安装的主题
 * （pywal 自动取色主题、bundle 组合包）落在 userData 下，不会注册。本模块
 * 提供一个与 boot 共用的注册工具：以"包根目录"为参数，正确解析 video 相对
 * 路径。
 *
 * `InstalledTheme.packageRoot`（可选）记录了目录包根路径；内置主题缺省时
 * 调用方回退到内置 themesDir（现状不变）。
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { toMessage } from '../../shared/errors';
import type { InstalledTheme } from '../../shared/types';
import type { MainContext } from '../main-context';

/**
 * 把主题捆绑的视频壁纸注册进 WallpaperService（best-effort）。
 *
 * 读取 `theme.wallpaper.video`（相对包根的路径），文件存在且 WallpaperService
 * 可用时注册为 `theme:<themeId>`；否则静默跳过（不抛错——注册失败不应影响
 * 主题安装/应用主流程）。`onError` 可选，用于记录日志。
 *
 * 路径安全：`theme.id` 与 `wp.video` 均来自主题包内容（可能被篡改），拼接后
 * 做一次包含性校验——解析结果必须落在 `packageRoot` 内，否则视为恶意跳过。
 */
export async function registerThemeWallpaperForInstalled(
  context: Pick<MainContext, 'wallpapers'>,
  theme: InstalledTheme,
  packageRoot: string,
  onError?: (line: string) => void,
): Promise<void> {
  const wp = theme.wallpaper;
  if (!wp?.video || !context.wallpapers) return;
  const videoPath = resolveInside(packageRoot, path.join(theme.id, wp.video));
  if (!videoPath) {
    onError?.(`[theme-wallpaper] blocked out-of-root video path for "${theme.id}"`);
    return;
  }
  try {
    if (!existsSync(videoPath)) return; // 视频文件缺失 → 跳过（与 registerThemeWallpaper 内部一致）
    await context.wallpapers.registerThemeWallpaper(theme.id, videoPath, theme.displayName);
  } catch (error) {
    onError?.(`[theme-wallpaper] registration failed for "${theme.id}": ${toMessage(error)}`);
  }
}

/**
 * Resolve `rel` against `root` and verify the result stays inside `root`.
 * Returns the absolute path, or null when `rel` escapes (absolute path, or
 * `..` segments resolving above the root). `path.join` alone would silently
 * drop an absolute `rel`'s earlier segments and let `../` walk out.
 */
function resolveInside(root: string, rel: string): string | null {
  const absRoot = path.resolve(root);
  const absTarget = path.resolve(absRoot, rel);
  const relToRoot = path.relative(absRoot, absTarget);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) return null;
  return absTarget;
}
