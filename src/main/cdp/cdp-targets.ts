// SPDX-License-Identifier: MPL-2.0

/**
 * CDP target discovery helpers and unified CDP readiness for the main process.
 *
 * ## Target discovery
 *
 * Reuses the engine layer's `listCdpTargets` (single source of truth for the
 * HTTP fetch + JSON parsing + timeout/error handling) and adds thin filter
 * helpers for the three target-class policies used across agent-engine-service:
 *
 *   - findPageTarget:     type === 'page'                       (main window)
 *   - findDomTargets:     page | webview | iframe               (all DOM-bearing)
 *   - findSecondaryTargets: webview | iframe                    (exclude main page)
 *
 * `listCdpTargets` and `CdpTarget` are imported from `legacy/agentskin-core-runtime`
 * (the SINGLE bridge to @agentskin/engine) rather than directly from the engine,
 * preserving the layered import contract.
 *
 * Prior to this module, agent-engine-service.ts inlined `fetch /json/list`
 * with ad-hoc type assertions 8 times, leading to inconsistent error handling
 * and type drift from the authoritative `CdpTarget` interface.
 *
 * ## Unified CDP readiness (shared by theme + wallpaper apply)
 *
 * Both the theme apply flow (`applyThemeFlow`) and the wallpaper apply flow
 * (`applyAgentWallpaperNow` / `applyWallpaperToAgent`) need the same answer to
 * the same question: **"does this agent have a live CDP endpoint, and if not,
 * what does the user need to do?"**
 *
 * Previously the two flows hand-mirrored this logic with subtly different
 * semantics (wallpaper returned coarse string reasons, theme returned a
 * structured `restartReason`; the wallpaper entries even disagreed on the
 * `not-installed` naming). This module is the single source of truth:
 *
 *   - **Phase 1 (default)** — probe via `resolveLivePort`. If no CDP port is
 *     found we classify the situation:
 *       - `not-running` (installed, not started) → **auto-launch the app**
 *         via `ensureCdpReady` (which spawns a not-running agent with CDP).
 *         Starting an app the user asked to apply to is NOT a restart — no
 *         confirmation needed.
 *       - `no-cdp` (running WITHOUT a debug port) → returning
 *         `requires-restart` so the UI shows a confirmation dialog — killing
 *         a running app is destructive and needs consent.
 *       - `not-installed` / `spawn-failed` → `requires-restart` so the UI
 *         can guide the user (install / retry).
 *   - **Phase 2 (after the user confirms a restart)** — `restartExisting:
 *     true` allows `ensureCdpReady` to kill + relaunch the agent with
 *     `--remote-debugging-port=0`.
 *
 * Net effect: the ONLY time the user sees a restart/launch confirmation is
 * when the agent is already running without a debug port (a real restart).
 * A first click on an idle agent just starts it and applies.
 */

import type { CdpTarget } from '../../legacy/agentskin-core-runtime';
import { listCdpTargets } from '../../legacy/agentskin-core-runtime';
import type { AgentId, RestartReason } from '../../shared/types';
import type { CdpReadyResult } from '../app-discovery';

export type { CdpTarget };

// ---------------------------------------------------------------------------
// Per-port target list cache (RFC §4.3)
// ---------------------------------------------------------------------------

/**
 * TTL cache for `listTargets` results, keyed by port (800ms).
 *
 * Why this cache: a single apply calls `findDomTargets` (hardening) and
 * `findSecondaryTargets` (secondary inject), and `withPageSession` calls
 * adapter.findTargets / listTargets again — each hitting the HTTP `/json/list`
 * endpoint. Caching the list for 800ms collapses those repeated fetches within
 * one apply window into a single request while still catching a freshly-
 * registered target (WorkBuddy's targets appear over ~1s after launch).
 *
 * The cache is module-level (like the shared discovery snapshots) and
 * invalidated on every epoch bump via {@link clearTargetsCache}. Only
 * non-empty results are cached — an empty list may mean "endpoint not ready
 * yet" and must always be re-fetched.
 */
interface TargetsSnapshot {
  port: number;
  targets: CdpTarget[];
  capturedAt: number;
}
let cachedTargets: TargetsSnapshot | null = null;
const TARGETS_TTL_MS = 800;

