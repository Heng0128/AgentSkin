// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentEngine Delegated Operations (Facade Delegates)
 *
 * Extracted from `AgentEngineService` (P1-6 of the god-object teardown).
 *
 * Each function below wraps a one-liner delegation from the orchestrator
 * (`AgentEngineService`) into the corresponding impl module, threading the
 * required `*Deps` slice through. The orchestrator owns the deps-factory
 * methods (which need private state access); this module owns only the
 * delegation wrappers and one function (`withPageSession`) that contains
 * real logic that does not belong to any impl module.
 *
 * Splitting rationale: without this file the ~15 delegating private methods
 * and their ~6 deps factories bloat the facade by ~240 lines of thin
 * delegation plumbing. Centralising them here lets the facade focus on
 * state ownership, epoch management, the apply/restore top-level
 * orchestration, and the public API surface.
 *
 * This module MUST NOT import the orchestrator itself — it only depends on
 * impl modules' public APIs and their functional `*Deps` interfaces.
 *
 * ## Test mock compatibility
 *
 * The test suite mocks `./app-discovery`, `./wallpaper-injector`, and other
 * impl modules from the test file's location. Because vitest resolves mocks by
 * absolute file path (not by import specifier string), the relative paths
 * used here (e.g. `../app-discovery`) resolve to the same module as the test's
 * `./app-discovery`, so the mocks transparently apply.
 */

import type { ApplicationAdapter } from '../../adapters/base';
import type { ResolvedThemeTarget, ThemeBundle } from '../../legacy/agentskin-core-runtime';
import type { AgentId, ApplyResponse, AppStatus } from '../../shared/types';
import type { SchemeMode, SchemeSnapshot } from '../agent-scheme';
import {
  type CdpReadyResult,
  type DiscoveryDeps,
  ensureCdpReady as ensureCdpReadyImpl,
  inferRestartReason as inferRestartReasonImpl,
  probeAppStatus as probeAppStatusImpl,
  reconcileZombiePorts as reconcileZombiePortsImpl,
  resolveLivePort as resolveLivePortImpl,
} from '../app-discovery';
import { type CdpSession, connectCdp } from '../cdp/cdp-client';
import {
  type CdpFanoutDeps,
  hardeningPass as hardeningPassImpl,
  hardeningRemove as hardeningRemoveImpl,
} from '../cdp/cdp-fanout';
import type { InjectEngineResult } from '../cdp/cdp-inject';
import { pickPageTarget } from '../cdp/cdp-targets';
import type { EngineInjectionDeps } from '../palette-builder';
import { tryEngineInjection as tryEngineInjectionImpl } from '../palette-builder';
import {
  restoreOriginalScheme as restoreOriginalSchemeImpl,
  type SchemeSyncDeps,
  syncSchemeWithStability as syncSchemeWithStabilityImpl,
} from '../scheme-sync';
import type { ThemeEntry } from '../theme-library';
import {
  injectAgentWallpaperFromApply as injectAgentWallpaperFromApplyImpl,
  removeAgentVideoWallpaper as removeAgentVideoWallpaperImpl,
  type WallpaperInjectorDeps,
} from '../wallpaper-injector';

// ---------------------------------------------------------------------------
// withPageSession — non-delegated (owns real logic)
// ---------------------------------------------------------------------------

/**
 * Dependencies for {@link withPageSession}. The function does not map onto any
 * single impl module (it is a generic CDP retry loop) so it carries its own
 * minimal deps instead of reusing one of the `*Deps` slices.
 */
export interface WithPageSessionDeps {
  /** Resolve the adapter for an app (from the registry). */
  adapter: (appId: AgentId) => ApplicationAdapter;
  /** Re-resolve the live CDP port for an app (used between retry rounds). */
  resolveLivePort: (appId: AgentId, knownDeadPort?: number | null) => Promise<number | null>;
}

/**
 * Open a CDP session against the app's main page target and run `fn` with
 * it, always closing the socket afterwards. Best-effort: retries for a short
 * window because the app may have just been (re)launched by `applyTheme` and
 * its renderer / CDP endpoint is not ready yet.
 *
 * Extracted verbatim from `AgentEngineService.withPageSession` (P1-6) — this
 * is the one function in this module that contains real logic rather than
 * forwarding to an impl.
 */
