// SPDX-License-Identifier: MPL-2.0

/**
 * # electron-launcher — Quick Application Launcher
 *
 * Provides the "quick launch" capability for AgentSkin: launch an Electron
 * application and, for already-adapted agents, inject the
 * `--remote-debugging-port` argument so AgentSkin can reach it via CDP.
 *
 * ## Design
 *
 * Two distinct code paths, discriminated by `request.adapted`:
 *
 *   - **Adapted** (`adapted === true`): the app has an adapter backing it.
 *     Launching appends `--remote-debugging-port=<port>` (user preference or
 *     `0` for random). After spawn, the actual CDP port is discovered via
 *     the adapter's `resolveDebugPorts` + TCP probe. A port-conflict retry
 *     loop tries port+1 … port+10 before giving up.
 *
 *   - **Non-adapted** (`adapted === false`): the app is launched as-is — no
 *     port arguments, no CDP discovery. The running state is tracked without
 *     a port number.
 *
 * ## Running state
 *
 * A module-level `Map<string, { pid, port }>` tracks every app the launcher
 * has started. Keys are `appId` (= `ScannedApp.id`). `getRunningApps()`
 * returns a snapshot copy so callers can never mutate internal state.
 *
 * ## Port conflict handling
 *
 * When `preferredPort` is specified (and non-zero), the launcher probes
 * port availability via PowerShell `Get-NetTCPConnection`. If occupied, it
 * increments the port up to 10 times. If all 11 candidates are in use, it
 * gives up with `state: 'failed'`.
 *
 * ## Dependencies
 *
 * The module imports the adapter registry directly (`requireAdapter`) so
 * production callers don't need to wire a factory. Tests mock the registry
 * module via `vi.mock`. The log sink is injected through `configureLauncher()`
 * so the default (no-op logger) is side-effect free.
 */

import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { requireAdapter } from '../../adapters/registry';
import { toMessage } from '../../shared/errors';
import { getMainMessages } from '../../shared/i18n';
import type { LaunchResult } from '../../shared/types';
import type { LaunchRequest } from '../../shared/types/launch';
import {
  AGENT_PORT_FALLBACK_MAX,
  AGENT_PORT_FALLBACK_MIN,
  PortResolver,
  resolveEndPort,
  resolveStartPort,
} from '../cdp/port-manager';
import { getAppRunStateCoordinator } from './app-run-state-coordinator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Re-exported so `src/main/ipc/electron-ipc.ts` can import the launch
 *  request type without depending on the shared types file directly. */
export type { LaunchRequest };

