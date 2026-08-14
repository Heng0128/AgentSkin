// SPDX-License-Identifier: MPL-2.0

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
 * The identity is a normalized `productName | companyName` pair, so "Quark
 * 7.0.5.931" and "Quark 7.0.7.940" collapse together while "Codex" and
 * "Codex CLI" (a distinct product) stay separate.
 *
 * This mirrors the renderer's `app-dedupe` logic but is implemented locally —
 * `src/main` must never import from `src/ui`.
 */

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
 * Normalize a product name for identity comparison: lowercase, collapse
 * whitespace/hyphen/underscore/dot runs, then strip a trailing version-like
 * segment. "Quark 7.0.5.931" → "quark", "Codex CLI" → "codexcli".
 */
export function normalizeProductName(name: string): string {
  const cleaned = name.toLowerCase().replace(/[\s\-_.]+/g, '');
  return cleaned.replace(/\d+(?:\.\d+)*$/, '');
}

/**
 * A stable identity for an app: normalized product name plus normalized
 * company name. An empty product name falls back to the exe path so unrelated
 * apps never collapse onto each other.
 */
export function identityKey(app: ScannedApp): string {
  const product = normalizeProductName(app.productName || app.exePath);
  const company = normalizeProductName(app.companyName ?? '');
  return `${product}|${company}`;
}

/**
 * De-dupe apps by identity, keeping the entry that best represents "what the
 * user actually runs". Priority is source-based — an adapter/registry hit
 * points at the launcher the user double-clicks, whereas a filesystem hit may
 * be an inner version-directory engine — and only falls back to version
 * comparison within the same source.
 *
 *   `agent` > `registry` > `filesystem` (then highest version).
 */
const SOURCE_RANK: Record<string, number> = { agent: 3, registry: 2, filesystem: 1 };

function sourceRank(app: ScannedApp): number {
  return SOURCE_RANK[app.source ?? 'filesystem'] ?? 1;
}

function isHigherPriority(a: ScannedApp, b: ScannedApp): boolean {
  const ra = sourceRank(a);
  const rb = sourceRank(b);
  if (ra !== rb) return ra > rb;
  return compareVersions(a.version ?? '', b.version ?? '') > 0;
}

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
