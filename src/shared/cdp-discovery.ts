// SPDX-License-Identifier: MPL-2.0

/**
 * CDP port discovery — pure functions for locating a Chromium-based app's
 * live DevTools debugging port.
 *
 * Discovery primitives:
 *   - probePortLive               : TCP probe (is something listening?)
 *   - explicitDebugPortsFromPids  : parse --remote-debugging-port=N from PID argv
 *   - listeningPortsForPids       : netstat PID → listening loopback ports
 *   - resolveLivePort             : orchestrator (layer 1 + layer 2)
 *
 * Lives in src/shared/ so both src/main/ (agent-engine-service) and
 * src/legacy/ (agentskin-core-runtime) can import it without layer inversion.
 */

import net from 'node:net';
import { execFileAsync } from './exec-async';

/** Check if a value is a valid TCP port (1024-65535 integer). */
export function isPort(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535;
}

/**
 * Lightweight TCP probe — returns true if something is listening on the
 * port at 127.0.0.1. Used to detect zombie persisted ports at boot and to
 * validate candidate ports during discovery.
 */
export function probePortLive(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * TTL cache for the full Win32 process-list snapshot (CommandLine + ProcessId
 * for every running process). Populated lazily by {@link snapshotProcesses}
 * and reused across {@link explicitDebugPortsFromPids} calls within the TTL
 * window.
 *
 * Why this cache exists: the renderer's `useBoot` hook polls `status()` every
 * 3s, and `status()` calls `resolveLivePort` once per agent → 4 calls per
 * poll. Without a cache that means 4 `wmic`/`Get-CimInstance` invocations
 * every 3s, each spawning a child process that takes 0.5–2s. The 1.5s TTL
 * collapses the 4 calls in a single poll to one snapshot while still being
 * short enough that a freshly-launched process becomes visible before the
 * next poll.
 *
 * The cache holds raw text (the form:list output) plus the timestamp it was
 * captured. Both fields are written together; readers treat the snapshot as
 * a unit. JavaScript's single-threaded event loop guarantees no torn reads
 * even without a lock.
 */
interface ProcessSnapshot {
  text: string;
  capturedAt: number;
}
let cachedProcessSnapshot: ProcessSnapshot | null = null;
const PROCESS_SNAPSHOT_TTL_MS = 1500;

// A TTL cache for the full `netstat -ano` output, mirroring the wmic process
// snapshot cache above. `listeningPortsForPids` is called from
// `resolveLivePort`'s layer-2 fallback, which the apply flow re-runs multiple
// times (cdp-ready probe, apply-time port re-resolve, withPageSession retries).
// Without a cache each call spawns a fresh `netstat` child process
// (0.5–2s), so a single apply can burn several seconds just re-listing the
// same loopback ports. The 1.5s TTL collapses repeated calls within one
// apply window into a single invocation while still catching a freshly-bound
// port before the next poll.
interface NetstatSnapshot {
  text: string;
  capturedAt: number;
}
let cachedNetstatSnapshot: NetstatSnapshot | null = null;
const NETSTAT_SNAPSHOT_TTL_MS = 1500;

// TTL cache for `adapter.findRunningPids` results inside `resolveLivePort`.
// The apply flow re-runs resolveLivePort several times (cdp-ready probe,
// apply-time port re-resolve, withPageSession retries), and each call re-lists
// every process via `tasklist` (0.5–2s). Caching the PID set for 1.5s collapses
// the repeated probes within one apply window into a single tasklist spawn.
// Safe: `resolveLivePort` only uses the PID set to locate a debug port, and
// a freshly-launched process becomes visible before the next 1.5s window.
// The engine's own `findRunningPids` callers that need real-time liveness
// (e.g. waiting for a killed process to exit) do NOT go through this cache.
interface RunningPidsSnapshot {
  pids: number[];
  capturedAt: number;
}
let cachedRunningPids: RunningPidsSnapshot | null = null;
const RUNNING_PIDS_TTL_MS = 1500;

/**
 * Win32-only. Fetch the full process list (CommandLine + ProcessId) once and
 * cache it for {@link PROCESS_SNAPSHOT_TTL_MS}. Uses `wmic` via the async
 * `execFileAsync` helper — `wmic` is deprecated on Windows 11 24H2+ but is
 * still present and the most broadly compatible option; a future migration
 * to `Get-CimInstance` (PowerShell) can drop in here without touching
 * callers.
 *
 * Returns '' on any failure or on non-win32 platforms so callers can treat
 * the empty case uniformly.
 */
async function snapshotProcesses(): Promise<string> {
  if (process.platform !== 'win32') return '';
  const now = Date.now();
  if (cachedProcessSnapshot && now - cachedProcessSnapshot.capturedAt < PROCESS_SNAPSHOT_TTL_MS) {
    return cachedProcessSnapshot.text;
  }
  // /format:list emits `CommandLine=...\nProcessId=...\n\n` blocks — robust
  // against commas inside the command line (CSV would split on them).
  const out = await execFileAsync(
    'wmic',
    ['process', 'get', 'processid,commandline', '/format:list'],
    8000,
  );
  // Even if the call "succeeded" but returned empty (rare: wmic present but
  // output truncated by timeout), cache the empty result so we don't hammer
  // wmic repeatedly within the TTL window.
  cachedProcessSnapshot = { text: out, capturedAt: now };
  return out;
}

/**
 * Windows-only. Extract explicit `--remote-debugging-port=N` values from the
 * command lines of the given PIDs (via `wmic`, cached). Fast path that hits
 * hosts launched with a fixed debug port directly (e.g. WorkBuddy's
 * per-launch random port). `port=0` (let Chromium pick) is ignored — those
 * need netstat fallback. Returns ports sorted ascending; [] on any failure
 * or non-win32.
 *
 * Async since P1 audit #3: the previous `execSync` blocked the Electron
 * main-process event loop for 0.5–2s per call, and `useBoot`'s 3s poll
 * multiplied that by 4 agents → up to 8s of frozen UI per poll. Now uses
 * {@link snapshotProcesses} (async `execFileAsync` + 1.5s TTL cache) so the
 * 4 agent calls in a single poll share one wmic invocation.
 */
export async function explicitDebugPortsFromPids(pids: number[]): Promise<number[]> {
  if (process.platform !== 'win32' || !pids.length) return [];
  const out = await snapshotProcesses();
  if (!out) return [];
  const wanted = new Set(pids);
  const ports: number[] = [];
  // Blocks are separated by blank lines (CRLF CRLF).
  for (const block of out.split(/\r?\n\s*\r?\n/)) {
    const pidMatch = /ProcessId=(\d+)/.exec(block);
    if (!pidMatch) continue;
    const pid = Number(pidMatch[1]);
    if (!wanted.has(pid)) continue;
    const cmdMatch = /CommandLine=(.*)/s.exec(block);
    if (!cmdMatch) continue;
    const cli = cmdMatch[1];
    const portMatch = /--remote-debugging-port=(\d+)/.exec(cli);
    if (!portMatch) continue;
    const port = Number(portMatch[1]);
    // port=0 means "let Chromium pick" — no explicit value to use here.
    if (Number.isFinite(port) && port >= 1024 && port <= 65535) ports.push(port);
  }
  return [...new Set(ports)].sort((x, y) => x - y);
}

/**
 * Windows-only. Collect the TCP ports that any of the given PIDs is currently
 * LISTENING on (via `netstat -ano`). Last-resort discovery path for hosts
 * that bind an ephemeral debug port (`--remote-debugging-port=0`) and publish
 * a stale DevToolsActivePort file. Best-effort: returns [] on any failure.
 *
 * Only ports bound to the loopback interface are returned: Chromium's CDP
 * endpoint always binds 127.0.0.1 (or [::1]) when launched with
 * --remote-debugging-address=127.0.0.1, so filtering out 0.0.0.0 / public
 * bindings avoids probing IPC ports, Crashpad handlers, extension hosts,
 * and other unrelated listeners that would each waste a 1.2s HTTP probe.
 */
export async function listeningPortsForPids(
  pids: number[],
  options: { bypassCache?: boolean } = {},
): Promise<number[]> {
  if (process.platform !== 'win32' || !pids.length) return [];
  const { bypassCache = false } = options;
  const now = Date.now();
  let out = '';
  if (
    !bypassCache &&
    cachedNetstatSnapshot &&
    now - cachedNetstatSnapshot.capturedAt < NETSTAT_SNAPSHOT_TTL_MS
  ) {
    out = cachedNetstatSnapshot.text;
  } else {
    out = await execFileAsync('netstat', ['-ano']);
    // Even an empty result is cached so a transient netstat failure doesn't
    // hammer the child process within the TTL window.
    cachedNetstatSnapshot = { text: out, capturedAt: now };
  }
  if (!out) return [];
  const wanted = new Set(pids.map((pid) => String(pid)));
  const ports = new Set<number>();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line.includes('LISTENING')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    const pid = parts[parts.length - 1];
    if (!wanted.has(pid)) continue;
    const local = parts[1];
    // Only accept loopback bindings. CDP launched with
    // --remote-debugging-address=127.0.0.1 binds "127.0.0.1:PORT"; IPv6
    // loopback shows as "[::1]:PORT". Skip "0.0.0.0:PORT" and public IPs.
    if (!local.startsWith('127.0.0.1:') && !local.startsWith('[::1]:')) continue;
    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    const port = Number(local.slice(colon + 1));
    if (isPort(port)) ports.add(port);
  }
  return [...ports];
}