/** Injectable dependencies — log sink + main-window accessor for status push. */
export interface LauncherDeps {
  /** Log line sink (defaults to no-op). */
  readonly log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Whitelist of executable paths the launcher is permitted to spawn. Populated
 * **only** from scanner results and user-configured manual install paths (see
 * `registerAllowedExePaths`). This closes the `ELECTRON_LAUNCH` hole: a
 * compromised renderer can no longer pass an arbitrary `exePath` (e.g.
 * `cmd.exe`) — the target must be an exact member of this set.
 */
const allowedExePaths = new Set<string>();

/** Normalize a path for membership comparison (case-insensitive on Windows). */
function normalizeExePath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * Register executable paths the launcher may spawn. Called by the IPC layer
 * with every scan result and the user's manual install overrides. Accepts any
 * iterable of strings; non-string / empty entries are ignored.
 */
export function registerAllowedExePaths(paths: Iterable<string>): void {
  for (const p of paths) {
    if (typeof p === 'string' && p.length > 0) {
      allowedExePaths.add(normalizeExePath(p));
    }
  }
}

/** True when `exePath` is an exact member of the allowed launch whitelist. */
export function isAllowedExePath(exePath: string): boolean {
  return allowedExePaths.has(normalizeExePath(exePath));
}

// ── Launch rate limiting ────────────────────────────────────────────────
// Prevents a compromised renderer from batch-spawning unbounded processes via
// `ELECTRON_LAUNCH`. A rolling window of timestamps; a launch is rejected once
// the window holds ≥ `LAUNCH_MAX_PER_WINDOW` entries.
const LAUNCH_WINDOW_MS = 5_000;
const LAUNCH_MAX_PER_WINDOW = 5;
const launchTimes: number[] = [];

/** Enforce ≤5 launches per rolling 5s window. Also records this launch. */
function withinLaunchRateLimit(now: number = Date.now()): boolean {
  // Prune entries older than the window.
  while (launchTimes.length > 0 && now - launchTimes[0]! > LAUNCH_WINDOW_MS) {
    launchTimes.shift();
  }
  if (launchTimes.length >= LAUNCH_MAX_PER_WINDOW) {
    return false;
  }
  launchTimes.push(now);
  return true;
}

/** Reset rate-limit state (test helper). */
export function resetLaunchRateLimit(): void {
  launchTimes.length = 0;
}

/** Active dependency wiring (log sink). */
let moduleDeps: LauncherDeps = { log: () => {} };

/**
 * Maximum number of port-increment retries before giving up.
 * Set to cover the full agent port band (9222–9357 = 136 ports).
 */
const MAX_PORT_RETRIES = AGENT_PORT_FALLBACK_MAX - AGENT_PORT_FALLBACK_MIN + 1;

/**
 * Shared PortResolver instance for the launcher module.
 * Reused across resolvePort calls to benefit from internal rent tracking.
 */
const sharedResolver = new PortResolver({
  maxAttempts: MAX_PORT_RETRIES,
  timeoutMs: Number.parseInt(process.env.AGENTSINK_PORT_TIMEOUT_MS ?? '2000', 10) || 2000,
});

/** Timeout (ms) for the random-port discovery poll loop after spawn. */
const RANDOM_PORT_DISCOVERY_TIMEOUT = 8000;

/** Poll interval (ms) between random-port discovery attempts. */
const RANDOM_PORT_POLL_INTERVAL = 500;

/** TCP probe timeout (ms) when checking CDP liveness. */
const CDP_PROBE_TIMEOUT = 300;

/** Wait time (ms) after killing processes before spawning a replacement. */
const RESTART_SETTLE_DELAY = 500;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configure the launcher's dependencies. Must be called once during startup
 * (e.g. from `main.ts`) to wire a real log sink. Tests call this with a
 * no-op or a capturing logger before exercising the module.
 */
export function configureLauncher(deps: LauncherDeps): void {
  moduleDeps = deps;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run an external command and capture stdout. Rejects on non-zero exit so
 * callers can catch and treat a missing executable as "not found" rather
 * than crashing.
 */
function execFileAsync(cmd: string, args: string[], timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * Probe a TCP port on 127.0.0.1 for an active listener within `timeoutMs`.
 * Returns true only if a connection is established (some process is listening).
 */
function probeTcpPort(port: number, timeoutMs = CDP_PROBE_TIMEOUT): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

/**
 * Return a copy of the current process env with AgentSkin dev-only variables
 * stripped. A target Electron app spawned without an `env` option inherits
 * `process.env` wholesale; dev-mode variables like `ELECTRON_RENDERER_URL` /
 * `VITE_DEV_SERVER_URL` then make the target load its own renderer against
 * AgentSkin's (nonexistent) dev server — a blank grey window. Mirrors Dream
 * Work Theme's `getCleanLaunchEnvironment`.
 */
function getCleanSpawnEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    'VITE_DEV_SERVER_URL',
    'ELECTRON_RENDERER_URL',
    'MAIN_VITE_DEV_SERVER_URL',
    'ELECTRON_RUN_AS_NODE',
  ] as const) {
    delete env[key];
  }
  return env;
}

/**
 * Spawn an executable with the given arguments. The child is detached and
 * unref'd so the parent process doesn't block on it. Returns the child
 * handle so callers can read `child.pid`.
 */
function spawnApp(exePath: string, args: string[]): ReturnType<typeof spawn> {
  const child = spawn(exePath, args, {
    detached: true,
    stdio: 'ignore',
    cwd: path.dirname(exePath),
    windowsHide: true,
    env: getCleanSpawnEnv(),
  });
  child.unref();
  return child;
}

/**
 * MSIX (Windows Store) executables live under the ACL-protected WindowsApps
 * directory. Direct `spawn()` of such an exe does not preserve Chromium CLI
 * flags (package activation strips or rewrites them), so they must be launched
 * through a shortcut whose target bakes the args in — mirrors the proven
 * workaround in `app-discovery.ts` (`launchMsixViaShortcut`).
 *
 * Returns false when the PowerShell shortcut launch could not be created.
 */
