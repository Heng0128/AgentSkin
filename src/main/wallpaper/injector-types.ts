// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/injector-types
 *
 * Type definitions and interfaces for the wallpaper injection orchestrator.
 * Extracted from `wallpaper-injector.ts` so the type contracts can be imported
 * by multiple sub-modules without a circular dependency on the orchestrator
 * itself.
 *
 * Dependency: this module has NO runtime imports — it is pure types. It can
 * be imported by {@link ./target-discovery}, {@link ./injection-state}, and
 * {@link ../wallpaper-injector} without creating cycles.
 */

import type {
  AgentId,
  RestartReason,
  WallpaperAgentSetting,
  WallpaperRenderOptions,
} from '../../shared/types';
import type { CdpReadyResult } from '../app-discovery';
import type { CdpTarget } from '../cdp/cdp-targets';
import type { LogCallback } from '../services/contracts';
import type { ThemeEntry } from '../theme-library';

// ---------------------------------------------------------------------------
// Service interfaces
// ---------------------------------------------------------------------------

/**
 * 注入时的壁纸渲染选项 — 由 `ResolvedWallpaper` 合并后的完整设置，透传给
 * CDP 注入器。`render` 是**唯一**参数来源：`speed/loop/scrimOpacity` 由
 * `resolveAgentWallpaperId` 合并进 `render`，注入器不再单独读取顶层字段
 * （历史路径曾导致 per-agent 设置的 speed/loop/scrimOpacity 不生效 ——
 * 顶层字段与 `render` 内字段重复且优先规则只靠注释约定）。
 */
export interface WallpaperApplyOptions {
  /**
   * 渲染设置（speed/loop/scrimOpacity/对齐/位置/翻转/滤镜/视差）。这是
   * speed/loop/scrimOpacity 的唯一来源。默认空 = 注入器内置默认。
   */
  render?: WallpaperRenderOptions;
}

/**
 * Media-path resolution service (Wallpaper Engine workshop item or local
 * file). Wired to the orchestrator's `wallpaperService` reference.
 */
export interface WallpaperService {
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{
    type: 'video' | 'image' | 'web' | 'scene';
    path: string;
    /** Absolute path to the wallpaper's still preview image (preview.jpg/png/gif),
     *  or null. Used for the wallpaper library UI only — never injected. */
    previewPath: string | null;
    previewOnly: boolean;
  } | null>;
  /** Resolve a web/scene wallpaper's rendered content URL for iframe
   *  injection. Returns null for non-web/scene wallpapers. */
  webUrlFor(id: string): Promise<string | null>;
}

/** Effective wallpaper id + playback options resolved for an agent. */
export interface ResolvedWallpaper {
  id: string | null;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
  /** 合并后的渲染设置（per-agent → 全局 → 主题 → 内置默认）。未设置的字段
   *  落到 CDP 注入器的内置默认（fill=cover、无滤镜、无翻转、无视差）。 */
  render?: WallpaperRenderOptions;
}

// ---------------------------------------------------------------------------
// Functional type aliases (wired to AgentEngineService methods)
// ---------------------------------------------------------------------------

/** Epoch guard — true when `captured` is still current for `appId`. */
export type IsEpochCurrent = (appId: AgentId, captured: number) => boolean;

/** Bump the epoch for an agent, returning the new value. */
export type BumpEpoch = (appId: AgentId) => number;

/**
 * Resolve the effective wallpaper id + options for an agent. Wired to
 * {@link AgentEngineService.resolveAgentWallpaperId} which prioritises
 * per-agent settings over the active theme's bundled wallpaper.
 */
export type ResolveAgentWallpaperId = (
  appId: AgentId,
  entry?: ThemeEntry,
) => Promise<ResolvedWallpaper>;

/** Ensure the agent has a live CDP endpoint (may restart). */
export type EnsureCdpReady = (
  appId: AgentId,
  timeoutMs?: number,
  forceRestart?: boolean,
) => Promise<CdpReadyResult>;

/** Re-resolve the live CDP port for an agent. */
export type ResolveLivePort = (appId: AgentId) => Promise<number | null>;

/** Infer a structured restart/launch reason for the UI (shared with the theme
 *  apply flow so both surfaces present the same restart dialog semantics). */
export type InferRestartReason = (
  appId: AgentId,
  cdpFailureReason?: CdpReadyResult['reason'],
) => Promise<RestartReason>;

/**
 * Discover CDP targets for an agent, filtered by its adapter's `matchTarget`
 * (the same policy theme injection uses) so wallpaper lands on the correct
 * page even when an agent exposes multiple targets. Backed by
 * `adapter.findTargets` in the orchestrator.
 */
export type FindAgentTargets = (appId: AgentId, port: number) => Promise<CdpTarget[]>;

/** Persist a per-agent wallpaper preference. */
export type SetAgentWallpaper = (appId: AgentId, setting: WallpaperAgentSetting) => Promise<void>;

/**
 * Check whether an apply/restore operation is currently in-flight for an
 * agent. Used by the self-heal deferred-queue to serialise with concurrent
 * operations instead of racing them. Optional — when absent, the self-heal
 * thunk is invoked immediately (legacy behavior); when present, the caller
 * can defer execution until the in-flight op releases its lock.
 */
export type IsApplyingTheme = (appId: AgentId) => boolean;

/** Re-exported from `services/contracts.ts` for backward compatibility — new
 *  consumers should import `LogCallback` directly from `./services/contracts`. */
export type { LogCallback };

// ---------------------------------------------------------------------------
// Orchestrator deps slice
// ---------------------------------------------------------------------------

/**
 * The orchestrator slice that backs all calls in this module. Each field
 * is a thin lambda over the orchestrator's private state so the pure
 * transformation can be unit-tested without spinning up a real agent.
 */
export interface WallpaperInjectorDeps {
  wallpaperService: WallpaperService | null;
  isEpochCurrent: IsEpochCurrent;
  bumpEpoch: BumpEpoch;
  resolveAgentWallpaperId: ResolveAgentWallpaperId;
  ensureCdpReady: EnsureCdpReady;
  resolveLivePort: ResolveLivePort;
  inferRestartReason: InferRestartReason;
  findAgentTargets: FindAgentTargets;
  setAgentWallpaper: SetAgentWallpaper;
  log: LogCallback;
  /**
   * True when an apply/restore operation is currently in-flight for an agent.
   * When present, the self-heal deferred-queue uses it to delay self-heal
   * execution until the in-flight op releases its lock. Optional for backward
   * compatibility — consumers that don't wire it (e.g. unit-test mocks) fall
   * back to the legacy immediate-invoke behavior.
   */
  isApplyingTheme?: IsApplyingTheme;
  /**
   * True when the parent AgentEngineService has been disposed (app shutdown).
   * When present and self-dealed, self-heal / inject paths short-circuit
   * instead of operating on already-disposed CDP sessions / media tokens,
   * which would throw "Attempt to use disposed session". Optional — callers
   * that don't wire it (unit-test mocks) skip the guard entirely.
   */
  isDisposed?: () => boolean;
}
