// SPDX-License-Identifier: MPL-2.0

/**
 * # port-manager
 *
 * CDP port configuration, availability detection, and lease management.
 * Consolidates the previous port-config, port-resolver, and port-lease-pool modules.
 *
 * Three functional areas:
 *   1. **Port config** — Per-adapter preferred CDP port definitions and fallback range.
 *   2. **Port resolver** — TCP bind/connect probe with DevToolsActivePort file fallback.
 *   3. **Lease pool** — Filesystem-locked port allocation to prevent double-allocation.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';

// =============================================================================
// Section 1: Port Configuration
// =============================================================================

/** Lower bound of the fallback range (inclusive). */
export const AGENT_PORT_FALLBACK_MIN = 9222;

/** Upper bound of the fallback range (inclusive). */
export const AGENT_PORT_FALLBACK_MAX = 9357;

/** Per-adapter preferred port + fallback range. */
export interface AdapterPortConfig {
  /** Adapter identifier (matches ApplicationAdapter.id). */
  readonly adapterId: string;
  /** Preferred CDP debug port — tried first on every launch. */
  readonly preferredPort: number;
  /** [min, max] inclusive range for auto-fallback walk. */
  readonly fallbackRange: readonly [number, number];
}

/**
 * Default port configuration for each built-in adapter.
 *
 * 2026-09-07 port policy change (user decision): every adapter's preferred
 * port is `0` — Chromium picks a random free port at launch and publishes it
 * through the DevToolsActivePort file (discovered via `resolveDebugPorts` /
 * `resolveLivePort`). Fixed per-adapter ports (9222-9227) are GONE: they were
 * neither guaranteed free nor unique across restarts, and a stale live-port
 * cache pointing a foreign adapter at an occupied "home" port caused real
 * cross-adapter mis-injection (see adapter-match-target.test.ts). Uniqueness
 * is guaranteed by the OS (Chromium never binds an occupied random port) plus
 * the identity-verified discovery chain — NOT by static reservation.
 *
 * The `fallbackRange` remains as the shared validation band [9222, 9357] for
 * `isWithinFallbackRange` / `validatePortOverride` and for explicit
 * user-chosen port overrides; it is no longer used as a launch walk range
 * because launches start from 0 (random).
 */
