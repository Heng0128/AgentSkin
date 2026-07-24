// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Injector
 *
 * Extracted from `AgentEngineService` (P1-4 of the god-object teardown).
 *
 * Owns the CDP-based video / image wallpaper injection that runs alongside
 * theme application, plus the public APIs the UI calls to manage per-agent
 * wallpaper preferences:
 *   - {@link injectAgentWallpaper}: low-level inject of a specific
 *     wallpaper id (resolves media path → CDP → image/video dispatch).
 *   - {@link injectAgentWallpaperFromApply}: resolve the effective
 *     wallpaper (per-agent setting → theme-bundled) and inject or remove.
 *   - {@link removeAgentVideoWallpaper}: tear down injected wallpaper
 *     elements from the page (called during theme restore).
 *   - {@link applyAgentWallpaperNow}: UI entry point — apply (or remove)
 *     the resolved wallpaper to a running agent immediately.
 *   - {@link applyWallpaperToAgent}: UI entry point — persist a per-agent
 *     wallpaper preference and inject it.
 *   - {@link removeWallpaperFromAgent}: UI entry point — clear the
 *     preference and remove the injected elements.
 *
 * Why these go together: all six operate on the same `wallpaperService`
 * (media path resolution) and the same CDP page-target plumbing, and the
 * three UI entry points share the same settings-persistence + epoch +
 * CDP-ready orchestration. None of them touch `applyEpoch` beyond reading
 * / bumping it, so they form a clean cohesive slice.
 *
 * Call chain:
 *   AgentEngineService.apply  → injectAgentWallpaperFromApply
 *   AgentEngineService.restore → removeAgentVideoWallpaper
 *   IPC (UI)                → applyAgentWallpaperNow / applyWallpaperToAgent / removeWallpaperFromAgent
 */

import { statSync } from 'node:fs';
import path from 'node:path';
import { toMessage } from '../shared/errors';
import type { AgentId, WallpaperAgentSetting } from '../shared/types';
import type { CdpReadyResult } from './app-discovery';
import { type CdpSession, connectCdp } from './cdp-client';
import { type CdpTarget, pickPageTarget } from './cdp-targets';
import {
  injectImageWallpaper,
  injectVideoWallpaper,
  injectVideoWallpaperByBase64,
  removeAllWallpapers,
  videoMimeForPath,
} from './cdp-wallpaper-inject';
import type { LogCallback } from './services/contracts';
import type { ThemeEntry } from './theme-library';
import { wallpaperMediaServer } from './wallpaper-server';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Files larger than this are streamed from the local HTTP server instead of
 *  being base64-assembled in the agent renderer (keeps the agent's JS heap
 *  small for big video wallpapers). */
const VIDEO_HTTP_THRESHOLD = 50 * 1024 * 1024;

/** When the streamed HTTP mount fails to load (e.g. a media-src CSP blocks
 *  loopback URLs), we fall back to the in-page base64 blob path. Blob keeps
 *  the full file in the agent's JS heap (~1.3x), so we only allow the
 *  fallback for files below this cap — above it, a CSP-blocked large video
 *  gets a clear error instead of risking an OOM in the agent renderer. */
const VIDEO_BLOB_FALLBACK_CAP = 120 * 1024 * 1024;

/** Resolve the main page target using the agent's adapter matchTarget filter
 *  (identical policy to theme injection), so wallpaper lands on the right
 *  page even when an agent exposes multiple CDP targets. */
async function resolvePageTarget(
  deps: WallpaperInjectorDeps,
  appId: AgentId,
  port: number,
): Promise<CdpTarget | undefined> {
  try {
    const targets = await deps.findAgentTargets(appId, port);
    return pickPageTarget(targets);
  } catch {
    return undefined;
  }
}

/** Null-safe file size probe. */
function safeFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Media-path resolution service (Wallpaper Engine workshop item or local
 * file). Wired to the orchestrator's `wallpaperService` reference.
 */
export interface WallpaperService {
  videoPathFor(id: string): Promise<string | null>;
  mediaInfoFor(id: string): Promise<{ type: 'video' | 'image'; path: string } | null>;
}