/** Drop the cached target list for all ports (epoch bump / tests). */
export function clearTargetsCache(port?: number): void {
  if (port === undefined || cachedTargets?.port === port) {
    cachedTargets = null;
  }
}

/** Fetch all CDP targets on the given port. Returns [] on any fetch/parse error. */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  const now = Date.now();
  if (
    cachedTargets &&
    cachedTargets.port === port &&
    now - cachedTargets.capturedAt < TARGETS_TTL_MS
  ) {
    return cachedTargets.targets;
  }
  let targets: CdpTarget[] = [];
  try {
    targets = await listCdpTargets(port);
  } catch {
    targets = [];
  }
  // Cache only non-empty results — an empty list may be a transient
  // "endpoint not ready" state and must not linger for 800ms.
  if (targets.length > 0) {
    cachedTargets = { port, targets, capturedAt: now };
  }
  return targets;
}

/** Find the main page target (type === 'page'). Returns undefined if none. */
export async function findPageTarget(port: number): Promise<CdpTarget | undefined> {
  const targets = await listTargets(port);
  return pickPageTarget(targets);
}

/**
 * Pick the main page target from an already-fetched target list.
 *
 * P1 audit #26: previously treated a missing `type` as 'page' (per the CDP
 * spec's default). But some Electron internal targets (devtools panels,
 * service workers, shared workers) occasionally omit `type`, and treating
 * them as pages led to theme CSS being evaluated in the wrong context
 * (devtools panel, worker global). Now requires `type` to be explicitly
 * `'page'` OR missing-and-url-looks-like-a-page (http/https/file scheme),
 * so internal targets with non-page URLs are skipped even when they omit
 * `type`.
 *
 * Used by callers that already have targets in hand (e.g. after
 * adapter.findTargets, which applies matchTarget filtering) so they don't
 * pay for a second /json/list round-trip.
 */
export function pickPageTarget(targets: readonly CdpTarget[]): CdpTarget | undefined {
  return targets.find((t) => {
    if (!t.webSocketDebuggerUrl) return false;
    if (t.type === 'page') return true;
    // Accept a missing `type` ONLY when the URL looks like a real page
    // (http/https/file). This catches Chromium's occasional omission of
    // `type` on real page targets while rejecting devtools / worker URLs
    // (chrome-devtools://, devtools://, ws://, etc.) that also omit it.
    if (t.type === undefined || t.type === null) {
      const url = t.url ?? '';
      return url.startsWith('http://') || url.startsWith('https://') || url.startsWith('file://');
    }
    return false;
  });
}

/** Find all DOM-bearing targets: page + webview + iframe (excludes workers). */
export async function findDomTargets(port: number): Promise<CdpTarget[]> {
  const targets = await listTargets(port);
  return targets.filter(
    (t) =>
      (t.type === 'page' || t.type === 'webview' || t.type === 'iframe') &&
      Boolean(t.webSocketDebuggerUrl),
  );
}

/** Find secondary targets: webview + iframe (excludes the main page, which is
 *  handled by adapter.applyTheme). */
export async function findSecondaryTargets(port: number): Promise<CdpTarget[]> {
  const targets = await listTargets(port);
  return targets.filter(
    (t) => (t.type === 'webview' || t.type === 'iframe') && Boolean(t.webSocketDebuggerUrl),
  );
}

/**
 * Filter out targets that are unlikely to support CDP connections.
 * Cross-origin iframes loaded via loopback URLs from wallpaper-server
 * typically don't expose a webSocketDebuggerUrl because they're not
 * debuggable Chrome targets — they're just DOM nodes inside a parent page.
 */
