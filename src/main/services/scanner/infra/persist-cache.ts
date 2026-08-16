// SPDX-License-Identifier: MPL-2.0

/**
 * # Persisted Scan Cache
 *
 * Cross-session scan result cache stored as JSON in the Electron user data
 * directory (`<userData>/scan-cache.json`). The in-memory cache (`cache.ts`)
 * handles repeated polls within a 5-minute window; this module fills the gap
 * across process restarts so a fresh launch can show the previous scan
 * instantly while a background re-scan refreshes the data.
 *
 * Format:
 * ```json
 * { "version": 1, "savedAt": 1710000000000, "result": { adapted, other, meta } }
 * ```
 *
 * Failure modes:
 *   - File missing / unreadable → returns `null`, caller falls back to a
 *     full scan.
 *   - JSON parse failure → logs a warning and returns `null` (a corrupt cache
 *     must never crash the startup path).
 *   - Schema mismatch (wrong `version` or missing `result`) → returns `null`.
 *
 * The atomic write helper (`writeJsonAtomic` from `fs-utils.ts`) guarantees
 * that a crash mid-write leaves the previous cache intact (temp file +
 * rename).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronScanResult } from '../../../../shared/types/agent';
import { writeJsonAtomic } from '../../../fs-utils';
import { mainWarn } from '../../../logger';

/** On-disk cache schema version. Bumped when the format changes incompatibly. */
const CACHE_VERSION = 1;

/** Lifetime of a persisted cache entry. After this the entry is considered
 *  stale and callers should trigger a full re-scan rather than replay it. */
export const PERSIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ScanCacheFile {
  version: typeof CACHE_VERSION;
  savedAt: number;
  result: ElectronScanResult;
}

/**
 * Resolve the on-disk cache path for a given Electron `userData` directory.
 * Kept pure (no direct `app.getPath` import) so it can be unit-tested without
 * mocking Electron.
 */
export function persistCachePath(userDataPath: string): string {
  return path.join(userDataPath, 'scan-cache.json');
}

/**
 * Read and validate the persisted scan cache. Returns `null` on any failure
 * (missing file, corrupt JSON, schema mismatch, stale TTL) so the caller can
 * transparently fall back to a full scan.
 */
export async function loadPersistedScan(
  userDataPath: string,
  now: number = Date.now(),
): Promise<ScanCacheFile | null> {
  const file = persistCachePath(userDataPath);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    // ENOENT (first launch / cache cleared) is expected — stay silent.
    if (code !== 'ENOENT') {
      mainWarn(
        'PersistScanCache',
        `read failed (${code ?? 'unknown'}) — falling back to full scan`,
      );
    }
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    mainWarn('PersistScanCache', 'JSON parse failed — cache corrupt, discarding');
    return null;
  }

  if (!isCacheFile(parsed)) {
    mainWarn('PersistScanCache', 'schema mismatch — cache version/structure invalid, discarding');
    return null;
  }

  // TTL guard: a cache older than 24h is stale. Treat as missing.
  if (now - parsed.savedAt > PERSIST_CACHE_TTL_MS) {
    mainWarn(
      'PersistScanCache',
      `cache expired (${Math.round((now - parsed.savedAt) / 3_600_000)}h old) — falling back to full scan`,
    );
    return null;
  }

  return parsed;
}

/**
 * Persist a completed scan result to disk. Failures are swallowed + logged —
 * a cache write failure must not fail the scan that just completed.
 *
 * Reuses `writeJsonAtomic` from `fs-utils.ts` so a crash mid-write never
 * corrupts the existing cache (temp file + rename on NTFS).
 */
export async function savePersistedScan(
  userDataPath: string,
  result: ElectronScanResult,
): Promise<void> {
  const file = persistCachePath(userDataPath);
  const payload: ScanCacheFile = {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    result,
  };
  try {
    await writeJsonAtomic(file, payload);
  } catch (error) {
    // Disk-full or permission denied — log and move on. The in-memory cache
    // (5min TTL) still serves short-term polls; only the cross-session
    // recovery is lost.
    mainWarn(
      'PersistScanCache',
      `write failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Structural guard for the on-disk cache shape. A cache file must carry the
 * expected `version`, a numeric `savedAt`, and a `result` object with both
 * `adapted` and `other` arrays. Anything else is treated as corrupt/migrated
 * and discarded rather than risk replaying partial data.
 */
function isCacheFile(value: unknown): value is ScanCacheFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === CACHE_VERSION &&
    typeof v.savedAt === 'number' &&
    typeof v.result === 'object' &&
    v.result !== null &&
    Array.isArray((v.result as Record<string, unknown>).adapted) &&
    Array.isArray((v.result as Record<string, unknown>).other)
  );
}