export const DEFAULT_PORT_CONFIGS: readonly AdapterPortConfig[] = Object.freeze([
  {
    adapterId: 'traework',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
  {
    adapterId: 'qoderwork',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
  {
    adapterId: 'workbuddy',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
  {
    adapterId: 'doubao',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
  {
    adapterId: 'codex',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
  {
    adapterId: 'zcode',
    preferredPort: 0,
    fallbackRange: [AGENT_PORT_FALLBACK_MIN, AGENT_PORT_FALLBACK_MAX],
  },
]);

/** Lookup map for O(1) access by adapterId. */
const CONFIG_BY_ID = new Map<string, AdapterPortConfig>(
  DEFAULT_PORT_CONFIGS.map((cfg) => [cfg.adapterId, cfg]),
);

/**
 * Return the port configuration for a given adapter id.
 *
 * @returns The matching `AdapterPortConfig`, or `undefined` when the
 *   adapter has no configured preferred port (e.g. custom/experimental
 *   adapters not in the built-in list).
 */
export function getAdapterPortConfig(adapterId: string): AdapterPortConfig | undefined {
  return CONFIG_BY_ID.get(adapterId);
}

/**
 * Resolve the effective starting port for an adapter launch.
 *
 * Priority:
 *   1. Explicit `preferredPort` from the caller (non-zero, valid integer)
 *      — highest priority.
 *   2. `preferredPort === 0` — let Chromium pick a random port (returns 0).
 *   3. When `useAdapterPreferredPort` is true AND the adapter has a config
 *      entry — use the adapter's preferred port. Since the 2026-09-07 random-
 *      port policy, every built-in adapter's preferred port is `0`, so this
 *      branch also resolves to random for built-ins; only user-configured
 *      non-zero ports would walk the fallback band.
 *   4. `preferredPort == null` (no opt-in) — random port (0).
 */
export function resolveStartPort(
  adapterId: string | undefined | null,
  preferredPort: number | null | undefined,
  useAdapterPreferredPort = false,
): number {
  // Explicit request for random port — defer to Chromium.
  if (preferredPort === 0) return 0;

  // Explicit caller override — respect it only when valid integer in range.
  if (
    preferredPort != null &&
    Number.isInteger(preferredPort) &&
    preferredPort > 0 &&
    preferredPort <= 65535
  ) {
    return preferredPort;
  }

  // Adapter-configured preferred port (only when explicitly requested AND
  // no explicit port was given).
  if (useAdapterPreferredPort && adapterId) {
    const cfg = getAdapterPortConfig(adapterId);
    if (cfg) return cfg.preferredPort;
  }

  // Backward compatibility: null/undefined preferredPort with no opt-in
  // means "random port" (0) — preserves the existing dynamic discovery path.
  if (preferredPort == null) return 0;

  // An explicit but invalid port (non-integer, out of range): under the
  // random-port policy there is no fixed home port to fall back to, so treat
  // it like "no usable override" → random port (0). The electron-launcher
  // resolvePort layer rejects invalid explicit ports before calling here;
  // this branch stays defensive for direct callers.
  return 0;
}

/**
 * Return the effective upper bound for the fallback walk.
 *
 * Uses the adapter's configured `fallbackRange[1]` when available,
 * otherwise `AGENT_PORT_FALLBACK_MAX`.
 */
export function resolveEndPort(adapterId: string | undefined | null): number {
  if (adapterId) {
    const cfg = getAdapterPortConfig(adapterId);
    if (cfg) return cfg.fallbackRange[1];
  }
  return AGENT_PORT_FALLBACK_MAX;
}

/** True when `port` falls within the valid fallback range (inclusive). */
export function isWithinFallbackRange(port: number): boolean {
  return port >= AGENT_PORT_FALLBACK_MIN && port <= AGENT_PORT_FALLBACK_MAX;
}

/**
 * Validate that a user-supplied port override is acceptable.
 *
 * Returns `null` when the port is valid, or an error message (already
 * localized-keyed) when it is not. Used by settings UI / IPC validation.
 */
export function validatePortOverride(port: number): 'invalidPort' | 'invalidCdpPort' | null {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return 'invalidPort';
  // Ports below 1024 require root/admin — CDP should never use them.
  if (port < AGENT_PORT_FALLBACK_MIN) return 'invalidCdpPort';
  return null;
}

/** Re-export AgentId for convenience (port-config consumers often need it). */
export type { AgentId };

// =============================================================================
// Section 2: Port Resolver
// =============================================================================

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_MAX_ATTEMPTS = 100;
const DEFAULT_TIMEOUT_MS = 2000;
const CONNECT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_DEBUG_PORT = 9222;

/**
 * TTL (ms) for the {@link ResolvedPortCache}. A resolved port is considered
 * fresh for this duration — sufficient to skip re-probing within a single
 * apply / force-restart cycle.
 */
const RESOLVED_PORT_TTL_MS = 30_000;

/** Maximum number of entries in the {@link ResolvedPortCache}. */
const RESOLVED_PORT_MAX_ENTRIES = 16;

export interface PortStatus {
  port: number;
  available: boolean;
  reason?: 'in-use' | 'ghost-listen' | 'out-of-range' | 'permission-denied';
}

export interface PortResolverOptions {
  startPort?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

/** Upper bound for concurrently rented ports within a single resolver instance. */
const MAX_RENTED_PORTS = 256;

export class PortResolver {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  private readonly rented = new Set<number>();

  constructor(options: PortResolverOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Find an available port within a bounded range [startPort, endPort].
   */
  async findAvailablePortBounded(
    startPort: number,
    endPort: number,
    appPath?: string,
  ): Promise<number> {
    const start = Math.max(MIN_PORT, Math.min(MAX_PORT, startPort));
    const end = Math.min(MAX_PORT, Math.max(start, endPort));
    const budget = Math.min(this.maxAttempts, end - start + 1);
    for (let i = 0; i < budget; i++) {
      const port = start + i;
      if (port > end) break;
      if ((await this.checkPort(port)).available) return port;
    }
    // Fallback: try DevToolsActivePort file when TCP walk exhausts.
    if (appPath) {
      const filePort = await resolveDevToolsActivePort(appPath);
      if (filePort != null && filePort >= start && filePort <= end) {
        if ((await this.checkPort(filePort)).available) return filePort;
      }
    }
    throw new Error(
      `No available port found in [${startPort}–${endPort}] after ${budget} attempts`,
    );
  }

  async checkPort(port: number): Promise<PortStatus> {
    if (port < MIN_PORT || port > MAX_PORT) {
      return { port, available: false, reason: 'out-of-range' };
    }
    if (this.rented.has(port)) {
      return { port, available: false, reason: 'in-use' };
    }
    if (!(await this.tryBind(port))) {
      return { port, available: false, reason: 'in-use' };
    }
    if (await this.tryConnect(port)) {
      return { port, available: false, reason: 'ghost-listen' };
    }
    return { port, available: true };
  }

  async findAvailablePort(preferredPort: number, appPath?: string): Promise<number> {
    const start = Math.max(MIN_PORT, Math.min(MAX_PORT, preferredPort));
    for (let i = 0; i < this.maxAttempts; i++) {
      const port = start + i;
      if (port > MAX_PORT) break;
      if ((await this.checkPort(port)).available) return port;
    }
    // Fallback: try DevToolsActivePort file when TCP walk exhausts.
    if (appPath) {
      const filePort = await resolveDevToolsActivePort(appPath);
      if (filePort != null && (await this.checkPort(filePort)).available) return filePort;
    }
    throw new Error(
      `No available port found starting from ${preferredPort} after ${this.maxAttempts} attempts`,
    );
  }

  async rentPort(port: number): Promise<boolean> {
    if (this.rented.has(port)) return false;
    if (!(await this.checkPort(port)).available) return false;
    if (this.rented.size >= MAX_RENTED_PORTS) {
      console.warn(
        `[port-resolver] rented-port cap (${MAX_RENTED_PORTS}) reached; refusing port ${port}`,
      );
      return false;
    }
    this.rented.add(port);
    return true;
  }

  releasePort(port: number): void {
    this.rented.delete(port);
  }

  get rentedPorts(): ReadonlySet<number> {
    return new Set(this.rented);
  }

  private tryBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close(() => resolve(false));
        }
      }, this.timeoutMs);
      server.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        resolve(false);
      });
      server.listen(port, '127.0.0.1', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close(() => resolve(true));
      });
    });
  }

  private tryConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(false);
        }
      }, CONNECT_PROBE_TIMEOUT_MS);
      socket.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      });
    });
  }
}

