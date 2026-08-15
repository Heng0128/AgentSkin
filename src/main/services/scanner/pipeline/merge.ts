// SPDX-License-Identifier: MPL-2.0

import { compareVersions, identityKey, isHigherPriority } from '../../../../shared/app-identity';
import type { ScannedApp } from '../../../../shared/types/agent';

/**
 * # Identity-based multi-version merge (v2)
 *
 * A single product can ship several side-by-side installs — Quark
 * (`7.0.5.931`, `7.0.7.940`), QwenWorkCN (`0.1.1`, `0.1.3`, `0.1.6`) — each
 * living in its own version folder and therefore scanning as a distinct
 * `ScannedApp`. This module collapses them back to one entry per product
 * identity, keeping the highest version and recording every version found.
 *
 * The identity is a normalized `productName | companyName` pair (see
 * `shared/app-identity.ts`), so "Quark 7.0.5.931" and "Quark 7.0.7.940"
 * collapse together while "Codex" and "Codex CLI" (a distinct product) stay
 * separate.
 *
 * The live scanner uses the streaming sibling `stream-merge.ts`; this batch
 * form remains for tests and any caller that already holds the full list.
 * `src/main` must never import from `src/ui` — the shared identity logic
 * lives in `src/shared/app-identity.ts` for exactly this reason.
 */

/**
 * Collapse `apps` into one entry per identity. The surviving entry is marked
 * `isDefaultEntry` and carries the full, de-duplicated, descending-sorted list
 * of versions seen across the group.
 */
export function mergeByIdentity(apps: ScannedApp[]): ScannedApp[] {
  const groups = new Map<string, ScannedApp[]>();
  for (const app of apps) {
    const key = identityKey(app);
    const existing = groups.get(key);
    if (existing) existing.push(app);
    else groups.set(key, [app]);
  }

  const merged: ScannedApp[] = [];
  for (const group of groups.values()) {
    let best = group[0];
    for (let i = 1; i < group.length; i++) {
      if (isHigherPriority(group[i], best)) best = group[i];
    }

    const versionSet = new Set<string>();
    for (const app of group) {
      if (app.version && app.version.length > 0) versionSet.add(app.version);
    }
    const versions = [...versionSet].sort((a, b) => compareVersions(b, a));

    merged.push({ ...best, isDefaultEntry: true, versions });
  }

  return merged;
}
