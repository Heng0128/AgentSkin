// SPDX-License-Identifier: MPL-2.0

/**
 * # App identity & priority — single source of truth
 *
 * Shared by the main-process scanner (`scanner/pipeline/merge.ts`,
 * `scanner/pipeline/stream-merge.ts`) and the renderer
 * (`ui/lib/app-dedupe.ts`). Both sides MUST use these functions so the
 * streaming phase and the final result agree on what "one product" means —
 * otherwise a multi-version install (Quark 7.0.5.931 / 7.0.7.940) can stream
 * as several tiles and then collapse into one when the final result lands.
 *
 * The identity is a normalized `productName | companyName` pair, so "Quark
 * 7.0.5.931" and "Quark 7.0.7.940" collapse together while "Codex" and
 * "Codex CLI" (a distinct product) stay separate. An empty product name
 * falls back to the exe path so unrelated apps never collapse onto each
 * other.
 *
 * Priority is source-based — an adapter/registry hit points at the launcher
 * the user double-clicks, whereas a filesystem hit may be an inner
 * version-directory engine — and only falls back to version comparison
 * within the same source.
 *
 *   `agent` > `registry` > `filesystem` (then highest version).
 */

import type { ScannedApp } from './types/agent';

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

/** Source rank used by {@link isHigherPriority} (agent > registry > filesystem). */
const SOURCE_RANK: Record<string, number> = { agent: 3, registry: 2, filesystem: 1 };

/** Rank an app's discovery source, defaulting to filesystem (lowest). */
export function sourceRank(app: ScannedApp): number {
  return SOURCE_RANK[app.source ?? 'filesystem'] ?? 1;
}

/** Whether `a` better represents "what the user actually runs" than `b`. */
export function isHigherPriority(a: ScannedApp, b: ScannedApp): boolean {
  const ra = sourceRank(a);
  const rb = sourceRank(b);
  if (ra !== rb) return ra > rb;
  return compareVersions(a.version ?? '', b.version ?? '') > 0;
}
