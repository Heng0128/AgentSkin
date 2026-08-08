// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';

/**
 * 壁纸渲染选项 — 对齐 Wallpaper Engine 渲染面板的规范化配置。
 *
 * 全部可选；未设置的项落到 CDP 注入器的内置默认值（fill=cover、无滤镜、
 * 无翻转、无视差）。解析优先级（由高到低）：per-agent 设置 →
 * 全局默认（WallpaperSettings.render）→ 主题 manifest（ThemeWallpaper.render）
 * → 内置默认。这样同一个壁纸在桌面 UI 背景与注入的 agent 窗口共享同一套
 * 渲染语义 —— "同一壁纸在桌面与 agent 效果一致"的核心保证。
 */
export interface WallpaperRenderOptions {
  /** 播放速度倍数（仅视频）。0.25-2.0，默认 1。 */
  speed?: number;
  /** 是否循环播放（仅视频）。默认 true。 */
  loop?: boolean;
  /** 可读性 scrim 遮罩透明度 0-100（图片默认 45 / 视频默认 55）。 */
  scrimOpacity?: number;
  /** 对齐方式（对齐 WE/Sucrose 渲染面板）：stretch=拉伸填满、fit=完整
   *  显示留边、fill=cover 裁剪铺满（默认，同现状）、center=原尺寸居中、
   *  tile=平铺（仅图片）。 */
  alignment?: 'stretch' | 'fit' | 'fill' | 'center' | 'tile';
  /** 位置水平偏移 %（-100..100，默认 0）。 */
  positionX?: number;
  /** 位置垂直偏移 %（-100..100，默认 0）。 */
  positionY?: number;
  /** 水平翻转。 */
  flipH?: boolean;
  /** 垂直翻转。 */
  flipV?: boolean;
  /** 鼠标视差强度 0-100（0=关闭，默认 0）。 */
  parallax?: number;
  /** 亮度滤镜 0-200（100=正常）。 */
  brightness?: number;
  /** 对比度滤镜 0-200（100=正常）。 */
  contrast?: number;
  /** 饱和度滤镜 0-200（100=正常）。 */
  saturation?: number;
  /** 色相旋转 -180..180（默认 0）。 */
  hueRotate?: number;
  /** 棕褐化 0-100（默认 0）。 */
  sepia?: number;
  /** 灰度化 0-100（默认 0）。 */
  grayscale?: number;
  /** 高斯模糊 0-50px（默认 0）。 */
  blur?: number;
  /** 主题配色着色（hex，如 "#c41e2a"）。 */
  tint?: string;
  /** 音频响应灵敏度 0-100（0=关闭，默认 0）。 */
  audioLevel?: number;
}

/** 对齐方式取值（UI 下拉 + 配置校验共用）。 */
export const WALLPAPER_ALIGNMENTS = ['stretch', 'fit', 'fill', 'center', 'tile'] as const;
export type WallpaperAlignment = (typeof WALLPAPER_ALIGNMENTS)[number];

/**
 * Video wallpaper config bundled with a theme (v2.1+). Two reference modes:
 * - `workshopId`: Wallpaper Engine Steam workshop item id (takes precedence)
 * - `video`: video file bundled inside the theme package (relative path)
 */
export interface ThemeWallpaper {
  /** Wallpaper Engine workshop item id (numeric string). Takes precedence over `video`. */
  workshopId?: string;
  /** Path to video file relative to package root (mp4/webm). */
  video?: string;
  /** Optional poster image shown before video loads (png/webp). */
  poster?: string;
  /** Playback speed multiplier (default 1.0). */
  speed?: number;
  /** Whether to loop the video (default true). */
  loop?: boolean;
  /** Overlay scrim opacity 0-100 (default 55). */
  scrimOpacity?: number;
  /** 主题自带的渲染设置（对齐/位置/翻转/滤镜/视差/音频等）。优先级低于
   *  全局默认与 per-agent 设置。 */
  render?: WallpaperRenderOptions;
}

/** How a wallpaper preview should be rendered in the UI. */
export type WallpaperPlayback = 'video' | 'gif' | 'image' | 'web' | 'scene';

/** The original Wallpaper Engine project type from project.json. */
export type WallpaperProjectType = 'video' | 'image' | 'web' | 'scene' | 'application';

/** A wallpaper discovered from the Wallpaper Engine workshop library or local imports. */
export interface WallpaperInfo {
  /** Workshop item id (the numeric Steam workshop folder name) or local id. */
  id: string;
  /** Wallpaper title from project.json. */
  title: string;
  /** Wallpaper media type for injection dispatch: video, image, web (iframe),
   *   or scene (canvas renderer). */
  type: 'video' | 'image' | 'web' | 'scene';
  /** The original Wallpaper Engine project type from project.json. */
  projectType: WallpaperProjectType;
  /** How the preview is rendered in the UI grid. */
  playback: WallpaperPlayback;
  /** Streamable loopback preview image URL served by the wallpaper media
   *   server. For image wallpapers this is the media file itself. For video
   *   wallpapers this is the workshop preview image (preview.jpg/png/gif) when
   *   available. Null when no preview image exists. */
  previewUrl: string | null;
  /** Size of the source media file in bytes. */
  sizeBytes: number;
  /** Workshop tags (e.g. Anime, Animal). */
  tags: string[];
  /** Where this wallpaper was discovered from. */
  source: 'workshop' | 'local';
  /** True when the wallpaper has no real media asset — only a low-res
   *   preview thumbnail (preview.jpg). This is now rare since scene and web
   *   wallpapers are fully supported via their own renderers. Only applies to
   *   wallpapers whose project type is unrecognized and no media file exists. */
  previewOnly: boolean;
}

/** Per-agent wallpaper preference: whether a wallpaper is enabled for this
 *  agent and which wallpaper id to inject into its page via CDP. */
export interface WallpaperAgentSetting {
  /** Whether a video wallpaper should be injected into this agent's page. */
  enabled: boolean;
  /** Wallpaper id (WallpaperInfo.id), or null to follow the active theme's
   *  bundled wallpaper (theme.wallpaper) when present. */
  id: string | null;
  /** Per-agent 渲染覆盖（对齐/位置/翻转/滤镜/视差/音频等）。未设置则用
   *  全局默认（WallpaperSettings.render）→ 主题 manifest → 内置默认。 */
  render?: WallpaperRenderOptions;
}

/** Persisted dynamic-wallpaper preference. */
export interface WallpaperSettings {
  /** Whether the animated background is enabled for AgentSkin's own UI. */
  enabled: boolean;
  /** Selected wallpaper id (WallpaperInfo.id) for AgentSkin's own UI, or null for none. */
  id: string | null;
  /** 全局默认渲染设置，所有 agent 与桌面 UI 背景共用；per-agent 设置优先。 */
  render?: WallpaperRenderOptions;
  /** Per-agent wallpaper settings. Each agent can have a different wallpaper
   *  injected into its page, independent of the AgentSkin UI background. */
  agents: Record<AgentId, WallpaperAgentSetting>;
}

export interface AppOverride {
  /** Manual install location when auto-detection fails (mainly Windows). */
  appPath: string | null;
  /** Debug-port override when the adapter default is occupied. */
  port: number | null;
}

export interface DesktopSettings {
  apps: Record<AgentId, AppOverride>;
  defaultPorts: Record<AgentId, number>;
  wallpaper: WallpaperSettings;
  /** Global user-authored CSS injected as the highest-priority theme layer
   *  (custom.css). Never overwritten by theme applies; cleared on restore. */
  customThemeCss?: string;
}