export function filterForCdpConnectivity(targets: readonly CdpTarget[]): CdpTarget[] {
  return targets.filter((t) => {
    // If there's no ws debugger URL at all, skip it.
    if (!t.webSocketDebuggerUrl) return false;
    // If this is an iframe/webview target with a loopback URL,
    // it likely won't accept CDP connections. Skip it.
    if ((t.type === 'iframe' || t.type === 'webview') && (t.url ?? '').includes('127.0.0.1')) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Unified CDP readiness (shared by theme + wallpaper apply)
// ---------------------------------------------------------------------------

/** The discovery slice both apply flows already wire from
 *  `AgentEngineService` (identical implementations in `applyFlowDeps` and
 *  `wallpaperDeps`). */
export interface CdpReadyDeps {
  /** Re-resolve the live CDP port for an agent (probe only, no side effects). */
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  /** Ensure the agent has a live CDP endpoint — may kill + relaunch (or
   *  launch a not-running agent) with `--remote-debugging-port=0`. When
   *  `forceRestart` is true, the user has confirmed a restart, so a running
   *  app may be killed + relaunched; when false, only a not-running app is
   *  launched (a running-but-CDP-less app returns `no-cdp`). */
  ensureCdpReady: (
    appId: AgentId,
    timeoutMs?: number,
    forceRestart?: boolean,
  ) => Promise<CdpReadyResult>;
  /** Infer a structured {@link RestartReason} when no live port is found.
   *  `cdpFailureReason` is null when `ensureCdpReady` was not attempted (pure
   *  probe path). */
  inferRestartReason: (
    appId: AgentId,
    cdpFailureReason: CdpReadyResult['reason'],
  ) => Promise<RestartReason>;
  /** Best-effort log line sink. */
  log: (line: string) => void;
}

/** Result of the unified CDP readiness check. Discriminated on `status` so a
 *  `ready` result always carries a non-null port. */
export type AgentCdpReadyResult =
  | { port: number; status: 'ready' }
  | { port: null; status: 'requires-restart'; restartReason: RestartReason };

/**
 * Resolve a live CDP endpoint for an agent under the unified CDP policy.
 * See the module docblock for the full semantics.
 *
 * @param appId  Agent to prepare.
 * @param deps   The discovery slice (resolveLivePort / ensureCdpReady /
 *               inferRestartReason / log).
 * @param options
 *   - `restartExisting` — when true, the user has already confirmed a
 *     restart, so `ensureCdpReady` may kill + relaunch the running app.
 *   - `timeoutMs` — CDP-ready wait when launching/restarting (default 30s).
 */
export async function ensureAgentCdpReady(
  appId: AgentId,
  deps: CdpReadyDeps,
  options: { restartExisting?: boolean; timeoutMs?: number } = {},
): Promise<AgentCdpReadyResult> {
  const { restartExisting = false, timeoutMs = 30_000 } = options;

  if (restartExisting) {
    // User confirmed the restart — allowed to kill + relaunch with CDP enabled.
    const cdpResult = await deps.ensureCdpReady(appId, timeoutMs, true);
    if (cdpResult.port) return { port: cdpResult.port, status: 'ready' };
    deps.log(`[cdp-ready] ${appId}: restart failed (${cdpResult.reason})`);
    // Map the failure to a structured reason so the UI can guide the user.
    const restartReason = await deps.inferRestartReason(appId, cdpResult.reason ?? null);
    return { port: null, status: 'requires-restart', restartReason };
  }

  // Phase 1: probe only — never kill a running app on the first click.
  const port = await deps.resolveLivePort(appId);
  if (port) return { port, status: 'ready' };
  deps.log(`[cdp-ready] ${appId}: no live CDP port (probe phase)`);

  // Classify: "installed but not running" is a plain launch (no dialog),
  // everything else needs the user's attention.
  const reason = await deps.inferRestartReason(appId, null);
  if (reason === 'not-running') {
    deps.log(`[cdp-ready] ${appId}: installed but not running — auto-launching`);
    const cdpResult = await deps.ensureCdpReady(appId, timeoutMs, false);
    if (cdpResult.port) return { port: cdpResult.port, status: 'ready' };
    deps.log(`[cdp-ready] ${appId}: auto-launch failed (${cdpResult.reason})`);
    const mapped = await deps.inferRestartReason(appId, cdpResult.reason ?? null);
    return { port: null, status: 'requires-restart', restartReason: mapped };
  }

  // not-installed / no-cdp (running without a debug port) / other → the UI
  // must involve the user (install guidance, or confirm the restart).
  return { port: null, status: 'requires-restart', restartReason: reason };
}
