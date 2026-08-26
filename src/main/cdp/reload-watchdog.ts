// SPDX-License-Identifier: MPL-2.0

/**
 * # Reload watchdog (RFC 2026-08-18 P3 · cross-navigation fallback re-inject)
 *
 * Wires the "P3 作用域边界" follow-up: after a theme'd page target reloads or
 * navigates, the core runtime's `persistenceSessions` restores the visible
 * theme sheet (R2), but the hardening engine's owned layers (palette/tokens/
 * cosmetic/theme + adapter.mjs) are lost — since P2 those are no longer
 * re-applied by a new-document persistence script.
 *
 * This module keeps a **long-lived, event-aware CDP session** on the primary
 * page target (the same session-survives-navigation property the core's
 * persistence uses) and subscribes to `Page.loadEventFired`. On each full
 * document load it re-verifies the engine's owned adoptedStyleSheets
 * (`SHEET_OWNED_FLAG`); if they are absent it re-injects once via
 * `tryEngineInjection`, then returns to armed (idle) state.
 *
 * Lifecycle:
 *   - {@link attachReloadWatchdog} — called by `hardeningPass` once it secures
 *     the primary page target. Idempotent: re-attaching within the same epoch
 *     refreshes the target-theme payload; a new epoch tears the old one down.
 *   - {@link detachReloadWatchdog} — called by `hardeningRemove` per app.
 *   - {@link disposeReloadWatchdogs} — called on service shutdown.
 *   - Self-disarm — if `Page.loadEventFired` fires but the captured epoch is no
 *     longer current (a newer apply/restore superseded), the watchdog detaches
 *     itself so remove→reload stays clean (R4).
 *
 * Safety: re-injection only happens when the engine's OWNED sheets are missing
 * AND the epoch is current. It never triggers a navigation (so no re-inject
 * loop), and at most one re-inject per navigation is attempted.
 */

import type { ResolvedThemeTarget, ThemeBundle } from '../../legacy/agentskin-core-runtime';
import { toMessage } from '../../shared/errors';
import type { AgentId } from '../../shared/types';
import { type CdpSession, connectEventCdp, type EventCdpSession } from './cdp-client';
import type { InjectEngineResult } from './cdp-inject';
import { verifyTheme } from './injection/shared';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
  type SessionHandle,
  targetKeyFor,
} from './session-pool';

/** Debounce so a burst of nav events (redirects, initial load) coalesces. */
const RELOAD_DEBOUNCE_MS = 600;

/** Narrow deps slice — a subset of `CdpFanoutDeps` (avoids a circular import). */
export interface ReloadWatchdogDeps {
  isEpochCurrent: (appId: AgentId, captured: number) => boolean;
  tryEngineInjection: (
    session: CdpSession,
    appId: AgentId,
    bundle: ThemeBundle,
    targetTheme: ResolvedThemeTarget,
    imageDataUrls: Record<string, string> | null,
    imageFilePaths?: Record<string, string> | null,
  ) => Promise<InjectEngineResult | null>;
  log: (line: string) => void;
}

export interface AttachReloadWatchdogOptions {
  appId: AgentId;
  /** WebSocket URL of the primary page target to observe. */
  pageTargetUrl?: string;
  bundle: ThemeBundle;
  targetTheme: ResolvedThemeTarget;
  /** 2a multi-asset: full image set to re-inject on reload (or null). */
  imageDataUrls: Record<string, string> | null;
  /** External file paths for lossless 4K/8K wallpaper mode (or null). */
  imageFilePaths?: Record<string, string> | null;
  epoch: number;
  deps: ReloadWatchdogDeps;
  /**
   * Optional session pool. When provided, the watchdog session is acquired
   * from the pool (reusing an existing connection to the same target) and
   * released back on detach. Without a pool a one-shot connect-then-close
   * session is used (backwards-compatible path for callers that don't pass
   * one).
   */
  pool?: CdpSessionPool;
}

interface ReloadWatchdogState {
  options: AttachReloadWatchdogOptions;
  session?: EventCdpSession;
  /** Pool targetKey — needed to release the session back to the pool. */
  targetKey?: string;
  /** Whether the session was acquired from the pool (release) or one-shot (close). */
  pooled?: boolean;
  navHandler?: (params: unknown) => void;
  navTimer?: ReturnType<typeof setTimeout>;
  closed: boolean;
}

/** Long-lived reload watchdogs, keyed by app id (one per themed primary page). */
const watchdogs = new Map<AgentId, ReloadWatchdogState>();

/**
 * Arm a reload watchdog for the primary page target of `appId`. Idempotent:
 * re-attaching with the same epoch refreshes the theme payload; a different
 * epoch first tears down any existing watchdog for the app.
 */
