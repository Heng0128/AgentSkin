// SPDX-License-Identifier: MPL-2.0

/**
 * # PersistenceSessionManager
 *
 * Long-lived CDP session manager for `Page.addScriptToEvaluateOnNewDocument`
 * persistent script registration.
 *
 * ## Why this exists (V2 → V3 gap)
 *
 * - V2: `persistenceSessions` (Map<string, CdpSession>) kept sessions alive
 *   across operations; scripts survived reloads because the session stayed open.
 * - V3: `orchestrator.ts:registerAdapterPersistScripts` uses operation-scoped
 *   sessions from the pool; scripts vanish when the pool is disposed at epoch
 *   boundary.
 *
 * This manager bridges that gap — sessions survive across apply/remove epochs
 * and are only released on explicit `closeAll(appId)` or `cleanupOrphans`.
 *
 * ## Session-bound registrations
 *
 * CDP empirically verifies (2026-08-17) that
 * `Page.addScriptToEvaluateOnNewDocument` registrations are **session-bound**:
 * closing the WebSocket drops all registrations made through it. Therefore,
 * persistence scripts MUST be registered on a dedicated long-lived session
 * that outlives any operation-scoped pool.
 *
 * ## Responsibilities
 *
 * - Session lifecycle management (acquire / reuse / close).
 * - Script registration tracking (persistIds per session).
 *
 * ## Non-responsibilities
 *
 * - Does NOT call `applyThemeFlow` — only provides `addScript` capability
 *   for orchestrator.ts to consume.
 */

import type { CdpSession } from '../cdp-client';

/** A single managed entry: the live session plus its registered script identifiers. */
interface PersistEntry {
  session: CdpSession;
  persistIds: Set<string>;
}

/**
 * Long-lived CDP session manager for persistent script registration.
 *
 * Unlike the operation-scoped session pool:
 * - Sessions survive across apply/remove operations.
 * - Released only when `closeAll(appId)` or `removeUnregisteredSessions` is called.
 * - Dedicated to `Page.addScriptToEvaluateOnNewDocument` bindings.
 */
export class PersistenceSessionManager {
  private readonly sessions = new Map<string, PersistEntry>();

  /**
   * Get or create a long-lived session for the given appId + targetId.
   *
   * Key format: `${appId}:${targetId}`. An existing healthy session is
   * returned directly; otherwise `factory` is invoked to create and connect
   * a fresh session, which is then cached for future reuse.
   *
   * @param appId - The target agent application identifier.
   * @param targetId - The CDP target identifier within the application.
   * @param factory - Factory function that creates and connects a new CdpSession.
   */
  async acquire(
    appId: string,
    targetId: string,
    factory: () => Promise<CdpSession>,
  ): Promise<CdpSession> {
    const key = `${appId}:${targetId}`;
    const existing = this.sessions.get(key);
    if (existing) return existing.session;

    const session = await factory();
    this.sessions.set(key, { session, persistIds: new Set() });
    return session;
  }

  /**
   * Register a persistent script on the long-lived session for the given target.
   *
   * If a session already exists for `${appId}:${targetId}` (from a prior
   * `acquire()`), it is reused.  When `session` is supplied and no cached entry
   * exists yet, the passed session is stored as the entry — this is the
   * pragmatic bridge used by `registerAdapterPersistScripts` where the caller
   * already holds an operation-scoped session.
   *
   * The returned CDP identifier is recorded in `persistIds` so it can be
   * cleaned up later.
   *
   * @param appId - The target agent application identifier.
   * @param targetId - The CDP target identifier.
   * @param source - The script source code to register.
   * @param session - Fallback session when no cached entry exists yet.
   * @returns The CDP-assigned identifier for the registered script.
   */
  async addScript(
    appId: string,
    targetId: string,
    source: string,
    session?: CdpSession,
  ): Promise<string> {
    const key = `${appId}:${targetId}`;
    let entry = this.sessions.get(key);
    if (!entry) {
      if (!session) {
        throw new Error(
          `PersistenceSessionManager.addScript: no session available for ${key}. ` +
            'Call acquire() before addScript() or pass a session.',
        );
      }
      entry = { session, persistIds: new Set() };
      this.sessions.set(key, entry);
    }

    const result = await entry.session.send<{ identifier: string }>(
      'Page.addScriptToEvaluateOnNewDocument',
      { source, runImmediately: false },
    );

    entry.persistIds.add(result.identifier);
    return result.identifier;
  }

  /**
   * Close all sessions and clear registrations for a specific application.
   *
   * Called during restore/remove operations. Closing the WebSocket drops all
   * `Page.addScriptToEvaluateOnNewDocument` registrations owned by those sessions.
   *
   * @param appId - The agent application whose sessions should be closed.
   */
  async closeAll(appId: string): Promise<void> {
    const prefix = `${appId}:`;
    for (const [key, entry] of this.sessions) {
      if (key.startsWith(prefix)) {
        this.sessions.delete(key);
        try {
          entry.session.close();
        } catch {
          /* already closed — idempotent */
        }
      }
    }
  }

  /**
   * Clean up orphaned sessions whose appId is no longer in the valid set.
   *
   * When an application is uninstalled or its targets no longer exist, its
   * entries remain in the sessions Map. This method sweeps them out.
   *
   * @param validAppIds - Set of currently valid/registered application identifiers.
   */
  async cleanupOrphans(validAppIds: Set<string>): Promise<void> {
    const orphanedAppIds = new Set<string>();
    for (const key of this.sessions.keys()) {
      const appId = key.slice(0, key.indexOf(':'));
      if (!validAppIds.has(appId)) {
        orphanedAppIds.add(appId);
      }
    }
    for (const appId of orphanedAppIds) {
      await this.closeAll(appId);
    }
  }
}
