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
 * ## Design — pure cache, external lifecycle
 *
 * The pool is intentionally **stateless beyond its cache**. It does NOT own
 * timers, background scanners, or heartbeat pings. Session liveness is trusted
 * to the CDP client's WebSocket `onclose` (which rejects all pending commands),
 * and idle/retired cleanup is managed by an external watchdog at the service layer.
 *
 * ## Pooled-entry lifecycle
 *
 * - **Per-agent, per-target** keyed by `targetId` (falling back to the WS URL).
 * - **Epoch-bound**: the owner (`AgentEngineService`) calls {@link invalidateEpoch}
 *   on every epoch bump. Pooled sessions are **soft-retired** at each apply/restore
 *   boundary (marked retired, not immediately closed) so that in-flight operations
 *   can complete. A retired session is lazily discarded on the next `acquire`.
 * - **Reference counting**: `acquire` increments refCount; `release` decrements it.
 *   Sessions with refCount > 0 are never retired during epoch invalidation.
 * - **Caller contract**: a pooled session is owned by the pool — callers must
 *   NOT call `session.close()`; the pool closes it on epoch invalidation /
 *   dispose. The {@link acquireSession} helper returns a `pooled` flag so the
 *   fan-out `finally` blocks can skip closing pooled sessions. Callers **MUST**
 *   call `pool.release()` in their `finally` blocks when `pooled=true`.
 * - **Concurrency**: the CDP client's `send`/`evaluate` are concurrency-safe
 *   (unique command ids + a pending map), so pooled sessions may be shared by
 *   overlapping sub-tasks without protocol corruption.
 * - **Acquire serialization**: a per-key promise chain (`acquireLocks`) guarantees
 *   that concurrent `acquire()` calls for the same `targetKey` execute `open()`
 *   strictly sequentially, preventing duplicate session creation at the
 *   `await open()` yield point.
 */

