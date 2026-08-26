// SPDX-License-Identifier: MIT
//
// # cdp-port-lease.test.ts — unit tests for the CDP Port Lease Pool.
//
// Validates:
//   - Port acquisition and release (normal flow)
//   - Concurrent lock acquisition (simulated multi-process)
//   - leaseId ownership verification
//   - Port pool exhaustion handling
//   - Stale lock reclamation (dead pid / timeout)
//   - Edge cases (invalid range, invalid ports, etc.)
//   - Error type assertions

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LeaseOwnershipError,
  PortLeasePool,
  PortPoolExhaustedError,
} from '../../scripts/lib/cdp-port-lease.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a unique temporary directory for each test. */
function createTempRoot(): string {
  const id = Math.random().toString(36).slice(2, 10);
  const root = join(tmpdir(), `cdp-port-lease-test-${id}`);
  mkdirSync(root, { recursive: true });
  return root;
}

/** Create a lock directory for a port (simulating another process). */
function createStaleLock(lockRoot: string, port: number, ownerData: Record<string, unknown>): void {
  const lockDir = join(lockRoot, String(port));
  mkdirSync(lockDir, { recursive: false });
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(ownerData), 'utf8');
}

// ===========================================================================
// 1. Constructor validation
// ===========================================================================

describe('constructor', () => {
  it('creates a pool with valid config', () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot: createTempRoot() });
    expect(pool.minPort).toBe(9223);
    expect(pool.maxPort).toBe(9229);
    expect(pool.staleTimeoutMs).toBe(30_000);
  });

  it('accepts a custom staleTimeoutMs', () => {
    const pool = new PortLeasePool({
      minPort: 9223,
      maxPort: 9229,
      lockRoot: createTempRoot(),
      staleTimeoutMs: 5_000,
    });
    expect(pool.staleTimeoutMs).toBe(5_000);
  });

  it('throws when minPort > maxPort', () => {
    expect(
      () => new PortLeasePool({ minPort: 9229, maxPort: 9223, lockRoot: createTempRoot() }),
    ).toThrow(/minPort \(9229\) must be <= maxPort \(9223\)/);
  });

  it('throws when ports are not integers', () => {
    expect(
      () =>
        new PortLeasePool({
          minPort: 9223.5 as unknown as number,
          maxPort: 9229,
          lockRoot: createTempRoot(),
        }),
    ).toThrow(/must be integers/);
  });

  it('throws when ports are out of valid range [1, 65535]', () => {
    expect(
      () => new PortLeasePool({ minPort: 0, maxPort: 9229, lockRoot: createTempRoot() }),
    ).toThrow(/ports must be in range/);

    expect(
      () => new PortLeasePool({ minPort: 9223, maxPort: 70000, lockRoot: createTempRoot() }),
    ).toThrow(/ports must be in range/);
  });

  it('throws when staleTimeoutMs is not positive', () => {
    expect(
      () =>
        new PortLeasePool({
          minPort: 9223,
          maxPort: 9229,
          lockRoot: createTempRoot(),
          staleTimeoutMs: 0,
        }),
    ).toThrow(/staleTimeoutMs must be positive/);
  });

  it('throws when lockRoot is empty', () => {
    expect(() => new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot: '' })).toThrow(
      /lockRoot must be a non-empty string/,
    );
  });
});

// ===========================================================================
// 2. acquire — normal flow
// ===========================================================================

describe('acquire', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('acquires the first available port', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const result = await pool.acquire();

    expect(result.port).toBe(9223);
    expect(typeof result.leaseId).toBe('string');
    expect(result.leaseId).toMatch(/^lease_/);
  });

  it('acquires the next port when the first is locked', async () => {
    // Pre-lock port 9223
    createStaleLock(lockRoot, 9223, { leaseId: 'other', pid: 99999, timestamp: Date.now() });

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const result = await pool.acquire();

    expect(result.port).toBe(9224);
  });

  it('writes owner.json after acquiring a port', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port } = await pool.acquire();

    const ownerPath = join(lockRoot, String(port), 'owner.json');
    expect(existsSync(ownerPath)).toBe(true);
  });

  it('returns unique leaseIds for different acquisitions', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const a = await pool.acquire();
    const b = await pool.acquire();

    expect(a.leaseId).not.toBe(b.leaseId);
    expect(a.port).not.toBe(b.port);
  });

  it('acquires multiple ports sequentially', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const results = [];

    for (let i = 0; i < 3; i++) {
      results.push(await pool.acquire());
    }

    expect(results).toHaveLength(3);
    expect(results[0].port).toBe(9223);
    expect(results[1].port).toBe(9224);
    expect(results[2].port).toBe(9225);
  });
});

// ===========================================================================
// 3. release — normal flow
// ===========================================================================