/**
 * Build the platform-specific path to Chromium's DevToolsActivePort file
 * for a given app.
 */
export function buildDevToolsActivePortPath(appPath: string): string {
  const home = os.homedir();
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appPath, 'DevToolsActivePort');
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, appPath, 'DevToolsActivePort');
  }
  return path.join(home, '.config', appPath, 'DevToolsActivePort');
}

/**
 * Read Chromium's DevToolsActivePort file and return the port number.
 */
export async function resolveDevToolsActivePort(appPath: string): Promise<number | null> {
  try {
    const filePath = buildDevToolsActivePortPath(appPath);
    const raw = await fs.readFile(filePath, 'utf8');
    const port = Number(raw.split(/\r?\n/, 1)[0].trim());
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the debug port for an app using a three-tier strategy:
 *   1. `preferredPort` — caller-chosen port (highest priority).
 *   2. DevToolsActivePort file — auto-discovered from the app's user-data dir.
 *   3. `defaultPort` (9222) — last-resort fallback.
 */
export async function resolveDebugPort(options: {
  appPath?: string;
  preferredPort?: number;
  defaultPort?: number;
}): Promise<number> {
  const { appPath, preferredPort, defaultPort = DEFAULT_DEBUG_PORT } = options;
  if (preferredPort != null && Number.isInteger(preferredPort)) {
    return preferredPort;
  }
  if (appPath) {
    const filePort = await resolveDevToolsActivePort(appPath);
    if (filePort != null) return filePort;
  }
  return defaultPort;
}

// ---------------------------------------------------------------------------
// ResolvedPortCache — per-adapter TTL cache for resolved/assigned ports
// ---------------------------------------------------------------------------

/**
 * Caches the port assigned to each adapter id with a TTL.
 */
export class ResolvedPortCache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, { port: number; capturedAt: number }>();

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.ttlMs = options.ttlMs ?? RESOLVED_PORT_TTL_MS;
    this.maxEntries = options.maxEntries ?? RESOLVED_PORT_MAX_ENTRIES;
  }

  /**
   * Return the cached port for `adapterId` if it is present and not expired.
   */
  peek(adapterId: string): number | null {
    const entry = this.entries.get(adapterId);
    if (!entry) return null;
    if (Date.now() - entry.capturedAt >= this.ttlMs) {
      this.entries.delete(adapterId);
      return null;
    }
    return entry.port;
  }

  /**
   * Return the cached port for `adapterId` after validating that it is
   * still free (passes `PortResolver.checkPort`).
   */
  async peekAndValidate(adapterId: string, resolver: PortResolver): Promise<number | null> {
    const port = this.peek(adapterId);
    if (port == null) return null;
    if ((await resolver.checkPort(port)).available) return port;
    this.entries.delete(adapterId);
    return null;
  }

  /** Cache a freshly resolved port for `adapterId`. */
  set(adapterId: string, port: number): void {
    this.entries.set(adapterId, { port, capturedAt: Date.now() });
    // Evict oldest if over capacity (Map iteration = insertion order).
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /** Drop the cached entry for `adapterId`. */
  clear(adapterId: string): void {
    this.entries.delete(adapterId);
  }

  /** Drop every cached entry (service dispose / epoch bump). */
  clearAll(): void {
    this.entries.clear();
  }

  /** Number of live (non-expired) entries. */
  size(): number {
    const now = Date.now();
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (now - entry.capturedAt >= this.ttlMs) {
        this.entries.delete(id);
      } else {
        count++;
      }
    }
    return count;
  }
}

