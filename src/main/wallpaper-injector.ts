// SPDX-License-Identifier: MPL-2.0

/**
 * # Wallpaper Injector (core orchestrator + barrel)
 *
 * Extracted from `AgentEngineService` (P1-4 of the god-object teardown), then
 * further split into focused sub-modules (P0-2 of the SRP refactor).
 *
 * This file now contains ONLY the core injection orchestration logic and the
 * UI entry points. All type contracts, target discovery, and state management
 * have been peeled off into cohesive sub-modules under `./wallpaper/`:
 *
 *   - {@link ./wallpaper/types}            — type definitions & interfaces (pure types, no runtime)
 *   - {@link ./wallpaper/target-discovery} — CDP target resolution, readiness polling, size constants
 *   - {@link ./wallpaper/injection-state}  — media-token / active-wallpaper / fallback state + session management
 *
 * This file re-exports the public API of those sub-modules so existing
 * consumers (`agent-engine-service.ts`, `wallpaper-lifecycle.ts`, and the test
 * suite) can keep importing from `'./wallpaper-injector'` without changes.
 *
 * Functions that remain here (the orchestration layer):
 *   - {@link injectAgentWallpaper}: low-level inject of a specific wallpaper id
 *     (resolves media path → CDP → image/video/web dispatch).
 *   - {@link injectWithFallback}: wrap injectAgentWallpaper with automatic
 *     fallback to the last successful wallpaper on failure.
 *   - {@link injectAgentWallpaperFromApply}: resolve the effective wallpaper
 *     (per-agent setting → theme-bundled) and inject or remove.
 *   - {@link removeAgentVideoWallpaper}: tear down injected wallpaper elements
 *     from all targets (called during theme restore).
 *   - {@link applyAgentWallpaperNow}: UI entry point — apply (or remove) the
 *     resolved wallpaper to a running agent immediately.
 *   - {@link applyWallpaperToAgent}: UI entry point — persist a per-agent
 *     wallpaper preference and inject it.
 *   - {@link removeWallpaperFromAgent}: UI entry point — clear the preference
 *     and remove the injected elements.
 *
 * Call chain:
 *   AgentEngineService.apply  → injectAgentWallpaperFromApply
 *   AgentEngineService.restore → removeAgentVideoWallpaper
 *   IPC (UI)                → applyAgentWallpaperNow / applyWallpaperToAgent / removeWallpaperFromAgent
 */

import path from 'node:path';
import { toMessage } from '../shared/errors';
import type { AgentId, RestartReason } from '../shared/types';
import { type CdpSession, connectCdp } from './cdp/cdp-client';
import { ensureAgentCdpReady } from './cdp/cdp-ready';
import {
  imageMimeForPath,
  injectImageWallpaper,
  injectImageWallpaperByUrl,
  injectVideoWallpaper,
  injectVideoWallpaperByBase64,
  injectWebWallpaper,
  videoMimeForPath,
} from './cdp/cdp-wallpaper-inject';
import { getImageBlobThresholdBytes } from './config/settings';
import type { ThemeEntry } from './theme-library';
import {
  clearActiveWallpaperAgent,
  clearLastSuccessfulWallpaper,
  getLastSuccessfulWallpaper,
  removeAllWallpapersFromAllTargets,
  setActiveMediaToken,
  setActiveWallpaperAgent,
  setLastSuccessfulWallpaper,
  setWallpaperDeps,
} from './wallpaper/injection-state';
// Sub-module imports (types, target discovery, state management)
import type { WallpaperApplyOptions, WallpaperInjectorDeps } from './wallpaper/injector-types';
import {
  IMAGE_BLOB_FALLBACK_CAP,
  resolvePageTargets,
  safeFileSize,
  VIDEO_BLOB_FALLBACK_CAP,
  VIDEO_HTTP_THRESHOLD,
  waitForPageReady,
  waitForTargets,
} from './wallpaper/target-discovery';
import { recordInjectionFailure, recordInjectionSuccess } from './wallpaper-self-heal';
import { wallpaperMediaServer } from './wallpaper-server';

// ---------------------------------------------------------------------------
// Barrel re-exports — backward compatibility for existing consumers
// ---------------------------------------------------------------------------