async function launchMsixViaShortcut(exePath: string, args: string[]): Promise<boolean> {
  const shortcutPath = path.join(
    os.tmpdir(),
    `agentskin-${path.basename(exePath, '.exe')}-${Date.now()}.lnk`,
  );
  const argString = args.map((a) => `"${a}"`).join(' ');
  const psCommands = [
    '$shell = New-Object -ComObject WScript.Shell',
    `$shortcut = $shell.CreateShortcut("${shortcutPath.replace(/\\/g, '\\\\')}")`,
    `$shortcut.TargetPath = "${exePath.replace(/\\/g, '\\\\')}"`,
    `$shortcut.Arguments = '${argString}'`,
    `$shortcut.WorkingDirectory = "${path.dirname(exePath).replace(/\\/g, '\\\\')}"`,
    '$shortcut.Save()',
    `Start-Process -FilePath "${shortcutPath.replace(/\\/g, '\\\\')}"`,
  ].join('; ');
  try {
    await execFileAsync(
      'powershell',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        psCommands,
      ],
      20000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Whether `exePath` sits inside an MSIX WindowsApps package directory. */
function isMsixExecutable(exePath: string): boolean {
  return /WindowsApps/i.test(exePath);
}

/**
 * Register an exit handler that updates the coordinator when the spawned
 * process terminates. The coordinator is the single source of truth for
 * runtime state.
 */
function trackExit(child: ReturnType<typeof spawn>, appId: string, _pid: number): void {
  child.on('exit', () => {
    // Sync to coordinator (runtime state single source of truth)
    getAppRunStateCoordinator().updateState(appId, {
      running: false,
      pid: 0,
      port: null,
      debugReady: false,
    });
  });
}

/**
 * Kill a list of PIDs. On Windows uses `taskkill /F /T`; on macOS/Linux
 * uses `kill -9`. Best-effort — swallows errors.
 */
function killPids(pids: number[]): Promise<void> {
  return Promise.all(
    pids.map(
      (pid) =>
        new Promise<void>((resolve) => {
          if (process.platform === 'win32') {
            execFile(
              'taskkill',
              ['/F', '/T', '/PID', String(pid)],
              { windowsHide: true, timeout: 5000 },
              () => resolve(),
            );
          } else {
            execFile('kill', ['-9', String(pid)], { timeout: 5000 }, () => resolve());
          }
        }),
    ),
  ).then(() => undefined);
}

/**
 * Discover the CDP port Chromium picked after spawning with port=0.
 *
 * Polls the adapter's `resolveDebugPorts` (reads DevToolsActivePort files)
 * and TCP-probes each candidate. Returns the first live port, or null on
 * timeout.
 */
async function discoverRandomPort(
  adapter: { resolveDebugPorts: (platform: string) => Promise<number[]> },
  timeoutMs = RANDOM_PORT_DISCOVERY_TIMEOUT,
): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const ports = await adapter.resolveDebugPorts(process.platform);
      for (const port of ports) {
        if (await probeTcpPort(port, CDP_PROBE_TIMEOUT)) {
          return port;
        }
      }
    } catch {
      // Adapter failed (e.g. no DevToolsActivePort file yet) — retry.
    }
    await new Promise((resolve) => setTimeout(resolve, RANDOM_PORT_POLL_INTERVAL));
  }
  return null;
}

/**
 * Resolve a concrete port for spawning using adapter-aware config.
 *
 * Resolution order:
 *   1. `preferredPort === 0` → let Chromium pick (random).
 *   2. `preferredPort` explicit → walk forward from it within the adapter's
 *      fallback range.
 *   3. Adapter config lookup → use the adapter's preferred port as the
 *      starting point, walk forward within [preferredPort, endPort] where
 *      `endPort` is `resolveEndPort(adapterId)` (default 9357).
 *   4. No config → walk forward from `AGENT_PORT_FALLBACK_MIN` (9222).
 *
 * On success, the resolved port is recorded in the shared resolver's
 * internal rent set via `checkPort` (so subsequent calls don't re-probe
 * a port already marked as in-use).
 *
 * @returns The chosen port (≥ 9222), `0` for random, or `null` when
 *   every candidate is taken.
 */
