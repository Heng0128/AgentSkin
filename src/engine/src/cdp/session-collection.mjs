// SPDX-License-Identifier: MIT

/**
 * # SessionCollection — Multi-page CDP session manager
 *
 * Manages multiple CDP connections (page / iframe / worker targets) discovered
 * from a single debug port. Inspired by ntoskrnl7/electron-cdp's autoAttach +
 * Session/双层双层管理 + multi-target-type tracking.
 *
 * ## Design
 * - `discover()` fetches the target list via `listCdpTargets(port)` and filters
 *   by `options.types` (default `['page', 'iframe']`).
 * - `connect()` opens a {@link CdpSession} for every discovered target and
 *   stores it as a {@link ManagedSession} in the `#sessions` map.
 * - `send()` routes to a single target or broadcasts to all `page` sessions.
 * - `broadcast()` uses `Promise.allSettled` so one dead session does not sink
 *   the whole fan-out.
 * - `evaluate()` is a semantic wrapper over `Runtime.evaluate`.
 *
 * ## Lifecycle
 * The caller owns the collection. Call `closeAll()` when done to release every
 * underlying WebSocket. The collection can be re-used: `discover()` +
 * `connect()` repopulates `#sessions` (previously closed sessions are dropped).
 */

import { CdpSession, listCdpTargets } from "./session.mjs";

/** @typedef {{ id: string, session: CdpSession, type: string, url: string, title: string }} ManagedSession */

/**
 * @typedef {Object} SessionCollectionOptions
 * @property {number} port — CDP debug port (e.g. 9222).
 * @property {string[]} [types] — Target types to manage. Default `['page', 'iframe']`.
 * @property {number} [timeoutMs] — Per-session open timeout. Default 10000.
 * @property {(target: object, timeoutMs: number) => Promise<CdpSession>} [sessionFactory]
 *   Override session construction (tests / custom transport). Defaults to
 *   `new CdpSession(target, timeoutMs).open()`.
 */

export class SessionCollection {
  /** @type {Map<string, ManagedSession>} */
  #sessions = new Map();

  /** @type {string[]} */
  #types;

  /** @type {number} */
  #port;

  /** @type {number} */
  #timeoutMs;

  /** @type {(target: object, timeoutMs: number) => Promise<CdpSession>} */
  #sessionFactory;

  /** @type {Array<object>} Raw targets from the last discover() call. */
  #discovered = [];

  /** @param {SessionCollectionOptions} options */
  constructor(options) {
    if (!options || typeof options.port !== "number") {
      throw new Error("SessionCollection requires a numeric `port`.");
    }
    this.#port = options.port;
    this.#types = options.types ?? ["page", "iframe"];
    this.#timeoutMs = options.timeoutMs ?? 10000;
    this.#sessionFactory = options.sessionFactory ?? defaultSessionFactory;
  }

  /**
   * Fetch the target list from the CDP endpoint and filter by `types`.
   * Does NOT open connections — call `connect()` afterwards.
   * @returns {Promise<Array<object>>} The filtered target list.
   */
  async discover() {
    const all = await listCdpTargets(this.#port, this.#timeoutMs);
    this.#discovered = all.filter((t) => this.#matchesType(t.type));
    return this.#discovered;
  }

  /**
   * Open a {@link CdpSession} for every discovered target. Re-fetches the
   * target list on every call so that targets which disappeared since the last
   * connect() are detected and their stale sessions closed. Previously stored
   * sessions whose target is no longer present are closed and dropped.
   * @returns {Promise<Map<string, ManagedSession>>} The connected sessions.
   */
  async connect() {
    await this.discover();
    const targets = this.#discovered;

    const connectedIds = new Set();
    for (const target of targets) {
      const id = target.id ?? target.webSocketDebuggerUrl ?? cryptoRandomId();
      connectedIds.add(id);
      if (this.#sessions.has(id)) continue; // already connected
      const session = await this.#sessionFactory(target, this.#timeoutMs);
      this.#sessions.set(id, {
        id,
        session,
        type: target.type ?? "page",
        url: target.url ?? "",
        title: target.title ?? "",
      });
    }

    // Drop sessions whose target disappeared between discovers.
    for (const [id, managed] of this.#sessions) {
      if (!connectedIds.has(id)) {
        try {
          managed.session.close();
        } catch {
          /* already closed */
        }
        this.#sessions.delete(id);
      }
    }

    return this.#sessions;
  }

