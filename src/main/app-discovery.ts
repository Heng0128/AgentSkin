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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApplicationAdapter } from '../adapters/base';
import { probePortLive } from '../legacy/agentskin-core-runtime';
import { resolveLivePort as resolveLivePortShared } from '../shared/cdp-discovery';
import { toMessage } from '../shared/errors';
import type { AgentId, ApplyResponse, AppStatus } from '../shared/types';
import { detectInstallation, verifyInstallPath } from './install-detection';
import type { LogCallback } from './services/contracts';
import { PerformanceRecorder } from './services/performance';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * After a full live-port discovery fails for an app (running but no CDP),
 * back off before re-running the whole chain. `status()` is polled every few
 * seconds (2s TTL on the renderer side), and a CDP-less app (e.g. WorkBuddy
 * launched without --remote-debugging-port, which leaves a stale
 * DevToolsActivePort file behind) would otherwise re-run tasklist + argv
 * parsing + netstat + HTTP probes every poll and emit 3 log lines each time.
 *
 * Deliberately applied ONLY in `probeAppStatus` (the status polling path).
 * Apply/restart flows (`ensureCdpReady`, `theme-apply-flow`) resolve the port
 * decisively and MUST NOT be affected by this backoff.
 */
const NEGATIVE_PORT_BACKOFF_MS = 5000;
const negativePortBackoffUntil = new Map<string, number>();

/**
 * Result of {@link ensureCdpReady}. When `port` is null, `reason` carries the
 * precise failure cause so {@link inferRestartReason} can map it to a
 * user-facing restart reason instead of re-detecting from scratch.
 */
export type CdpReadyResult =
  | { port: number; reason: null }
  | {
      port: null;
      reason:
        | 'not-installed'
        | 'spawn-error'
        | 'singleton-lock'
        | 'kill-denied'
        | 'timeout'
        | 'no-cdp';
    };

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
// Singleton lock cleanup
// ---------------------------------------------------------------------------

/**
 * Electron singleton lock files left behind when an app is killed via
 * `taskkill /F` (which bypasses the graceful `app.quit()` path that would
 * normally clean them up). Each maps an AgentId to the known userData
 * directories where Electron's `requestSingleInstanceLock()` creates
 * `SingletonLock`, `SingletonCookie`, and `SingletonSocket`.
 *
 * WorkBuddy is special: its userData dir is under `%USERPROFILE%\.workbuddy\`
 * (not `%APPDATA%`), and 5.3.x moved the session dir into a `session/`
 * subdirectory. The other three agents follow the standard Electron
 * `%APPDATA%\{appName}\` layout.
 */
const SINGLETON_LOCK_DIRS: Record<AgentId, string[]> = (() => {
  const home = process.env.USERPROFILE ?? os.homedir();
  const appdata = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  return {
    workbuddy: [
      path.join(home, '.workbuddy', 'app', 'session'),
      path.join(home, '.workbuddy', 'app'),
      path.join(home, 'AppData', 'Local', 'WorkBuddy'),
      path.join(home, 'AppData', 'Roaming', 'WorkBuddy'),
    ],
    // TRAE SOLO: userData dir is `%APPDATA%\TRAE SOLO\` or `%APPDATA%\TRAE SOLO CN\`
    // (devToolsActivePortFile declared in engines/traework/adapter.mjs)
    traework: [path.join(appdata, 'TRAE SOLO'), path.join(appdata, 'TRAE SOLO CN')],
    // QoderWork: userData dir is `%APPDATA%\QoderWork\` or `%APPDATA%\QoderWork CN\`
    qoderwork: [path.join(appdata, 'QoderWork'), path.join(appdata, 'QoderWork CN')],
    doubao: [path.join(appdata, 'doubao'), path.join(appdata, 'Doubao')],
    codex: [path.join(appdata, 'ChatGPT'), path.join(appdata, 'Codex')],
    zcode: [path.join(appdata, 'ZCode', 'session'), path.join(appdata, 'ZCode')],
  };
})();

