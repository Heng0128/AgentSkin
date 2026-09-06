// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Session Manager — Enhanced Single-Instance Guardian
 *
 * Provides process-level ownership of injection sessions per adapter.
 * When multiple injection requests target the same agent, the session
 * manager ensures only one active session exists and delegates subsequent
 * requests to it (handoff) rather than creating duplicate injections.
 *
 * ## Architecture
 *
 * ```
 *  InjectionSessionManager (singleton)
 *  ├── sessions: Map<AgentId, InjectionSession>
 *  ├── registerSession()    — claim ownership for an agent
 *  ├── getActiveSession()   — query current owner
 *  ├── handoffSession()     — transfer ownership to a new requester
 *  └── releaseSession()     — relinquish ownership
 * ```
 *
 * ## Competition Insight
 *
 * Inspired by comeonzhj/WorkBuddy-theme-skill's "single-instance daemon +
 * competition elimination" design: instead of allowing multiple injectors
 * to fight over the same CDP target, the first injector becomes the owner
 * and all later requests are delegated to it.
 *
 * ## Lifecycle
 *
 * ```
 *  IDLE → REGISTERED → ACTIVE → RELEASED
 *                  ↓
 *              HANDING_OFF → ACTIVE (new owner)
 * ```
 */

import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types/agent';
import { ctx } from '../main-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Session lifecycle states. */
export type InjectionSessionState =
  | 'REGISTERED' // Session claimed but injection not yet confirmed
  | 'ACTIVE' // Injection confirmed, session is authoritative
  | 'HANDING_OFF' // Ownership transfer in progress
  | 'RELEASED'; // Session terminated

/**
 * Metadata for a single injection session.
 *
 * Each session represents one logical injection relationship with a
 * target agent. At most one ACTIVE session may exist per agent at any time.
 */
export interface InjectionSession {
  /** Unique session identifier (UUID-like, generated at registration). */
  readonly id: string;
  /** Target adapter (agent) this session owns. */
  readonly adapterId: AgentId;
  /** CDP debug port the session is attached to. */
  readonly port: number;
  /** Timestamp when the session was created (ms since epoch). */
  readonly createdAt: number;
  /** Current session state. */
  state: InjectionSessionState;
  /** Identifier of the current owner (e.g. "engine-strategy:apply:midnight-aurora"). */
  owner: string;
  /** Number of times this session has been handed off. */
  handoffCount: number;
  /** Timestamp of last state change (ms since epoch). */
  lastTransitionAt: number;
}

/** Result of a registerSession() call. */
export interface RegisterResult {
  /** Whether the registration succeeded. */
  success: boolean;
  /** The session that was created (when success=true). */
  session?: InjectionSession;
  /** When success=false, explains why. */
  reason?: 'duplicate_agent' | 'stale_session_replaced';
  /** When success=false due to duplicate, the existing session. */
  existingSession?: InjectionSession;
}

/** Result of a handoffSession() call. */
export interface HandoffResult {
  /** Whether the handoff succeeded. */
  success: boolean;
  /** The session after handoff (when success=true). */
  session?: InjectionSession;
  /** When success=false, the reason. */
  reason?: 'no_session' | 'not_active' | 'same_owner';
}

/** Result of a releaseSession() call. */
export interface ReleaseResult {
  /** Whether the release succeeded (session was active and is now released). */
  success: boolean;
  /** When success=false, the reason. */
  reason?: 'no_session' | 'not_active';
}

// ---------------------------------------------------------------------------
// InjectionSessionManager
// ---------------------------------------------------------------------------

/**
 * Manages injection sessions per adapter agent.
 *
 * Singleton pattern: one instance tracks all agent sessions across the
 * application lifecycle.
 *
 * @example
 * ```ts
 * const manager = new InjectionSessionManager();
 *
 * // Register a session for doubao on port 9222
 * const result = manager.registerSession('doubao', 9222, 'engine-strategy:apply:theme-1');
 * if (result.success) {
 *   console.log(`Session ${result.session!.id} registered`);
 * }
 *
 * // Later, another component wants to inject the same agent — gets handed off
 * const handoff = manager.handoffSession('doubao', 'adapter-mjs:apply:theme-2');
 * if (handoff.success) {
 *   console.log(`Session handed off (handoff #${handoff.session!.handoffCount})`);
 * }
 *
 * // Query active session
 * const active = manager.getActiveSession('doubao'); // InjectionSession | null
 *
 * // Release when done
 * manager.releaseSession('doubao');
 * ```
 */
