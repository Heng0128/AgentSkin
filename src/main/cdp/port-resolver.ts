// SPDX-License-Identifier: MPL-2.0

/**
 * # port-resolver
 *
 * CDP port availability detection, auto-increment, and lease management.
 *
 * Three responsibilities:
 *   1. **Port checker** — TCP bind + connect probe with Windows ghost-listen
 *      detection (bind succeeds but connect also succeeds = port reserved by
 *      the system without a live process).
 *   2. **Port finder** — starting from a preferred port, walk forward until an
 *      available port is found or the attempt budget is exhausted.
 *   3. **Lease manager** — track rented ports to prevent double-allocation
 *      within the same resolver instance.
 *
 * All network operations are bounded by a configurable timeout to avoid
 * blocking the main process when probing unresponsive ports.
 */

import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_MAX_ATTEMPTS = 100;
const DEFAULT_TIMEOUT_MS = 2000;
const CONNECT_PROBE_TIMEOUT_MS = 500;
const DEFAULT_DEBUG_PORT = 9222;

export interface PortStatus {
  port: number;
  available: boolean;
  reason?: 'in-use' | 'ghost-listen' | 'out-of-range' | 'permission-denied';
}

export interface PortResolverOptions {
  startPort?: number;
  maxAttempts?: number;
  timeoutMs?: number;
}

export class PortResolver {
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  private readonly rented = new Set<number>();

  constructor(options: PortResolverOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async checkPort(port: number): Promise<PortStatus> {
    if (port < MIN_PORT || port > MAX_PORT) {
      return { port, available: false, reason: 'out-of-range' };
    }
    if (this.rented.has(port)) {
      return { port, available: false, reason: 'in-use' };
    }
    if (!(await this.tryBind(port))) {
      return { port, available: false, reason: 'in-use' };
    }
    if (await this.tryConnect(port)) {
      return { port, available: false, reason: 'ghost-listen' };
    }
    return { port, available: true };
  }

  async findAvailablePort(preferredPort: number, appPath?: string): Promise<number> {
    const start = Math.max(MIN_PORT, Math.min(MAX_PORT, preferredPort));
    for (let i = 0; i < this.maxAttempts; i++) {
      const port = start + i;
      if (port > MAX_PORT) break;
      if ((await this.checkPort(port)).available) return port;
    }
    // Fallback: try DevToolsActivePort file when TCP walk exhausts.
    // Hosts that force `remote-debugging-port=0` (e.g. QoderWork) publish
    // their ephemeral port exclusively through this file.
    if (appPath) {
      const filePort = await resolveDevToolsActivePort(appPath);
      if (filePort != null && (await this.checkPort(filePort)).available) return filePort;
    }
    throw new Error(
      `No available port found starting from ${preferredPort} after ${this.maxAttempts} attempts`,
    );
  }

  async rentPort(port: number): Promise<boolean> {
    if (this.rented.has(port)) return false;
    if (!(await this.checkPort(port)).available) return false;
    this.rented.add(port);
    return true;
  }

  releasePort(port: number): void {
    this.rented.delete(port);
  }

  get rentedPorts(): ReadonlySet<number> {
    return new Set(this.rented);
  }

  private tryBind(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close(() => resolve(false));
        }
      }, this.timeoutMs);
      server.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close();
        resolve(false);
      });
      server.listen(port, '127.0.0.1', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        server.close(() => resolve(true));
      });
    });
  }

  private tryConnect(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          resolve(false);
        }
      }, CONNECT_PROBE_TIMEOUT_MS);
      socket.on('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(false);
      });
    });
  }
}

/**
 * Build the platform-specific path to Chromium's DevToolsActivePort file
 * for a given app. Chromium writes this file to its user-data directory
 * when launched with `--remote-debugging-port` (including port=0).
 *
 *   - macOS:   ~/Library/Application Support/<appPath>/DevToolsActivePort
 *   - Windows: %LOCALAPPDATA%\<appPath>\DevToolsActivePort
 *   - Linux:   ~/.config/<appPath>/DevToolsActivePort
 *
 * `appPath` is the per-app segment (e.g. "QoderWork", "TRAE SOLO") and is
 * joined onto the platform base — callers pass the same identifier they
 * use in their adapter's `devToolsActivePortFile` config.
 */
export function buildDevToolsActivePortPath(appPath: string): string {
  const home = os.homedir();
  const platform = process.platform;
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', appPath, 'DevToolsActivePort');
  }
  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    return path.join(localAppData, appPath, 'DevToolsActivePort');
  }
  return path.join(home, '.config', appPath, 'DevToolsActivePort');
}

/**
 * Read Chromium's DevToolsActivePort file and return the port number.
 *
 * Returns null when the file does not exist, cannot be read, or contains
 * an invalid port value. The file format is a single line with the port
 * number (optionally followed by a newline), per Chromium's implementation.
 *
 * @param appPath  per-app segment passed to {@link buildDevToolsActivePortPath}
 */
export async function resolveDevToolsActivePort(appPath: string): Promise<number | null> {
  try {
    const filePath = buildDevToolsActivePortPath(appPath);
    const raw = await fs.readFile(filePath, 'utf8');
    const port = Number(raw.split(/\r?\n/, 1)[0].trim());
    return Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT ? port : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the debug port for an app using a three-tier strategy:
 *
 *   1. `preferredPort` — caller-chosen port (highest priority).
 *   2. DevToolsActivePort file — auto-discovered from the app's user-data dir.
 *   3. `defaultPort` (9222) — last-resort fallback.
 *
 * This handles the `remote-debugging-port=0` scenario where Chromium picks
 * an ephemeral port and publishes it exclusively through the DevToolsActivePort
 * file (e.g. QoderWork). The file-based discovery is skipped when `appPath`
 * is not provided.
 */
export async function resolveDebugPort(options: {
  appPath?: string;
  preferredPort?: number;
  defaultPort?: number;
}): Promise<number> {
  const { appPath, preferredPort, defaultPort = DEFAULT_DEBUG_PORT } = options;
  if (preferredPort != null && Number.isInteger(preferredPort)) {
    return preferredPort;
  }
  if (appPath) {
    const filePort = await resolveDevToolsActivePort(appPath);
    if (filePort != null) return filePort;
  }
  return defaultPort;
}
