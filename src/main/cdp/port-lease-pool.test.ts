// SPDX-License-Identifier: MPL-2.0

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_LEASE_TIMEOUT_MS,
  DEFAULT_MAX_PORT,
  DEFAULT_MIN_PORT,
  type PortLease,
  PortLeasePool,
} from './port-manager';

/**
 * Isolated lock directory per test — prevents cross-test interference and
 * avoids polluting the production tmpdir.
 */
let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agentskin-port-lease-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Create a pool backed by the test's isolated tmpDir. */
function createPool(overrides: Partial<ConstructorParameters<typeof PortLeasePool>[0]> = {}) {
  return new PortLeasePool({ lockDir: tmpDir, ...overrides });
}

describe('PortLeasePool', () => {
  // -------------------------------------------------------------------------
  // 1. Basic acquire and release
  // -------------------------------------------------------------------------
  describe('acquire / release', () => {
    it('acquires a lease with valid structure', async () => {
      const pool = createPool();
      const lease = await pool.acquire();

      expect(lease.port).toBeGreaterThanOrEqual(DEFAULT_MIN_PORT);
      expect(lease.port).toBeLessThanOrEqual(DEFAULT_MAX_PORT);
      expect(lease.leaseId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(lease.acquiredAt).toBeTypeOf('number');
      expect(lease.expiresAt).toBe(lease.acquiredAt + DEFAULT_LEASE_TIMEOUT_MS);
    });

    it('acquires the lowest available port first', async () => {
      const pool = createPool();
      const lease = await pool.acquire();
      expect(lease.port).toBe(DEFAULT_MIN_PORT);
    });

    it('releases a lease and frees the port', async () => {
      const pool = createPool();
      const lease = await pool.acquire();

      await pool.release(lease.leaseId);

      const status = pool.getStatus();
      expect(status.leases).toHaveLength(0);
      expect(status.available).toBe(status.total);
    });

    it('re-acquires the same port after release', async () => {
      const pool = createPool();
      const lease1 = await pool.acquire();
      await pool.release(lease1.leaseId);

      const lease2 = await pool.acquire();
      expect(lease2.port).toBe(lease1.port);
      expect(lease2.leaseId).not.toBe(lease1.leaseId); // new lease
    });

    it('respects custom timeout', async () => {
      const pool = createPool();
      const customTtl = 5000;
      const before = Date.now();
      const lease = await pool.acquire(customTtl);
      const after = Date.now();

      expect(lease.expiresAt).toBeGreaterThanOrEqual(before + customTtl);
      expect(lease.expiresAt).toBeLessThanOrEqual(after + customTtl);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Pool exhaustion
  // -------------------------------------------------------------------------
  describe('pool exhaustion', () => {
    it('allocates distinct ports until the pool is full', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1; // 7
      const leases: PortLease[] = [];

      for (let i = 0; i < total; i++) {
        leases.push(await pool.acquire());
      }

      // All ports should be unique.
      const ports = new Set(leases.map((l) => l.port));
      expect(ports.size).toBe(total);

      const status = pool.getStatus();
      expect(status.available).toBe(0);
      expect(status.leases).toHaveLength(total);
    });

    it('throws when all ports are occupied', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;

      for (let i = 0; i < total; i++) {
        await pool.acquire();
      }

      await expect(pool.acquire()).rejects.toThrow(/all ports exhausted/);
    });

    it('makes a port available again after release from full pool', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;
      const leases: PortLease[] = [];

      for (let i = 0; i < total; i++) {
        leases.push(await pool.acquire());
      }

      // Release the third lease.
      await pool.release(leases[2].leaseId);

      const status = pool.getStatus();
      expect(status.available).toBe(1);

      // Next acquire should get the freed port.
      const newLease = await pool.acquire();
      expect(newLease.port).toBe(leases[2].port);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Timeout auto-release
  // -------------------------------------------------------------------------
  describe('timeout auto-release', () => {
    it('auto-releases a lease after the timeout elapses', async () => {
      vi.useFakeTimers();
      try {
        const pool = createPool({ defaultTimeoutMs: 1000 });
        const lease = await pool.acquire();

        // Advance time past the lease timeout.
        await vi.advanceTimersByTimeAsync(1100);

        const status = pool.getStatus();
        expect(status.leases).toHaveLength(0);
        expect(status.available).toBe(status.total);

        // The leaseId should no longer be valid.
        await pool.release(lease.leaseId); // should be a no-op (warns)
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not auto-release before the timeout', async () => {
      vi.useFakeTimers();
      try {
        const pool = createPool({ defaultTimeoutMs: 5000 });
        await pool.acquire();

        await vi.advanceTimersByTimeAsync(4900);

        const status = pool.getStatus();
        expect(status.leases).toHaveLength(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. leaseId ownership validation
  // -------------------------------------------------------------------------
  describe('leaseId ownership', () => {
    it('rejects release with an unknown leaseId (no-op)', async () => {
      const pool = createPool();
      const lease = await pool.acquire();

      // Should not throw — just log a warning.
      await expect(pool.release('non-existent-lease-id')).resolves.toBeUndefined();

      // Original lease should still be active.
      const status = pool.getStatus();
      expect(status.leases).toHaveLength(1);
      expect(status.leases[0].leaseId).toBe(lease.leaseId);
    });

    it('rejects renew with an unknown leaseId', async () => {
      const pool = createPool();
      await pool.acquire();

      await expect(pool.release('fake-id')).resolves.toBeUndefined();
      await expect(pool.renew('fake-id')).rejects.toThrow(/cannot renew unknown leaseId/);
    });

    it('prevents double-release', async () => {
      const pool = createPool();
      const lease = await pool.acquire();

      await pool.release(lease.leaseId);
      // Second release should be a safe no-op.
      await expect(pool.release(lease.leaseId)).resolves.toBeUndefined();

      const status = pool.getStatus();
      expect(status.leases).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Concurrent acquire
  // -------------------------------------------------------------------------
  describe('concurrent acquire', () => {
    it('allocates distinct ports under concurrent requests', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;

      // Fire all acquires simultaneously.
      const results = await Promise.all(Array.from({ length: total }, () => pool.acquire()));

      const ports = new Set(results.map((l) => l.port));
      expect(ports.size).toBe(total);

      const status = pool.getStatus();
      expect(status.available).toBe(0);
    });

    it('serializes concurrent requests beyond pool capacity', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;

      // Fire more concurrent requests than available ports.
      const results = await Promise.allSettled(
        Array.from({ length: total + 3 }, () => pool.acquire()),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly `total` should succeed; the rest should fail.
      expect(fulfilled.length).toBe(total);
      expect(rejected.length).toBe(3);

      // All successful ports must be unique.
      const ports = new Set(
        fulfilled.map((r) => (r as PromiseFulfilledResult<PortLease>).value.port),
      );
      expect(ports.size).toBe(total);
    });

    it('handles interleaved acquire and release concurrently', async () => {
      const pool = createPool();

      // Acquire 3 leases.
      const l1 = await pool.acquire();
      const l2 = await pool.acquire();
      const l3 = await pool.acquire();

      // Release them concurrently and acquire new ones.
      const [new1, new2, new3] = await Promise.all([
        (async () => {
          await pool.release(l1.leaseId);
          return pool.acquire();
        })(),
        (async () => {
          await pool.release(l2.leaseId);
          return pool.acquire();
        })(),
        (async () => {
          await pool.release(l3.leaseId);
          return pool.acquire();
        })(),
      ]);

      // All new leases should have valid ports.
      for (const lease of [new1, new2, new3]) {
        expect(lease.port).toBeGreaterThanOrEqual(DEFAULT_MIN_PORT);
        expect(lease.port).toBeLessThanOrEqual(DEFAULT_MAX_PORT);
      }

      const status = pool.getStatus();
      expect(status.leases).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Renew
  // -------------------------------------------------------------------------
  describe('renew', () => {
    it('extends the lease expiration', async () => {
      vi.useFakeTimers();
      try {
        const pool = createPool({ defaultTimeoutMs: 5000 });
        const lease = await pool.acquire();
        const originalExpiry = lease.expiresAt;

        // Advance 4 seconds (lease about to expire).
        await vi.advanceTimersByTimeAsync(4000);

        // Renew for another 5 seconds.
        await pool.renew(lease.leaseId, 5000);

        // The new expiry should be ~5 seconds from now (not from original).
        const now = Date.now();
        expect(lease.expiresAt).toBe(now + 5000);
        expect(lease.expiresAt).toBeGreaterThan(originalExpiry);

        // Advance 4 more seconds — should NOT have expired (renewed).
        await vi.advanceTimersByTimeAsync(4000);
        expect(pool.getStatus().leases).toHaveLength(1);

        // Advance past the renewed expiry.
        await vi.advanceTimersByTimeAsync(2000);
        expect(pool.getStatus().leases).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses default timeout when renew is called without args', async () => {
      const pool = createPool({ defaultTimeoutMs: 10000 });
      const lease = await pool.acquire();
      const originalExpiry = lease.expiresAt;

      // Wait a bit.
      await new Promise((r) => setTimeout(r, 50));

      await pool.renew(lease.leaseId);

      // New expiry should be ~defaultTimeoutMs from now.
      expect(lease.expiresAt).toBeGreaterThan(originalExpiry);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Cleanup
  // -------------------------------------------------------------------------
  describe('cleanup', () => {
    it('reclaims expired leases on demand', async () => {
      vi.useFakeTimers();
      try {
        const pool = createPool({ defaultTimeoutMs: 200 });
        const lease = await pool.acquire();

        // Advance logical time past the expiry, but the auto-release timer
        // has NOT been pumped yet (it's pending). This simulates the window
        // where the lease is logically expired but not yet reclaimed.
        await vi.advanceTimersByTimeAsync(250);

        // The timer fired during advanceTimersByTimeAsync, so the lease is
        // already auto-released. cleanup() is a no-op in this case but must
        // still be safe.
        expect(pool.getStatus().leases).toHaveLength(0);

        await pool.cleanup();

        // The leaseId should no longer be valid.
        await pool.release(lease.leaseId); // no-op
      } finally {
        vi.useRealTimers();
      }
    });

    it('cleanup reclaims leases when timer has not yet fired', async () => {
      vi.useFakeTimers();
      try {
        const pool = createPool({ defaultTimeoutMs: 5000 });
        const lease = await pool.acquire();

        // Set system time forward past expiry without pumping timers.
        vi.setSystemTime(Date.now() + 6000);

        // Lease is logically expired (expiresAt < now) but the auto-release
        // timer is still pending. cleanup() should reclaim it.
        expect(pool.getStatus().leases).toHaveLength(1);

        await pool.cleanup();

        expect(pool.getStatus().leases).toHaveLength(0);

        // The leaseId should no longer be valid.
        await pool.release(lease.leaseId); // no-op
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not release non-expired leases during cleanup', async () => {
      const pool = createPool({ defaultTimeoutMs: 60000 });
      await pool.acquire();

      await pool.cleanup();

      expect(pool.getStatus().leases).toHaveLength(1);
    });

    it('cleans up multiple expired leases at once', async () => {
      const pool = createPool({ defaultTimeoutMs: 100 });
      const leases: PortLease[] = [];

      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;
      for (let i = 0; i < total; i++) {
        leases.push(await pool.acquire());
      }

      // Wait for all to expire.
      await new Promise((r) => setTimeout(r, 200));

      await pool.cleanup();

      expect(pool.getStatus().leases).toHaveLength(0);
      expect(pool.getStatus().available).toBe(total);
    });
  });

  // -------------------------------------------------------------------------
  // 8. getStatus
  // -------------------------------------------------------------------------
  describe('getStatus', () => {
    it('returns correct counts when empty', () => {
      const pool = createPool();
      const status = pool.getStatus();

      expect(status.total).toBe(DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1);
      expect(status.available).toBe(status.total);
      expect(status.leases).toEqual([]);
    });

    it('returns an immutable snapshot of leases', async () => {
      const pool = createPool();
      const lease = await pool.acquire();

      const status = pool.getStatus();
      // Mutating the returned array should not affect the pool.
      status.leases.pop();
      status.leases[0] = { ...status.leases[0], port: 99999 };

      const status2 = pool.getStatus();
      expect(status2.leases).toHaveLength(1);
      expect(status2.leases[0].port).toBe(lease.port);
    });
  });

  // -------------------------------------------------------------------------
  // 9. dispose
  // -------------------------------------------------------------------------
  describe('dispose', () => {
    it('releases all active leases and clears timers', async () => {
      const pool = createPool();
      const total = DEFAULT_MAX_PORT - DEFAULT_MIN_PORT + 1;

      for (let i = 0; i < total; i++) {
        await pool.acquire();
      }

      await pool.dispose();

      const status = pool.getStatus();
      expect(status.leases).toHaveLength(0);
      expect(status.available).toBe(total);
    });

    it('dispose is safe on an empty pool', async () => {
      const pool = createPool();
      await expect(pool.dispose()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 10. Stale lock recovery (crash scenario)
  // -------------------------------------------------------------------------
  describe('stale lock recovery', () => {
    it('steals an expired lock from a previous process', async () => {
      // Simulate a crashed process by manually creating an expired lock.
      const port = DEFAULT_MIN_PORT;
      const lockDir = path.join(tmpDir, `${port}.lock`);
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        path.join(lockDir, 'lease.json'),
        JSON.stringify({
          port,
          leaseId: 'stale-lease-id',
          acquiredAt: Date.now() - 60_000,
          expiresAt: Date.now() - 30_000, // expired 30s ago
        }),
      );

      const pool = createPool();
      const lease = await pool.acquire();

      // Should have stolen the expired lock.
      expect(lease.port).toBe(port);
      expect(lease.leaseId).not.toBe('stale-lease-id');
    });

    it('does not steal a valid (non-expired) lock', async () => {
      // Create a valid lock held by another "process".
      const port = DEFAULT_MIN_PORT;
      const lockDir = path.join(tmpDir, `${port}.lock`);
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(lockDir, { recursive: true });
      await writeFile(
        path.join(lockDir, 'lease.json'),
        JSON.stringify({
          port,
          leaseId: 'active-lease-id',
          acquiredAt: Date.now(),
          expiresAt: Date.now() + 60_000, // valid for 60s
        }),
      );

      const pool = createPool();
      const lease = await pool.acquire();

      // Should have gotten the next port, not the locked one.
      expect(lease.port).not.toBe(port);
      expect(lease.port).toBe(port + 1);
    });
  });
});