export class InjectionSessionManager {
  /** Per-agent session store. */
  private readonly sessions = new Map<AgentId, InjectionSession>();

  /** Monotonic counter for generating unique session IDs. */
  private idCounter = 0;

  /**
   * Generate a unique session identifier.
   *
   * Uses a monotonic counter + timestamp for uniqueness within a process.
   * Format: `sess-<counter>-<timestamp>`.
   */
  private generateId(): string {
    this.idCounter += 1;
    return `sess-${this.idCounter}-${Date.now()}`;
  }

  /**
   * Emit a PERFORMANCE_CDP_METRICS event to the renderer(s).
   *
   * Fan-out to both mainWindow and studioWindow (when available) so the
   * CDP Performance HUD can update its sessionCount / reconnected fields
   * in real time instead of waiting for the next poll tick.
   *
   * @param reconnected  Whether this emission was triggered by a handoff (reconnect).
   */
  private emitCdpMetrics(reconnected: boolean): void {
    const payload = { sessionCount: this.sessionCount, reconnected };
    const main = ctx.mainWindow;
    const studio = ctx.studioWindow;
    try {
      if (main && !main.isDestroyed()) {
        main.webContents.send(IpcChannel.PERFORMANCE_CDP_METRICS, payload);
      }
    } catch {
      // Window destroyed between isDestroyed() check and send() — ignore.
    }
    try {
      if (studio && !studio.isDestroyed()) {
        studio.webContents.send(IpcChannel.PERFORMANCE_CDP_METRICS, payload);
      }
    } catch {
      // Window destroyed between isDestroyed() check and send() — ignore.
    }
  }

  // ── Registration ──────────────────────────────────────────────────────

  /**
   * Register a new injection session for an agent.
   *
   * If no active session already exists for the agent, a new session is
   * created in the REGISTERED state and immediately promoted to ACTIVE.
   *
   * If an active session already exists (state = ACTIVE or REGISTERED),
   * the call returns success=false with reason 'duplicate_agent' and the
   * existing session caller can decide whether to handoff or abort.
   *
   * If the existing session is in HANDING_OFF or RELEASED state, it is
   * replaced (the stale session is overwritten with the new one).
   *
   * @param adapterId  Target adapter agent.
   * @param port       CDP debug port.
   * @param owner      Initial owner identifier.
   * @returns Registration result.
   */
  registerSession(adapterId: AgentId, port: number, owner: string): RegisterResult {
    const existing = this.sessions.get(adapterId);

    if (existing && (existing.state === 'ACTIVE' || existing.state === 'REGISTERED')) {
      return {
        success: false,
        reason: 'duplicate_agent',
        existingSession: existing,
      };
    }

    const now = Date.now();
    const session: InjectionSession = {
      id: this.generateId(),
      adapterId,
      port,
      createdAt: now,
      state: 'ACTIVE',
      owner,
      handoffCount: 0,
      lastTransitionAt: now,
    };

    this.sessions.set(adapterId, session);

    this.emitCdpMetrics(false);

    return { success: true, session };
  }

  // ── Query ─────────────────────────────────────────────────────────────

  /**
   * Get the active session for an agent.
   *
   * Only returns sessions in the ACTIVE state. Sessions in REGISTERED,
   * HANDING_OFF, or RELEASED states are not considered "active" for
   * ownership purposes.
   *
   * @param adapterId  Target adapter agent.
   * @returns The active session, or `null` if none exists.
   */
  getActiveSession(adapterId: AgentId): InjectionSession | null {
    const session = this.sessions.get(adapterId);
    if (session?.state !== 'ACTIVE') return null;
    return session;
  }

  /**
   * Get any session for an agent (including non-active).
   *
   * Useful for diagnostics where the full state needs inspection.
   *
   * @param adapterId  Target adapter agent.
   * @returns The session in any state, or `null` if no session exists.
   */
  getSession(adapterId: AgentId): InjectionSession | null {
    return this.sessions.get(adapterId) ?? null;
  }