// =============================================================================
// Section 3: Port Lease Pool
// =============================================================================

/** Default port range: 9223–9229 (7 slots). */
export const DEFAULT_MIN_PORT = 9223;
export const DEFAULT_MAX_PORT = 9229;
/** Default lease timeout: 30 seconds. */
export const DEFAULT_LEASE_TIMEOUT_MS = 30_000;

/** A granted port lease. */
export interface PortLease {
  /** The allocated port number. */
  port: number;
  /** Unique lease identifier (UUID) — proof of ownership. */
  leaseId: string;
  /** Epoch timestamp (ms) when the lease was acquired. */
  acquiredAt: number;
  /** Epoch timestamp (ms) when the lease expires. */
  expiresAt: number;
}

/** Configuration options for {@link PortLeasePool}. */
export interface PortLeasePoolOptions {
  /** Lower bound of the port range (inclusive). Default: 9223. */
  minPort?: number;
  /** Upper bound of the port range (inclusive). Default: 9229. */
  maxPort?: number;
  /** Default lease duration in milliseconds. Default: 30 000. */
  defaultTimeoutMs?: number;
  /**
   * Directory for lock files. Default: `<os.tmpdir()>/agentskin-port-leases`.
   * Override in tests to isolate from production state.
   */
  lockDir?: string;
}

