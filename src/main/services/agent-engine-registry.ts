// SPDX-License-Identifier: MPL-2.0

/**
 * # Agent Engine Registry
 *
 * Centralised mutable state container for `AgentEngineService`.
 *
 * Extracted from `AgentEngineService` (Facade decomposition — registry
 * module).  Owns the per-agent persisted state (`apps` record) and provides
 * typed accessor / mutation methods so the Facade operates on a narrow
 * interface instead of reading/writing raw `Map` / plain objects directly.
 *
 * ## Design notes
 *
 * - The registry holds NO concurrency primitives — the Facade's mutex
 *   (apply/restore serialisation) guards all access; the registry itself
 *   is a pure state holder.
 * - All mutations are synchronous and in-place on the internal object.  The
 *   Facade is responsible for calling `persist.safe()` after any mutation.
 * - `snapshot()` returns a shallow immutable view for persistence and
 *   metrics; callers cannot mutate internal state through it.
 */

import type { AgentId } from '../../shared/types';
import type { SchemeSnapshot } from '../agent-scheme';
import type { PersistedState } from './agent-engine-persist';

// ---------------------------------------------------------------------------
// Per-app state entry (the shape stored under PersistedState.apps[appId])
// ---------------------------------------------------------------------------

export interface AgentAppState {
  activeThemeId: string | null;
  activeSchemeId: string | null;
  port: number | null;
  schemeSnapshot: SchemeSnapshot | null;
  detectedPath: string | null;
}

// ---------------------------------------------------------------------------
// Registry class
// ---------------------------------------------------------------------------

export class AgentEngineRegistry {
  private state: PersistedState = { version: 2, apps: {} };

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  /** Replace the entire state (used by `initialize` after validation). */
  loadFrom(newState: PersistedState): void {
    this.state = newState;
  }

  /** Return a shallow-immutable snapshot for persistence / metrics. */
  snapshot(): Readonly<PersistedState> {
    return this.state;
  }

  // -----------------------------------------------------------------------
  // Per-app accessors
  // -----------------------------------------------------------------------

  getApp(appId: AgentId): Readonly<AgentAppState> | undefined {
    const entry = this.state.apps[appId];
    if (!entry) return undefined;
    return entry as AgentAppState;
  }

  getActiveThemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeThemeId ?? null;
  }

  getActiveSchemeId(appId: AgentId): string | null {
    return this.state.apps[appId]?.activeSchemeId ?? null;
  }

  getPort(appId: AgentId): number | null {
    return this.state.apps[appId]?.port ?? null;
  }

  getSchemeSnapshot(appId: AgentId): SchemeSnapshot | null {
    return this.state.apps[appId]?.schemeSnapshot ?? null;
  }

  getDetectedPath(appId: AgentId): string | null {
    return this.state.apps[appId]?.detectedPath ?? null;
  }

  // -----------------------------------------------------------------------
  // Per-app mutations
  // -----------------------------------------------------------------------

  /**
   * Create or replace the full entry for an agent.  Caller must trigger
   * persistence afterwards via the Facade's `persistChain`.
   */
  setApp(appId: AgentId, entry: AgentAppState): void {
    this.state.apps[appId] = entry;
  }

  /**
   * Merge partial fields onto an existing entry.  Creates the entry if it
   * does not exist yet.  Caller must trigger persistence afterwards.
   */
  patchApp(appId: AgentId, partial: Partial<AgentAppState>): void {
    const existing = this.state.apps[appId];
    if (existing) {
      Object.assign(existing, partial);
    } else {
      this.state.apps[appId] = {
        activeThemeId: partial.activeThemeId ?? null,
        activeSchemeId: partial.activeSchemeId ?? null,
        port: partial.port ?? null,
        schemeSnapshot: partial.schemeSnapshot ?? null,
        detectedPath: partial.detectedPath ?? null,
      };
    }
  }

  /** Set the port for an agent (no-op if the agent entry does not exist). */
  setPort(appId: AgentId, port: number | null): void {
    const entry = this.state.apps[appId];
    if (entry) entry.port = port;
  }

  /** Set the scheme snapshot for an agent. */
  setSchemeSnapshot(appId: AgentId, snapshot: SchemeSnapshot | null): void {
    const entry = this.state.apps[appId];
    if (entry) entry.schemeSnapshot = snapshot;
  }

  /** Set the detected install path for an agent. */
  setDetectedPath(appId: AgentId, detectedPath: string | null): void {
    const entry = this.state.apps[appId];
    if (entry) entry.detectedPath = detectedPath;
  }

  /** Clear the persisted port (zombie cleanup). */
  clearPort(appId: AgentId): void {
    const entry = this.state.apps[appId];
    if (entry) entry.port = null;
  }

  /**
   * Reset an agent entry to the "no theme" state while preserving the port.
   * Called from the restore flow.
   */
  clearActiveTheme(appId: AgentId, port: number | null): void {
    this.state.apps[appId] = {
      activeThemeId: null,
      activeSchemeId: null,
      port,
      schemeSnapshot: null,
      detectedPath: this.state.apps[appId]?.detectedPath ?? null,
    };
  }

  /**
   * Iterate over all persisted app entries (used by reconcileActiveThemes).
   * Callback receives the appId and a mutable reference to the entry —
   * mutations are applied in-place to the internal state.
   */
  forEachApp(
    fn: (appId: AgentId, entry: NonNullable<PersistedState['apps'][AgentId]>) => void,
  ): void {
    for (const [appId, entry] of Object.entries(this.state.apps)) {
      if (entry) {
        fn(appId as AgentId, entry);
      }
    }
  }
}
