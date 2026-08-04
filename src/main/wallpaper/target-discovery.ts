// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/target-discovery
 *
 * CDP target resolution and readiness polling for wallpaper injection.
 * Extracted from `wallpaper-injector.ts`.
 *
 * Contents:
 *   - **Constants**: `VIDEO_HTTP_THRESHOLD`, `VIDEO_BLOB_FALLBACK_CAP`,
 *     `IMAGE_BLOB_FALLBACK_CAP` — size thresholds that decide HTTP stream
 *     vs. in-page base64 blob.
 *   - **Target resolution**: `resolvePageTarget` (single), `resolvePageTargets`
 *     (all matching) — uses the adapter's `matchTarget` filter (same policy
 *     as theme injection) so wallpaper lands on the right page.
 *   - **Readiness polling**: `waitForPageReady` (document.readyState),
 *     `waitForTargets` (CDP target registration with epoch-aware cancellation).
 *   - **Utility**: `safeFileSize` — null-safe `statSync`.
 *
 * Dependency: imports types from {@link ./types} and `toMessage` from
 * `shared/errors`. No circular dependencies.
 */

import { statSync } from 'node:fs';
import { toMessage } from '../../shared/errors';
import type { AgentId } from '../../shared/types';
import type { CdpSession } from '../cdp/cdp-client';
import { type CdpTarget, filterForCdpConnectivity } from '../cdp/cdp-targets';
import type { WallpaperInjectorDeps } from './injector-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Files larger than this are streamed from the local HTTP server instead of
 *  being base64-assembled in the agent renderer (keeps the agent's JS heap
 *  small for big video wallpapers). */
export const VIDEO_HTTP_THRESHOLD = 50 * 1024 * 1024;

/** When the streamed HTTP mount fails to load (e.g. a media-src CSP blocks
 *  loopback URLs), we fall back to the in-page base64 blob path. Blob keeps
 *  the full file in the agent's JS heap (~1.3x), so we only allow the
 *  fallback for files below this cap — above it, a CSP-blocked large video
 *  gets a clear error instead of risking an OOM in the agent renderer. */
export const VIDEO_BLOB_FALLBACK_CAP = 120 * 1024 * 1024;

/** When the streamed HTTP image mount fails (e.g. an img-src CSP blocks
 *  loopback URLs), we fall back to in-page base64 injection. data: URLs
 *  bypass network-level CSP because the data is inline, not fetched. This
 *  cap is higher than getImageBlobThresholdBytes() (the normal threshold
 *  above which images are streamed) because the fallback path uses
 *  forceInject to skip the size check — better to risk a large base64
 *  transfer than show no wallpaper at all. Images are generally much
 *  smaller than videos, so 50MB is a safe upper bound. */
export const IMAGE_BLOB_FALLBACK_CAP = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------

/** Resolve the main page target using the agent's adapter matchTarget filter
 *  (identical policy to theme injection), so wallpaper lands on the right
 *  page even when an agent exposes multiple CDP targets.
 *
 *  Unlike the previous implementation, we do NOT re-filter with
 *  `pickPageTarget` on top of `matchTarget`. The adapter's `matchTarget` is
 *  the single source of truth for which targets are compatible (theme
 *  injection uses it directly via `waitForTargets` → `findTargets`).
 *  Applying `pickPageTarget` as a second filter rejected `webview` and
 *  `iframe` targets that some adapters (notably WorkBuddy) legitimately
 *  accept, causing wallpaper injection to silently find zero targets while
 *  theme injection worked fine. */
export async function resolvePageTarget(
  deps: WallpaperInjectorDeps,
  appId: AgentId,
  port: number,
): Promise<CdpTarget | undefined> {
  try {
    const targets = filterForCdpConnectivity(await deps.findAgentTargets(appId, port));
    // Prefer 'page' type, but accept any target the adapter's matchTarget
    // approved (including 'webview' for WorkBuddy). filterForCdpConnectivity
    // already ensured all targets have a usable webSocketDebuggerUrl.
    return targets.find((t) => t.type === 'page') ?? targets[0];
  } catch (error) {
    deps.log(
      `[wallpaper] ${appId}: resolvePageTarget findAgentTargets failed — ${toMessage(error)}`,
    );
    return undefined;
  }
}

