// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../../fixtures/mocks/electron';
import type { ThemeUsageMap } from '../../shared/types/theme-usage';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('electron', () => createElectronMock(new Map()));

vi.mock('../logger', () => ({
  mainWarnFromCatch: vi.fn(),
  mainInfo: vi.fn(),
}));

// Import after mocks are declared.
const { ThemeUsageTracker, DEFAULT_SORTED_LIMIT, isThemeUsageMap } = await import(
  './theme-usage-tracker'
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temporary directory for each test. */
async function createTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'theme-usage-test-'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isThemeUsageMap', () => {
  it('accepts an empty map', () => {
    expect(isThemeUsageMap({})).toBe(true);
  });

  it('accepts a well-formed usage map', () => {
    const map: ThemeUsageMap = {
      traework: {
        neon: { count: 5, lastUsed: 1_700_000_000_000 },
        ocean: { count: 3, lastUsed: 1_700_000_010_000 },
      },
    };
    expect(isThemeUsageMap(map)).toBe(true);
  });

  it('accepts null agent entries', () => {
    expect(isThemeUsageMap({ traework: null })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isThemeUsageMap(null)).toBe(false);
    expect(isThemeUsageMap(undefined)).toBe(false);
    expect(isThemeUsageMap(42)).toBe(false);
    expect(isThemeUsageMap('{}')).toBe(false);
  });

  it('rejects arrays', () => {
    expect(isThemeUsageMap([])).toBe(false);
  });

  it('rejects unknown agent ids', () => {
    expect(isThemeUsageMap({ notAnAgent: { neon: { count: 1, lastUsed: 0 } } })).toBe(false);
  });

  it('rejects negative count', () => {
    expect(isThemeUsageMap({ traework: { neon: { count: -1, lastUsed: 0 } } })).toBe(false);
  });

  it('rejects non-integer count', () => {
    expect(isThemeUsageMap({ traework: { neon: { count: 1.5, lastUsed: 0 } } })).toBe(false);
  });

  it('rejects non-finite lastUsed', () => {
    expect(isThemeUsageMap({ traework: { neon: { count: 1, lastUsed: NaN } } })).toBe(false);
    expect(isThemeUsageMap({ traework: { neon: { count: 1, lastUsed: Infinity } } })).toBe(false);
  });

  it('rejects non-object entry', () => {
    expect(isThemeUsageMap({ traework: { neon: 'bad' } })).toBe(false);
  });
});