  /**
   * Route a CDP command. If `targetId` is given, send to that session only.
   * If `targetId` is null, broadcast to every `page`-type session.
   * @param {string} method — CDP method (e.g. "Runtime.evaluate").
   * @param {object} [params] — Method parameters.
   * @param {string|null} [targetId] — Specific target, or null for broadcast.
   * @returns {Promise<unknown>} The CDP result (single) or array of results (broadcast).
   */
  async send(method, params = {}, targetId = null) {
    if (targetId !== null) {
      const managed = this.#sessions.get(targetId);
      if (!managed) throw new Error(`No session for target "${targetId}".`);
      return managed.session.send(method, params);
    }
    return this.broadcast(method, params, "page");
  }

  /**
   * Fan out a CDP command to every session whose type matches `typeFilter`.
   * Uses `Promise.allSettled` so one dead session does not sink the fan-out.
   * @param {string} method
   * @param {object} [params]
   * @param {string} [typeFilter]
   * @returns {Promise<Array<{ status: 'fulfilled', value: unknown } | { status: 'rejected', reason: Error }>>}
   */
  async broadcast(method, params = {}, typeFilter = "page") {
    const targets = [...this.#sessions.values()].filter((m) => m.type === typeFilter);
    return Promise.allSettled(targets.map((m) => m.session.send(method, params)));
  }

  /**
   * Evaluate a JS expression on a specific target or broadcast to all pages.
   * Semantic wrapper over `Runtime.evaluate`.
   * @param {string} expression — JS source to evaluate.
   * @param {string|null} [targetId] — Specific target, or null for all pages.
   * @returns {Promise<unknown>}
   */
  async evaluate(expression, targetId = null) {
    if (targetId !== null) {
      const managed = this.#sessions.get(targetId);
      if (!managed) throw new Error(`No session for target "${targetId}".`);
      return managed.session.evaluate(expression);
    }
    const results = await this.broadcast(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true, userGesture: false },
      "page",
    );
    return results.map((r) =>
      r.status === "fulfilled" ? r.value : new Error(String(r.reason)),
    );
  }

  /**
   * Close and remove a single session.
   * @param {string} targetId
   * @returns {boolean} True if the session existed and was removed.
   */
  remove(targetId) {
    const managed = this.#sessions.get(targetId);
    if (!managed) return false;
    try {
      managed.session.close();
    } catch {
      /* already closed */
    }
    this.#sessions.delete(targetId);
    return true;
  }

  /**
   * Health / inventory snapshot. Counts sessions by canonical type bucket —
   * CDP subtypes like `service_worker`/`shared_worker` are folded into `worker`.
   * @returns {{ total: number, byType: { page: number, iframe: number, worker: number } }}
   */
  stats() {
    const byType = { page: 0, iframe: 0, worker: 0 };
    for (const managed of this.#sessions.values()) {
      const bucket = this.#canonicalType(managed.type);
      byType[bucket]++;
    }
    return { total: this.#sessions.size, byType };
  }

  /**
   * Map a CDP type string to one of the three canonical buckets.
   * @param {string} type
   * @returns {'page'|'iframe'|'worker'}
   */
  #canonicalType(type) {
    if (!type) return "page";
    if (type === "page" || type.startsWith("page_")) return "page";
    if (type === "iframe" || type.startsWith("iframe_")) return "iframe";
    // "worker" | "service_worker" | "shared_worker" | anything else unusual.
    return "worker";
  }

  /**
   * Close every managed session and clear the collection.
   * @returns {Promise<void>}
   */
  async closeAll() {
    for (const managed of this.#sessions.values()) {
      try {
        managed.session.close();
      } catch {
        /* already closed */
      }
    }
    this.#sessions.clear();
    this.#discovered = [];
  }

  /** Number of managed sessions. */
  get size() {
    return this.#sessions.size;
  }

  /** Snapshot of managed sessions (read-only array). */
  get sessions() {
    return [...this.#sessions.values()];
  }

  /** @param {string} type */
  #matchesType(type) {
    if (!type) return false;
    return this.#types.some((allowed) => {
      if (type === allowed) return true;
      // Match CDP subtypes: "service_worker" / "shared_worker" → "worker",
      // "iframe" → "iframe", but NOT "pageview" → "page". Require a word
      // boundary (underscore) so a prefix only matches true subtypes.
      if (type.startsWith(`${allowed}_`)) return true;
      // "worker" is special: CDP names it "service_worker"/"shared_worker"
      // (suffix form), so also match the `_worker` suffix.
      if (allowed === "worker" && type.endsWith("_worker")) return true;
      return false;
    });
  }
}

/** Default opener: real CdpSession handshake. */
async function defaultSessionFactory(target, timeoutMs) {
  return new CdpSession(target, timeoutMs).open();
}

/** Fallback id when a target lacks both id and webSocketDebuggerUrl. */
function cryptoRandomId() {
  return `session-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
