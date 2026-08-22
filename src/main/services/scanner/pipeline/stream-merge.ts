// SPDX-License-Identifier: MPL-2.0

import { compareVersions, identityKey, isHigherPriority } from '../../../../shared/app-identity';
import type { ScannedApp } from '../../../../shared/types/agent';

/**
 * # Streaming identity merge
 *
 * The scanner's `collect` callback fires as each app is discovered across the
 * L1/L2/L3 sweeps. A single product can be found several times — Quark
 * (`7.0.5.931`, `7.0.7.940`), QwenWorkCN, Douyin — each version directory
 * scanning as a distinct `ScannedApp`, and the same install can be hit by
 * multiple layers (registry launcher + filesystem version dir).
 *
 * This class collapses those into one entry per identity **as they arrive**,
 * so the renderer receives a clean `add` / `update` stream instead of the raw
 * multi-version flood, and the final result is exactly what was streamed —
 * no "all versions pop in, then snap together" jump when the scan settles.
 *
 * Identity and priority rules are shared with the renderer via
 * `src/shared/app-identity.ts`, so the two sides can never disagree about
 * what "one product" means.
 */
export type StreamMergeOp = 'add' | 'update' | 'discard';

interface Group {
  best: ScannedApp;
  versions: Set<string>;
}

export class StreamMerge {
  private groups = new Map<string, Group>();

  /**
   * Fold one discovered app into the group map.
   *
   * @returns `add` when this identity is new, `update` when the incoming app
   *   beats the current best (higher source rank, then higher version), or
   *   `discard` when it loses. Every discovered version is still recorded on
   *   the group so the final `versions` list stays complete.
   */
  upsert(app: ScannedApp): StreamMergeOp {
    const key = identityKey(app);
    const existing = this.groups.get(key);
    if (!existing) {
      this.groups.set(key, {
        best: app,
        versions: new Set(app.version && app.version.length > 0 ? [app.version] : []),
      });
      return 'add';
    }
    if (app.version && app.version.length > 0) existing.versions.add(app.version);
    if (isHigherPriority(app, existing.best)) {
      existing.best = app;
      return 'update';
    }
    return 'discard';
  }

  /** Current best entry per identity (pre-finalize snapshot for callers like
   *  the L2 known-products skip set). */
  entries(): ScannedApp[] {
    return [...this.groups.values()].map((g) => g.best);
  }

  /**
   * Produce the merged result: one entry per identity, each marked
   * `isDefaultEntry` and carrying the full de-duplicated, descending-sorted
   * list of versions seen across the group.
   */
  finalize(): ScannedApp[] {
    const merged: ScannedApp[] = [];
    for (const { best, versions } of this.groups.values()) {
      merged.push({
        ...best,
        isDefaultEntry: true,
        versions: [...versions].sort((a, b) => compareVersions(b, a)),
      });
    }
    return merged;
  }

  /** Number of distinct product identities tracked. */
  get size(): number {
    return this.groups.size;
  }
}