/** Resolve ALL matching page targets. Some agents (notably Doubao) expose
 *  multiple `page` targets that all pass the adapter's matchTarget filter —
 *  e.g. a background/boot page plus the visible chat window. Theme injection
 *  iterates every compatible target, so wallpaper must do the same: injecting
 *  only the first target (via {@link resolvePageTarget}) can land the wallpaper
 *  on a hidden page while the visible window stays bare.
 *
 *  Returns every target that the adapter's `matchTarget` approved AND that has
 *  a usable `webSocketDebuggerUrl`. We intentionally do NOT re-filter with
 *  `pickPageTarget` — that would reject `webview`/`iframe` targets that some
 *  adapters (WorkBuddy) legitimately accept, breaking wallpaper injection
 *  while theme injection (which uses `matchTarget` alone) works fine. */
export async function resolvePageTargets(
  deps: WallpaperInjectorDeps,
  appId: AgentId,
  port: number,
): Promise<CdpTarget[]> {
  try {
    const targets = await deps.findAgentTargets(appId, port);
    // Apply filterForCdpConnectivity to exclude targets that have a
    // webSocketDebuggerUrl but are unlikely to accept CDP connections —
    // notably cross-origin iframes loaded from loopback URLs (wallpaper-server).
    // Without this filter, injection attempts on non-connectable iframe targets
    // fail with "CDP connection failed" errors, wasting time and producing
    // confusing log noise. The filter is a superset of the previous
    // `Boolean(t.webSocketDebuggerUrl)` check.
    return filterForCdpConnectivity(targets);
  } catch (error) {
    deps.log(
      `[wallpaper] ${appId}: resolvePageTargets findAgentTargets failed — ${toMessage(error)}`,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Null-safe file size probe. */
export function safeFileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Readiness polling
// ---------------------------------------------------------------------------

/**
 * Wait for the agent page to reach `document.readyState === 'complete'`
 * before wallpaper injection. After an agent restart (ensureCdpReady),
 * CDP targets appear within seconds but the DOM may still be loading —
 * injecting into a half-loaded page fails because the root element
 * doesn't exist yet, CSP headers haven't been applied, or the renderer
 * is still initializing its media stack.
 *
 * Polls every 500ms up to `timeoutMs`. Best-effort: if the page never
 * reaches 'complete' (e.g. a long-running SPA boot), we proceed anyway
 * — the injection's own error handling will surface the failure.
 */
export async function waitForPageReady(
  session: CdpSession,
  timeoutMs: number,
  log?: (line: string) => void,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const state = await session.evaluate('document.readyState');
      if (state === 'complete') return;
    } catch (error) {
      // evaluate failed — page may not have a document yet. Log (debug-level)
      // so a persistent evaluate failure (e.g. detached session) is visible.
      log?.(`[wallpaper] waitForPageReady: evaluate failed (retrying) — ${toMessage(error)}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Wait for at least one CDP page target to become available for an agent.
 *
 * After `ensureCdpReady` restarts an agent, the CDP debugging port opens
 * before any page targets register with the DevTools discovery endpoint.
 * Calling `resolvePageTargets` at that point returns an empty array, causing
 * `injectAgentWallpaper` to bail out with `false` — the user then has to
 * click the apply button again (by which time targets have appeared).
 *
 * This was the root cause of "需要点好几次才行": the first click restarted
 * the agent and failed injection (no targets yet); the second click found
 * targets already live and succeeded. Polling here collapses the two-click
 * flow into one.
 *
 * Polls every 1s up to `timeoutMs`, checking epoch on each iteration so a
 * new apply/restore cancels the wait cleanly. Returns whatever targets are
 * available when the deadline expires (may be empty).
 */
export async function waitForTargets(
  deps: WallpaperInjectorDeps,
  appId: AgentId,
  port: number,
  epoch: number,
  timeoutMs: number,
): Promise<CdpTarget[]> {
  const deadline = Date.now() + timeoutMs;
  let firstAttempt = true;
  while (Date.now() < deadline) {
    if (!deps.isEpochCurrent(appId, epoch)) return [];
    const targets = await resolvePageTargets(deps, appId, port);
    if (targets.length > 0) {
      if (!firstAttempt) {
        deps.log(
          `[wallpaper] ${appId}: targets available after wait (${targets.length} target(s))`,
        );
      }
      return targets;
    }
    if (firstAttempt) {
      deps.log(`[wallpaper] ${appId}: no CDP targets yet — waiting up to ${timeoutMs / 1000}s…`);
      firstAttempt = false;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return [];
}
