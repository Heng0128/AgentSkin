// SPDX-License-Identifier: MPL-2.0

/**
 * # Existence Validation
 *
 * Verifies that the `exePath` of each cached `ScannedApp` still points to a
 * real file on disk. Software the user has since uninstalled leaves stale
 * entries in the persisted cache; this pass strips them so the launcher never
 * shows ghost tiles that fail on launch.
 *
 * Cheap O(n) `fs.access` check — a few hundred entries resolve in milliseconds
 * (Node's libuv thread pool parallelises the syscalls). Runs after a cache
 * load and before returning the "instant" result to the caller.
 *
 * Strategy:
 *   - `fs.access(exePath, F_OK)` for each app (parallel via `Promise.all`).
 *   - On any error (file gone, permission denied), drop the entry.
 *   - Both `adapted` and `other` buckets are validated.
 */

import fs from 'node:fs/promises';
import type { ElectronScanResult, ScannedApp } from '@shared/types/agent';
import { mainWarn } from '../../../logger';

/** Access-mode constant: test for file existence only (no r/w check). */
const F_OK = 0;

/**
 * Drop cached entries whose `exePath` no longer resolves to an existing file.
 * Returns a new `ElectronScanResult` with ghost entries removed. Apps whose
 * exe is present pass through untouched.
 */
export async function validateExistence(result: ElectronScanResult): Promise<ElectronScanResult> {
  // Partition each bucket into [alive, dead] by checking exe existence.
  const [adaptedAlive, adaptedDead] = await partitionAlive(result.adapted);
  const [otherAlive, otherDead] = await partitionAlive(result.other);

  if (adaptedDead.length > 0 || otherDead.length > 0) {
    mainWarn(
      'ScanValidator',
      `pruned ${adaptedDead.length + otherDead.length} ghost entries (adapted=${adaptedDead.length} other=${otherDead.length})`,
    );
  }

  return {
    adapted: adaptedAlive,
    other: otherAlive,
    meta: result.meta,
  };
}

/**
 * Split a list of apps into [alive, dead] by checking each exePath. A parallel
 * `Promise.all` fires every `fs.access` at once — Windows' libuv pool (default
 * 4 threads) batches the syscall overhead to a few ms even for hundreds of
 * entries.
 */
async function partitionAlive(apps: ScannedApp[]): Promise<[ScannedApp[], ScannedApp[]]> {
  const results = await Promise.all(
    apps.map(async (app): Promise<{ app: ScannedApp; alive: boolean }> => {
      try {
        await fs.access(app.exePath, F_OK);
        return { app, alive: true };
      } catch {
        return { app, alive: false };
      }
    }),
  );
  const alive: ScannedApp[] = [];
  const dead: ScannedApp[] = [];
  for (const { app, alive: isAlive } of results) {
    if (isAlive) alive.push(app);
    else dead.push(app);
  }
  return [alive, dead];
}
