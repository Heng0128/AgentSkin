// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # agent-state-engine.mjs — Agent State Awareness Engine
//
// Provides real-time tracking of AI Agent working states across multiple
// concurrent sessions. The engine maintains a per-session state machine and
// resolves the global highest-priority state for Studio UI feedback.
//
// Architecture:
//   CDP events / adapter signals
//        │
//        ▼
//   AgentStateEngine.addSession(agentId)  →  sessionId
//        │
//        ▼
//   AgentStateEngine.updateState(sessionId, state)
//        │
//        ├──► resolves priority state
//        ├──► emits 'stateChange' event
//        └──► updates session.lastUpdate
//
// State priority (high → low):
//   error > working > thinking > completed > idle > sleeping
//
// Inspired by clawd-on-desk's hook-based agent state tracking, but adapted
// for the AgentSkin CDP injection architecture.

// ---------------------------------------------------------------------------
// Types (JSDoc — consumed by IDEs / tsc --checkJs, not enforced at runtime)
// ---------------------------------------------------------------------------

/**
 * @typedef {'idle'|'thinking'|'working'|'error'|'completed'|'sleeping'} AgentState
 */

/**
 * @typedef {Object} AgentSession
 * @property {string} id          Unique session identifier.
 * @property {string} agent       Agent identifier (e.g. "traework", "codex").
 * @property {AgentState} state   Current working state.
 * @property {number} startTime   Session creation timestamp (ms since epoch).
 * @property {number} lastUpdate  Last state change timestamp (ms since epoch).
 * @property {Record<string, unknown>} metadata  Arbitrary session metadata.
 */

/**
 * @typedef {'stateChange'|'sessionAdd'|'sessionRemove'} AgentStateEvent
 */

/**
 * @typedef {Object} StateChangeEvent
 * @property {AgentSession} session   The session whose state changed.
 * @property {AgentState} prevState   The previous state.
 * @property {AgentState} newState    The new state.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** All six agent working states (serves as the AgentState enum). */
export const AGENT_STATES = Object.freeze([
  'idle',
  'thinking',
  'working',
  'error',
  'completed',
  'sleeping',
]);

/**
 * Priority map: higher number = higher priority.
 * Priority order: error > working > thinking > completed > idle > sleeping
 */
const STATE_PRIORITY = Object.freeze({
  error: 6,
  working: 5,
  thinking: 4,
  completed: 3,
  idle: 2,
  sleeping: 1,
});

// ---------------------------------------------------------------------------
// AgentStateEngine
// ---------------------------------------------------------------------------

/**
 * Engine for tracking agent working states across multiple concurrent sessions.
 *
 * Each session represents a single agent instance (e.g. one traework window).
 * The engine resolves the global highest-priority state so the Studio UI can
 * render a single coherent status indicator.
 */
export class AgentStateEngine {
  /** @type {Map<string, AgentSession>} */
  sessions;

  /** @type {Map<AgentStateEvent, Set<Function>>} */
  #listeners;

  /** @type {number} */
  #counter;

  /**
   * Create a new AgentStateEngine.
   */
  constructor() {
    this.sessions = new Map();
    this.#listeners = new Map();
    this.#counter = 0;
  }

  // -----------------------------------------------------------------------
  // Session lifecycle
  // -----------------------------------------------------------------------

  /**
   * Add a new agent session. The session starts in the `idle` state.
   *
   * @param {string} agent - Agent identifier (e.g. "traework", "codex").
   * @returns {string} The newly created session ID.
   */
  addSession(agent) {
    const id = this.#generateId();
    const now = Date.now();
    /** @type {AgentSession} */
    const session = {
      id,
      agent,
      state: 'idle',
      startTime: now,
      lastUpdate: now,
      metadata: {},
    };
    this.sessions.set(id, session);
    this.#emit('sessionAdd', session);
    return id;
  }