/**
 * Narrow adapter interface for resolveLivePort. Avoids importing the full
 * ApplicationAdapter so this module stays decoupled from the adapters layer
 * and is independently testable.
 */
export interface PortDiscoveryAdapter {
  resolveDebugPorts(platform: string): Promise<number[]>;
  findTargets(port: number, timeoutMs?: number): Promise<unknown[]>;
  findRunningPids(platform: string, executable?: string | null): Promise<number[]>;
}

/**
 * Discover the live CDP port for an app without trusting any hardcoded
 * default. Two layers, fastest first:
 *
 *   Layer 1: DevToolsActivePort files (may point at an ephemeral port).
 *   Layer 2: Auto-detection — PID → command line → netstat → /json/list.
 *     (a) Read --remote-debugging-port=N straight from the PID's command
 *         line via wmic. Hits WorkBuddy's per-launch random port directly.
 *     (b) Fall back to netstat PID→listening-ports for apps that use
 *         --remote-debugging-port=0 (Chromium picks the port itself).
 *
 * Returns the port number, or null if no live CDP endpoint is found.
 *
 * @param adapter   the app's adapter (probes DevToolsActivePort + PIDs)
 * @param appId     app id (for log messages only)
 * @param log       logger callback
 * @param knownDeadPort  skip this port (known to be stale from persisted state)
 */
