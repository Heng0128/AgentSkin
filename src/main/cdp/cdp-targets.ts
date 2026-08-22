// SPDX-License-Identifier: MPL-2.0

/**
 * CDP target discovery helpers for the main process.
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
 */

import type { CdpTarget } from '../../legacy/agentskin-core-runtime';
import { listCdpTargets } from '../../legacy/agentskin-core-runtime';

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
