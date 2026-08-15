// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the existence validator (`validate.ts`).
 *
 * Verifies that ghost entries (exePath no longer on disk) are pruned while
 * valid entries pass through untouched.
 *
 * We mock `node:fs/promises.access` so we can control which paths "exist" without
 * touching the real filesystem. The logger (`mainWarn`) is mocked for silence.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock logger so validation warnings don't pollute test output.
vi.mock('../../../logger', () => ({
  mainWarn: vi.fn(),
}));

// Mock fs/promises so we control which exePaths "exist" on disk.
const accessMock = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: {
    access: accessMock,
  },
}));

const { validateExistence } = await import('./validate');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp(id: string, exePath: string, adapterMatch: string | null = null) {
  return {
    id,
    exePath,
    productName: id,
    companyName: 'TestCorp',
    adapterMatch,
  } as Parameters<typeof validateExistence>[0]['adapted'][number];
}

function makeResult(adapted: ReturnType<typeof makeApp>[], other: ReturnType<typeof makeApp>[]) {
  return { adapted, other } as Parameters<typeof validateExistence>[0];

  // (narrowed for `meta?` — not needed by validate.ts)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateExistence', () => {
  beforeEach(() => {
    accessMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // All valid — nothing pruned
  // -----------------------------------------------------------------------
  it('keeps all entries when every exePath exists', async () => {
    accessMock.mockResolvedValue(undefined); // access succeeds = file exists

    const input = makeResult(
      [makeApp('adapted1', 'C:\\Apps\\a1.exe', 'traework')],
      [makeApp('other1', 'D:\\Apps\\o1.exe'), makeApp('other2', 'D:\\Apps\\o2.exe')],
    );

    const result = await validateExistence(input);

    expect(result.adapted).toHaveLength(1);
    expect(result.other).toHaveLength(2);
    expect(accessMock).toHaveBeenCalledTimes(3);
  });

  // -----------------------------------------------------------------------
  // Ghost entry — pruned
  // -----------------------------------------------------------------------
  it('prunes an entry whose exePath no longer exists', async () => {
    // First access (adapted1) succeeds, second (other1) fails.
    accessMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('ENOENT'));

    const input = makeResult(
      [makeApp('adapted1', 'C:\\Apps\\a1.exe', 'traework')],
      [makeApp('other1', 'D:\\Gone\\o1.exe')],
    );

    const result = await validateExistence(input);

    expect(result.adapted).toHaveLength(1);
    expect(result.other).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Mixed ghost scenario across both buckets
  // -----------------------------------------------------------------------
  it('prunes ghosts from both adapted and other buckets', async () => {
    // adapted1 = alive, adapted2 = ghost, other1 = ghost, other2 = alive.
    accessMock
      .mockResolvedValueOnce(undefined) // adapted1 ok
      .mockRejectedValueOnce(new Error('ENOENT')) // adapted2 gone
      .mockRejectedValueOnce(new Error('ENOENT')) // other1 gone
      .mockResolvedValueOnce(undefined); // other2 ok

    const input = makeResult(
      [
        makeApp('adapted1', 'C:\\Apps\\a1.exe', 'traework'),
        makeApp('adapted2', 'C:\\Gone\\a2.exe', 'qoderwork'),
      ],
      [makeApp('other1', 'D:\\Gone\\o1.exe'), makeApp('other2', 'D:\\Apps\\o2.exe')],
    );

    const result = await validateExistence(input);

    expect(result.adapted).toHaveLength(1);
    expect(result.adapted[0].id).toBe('adapted1');
    expect(result.other).toHaveLength(1);
    expect(result.other[0].id).toBe('other2');
  });

  // -----------------------------------------------------------------------
  // Empty input — no-op
  // -----------------------------------------------------------------------
  it('returns empty buckets when input is empty', async () => {
    const input = makeResult([], []);

    const result = await validateExistence(input);

    expect(result.adapted).toHaveLength(0);
    expect(result.other).toHaveLength(0);
    expect(accessMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Preserves meta if present
  // -----------------------------------------------------------------------
  it('carries meta through unchanged when all entries are valid', async () => {
    accessMock.mockResolvedValue(undefined);

    const input = {
      adapted: [makeApp('a1', 'C:\\Apps\\a1.exe', 'traework')],
      other: [],
      meta: {
        durationMs: 123,
        pipeline: 'v2',
        collectedAt: Date.now(),
        timedOut: false,
        degradedSources: [],
        scannedRoots: ['C:\\Program Files'],
      },
    } as Parameters<typeof validateExistence>[0];

    const result = await validateExistence(input);

    expect(result.meta).toEqual(input.meta);
  });
});