/**
 * Delete stale Electron singleton lock files for an agent.
 *
 * Called after `taskkill /F` and before `spawn`. Without this, the freshly
 * spawned process sees the stale lock (left behind by the force-killed
 * previous instance) and exits immediately with "singleton lock or launch
 * failure" — which was the root cause of WorkBuddy never being able to
 * restart with CDP.
 *
 * Best-effort: file deletion failures are logged but never thrown. On
 * Windows, a file that is still open by a dying process can return EBUSY;
 * the 2500ms wait after this function gives the OS time to release the
 * handle, and the spawn poll loop will still try to discover a port.
 */
function cleanSingletonLockFiles(appId: AgentId, log: (line: string) => void): void {
  const dirs = SINGLETON_LOCK_DIRS[appId] ?? [];
  // WorkBuddy 5.3.x uses 'lockfile' instead of the standard Electron
  // SingletonLock/SingletonCookie/SingletonSocket trio.
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  let cleaned = 0;
  for (const dir of dirs) {
    for (const name of lockFiles) {
      const file = path.join(dir, name);
      try {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          cleaned++;
        }
      } catch {
        // File may be locked by the dying process — the 2500ms wait
        // after this gives the OS time to release the handle.
      }
    }
  }
  if (cleaned > 0) {
    log(`[ensure-cdp] ${appId}: cleaned ${cleaned} stale singleton lock file(s)`);
  }
}

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
  /** Cached auto-detected install dir for an agent (null = not yet detected). */
  getDetectedPath: (appId: AgentId) => string | null;
  /** Cache the auto-detected install dir for an agent (null clears it). */
  setDetectedPath: (appId: AgentId, path: string | null) => void;
  /** Returns the persisted active-theme id (for status payload). */
  activeThemeId: ActiveThemeIdAccessor;
  /** Returns the persisted active color-scheme id (for status payload). */
  activeSchemeId: (appId: AgentId) => string | null;
  /** Per-agent live-port cache (RFC §4.2) — 30s TTL, invalidated on epoch bump. */
  livePortCache: LivePortCache;
}

// ---------------------------------------------------------------------------
// LivePortCache (RFC §4.2)
// ---------------------------------------------------------------------------

/**
 * Per-agent cache of the last-confirmed-live CDP port, TTL 30s.
 *
 * Why this cache: applying a theme re-runs `resolveLivePort` several times
 * (cdp-ready probe, apply-time port re-resolve, withPageSession retries, and
 * the 3s status() poll). Each miss re-runs the full discovery chain
 * (DevToolsActivePort files + wmic process snapshot + netstat), which spawns
 * child processes (0.5–2s each). A CDP port, once bound, rarely changes
 * within seconds, so a 30s TTL collapses those repeated full discoveries
 * into a single cheap TCP probe per poll.
 *
 * Placed in app-discovery.ts (main side) rather than shared/cdp-discovery.ts
 * per RFC §4.2 — the shared module is imported by src/legacy/ and must not
 * accumulate main-only state. The existing PID/netstat/process snapshots in
 * shared keep their 1.5s TTL (port bindings change fast during startup); this
 * layer caches the *resolved* port, which is stable.
 *
 * Invalidation (all handled by the orchestrator):
 *   - {@link AgentEngineService.bumpEpoch} → `clear` (a new apply/restore).
 *   - `resolveLivePort` probe failure → `clear` (stale entry).
 *   - {@link reconcileZombiePorts} hit → `clear` (discovered dead port).
 */
export class LivePortCache {
  private static readonly TTL_MS = 30_000;
  private readonly entries = new Map<AgentId, { port: number; capturedAt: number }>();

  /** Cached live port if present and not expired, else null. */
  get(appId: AgentId): number | null {
    const entry = this.entries.get(appId);
    if (!entry) return null;
    if (Date.now() - entry.capturedAt >= LivePortCache.TTL_MS) {
      this.entries.delete(appId);
      return null;
    }
    return entry.port;
  }

  /** Store a freshly-confirmed live port. */
  set(appId: AgentId, port: number): void {
    this.entries.set(appId, { port, capturedAt: Date.now() });
  }

  /** Drop the cached entry for an agent (epoch bump / zombie / probe fail). */
  clear(appId: AgentId): void {
    this.entries.delete(appId);
  }

  /** Drop every cached entry (service dispose). */
  clearAll(): void {
    this.entries.clear();
  }

