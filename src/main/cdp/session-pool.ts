// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Session Pool
 *
 * Reuses a target's WebSocket session across the fan-out sub-tasks within a
 * single apply/restore operation. WorkBuddy exposes 13+ CDP targets; the
 * secondary-inject pass and the hardening pass both connect to the same
 * webview/iframe targets, so without a pool each target is handshaked twice
 * per apply (~200ms each). The pool collapses duplicate connects into one.
 *
 * ## Lifecycle & safety
 *
 * - **Per-agent, per-target** keyed by `targetId` (falling back to the WS URL).
 * - **Epoch-bound**: the owner (`AgentEngineService`) calls {@link invalidateEpoch}
 *   on every epoch bump. Pooled sessions are **soft-retired** at each apply/restore
 *   boundary (marked retired, not immediately closed) so that in-flight operations
 *   can complete. After a grace period, retired sessions with no references are closed.
 * - **Reference counting**: `acquire` increments refCount; `release` decrements it.
 *   Sessions with refCount > 0 are never closed during epoch invalidation.
 * - **Caller contract**: a pooled session is owned by the pool — callers must
 *   NOT call `session.close()`; the pool closes it on epoch invalidation /
 *   dispose. The {@link acquireSession} helper returns a `pooled` flag so the
 *   fan-out `finally` blocks can skip closing pooled sessions. Callers **MUST**
 *   call `pool.release()` in their `finally` blocks when `pooled=true`.
 * - **Idle TTL**: sessions idle for >30s are automatically closed to free resources.
 * - **Concurrency**: the CDP client's `send`/`evaluate` are concurrency-safe
 *   (unique command ids + a pending map), so pooled sessions may be shared by
 *   overlapping sub-tasks without protocol corruption.
 * - **Acquire serialization**: a per-key promise chain (`acquireLocks`) guarantees
 *   that concurrent `acquire()` calls for the same `targetKey` execute `open()`
 *   strictly sequentially, preventing duplicate session creation at the
 *   `await open()` yield point.
 *
 * Remote-disconnect auto-removal is handled two ways: the CDP client rejects
 * all pending commands on socket close, and the pool's per-session heartbeat
 * (RFC §4.7) pings every 5s, discarding the session after 2 consecutive
 * failures so a silently-dead socket is rebuilt on the next acquire.
 */

import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';

/** Heartbeat cadence (RFC §4.7) — a lightweight ping every 5s. */
const HEARTBEAT_INTERVAL_MS = 5000;
/** Consecutive heartbeat failures before a session is marked dirty + discarded. */
const HEARTBEAT_FAIL_THRESHOLD = 2;
/** Idle timeout (ms) — sessions idle longer than this are closed. */
const IDLE_TTL_MS = 30_000;
/** Scan interval (ms) for idle session reclamation. */
const IDLE_SCAN_INTERVAL_MS = 10_000;
/** Grace period (ms) for retired sessions before force close. */
const RETIRE_GRACE_MS = 5000;
/**
 * Upper bound on pooled sessions per agent. Targets are naturally bounded
 * (WorkBuddy exposes ~13 webview/iframe targets), so the normal steady-state
 * is far below this. The cap is a pure safety net: if an abnormal target
 * explosion would otherwise grow the pool without limit, we refuse to pool
 * the extra target and let the caller fall back to a one-shot connect
 * (existing behavior for non-pooled paths), instead of retaining sockets
 * indefinitely.
 */
const MAX_SESSIONS_PER_AGENT = 64;

interface PooledEntry {
  session: CdpSession;
  lastUsedAt: number;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  consecutiveFailures: number;
  /** Reference count — number of active users of this session. */
  refCount: number;
  /** Whether this session has been retired (epoch bump). */
  retired: boolean;
  /** Timestamp when retired (0 = not retired). */
  retiredAt: number;
}

/** A session plus whether the caller owns its lifecycle (`pooled` = do not close). */
export interface SessionHandle {
  session: CdpSession | null;
  pooled: boolean;
}

/**
 * Acquire a session (possibly pooled) for `targetKey`. When `pool` is provided
 * the session is cached and must not be closed by the caller; otherwise a
 * one-shot session is returned and the caller closes it as before.
 * @param epoch Current epoch number (for retire/reuse logic).
 */
export async function acquireSession(
  pool: CdpSessionPool | undefined,
  appId: AgentId,
  targetKey: string,
  open: () => Promise<CdpSession | null>,
  epoch?: number,
): Promise<SessionHandle> {
  if (pool) {
    const session = await pool.acquire(appId, targetKey, open, epoch);
    return { session, pooled: true };
  }
  const session = await open();
  return { session, pooled: false };
}

/**
 * Release a pooled session (decrement refCount). MUST be called by the caller
 * in their `finally` block when `pooled=true`.
 */