/** Effective wallpaper id + playback options resolved for an agent. */
export interface ResolvedWallpaper {
  id: string | null;
  speed?: number;
  loop?: boolean;
  scrimOpacity?: number;
}

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
export type EnsureCdpReady = (appId: AgentId, timeoutMs?: number) => Promise<CdpReadyResult>;

/** Re-resolve the live CDP port for an agent. */
export type ResolveLivePort = (appId: AgentId) => Promise<number | null>;

/**
 * Discover CDP targets for an agent, filtered by its adapter's `matchTarget`
 * (the same policy theme injection uses) so wallpaper lands on the correct
 * page even when an agent exposes multiple targets. Backed by
 * `adapter.findTargets` in the orchestrator.
 */
export type FindAgentTargets = (appId: AgentId, port: number) => Promise<CdpTarget[]>;

/** Persist a per-agent wallpaper preference. */
export type SetAgentWallpaper = (appId: AgentId, setting: WallpaperAgentSetting) => Promise<void>;

/** Best-effort log line sink. Re-exported from `services/contracts.ts` for
 *  backward compatibility — new consumers should import `LogCallback` directly
 *  from `./services/contracts`. */
export type { LogCallback };

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
  findAgentTargets: FindAgentTargets;
  setAgentWallpaper: SetAgentWallpaper;
  log: LogCallback;
}

// ---------------------------------------------------------------------------
// injectAgentWallpaper
// ---------------------------------------------------------------------------

/**
 * Inject a wallpaper (video or image) into the agent's main page via CDP.
 * Resolves the media file path through the wallpaper service (Wallpaper
 * Engine workshop item or local file), then delegates to the appropriate
 * CDP injection function. Best-effort and non-blocking.
 *
 * Returns true on success, false on failure (media not found, CDP
 * unreachable, injection error).
 */