// State management (from wallpaper/injection-state) — only the symbols actually
// imported by external consumers (wallpaper-lifecycle.ts, test suite).
export {
  _clearActiveMediaTokensForTest,
  _setActiveMediaTokenForTest,
  clearLastSuccessfulWallpaper,
  getActiveWallpaperAgents,
  openAgentWallpaperSession,
  setLastSuccessfulWallpaper,
} from './wallpaper/injection-state';
// Types (from wallpaper/injector-types) — only WallpaperInjectorDeps is imported
// by external consumers (agent-engine-service.ts, wallpaper-injector.test.ts).
// Other types (WallpaperService, ResolvedWallpaper, IsEpochCurrent, etc.) are
// used internally via WallpaperInjectorDeps fields — TypeScript resolves them
// automatically, so they don't need to be re-exported.
export type { WallpaperInjectorDeps } from './wallpaper/injector-types';

// ---------------------------------------------------------------------------
// Audio-level broadcast (scene/web wallpapers with render.audioLevel > 0)
// ---------------------------------------------------------------------------
//
// The system output level is sampled in the main process (audio-level.ts) and
// pushed into every agent page that currently shows an audio-responsive web /
// scene wallpaper. The page's signal bridge (buildWpSignalBridgeJs) forwards
// it into the wallpaper iframe via postMessage. One poller is shared across
// all agents; sessions unsubscribe on close / wallpaper removal.

import { onAudioLevel, startAudioLevelPolling, stopAudioLevelPolling } from './audio-level';

/** CDP sessions currently showing an audio-responsive web/scene wallpaper. */
const audioBroadcastSessions = new Set<CdpSession>();

/** Start the shared sampler on first subscriber (idempotent). */
function ensureAudioPoller(): void {
  if (audioBroadcastSessions.size === 0) {
    startAudioLevelPolling((level) => {
      const v = level.toFixed(3);
      for (const session of audioBroadcastSessions) {
        // Fire-and-forget: a closed session just throws and is dropped.
        session.evaluate(`window.AGENTSKIN_WP_AUDIO&&window.AGENTSKIN_WP_AUDIO(${v})`).catch(() => {
          audioBroadcastSessions.delete(session);
        });
      }
    });
  }
}

/** Register a session for audio broadcast; unsubscribes on close. */
function subscribeAudioSession(session: CdpSession): void {
  audioBroadcastSessions.add(session);
  ensureAudioPoller();
}

/** Unregister a session (called on injection failure / wallpaper removal). */
export function unsubscribeAudioSession(session: CdpSession): void {
  audioBroadcastSessions.delete(session);
  if (audioBroadcastSessions.size === 0) stopAudioLevelPolling();
}