export function releaseSession(
  pool: CdpSessionPool | undefined,
  appId: AgentId,
  targetKey: string,
): void {
  pool?.release(appId, targetKey);
}

/** Per-target key for a CDP target (id preferred, WS URL as fallback). */
export function targetKeyFor(
  id: string | null | undefined,
  webSocketDebuggerUrl: string | null | undefined,
): string {
  return id || webSocketDebuggerUrl || 'unknown-target';
}

/**
 * Per-agent, per-target CDP session pool. See module doc for lifecycle rules.
 */
export class CdpSessionPool {
  private readonly pools = new Map<AgentId, Map<string, PooledEntry>>();
  private idleScanTimer: ReturnType<typeof setInterval> | null = null;
  /** Per-key promise chain — serializes concurrent acquire() for the same target. */
  private readonly acquireLocks = new Map<string, Promise<CdpSession | null>>();

  constructor() {
    // Start idle scanner for reclaiming unused sessions
    this.startIdleScanner();
  }

  private startIdleScanner(): void {
    if (this.idleScanTimer) return;
    this.idleScanTimer = setInterval(() => {
      this.scanIdleEntries();
    }, IDLE_SCAN_INTERVAL_MS);
  }

  /** Scan and close idle/expired-retired sessions. */
  private scanIdleEntries(): void {
    const now = Date.now();
    for (const [appId, byTarget] of this.pools) {
      for (const [targetKey, entry] of [...byTarget]) {
        // Skip in-use sessions (refCount > 0 means active users)
        if (entry.refCount > 0) {
          // Log warning for long-retired sessions still in use (possible leak)
          if (entry.retired && now - entry.retiredAt > RETIRE_GRACE_MS) {
            mainWarn(
              'SessionPool',
              `retired session still in use (refCount=${entry.refCount}): ${appId}/${targetKey}`,
            );
          }
          continue;
        }
        // Retired + idle → close
        if (entry.retired) {
          this.discard(appId, targetKey, entry);
          continue;
        }
        // Idle timeout → close
        if (now - entry.lastUsedAt > IDLE_TTL_MS) {
          this.discard(appId, targetKey, entry);
        }
      }
      // Clean up empty per-agent maps
      if (byTarget.size === 0) {
        this.pools.delete(appId);
      }
    }
  }

  /** Acquire a pooled session for `targetKey`, creating it via `open` on first use. */
  async acquire(
    appId: AgentId,
    targetKey: string,
    open: () => Promise<CdpSession | null>,
    epoch?: number,
  ): Promise<CdpSession | null> {
    const lockKey = `${appId}:${targetKey}`;

    // Wait for any prior acquire on the same key to settle
    const prevLock = this.acquireLocks.get(lockKey);
    if (prevLock) {
      try {
        await prevLock;
      } catch {
        /* ignore the previous caller's error */
      }
    }

    // Register our own lock so later callers wait for us
    const acquirePromise = this.doAcquire(appId, targetKey, open, epoch);
    this.acquireLocks.set(lockKey, acquirePromise);

    try {
      return await acquirePromise;
    } finally {
      // Only clear the lock if no newer caller replaced it
      if (this.acquireLocks.get(lockKey) === acquirePromise) {
        this.acquireLocks.delete(lockKey);
      }
    }
  }

  /** Internal acquire logic, guaranteed to run one-at-a-time per target key. */
  private async doAcquire(
    appId: AgentId,
    targetKey: string,
    open: () => Promise<CdpSession | null>,
    _epoch?: number,
  ): Promise<CdpSession | null> {
    let byTarget = this.pools.get(appId);
    if (!byTarget) {
      byTarget = new Map();
      this.pools.set(appId, byTarget);
    }
    const existing = byTarget.get(targetKey);
    if (existing) {
      // Retired + grace period expired → discard and recreate
      if (existing.retired && this.shouldHardClose(existing)) {
        this.discard(appId, targetKey, existing);
        // fallthrough to create new
      } else {
        // Reuse: increment refCount and clear retired flag
        existing.lastUsedAt = Date.now();
        existing.refCount++;
        existing.retired = false;
        existing.retiredAt = 0;
        return existing.session;
      }
    }
    const session = await open();
    if (!session) return null;
    // Capacity guard: refuse to pool a brand-new target type once the
    // per-agent cap is reached, falling back to a one-shot connect (caller
    // path) instead of growing the pool without bound. The normal
    // steady-state (targets are naturally < 20) is unaffected.
    if (!existing && byTarget.size >= MAX_SESSIONS_PER_AGENT) {
      logger.warn(
        `[session-pool] per-agent session cap (${MAX_SESSIONS_PER_AGENT}) reached for ${appId}; ` +
          `not pooling target ${targetKey}, falling back to one-shot connect`,
      );
      return null;
    }
    const entry: PooledEntry = {
      session,
      lastUsedAt: Date.now(),
      heartbeatTimer: null,
      consecutiveFailures: 0,
      refCount: 1,
      retired: false,
      retiredAt: 0,
    };
    entry.heartbeatTimer = this.startHeartbeat(appId, targetKey, entry);
    byTarget.set(targetKey, entry);
    return session;
  }