describe('ThemeUsageTracker', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('initialize() starts with empty map when no file exists', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();
    expect(tracker.getUsageMap()).toEqual({});
  });

  it('initialize() loads existing usage data from disk', async () => {
    const data: ThemeUsageMap = {
      traework: { neon: { count: 3, lastUsed: 1_700_000_000_000 } },
    };
    await fs.writeFile(path.join(tempDir, 'theme-usage.json'), JSON.stringify(data), 'utf8');

    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();
    expect(tracker.getUsageMap()).toEqual(data);
  });

  it('initialize() degrades to empty map on corrupted file', async () => {
    await fs.writeFile(path.join(tempDir, 'theme-usage.json'), 'not json', 'utf8');

    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();
    expect(tracker.getUsageMap()).toEqual({});
  });

  it('recordUsage() increments count and updates lastUsed', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    await tracker.recordUsage('traework', 'neon');
    const map1 = tracker.getUsageMap();
    expect(map1.traework?.neon?.count).toBe(1);
    expect(typeof map1.traework?.neon?.lastUsed).toBe('number');

    await tracker.recordUsage('traework', 'neon');
    const map2 = tracker.getUsageMap();
    expect(map2.traework?.neon?.count).toBe(2);
  });

  it('recordUsage() creates new entry for first use', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    await tracker.recordUsage('traework', 'ocean');
    const map = tracker.getUsageMap();
    expect(map.traework?.ocean).toEqual({ count: 1, lastUsed: expect.any(Number) });
  });

  it('recordUsage() tracks different agents independently', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('workbuddy', 'neon');

    const map = tracker.getUsageMap();
    expect(map.traework?.neon?.count).toBe(1);
    expect(map.workbuddy?.neon?.count).toBe(1);
  });

  it('recordUsage() persists to disk', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('traework', 'neon');

    // Read the file directly to verify persistence.
    const raw = await fs.readFile(path.join(tempDir, 'theme-usage.json'), 'utf8');
    const parsed = JSON.parse(raw) as ThemeUsageMap;
    expect(parsed.traework?.neon?.count).toBe(2);
  });

  it('getSortedThemes() returns empty array when no usage data', () => {
    const tracker = new ThemeUsageTracker(tempDir);
    const result = tracker.getSortedThemes('traework', ['neon', 'ocean']);
    expect(result).toEqual([]);
  });

  it('getSortedThemes() sorts by count descending', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    // Manually set the cache via recordUsage.
    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('traework', 'ocean');
    await tracker.recordUsage('traework', 'ocean');
    await tracker.recordUsage('traework', 'forest');

    const result = tracker.getSortedThemes('traework', ['neon', 'ocean', 'forest']);
    expect(result).toEqual(['neon', 'ocean', 'forest']);
  });

  it('getSortedThemes() breaks ties by lastUsed descending', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    // Manually write a map with equal counts but different lastUsed.
    await tracker.recordUsage('traework', 'old-theme');
    await tracker.recordUsage('traework', 'new-theme');

    // Both have count=1, but new-theme was used more recently.
    const result = tracker.getSortedThemes('traework', ['old-theme', 'new-theme']);
    expect(result).toEqual(['new-theme', 'old-theme']);
  });

  it('getSortedThemes() respects the limit parameter', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'a');
    await tracker.recordUsage('traework', 'b');
    await tracker.recordUsage('traework', 'c');
    await tracker.recordUsage('traework', 'd');
    await tracker.recordUsage('traework', 'e');

    const result = tracker.getSortedThemes('traework', ['a', 'b', 'c', 'd', 'e'], 3);
    expect(result).toHaveLength(3);
  });

  it('getSortedThemes() uses default limit of 4', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'a');
    await tracker.recordUsage('traework', 'b');
    await tracker.recordUsage('traework', 'c');
    await tracker.recordUsage('traework', 'd');
    await tracker.recordUsage('traework', 'e');

    const result = tracker.getSortedThemes('traework', ['a', 'b', 'c', 'd', 'e']);
    expect(result).toHaveLength(DEFAULT_SORTED_LIMIT);
  });

  it('getSortedThemes() filters out themes not in allThemes', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'neon');
    await tracker.recordUsage('traework', 'ocean');

    // Only 'neon' is in the available list.
    const result = tracker.getSortedThemes('traework', ['neon']);
    expect(result).toEqual(['neon']);
  });

  it('getSortedThemes() returns empty for unknown agent', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'neon');

    // workbuddy has no usage data.
    const result = tracker.getSortedThemes('workbuddy', ['neon']);
    expect(result).toEqual([]);
  });

  it('getSortedThemes() handles empty allThemes', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'neon');

    const result = tracker.getSortedThemes('traework', []);
    expect(result).toEqual([]);
  });

  it('concurrent recordUsage calls do not lose updates', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.initialize();

    // Fire 10 concurrent recordUsage calls for the same theme.
    await Promise.all(Array.from({ length: 10 }, () => tracker.recordUsage('traework', 'neon')));

    const map = tracker.getUsageMap();
    expect(map.traework?.neon?.count).toBe(10);
  });

  it('getUsageMap() returns a shallow copy (not mutable reference)', async () => {
    const tracker = new ThemeUsageTracker(tempDir);
    await tracker.recordUsage('traework', 'neon');

    const map1 = tracker.getUsageMap();
    map1.traework!.neon!.count = 999;

    const map2 = tracker.getUsageMap();
    expect(map2.traework?.neon?.count).toBe(1);
  });
});
