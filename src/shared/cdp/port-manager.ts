// SPDX-License-Identifier: MPL-2.0

/**
 * CDP port manager — automatic port selection with conflict avoidance.
 *
 * Provides a lightweight allocation layer so that multiple agents can each
 * receive a dedicated CDP port without manual configuration. When the preferred
 * port is already in use, the manager scans a configurable fallback range and
 * returns the first free port.
 *
 * Design notes:
 *   - Uses Node.js built-in `net` module only — no external dependencies.
 *   - `isPortAvailable` attempts to bind+listen on 127.0.0.1; a successful bind
 *     means the port is free. The server is closed immediately after detection
 *     so the caller can actually use the port.
 *   - Allocation state is tracked in a module-level Map so concurrent agents
 *     never receive the same port.
 *   - The manager does NOT probe for CDP endpoints — it only checks raw TCP
 *     availability. CDP liveness is the caller's responsibility.
 */

import net from 'node:net';

/** Configuration for port allocation. */
export interface PortConfig {
  /** Preferred port to try first (e.g. 9335). */
  preferred: number;
  /** Inclusive [start, end] range for fallback port scanning. */
  fallbackRange: [number, number];
}

/** Default port configuration — preferred 9335, fallback 9335-9350. */
export const DEFAULT_PORT_CONFIG: PortConfig = {
  preferred: 9335,
  fallbackRange: [9335, 9350],
};

/**
 * Check whether a TCP port is available for binding on 127.0.0.1.
 *
 * Strategy: attempt to create a server, listen on the port, and immediately
 * close it. A successful listen means no other process holds the port.
 *
 * @param port  TCP port number to check.
 * @returns     `true` if the port is free, `false` if in use or invalid.
 */
export function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    // Reject invalid ports early — no point trying to bind port 0 or negatives.
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      resolve(false);
      return;
    }

    const server = net.createServer();
    server.once('error', () => {
      // EADDRINUSE (or any other bind error) → port is not available.
      resolve(false);
    });
    server.once('listening', () => {
      // Successfully bound — close and report available.
      server.close(() => resolve(true));
      // close() is async; if it errors we still resolve(true) because the
      // bind itself succeeded, which is the signal we care about.
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find the first available port, trying `preferred` first then scanning
 * `fallbackRange` in ascending order.
 *
 * @param preferred     Port to try first.
 * @param fallbackRange Inclusive [start, end] range for fallback scanning.
 * @param excludedPorts Optional set of ports to skip (e.g. already allocated
 *                      to other agents but not yet bound at the TCP level).
 * @returns             The first free port, or `null` if none found.
 */
export async function findFreePort(
  preferred: number,
  fallbackRange: [number, number],
  excludedPorts?: ReadonlySet<number>,
): Promise<number | null> {
  // Try the preferred port first.
  if (!excludedPorts?.has(preferred) && (await isPortAvailable(preferred))) {
    return preferred;
  }

  const [start, end] = fallbackRange;
  const lower = Math.min(start, end);
  const upper = Math.max(start, end);

  for (let port = lower; port <= upper; port++) {
    if (port === preferred) continue; // already tried
    if (excludedPorts?.has(port)) continue; // allocated to another agent
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  // No free port in the entire range.
  return null;
}

/**
 * Allocation record — tracks which agent holds which port.
 */
interface AllocationRecord {
  agentId: string;
  port: number;
  allocatedAt: number;
}

/**
 * Module-level allocation map: agentId → AllocationRecord.
 * Persists for the lifetime of the process (matches Electron main-process model).
 */
const allocations = new Map<string, AllocationRecord>();

/**
 * Set of currently allocated port numbers. Mirrors the keys of `allocations`
 * for O(1) lookup by port. `findFreePort` consults this set to avoid returning
 * a port that is already assigned to another agent but not yet bound at the
 * TCP level (the manager tracks logical ownership, not just OS-level binding).
 */
const allocatedPorts = new Set<number>();

/**
 * Allocate a dedicated CDP port for the given agent.
 *
 * Tries the preferred port first, then scans the fallback range. The
 * allocation is recorded internally so subsequent calls for the same agentId
 * return the cached port instead of assigning a new one.
 *
 * @param agentId  Unique agent identifier (e.g. "traework", "workbuddy").
 * @param config   Port configuration (preferred + fallback range).
 * @returns        The allocated port number, or `null` if no port is free.
 */
export async function allocatePort(
  agentId: string,
  config: PortConfig = DEFAULT_PORT_CONFIG,
): Promise<number | null> {
  // Return cached allocation if one exists and the port is still free.
  const existing = allocations.get(agentId);
  if (existing && (await isPortAvailable(existing.port))) {
    return existing.port;
  }
  // If the cached port is now taken, drop the stale record.
  if (existing) {
    allocations.delete(agentId);
  }

  const port = await findFreePort(config.preferred, config.fallbackRange, allocatedPorts);
  if (port === null) return null;

  allocations.set(agentId, { agentId, port, allocatedAt: Date.now() });
  allocatedPorts.add(port);
  return port;
}

/**
 * Release the port allocated to the given agent.
 *
 * Does NOT close any server that may be listening on the port — it only
 * removes the bookkeeping record. The caller is responsible for shutting
 * down the actual CDP server.
 *
 * @param agentId  Unique agent identifier.
 * @returns        `true` if an allocation was found and removed, `false` otherwise.
 */
export function releasePort(agentId: string): boolean {
  const record = allocations.get(agentId);
  if (!record) return false;
  allocations.delete(agentId);
  allocatedPorts.delete(record.port);
  return true;
}

/**
 * Return a snapshot of all current allocations.
 * Useful for diagnostics and debugging.
 */
export function listAllocations(): ReadonlyArray<AllocationRecord> {
  return [...allocations.values()];
}

/**
 * Clear all allocations. Intended for testing only.
 */
export function __clearAllocationsForTests(): void {
  allocations.clear();
  allocatedPorts.clear();
}