  /** Number of live entries — surfaced for diagnostics/tests. */
  size(): number {
    return this.entries.size;
  }
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
  // Probe all persisted ports in parallel — each probePortLive has a 1.5s
  // timeout, so probing 4 agents sequentially could block startup for up to
  // 6s when all ports are dead (common after a reboot). Parallelizing
  // collapses that to a single 1.5s window regardless of agent count.
  const probes = appIds.map(async (appId) => {
    const appState = deps.getAppPort(appId);
    if (appState?.port == null) return null;
    const live = await probePortLive(appState.port, 1500);
    return { appId, port: appState.port, live };
  });
  const results = (await Promise.all(probes)).filter(
    (r): r is { appId: AgentId; port: number; live: boolean } => r !== null,
  );

  let dirty = false;
  for (const { appId, port, live } of results) {
    if (!live) {
      deps.log(
        `[state] ${appId}: port ${port} is dead — clearing stale port (activeThemeId preserved for re-injection)`,
      );
      deps.clearAppPort(appId);
      // A probed-dead port must not hide behind the 30s live-port cache.
      deps.livePortCache.clear(appId);
      dirty = true;
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
  options: { bypassCache?: boolean } = {},
): Promise<number | null> {
  const { bypassCache = false } = options;

  // Fast path: a recently-confirmed live port (30s TTL). A bound CDP port
  // rarely changes within seconds, so reusing it avoids re-running the full
  // discovery chain (DevToolsActivePort + wmic + netstat) on every apply
  // sub-step and status() poll. The cached port is re-verified with a cheap
  // TCP probe before returning — if it went dead, clear it and fall through
  // to full discovery (RFC §4.2).
  if (!bypassCache) {
    const cached = deps.livePortCache.get(appId);
    if (cached != null && cached !== knownDeadPort) {
      if (await probePortLive(cached, 300)) {
        deps.log(`[port] ${appId}: live-port cache hit — CDP on ${cached}`);
        return cached;
      }
      deps.log(`[port] ${appId}: cached port ${cached} dead — clearing + full discovery`);
      deps.livePortCache.clear(appId);
    }
  }

  const port = await resolveLivePortShared(
    deps.adapter(appId),
    appId,
    deps.log.bind(null),
    knownDeadPort,
    options,
  );
  // Cache a confirmed-live port so subsequent resolves within the TTL window
  // skip the child-process discovery chain entirely.
  if (port != null) deps.livePortCache.set(appId, port);
  return port;
}

// ---------------------------------------------------------------------------
// ensureCdpReady
// ---------------------------------------------------------------------------

/**
 * Fast probe for a freshly-spawned app's CDP port. After `spawn(...)` with
 * `--remote-debugging-port=0`, Chromium writes DevToolsActivePort quickly (in
 * the boot stage, before the renderer window is ready), so the port file is
 * the fastest reliable signal. This helper reads the file candidates and does
 * a cheap live check — no PID/wmic/netstat chain — so the spawn-wait loop can
 * return as soon as the port is bound instead of re-running the full
 * `resolveLivePort` discovery every 600ms.
 *
 * Returns the live CDP port, or null if no file port answers yet.
 */
async function probeFreshlySpawnedPort(
  adapter: ApplicationAdapter,
  _log: (line: string) => void,
): Promise<number | null> {
  let filePorts: number[] = [];
  try {
    filePorts = await adapter.resolveDebugPorts(process.platform);
  } catch {
    return null;
  }
  for (const port of filePorts) {
    // Dead port file (stale copy) — skip fast.
    if (!(await probePortLive(port, 300))) continue;
    try {
      // A bound CDP port that answers /json/list is instantly usable, even
      // before the renderer fully mounts. Short timeout: a real CDP endpoint
      // responds in well under 100ms.
      if ((await adapter.findTargets(port, 800)).length) return port;
    } catch {
      // Not serving CDP yet — try the next candidate.
    }
  }
  return null;
}

/**
 * Ensure the target app has a live CDP endpoint, (re)starting it with
 * `--remote-debugging-port=0` on the command line when no debug port is
 * currently open. Chromium then picks a free random port itself; we
 * discover it via {@link resolveLivePort} (netstat layer). Returns the live
 * port, or null if the app couldn't be (re)launched within the timeout.
 *
 * `forceRestart` (RFC §4.9) replaces the implicit "always kill + relaunch"
 * convention. Callers MUST NOT kill a running app without explicit user
 * confirmation:
 *   - `forceRestart=false` (default): only launch a NOT-running app. If the
 *     app is running but without a debug port, return `{ port: null,
 *     reason: 'no-cdp' }` WITHOUT killing it, so the caller can surface the
 *     restart dialog.
 *   - `forceRestart=true`: kill any running instances, then relaunch with CDP
 *     (the previous behavior). Only set after the user confirms a restart.
 *
 * This is invoked from `apply` (with the user's explicit restart
 * confirmation) so AgentSkin never restarts an app outside of an explicit
 * apply request.
 */
export async function ensureCdpReady(
  appId: AgentId,
  deps: DiscoveryDeps,
  timeoutMs = 30000,
  forceRestart = false,
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
    } catch (error) {
      deps.log(`[ensure-cdp] ${appId}: adapter.discover failed — ${toMessage(error)}`);
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
  } catch (error) {
    deps.log(`[ensure-cdp] ${appId}: findRunningPids failed — ${toMessage(error)}`);
    killedPids = [];
  }

  // RFC §4.9: without forceRestart we must NOT kill a running app — if it is
  // alive but CDP-less, return 'no-cdp' so the caller can ask the user to
  // confirm the restart. Only a genuinely idle (not-running) app is launched.
  if (!forceRestart && killedPids.length > 0) {
    deps.log(`[ensure-cdp] ${appId}: running without CDP — refusing to kill (forceRestart=false)`);
    return { port: null, reason: 'no-cdp' };
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
  // Track kills that failed because the process is still running (e.g. the
  // app was launched elevated / as admin, so taskkill is denied). A stale
  // process that survives the kill will block the fresh spawn via the
  // singleton lock, so we must surface this instead of silently continuing.
  let killDenied = false;
  for (const pid of killedPids) {
    try {
      await new Promise<void>((resolve) => {
        execFile(
          'taskkill',
          ['/F', '/T', '/PID', String(pid)],
          { windowsHide: true, timeout: 5000 },
          (error) => {
            if (error) {
              // taskkill failed. Distinguish "already gone" (fine) from
              // "still alive but denied" (needs the user to close it).
              try {
                process.kill(pid, 0); // throws if the process is gone
                killDenied = true;
                deps.log(
                  `[ensure-cdp] ${appId}: taskkill denied for PID ${pid} (still running) — likely elevated`,
                );
              } catch {
                // Process already exited — kill succeeded effectively.
              }
            }
            resolve();
          },
        );
      });
    } catch {
      // Not running or already gone — fine.
    }
  }
  if (killDenied) {
    deps.logStructured({
      type: 'cdp_spawn_failed',
      agentId: appId,
      reason: 'kill-denied',
      timestamp: new Date().toISOString(),
    });
    return { port: null, reason: 'kill-denied' };
  }

  // Clean up Electron singleton lock files. When an Electron app is killed
  // via taskkill /F (rather than a graceful app.quit()), the singleton lock
  // / cookie / socket files in its userData dir are NOT cleaned up. The next
  // launch sees the stale lock and exits immediately ("singleton lock or
  // launch failure"). This was the root cause of WorkBuddy always failing
  // to restart with CDP: 9 PIDs killed, but the lock file persisted.
  // Deleting these files after kill lets the next spawn succeed.
  cleanSingletonLockFiles(appId, deps.log.bind(null));

  // Wait for Windows to release the process table + file handles before
  // spawning the replacement.
  //
  // Previously this was a FIXED 2500ms sleep that always burned the full
  // budget, even when nothing was killed (cold start: app not running). The
  // restart path needs the wait because a taskkill /F'd app can still hold
  // the singleton lock file for a moment; the cold-start path has nothing to
  // release. Now we:
  //   - cold start (nothing killed): tiny 250ms buffer, then spawn immediately
  //     — removes ~2.2s of dead time from the common "apply to idle agent"
  //     flow.
  //   - restart (killed PIDs): poll findRunningPids until the process tree
  //     actually exits (max 2500ms), so we only wait as long as the OS
  //     really needs, not a fixed budget.
  if (killedPids.length > 0) {
    const exitDeadline = Date.now() + 2500;
    while (Date.now() < exitDeadline) {
      let stillAlive: number[] = [];
      try {
        stillAlive = await adapter.findRunningPids(process.platform, exePath);
      } catch {
        break;
      }
      if (stillAlive.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } else {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  // Pass --remote-debugging-port=0 directly on the command line: Chromium
  // picks a free port itself, avoiding collisions across the three apps.
  // (ELECTRON_EXTRA_LAUNCH_ARGS was tested and does NOT work for these
  // packaged Electron apps — the env var is silently ignored.)
  //
  // cwd is set to the exe directory so VS Code-fork apps (TRAE SOLO CN)
  // can resolve their relative `resources/app` path the same way they do
  // when launched normally.
  let childPid = -1;
  const spawnT0 = performance.now();
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
    // RFC §4.9: standalone 'spawnAgent' timing step for the active apply trace.
    PerformanceRecorder.recordNamedStep(undefined, 'spawnAgent', performance.now() - spawnT0);
  } catch (error) {
    PerformanceRecorder.recordNamedStep(
      undefined,
      'spawnAgent',
      performance.now() - spawnT0,
      false,
      toMessage(error),
    );
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
  // Poll iteration counter: the first iteration bypasses the discovery TTL
  // caches so a just-spawned process is picked up immediately; later
  // iterations hit the TTL caches to avoid re-running wmic/netstat/tasklist.
  let pollIteration = 0;
  while (Date.now() < deadline) {
    // Detect early exit: if the spawned child is gone, the launch *may* have
    // failed (singleton lock, missing dependency, sandbox rejection). However,
    // on Windows process.kill(pid, 0) also throws EPERM when the child
    // elevated itself (UAC) or moved to a different session — the process IS
    // alive, we just can't signal it. Before bailing, verify the app truly
    // isn't running by checking for any live PIDs via the adapter.
    if (childPid > 0) {
      try {
        process.kill(childPid, 0);
      } catch {
        // Child PID unreachable. Check if the app started anyway (fork,
        // elevation, or launcher-stub pattern where the initial exe exits
        // after spawning the real process).
        const lastChance = await resolveLivePort(appId, deps, null, { bypassCache: true });
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
        // No CDP port yet — but is the app running at all? If PIDs exist,
        // the launch succeeded and CDP may appear once boot completes.
        let appPids: number[] = [];
        try {
          appPids = await adapter.findRunningPids(process.platform, exePath);
        } catch (error) {
          deps.log(
            `[ensure-cdp] ${appId}: post-spawn findRunningPids failed — ${toMessage(error)}`,
          );
        }
        if (appPids.length === 0) {
          // Truly dead — no process, no port. Bail.
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
        // App is running but CDP not yet open — stop tracking childPid
        // (it's stale) and fall through to the normal poll loop below.
        deps.log(
          `[ensure-cdp] ${appId}: child PID ${childPid} gone but ${appPids.length} app PID(s) alive — continuing poll`,
        );
        childPid = -1;
      }
    }
    // Fast path: the freshly-spawned app's DevToolsActivePort file is written
    // early in boot (before the renderer window is ready), so probe it BEFORE
    // sleeping — on the first iteration we don't want to burn the full 600ms
    // if the port file is already written. This shaves the common case down to
    // one file read + one TCP probe instead of a fixed wait + complete
    // discovery every 600ms.
    const fastPort = await probeFreshlySpawnedPort(adapter, deps.log.bind(null));
    if (fastPort != null) {
      deps.log(`[ensure-cdp] ${appId}: CDP up on ${fastPort} (fresh spawn fast path)`);
      deps.logStructured({
        type: 'cdp_ready',
        agentId: appId,
        timestamp: new Date().toISOString(),
        progress: 50,
      });
      return { port: fastPort, reason: null };
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
    // Fall back to the full discovery chain (catches apps that don't write a
    // port file, or where the file lags behind the actual bind). Only the
    // first poll bypasses the process/netstat TTL caches so the freshly
    // spawned process is picked up promptly; subsequent polls hit the 1.5s TTL
    // (which refreshes within ~2.5 polls anyway) instead of re-running
    // wmic/netstat/tasklist every 600ms — a P0 perf win on cold starts.
    const port = await resolveLivePort(appId, deps, null, { bypassCache: pollIteration === 0 });
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
    pollIteration += 1;
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
  } catch (error) {
    deps.log(`[detect] ${appId}: adapter.discover failed — ${toMessage(error)}`);
    discovered = null;
  }
  const coreInstalled = Boolean(discovered);

  // AgentSkin-side install detection (paths + Uninstall registry). Merges
  // with core discovery so a closed-but-installed app is still reported.
  //
  // Detected-path cache: the first full scan caches the result in persisted
  // state, so later status() polls skip the expensive filesystem + registry
  // scan and only cheaply verify the cached path still holds the exe. If the
  // cached path is stale (uninstalled / moved), we re-run the full scan and
  // refresh the cache.
  let probe = {
    installed: false,
    path: null as string | null,
    version: null as string | null,
    source: null as 'path' | 'registry' | 'msix' | 'core' | null,
  };
  const cachedPath = deps.getDetectedPath(appId);
  // `cacheHandled` is true once the cache path was either verified valid or
  // cleared as stale — only then do we know a full scan is needed (or not).
  // A manual appPath override always wins over the auto-detected cache.
  let cacheHandled = !appPathOverride;
  if (appPathOverride) {
    deps.log(`[detect] ${appId}: manual appPath override — skipping detected-path cache`);
  }
  if (cachedPath && adapter.installHints && !appPathOverride) {
    const verified = await verifyInstallPath(
      cachedPath,
      adapter.installHints,
      deps.detectionLogFile,
    );
    if (verified) {
      probe = { installed: true, path: verified.path, version: verified.version, source: 'path' };
      deps.log(`[detect] ${appId}: detected-path cache hit (${verified.path})`);
      cacheHandled = true;
    } else {
      // Cached path stale — clear and fall through to a full re-scan.
      deps.log(`[detect] ${appId}: cached path ${cachedPath} stale — re-scanning`);
      deps.setDetectedPath(appId, null);
      cacheHandled = true;
    }
  }
  if (!probe.installed && !cacheHandled) {
    probe = await detectInstallation({
      platform: process.platform,
      appPath: appPathOverride,
      hints: adapter.installHints,
      displayName: deps.displayName(appId),
      logFile: deps.detectionLogFile,
    });
    // Cache the auto-detected path so future polls skip the full scan.
    // Fire-and-forget persist so the cache survives restarts without
    // blocking the status() poll.
    if (probe.installed && probe.path) {
      const wasCached = deps.getDetectedPath(appId);
      deps.setDetectedPath(appId, probe.path);
      if (!wasCached) void deps.persist().catch(() => undefined);
    }
  }
  const installed = coreInstalled || probe.installed;

  if (installed) {
    try {
      running =
        (await adapter.findRunningPids(process.platform, discovered?.executable ?? null)).length >
        0;
    } catch (error) {
      deps.log(`[detect] ${appId}: findRunningPids failed — ${toMessage(error)}`);
      running = false;
    }
  }
  if (running) {
    const backoffAt = negativePortBackoffUntil.get(appId) ?? 0;
    if (Date.now() < backoffAt) {
      // Running but still CDP-less, inside the backoff window (see
      // NEGATIVE_PORT_BACKOFF_MS). Skip the full discovery chain and the log
      // spam it would emit — the UI already reports "running without a debug
      // port". Any newly-opened CDP port is picked up at the next backoff
      // expiry (≤5s).
      port = null;
    } else {
      const livePort = await resolveLivePort(appId, deps);
      if (livePort != null) {
        negativePortBackoffUntil.delete(appId);
        port = livePort;
        try {
          debugReady = (await adapter.findTargets(port, 1200)).length > 0;
        } catch (error) {
          deps.log(`[detect] ${appId}: findTargets failed on port ${port} — ${toMessage(error)}`);
          debugReady = false;
        }
      } else {
        // App is running but no live CDP port found. Discard any stale port
        // from the persisted state so the UI never reports a zombie port,
        // and back off the next poll so discovery doesn't run hot.
        negativePortBackoffUntil.set(appId, Date.now() + NEGATIVE_PORT_BACKOFF_MS);
        port = null;
      }
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
    activeSchemeId: deps.activeSchemeId(appId),
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
      case 'kill-denied':
        return 'kill-denied';
      case 'spawn-error':
        return 'spawn-failed';
      case 'timeout':
        return 'cdp-timeout';
      case 'no-cdp':
        return 'no-cdp';
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