async function resolvePort(
  preferredPort: number | null | undefined,
  adapterId?: string,
  useAdapterPreferredPort = false,
): Promise<number | null> {
  // An explicitly given invalid port (non-integer or out of range) must
  // reject the launch — NOT silently fall through to a random port. This
  // preserves the old contract where preferredPort > 65535 returned null.
  if (preferredPort != null && preferredPort !== 0) {
    if (!Number.isInteger(preferredPort) || preferredPort < 1 || preferredPort > 65535) {
      return null;
    }
  }

  // Determine the starting port from caller override, adapter config, or default.
  const startPort = resolveStartPort(adapterId, preferredPort, useAdapterPreferredPort);

  // startPort === 0 means "random" — defer to Chromium.
  if (startPort === 0) return 0;

  // Reject invalid explicit ports.
  if (startPort < 1 || startPort > 65535) return null;

  // Determine the upper bound for the walk.
  const endPort = resolveEndPort(adapterId);

  // Walk forward through the bounded range.
  // maxAttempts covers the full range by default (136 ports for the agent band).
  const maxAttempts = Math.min(endPort - startPort + 1, MAX_PORT_RETRIES);

  for (let i = 0; i < maxAttempts; i++) {
    const candidate = startPort + i;
    if (candidate > endPort) break;
    const status = await sharedResolver.checkPort(candidate);
    if (status.available) {
      return candidate;
    }
  }

  return null; // all candidates occupied
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Launch an application according to the request parameters.
 *
 * Never throws — all errors are caught and returned as a structured
 * `LaunchResult` with `state: 'failed'`. This keeps IPC boundaries clean
 * and prevents a single launch failure from crashing the main process.
 */
export async function launchApp(request: LaunchRequest): Promise<LaunchResult> {
  try {
    return await launchAppInner(request);
  } catch (error) {
    return {
      ok: false,
      port: null,
      state: 'failed',
      message: toMessage(error),
    };
  }
}

/** Inner implementation — separated so `launchApp` can wrap all throws. */
async function launchAppInner(request: LaunchRequest): Promise<LaunchResult> {
  const {
    appId,
    exePath,
    adapted,
    preferredPort,
    forceRestart,
    adapterId,
    useAdapterPreferredPort,
  } = request;
  const _log = moduleDeps.log;

  // Rate limit: a compromised renderer must not be able to batch-spawn
  // unbounded processes. Enforce ≤5 launches per rolling 5s window.
  if (!withinLaunchRateLimit()) {
    return {
      ok: false,
      port: null,
      state: 'failed',
      message: 'launch rejected: rate limit exceeded (max 5 launches per 5s)',
    };
  }

  // Whitelist guard: never spawn an exePath that wasn't produced by a scan or
  // the user's manual install config. This is the security boundary for
  // `ELECTRON_LAUNCH` — see `registerAllowedExePaths`.
  if (!isAllowedExePath(exePath)) {
    return {
      ok: false,
      port: null,
      state: 'failed',
      message: 'launch rejected: exePath is not an allowed launch target',
    };
  }

  // ── Adapted flow ──────────────────────────────────────────────────────
  if (adapted) {
    if (!adapterId) {
      return {
        ok: false,
        port: null,
        state: 'failed',
        message: 'adapted app requires an adapterId to resolve running state',
      };
    }

    const adapter = requireAdapter(adapterId);

    // 1. Check if already running.
    let runningPids: number[] = [];
    try {
      runningPids = await adapter.findRunningPids(process.platform, exePath);
    } catch (error) {
      _log(`[launcher] ${appId}: findRunningPids failed — ${toMessage(error)}`);
    }

    // Handle force restart: kill existing before spawning.
    if (forceRestart && runningPids.length > 0) {
      _log(`[launcher] ${appId}: force restart — killing ${runningPids.length} PID(s)`);
      await killPids(runningPids);
      await new Promise((resolve) => setTimeout(resolve, RESTART_SETTLE_DELAY));
      runningPids = [];
    }

    // 2. Already running → check for CDP port.
    if (runningPids.length > 0) {
      try {
        const ports = await adapter.resolveDebugPorts(process.platform);
        for (const port of ports) {
          if (await probeTcpPort(port, CDP_PROBE_TIMEOUT)) {
            return {
              ok: true,
              pid: runningPids[0],
              port,
              state: 'running',
              message: `App already running with CDP on port ${port}`,
            };
          }
        }
      } catch {
        // resolveDebugPorts failed — fall through to needs-restart.
      }
      // Running but no reachable CDP port.
      return {
        ok: false,
        pid: runningPids[0],
        port: null,
        state: 'needs-restart',
        message: 'App is running but has no active CDP port — restart required',
      };
    }

    // 3. Not running → resolve a port and spawn.
    const port = await resolvePort(preferredPort, adapterId, useAdapterPreferredPort ?? false);
    if (port === null) {
      return {
        ok: false,
        port: null,
        state: 'failed',
        message: getMainMessages().portAllOccupied,
      };
    }

    // MSIX (Windows Store) apps do not preserve CDP arguments through a direct
    // spawn(): package activation strips them. Bake the args into a temporary
    // .lnk and launch through it so the MSIX container receives them. The PID
    // is unknown in that case (-1) — CDP port discovery below still finds the
    // port via the adapter's DevToolsActivePort / TCP probes.
    let pid = -1;
    if (isMsixExecutable(exePath) && process.platform === 'win32') {
      const launched = await launchMsixViaShortcut(exePath, [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
      ]);
      if (!launched) {
        return {
          ok: false,
          port: null,
          state: 'failed',
          message: 'MSIX app launch failed: shortcut creation error',
        };
      }
    } else {
      const child = spawnApp(exePath, [
        `--remote-debugging-port=${port}`,
        '--remote-debugging-address=127.0.0.1',
      ]);
      pid = child.pid ?? -1;
      trackExit(child, appId, pid);
    }
    const portLabel = port === 0 ? 'random' : String(port);
    _log(
      `[launcher] ${appId}: spawned PID ${pid} (adapted, port=${portLabel}, adapter=${adapterId})`,
    );

    // 4. Discover the actual CDP port.
    let actualPort: number | null = null;
    if (port === 0) {
      actualPort = await discoverRandomPort(adapter);
    } else {
      actualPort = (await probeTcpPort(port, CDP_PROBE_TIMEOUT)) ? port : null;
    }

    // Sync to coordinator (runtime state single source of truth)
    getAppRunStateCoordinator().updateState(appId, {
      running: true,
      pid: Math.max(pid, 0),
      port: actualPort,
      debugReady: actualPort !== null,
    });
    return {
      ok: true,
      pid,
      port: actualPort,
      state: 'launched',
      message: `App launched with CDP${actualPort ? ` on port ${actualPort}` : ''}`,
    };
  }

  // ── Non-adapted flow ──────────────────────────────────────────────────
  // Check if the exe name appears in the running process list.
  // Windows uses `tasklist`; macOS/Linux uses `pgrep -f`.
  let isRunning = false;
  const exeName = path.basename(exePath);
  try {
    if (process.platform === 'win32') {
      const output = await execFileAsync('tasklist', [
        '/FI',
        `IMAGENAME eq ${exeName}`,
        '/FO',
        'CSV',
        '/NH',
      ]);
      const nameWithoutExt = exeName.replace(/\.exe$/i, '');
      isRunning = output
        .toLowerCase()
        .split('\n')
        .some((line) => line.startsWith(`"${nameWithoutExt}`));
    } else {
      const nameWithoutExt = exeName.replace(/\.[^.]+$/, '');
      const output = await execFileAsync('pgrep', ['-f', nameWithoutExt]);
      isRunning = output.trim().length > 0;
    }
  } catch {
    isRunning = false;
  }

  if (forceRestart && isRunning) {
    try {
      if (process.platform === 'win32') {
        await execFileAsync('taskkill', ['/F', '/IM', exeName]);
      } else {
        const nameWithoutExt = exeName.replace(/\.[^.]+$/, '');
        await execFileAsync('pkill', ['-9', '-f', nameWithoutExt]);
      }
    } catch {
      // kill may fail if the process already exited — proceed to spawn.
    }
    await new Promise((resolve) => setTimeout(resolve, RESTART_SETTLE_DELAY));
    isRunning = false;
  }

  if (isRunning) {
    return {
      ok: true,
      port: null,
      state: 'running',
      message: 'App is already running (non-adapted)',
    };
  }

  const child = spawnApp(exePath, []);
  const pid = child.pid ?? -1;
  _log(`[launcher] ${appId}: spawned PID ${pid} (non-adapted, no CDP)`);
  trackExit(child, appId, pid);
  // Sync to coordinator (runtime state single source of truth)
  getAppRunStateCoordinator().updateState(appId, {
    running: true,
    pid,
    port: null,
    debugReady: false,
  });

  return {
    ok: true,
    pid,
    port: null,
    state: 'launched',
    message: 'App launched (non-adapted, no CDP)',
  };
}