/** Drop all audio subscribers + stop the sampler (app shutdown). */
export function disposeAudioBroadcast(): void {
  audioBroadcastSessions.clear();
  stopAudioLevelPolling();
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
 * Returns `{ ok, detail }` — `detail` carries the per-target verdicts (e.g.
 * `image:loadfail:csp-or-unsupported`, `cdp-connect-failed:…`, `epoch-cancelled`)
 * so the caller can surface a precise failure reason to the UI instead of a
 * generic "injection-failed".
 */
export async function injectAgentWallpaper(
  appId: AgentId,
  port: number,
  wallpaperId: string,
  options: WallpaperApplyOptions,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<{ ok: boolean; detail?: string }> {
  if (!deps.wallpaperService) return { ok: false, detail: 'wallpaper-service-unavailable' };
  if (!deps.isEpochCurrent(appId, epoch)) return { ok: false, detail: 'epoch-cancelled' };

  // Resolve the media file path and type via the wallpaper service
  const info = await deps.wallpaperService.mediaInfoFor(wallpaperId);
  if (!info) {
    deps.log(`[wallpaper] ${appId}: no media found for "${wallpaperId}"`);
    return { ok: false, detail: 'wallpaper-not-found' };
  }
  // Surface previewOnly wallpapers (no real animated content — just a static
  // preview thumbnail) so the user knows they're injecting a still image, not
  // the original animated wallpaper. This doesn't block injection (a static
  // image is still a valid wallpaper) but makes the limitation visible.
  if (info.previewOnly) {
    deps.log(
      `[wallpaper] ${appId}: "${wallpaperId}" is preview-only (no animated content — injecting static preview image)`,
    );
  }
  if (!deps.isEpochCurrent(appId, epoch)) return { ok: false, detail: 'epoch-cancelled' };

  // Wait for CDP page targets to register. After ensureCdpReady restarts
  // the agent, the debugging port opens before any page targets appear —
  // resolving targets immediately returns empty, causing a false "injection
  // failed" that forces the user to click again. Poll for up to 15s so a
  // single click suffices even right after a restart.
  const pageTargets = await waitForTargets(deps, appId, port, epoch, 15000);
  if (pageTargets.length === 0) {
    // No page targets means no wallpaper can be displayed — release any
    // token held from a previous wallpaper so it doesn't leak in the
    // loopback server's entries Map.
    setActiveMediaToken(appId, null);
    return { ok: false, detail: 'no-page-target' };
  }
  // Epoch cancelled: a newer apply/restore started during waitForTargets.
  // Don't clean up the token here — the newer operation will call
  // setActiveMediaToken (which unregisters the previous token) as part of
  // its own flow.
  if (!deps.isEpochCurrent(appId, epoch)) return { ok: false, detail: 'epoch-cancelled' };

  // Dispatch based on the wallpaper type. Web and scene wallpapers are
  // rendered via an iframe (web) or a generated canvas HTML (scene), both
  // served by the wallpaper media server as a loopback URL. Video and image
  // wallpapers stream their media file directly.
  let isWeb = info.type === 'web' || info.type === 'scene';

  // Web/scene wallpaper: resolve the rendered-content URL ONCE (shared across
  // all targets). The URL is cached by the wallpaper service so repeated
  // applies reuse the same media-server token.
  let webUrl: string | null = null;
  if (isWeb) {
    // Release any token held from a previous HTTP-streamed video/image
    // wallpaper BEFORE attempting to resolve the web URL — if webUrlFor
    // fails or epoch is cancelled below, the previous token would leak
    // in the loopback server's entries Map forever.
    setActiveMediaToken(appId, null);
    webUrl = await deps.wallpaperService.webUrlFor(wallpaperId);
    if (!webUrl) {
      // Scene wallpapers whose scene.pkg cannot be parsed/rendered (parse
      // failure, no renderable layers, registerHtml failure) still ship a
      // workshop preview image. Fall back to injecting the still preview so
      // the apply doesn't hard-fail on the most common workshop type. Web
      // wallpapers always resolve a URL (index.html is served directly), so
      // this fallback is scene-only.
      if (info.type === 'scene' && info.previewPath) {
        deps.log(
          `[wallpaper] ${appId}: scene "${wallpaperId}" has no renderable content — falling back to preview image`,
        );
        info.path = info.previewPath;
        isWeb = false;
      } else {
        deps.log(`[wallpaper] ${appId}: failed to resolve web URL for "${wallpaperId}"`);
        return { ok: false, detail: 'web-url-resolve-failed' };
      }
    }
    if (!deps.isEpochCurrent(appId, epoch)) return { ok: false, detail: 'epoch-cancelled' };
  }

  // GIF files are image-type wallpapers — browsers render animated GIFs
  // natively in <img> but NOT in <video> (which shows only the first frame).
  // wallpaper-service.ts now classifies .gif as IMAGE_EXTENSIONS, so
  // info.type === 'image' for GIFs. The isImageFile check below is a
  // defense-in-depth fallback for any .gif that might still arrive with
  // type='video' (e.g. from an older cached wallpaper list). Computed AFTER
  // the webUrl block so a scene→preview-image fallback (which rewires
  // info.path + isWeb above) is re-classified as an image here.
  const ext = isWeb ? '' : path.extname(info.path).toLowerCase();
  const isImageFile = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.svg'].includes(ext);
  const isImage = !isWeb && (info.type === 'image' || isImageFile);

  // Resolve the media source ONCE, shared across all targets. For large
  // media streamed over loopback HTTP, register a single token (the same
  // file URL serves every target). For base64/blob paths the file is
  // re-encoded per target inside the loop.
  const imageSize = isImage ? safeFileSize(info.path) : null;
  const videoSize = !isWeb && !isImage ? safeFileSize(info.path) : null;
  const useHttpImage = isImage && imageSize != null && imageSize > getImageBlobThresholdBytes();
  const useHttpVideo = !isWeb && !isImage && videoSize != null && videoSize > VIDEO_HTTP_THRESHOLD;

  let httpUrl: string | null = null;
  let httpMime: string | null = null;
  if (isWeb) {
    // Web/scene wallpapers use the pre-resolved webUrl; no per-agent HTTP
    // token to manage (the wallpaper service caches it by wallpaper id).
  } else if (useHttpImage) {
    const mime = imageMimeForPath(info.path);
    const registered = await wallpaperMediaServer.register(info.path, mime);
    if (registered) {
      setActiveMediaToken(appId, registered.token);
      httpUrl = registered.url;
      httpMime = mime;
    }
  } else if (useHttpVideo) {
    const mime = videoMimeForPath(info.path);
    const registered = await wallpaperMediaServer.register(info.path, mime);
    if (registered) {
      setActiveMediaToken(appId, registered.token);
      httpUrl = registered.url;
      httpMime = mime;
    }
  } else {
    // Blob-only path (no HTTP token issued). Release any token held from a
    // previous HTTP-streamed wallpaper so the entries Map does not outlive
    // the wallpaper it serves.
    setActiveMediaToken(appId, null);
  }

  // Inject into a single target's session. Returns { ok, verdict }.
  const injectOne = async (session: CdpSession): Promise<{ ok: boolean; verdict: string }> => {
    // Web / scene wallpaper: mount an iframe pointing at the rendered HTML.
    if (isWeb && webUrl) {
      const webResult = await injectWebWallpaper(session, {
        url: webUrl,
        scrimOpacity: options.scrimOpacity,
        render: options.render,
      });
      if (webResult.ok) return { ok: true, verdict: 'ok' };
      // The iframe failed to load (CSP frame-src block, or the rendered HTML
      // exceeded the iframe watchdog). Scene wallpapers still ship their
      // workshop preview image (preview.jpg/png/gif) — mount it as a static
      // wallpaper so the agent page never goes black on the most common
      // workshop type. The preview fallback reuses the same image path as a
      // direct image wallpaper (base64/blob/HTTP dispatch below), so the
      // scrim and punch-through behavior are identical.
      if (info.type === 'scene' && info.previewPath) {
        const imgResult = await injectImageWallpaper(session, {
          imagePath: info.previewPath,
          scrimOpacity: options.scrimOpacity,
          render: options.render,
        });
        return {
          ok: imgResult.ok,
          verdict: imgResult.ok
            ? `web:${webResult.verdict}|scene-preview:ok`
            : `web:${webResult.verdict}|scene-preview:${imgResult.verdict}`,
        };
      }
      return { ok: webResult.ok, verdict: webResult.ok ? 'ok' : `web:${webResult.verdict}` };
    }
    if (isImage) {
      if (useHttpImage && httpUrl) {
        const urlResult = await injectImageWallpaperByUrl(session, {
          url: httpUrl,
          scrimOpacity: options.scrimOpacity,
          render: options.render,
        });
        if (urlResult.ok) return { ok: true, verdict: `image-http:${urlResult.verdict}` };
        // HTTP stream failed (likely CSP blocked the loopback URL) — fall
        // back to in-page base64 injection. data: URLs bypass network-level
        // CSP because the data is inline, not fetched. This mirrors the
        // video stream → blob fallback and is the key fix for multi-agent
        // image wallpaper injection: without it, agents with header-based
        // CSP that blocks loopback URLs (e.g. qoderwork webviews) could
        // never display an image wallpaper while other agents succeeded.
        if (imageSize != null && imageSize <= IMAGE_BLOB_FALLBACK_CAP) {
          const imgResult = await injectImageWallpaper(session, {
            imagePath: info.path,
            scrimOpacity: options.scrimOpacity,
            forceInject: true,
            render: options.render,
          });
          return {
            ok: imgResult.ok,
            verdict: `image-http:${urlResult.verdict}|image-blob:${imgResult.verdict}`,
          };
        }
        return { ok: false, verdict: `image-http:${urlResult.verdict}` };
      }
      const imgResult = await injectImageWallpaper(session, {
        imagePath: info.path,
        scrimOpacity: options.scrimOpacity,
        render: options.render,
      });
      return { ok: imgResult.ok, verdict: imgResult.ok ? 'ok' : `image:${imgResult.verdict}` };
    }
    // Video
    const mime = httpMime ?? videoMimeForPath(info.path);
    if (useHttpVideo && httpUrl) {
      const streamResult = await injectVideoWallpaper(session, {
        src: httpUrl,
        mime,
        speed: options.speed,
        loop: options.loop,
        scrimOpacity: options.scrimOpacity,
        render: options.render,
      });
      if (streamResult.ok) return { ok: true, verdict: `stream:${streamResult.verdict}` };
      // Streamed mount failed — fall back to in-page base64 blob if small enough.
      // NOTE: The previous "skip blob on src-not-supported" optimization was
      // REVERTED because log evidence proved src-not-supported is NOT a codec
      // issue (same file: codex blob:ok, qoderwork blob:src-not-supported —
      // both Electron, same codec capability). The real cause is CSP/protocol
      // differences across agent webviews, so blob fallback (data: URL) may
      // succeed via a different loading path even when stream (loopback HTTP)
      // is blocked.
      if (videoSize != null && videoSize <= VIDEO_BLOB_FALLBACK_CAP) {
        const blobResult = await injectVideoWallpaperByBase64(session, {
          videoPath: info.path,
          speed: options.speed,
          loop: options.loop,
          scrimOpacity: options.scrimOpacity,
          render: options.render,
        });
        return {
          ok: blobResult.ok,
          verdict: `stream:${streamResult.verdict}|blob:${blobResult.verdict}`,
        };
      }
      return { ok: false, verdict: `stream:${streamResult.verdict}` };
    }
    const blobResult = await injectVideoWallpaperByBase64(session, {
      videoPath: info.path,
      speed: options.speed,
      loop: options.loop,
      scrimOpacity: options.scrimOpacity,
      render: options.render,
    });
    return { ok: blobResult.ok, verdict: `blob:${blobResult.verdict}` };
  };

  // Primary-target-wins semantics: the FIRST target in pageTargets is the
  // main visible window (resolvePageTargets returns adapter-matched targets
  // in discovery order, with the main page first). The overall ok/fail is
  // determined by the primary target alone. Secondary targets (background
  // pages, auxiliary webviews) are still injected best-effort, but their
  // success cannot mask a primary failure — this fixes the QoderWork/Doubao
  // bug where a background page succeeded while the visible window failed,
  // causing a false "injection successful" report.
  //
  // PARALLEL INJECTION: all targets are injected concurrently via Promise.allSettled.
  // The primary target (index 0) determines the overall ok/fail. Secondary
  // targets run in parallel but their results only contribute verdicts, not
  // to the primary decision. This reduces total injection time from
  // N × (connect + wait + inject + retry) to max(connect + wait + inject + retry)
  // — critical for WorkBuddy's 13+ CDP targets.
  const verdicts: string[] = [];
  let primaryOk = false;

  const injectTarget = async (
    pageTarget: { webSocketDebuggerUrl: string },
    isPrimary: boolean,
  ): Promise<{ ok: boolean; verdict: string }> => {
    const pageWsUrl = pageTarget.webSocketDebuggerUrl;
    let session: CdpSession;
    try {
      session = await connectCdp(pageWsUrl, 4000, 30000);
    } catch (error) {
      return { ok: false, verdict: `cdp-connect-failed:${toMessage(error)}` };
    }
    try {
      await waitForPageReady(session, 10000, deps.log);
      if (!deps.isEpochCurrent(appId, epoch)) {
        return { ok: false, verdict: 'epoch-cancelled' };
      }
      let { ok, verdict } = await injectOne(session);
      if (!ok) {
        deps.log(
          `[wallpaper] ${appId}: ${isPrimary ? 'primary' : 'secondary'} target first attempt failed (${verdict}), retrying in 2s…`,
        );
        await new Promise((r) => setTimeout(r, 2000));
        if (!deps.isEpochCurrent(appId, epoch)) {
          return { ok: false, verdict: 'epoch-cancelled' };
        }
        await waitForPageReady(session, 5000, deps.log);
        ({ ok, verdict } = await injectOne(session));
        if (ok) verdict = `${verdict}|retry:ok`;
      }
      // Web/scene wallpapers with audio responsiveness keep a live session so
      // the main process can push the system audio level into the iframe.
      if (ok && isWeb && options.render?.audioLevel && options.render.audioLevel > 0) {
        subscribeAudioSession(session);
      }
      return { ok, verdict };
    } catch (error) {
      return { ok: false, verdict: `error:${toMessage(error)}` };
    } finally {
      // Non-audio sessions close immediately; audio sessions are tracked for
      // broadcast and closed on removal/restore via unsubscribeAudioSession.
      if (!isWeb || !options.render?.audioLevel || options.render.audioLevel <= 0) {
        session.close();
      }
    }
  };

  // Launch all target injections in parallel.
  const results = await Promise.allSettled(
    pageTargets.map((pageTarget, i) => injectTarget(pageTarget, i === 0)),
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      verdicts.push(r.value.verdict);
      if (i === 0) {
        primaryOk = r.value.ok;
      }
    } else {
      verdicts.push(`fatal:${toMessage(r.reason)}`);
      if (i === 0) {
        primaryOk = false;
      }
    }
  }

  // Empty verdicts means the loop never executed a single injection attempt —
  // every target was either cancelled by a new epoch or failed at connectCdp
  // (which pushes its own verdict, so this branch is mainly the epoch-cancel
  // case). Without this, the summary log would read "failed []" which gives
  // no clue why injection never happened.
  if (verdicts.length === 0) {
    const cancelled = !deps.isEpochCurrent(appId, epoch);
    verdicts.push(cancelled ? 'epoch-cancelled' : 'no-attempt');
  }

  // If an HTTP token was registered but the PRIMARY target didn't mount the
  // wallpaper, the URL is unreferenced — release the token so it doesn't leak
  // in the server. (Web/scene tokens are cached by the wallpaper service, not
  // here, so they are not released on injection failure — they'll be reused
  // on retry.)
  if (!primaryOk && !isWeb && (useHttpImage || useHttpVideo)) setActiveMediaToken(appId, null);

  // Track video wallpapers for lifecycle pause/resume broadcast.
  // Web/scene wallpapers don't have a <video> element to pause, so they're
  // not tracked here (the iframe keeps running independently).
  if (primaryOk && !isImage && !isWeb) setActiveWallpaperAgent(appId, port);
  else clearActiveWallpaperAgent(appId);

  deps.log(
    `[wallpaper] ${appId}: ${info.type} wallpaper ${primaryOk ? 'injected' : 'failed'} [${verdicts.join(', ')}] (${path.basename(info.path)}, ${pageTargets.length} target${pageTargets.length === 1 ? '' : 's'})`,
  );
  return { ok: primaryOk, detail: primaryOk ? undefined : verdicts.join(', ') };
}

// ---------------------------------------------------------------------------
// injectWithFallback — failure recovery wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap {@link injectAgentWallpaper} with automatic fallback to the last
 * successful wallpaper. If the injection fails, re-injects the previous
 * wallpaper so the agent page doesn't go black.
 *
 * Why this is needed: every CDP injection function (mountVideoWallpaper,
 * injectImageWallpaper, etc.) starts by clearing old wallpaper elements
 * (Step 1), then mounts the new wallpaper (Step 2). If Step 2 fails, the
 * old wallpaper is already gone — the page flashes to black. Without this
 * wrapper, the user's only recourse is to click "apply" again and hope it
 * works this time.
 *
 * The fallback only fires when ALL of the following are true:
 *   1. The current attempt failed (ok === false).
 *   2. A previous successful wallpaper exists in `lastSuccessfulWallpaper`.
 *   3. The previous wallpaper's id differs from the current attempt (no
 *      point re-injecting the same wallpaper that just failed).
 *   4. The epoch is still current (no new apply/restore started during
 *      the failed attempt).
 *   5. The fallback wallpaper still exists in the wallpaper service (it
 *      may have been deleted from disk).
 *
 * On fallback success, returns `{ ok: true, detail: 'fallback:<id>' }` so
 * the caller knows the original injection failed but was recovered. The
 * detail is surfaced to the UI so the user understands what happened.
 *
 * The fallback does NOT recurse: it calls {@link injectAgentWallpaper}
 * directly (not itself), so a fallback failure stays a failure.
 *
 * Exported for unit testing.
 */