describe('release', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('releases an acquired port and removes the lock directory', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port, leaseId } = await pool.acquire();

    expect(existsSync(join(lockRoot, String(port)))).toBe(true);

    await pool.release(port, leaseId);

    expect(existsSync(join(lockRoot, String(port)))).toBe(false);
  });

  it('allows re-acquiring a released port', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const first = await pool.acquire();
    await pool.release(first.port, first.leaseId);

    const second = await pool.acquire();
    expect(second.port).toBe(first.port);
  });

  it('throws LeaseOwnershipError for wrong leaseId', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port } = await pool.acquire();

    await expect(pool.release(port, 'wrong-lease-id')).rejects.toThrow(LeaseOwnershipError);
  });

  it('throws when releasing a port with no active lock', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });

    await expect(pool.release(9223, 'some-lease')).rejects.toThrow(/no active lock/);
  });

  it('throws when releasing a port outside the range', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });

    await expect(pool.release(8000, 'some-lease')).rejects.toThrow(/outside range/);
  });
});

// ===========================================================================
// 4. isOwner
// ===========================================================================

describe('isOwner', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('returns true for the correct leaseId', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port, leaseId } = await pool.acquire();

    expect(await pool.isOwner(port, leaseId)).toBe(true);
  });

  it('returns false for an incorrect leaseId', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port } = await pool.acquire();

    expect(await pool.isOwner(port, 'wrong-id')).toBe(false);
  });

  it('returns false for a port with no lock', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });

    expect(await pool.isOwner(9223, 'any-id')).toBe(false);
  });

  it('returns false after the port is released', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port, leaseId } = await pool.acquire();

    expect(await pool.isOwner(port, leaseId)).toBe(true);
    await pool.release(port, leaseId);
    expect(await pool.isOwner(port, leaseId)).toBe(false);
  });
});

// ===========================================================================
// 5. list
// ===========================================================================

describe('list', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('returns empty array when no ports are leased', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    expect(await pool.list()).toEqual([]);
  });

  it('returns all leased ports with metadata', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const a = await pool.acquire();
    const b = await pool.acquire();

    const entries = await pool.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].port).toBe(a.port);
    expect(entries[0].leaseId).toBe(a.leaseId);
    expect(entries[1].port).toBe(b.port);
    expect(entries[1].leaseId).toBe(b.leaseId);
  });

  it('entries are sorted by port number', async () => {
    // Pre-create a lock for 9225 so acquire skips to 9223, 9224, 9226
    createStaleLock(lockRoot, 9225, { leaseId: 'x', pid: 99999, timestamp: Date.now() });

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    await pool.acquire(); // 9223
    await pool.acquire(); // 9224
    await pool.acquire(); // 9226

    const entries = await pool.list();
    const ports = entries.map((e) => e.port);
    expect(ports).toEqual([...ports].sort((x, y) => x - y));
  });
});

// ===========================================================================
// 6. Port pool exhaustion
// ===========================================================================

describe('PortPoolExhaustedError', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('throws PortPoolExhaustedError when all ports are leased', async () => {
    // Pre-lock all 7 ports
    for (let port = 9223; port <= 9229; port++) {
      createStaleLock(lockRoot, port, {
        leaseId: `lock-${port}`,
        pid: 99999,
        timestamp: Date.now(),
      });
    }

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    await expect(pool.acquire()).rejects.toThrow(PortPoolExhaustedError);
  });

  it('error includes port range information', async () => {
    for (let port = 9223; port <= 9229; port++) {
      createStaleLock(lockRoot, port, {
        leaseId: `lock-${port}`,
        pid: 99999,
        timestamp: Date.now(),
      });
    }

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    try {
      await pool.acquire();
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(PortPoolExhaustedError);
      expect((err as PortPoolExhaustedError).minPort).toBe(9223);
      expect((err as PortPoolExhaustedError).maxPort).toBe(9229);
    }
  });

  it('throws after acquiring all ports in a single-port pool', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9223, lockRoot });
    await pool.acquire();
    await expect(pool.acquire()).rejects.toThrow(PortPoolExhaustedError);
  });
});

// ===========================================================================
// 7. Stale lock reclamation (cleanup)
// ===========================================================================

