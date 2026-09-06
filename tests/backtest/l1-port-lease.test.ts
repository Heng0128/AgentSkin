// SPDX-License-Identifier: MPL-2.0

/**
 * # L1 — Port Lease Pool (Mocked Side Effects)
 *
 * Tests PortLeasePool with mocked fs operations. No real filesystem or
 * network I/O occurs — all mkdir/readFile/writeFile/rm calls are intercepted
 * by vi.mock.
 *
 * Run: npm run test:backtest:l1
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs/promises — intercept all filesystem operations
// ---------------------------------------------------------------------------

const mockFs = {
  mkdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  rm: vi.fn(),
};

vi.mock('node:fs/promises', () => ({
  default: mockFs,
  mkdir: mockFs.mkdir,
  readFile: mockFs.readFile,
  writeFile: mockFs.writeFile,
  rm: mockFs.rm,
}));

const { PortLeasePool } = await import('../../../src/main/cdp/port-manager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the in-memory filesystem state between tests. */
function resetMockFs() {
  mockFs.mkdir.mockReset();
  mockFs.readFile.mockReset();
  mockFs.writeFile.mockReset();
  mockFs.rm.mockReset();
}

/** Simulate a successful mkdir (port is free). */
function mockPortFree() {
  mockFs.mkdir.mockResolvedValue(undefined);
}

/** Simulate an EEXIST mkdir failure (port is locked with a valid non-stealable lease). */
function mockPortLocked() {
  const err = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
  mockFs.mkdir.mockRejectedValueOnce(err);
  // Return a valid, non-expired lease so tryStealExpired returns false.
  mockFs.readFile.mockResolvedValueOnce(
    JSON.stringify({
      port: 9223,
      leaseId: 'active-lock-id',
      acquiredAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }),
  );
}

/** Simulate a stale lock with expired lease.json. */
function mockStaleLock(expiresAgo: number) {
  mockFs.mkdir.mockRejectedValueOnce(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
  mockFs.readFile.mockResolvedValueOnce(
    JSON.stringify({
      port: 9223,
      leaseId: 'stale-id',
      acquiredAt: Date.now() - 60_000,
      expiresAt: Date.now() - expiresAgo,
    }),
  );
  // After rm, the second mkdir succeeds.
  mockFs.rm.mockResolvedValueOnce(undefined);
  mockFs.mkdir.mockResolvedValueOnce(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('L1 — PortLeasePool: acquire / release', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('acquires a port when mkdir succeeds', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    const lease = await pool.acquire();

    expect(lease.port).toBe(9223);
    expect(lease.leaseId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(mockFs.mkdir).toHaveBeenCalledTimes(1);
    expect(mockFs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('releases a lease and removes the lock directory', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    const lease = await pool.acquire();

    await pool.release(lease.leaseId);

    expect(mockFs.rm).toHaveBeenCalledTimes(1);
    expect(pool.getStatus().leases).toHaveLength(0);
  });

  it('throws when all ports are occupied', async () => {
    mockPortLocked();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases', minPort: 9223, maxPort: 9223 });

    await expect(pool.acquire()).rejects.toThrow(/all ports exhausted/);
  });

  it('skips locked ports and acquires the next free one', async () => {
    // First port locked, second free.
    mockPortLocked();
    mockPortFree();

    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases', minPort: 9223, maxPort: 9224 });
    const lease = await pool.acquire();

    expect(lease.port).toBe(9224);
  });
});

describe('L1 — PortLeasePool: leaseId ownership', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('rejects release with unknown leaseId (no-op)', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    await pool.acquire();

    // Should not throw.
    await expect(pool.release('unknown-id')).resolves.toBeUndefined();

    // Original lease still active.
    expect(pool.getStatus().leases).toHaveLength(1);
  });

  it('rejects renew with unknown leaseId', async () => {
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    await expect(pool.renew('fake-id')).rejects.toThrow(/cannot renew unknown leaseId/);
  });

  it('prevents double-release', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    const lease = await pool.acquire();

    await pool.release(lease.leaseId);
    await expect(pool.release(lease.leaseId)).resolves.toBeUndefined();

    expect(pool.getStatus().leases).toHaveLength(0);
  });
});

describe('L1 — PortLeasePool: renew', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('extends the lease expiration', async () => {
    mockPortFree();
    mockPortFree(); // for renew writeFile
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases', defaultTimeoutMs: 5000 });
    const lease = await pool.acquire();
    const originalExpiry = lease.expiresAt;

    // Advance 4 seconds.
    await vi.advanceTimersByTimeAsync(4000);

    // Renew for another 5 seconds.
    mockPortFree();
    await pool.renew(lease.leaseId, 5000);

    expect(lease.expiresAt).toBeGreaterThan(originalExpiry);
  });
});

describe('L1 — PortLeasePool: stale lock recovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('steals an expired lock from a crashed process', async () => {
    mockStaleLock(30_000); // expired 30s ago
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases', minPort: 9223, maxPort: 9223 });
    const lease = await pool.acquire();

    expect(lease.port).toBe(9223);
    expect(lease.leaseId).not.toBe('stale-id');
    expect(mockFs.rm).toHaveBeenCalled(); // old lock removed
  });

  it('does not steal a valid (non-expired) lock', async () => {
    // Port 9223 has a valid lock.
    mockFs.mkdir.mockRejectedValueOnce(Object.assign(new Error('EEXIST'), { code: 'EEXIST' }));
    mockFs.readFile.mockResolvedValueOnce(
      JSON.stringify({
        port: 9223,
        leaseId: 'active-id',
        acquiredAt: Date.now(),
        expiresAt: Date.now() + 60_000, // valid for 60s
      }),
    );
    // Port 9224 is free.
    mockPortFree();

    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases', minPort: 9223, maxPort: 9224 });
    const lease = await pool.acquire();

    expect(lease.port).toBe(9224); // skipped the locked port
  });
});

describe('L1 — PortLeasePool: getStatus snapshot immutability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('returns an immutable snapshot', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    await pool.acquire();

    const status = pool.getStatus();
    status.leases.pop();
    status.leases[0] = { ...status.leases[0], port: 99999 };

    const status2 = pool.getStatus();
    expect(status2.leases).toHaveLength(1);
    expect(status2.leases[0].port).toBe(9223);
  });
});

describe('L1 — PortLeasePool: dispose', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMockFs();
  });
  afterEach(() => vi.useRealTimers());

  it('releases all active leases', async () => {
    mockPortFree();
    const pool = new PortLeasePool({ lockDir: '/tmp/test-leases' });
    await pool.acquire();
    await pool.acquire();

    expect(pool.getStatus().leases).toHaveLength(2);

    await pool.dispose();

    expect(pool.getStatus().leases).toHaveLength(0);
  });
});