  /** Release a pooled session (decrement refCount). */
  release(appId: AgentId, targetKey: string): void {
    const entry = this.pools.get(appId)?.get(targetKey);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    entry.lastUsedAt = Date.now();
    // Retired + refCount=0 → safe to close
    if (entry.retired && entry.refCount === 0) {
      this.discard(appId, targetKey, entry);
    }
  }

  /** Whether a retired session's grace period has expired (should hard-close). */
  private shouldHardClose(entry: PooledEntry): boolean {
    return entry.retired && Date.now() - entry.retiredAt > RETIRE_GRACE_MS;
  }

  /** Drop and close a specific pooled session (e.g. after a hard failure). */
  invalidateTarget(appId: AgentId, targetKey: string): void {
    const byTarget = this.pools.get(appId);
    const entry = byTarget?.get(targetKey);
    if (!entry) return;
    this.discard(appId, targetKey, entry);
  }

  /**
   * Soft-retire every pooled session for an agent. Sessions with active references
   * (refCount > 0) are marked retired but NOT closed immediately — in-flight
   * operations can complete. Idle sessions (refCount = 0) are closed immediately.
   * After RETIRE_GRACE_MS, retired sessions are force-closed even if still referenced.
   */
  invalidateEpoch(appId: AgentId): void {
    const byTarget = this.pools.get(appId);
    if (!byTarget) return;
    const now = Date.now();
    for (const [targetKey, entry] of byTarget) {
      if (entry.refCount > 0) {
        // In-use: mark retired, don't close yet
        entry.retired = true;
        entry.retiredAt = now;
      } else {
        // Idle: close immediately
        this.discard(appId, targetKey, entry);
      }
    }
    // Don't clear byTarget Map — new epoch acquire can reuse non-retired sessions
  }

  /** Close and clear every pooled session (service dispose). Hard-close all. */
  dispose(): void {
    for (const [_appId, byTarget] of this.pools) {
      for (const [_targetKey, entry] of byTarget) {
        this.stopHeartbeat(entry);
        try {
          entry.session.close();
        } catch {
          /* already closed */
        }
      }
      byTarget.clear();
    }
    this.pools.clear();
    if (this.idleScanTimer !== null) {
      clearInterval(this.idleScanTimer);
      this.idleScanTimer = null;
    }
  }

  /** Number of pooled sessions for an agent (diagnostics). */
  poolSize(appId: AgentId): number {
    return this.pools.get(appId)?.size ?? 0;
  }

  // -------------------------------------------------------------------------
  // Heartbeat (RFC §4.7)
  // -------------------------------------------------------------------------

  /** Start a 5s heartbeat that pings the session and discards it on repeated failure. */
  private startHeartbeat(
    appId: AgentId,
    targetKey: string,
    entry: PooledEntry,
  ): ReturnType<typeof setInterval> | null {
    return setInterval(() => {
      void this.ping(appId, targetKey, entry);
    }, HEARTBEAT_INTERVAL_MS);
  }

  private async ping(appId: AgentId, targetKey: string, entry: PooledEntry): Promise<void> {
    try {
      await entry.session.send('Runtime.evaluate', {
        expression: '1',
        returnByValue: true,
        awaitPromise: false,
      });
      entry.consecutiveFailures = 0;
    } catch {
      entry.consecutiveFailures++;
      if (entry.consecutiveFailures >= HEARTBEAT_FAIL_THRESHOLD) {
        mainWarn(
          'SessionPool',
          `agent=${appId} target=${targetKey} heartbeat failed ${entry.consecutiveFailures}x — discarding session`,
        );
        this.discard(appId, targetKey, entry);
      }
    }
  }

  /** Stop + close + remove a pooled session (used by invalidateTarget and heartbeat discard). */
  private discard(appId: AgentId, targetKey: string, entry: PooledEntry): void {
    const byTarget = this.pools.get(appId);
    if (byTarget?.get(targetKey) === entry) {
      byTarget.delete(targetKey);
    }
    this.stopHeartbeat(entry);
    try {
      entry.session.close();
    } catch {
      /* already closed */
    }
  }

  private stopHeartbeat(entry: PooledEntry): void {
    if (entry.heartbeatTimer !== null) {
      clearInterval(entry.heartbeatTimer);
      entry.heartbeatTimer = null;
    }
  }
}