export async function withPageSession(
  appId: AgentId,
  _port: number,
  fn: (session: CdpSession) => Promise<void>,
  retries: number,
  deps: WithPageSessionDeps,
): Promise<void> {
  const adapter = deps.adapter(appId);
  let lastError: Error | null = null;
  // Cache the resolved port across retries. Previously every retry called
  // resolveLivePort again (DevToolsActivePort file read + PID/netstat
  // probing), wasting IO when the port does not change between attempts.
  // The port is only re-resolved when the cached port fails to yield
  // targets (app may have restarted and bound a new port).
  let cachedPort: number | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    // First attempt or previous port yielded no targets → re-resolve.
    if (cachedPort == null) {
      cachedPort = await deps.resolveLivePort(appId);
    }
    if (cachedPort == null) {
      // No live CDP port yet (app still booting / not debug-enabled) — wait
      // and retry. Reset cachedPort so the next iteration re-resolves.
      lastError = new Error('no live CDP port');
      cachedPort = null;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    let targets: Awaited<ReturnType<typeof adapter.findTargets>> = [];
    try {
      targets = await adapter.findTargets(cachedPort, 1200);
    } catch (error) {
      lastError = error as Error;
      // Port may be stale (app restarted) → force re-resolve on next attempt.
      cachedPort = null;
    }
    const page = pickPageTarget(targets);
    if (page) {
      const session = await connectCdp(page.webSocketDebuggerUrl);
      try {
        await fn(session);
        return;
      } finally {
        session.close();
      }
    }
    lastError = new Error('no reachable page target');
    // Renderer not ready yet (fresh launch / restart) — wait and retry.
    // Keep cachedPort: the app is still launching, the port is likely the
    // same, just the renderer has not registered targets yet.
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error('no reachable page target');
}

// ---------------------------------------------------------------------------
// Discovery operations
// ---------------------------------------------------------------------------

/** Forward to {@link reconcileZombiePortsImpl} — see app-discovery.ts. */
export async function reconcileZombiePorts(
  appIds: readonly AgentId[],
  deps: DiscoveryDeps,
): Promise<void> {
  return reconcileZombiePortsImpl(appIds, deps);
}

/** Forward to {@link resolveLivePortImpl} — see app-discovery.ts. */
export async function resolveLivePort(
  appId: AgentId,
  deps: DiscoveryDeps,
  knownDeadPort: number | null = null,
): Promise<number | null> {
  return resolveLivePortImpl(appId, deps, knownDeadPort);
}

/** Forward to {@link ensureCdpReadyImpl} — see app-discovery.ts. */
export async function ensureCdpReady(
  appId: AgentId,
  deps: DiscoveryDeps,
  timeoutMs = 30000,
  forceRestart = false,
): Promise<CdpReadyResult> {
  return ensureCdpReadyImpl(appId, deps, timeoutMs, forceRestart);
}

/** Forward to {@link probeAppStatusImpl} — see app-discovery.ts. */
export async function probeAppStatus(
  appId: AgentId,
  deps: DiscoveryDeps,
  portFor: (appId: AgentId) => number | null,
): Promise<AppStatus> {
  return probeAppStatusImpl(appId, deps, portFor);
}

/** Forward to {@link inferRestartReasonImpl} — see app-discovery.ts. */
export async function inferRestartReason(
  appId: AgentId,
  deps: DiscoveryDeps,
  cdpFailureReason: CdpReadyResult['reason'] = null,
): Promise<NonNullable<ApplyResponse['restartReason']>> {
  return inferRestartReasonImpl(appId, deps, cdpFailureReason);
}

// ---------------------------------------------------------------------------
// Scheme sync operations
// ---------------------------------------------------------------------------

/** Forward to {@link syncSchemeWithStabilityImpl} — see scheme-sync.ts. */
export async function syncSchemeWithStability(
  appId: AgentId,
  port: number,
  mode: SchemeMode,
  epoch: number,
  deps: SchemeSyncDeps,
): Promise<void> {
  return syncSchemeWithStabilityImpl(appId, port, mode, epoch, deps);
}

/** Forward to {@link restoreOriginalSchemeImpl} — see scheme-sync.ts. */
export async function restoreOriginalScheme(
  appId: AgentId,
  port: number,
  snapshot: SchemeSnapshot,
  epoch: number,
  deps: SchemeSyncDeps,
): Promise<void> {
  return restoreOriginalSchemeImpl(appId, port, snapshot, epoch, deps);
}

// ---------------------------------------------------------------------------
// CDP fan-out operations
// ---------------------------------------------------------------------------

/** Forward to {@link hardeningPassImpl} — see cdp-fanout.ts. */
export async function hardeningPass(
  appId: AgentId,
  port: number,
  bundle: ThemeBundle,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  return hardeningPassImpl(appId, port, bundle, epoch, deps);
}

/** Forward to {@link hardeningRemoveImpl} — see cdp-fanout.ts. */
export async function hardeningRemove(
  appId: AgentId,
  port: number,
  epoch: number,
  deps: CdpFanoutDeps,
): Promise<void> {
  return hardeningRemoveImpl(appId, port, epoch, deps);
}

// ---------------------------------------------------------------------------
// Engine injection
// ---------------------------------------------------------------------------

/** Forward to {@link tryEngineInjectionImpl} — see palette-builder.ts. */
export async function tryEngineInjection(
  session: CdpSession,
  appId: AgentId,
  bundle: ThemeBundle,
  targetTheme: ResolvedThemeTarget,
  imageDataUrls: Record<string, string> | null,
  deps: EngineInjectionDeps,
): Promise<InjectEngineResult | null> {
  return tryEngineInjectionImpl(session, appId, bundle, targetTheme, imageDataUrls, deps);
}

// ---------------------------------------------------------------------------
// Wallpaper injection
// ---------------------------------------------------------------------------

/** Forward to {@link injectAgentWallpaperFromApplyImpl} — see wallpaper-injector.ts. */
export async function injectAgentWallpaperFromApply(
  appId: AgentId,
  port: number,
  entry: ThemeEntry,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<void> {
  return injectAgentWallpaperFromApplyImpl(appId, port, entry, epoch, deps);
}

/** Forward to {@link removeAgentVideoWallpaperImpl} — see wallpaper-injector.ts. */
export async function removeAgentVideoWallpaper(
  appId: AgentId,
  port: number,
  epoch: number,
  deps: WallpaperInjectorDeps,
): Promise<void> {
  return removeAgentVideoWallpaperImpl(appId, port, epoch, deps);
}