  /**
   * Remove a session from the engine.
   *
   * Emits a `sessionRemove` event with the removed session. Removing a
   * non-existent session is a silent no-op.
   *
   * @param {string} sessionId - The session ID to remove.
   */
  removeSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    this.#emit('sessionRemove', session);
  }

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  /**
   * Update the state of an existing session.
   *
   * Updates `lastUpdate` to the current timestamp and emits a `stateChange`
   * event with `{ session, prevState, newState }`.
   *
   * @param {string} sessionId - Target session ID.
   * @param {AgentState} state - New state to assign.
   * @throws {Error} If sessionId does not exist.
   */
  updateState(sessionId, state) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`AgentStateEngine: session "${sessionId}" not found`);
    }
    const prevState = session.state;
    if (prevState === state) {
      // Still bump lastUpdate even when state is unchanged (heartbeat).
      session.lastUpdate = Date.now();
      return;
    }
    session.state = state;
    session.lastUpdate = Date.now();
    this.#emit('stateChange', { session, prevState, newState: state });
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Get a session by its ID.
   *
   * @param {string} sessionId - The session ID to look up.
   * @returns {AgentSession|undefined} The session, or undefined if not found.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions currently tracked by the engine.
   *
   * @returns {AgentSession[]} Array of all sessions (insertion order).
   */
  getAllSessions() {
    return [...this.sessions.values()];
  }

  /**
   * Get sessions that are actively working — i.e. their state is neither
   * `idle` nor `sleeping`.
   *
   * @returns {AgentSession[]} Array of active sessions.
   */
  getActiveSessions() {
    return this.getAllSessions().filter((s) => s.state !== 'idle' && s.state !== 'sleeping');
  }

  /**
   * Resolve the highest-priority state across all sessions.
   *
   * When multiple sessions exist, the state with the highest priority wins.
   * Priority order: error > working > thinking > completed > idle > sleeping.
   *
   * Returns `idle` when no sessions exist.
   *
   * @returns {AgentState} The current highest-priority state.
   */
  resolvePriorityState() {
    if (this.sessions.size === 0) return 'idle';

    let topState = 'sleeping';
    let topPriority = STATE_PRIORITY.sleeping;

    for (const session of this.sessions.values()) {
      const p = STATE_PRIORITY[session.state];
      if (p > topPriority) {
        topPriority = p;
        topState = session.state;
      }
    }

    return topState;
  }

  // -----------------------------------------------------------------------
  // Event system
  // -----------------------------------------------------------------------

  /**
   * Subscribe to an engine event.
   *
   * @param {AgentStateEvent} event - Event name to listen for.
   * @param {Function} listener - Callback invoked when the event fires.
   * @returns {Function} Unsubscribe function that removes the listener.
   */
  on(event, listener) {
    if (!this.#listeners.has(event)) {
      this.#listeners.set(event, new Set());
    }
    this.#listeners.get(event).add(listener);
    return () => this.off(event, listener);
  }

  /**
   * Unsubscribe from an engine event.
   *
   * @param {AgentStateEvent} event - Event name.
   * @param {Function} listener - The listener to remove.
   */
  off(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Remove all sessions and clear all event listeners.
   *
   * After disposal, the engine can be reused by calling `addSession` again,
   * but previous listeners are gone.
   */
  dispose() {
    this.sessions.clear();
    this.#listeners.clear();
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /**
   * Generate a unique session ID.
   *
   * Combines a base-36 timestamp with an incrementing counter to guarantee
   * uniqueness even when multiple sessions are created within the same
   * millisecond.
   *
   * @returns {string} A unique session ID (e.g. "sess_m3k2x1_1").
   */
  #generateId() {
    this.#counter += 1;
    return `sess_${Date.now().toString(36)}_${this.#counter.toString(36)}`;
  }

  /**
   * Emit an event to all registered listeners.
   *
   * Listener errors are caught and silently discarded so a misbehaving
   * listener cannot break the engine or other listeners.
   *
   * @param {AgentStateEvent} event - Event name.
   * @param {unknown} payload - Event payload passed to listeners.
   */
  #emit(event, payload) {
    const listeners = this.#listeners.get(event);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch {
        // Listener errors do not affect the engine.
      }
    }
  }
}

export default AgentStateEngine;