import type { AgentId } from '../../shared/types';
import { mainWarn } from '../logger';
import type { CdpSession } from './cdp-client';

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
  /** Reference count — number of active users of this session. */
  refCount: number;
  /** Whether this session has been retired (epoch bump). */
  retired: boolean;
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
): Promise<SessionHandle> {
  if (pool) {
    const session = await pool.acquire(appId, targetKey, open);
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

/**
 * Monotonic counter for targets that expose neither `id` nor
 * `webSocketDebuggerUrl`. Without uniqueness, every such target would collapse
 * onto the same `'unknown-target'` key and the pool would treat distinct
 * targets as one — silently dropping sessions.
 */
let unknownTargetCounter = 0;
/** Upper bound for the unknown-target counter — prevents unbounded growth if a broken target source emits ids that are always null. */
const MAX_UNKNOWN_TARGETS = 10_000;

/** Per-target key for a CDP target (id preferred, WS URL as fallback). */
export function targetKeyFor(
  id: string | null | undefined,
  webSocketDebuggerUrl: string | null | undefined,
): string {
  if (id) return id;
  if (webSocketDebuggerUrl) return webSocketDebuggerUrl;
  // RC-B fix: cap the counter to prevent unbounded growth; after MAX_UNKNOWN_TARGETS
  // we wrap around with a collision risk that is acceptable for this degenerate case.
  if (unknownTargetCounter >= MAX_UNKNOWN_TARGETS) {
    unknownTargetCounter = 0;
  }
  return `unknown-${++unknownTargetCounter}`;
}

/**
 * Per-agent, per-target CDP session pool. See module doc for lifecycle rules.
 *
 * Pure cache design: no internal timers. Retired sessions are lazily discarded
 * on acquire; idle reclamation and dead-socket cleanup are managed by the
 * external watchdog (service layer).
 */
export class CdpSessionPool {
  private readonly pools = new Map<AgentId, Map<string, PooledEntry>>();
  /** Per-key promise chain — serializes concurrent acquire() for the same target. */
  private readonly acquireLocks = new Map<string, Promise<CdpSession | null>>();

  /** Acquire a pooled session for `targetKey`, creating it via `open` on first use. */
  async acquire(
    appId: AgentId,
    targetKey: string,
    open: () => Promise<CdpSession | null>,
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
    const acquirePromise = this.doAcquire(appId, targetKey, open);
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
  ): Promise<CdpSession | null> {
    let byTarget = this.pools.get(appId);
    if (!byTarget) {
      byTarget = new Map();
      this.pools.set(appId, byTarget);
    }
    const existing = byTarget.get(targetKey);
    if (existing) {
      // Lazily discard retired sessions (no grace period; retire is a hint).
      if (existing.retired && existing.refCount === 0) {
        this.discard(appId, targetKey, existing);
        // fallthrough to create new
      } else {
        // Reuse: increment refCount and clear retired flag
        existing.lastUsedAt = Date.now();
        existing.refCount++;
        existing.retired = false;
        return existing.session;
      }
    }
    // Capacity guard前置 (RC1-B): refuse to open a brand-new session when the
    // per-agent cap is already reached — avoids a wasted handshake (~200ms)
    // just to close it again. The normal steady-state (targets are naturally
    // < 20) is unaffected. Checked BEFORE open() so we never create a socket
    // we intend to discard.
    if (byTarget.size >= MAX_SESSIONS_PER_AGENT) {
      mainWarn(
        'SessionPool',
        `per-agent session cap (${MAX_SESSIONS_PER_AGENT}) reached for ${appId}; ` +
          `not pooling target ${targetKey}`,
      );
      return null;
    }
    const session = await open();
    if (!session) return null;
    const entry: PooledEntry = {
      session,
      lastUsedAt: Date.now(),
      refCount: 1,
      retired: false,
    };
    byTarget.set(targetKey, entry);
    return session;
  }

  /** Release a pooled session (decrement refCount). */
  release(appId: AgentId, targetKey: string): void {
    const entry = this.pools.get(appId)?.get(targetKey);
    if (!entry) return;
    if (entry.refCount <= 0) {
      // Already zero — a second decrement would underflow. Log so the
      // double-release source can be traced instead of silently clamping.
      mainWarn(
        'SessionPool',
        `release called on zero-refCount session ${appId}/${targetKey} — possible double-release`,
      );
      return;
    }
    entry.refCount--;
    entry.lastUsedAt = Date.now();
    // Retired + refCount=0 → safe to close
    if (entry.retired && entry.refCount === 0) {
      this.discard(appId, targetKey, entry);
    }
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
   */
  invalidateEpoch(appId: AgentId): void {
    const byTarget = this.pools.get(appId);
    if (!byTarget) return;
    for (const [targetKey, entry] of byTarget) {
      if (entry.refCount > 0) {
        // In-use: mark retired, don't close yet
        entry.retired = true;
      } else {
        // Idle: close immediately
        this.discard(appId, targetKey, entry);
      }
    }
    // RC2 fix: clear acquireLocks for this agent. After epoch bump, any in-flight
    // acquire for the old epoch is stale — its lock entry would otherwise leak
    // until the promise settles (which may never happen if the session was
    // discarded).
    this.clearAgentAcquireLocks(appId);
    // Don't clear byTarget Map — new epoch acquire can reuse non-retired sessions
  }

  /**
   * RC2 fix: clear all acquire lock entries for a given agent. Called by
   * invalidateEpoch to prevent stale lock entries from accumulating when
   * an epoch bump retires all sessions for an agent.
   */
  private clearAgentAcquireLocks(appId: AgentId): void {
    const prefix = `${appId}:`;
    for (const key of this.acquireLocks.keys()) {
      if (key.startsWith(prefix)) {
        this.acquireLocks.delete(key);
      }
    }
  }

  /** Close and clear every pooled session (service dispose). Hard-close all. */
  dispose(): void {
    for (const byTarget of this.pools.values()) {
      for (const entry of byTarget.values()) {
        try {
          entry.session.close();
        } catch {
          /* already closed */
        }
      }
      byTarget.clear();
    }
    this.pools.clear();
    // RC2 fix: clear acquireLocks for all agents to prevent lock entry leaks.
    // Without this, in-flight acquire promises that never settle would pin
    // lock entries in the Map indefinitely.
    this.acquireLocks.clear();
  }

  /** Number of pooled sessions for an agent (diagnostics). */
  poolSize(appId: AgentId): number {
    return this.pools.get(appId)?.size ?? 0;
  }

  /** Stop + close + remove a pooled session. */
  private discard(appId: AgentId, targetKey: string, entry: PooledEntry): void {
    const byTarget = this.pools.get(appId);
    if (byTarget?.get(targetKey) === entry) {
      byTarget.delete(targetKey);
    }
    try {
      entry.session.close();
    } catch {
      /* already closed */
    }
  }
}
