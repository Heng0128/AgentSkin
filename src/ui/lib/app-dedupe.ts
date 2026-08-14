// SPDX-License-Identifier: MPL-2.0

/**
 * # App de-duplication
 *
 * Collapses multi-version installs of the same Electron app into a single
 * entry (keeping the highest version). A single product can ship several
 * side-by-side installs — Quark (`7.0.5.931`, `7.0.7.940`), QwenWorkCN
 * (`0.1.1`, `0.1.3`, `0.1.6`), Douyin (`7.7.0`, `8.2.303`) — each living in
 * its own version folder and therefore scanning as a distinct `ScannedApp`.
 * We de-dupe by product name so the launcher shows one tile per product.
 */

import type { ScannedApp } from '@shared/types';

/** Parse a version string into numeric segments ("7.0.5.931" → [7, 0, 5, 931]). */
export function parseVersion(version: string): number[] {
  // The build/date suffix after the first '-' is compared separately; the
  // numeric segments are what drive the primary ordering.
  const main = version.split('-')[0];
  return main
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number);
}

/** Compare two version strings: >0 if a>b, <0 if a<b, 0 if equal. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x - y;
  }
  // Equal numeric segments — fall back to the '-' suffix (e.g. build date).
  const suffixA = a.includes('-') ? a.slice(a.indexOf('-') + 1) : '';
  const suffixB = b.includes('-') ? b.slice(b.indexOf('-') + 1) : '';
  if (suffixA !== suffixB) return suffixA < suffixB ? -1 : 1;
  return 0;
}

/**
 * De-dupe apps by product name, keeping the entry that best represents "what
 * the user actually runs". Priority is source-based — an adapter/registry hit
 * points at the launcher the user double-clicks, whereas a filesystem hit may
 * be an inner version-directory engine — and only falls back to version
 * comparison within the same source.
 *
 *   `agent` > `registry` > `filesystem` (then highest version).
 *
 * Apps with distinct product names are never merged. An empty product name
 * falls back to the exe path so unrelated apps never collapse onto each other.
 */
const SOURCE_RANK: Record<string, number> = { agent: 3, registry: 2, filesystem: 1 };

function isHigherPriority(a: ScannedApp, b: ScannedApp): boolean {
  const ra = SOURCE_RANK[a.source ?? 'filesystem'] ?? 1;
  const rb = SOURCE_RANK[b.source ?? 'filesystem'] ?? 1;
  if (ra !== rb) return ra > rb;
  return compareVersions(a.version ?? '', b.version ?? '') > 0;
}

export function dedupeByProductName(apps: ScannedApp[]): ScannedApp[] {
  const byName = new Map<string, ScannedApp>();
  for (const app of apps) {
    const key = (app.productName || app.exePath).toLowerCase();
    const existing = byName.get(key);
    if (!existing || isHigherPriority(app, existing)) {
      byName.set(key, app);
    }
  }
  return [...byName.values()];
}