/** On-disk lease metadata (written to lease.json inside the lock directory). */
interface LeaseMetadata {
  port: number;
  leaseId: string;
  acquiredAt: number;
  expiresAt: number;
}

/**
 * Fixed-size port lease pool with filesystem-backed atomic locking.
 *
 * All public methods are safe to call concurrently — the `mkdir` atomicity
 * guarantees that at most one caller can hold a given port at any time.
 */
export class PortLeasePool {
  readonly minPort: number;
  readonly maxPort: number;
  readonly defaultTimeoutMs: number;
  readonly lockDir: string;

  /** Active leases keyed by leaseId. */
  private readonly activeLeases = new Map<string, PortLease>();
  /** Expiry timers keyed by leaseId. */
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /**
   * Per-port promise chain (mutex). Serializes all acquire/release/steal
   * operations on the same port within this process.
   */
  private readonly portMutexes = new Map<number, Promise<void>>();
  /**
   * Cached promise for the one-time creation of {@link lockDir}.
   *
   * The per-port lock directories are created with `recursive: false` because
   * `mkdir` returning `EEXIST` *is* the locking primitive. That means the
   * parent directory must exist beforehand, otherwise every probe fails with
   * `ENOENT` and the pool reports "all ports exhausted".
   */
  private lockDirReady: Promise<void> | null = null;
  /** De-dup key set for mkdir failures — prevents one WARN per port per sweep. */
  private readonly warnedFailures = new Set<string>();

  constructor(options: PortLeasePoolOptions = {}) {
    this.minPort = options.minPort ?? DEFAULT_MIN_PORT;
    this.maxPort = options.maxPort ?? DEFAULT_MAX_PORT;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_LEASE_TIMEOUT_MS;
    this.lockDir = options.lockDir ?? path.join(os.tmpdir(), 'agentskin-port-leases');
  }

  /**
   * Acquire a port lease.
   *
   * Iterates the port range and attempts an atomic `mkdir` on each lock
   * directory. Returns the first successfully locked port. Throws if all
   * ports are occupied by non-expired leases.
   *
   * @param timeoutMs Optional lease duration override (ms).
   * @throws Error when the pool is exhausted.
   */
  async acquire(timeoutMs?: number): Promise<PortLease> {
    const ttl = timeoutMs ?? this.defaultTimeoutMs;
    const now = Date.now();

    // NOTE: the lock dir parent is created lazily inside `tryLockPort`, only
    // when a probe actually fails with ENOENT. Doing it here would add an
    // extra `mkdir` to every acquire even in the happy path.
    for (let port = this.minPort; port <= this.maxPort; port++) {
      const lease = await this.withPortLock(port, () => this.tryLockPort(port, ttl, now));
      if (lease) return lease;
    }

    throw new Error(`PortLeasePool: all ports exhausted (${this.minPort}–${this.maxPort})`);
  }

  /**
   * Release a lease.
   *
   * Validates ownership via `leaseId`. Unknown leaseIds are logged and
   * ignored (idempotent) — a double-release must not throw.
   */
  async release(leaseId: string): Promise<void> {
    const lease = this.activeLeases.get(leaseId);
    if (!lease) {
      mainWarn('PortLeasePool', `release: unknown leaseId ${leaseId} — possible double-release`);
      return;
    }

    this.clearTimer(leaseId);
    this.activeLeases.delete(leaseId);

    const lockDir = this.portLockDir(lease.port);
    await this.removeLockDir(lockDir);
  }

