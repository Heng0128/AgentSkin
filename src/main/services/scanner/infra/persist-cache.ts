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

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ElectronScanResult } from '@shared/types/agent';
import { writeJsonAtomic } from '../../../fs-utils';
import { mainDebug, mainWarn } from '../../../logger';

/** On-disk cache schema version. Bumped when the format changes incompatibly. */
const CACHE_VERSION = 1;

/** Lifetime of a persisted cache entry. After this the entry is considered
 *  stale and callers should trigger a full re-scan rather than replay it. */
export const PERSIST_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** HMAC protects the cache from tampering (e.g. a poisoned scan-cache.json
 *  seeding the launch whitelist with arbitrary exePaths). */
const KEY_FILE_NAME = '.scan-cache.key';

export interface ScanCacheFile {
  version: typeof CACHE_VERSION;
  savedAt: number;
  result: ElectronScanResult;
  /** HMAC-SHA256 over `{version, savedAt, result}`; absent on legacy caches. */
  sig?: string;
}

/**
 * Resolve the on-disk cache path for a given Electron `userData` directory.
 * Kept pure (no direct `app.getPath` import) so it can be unit-tested without
 * mocking Electron.
 */
export function persistCachePath(userDataPath: string): string {
  return path.join(userDataPath, 'scan-cache.json');
}

/** Resolve the HMAC key file path within the same userData directory. */
function cacheKeyPath(userDataPath: string): string {
  return path.join(userDataPath, KEY_FILE_NAME);
}

/**
 * Load the per-install HMAC key, creating it on first use. A random 32-byte
 * key is generated once and persisted so signatures survive restarts. The key
 * file sits alongside the cache in `userData` — a local attacker who can write
 * the cache can also read the key, so this is integrity protection against
 * accidental corruption / casual tampering, not a strong security boundary.
 */
async function loadOrCreateKey(userDataPath: string): Promise<Buffer> {
  const keyPath = cacheKeyPath(userDataPath);
  try {
    const existing = await fs.readFile(keyPath);
    if (existing.length > 0) return existing;
  } catch {
    // ENOENT → generate below.
  }
  const key = crypto.randomBytes(32);
  await fs.writeFile(keyPath, key, { mode: 0o600 });
  return key;
}

/** Compute the HMAC-SHA256 signature over the cache body (minus `sig`). */
function signCache(
  key: Buffer,
  body: { version: number; savedAt: number; result: ElectronScanResult },
): string {
  return crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
}

/** Structural body of a cache file, used for both signing and verifying. */
function cacheBody(v: Record<string, unknown>): {
  version: number;
  savedAt: number;
  result: ElectronScanResult;
} {
  return {
    version: v.version as number,
    savedAt: v.savedAt as number,
    result: v.result as ElectronScanResult,
  };
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

  // Integrity check: a signed cache must match its HMAC. A tampered cache
  // (e.g. a poisoned scan-cache.json seeding the launch whitelist) is
  // discarded. Legacy caches without a `sig` are accepted (written by an
  // older version) but logged.
  const v = parsed as unknown as Record<string, unknown>;
  if (typeof v.sig === 'string') {
    try {
      const key = await loadOrCreateKey(userDataPath);
      const expected = signCache(key, cacheBody(v));
      if (expected !== v.sig) {
        mainWarn('PersistScanCache', 'HMAC mismatch — cache tampered, discarding');
        return null;
      }
    } catch (error) {
      mainWarn(
        'PersistScanCache',
        `HMAC verification failed (${error instanceof Error ? error.message : String(error)}) — discarding`,
      );
      return null;
    }
  } else {
    mainDebug('PersistScanCache', 'cache has no HMAC signature (legacy) — accepting');
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
    // Sign before writing so a tampered/poisoned cache is detected on load.
    const key = await loadOrCreateKey(userDataPath);
    payload.sig = signCache(key, cacheBody(payload as unknown as Record<string, unknown>));
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
