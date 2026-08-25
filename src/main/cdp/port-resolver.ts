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

import net from 'node:net';

const MIN_PORT = 1024;
const MAX_PORT = 65535;
const DEFAULT_MAX_ATTEMPTS = 100;
const DEFAULT_TIMEOUT_MS = 2000;
const CONNECT_PROBE_TIMEOUT_MS = 500;

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

  async findAvailablePort(preferredPort: number): Promise<number> {
    const start = Math.max(MIN_PORT, Math.min(MAX_PORT, preferredPort));
    for (let i = 0; i < this.maxAttempts; i++) {
      const port = start + i;
      if (port > MAX_PORT) break;
      if ((await this.checkPort(port)).available) return port;
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
