// SPDX-License-Identifier: MPL-2.0

/**
 * # App Discovery & Port Resolution
 *
 * Extracted from `AgentEngineService` (P1-2 of the god-object teardown).
 *
 * Owns three concerns that used to live as private methods on the orchestrator:
 *   - {@link reconcileZombiePorts}: clean dead ports from persisted state at boot.
 *   - {@link resolveLivePort}: dynamic CDP port discovery (DevToolsActivePort
 *     + PID/netstat probing). Wraps the shared utility but injects the adapter
 *     + logger so the orchestrator doesn't have to.
 *   - {@link ensureCdpReady}: spawn-or-restart the app with
 *     `--remote-debugging-port=0` when no live CDP port is reachable.
 *   - {@link probeAppStatus}: pure read-only status (installed / running /
 *     debugReady + port + version + path) used by `status()` and `apply()`.
 *   - {@link inferRestartReason}: turn a CDP-ready failure into a user-facing
 *     restart reason without re-running the full discovery chain.
 *
 * Why these go together: all five operate on the adapter's `discover` /
 * `findRunningPids` / `findTargets` APIs and share the same `settings` +
 * `detectionLogFile` plumbing. None of them touch `applyEpoch` or
 * `applyingTheme`, so they form a clean cohesive slice that can be peeled
 * off the god object without taking any cross-cutting state with them.
 *
 * Call chain:
 *   AgentEngineService.initialize → reconcileZombiePorts
 *   AgentEngineService.apply / status → resolveLivePort / ensureCdpReady / probeAppStatus / inferRestartReason
 */

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { probePortLive } from '../legacy/agentskin-core-runtime';
import { resolveLivePort as resolveLivePortShared } from '../shared/cdp-discovery';
import { toMessage } from '../shared/errors';
import type { AgentId, ApplyResponse, AppStatus } from '../shared/types';
import { detectInstallation } from './install-detection';
import type { LogCallback } from './services/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of {@link ensureCdpReady}. When `port` is null, `reason` carries the
 * precise failure cause so {@link inferRestartReason} can map it to a
 * user-facing restart reason instead of re-detecting from scratch.
 */
export type CdpReadyResult =
  | { port: number; reason: null }
  | { port: null; reason: 'not-installed' | 'spawn-error' | 'singleton-lock' | 'timeout' };

/**
 * The slice of the persisted state that this module needs to read/write.
 * Defined as an interface so the orchestrator can pass a thin view of its
 * `PersistedState.apps` map without exposing the full structure.
 */
export interface AppPortState {
  port: number | null;
}

/**
 * Callback the discovery module uses to persist state after mutating it
 * (e.g. clearing a zombie port). The orchestrator wires this to its own
 * `persist()` method.
 */
export type PersistCallback = () => Promise<void>;

/**
 * Re-exported from `services/contracts.ts` so existing call sites keep
 * compiling. New consumers should import `LogCallback` directly from
 * `./services/contracts`.
 */
export type { LogCallback };

/**
 * Structured event sink — usually `AgentEngineService.logStructured`.
 * Used for `cdp_spawn_failed` / `cdp_killing` / `cdp_spawning` / `cdp_ready`
 * / `cdp_timeout` events that drive the UI's progress bar.
 *
 * The `type` union is intentionally narrow (only the events this module
 * emits) so the orchestrator's wider `logStructured` (which accepts these
 * plus `scheme_sync` / `theme_apply` / etc.) is assignable to it via
 * parameter contravariance.
 */
export type StructuredLogCallback = (event: {
  type: 'cdp_spawn_failed' | 'cdp_killing' | 'cdp_spawning' | 'cdp_ready' | 'cdp_timeout';
  agentId: AgentId;
  timestamp: string;
  reason?: string;
  progress?: number;
}) => void;

/**
 * Settings access — a thin interface over `SettingsService.overridesFor()`.
 * Defined here so this module doesn't import the full `SettingsService`.
 */
export interface SettingsAccess {
  /** User override for the executable path (null = use core discovery). */
  appPathFor(appId: AgentId): string | null;
  /** User override for the debug port (null = no override). */
  portOverrideFor(appId: AgentId): number | null;
}

/**
 * Adapter factory — returns the registered {@link ApplicationAdapter} for an
 * agent. Wraps `requireAdapter` so this module doesn't depend on the
 * registry directly (testability).
 */
export type AdapterFactory = (appId: AgentId) => ApplicationAdapter;

/**
 * Read-only access to the persisted active-theme id for an agent — used by
 * {@link probeAppStatus} so the status payload reports which theme is
 * active. Injected because the orchestrator owns the `state` map.
 */
