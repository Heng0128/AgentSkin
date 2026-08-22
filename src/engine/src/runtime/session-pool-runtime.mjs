// SPDX-License-Identifier: MPL-2.0

/**
 * # Runtime CDP Session Pool (CV-08)
 *
 * Reuses a target's CDP WebSocket session across the sequential sub-operations
 * of an apply/verify/remove pipeline. The injector's historical
 * `withSessions(targets, cb)` opened a fresh {@link CdpSession} (which handshakes
 * `Runtime.enable` + `Page.enable`, ~200ms) and immediately closed it per
 * operation — so a single `applyTheme` that runs preflight then apply touches
 * the same WorkBuddy webview targets twice, near-doubling handshake overhead
 * when 13+ targets are present.
 *
 * This pool collapses those duplicate connects into one per target within the
 * pool's lifetime.
 *
 * ## Lifecycle & safety
 * - **Per-target**, keyed by `target.id` (falling back to the WS URL).
 * - **TTL-bound**: an idle session is closed once it goes unused for `ttlMs`.
 *   Pruning is lazy (on acquire/release) so no periodic scheduler is needed and
 *   the pool is trivially testable.
 * - **Borrower contract**: pooled sessions are owned by the pool. A caller must
 *   NOT call `session.close()`; it returns ownership with {@link release}. The
 *   pool closes a borrowed session only if it does not belong (defensive) or on
 *   {@link dispose}.
 * - **Concurrency-safe**: `CdpSession.send`/`evaluate` tolerate overlapping
 *   callers (unique command ids + a pending map), so a pooled session may be
 *   shared across sequential operations without protocol corruption.
 */

import { CdpSession } from "../cdp/session.mjs";

const DEFAULT_TTL_MS = 30000;

/** Stable per-target pool key (id preferred, WS URL as fallback). */
export function targetKeyFor(target) {
  return target?.id || target?.webSocketDebuggerUrl || "unknown-target";
}

/** Open a real CDP session (the default `SessionPool` opener). */
async function openCdpSession(target, timeoutMs) {
  return new CdpSession(target, timeoutMs).open();
}

export class SessionPool {
  constructor(opts = {}) {
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.open = opts.open ?? openCdpSession;
    this.entries = new Map();
  }

  /**
   * Borrow a session for `target`, opening a pooled one on first use or after
   * the cached copy went stale/closed. Callers return ownership with release().
   */
  async acquire(target, timeoutMs) {
    this.prune();
    const key = targetKeyFor(target);
    const existing = this.entries.get(key);
    if (existing && !existing.session.closed) {
      existing.lastUsedAt = Date.now();
      return existing.session;
    }
    if (existing) this.entries.delete(key); // drop closed/stale entry
    const session = await this.open(target, timeoutMs);
    this.entries.set(key, { session, lastUsedAt: Date.now() });
    return session;
  }

  /**
   * Return a borrowed session to the pool (marking it recently used so it is
   * not pruned). If the session was not pooled here, close it defensively.
   */
  release(target, session) {
    if (!session) return;
    const key = targetKeyFor(target);
    const entry = this.entries.get(key);
    if (entry && entry.session === session) {
      entry.lastUsedAt = Date.now();
      return;
    }
    try {
      session.close();
    } catch {
      /* already closed */
    }
  }

  /** Explicitly close a specific pooled target (e.g. after a hard failure). */
  invalidate(target) {
    const key = targetKeyFor(target);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    try {
      entry.session.close();
    } catch {
      /* already closed */
    }
  }

  /** Close and clear every pooled session (operation end / dispose). */
  dispose() {
    for (const entry of this.entries.values()) {
      try {
        entry.session.close();
      } catch {
        /* already closed */
      }
    }
    this.entries.clear();
  }

  /** Number of live pooled sessions (diagnostics). */
  get size() {
    return this.entries.size;
  }

  /** Lazily drop entries idle beyond ttlMs. */
  prune() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt < cutoff) {
        this.entries.delete(key);
        try {
          entry.session.close();
        } catch {
          /* already closed */
        }
      }
    }
  }
}