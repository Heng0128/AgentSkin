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
 * Prior to this module, agent-engine-service.ts inlined `fetch /json/list`
 * with ad-hoc type assertions 8 times, leading to inconsistent error handling
 * and type drift from the authoritative `CdpTarget` interface.
 */

import type { CdpTarget } from '@agentskin/core';
import { listCdpTargets } from '@agentskin/core';

export type { CdpTarget };

/** Fetch all CDP targets on the given port. Returns [] on any fetch/parse error. */
export async function listTargets(port: number): Promise<CdpTarget[]> {
  try {
    return await listCdpTargets(port);
  } catch {
    return [];
  }
}

/** Find the main page target (type === 'page'). Returns undefined if none. */
export async function findPageTarget(port: number): Promise<CdpTarget | undefined> {
  const targets = await listTargets(port);
  return pickPageTarget(targets);
}

/**
 * Pick the main page target from an already-fetched target list.
 * Treats a missing `type` as 'page' (CDP spec: omitted type defaults to page).
 * Used by callers that already have targets in hand (e.g. after
 * adapter.findTargets, which applies matchTarget filtering) so they don't
 * pay for a second /json/list round-trip.
 */
export function pickPageTarget(targets: readonly CdpTarget[]): CdpTarget | undefined {
  return targets.find((t) => (t.type ?? 'page') === 'page' && t.webSocketDebuggerUrl);
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