export async function resolveLivePort(
  adapter: PortDiscoveryAdapter,
  appId: string,
  log: (msg: string) => void,
  knownDeadPort: number | null = null,
  options: { bypassCache?: boolean } = {},
): Promise<number | null> {
  const { bypassCache = false } = options;
  // Layer 1: DevToolsActivePort files (may point at an ephemeral port).
  const filePorts = await adapter.resolveDebugPorts(process.platform);
  for (const filePort of filePorts) {
    if (filePort === knownDeadPort) continue;
    // Skip stale DevToolsActivePort entries (left over from a previous launch
    // that had CDP but has since restarted without it, e.g. after an app
    // update) with a fast TCP probe instead of a 1.2s HTTP /json/list timeout
    // against a dead port. Without this, every status() poll and apply attempt
    // wastes ~1.2s on the zombie port before falling through to auto-detect.
    if (!(await probePortLive(filePort, 300))) {
      // Observable: a stale port file is exactly the "silent skip" that made
      // WorkBuddy's failure invisible — state the reason instead of vanishing.
      log(
        `[port] ${appId}: layer 1 (DevToolsActivePort file) — port ${filePort} not listening, skipping (stale file?)`,
      );
      continue;
    }
    try {
      if ((await adapter.findTargets(filePort, 1200)).length) {
        log(`[port] ${appId}: layer 1 (DevToolsActivePort file) — CDP on ${filePort}`);
        return filePort;
      }
    } catch (error) {
      // Try the next candidate — but say why the candidate was rejected.
      log(
        `[port] ${appId}: layer 1 (DevToolsActivePort file) — CDP probe on ${filePort} failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }

  // Layer 2: Auto-detection — PID → command line → netstat → /json/list.
  try {
    const now = Date.now();
    let pids: number[] = [];
    if (
      !bypassCache &&
      cachedRunningPids &&
      now - cachedRunningPids.capturedAt < RUNNING_PIDS_TTL_MS
    ) {
      pids = cachedRunningPids.pids;
    } else {
      pids = await adapter.findRunningPids(process.platform, null);
      cachedRunningPids = { pids, capturedAt: now };
    }

    // (a) Explicit port from argv — fast path.
    const explicitPorts = await explicitDebugPortsFromPids(pids);
    log(
      `[port] ${appId}: layer 2 (PID auto-detect) — ${pids.length} PID(s), ${explicitPorts.length} explicit port(s)`,
    );
    for (const livePort of explicitPorts) {
      if (livePort === knownDeadPort) continue;
      try {
        if ((await adapter.findTargets(livePort, 1200)).length) {
          log(`[port] ${appId}: layer 2 (argv) — CDP found on ${livePort}`);
          return livePort;
        }
      } catch {
        // Explicit port not live yet — fall through to netstat.
      }
    }

    // (b) netstat fallback — catches port=0 apps and argv misses.
    const livePorts = await listeningPortsForPids(pids, { bypassCache });
    log(`[port] ${appId}: layer 2 (netstat) — ${livePorts.length} listening port(s)`);
    for (const livePort of livePorts) {
      if (livePort === knownDeadPort) continue;
      if (explicitPorts.includes(livePort)) continue; // already probed above
      try {
        // netstat ports are a superset of the app's listeners and are usually
        // IPC/gRPC sockets, NOT CDP. Use a short HTTP probe so a non-CDP port
        // fails fast instead of burning the full 1.2s timeout per candidate —
        // a real CDP endpoint answers /json/list in well under 100ms. This
        // keeps the common "many IPC ports, none CDP" case (e.g. WorkBuddy's
        // 5 listeners) from stalling discovery for seconds.
        if ((await adapter.findTargets(livePort, 800)).length) {
          log(`[port] ${appId}: layer 2 (netstat) — CDP found on ${livePort}`);
          return livePort;
        }
      } catch {
        // Try the next candidate.
      }
    }
  } catch {
    // Process-port probing is best-effort.
  }

  // No live CDP endpoint found on any layer. Return null so callers can
  // distinguish "app running without a debug port" from "port N is alive"
  // — pretending any port is usable leads to confusing launch failures.
  // The app must be (re)started with --remote-debugging-port.
  log(`[port] ${appId}: no live CDP port found`);
  return null;
}