  /**
   * Check whether an agent has an active session.
   *
   * @param adapterId  Target adapter agent.
   * @returns `true` if an ACTIVE session exists.
   */
  hasActiveSession(adapterId: AgentId): boolean {
    const session = this.sessions.get(adapterId);
    return session !== undefined && session.state === 'ACTIVE';
  }

  // ── Handoff ───────────────────────────────────────────────────────────

  /**
   * Transfer session ownership to a new requester.
   *
   * This is the core mechanism for avoiding duplicate injection: when a
   * second component wants to inject the same agent, instead of creating
   * a competing session, the existing session's ownership is transferred
   * to the new requester.
   *
   * Lifecycle:
   *   1. Verify the session exists and is ACTIVE.
   *   2. Transition to HANDING_OFF.
   *   3. Update owner and increment handoffCount.
   *   4. Transition back to ACTIVE.
   *
   * @param adapterId  Target adapter agent.
   * @param newOwner   Identifier of the new owner.
   * @returns Handoff result.
   */
  handoffSession(adapterId: AgentId, newOwner: string): HandoffResult {
    const session = this.sessions.get(adapterId);

    if (!session) {
      return { success: false, reason: 'no_session' };
    }

    if (session.state !== 'ACTIVE') {
      return { success: false, reason: 'not_active' };
    }

    if (session.owner === newOwner) {
      return { success: false, reason: 'same_owner' };
    }

    const now = Date.now();

    // Transition to HANDING_OFF.
    session.state = 'HANDING_OFF';
    session.lastTransitionAt = now;

    // Transfer ownership.
    session.owner = newOwner;
    session.handoffCount += 1;

    // Transition back to ACTIVE.
    session.state = 'ACTIVE';
    session.lastTransitionAt = now;

    this.emitCdpMetrics(true);

    return { success: true, session };
  }

  // ── Release ───────────────────────────────────────────────────────────

  /**
   * Release (terminate) a session.
   *
   * Transitions the session to RELEASED state. The session record is
   * retained for diagnostics but is no longer considered active.
   *
   * @param adapterId  Target adapter agent.
   * @returns Release result.
   */
  releaseSession(adapterId: AgentId): ReleaseResult {
    const session = this.sessions.get(adapterId);

    if (!session) {
      return { success: false, reason: 'no_session' };
    }

    if (session.state !== 'ACTIVE') {
      return { success: false, reason: 'not_active' };
    }

    session.state = 'RELEASED';
    session.lastTransitionAt = Date.now();

    this.emitCdpMetrics(false);

    return { success: true };
  }

  // ── Diagnostics ───────────────────────────────────────────────────────

  /**
   * Get all active sessions.
   *
   * @returns Array of sessions in ACTIVE state.
   */
  getAllActiveSessions(): InjectionSession[] {
    const result: InjectionSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.state === 'ACTIVE') {
        result.push(session);
      }
    }
    return result;
  }

  /**
   * Get the total number of sessions tracked (including non-active).
   */
  get sessionCount(): number {
    return this.sessions.size;
  }

  // ── Lifecycle cleanup ─────────────────────────────────────────────────

  /**
   * @internal
   * Test-only: reset the manager to its initial state.
   *
   * Clears all sessions and resets the ID counter so tests start from a
   * clean slate.
   */
  __test_reset(): void {
    this.sessions.clear();
    this.idCounter = 0;
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

/**
 * Injection Session Manager singleton.
 *
 * Import this instance to coordinate injection session ownership across
 * the application.
 *
 * @example
 * ```ts
 * import { injectionSessionManager } from '@main/injection/injection-session-manager';
 *
 * // Register at injection start
 * const result = injectionSessionManager.registerSession('doubao', 9222, 'engine-strategy:apply');
 *
 * // Before injecting, check if another session already owns the agent
 * const active = injectionSessionManager.getActiveSession('doubao');
 * if (active && active.owner !== myOwnerId) {
 *   // Delegate to existing session via handoff
 *   injectionSessionManager.handoffSession('doubao', myOwnerId);
 * }
 * ```
 */
export const injectionSessionManager = new InjectionSessionManager();
