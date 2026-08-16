// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the persisted scan cache (`persist-cache.ts`).
 *
 * Verifies:
 *   1. `persistCachePath` — resolves to `<userData>/scan-cache.json`.
 *   2. `loadPersistedScan` — returns null on missing / corrupt / stale cache;
 *      returns the parsed object for a valid fresh one.
 *   3. `savePersistedScan` — writes a valid cache file (round-trip through
 *      `loadPersistedScan`), and never throws on a disk error (swallowed).
 *
 * The logger (`mainWarn`) is mocked so failures stay silent in test output.
 * `writeJsonAtomic` is NOT mocked — we exercise the real atomic write path
 * (temp file + rename) against a real OS temp dir.
 */

import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger so persist-cache warnings don't pollute test output.
vi.mock('../../../logger', () => ({
  mainWarn: vi.fn(),
}));

const { loadPersistedScan, persistCachePath, savePersistedScan } = await import('./persist-cache');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_RESULT = {
  adapted: [
    {
      id: 'abc123',
      exePath: 'C:\\Apps\\Trae\\trae.exe',
      productName: 'TRAE',
      companyName: 'ByteDance',
      adapterMatch: 'traework',
    },
  ],
  other: [
    {
      id: 'def456',
      exePath: 'C:\\Apps\\CoolApp\\cool.exe',
      productName: 'CoolApp',
      companyName: 'CoolCorp',
      adapterMatch: null,
    },
  ],
} as unknown as Parameters<typeof savePersistedScan>[1];

function makeCacheFile(result: unknown, overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    savedAt: Date.now(),
    result,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('persist-cache', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'scan-cache-test-'));
  });

  afterEach(async () => {
    // Best-effort cleanup — tmp dirs are scobied per-run, so a failed
    // deletion just leaves garbage for the OS to collect.
    const { rm } = await import('node:fs/promises');
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // -----------------------------------------------------------------------
  // persistCachePath
  // -----------------------------------------------------------------------
  it('persistCachePath appends scan-cache.json to the userData root', () => {
    expect(persistCachePath('C:\\Users\\me\\AppData\\AgentSkin')).toBe(
      path.join('C:\\Users\\me\\AppData\\AgentSkin', 'scan-cache.json'),
    );
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — missing file
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns null when the file does not exist', async () => {
    const result = await loadPersistedScan(path.join(tmpDir, 'nope'));
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — corrupt JSON
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns null when the file contains invalid JSON', async () => {
    const file = persistCachePath(tmpDir);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(file, '{ not valid json', 'utf8');

    const result = await loadPersistedScan(tmpDir);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — schema mismatch (wrong version)
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns null when the cache file has an incompatible version', async () => {
    const file = persistCachePath(tmpDir);
    const { writeJsonAtomic } = await import('../../../fs-utils');
    await writeJsonAtomic(file, makeCacheFile(VALID_RESULT, { version: 999 }));

    const result = await loadPersistedScan(tmpDir);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — schema mismatch (missing result.other)
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns null when the cached result lacks the other array', async () => {
    const file = persistCachePath(tmpDir);
    const { writeJsonAtomic } = await import('../../../fs-utils');
    const broken = { adapted: [], meta: {} } as unknown as typeof VALID_RESULT;
    await writeJsonAtomic(file, makeCacheFile(broken));

    const result = await loadPersistedScan(tmpDir);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — TTL expired
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns null when the cache is older than 24h', async () => {
    const file = persistCachePath(tmpDir);
    const { writeJsonAtomic } = await import('../../../fs-utils');
    // savedAt = 25 hours ago.
    await writeJsonAtomic(
      file,
      makeCacheFile(VALID_RESULT, { savedAt: Date.now() - 25 * 60 * 60 * 1000 }),
    );

    const result = await loadPersistedScan(tmpDir);
    expect(result).toBeNull();
  });

  // -----------------------------------------------------------------------
  // loadPersistedScan — valid fresh cache
  // -----------------------------------------------------------------------
  it('loadPersistedScan returns the parsed object when the cache is fresh and valid', async () => {
    const file = persistCachePath(tmpDir);
    const { writeJsonAtomic } = await import('../../../fs-utils');
    await writeJsonAtomic(file, makeCacheFile(VALID_RESULT));

    const result = await loadPersistedScan(tmpDir);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(1);
    expect(result?.result.adapted).toHaveLength(1);
    expect(result?.result.other).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // savePersistedScan — round trip
  // -----------------------------------------------------------------------
  it('savePersistedScan writes a file that loadPersistedScan can read back', async () => {
    await savePersistedScan(tmpDir, VALID_RESULT);

    const loaded = await loadPersistedScan(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.result.adapted[0].exePath).toBe('C:\\Apps\\Trae\\trae.exe');
    expect(loaded?.result.other[0].productName).toBe('CoolApp');
  });

  // -----------------------------------------------------------------------
  // savePersistedScan — atomic rename leaves no temp file behind
  // -----------------------------------------------------------------------
  it('savePersistedScan leaves no leftover temp file after a successful write', async () => {
    await savePersistedScan(tmpDir, VALID_RESULT);

    const entries = await (await import('node:fs/promises')).readdir(tmpDir);
    // Only scan-cache.json should exist — no `.scan-cache.json.*.tmp` debris.
    expect(entries).toEqual(['scan-cache.json']);
  });
});