export async function injectWithFallback(
  appId: AgentId,
  port: number,
  wallpaperId: string,
  options: WallpaperApplyOptions,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<{ ok: boolean; detail?: string }> {
  const result = await injectAgentWallpaper(appId, port, wallpaperId, options, epoch, deps);

  if (result.ok) {
    // Success — record this as the last successful wallpaper for fallback.
    setLastSuccessfulWallpaper(appId, wallpaperId, options);
    recordInjectionSuccess(appId);
    return result;
  }

  // Failure — attempt fallback to the last successful wallpaper.
  const last = getLastSuccessfulWallpaper(appId);
  if (!last || last.wallpaperId === wallpaperId) {
    // No previous wallpaper to fall back to, or it's the same wallpaper
    // that just failed (re-injecting the same thing won't help).
    recordInjectionFailure(appId);
    return result;
  }
  if (!deps.isEpochCurrent(appId, epoch)) {
    // A new apply/restore started during the failed attempt — don't
    // race it with a fallback. Don't record failure either (epoch cancel
    // is not a real injection failure).
    return result;
  }

  // Verify the fallback wallpaper still exists before attempting re-injection.
  // The user may have deleted the wallpaper file between the original apply
  // and this fallback attempt.
  if (deps.wallpaperService) {
    const info = await deps.wallpaperService.mediaInfoFor(last.wallpaperId);
    if (!info) {
      deps.log(
        `[wallpaper] ${appId}: fallback wallpaper "${last.wallpaperId}" no longer exists, cannot recover`,
      );
      clearLastSuccessfulWallpaper(appId);
      return result;
    }
  }

  deps.log(
    `[wallpaper] ${appId}: injection of "${wallpaperId}" failed, falling back to last successful wallpaper "${last.wallpaperId}"…`,
  );
  const fallbackResult = await injectAgentWallpaper(
    appId,
    port,
    last.wallpaperId,
    last.options,
    epoch,
    deps,
  );
  if (fallbackResult.ok) {
    deps.log(
      `[wallpaper] ${appId}: fallback to "${last.wallpaperId}" succeeded — agent page recovered from black screen`,
    );
    recordInjectionSuccess(appId);
    return { ok: true, detail: `fallback:${last.wallpaperId}` };
  }
  deps.log(
    `[wallpaper] ${appId}: fallback to "${last.wallpaperId}" also failed — agent page may be black`,
  );
  recordInjectionFailure(appId);
  return result;
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
  setWallpaperDeps(deps);
  if (!resolved.id) {
    // No wallpaper configured — remove any stale wallpaper from ALL targets.
    // Injection iterates every compatible target, so removal must too.
    await removeAllWallpapersFromAllTargets(deps, appId, port);
    if (!deps.isEpochCurrent(appId, epoch)) return;
    // No wallpaper resolved for this apply → any previously-issued HTTP
    // token for this agent is now stale. Release it.
    setActiveMediaToken(appId, null);
    clearActiveWallpaperAgent(appId);
    clearLastSuccessfulWallpaper(appId);
    return;
  }
  await injectWithFallback(
    appId,
    port,
    resolved.id,
    {
      speed: resolved.speed,
      loop: resolved.loop,
      scrimOpacity: resolved.scrimOpacity,
      ...(resolved.render ? { render: resolved.render } : {}),
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
  // Remove from ALL targets (injection iterates every compatible target,
  // so removal must too — otherwise wallpaper elements linger on secondary
  // targets like Doubao's background page or WorkBuddy's webviews).
  const cleaned = await removeAllWallpapersFromAllTargets(deps, appId, port);
  if (!deps.isEpochCurrent(appId, epoch)) return;
  // Release the media-server token (if any) held for this agent so the
  // underlying file path is no longer referenced. Without this, the
  // entries Map would accumulate one token per apply across the agent's
  // lifetime — see the `activeMediaTokens` docblock above.
  setActiveMediaToken(appId, null);
  clearActiveWallpaperAgent(appId);
  clearLastSuccessfulWallpaper(appId);
  deps.log(
    `[wallpaper] ${appId}: removed all wallpapers during restore (${cleaned} target${cleaned === 1 ? '' : 's'})`,
  );
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
 * **Two-phase CDP discovery** — unified with the theme apply flow via
 * {@link ensureAgentCdpReady} (see `cdp/cdp-ready.ts`):
 *   - Phase 1 (default): probe only via `resolveLivePort`. If no CDP port
 *     is found, returns `{ ok: false, reason: 'requires-restart',
 *     restartReason }` so the UI can prompt the user for explicit consent.
 *   - Phase 2 (after user confirms): pass `restartExisting: true` to allow
 *     `ensureCdpReady` to kill + relaunch the agent with CDP enabled — or
 *     LAUNCH a not-running agent from its install path, so the user no
 *     longer has to start the agent manually first.
 *
 * This two-phase flow guarantees an app is only ever restarted after an
 * explicit user "Restart & apply" click — never silently on the first
 * attempt.
 *
 * Returns `{ ok, reason, restartReason }` so the UI can surface a precise
 * error when the agent is not running, not installed, or needs a restart.
 */
export async function applyAgentWallpaperNow(
  appId: AgentId,
  deps: WallpaperInjectorDeps,
  options: { restartExisting?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; detail?: string; restartReason?: RestartReason }> {
  const resolved = await deps.resolveAgentWallpaperId(appId);
  setWallpaperDeps(deps);

  // Two-phase CDP discovery (shared policy with the theme apply flow):
  // probe first, restart/launch only with explicit consent.
  const cdp = await ensureAgentCdpReady(appId, deps, {
    restartExisting: options.restartExisting === true,
  });
  if (cdp.status === 'requires-restart') {
    return {
      ok: false,
      reason: 'requires-restart',
      restartReason: cdp.restartReason,
    };
  }
  const port = cdp.port;

  // No wallpaper → remove any existing wallpaper from ALL targets.
  if (!resolved.id) {
    const cleaned = await removeAllWallpapersFromAllTargets(deps, appId, port);
    if (cleaned === 0) {
      // No targets found at all — check if any targets exist for a better error.
      const targets = await resolvePageTargets(deps, appId, port);
      if (targets.length === 0) return { ok: false, reason: 'no-page-target' };
    }
    // No wallpaper configured → any previously-issued HTTP token is stale.
    setActiveMediaToken(appId, null);
    clearActiveWallpaperAgent(appId);
    clearLastSuccessfulWallpaper(appId);
    deps.log(`[wallpaper] ${appId}: removed (no wallpaper configured)`);
    return { ok: true };
  }

  // Inject the wallpaper. Use a fresh epoch so this doesn't get cancelled
  // by a stale apply flow (the caller is the user, acting right now).
  const epoch = deps.bumpEpoch(appId);
  const result = await injectWithFallback(
    appId,
    port,
    resolved.id,
    {
      speed: resolved.speed,
      loop: resolved.loop,
      scrimOpacity: resolved.scrimOpacity,
      ...(resolved.render ? { render: resolved.render } : {}),
    },
    epoch,
    deps,
  );
  return result.ok
    ? { ok: true, detail: result.detail }
    : { ok: false, reason: 'injection-failed', detail: result.detail };
}

// ---------------------------------------------------------------------------
// applyWallpaperToAgent (UI entry point)
// ---------------------------------------------------------------------------

/**
 * Apply a specific wallpaper to a specific agent. Persists the per-agent
 * preference and immediately injects via CDP. This is the primary entry
 * point from the Wallpaper Engine UI page.
 *
 * **Two-phase CDP discovery** (unified with the theme apply flow via
 * {@link ensureAgentCdpReady}, matches `applyAgentWallpaperNow`):
 *   - Phase 1 (default): probe only via `resolveLivePort`. If no CDP port
 *     is found, returns `{ ok: false, reason: 'requires-restart',
 *     restartReason }` so the UI can prompt the user for explicit consent.
 *   - Phase 2 (after user confirms): pass `restartExisting: true` to allow
 *     `ensureCdpReady` to kill + relaunch the agent with CDP enabled — or
 *     LAUNCH a not-running agent from its install path.
 */
export async function applyWallpaperToAgent(
  wallpaperId: string,
  appId: AgentId,
  deps: WallpaperInjectorDeps,
  options: { restartExisting?: boolean } = {},
): Promise<{ ok: boolean; reason?: string; detail?: string; restartReason?: RestartReason }> {
  if (!deps.wallpaperService) return { ok: false, reason: 'wallpaper-service-unavailable' };
  setWallpaperDeps(deps);

  // Verify the wallpaper exists
  const info = await deps.wallpaperService.mediaInfoFor(wallpaperId);
  if (!info) return { ok: false, reason: 'wallpaper-not-found' };

  // Persist the per-agent preference
  await deps.setAgentWallpaper(appId, { enabled: true, id: wallpaperId });

  // Two-phase CDP discovery (shared policy with the theme apply flow):
  // probe first, restart/launch only with explicit consent.
  const cdp = await ensureAgentCdpReady(appId, deps, {
    restartExisting: options.restartExisting === true,
  });
  if (cdp.status === 'requires-restart') {
    return {
      ok: false,
      reason: 'requires-restart',
      restartReason: cdp.restartReason,
    };
  }
  const port = cdp.port;

  // Resolve the effective wallpaper options (speed/loop/scrimOpacity) from
  // the per-agent setting we just persisted + theme defaults. Passing an
  // empty object {} would use hardcoded defaults, causing a brief opacity
  // flash before the next apply cycle corrects it.
  const resolved = await deps.resolveAgentWallpaperId(appId);

  // Inject with a fresh epoch
  const epoch = deps.bumpEpoch(appId);
  const result = await injectWithFallback(
    appId,
    port,
    wallpaperId,
    {
      speed: resolved.speed,
      loop: resolved.loop,
      scrimOpacity: resolved.scrimOpacity,
      ...(resolved.render ? { render: resolved.render } : {}),
    },
    epoch,
    deps,
  );
  return result.ok
    ? { ok: true, detail: result.detail }
    : { ok: false, reason: 'injection-failed', detail: result.detail };
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

  clearActiveWallpaperAgent(appId);
  clearLastSuccessfulWallpaper(appId);
  const epoch = deps.bumpEpoch(appId);
  await removeAgentVideoWallpaper(appId, port, epoch, deps);
  return { ok: true };
}