export function attachReloadWatchdog(options: AttachReloadWatchdogOptions): void {
  const { appId } = options;
  if (!options.pageTargetUrl) return;

  const existing = watchdogs.get(appId);
  if (existing) {
    if (existing.options.epoch === options.epoch && existing.session) {
      existing.options = options; // same epoch — just refresh the payload
      return;
    }
    detachReloadWatchdog(appId); // different epoch — reset first
  }

  const state: ReloadWatchdogState = { options, closed: false };
  watchdogs.set(appId, state);
  void openWatchdogSession(state);
}

async function openWatchdogSession(state: ReloadWatchdogState): Promise<void> {
  const { appId, deps, pool } = state.options;
  const targetKey = targetKeyFor(null, state.options.pageTargetUrl);
  let handle: SessionHandle = { session: null, pooled: false };
  try {
    handle = await acquireSession(pool, appId, targetKey, () =>
      connectEventCdp(state.options.pageTargetUrl!),
    );
  } catch (error) {
    deps.log(`[reload-watchdog] ${appId}: open failed: ${toMessage(error)}`);
    return;
  }
  // The pool stores CdpSession, but our open callback created an
  // EventCdpSession — cast so we can subscribe to CDP events (event
  // delegation: the pooled socket is shared, events are dispatched here).
  const session = handle.session as EventCdpSession | null;
  if (!session) {
    deps.log(`[reload-watchdog] ${appId}: open returned no session`);
    return;
  }
  if (state.closed) {
    if (handle.pooled) {
      releaseSession(pool, appId, targetKey);
    } else {
      session.close();
    }
    return;
  }
  state.session = session;
  state.targetKey = targetKey;
  state.pooled = handle.pooled;
  const navHandler = (): void => handleNavigationEvent(state);
  state.navHandler = navHandler;
  session.on('Page.loadEventFired', navHandler);
  try {
    await session.send('Page.enable'); // deliver Page.* events
  } catch {
    // best-effort — some targets already emit without explicit enable.
  }
  deps.log(`[reload-watchdog] ${appId}: armed (observing page reloads)`);
}

function handleNavigationEvent(state: ReloadWatchdogState): void {
  if (state.closed) return;
  if (state.navTimer) clearTimeout(state.navTimer);
  state.navTimer = setTimeout(() => void reverifyAfterNavigation(state), RELOAD_DEBOUNCE_MS);
}

async function reverifyAfterNavigation(state: ReloadWatchdogState): Promise<void> {
  state.navTimer = undefined;
  const { appId, deps } = state.options;
  if (state.closed) return;

  // A newer apply/restore superseded this epoch → disarm (remove→reload stays clean).
  if (!deps.isEpochCurrent(appId, state.options.epoch)) {
    deps.log(`[reload-watchdog] ${appId}: epoch changed, disarming`);
    detachReloadWatchdog(appId);
    return;
  }

  const session = state.session;
  if (!session) return;
  try {
    const verification = await verifyTheme(session);
    if (verification && verification.adoptedSheetCount > 0) {
      deps.log(
        `[reload-watchdog] ${appId}: after reload, engine sheets present ` +
          `(${verification.adoptedSheetCount}) — no re-inject`,
      );
      return; // stay armed for the next navigation
    }
    deps.log(`[reload-watchdog] ${appId}: after reload, engine sheets missing → re-injecting once`);
    const result = await deps.tryEngineInjection(
      session,
      appId,
      state.options.bundle,
      state.options.targetTheme,
      state.options.imageDataUrls,
      state.options.imageFilePaths,
    );
    if (result) {
      deps.log(
        `[reload-watchdog] ${appId}: re-injected layers=${result.layersInjected} ` +
          `adapter=${result.adapterApplied} hero=${result.heroInjected} ` +
          `images=${result.imagesInjected}`,
      );
    } else {
      deps.log(
        `[reload-watchdog] ${appId}: re-inject returned engine-fallback (engine files missing?)`,
      );
    }
  } catch (error) {
    deps.log(`[reload-watchdog] ${appId}: reverify/re-inject failed: ${toMessage(error)}`);
  }
}

/** Tear down the watchdog for `appId` (idempotent). */
export function detachReloadWatchdog(appId: AgentId): void {
  const state = watchdogs.get(appId);
  if (!state) return;
  watchdogs.delete(appId);
  state.closed = true;
  if (state.navTimer) clearTimeout(state.navTimer);
  if (state.session) {
    if (state.navHandler) state.session.off('Page.loadEventFired', state.navHandler);
    if (state.pooled && state.targetKey) {
      // Pooled session: release back to the pool instead of closing.
      releaseSession(state.options.pool, appId, state.targetKey);
    } else {
      try {
        state.session.close();
      } catch {
        // Already closed.
      }
    }
  }
}

/** Dispose every live watchdog (app shutdown). */
export function disposeReloadWatchdogs(): void {
  for (const appId of Array.from(watchdogs.keys())) {
    detachReloadWatchdog(appId);
  }
}

/** Test-only introspection of the currently-armed watchdogs. */
export function getReloadWatchdogKeys(): AgentId[] {
  return Array.from(watchdogs.keys());
}
