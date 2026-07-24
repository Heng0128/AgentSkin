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

import { execSync } from 'node:child_process';
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
 * Windows-only. Extract explicit `--remote-debugging-port=N` values from the
 * command lines of the given PIDs (via `wmic`). Fast path that hits hosts
 * launched with a fixed debug port directly (e.g. WorkBuddy's per-launch
 * random port). `port=0` (let Chromium pick) is ignored — those need netstat
 * fallback. Returns ports sorted ascending; [] on any failure or non-win32.
 */
export function explicitDebugPortsFromPids(pids: number[]): number[] {
  if (process.platform !== 'win32' || !pids.length) return [];
  let out = '';
  try {
    // /format:list emits `CommandLine=...\nProcessId=...\n\n` blocks — robust
    // against commas inside the command line (CSV would split on them).
    out = execSync('wmic process get processid,commandline /format:list', {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
  } catch {
    return [];
  }
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
    if (isFinite(port) && port >= 1024 && port <= 65535) ports.push(port);
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
export async function listeningPortsForPids(pids: number[]): Promise<number[]> {
  if (process.platform !== 'win32' || !pids.length) return [];
  const out = await execFileAsync('netstat', ['-ano']);
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
): Promise<number | null> {
  // Layer 1: DevToolsActivePort files (may point at an ephemeral port).
  const filePorts = await adapter.resolveDebugPorts(process.platform);
  for (const filePort of filePorts) {
    if (filePort === knownDeadPort) continue;
    try {
      if ((await adapter.findTargets(filePort, 1200)).length) {
        log(`[port] ${appId}: layer 1 (DevToolsActivePort file) — CDP on ${filePort}`);
        return filePort;
      }
    } catch {
      // Try the next candidate.
    }
  }

  // Layer 2: Auto-detection — PID → command line → netstat → /json/list.
  try {
    const pids = await adapter.findRunningPids(process.platform, null);

    // (a) Explicit port from argv — fast path.
    const explicitPorts = explicitDebugPortsFromPids(pids);
    log(`[port] ${appId}: layer 2 (PID auto-detect) — ${pids.length} PID(s), ${explicitPorts.length} explicit port(s)`);
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
    const livePorts = await listeningPortsForPids(pids);
    log(`[port] ${appId}: layer 2 (netstat) — ${livePorts.length} listening port(s)`);
    for (const livePort of livePorts) {
      if (livePort === knownDeadPort) continue;
      if (explicitPorts.includes(livePort)) continue; // already probed above
      try {
        if ((await adapter.findTargets(livePort, 1200)).length) {
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
