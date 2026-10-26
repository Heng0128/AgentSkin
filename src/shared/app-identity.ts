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
 *   `agent` > `registry` > `msix` > `shortcut` > `filesystem` (then highest version).
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

/**
 * Normalize a version string to a consistent `主版本.次版本.修订` shape:
 *   - pad short versions to 3 segments (`1.0` → `1.0.0`, `5` → `5.0.0`);
 *   - collapse trailing all-zero segments beyond 3 (`1.0.0.0` → `1.0.0`);
 *   - keep meaningful build segments (`7.0.7.940` stays — the build id
 *     distinguishes side-by-side installs);
 *   - preserve a non-numeric suffix (`1.2.3-beta` → `1.2.3-beta`).
 * This keeps `1.0.0.0` (PE) and `1.0` (registry DisplayVersion) of the same
 * app from coexisting as two formats after the merge.
 */
export function normalizeVersion(version: string): string {
  const v = version.trim();
  if (!v) return v;
  // Numeric main body + optional non-numeric suffix ("-beta", "b", …).
  const m = v.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!m) return v;
  const segs = m[1].split('.');
  while (segs.length > 3 && segs[segs.length - 1] === '0') segs.pop();
  while (segs.length < 3) segs.push('0');
  return `${segs.join('.')}${m[2]}`;
}

/** Source rank used by {@link isHigherPriority} (agent > registry > msix > shortcut > filesystem). */
const SOURCE_RANK: Record<string, number> = {
  agent: 5,
  registry: 4,
  msix: 3,
  shortcut: 2,
  filesystem: 1,
};

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