export type ActiveThemeIdAccessor = (appId: AgentId) => string | null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DiscoveryDeps {
  adapter: AdapterFactory;
  settings: SettingsAccess;
  log: LogCallback;
  logStructured: StructuredLogCallback;
  /** Path to the detection report log file (passed to `detectInstallation`). */
  detectionLogFile: string;
  /** Canonical display name per agent (for `detectInstallation`). */
  displayName: (appId: AgentId) => string;
  /** Persisted state accessor: read+mutate the per-app port slot. */
  getAppPort(appId: AgentId): AppPortState | null;
  /** Persisted state mutator: clear a dead port in-place. */
  clearAppPort(appId: AgentId): void;
  /** Persist callback — invoked after `clearAppPort` so changes survive boot. */
  persist: PersistCallback;
  /** Returns the persisted active-theme id (for status payload). */
  activeThemeId: ActiveThemeIdAccessor;
}

// ---------------------------------------------------------------------------
// reconcileZombiePorts
// ---------------------------------------------------------------------------

/**
 * Walk the persisted state and clear any port slot whose port no longer
 * answers `/json/list`. Called once at boot so a stale port file (the app
 * was uninstalled, the port file survived a crash, etc.) doesn't poison
 * status reports.
 *
 * Active-theme references are preserved so the UI still shows "themed" and
 * the user can re-apply with one click.
 *
 * Callers pass the agent ids to visit (typically `AGENT_IDS`) so this
 * module doesn't need to import the shared types list directly.
 */
export async function reconcileZombiePorts(
  appIds: readonly AgentId[],
  deps: DiscoveryDeps,
): Promise<void> {
  let dirty = false;
  for (const appId of appIds) {
    const appState = deps.getAppPort(appId);
    if (appState?.port != null) {
      const live = await probePortLive(appState.port, 1500);
      if (!live) {
        deps.log(
          `[state] ${appId}: port ${appState.port} is dead — clearing stale port (activeThemeId preserved for re-injection)`,
        );
        deps.clearAppPort(appId);
        dirty = true;
      }
    }
  }
  if (dirty) await deps.persist();
}

// ---------------------------------------------------------------------------
// resolveLivePort
// ---------------------------------------------------------------------------

/**
 * Discover the live CDP port for an app without trusting any hardcoded
 * "default port" (the 9336/9337/9338 assumptions are stale — WorkBuddy 5.3.x
 * binds a random port, QoderWork forces port=0, TRAE SOLO only opens CDP
 * when explicitly launched with `--remote-debugging-port`).
 *
 * `knownDeadPort` is purely a filter: if the caller already knows a port is
 * dead (e.g. a zombie override, or the port=0 we just spawned), passing it
 * here skips re-probing that one port. It is never probed itself.
 *
 * Discovery layers (delegated to the shared utility):
 *   1. DevToolsActivePort files (may point at an ephemeral port).
 *   2. PID → command line → /json/list (fast path for apps whose launcher
 *      writes `--remote-debugging-port=N` into argv).
 *   3. PID → netstat → /json/list (catches port=0 apps where Chromium
 *      picks the port itself and argv has no usable value).
 *
 * Returns null if no live CDP endpoint is reachable.
 */
export async function resolveLivePort(
  appId: AgentId,
  deps: DiscoveryDeps,
  knownDeadPort: number | null = null,
): Promise<number | null> {
  return resolveLivePortShared(deps.adapter(appId), appId, deps.log.bind(null), knownDeadPort);
}

// ---------------------------------------------------------------------------
// ensureCdpReady
// ---------------------------------------------------------------------------

/**
 * Ensure the target app has a live CDP endpoint, (re)starting it with
 * `--remote-debugging-port=0` on the command line when no debug port is
 * currently open. Chromium then picks a free random port itself; we
 * discover it via {@link resolveLivePort} (netstat layer). Returns the live
 * port, or null if the app couldn't be (re)launched within the timeout.
 *
 * This is invoked from `apply` (with the user's explicit restart
 * confirmation) so AgentSkin never restarts an app outside of an explicit
 * apply request.
 */