export async function injectAgentWallpaper(
  appId: AgentId,
  port: number,
  wallpaperId: string,
  options: { speed?: number; loop?: boolean; scrimOpacity?: number },
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<boolean> {
  if (!deps.wallpaperService) return false;
  if (!deps.isEpochCurrent(appId, epoch)) return false;

  // Resolve the media file path and type via the wallpaper service
  const info = await deps.wallpaperService.mediaInfoFor(wallpaperId);
  if (!info) {
    deps.log(`[wallpaper] ${appId}: no media found for "${wallpaperId}"`);
    return false;
  }
  if (!deps.isEpochCurrent(appId, epoch)) return false;

  // Connect to the main page target
  const pageTarget = await resolvePageTarget(deps, appId, port);
  if (!pageTarget || !deps.isEpochCurrent(appId, epoch)) return false;
  const pageWsUrl = pageTarget.webSocketDebuggerUrl;

  let session: CdpSession;
  try {
    session = await connectCdp(pageWsUrl, 4000);
  } catch {
    deps.log(`[wallpaper] ${appId}: CDP connect failed`);
    return false;
  }

  try {
    let ok: boolean;
    // Dispatch based on actual file extension, not just the type field.
    // GIF files marked as 'video' (animated scene previews) need <img> injection
    // since browsers render animated GIFs natively in <img> but not <video>.
    const ext = path.extname(info.path).toLowerCase();
    const isImageFile = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.svg'].includes(ext);
    if (info.type === 'image' || isImageFile) {
      ok = await injectImageWallpaper(session, {
        imagePath: info.path,
        scrimOpacity: options.scrimOpacity,
      });
    } else {
      // Stream large videos from the local HTTP server (low renderer memory).
      // If the agent enforces a media-src CSP that blocks loopback URLs, the
      // streamed mount fails to load (the mount verifies this). We then fall
      // back to the in-page base64 blob path — also CSP-sensitive, but some
      // agents allow `blob:` while blocking `http`. Either way a blocked
      // wallpaper is never reported as a success.
      const mime = videoMimeForPath(info.path);
      const size = safeFileSize(info.path);
      let registered: { token: string; url: string } | null = null;
      if (size != null && size > VIDEO_HTTP_THRESHOLD) {
        registered = await wallpaperMediaServer.register(info.path, mime);
      }
      if (registered) {
        ok = await injectVideoWallpaper(session, {
          src: registered.url,
          mime,
          speed: options.speed,
          loop: options.loop,
          scrimOpacity: options.scrimOpacity,
        });
        if (!ok) {
          // Streamed mount failed to load — likely a media-src CSP block.
          if (size != null && size <= VIDEO_BLOB_FALLBACK_CAP) {
            deps.log(
              `[wallpaper] ${appId}: http stream load failed (possible media-src CSP); retrying via base64 blob`,
            );
            ok = await injectVideoWallpaperByBase64(session, {
              videoPath: info.path,
              speed: options.speed,
              loop: options.loop,
              scrimOpacity: options.scrimOpacity,
            });
          } else {
            deps.log(
              `[wallpaper] ${appId}: http stream load failed and file too large (${size ? Math.round(size / 1048576) : '?'}MB) for blob fallback`,
            );
          }
        }
      } else {
        ok = await injectVideoWallpaperByBase64(session, {
          videoPath: info.path,
          speed: options.speed,
          loop: options.loop,
          scrimOpacity: options.scrimOpacity,
        });
      }
    }
    deps.log(
      `[wallpaper] ${appId}: ${info.type} wallpaper ${ok ? 'injected' : 'failed'} (${path.basename(info.path)})`,
    );
    return ok;
  } catch (error) {
    deps.log(`[wallpaper] ${appId}: injection failed: ${toMessage(error)}`);
    return false;
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// injectAgentWallpaperFromApply
// ---------------------------------------------------------------------------

/**
 * Called from the apply flow to inject the resolved wallpaper into the
 * agent's page. Resolves the effective wallpaper id (per-agent setting
 * first, then theme-bundled wallpaper) and delegates to
 * {@link injectAgentWallpaper}. If no wallpaper is resolved, removes any
 * existing wallpaper from the page.
 */
export async function injectAgentWallpaperFromApply(
  appId: AgentId,
  port: number,
  entry: ThemeEntry,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<void> {
  const resolved = await deps.resolveAgentWallpaperId(appId, entry);
  if (!resolved.id) {
    // No wallpaper configured — remove any stale wallpaper from the page.
    const pageTarget = await resolvePageTarget(deps, appId, port);
    if (!pageTarget || !deps.isEpochCurrent(appId, epoch)) return;
    const pageWsUrl = pageTarget.webSocketDebuggerUrl;
    let session: CdpSession;
    try {
      session = await connectCdp(pageWsUrl, 4000);
    } catch {
      return;
    }
    try {
      await removeAllWallpapers(session);
    } finally {
      session.close();
    }
    return;
  }
  await injectAgentWallpaper(
    appId,
    port,
    resolved.id,
    {
      speed: resolved.speed,
      loop: resolved.loop,
      scrimOpacity: resolved.scrimOpacity,
    },
    epoch,
    deps,
  );
}

// ---------------------------------------------------------------------------
// removeAgentVideoWallpaper
// ---------------------------------------------------------------------------

/**
 * Remove any injected wallpaper (video or image) from the agent's page.
 * Called during the restore flow. Best-effort.
 */
export async function removeAgentVideoWallpaper(
  appId: AgentId,
  port: number,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<void> {
  if (!deps.isEpochCurrent(appId, epoch)) return;
  const pageTarget = await resolvePageTarget(deps, appId, port);
  if (!pageTarget || !deps.isEpochCurrent(appId, epoch)) return;
  const pageWsUrl = pageTarget.webSocketDebuggerUrl;
  let session: CdpSession;
  try {
    session = await connectCdp(pageWsUrl, 4000);
  } catch {
    return;
  }
  try {
    await removeAllWallpapers(session);
    deps.log(`[wallpaper] ${appId}: removed all wallpapers during restore`);
  } finally {
    session.close();
  }
}

// ---------------------------------------------------------------------------
// applyAgentWallpaperNow (UI entry point)
// ---------------------------------------------------------------------------

/**
 * Immediately apply (or remove) the wallpaper to a running agent's page.
 * Called from the UI when the user selects a wallpaper for an agent.
 * Resolves the effective wallpaper id via {@link ResolveAgentWallpaperId},
 * then connects to the agent's live CDP target and injects (or removes)
 * the video wallpaper.
 *
 * Returns `{ ok, reason }` so the UI can surface a precise error when the
 * agent is not running or CDP is unavailable.
 */
export async function applyAgentWallpaperNow(
  appId: AgentId,
  deps: WallpaperInjectorDeps,
): Promise<{ ok: boolean; reason?: string }> {
  const resolved = await deps.resolveAgentWallpaperId(appId);
  const cdpResult = await deps.ensureCdpReady(appId, 30000);
  if (!cdpResult.port) {
    return {
      ok: false,
      reason: cdpResult.reason === 'not-installed' ? 'not-installed' : 'agent-not-running',
    };
  }
  const port = cdpResult.port;

  // No wallpaper → remove any existing wallpaper from the page.
  if (!resolved.id) {
    const pageTarget = await resolvePageTarget(deps, appId, port);
    if (!pageTarget) return { ok: false, reason: 'no-page-target' };
    const pageWsUrl = pageTarget.webSocketDebuggerUrl;
    let session: CdpSession;
    try {
      session = await connectCdp(pageWsUrl, 4000);
    } catch {
      return { ok: false, reason: 'cdp-connect-failed' };
    }
    try {
      await removeAllWallpapers(session);
      deps.log(`[wallpaper] ${appId}: removed (no wallpaper configured)`);
      return { ok: true };
    } finally {
      session.close();
    }
  }

  // Inject the wallpaper. Use a fresh epoch so this doesn't get cancelled
  // by a stale apply flow (the caller is the user, acting right now).
  const epoch = deps.bumpEpoch(appId);
  const ok = await injectAgentWallpaper(
    appId,
    port,
    resolved.id,
    {
      speed: resolved.speed,
      loop: resolved.loop,
      scrimOpacity: resolved.scrimOpacity,
    },
    epoch,
    deps,
  );
  return ok ? { ok: true } : { ok: false, reason: 'injection-failed' };
}

// ---------------------------------------------------------------------------
// applyWallpaperToAgent (UI entry point)
// ---------------------------------------------------------------------------

/**
 * Apply a specific wallpaper to a specific agent. Persists the per-agent
 * preference and immediately injects via CDP. This is the primary entry
 * point from the Wallpaper Engine UI page.
 */
export async function applyWallpaperToAgent(
  wallpaperId: string,
  appId: AgentId,
  deps: WallpaperInjectorDeps,
): Promise<{ ok: boolean; reason?: string }> {
  if (!deps.wallpaperService) return { ok: false, reason: 'wallpaper-service-unavailable' };

  // Verify the wallpaper exists
  const info = await deps.wallpaperService.mediaInfoFor(wallpaperId);
  if (!info) return { ok: false, reason: 'wallpaper-not-found' };

  // Persist the per-agent preference
  await deps.setAgentWallpaper(appId, { enabled: true, id: wallpaperId });

  // Ensure CDP is available (discovers existing port or restarts agent with CDP)
  const cdpResult = await deps.ensureCdpReady(appId, 30000);
  if (!cdpResult.port) {
    return {
      ok: false,
      reason: cdpResult.reason === 'not-installed' ? 'agent-not-installed' : 'agent-not-running',
    };
  }

  // Inject with a fresh epoch
  const epoch = deps.bumpEpoch(appId);
  const ok = await injectAgentWallpaper(appId, cdpResult.port, wallpaperId, {}, epoch, deps);
  return ok ? { ok: true } : { ok: false, reason: 'injection-failed' };
}

// ---------------------------------------------------------------------------
// removeWallpaperFromAgent (UI entry point)
// ---------------------------------------------------------------------------

/**
 * Remove the wallpaper from a specific agent. Clears the per-agent
 * preference and removes the injected elements via CDP.
 */
export async function removeWallpaperFromAgent(
  appId: AgentId,
  deps: WallpaperInjectorDeps,
): Promise<{ ok: boolean }> {
  // Clear the persisted preference
  await deps.setAgentWallpaper(appId, { enabled: false, id: null });

  // Try to remove from the live page
  const port = await deps.resolveLivePort(appId);
  if (!port) return { ok: true }; // Agent not running — preference cleared, done.

  const epoch = deps.bumpEpoch(appId);
  await removeAgentVideoWallpaper(appId, port, epoch, deps);
  return { ok: true };
}
