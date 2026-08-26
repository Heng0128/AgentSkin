// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # cdp-port-lease.mjs — CDP Port Lease Pool
//
// Manages a pool of CDP (Chrome DevTools Protocol) ports using atomic mkdir
// for lock acquisition and leaseId ownership verification. Inspired by
// Lumos-789/zcode-cdp's port lease pool mechanism for managing 7 concurrent
// CDP connections (ports 9223-9229).
//
// Architecture:
//   acquire()  →  atomic mkdir(lockRoot/port)  →  write owner.json  →  { port, leaseId }
//   release()  →  verify leaseId               →  rm -rf lockDir
//   isOwner()  →  read owner.json              →  compare leaseId
//   cleanup()  →  scan lockRoot                →  reap stale locks (dead pid / timeout)
//
// Atomicity guarantee: fs.mkdir with { recursive: false } fails if the directory
// already exists, providing a cross-platform atomic compare-and-swap primitive.

import { existsSync } from 'node:fs';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default stale lock timeout in milliseconds (30s). */
const DEFAULT_STALE_TIMEOUT_MS = 30_000;

/** Name of the owner metadata file written inside each port lock directory. */
const OWNER_FILENAME = 'owner.json';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Error thrown when the port pool is exhausted — all ports in the range
 * are leased and none could be acquired.
 */
export class PortPoolExhaustedError extends Error {
  constructor(minPort, maxPort) {
    super(`PortLeasePool: all ports in range [${minPort}, ${maxPort}] are leased`);
    this.name = 'PortPoolExhaustedError';
    this.minPort = minPort;
    this.maxPort = maxPort;
  }
}

/**
 * Error thrown when an operation references a port with an invalid
 * or non-matching leaseId (ownership verification failure).
 */
export class LeaseOwnershipError extends Error {
  constructor(port, leaseId) {
    super(`LeaseOwnershipError: leaseId "${leaseId}" is not the owner of port ${port}`);
    this.name = 'LeaseOwnershipError';
    this.port = port;
    this.leaseId = leaseId;
  }
}

// ---------------------------------------------------------------------------
// PortLeasePool
// ---------------------------------------------------------------------------

/**
 * Manages a pool of CDP ports using atomic filesystem locks.
 *
 * Each acquired port gets a dedicated lock directory under `lockRoot`
 * containing an `owner.json` metadata file. The lock directory name
 * is the port number (e.g. `lockRoot/9223`), and the mkdir call
 * serves as the atomic compare-and-swap primitive.
 */
export class PortLeasePool {
  /** @type {number} */
  #minPort;

  /** @type {number} */
  #maxPort;

  /** @type {string} */
  #lockRoot;

  /** @type {number} */
  #staleTimeoutMs;

  /** @type {number} */
  #leaseCounter;