  /**
   * Renew a lease, extending its expiration.
   *
   * @param timeoutMs Optional new lease duration (ms). Defaults to the pool's
   *   `defaultTimeoutMs`.
   * @throws Error when the leaseId is unknown.
   */
  async renew(leaseId: string, timeoutMs?: number): Promise<void> {
    const lease = this.activeLeases.get(leaseId);
    if (!lease) {
      throw new Error(`PortLeasePool: cannot renew unknown leaseId ${leaseId}`);
    }

    const ttl = timeoutMs ?? this.defaultTimeoutMs;
    const newExpiresAt = Date.now() + ttl;
    lease.expiresAt = newExpiresAt;

    // Persist the updated expiry to disk so other processes see the new TTL.
    await this.writeLeaseMetadata(lease);

    // Reset the auto-release timer.
    this.clearTimer(leaseId);
    this.startExpiryTimer(leaseId, ttl);
  }

  /**
   * Get current pool status.
   *
   * @returns Total slots, available slots, and a snapshot of active leases.
   */
  getStatus(): { total: number; available: number; leases: PortLease[] } {
    const total = this.maxPort - this.minPort + 1;
    const leases = [...this.activeLeases.values()].map((l) => ({ ...l }));
    return { total, available: total - leases.length, leases };
  }

