// SPDX-License-Identifier: MPL-2.0

/**
 * # App de-duplication & incremental merge (renderer side)
 *
 * Collapses multi-version installs of the same Electron app into a single
 * entry (keeping the best "what the user actually runs" entry). A single
 * product can ship several side-by-side installs — Quark (`7.0.5.931`,
 * `7.0.7.940`), QwenWorkCN (`0.1.1`, `0.1.3`, `0.1.6`) — each living in its
 * own version folder and therefore scanning as a distinct `ScannedApp`.
 *
 * The identity/priority rules live in `src/shared/app-identity.ts` and are
 * shared with the main-process scanner — this file only re-exports them for
 * the renderer and adds the streaming merge helpers (`applyScanEvent`) that
 * consume the main process's `ScanProgressEvent` stream without ever
 * re-deriving what "one product" means.
 */

import { identityKey, isHigherPriority } from '@shared/app-identity';
import type { ElectronScanResult, ScannedApp, ScanProgressEvent } from '@shared/types';

export { compareVersions, identityKey, parseVersion } from '@shared/app-identity';

/**
 * De-dupe apps by identity, keeping the entry that best represents "what the
 * user actually runs". Priority is source-based — an adapter/registry hit
 * points at the launcher the user double-clicks, whereas a filesystem hit may
 * be an inner version-directory engine — and only falls back to version
 * comparison within the same source.
 *
 *   `agent` > `registry` > `filesystem` (then highest version).
 *
 * Apps with distinct identities are never merged. An empty product name
 * falls back to the exe path so unrelated apps never collapse onto each other.
 *
 * The main-process scanner already merges by identity before the final result
 * is returned, so this is a defensive idempotent pass (and the batch form of
 * the same rule used by tests).
 */
export function dedupeByProductName(apps: ScannedApp[]): ScannedApp[] {
  const byIdentity = new Map<string, ScannedApp>();
  for (const app of apps) {
    const key = identityKey(app);
    const existing = byIdentity.get(key);
    if (!existing || isHigherPriority(app, existing)) {
      byIdentity.set(key, app);
    }
  }
  return [...byIdentity.values()];
}

/**
 * Apply one streaming scan event to the current result without replacing the
 * whole list. `add` appends a product not yet present, `update` replaces the
 * tile for a product that arrived with a better entry (higher source/version),
 * and `icon` patches a single tile's icon in place once extraction finishes.
 *
 * The main process emits events that are already identity-merged, so `add`
 * here is defensive (skip if the identity is somehow already present) and
 * `update` falls back to append when the target identity is absent.
 */
export function applyScanEvent(
  prev: ElectronScanResult | null,
  event: ScanProgressEvent,
): ElectronScanResult {
  const base = prev ?? { adapted: [], other: [] };

  if (event.op === 'icon') {
    // Icons are only extracted for unadapted apps (adapted ones render the
    // bundled brand logo via AppMark), so patch within `other` only.
    const other = base.other.map((app) =>
      app.id === event.appId ? { ...app, iconPath: event.iconPath } : app,
    );
    return { ...base, other };
  }

  const app = event.app;
  const bucket: 'adapted' | 'other' = app.adapterMatch ? 'adapted' : 'other';
  const list = base[bucket];
  const key = identityKey(app);

  if (event.op === 'update') {
    if (list.some((existing) => identityKey(existing) === key)) {
      return {
        ...base,
        [bucket]: list.map((existing) => (identityKey(existing) === key ? app : existing)),
      };
    }
    // Target identity absent (e.g. a partial/cleared list) — append instead.
    return { ...base, [bucket]: [...list, app] };
  }

  // add
  if (list.some((existing) => identityKey(existing) === key)) return base;
  return { ...base, [bucket]: [...list, app] };
}