  /**
   * Create a new PortLeasePool.
   *
   * @param {Object} config
   * @param {number} config.minPort - First port in the range (inclusive).
   * @param {number} config.maxPort - Last port in the range (inclusive).
   * @param {string} config.lockRoot - Directory path for lock files.
   * @param {number} [config.staleTimeoutMs] - Stale lock timeout in ms (default 30000).
   * @throws {Error} If minPort > maxPort or ports are not valid.
   */
  constructor({ minPort, maxPort, lockRoot, staleTimeoutMs = DEFAULT_STALE_TIMEOUT_MS }) {
    if (!Number.isInteger(minPort) || !Number.isInteger(maxPort)) {
      throw new Error('PortLeasePool: minPort and maxPort must be integers');
    }
    if (minPort > maxPort) {
      throw new Error(`PortLeasePool: minPort (${minPort}) must be <= maxPort (${maxPort})`);
    }
    if (minPort < 1 || maxPort > 65535) {
      throw new Error('PortLeasePool: ports must be in range [1, 65535]');
    }
    if (staleTimeoutMs <= 0) {
      throw new Error('PortLeasePool: staleTimeoutMs must be positive');
    }
    if (!lockRoot || typeof lockRoot !== 'string') {
      throw new Error('PortLeasePool: lockRoot must be a non-empty string');
    }

    this.#minPort = minPort;
    this.#maxPort = maxPort;
    this.#lockRoot = lockRoot;
    this.#staleTimeoutMs = staleTimeoutMs;
    this.#leaseCounter = 0;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Acquire a free port from the pool.
   *
   * Iterates through the port range and attempts an atomic mkdir lock
   * on each. The first port whose mkdir succeeds is claimed by writing
   * an owner.json file inside the lock directory.
   *
   * @returns {Promise<{ port: number, leaseId: string }>} The acquired port and leaseId.
   * @throws {PortPoolExhaustedError} If all ports are leased.
   */
  async acquire() {
    for (let port = this.#minPort; port <= this.#maxPort; port++) {
      const lockDir = this.#lockPath(port);
      const acquired = this.#tryLock(port, lockDir);
      if (acquired) {
        const leaseId = this.#generateLeaseId();
        const ownerData = {
          leaseId,
          pid: process.pid,
          timestamp: Date.now(),
        };
        await writeFile(join(lockDir, OWNER_FILENAME), JSON.stringify(ownerData), 'utf8');
        return { port, leaseId };
      }
    }

    throw new PortPoolExhaustedError(this.#minPort, this.#maxPort);
  }

  /**
   * Release a previously-acquired port.
   *
   * Verifies leaseId ownership before removing the lock directory.
   *
   * @param {number} port - The port to release.
   * @param {string} leaseId - The leaseId returned by acquire().
   * @throws {LeaseOwnershipError} If the leaseId does not match the owner.
   * @throws {Error} If the port has no active lock directory.
   */
  async release(port, leaseId) {
    this.#validatePortInRange(port);
    const lockDir = this.#lockPath(port);

    if (!existsSync(lockDir)) {
      throw new Error(`PortLeasePool: port ${port} has no active lock`);
    }

    const owner = await this.#readOwner(lockDir);
    if (!owner || owner.leaseId !== leaseId) {
      throw new LeaseOwnershipError(port, leaseId);
    }

    await rm(lockDir, { recursive: true, force: true });
  }

  /**
   * Verify that a given leaseId is the current owner of a port.
   *
   * @param {number} port - The port to check.
   * @param {string} leaseId - The leaseId to verify.
   * @returns {Promise<boolean>} True if the leaseId matches the owner.
   */
  async isOwner(port, leaseId) {
    const lockDir = this.#lockPath(port);
    if (!existsSync(lockDir)) return false;

    try {
      const owner = await this.#readOwner(lockDir);
      return owner !== null && owner.leaseId === leaseId;
    } catch {
      return false;
    }
  }

  /**
   * List all currently leased ports with their owner metadata.
   *
   * @returns {Promise<Array<{ port: number, leaseId: string, pid: number, timestamp: number }>>}
   */
  async list() {
    const entries = [];

    if (!existsSync(this.#lockRoot)) return entries;

    let dirents;
    try {
      dirents = await readdir(this.#lockRoot, { withFileTypes: true });
    } catch {
      return entries;
    }

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const port = Number.parseInt(dirent.name, 10);
      if (!Number.isInteger(port)) continue;

      const lockDir = join(this.#lockRoot, dirent.name);
      try {
        const owner = await this.#readOwner(lockDir);
        if (owner) {
          entries.push({ port, ...owner });
        }
      } catch {
        // Skip unreadable locks.
      }
    }

    return entries.sort((a, b) => a.port - b.port);
  }

  /**
   * Reclaim stale locks whose owning process has died or whose lock
   * age exceeds the configured timeout.
   *
   * @returns {Promise<number>} Number of stale locks reclaimed.
   */
  async cleanup() {
    if (!existsSync(this.#lockRoot)) return 0;

    let dirents;
    try {
      dirents = await readdir(this.#lockRoot, { withFileTypes: true });
    } catch {
      return 0;
    }

    let reclaimed = 0;
    const now = Date.now();

    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue;
      const lockDir = join(this.#lockRoot, dirent.name);

      try {
        const owner = await this.#readOwner(lockDir);
        if (!owner) {
          // No owner.json — treat as stale.
          await rm(lockDir, { recursive: true, force: true });
          reclaimed++;
          continue;
        }

        if (this.#isStale(owner, now)) {
          await rm(lockDir, { recursive: true, force: true });
          reclaimed++;
        }
      } catch {
        // On error, attempt to remove the lock directory.
        try {
          await rm(lockDir, { recursive: true, force: true });
          reclaimed++;
        } catch {
          // Best-effort cleanup.
        }
      }
    }

    return reclaimed;
  }

  // -----------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------

  /** @returns {number} The first port in the range. */
  get minPort() {
    return this.#minPort;
  }

  /** @returns {number} The last port in the range. */
  get maxPort() {
    return this.#maxPort;
  }

  /** @returns {string} The lock root directory path. */
  get lockRoot() {
    return this.#lockRoot;
  }

  /** @returns {number} The stale lock timeout in milliseconds. */
  get staleTimeoutMs() {
    return this.#staleTimeoutMs;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Attempt to atomically acquire the lock for a port.
   *
   * Uses fs.mkdir with { recursive: false } as the atomic primitive.
   * Returns true if the directory was created (lock acquired),
   * false if it already existed (port already locked).
   *
   * @param {number} port - The port being locked.
   * @param {string} lockDir - Full path to the lock directory.
   * @returns {boolean} True if lock was acquired.
   */
  #tryLock(_port, lockDir) {
    try {
      // Note: Using sync mkdir here is intentional — the atomicity of
      // mkdir across processes depends on the OS syscall, not the JS
      // execution mode. A sync call avoids any async interleaving within
      // this process.
      const { mkdirSync } = require('node:fs');
      mkdirSync(lockDir, { recursive: false });
      return true;
    } catch (err) {
      // EEXIST means the directory already exists → port is locked.
      if (err && err.code === 'EEXIST') return false;
      // ENOENT means the lockRoot doesn't exist yet.
      if (err && err.code === 'ENOENT') return false;
      // Any other error means we couldn't lock this port.
      return false;
    }
  }

  /**
   * Generate a unique leaseId.
   *
   * Combines timestamp, process ID, and an incrementing counter to
   * produce a collision-resistant identifier.
   *
   * @returns {string} A unique leaseId.
   */
  #generateLeaseId() {
    this.#leaseCounter += 1;
    const ts = Date.now().toString(36);
    const pid = process.pid.toString(36);
    const ctr = this.#leaseCounter.toString(36);
    return `lease_${ts}_${pid}_${ctr}`;
  }

  /**
   * Build the lock directory path for a port.
   *
   * @param {number} port - The port number.
   * @returns {string} Full path to the lock directory.
   */
  #lockPath(port) {
    return join(this.#lockRoot, String(port));
  }

  /**
   * Read and parse the owner.json from a lock directory.
   *
   * @param {string} lockDir - Path to the lock directory.
   * @returns {Promise<{ leaseId: string, pid: number, timestamp: number } | null>}
   */
  async #readOwner(lockDir) {
    try {
      const raw = await readFile(join(lockDir, OWNER_FILENAME), 'utf8');
      const data = JSON.parse(raw);
      if (typeof data.leaseId === 'string' && typeof data.pid === 'number') {
        return data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Determine whether a lock is stale.
   *
   * A lock is stale if:
   *   1. The owning process is no longer alive, OR
   *   2. The lock age exceeds the configured timeout.
   *
   * @param {{ pid: number, timestamp: number }} owner - Owner metadata.
   * @param {number} now - Current timestamp (ms since epoch).
   * @returns {boolean}
   */
  #isStale(owner, now) {
    // Check timeout first (cheaper than process kill).
    if (now - owner.timestamp > this.#staleTimeoutMs) return true;

    // Check if the owning process is still alive.
    if (!this.#isPidAlive(owner.pid)) return true;

    return false;
  }

  /**
   * Check whether a PID is currently alive.
   *
   * Uses process.kill(pid, 0) which throws ESRCH if the process does
   * not exist, without actually sending a signal.
   *
   * @param {number} pid - Process ID to check.
   * @returns {boolean}
   */
  #isPidAlive(pid) {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err && err.code === 'ESRCH') return false;
      // EPERM means the process exists but we can't signal it → alive.
      return true;
    }
  }

  /**
   * Validate that a port is within the configured range.
   *
   * @param {number} port - Port to validate.
   * @throws {Error} If the port is outside [minPort, maxPort].
   */
  #validatePortInRange(port) {
    if (!Number.isInteger(port) || port < this.#minPort || port > this.#maxPort) {
      throw new Error(
        `PortLeasePool: port ${port} is outside range [${this.#minPort}, ${this.#maxPort}]`,
      );
    }
  }
}

export default PortLeasePool;