  /**
   * Release all expired leases.
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const expired: string[] = [];
    for (const [leaseId, lease] of this.activeLeases) {
      if (lease.expiresAt <= now) {
        expired.push(leaseId);
      }
    }
    for (const leaseId of expired) {
      await this.release(leaseId);
    }
  }

  /**
   * Release all active leases and clear timers. Call on service shutdown.
   */
  async dispose(): Promise<void> {
    for (const leaseId of [...this.expiryTimers.keys()]) {
      this.clearTimer(leaseId);
    }
    for (const leaseId of [...this.activeLeases.keys()]) {
      await this.release(leaseId);
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Execute `fn` under a per-port exclusive lock.
   */
  private async withPortLock<T>(port: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.portMutexes.get(port) ?? Promise.resolve();

    let release: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    const queued = prev.then(() => next);
    this.portMutexes.set(port, queued);

    await prev;
    try {
      return await fn();
    } finally {
      release!();
      if (this.portMutexes.get(port) === queued) {
        this.portMutexes.delete(port);
      }
    }
  }

  /** Attempt to lock a single port. Returns a PortLease on success, null otherwise. */
  private async tryLockPort(port: number, ttl: number, now: number): Promise<PortLease | null> {
    const lockDir = this.portLockDir(port);

    let claimed = await this.claimLockDir(lockDir, port);
    if (claimed === 'enoent') {
      // Parent directory missing (first run, or OS temp cleanup between
      // sweeps) — recreate it and retry this port once before giving up.
      await this.ensureLockDir(true);
      claimed = await this.claimLockDir(lockDir, port);
    }

    if (claimed === 'exists') {
      // Lock directory exists — check if the lease is expired and stealable.
      const stolen = await this.tryStealExpired(lockDir, now);
      if (!stolen) return null;
    } else if (claimed !== 'ok') {
      // 'error' (EACCES/EROFS) or still 'enoent' after the retry — we do NOT
      // hold the lock, so never fall through to the "we hold it" path below.
      return null;
    }

    // We hold the lock — write lease metadata.
    const leaseId = randomUUID();
    const acquiredAt = now;
    const expiresAt = now + ttl;
    const lease: PortLease = { port, leaseId, acquiredAt, expiresAt };

    try {
      await this.writeLeaseMetadata(lease);
    } catch (_writeErr) {
      // Failed to persist metadata — release the lock to avoid a ghost lock.
      await this.removeLockDir(lockDir);
      mainWarn('PortLeasePool', `failed to write lease metadata for port ${port} — lock released`);
      return null;
    }

    this.activeLeases.set(leaseId, lease);
    this.startExpiryTimer(leaseId, ttl);
    return lease;
  }

  /**
   * Check if the lock directory holds an expired lease. If so, attempt to
   * steal it by removing the directory and re-creating it atomically.
   */
  private async tryStealExpired(lockDir: string, now: number): Promise<boolean> {
    try {
      const raw = await fs.readFile(path.join(lockDir, 'lease.json'), 'utf8');
      const metadata = JSON.parse(raw) as LeaseMetadata;
      if (metadata.expiresAt > now) return false; // Still valid — not stealable.
    } catch {
      // No readable lease.json — treat as a stale/orphan lock, attempt steal.
    }

    // Remove the old lock directory and try to claim it.
    await this.removeLockDir(lockDir);

    try {
      await fs.mkdir(lockDir, { recursive: false });
      return true;
    } catch {
      // Another process claimed it first.
      return false;
    }
  }

  /** Write lease metadata to `<lockDir>/lease.json`. */
  private async writeLeaseMetadata(lease: PortLease): Promise<void> {
    const metadata: LeaseMetadata = {
      port: lease.port,
      leaseId: lease.leaseId,
      acquiredAt: lease.acquiredAt,
      expiresAt: lease.expiresAt,
    };
    const file = path.join(this.portLockDir(lease.port), 'lease.json');
    await fs.writeFile(file, JSON.stringify(metadata, null, 2));
  }

  /** Start (or restart) the auto-release timer for a lease. */
  private startExpiryTimer(leaseId: string, ttl: number): void {
    const timer = setTimeout(() => {
      mainWarn('PortLeasePool', `lease ${leaseId} expired after ${ttl}ms — auto-releasing`);
      void this.release(leaseId);
    }, ttl);
    this.expiryTimers.set(leaseId, timer);
  }

  /** Clear the auto-release timer for a lease. */
  private clearTimer(leaseId: string): void {
    const timer = this.expiryTimers.get(leaseId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.expiryTimers.delete(leaseId);
    }
  }

  /** Remove a lock directory and its contents (best-effort). */
  private async removeLockDir(lockDir: string): Promise<void> {
    try {
      // maxRetries: Windows transiently holds handles on freshly-written files
      // (indexer/AV), making rmdir fail with EPERM — force:true only silences
      // ENOENT, it does NOT retry. Node's built-in retry covers that window.
      await fs.rm(lockDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      /* best-effort — ignore */
    }
  }

  /** Build the lock directory path for a given port. */
  private portLockDir(port: number): string {
    return path.join(this.lockDir, `${port}.lock`);
  }

  /**
   * Ensure {@link lockDir} exists. The result is cached so a 26-port sweep
   * performs at most one `mkdir`. Pass `force` to re-run after an ENOENT.
   */
  private async ensureLockDir(force = false): Promise<void> {
    if (!force && this.lockDirReady) return this.lockDirReady;

    const task = (async () => {
      try {
        // `recursive: true` is safe and required here — this is the *parent*
        // of the lock dirs, not a lock dir itself.
        await fs.mkdir(this.lockDir, { recursive: true });
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        this.warnOnce(
          `lockdir:${code ?? 'UNKNOWN'}`,
          `cannot create lock dir ${this.lockDir}: ${code}`,
        );
      }
    })();

    this.lockDirReady = task;
    return task;
  }

  /**
   * Atomically claim a port's lock directory.
   *
   * `recursive: false` is deliberate: `EEXIST` is the mutual-exclusion signal.
   * Never switch this to `recursive: true` or two processes can both "win".
   */
  private async claimLockDir(
    lockDir: string,
    port: number,
  ): Promise<'ok' | 'exists' | 'enoent' | 'error'> {
    try {
      await fs.mkdir(lockDir, { recursive: false });
      return 'ok';
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'EEXIST') return 'exists';
      if (code === 'ENOENT') return 'enoent';

      // Genuinely unexpected (e.g. EACCES, EROFS) — skip this port.
      this.warnOnce(`${port}:${code ?? 'UNKNOWN'}`, `mkdir failed for port ${port}: ${code}`);
      return 'error';
    }
  }

  /** Log a given failure once per key — a full sweep must not emit 26 copies. */
  private warnOnce(key: string, message: string): void {
    if (this.warnedFailures.has(key)) return;
    this.warnedFailures.add(key);
    mainWarn('PortLeasePool', message);
  }
}