describe('cleanup', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('returns 0 when no locks exist', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    expect(await pool.cleanup()).toBe(0);
  });

  it('reclaims locks owned by dead processes', async () => {
    // PID 99999 almost certainly doesn't exist
    createStaleLock(lockRoot, 9223, { leaseId: 'dead', pid: 99999, timestamp: Date.now() });

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const reclaimed = await pool.cleanup();

    expect(reclaimed).toBe(1);
    expect(existsSync(join(lockRoot, '9223'))).toBe(false);
  });

  it('reclaims locks that exceed the stale timeout', async () => {
    // Create a lock with a timestamp far in the past
    const oldTimestamp = Date.now() - 60_000; // 60s ago
    createStaleLock(lockRoot, 9223, { leaseId: 'old', pid: 99999, timestamp: oldTimestamp });

    const pool = new PortLeasePool({
      minPort: 9223,
      maxPort: 9229,
      lockRoot,
      staleTimeoutMs: 30_000,
    });
    const reclaimed = await pool.cleanup();

    expect(reclaimed).toBe(1);
  });

  it('does not reclaim locks owned by the current process', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    await pool.acquire(); // owned by current process

    const reclaimed = await pool.cleanup();
    expect(reclaimed).toBe(0);
    expect(existsSync(join(lockRoot, '9223'))).toBe(true);
  });

  it('reclaims locks with missing owner.json', async () => {
    // Create a lock directory without owner.json
    mkdirSync(join(lockRoot, '9223'), { recursive: false });

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const reclaimed = await pool.cleanup();

    expect(reclaimed).toBe(1);
  });

  it('reclaims locks with malformed owner.json', async () => {
    const lockDir = join(lockRoot, '9223');
    mkdirSync(lockDir, { recursive: false });
    writeFileSync(join(lockDir, 'owner.json'), 'not valid json{{{', 'utf8');

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const reclaimed = await pool.cleanup();

    expect(reclaimed).toBe(1);
  });

  it('reclaims only stale locks, preserving live ones', async () => {
    // Dead PID lock
    createStaleLock(lockRoot, 9223, { leaseId: 'dead', pid: 99999, timestamp: Date.now() });
    // Live lock (current process)
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    await pool.acquire(); // 9224, owned by current process

    const reclaimed = await pool.cleanup();
    expect(reclaimed).toBe(1);
    expect(existsSync(join(lockRoot, '9223'))).toBe(false);
    expect(existsSync(join(lockRoot, '9224'))).toBe(true);
  });

  it('after cleanup, acquired ports become available', async () => {
    createStaleLock(lockRoot, 9223, { leaseId: 'dead', pid: 99999, timestamp: Date.now() });

    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    await pool.cleanup();

    const result = await pool.acquire();
    expect(result.port).toBe(9223);
  });
});

// ===========================================================================
// 8. Concurrent lock acquisition
// ===========================================================================

describe('concurrent acquisition', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('two pools acquire different ports from the same range', async () => {
    const pool1 = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const pool2 = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });

    const r1 = await pool1.acquire();
    const r2 = await pool2.acquire();

    expect(r1.port).not.toBe(r2.port);
  });

  it('rapid sequential acquires yield unique ports', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const ports = new Set<number>();

    for (let i = 0; i < 7; i++) {
      const { port } = await pool.acquire();
      ports.add(port);
    }

    expect(ports.size).toBe(7);
  });

  it('concurrent acquire calls do not produce duplicate ports', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const results = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);

    const ports = results.map((r) => r.port);
    expect(new Set(ports).size).toBe(ports.length);
  });
});

// ===========================================================================
// 9. LeaseOwnershipError specifics
// ===========================================================================

describe('LeaseOwnershipError', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('error contains port and leaseId properties', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port } = await pool.acquire();

    try {
      await pool.release(port, 'wrong-id');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(LeaseOwnershipError);
      expect((err as LeaseOwnershipError).port).toBe(port);
      expect((err as LeaseOwnershipError).leaseId).toBe('wrong-id');
    }
  });

  it('error name is LeaseOwnershipError', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const { port } = await pool.acquire();

    await expect(pool.release(port, 'wrong')).rejects.toThrow(
      /leaseId "wrong" is not the owner of port/,
    );
  });
});

// ===========================================================================
// 10. Integration scenarios
// ===========================================================================

describe('integration scenarios', () => {
  let lockRoot: string;

  beforeEach(() => {
    lockRoot = createTempRoot();
  });

  afterEach(() => {
    rmSync(lockRoot, { recursive: true, force: true });
  });

  it('full lifecycle: acquire → verify → release → re-acquire', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });

    const { port, leaseId } = await pool.acquire();
    expect(await pool.isOwner(port, leaseId)).toBe(true);

    await pool.release(port, leaseId);
    expect(await pool.isOwner(port, leaseId)).toBe(false);

    const second = await pool.acquire();
    expect(second.port).toBe(port);
    expect(await pool.isOwner(second.port, second.leaseId)).toBe(true);
  });

  it('manages 7 concurrent CDP connections (9223-9229)', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9229, lockRoot });
    const leases: Array<{ port: number; leaseId: string }> = [];

    // Acquire all 7 ports
    for (let i = 0; i < 7; i++) {
      leases.push(await pool.acquire());
    }

    expect(leases).toHaveLength(7);
    expect(await pool.list()).toHaveLength(7);

    // Release all
    for (const { port, leaseId } of leases) {
      await pool.release(port, leaseId);
    }

    expect(await pool.list()).toHaveLength(0);
  });

  it('handles acquire-release-acquire cycles without leaking state', async () => {
    const pool = new PortLeasePool({ minPort: 9223, maxPort: 9225, lockRoot });

    for (let cycle = 0; cycle < 5; cycle++) {
      const leases = [];
      for (let i = 0; i < 3; i++) {
        leases.push(await pool.acquire());
      }
      for (const { port, leaseId } of leases) {
        await pool.release(port, leaseId);
      }
      expect(await pool.list()).toHaveLength(0);
    }
  });
});