export async function ensureCdpReady(
  appId: AgentId,
  deps: DiscoveryDeps,
  timeoutMs = 30000,
): Promise<CdpReadyResult> {
  // Fast path: CDP already live.
  const live = await resolveLivePort(appId, deps);
  if (live != null) return { port: live, reason: null };

  const adapter = deps.adapter(appId);
  const appPathOverride = deps.settings.appPathFor(appId);

  // Resolve the executable path. Prefer the user override, then core
  // discovery; both can fail if the app was uninstalled/moved.
  let exePath: string | null = appPathOverride;
  if (!exePath) {
    try {
      const discovered = await adapter.discover(process.platform, null);
      exePath = discovered?.executable ?? discovered?.appPath ?? null;
    } catch {
      exePath = null;
    }
  }
  if (!exePath) {
    deps.log(`[ensure-cdp] ${appId}: executable not found, cannot restart`);
    deps.logStructured({
      type: 'cdp_spawn_failed',
      agentId: appId,
      reason: 'not-installed',
      timestamp: new Date().toISOString(),
    });
    return { port: null, reason: 'not-installed' };
  }

  // Stop any running instances so we don't end up with two copies. Kill by
  // PID (not /IM basename) so we never accidentally hit another product
  // with the same exe name (e.g. TRAE SOLO vs TRAE SOLO CN) — core's
  // findRunningPids already filters by the adapter's processNames.
  let killedPids: number[] = [];
  try {
    killedPids = await adapter.findRunningPids(process.platform, exePath);
  } catch {
    killedPids = [];
  }
  deps.log(
    `[ensure-cdp] ${appId}: CDP off -> restarting ${exePath} with random debug port (killing ${killedPids.length} PID(s))`,
  );
  if (killedPids.length > 0) {
    deps.logStructured({
      type: 'cdp_killing',
      agentId: appId,
      timestamp: new Date().toISOString(),
      progress: 15,
    });
  }
  for (const pid of killedPids) {
    try {
      await new Promise<void>((resolve) => {
        execFile(
          'taskkill',
          ['/F', '/T', '/PID', String(pid)],
          { windowsHide: true, timeout: 5000 },
          () => resolve(),
        );
      });
    } catch {
      // Not running or already gone — fine.
    }
  }
  // Give Windows time to release the process table + any singleton lock
  // file the app holds. 800ms is enough on a warm machine.
  await new Promise((resolve) => setTimeout(resolve, 800));

  // Pass --remote-debugging-port=0 directly on the command line: Chromium
  // picks a free port itself, avoiding collisions across the three apps.
  // (ELECTRON_EXTRA_LAUNCH_ARGS was tested and does NOT work for these
  // packaged Electron apps — the env var is silently ignored.)
  //
  // cwd is set to the exe directory so VS Code-fork apps (TRAE SOLO CN)
  // can resolve their relative `resources/app` path the same way they do
  // when launched normally.
  let childPid = -1;
  try {
    const child = spawn(
      exePath,
      ['--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1'],
      {
        detached: true,
        stdio: 'ignore',
        cwd: path.dirname(exePath),
      },
    );
    child.unref();
    childPid = child.pid ?? -1;
    deps.logStructured({
      type: 'cdp_spawning',
      agentId: appId,
      timestamp: new Date().toISOString(),
      progress: 25,
    });
  } catch (error) {
    deps.log(`[ensure-cdp] ${appId}: failed to launch: ${toMessage(error)}`);
    deps.logStructured({
      type: 'cdp_spawn_failed',
      agentId: appId,
      reason: `spawn-error: ${toMessage(error)}`,
      timestamp: new Date().toISOString(),
    });
    return { port: null, reason: 'spawn-error' };
  }

  // Poll resolveLivePort until Chromium opens the random CDP port. The app
  // needs time to boot (Electron init + window creation); 30s covers slow
  // machines. Because we spawned with port=0, the argv fast path in
  // resolveLivePort will miss (port=0 is filtered out), so discovery
  // relies on the netstat layer.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Detect early exit: if the spawned child is gone, the launch failed
    // (singleton lock, missing dependency, sandbox rejection). Bail out
    // instead of polling for the full 30s.
    if (childPid > 0) {
      try {
        process.kill(childPid, 0);
      } catch {
        // Child already exited. One last resolveLivePort in case the app
        // forwarded args to a pre-existing singleton and that one opened
        // CDP — otherwise give up.
        const lastChance = await resolveLivePort(appId, deps);
        if (lastChance != null) {
          deps.log(
            `[ensure-cdp] ${appId}: CDP up on random port ${lastChance} (via forwarded singleton)`,
          );
          deps.logStructured({
            type: 'cdp_ready',
            agentId: appId,
            timestamp: new Date().toISOString(),
            progress: 50,
          });
          return { port: lastChance, reason: null };
        }
        deps.log(
          `[ensure-cdp] ${appId}: spawned process exited immediately (singleton lock or launch failure)`,
        );
        deps.logStructured({
          type: 'cdp_spawn_failed',
          agentId: appId,
          reason: 'singleton-lock',
          timestamp: new Date().toISOString(),
        });
        return { port: null, reason: 'singleton-lock' };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
    const port = await resolveLivePort(appId, deps);
    if (port != null) {
      deps.log(`[ensure-cdp] ${appId}: CDP up on random port ${port}`);
      deps.logStructured({
        type: 'cdp_ready',
        agentId: appId,
        timestamp: new Date().toISOString(),
        progress: 50,
      });
      return { port, reason: null };
    }
  }
  deps.log(`[ensure-cdp] ${appId}: timed out waiting for CDP after restart`);
  deps.logStructured({
    type: 'cdp_timeout',
    agentId: appId,
    timestamp: new Date().toISOString(),
  });
  return { port: null, reason: 'timeout' };
}

// ---------------------------------------------------------------------------
// probeAppStatus
// ---------------------------------------------------------------------------

/**
 * Build a read-only {@link AppStatus} snapshot for an agent. Pure query —
 * no state mutation, no applyEpoch interaction. Used by `status()` and
 * `apply()` (the latter via `inferRestartReason`).
 *
 * Steps:
 *   1. Discover install (core discovery + AgentSkin-side path/registry probe).
 *   2. If installed, check if running (via `findRunningPids`).
 *   3. If running, resolve the live CDP port and probe `findTargets` to
 *      populate `debugReady`.
 *
 * Any stale persisted port is discarded here so the UI never reports a
 * zombie port.
 */
export async function probeAppStatus(
  appId: AgentId,
  deps: DiscoveryDeps,
  portFor: (appId: AgentId) => number | null,
): Promise<AppStatus> {
  const adapter = deps.adapter(appId);
  let port: number | null = portFor(appId);
  const appPathOverride = deps.settings.appPathFor(appId);
  let discovered: Awaited<ReturnType<typeof adapter.discover>> = null;
  let running = false;
  let debugReady = false;
  try {
    discovered = await adapter.discover(process.platform, appPathOverride);
  } catch {
    discovered = null;
  }
  const coreInstalled = Boolean(discovered);

  // AgentSkin-side install detection (paths + Uninstall registry). Merges
  // with core discovery so a closed-but-installed app is still reported.
  const probe = await detectInstallation({
    platform: process.platform,
    appPath: appPathOverride,
    hints: adapter.installHints,
    displayName: deps.displayName(appId),
    logFile: deps.detectionLogFile,
  });
  const installed = coreInstalled || probe.installed;

  if (installed) {
    try {
      running =
        (await adapter.findRunningPids(process.platform, discovered?.executable ?? null)).length >
        0;
    } catch {
      running = false;
    }
  }
  if (running) {
    const livePort = await resolveLivePort(appId, deps);
    if (livePort != null) {
      port = livePort;
      try {
        debugReady = (await adapter.findTargets(port, 1200)).length > 0;
      } catch {
        debugReady = false;
      }
    } else {
      // App is running but no live CDP port found. Discard any stale port
      // from the persisted state so the UI never reports a zombie port.
      port = null;
    }
  }

  return {
    appId,
    displayName: deps.displayName(appId),
    installed,
    running,
    debugReady,
    port,
    activeThemeId: deps.activeThemeId(appId),
    version: probe.version ?? null,
    path: probe.path ?? discovered?.appPath ?? discovered?.executable ?? null,
  };
}

// ---------------------------------------------------------------------------
// inferRestartReason
// ---------------------------------------------------------------------------

/**
 * Turn a {@link CdpReadyResult} `reason` (or its absence) into the
 * user-facing `restartReason` carried by {@link ApplyResponse}.
 *
 * If `ensureCdpReady` already gave us a precise cause, map it directly
 * (cheap path — no re-detection). Otherwise fall back to a full
 * discovery pass to distinguish:
 *   - Not installed                → 'not-installed'
 *   - Installed but not running    → 'not-running'
 *   - Running, no CDP              → 'no-cdp'
 */
export async function inferRestartReason(
  appId: AgentId,
  deps: DiscoveryDeps,
  cdpFailureReason: CdpReadyResult['reason'] = null,
): Promise<NonNullable<ApplyResponse['restartReason']>> {
  // ensureCdpReady gave us a precise cause — map it directly.
  if (cdpFailureReason) {
    switch (cdpFailureReason) {
      case 'not-installed':
        return 'not-installed';
      case 'singleton-lock':
        return 'singleton-lock';
      case 'spawn-error':
        return 'spawn-failed';
      case 'timeout':
        return 'cdp-timeout';
    }
  }
  try {
    const adapter = deps.adapter(appId);
    const appPathOverride = deps.settings.appPathFor(appId);
    let discovered: Awaited<ReturnType<typeof adapter.discover>> = null;
    try {
      discovered = await adapter.discover(process.platform, appPathOverride);
    } catch {
      discovered = null;
    }
    const probe = await detectInstallation({
      platform: process.platform,
      appPath: appPathOverride,
      hints: adapter.installHints,
      displayName: deps.displayName(appId),
      logFile: deps.detectionLogFile,
    });
    const installed = Boolean(discovered) || probe.installed;
    if (!installed) return 'not-installed';

    let running = false;
    try {
      running =
        (await adapter.findRunningPids(process.platform, discovered?.executable ?? null)).length >
        0;
    } catch {
      running = false;
    }

    if (!running) return 'not-running';
    return 'no-cdp';
  } catch {
    // Detection itself failed — fall back to the generic 'no-cdp' reason.
    return 'no-cdp';
  }
}
