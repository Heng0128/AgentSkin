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
import path from 'node:path';
import { requireAdapter } from '../../adapters/registry';
import type { Platform } from '../../shared/types/agent';
import type { LaunchResult } from '../../shared/types';
import { toMessage } from '../../shared/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Parameters for launching a single application. */
export interface LaunchRequest {
  /** Unique app identifier (from `ScannedApp.id`). */
  readonly appId: string;
  /** Absolute path to the executable. */
  readonly exePath: string;
  /** Whether the app has an adapter (controls CDP flag injection). */
  readonly adapted: boolean;
  /**
   * Preferred CDP port. `null`/`undefined` = random port (0). Ignored when
   * `adapted === false`.
   */
  readonly preferredPort?: number | null;
  /** Kill any running instances before spawning a new one. */
  readonly forceRestart?: boolean;
  /**
   * AgentId of the backing adapter (required when `adapted === true`). Used
   * to resolve the adapter for `findRunningPids` / `resolveDebugPorts`.
   */
  readonly adapterId?: string;
}

/** Injectable dependencies — only the log sink today. */
export interface LauncherDeps {
  /** Log line sink (defaults to no-op). */
  readonly log: (line: string) => void;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/**
 * Tracks apps launched by this module: appId → { pid, port }.
 * `port` is `null` for non-adapted apps or when CDP discovery failed.
 */
const runningApps = new Map<string, { pid: number; port: number | null }>();

/** Active dependency wiring (log sink). */
let moduleDeps: LauncherDeps = { log: () => {} };

/** Max number of port-increment retries before giving up. */
const MAX_PORT_RETRIES = 10;

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
function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * Check whether a TCP port currently has a listener on 127.0.0.1.
 *
 * Uses PowerShell `Get-NetTCPConnection` so it only matches *listening*
 * sockets (not TIME_WAIT / CLOSE_WAIT), avoiding false positives from
 * recently-closed connections.
 */
async function isPortOccupied(port: number): Promise<boolean> {
  try {
    const output = await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    ]);
    return output.trim().length > 0;
  } catch {
    // PowerShell missing or other failure — assume free and let spawn fail
    // if it's actually occupied.
    return false;
  }
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
  });
  child.unref();
  return child;
}

/** Kill a list of PIDs via `taskkill /F /T`. Best-effort — swallows errors. */
function killPids(pids: number[]): Promise<void> {
  return Promise.all(
    pids.map(
      (pid) =>
        new Promise<void>((resolve) => {
          execFile('taskkill', ['/F', '/T', '/PID', String(pid)], { windowsHide: true, timeout: 5000 }, () =>
            resolve(),
          );
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
 * Resolve a concrete port for spawning: validate `preferredPort` (or walk
 * port+1 … port+MAX_PORT_RETRIES if occupied). Returns the chosen port, or
 * null when every candidate is taken.
 */
async function resolvePort(preferredPort: number | null | undefined): Promise<number | null> {
  // No preference → let Chromium pick (spawn with 0).
  if (preferredPort == null || preferredPort === 0) return 0;

  for (let i = 0; i <= MAX_PORT_RETRIES; i++) {
    const candidate = preferredPort + i;
    if (!(await isPortOccupied(candidate))) return candidate;
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
  const { appId, exePath, adapted, preferredPort, forceRestart, adapterId } = request;
  const _log = moduleDeps.log;

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

    const adapter = requireAdapter(adapterId as Parameters<typeof requireAdapter>[0]);

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
            runningApps.set(appId, { pid: runningPids[0], port });
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
    const port = await resolvePort(preferredPort);
    if (port === null) {
      return {
        ok: false,
        port: null,
        state: 'failed',
        message: '端口全部被占用',
      };
    }

    const child = spawnApp(exePath, [
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
    ]);
    const pid = child.pid ?? -1;
    _log(`[launcher] ${appId}: spawned PID ${pid} (adapted, port=${port})`);

    // 4. Discover the actual CDP port.
    let actualPort: number | null = null;
    if (port === 0) {
      actualPort = await discoverRandomPort(adapter);
    } else {
      actualPort = (await probeTcpPort(port, CDP_PROBE_TIMEOUT)) ? port : null;
    }

    runningApps.set(appId, { pid, port: actualPort });
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
  let isRunning = false;
  try {
    const exeName = path.basename(exePath);
    const output = await execFileAsync('tasklist', ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH']);
    const nameWithoutExt = exeName.replace(/\.exe$/i, '');
    isRunning = output
      .toLowerCase()
      .split('\n')
      .some((line) => line.startsWith(`"${nameWithoutExt}`));
  } catch {
    isRunning = false;
  }

  if (forceRestart && isRunning) {
    try {
      await execFileAsync('taskkill', ['/F', '/IM', path.basename(exePath)]);
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
  runningApps.set(appId, { pid, port: null });

  return {
    ok: true,
    pid,
    port: null,
    state: 'launched',
    message: 'App launched (non-adapted, no CDP)',
  };
}

/**
 * Return a snapshot of all apps tracked as running by this launcher.
 * The returned Map is a shallow copy — callers can inspect but not mutate
 * internal state.
 */
export function getRunningApps(): Map<string, { pid: number; port: number | null }> {
  return new Map(runningApps);
}
