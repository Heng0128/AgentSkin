// SPDX-License-Identifier: MPL-2.0

/**
 * # Inspector Pulse Injector
 *
 * replaces a permanently-exposed CDP debug port with a transient one: the
 * injector sends SIGUSR1 to the renderer process, waits for Chromium to open
 * a temporary inspector port, injects the CSS payload over CDP, then closes the
 * connection — leaving no debug port exposed after the operation completes.
 *
 * ## Pulse lifecycle
 *   1. `process.kill(pid, SIGUSR1)` — asks Chromium to open an inspector port.
 *   2. Poll the `DevToolsActivePort` file (or probe a candidate port range)
 *      until the WebSocket endpoint responds.
 *   3. Open a {@link CdpSession}, inject CSS via `Runtime.evaluate`.
 *   4. Close the CDP session; Chromium auto-closes the port shortly after.
 *
 * ## Persistent mode
 * A long-lived agent registers with `enablePersistentPulse(agentId, css)`.
 * Each time that agent process starts (detected via pid monitoring or a
 * launch hook), one pulse cycle runs automatically. `disablePersistentPulse`
 * unregisters the agent.
 *
 * ## Testability
 * Every side-effecting dependency is injectable through the constructor's
 * `deps` parameter so unit tests run without real processes or sockets.
 */

import { CdpSession } from "../cdp/session.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Default temporary-inspector port range Chromium scans after SIGUSR1. */
const DEFAULT_PORT_RANGE_START = 9222;
const DEFAULT_PORT_RANGE_END = 9322;

/** CDP targets whose `type` is `page` are valid injection targets. */
function isPageTarget(target) {
  return target?.type === "page" || target?.type === undefined;
}

// ---------------------------------------------------------------------------
// Persistent-registry state (module-level, same convention as injector.mjs)
// ---------------------------------------------------------------------------

/** agentId → { css, signal, abortController } */
const persistentAgents = new Map();

/**
 * Read Chromium's DevToolsActivePort file to discover the temporary port.
 * Returns null when the file is absent or malformed.
 */
async function readDevToolsActivePort(portFile) {
  if (!portFile) return null;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(portFile, "utf8");
    const port = Number(raw.split(/\r?\n/, 1)[0].trim());
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Probe a port range to find a live CDP endpoint. Used as a fallback when
 * no DevToolsActivePort file is configured (Chromium inspects a default
 * range after SIGUSR1).
 */
async function discoverPort(portRangeStart, portRangeEnd, timeoutMs, fetchImpl, isPortOccupiedImpl) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (let port = portRangeStart; port <= portRangeEnd; port += 1) {
      if (!(await isPortOccupiedImpl(port))) continue;
      try {
        const response = await fetchImpl(`http://127.0.0.1:${port}/json/version`, {
          signal: AbortSignal.timeout(500),
        });
        if (response.ok) return port;
      } catch {
        // Not a CDP endpoint — keep scanning.
      }
    }
    await delay(200);
  }
  return null;
}

/**
 * Probe a specific port for a live CDP endpoint.
 * Returns true if the port responds to /json/version within the timeout.
 */
async function isPortOccupied(port, timeoutMs = 800) {
  const net = await import("node:net");
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (occupied) => {
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

/** Default CSS injection expression — wraps the raw CSS into a <style> element. */
function buildPulseInjectExpression(css, appId) {
  const cssJson = JSON.stringify(css);
  const appIdJson = JSON.stringify(appId);
  return `(() => {
    const APP_ID = ${appIdJson};
    const existing = document.getElementById('agentskin-pulse-' + APP_ID);
    if (existing) existing.remove();
    const style = document.createElement('style');
    style.id = 'agentskin-pulse-' + APP_ID;
    style.setAttribute('data-agentskin-pulse', '');
    style.textContent = ${cssJson};
    document.documentElement.appendChild(style);
    return { applied: true, appId: APP_ID };
  })()`;
}

/** Default CSS removal expression — removes the injected <style> element. */
function buildPulseRemoveExpression(appId) {
  const appIdJson = JSON.stringify(appId);
  return `(() => {
    const el = document.getElementById('agentskin-pulse-' + ${appIdJson});
    if (el) { el.remove(); return { removed: true }; }
    return { removed: false };
  })()`;
}

// ---------------------------------------------------------------------------
// InspectorPulseInjector
// ---------------------------------------------------------------------------

export class InspectorPulseInjector {
  /**
   * @param {object} [deps] — Injected side-effect dependencies (test seams).
   * @param {(pid: number, signal: NodeJS.Signals) => void} [deps.killFn] — process.kill override.
   * @param {(portFile: string) => Promise<number|null>} [deps.readPortFileFn] — DevToolsActivePort reader.
   * @param {(port: number, timeoutMs?: number) => Promise<boolean>} [deps.isOccupiedFn] — port probe.
   * @param {(start: number, end: number, timeoutMs: number) => Promise<number|null>} [deps.discoverPortFn] — range scanner.
   * @param {typeof fetch} [deps.fetchFn] — HTTP fetch implementation.
   * @param {() => Promise<typeof import("node:fs/promises")>} [deps.fsFn] — fs/promises factory.
   * @param {number} [deps.portRangeStart=9222] — Start of port scan range.
   * @param {number} [deps.portRangeEnd=9322] — End of port scan range.
   */
  constructor(deps = {}) {
    this.killFn = deps.killFn ?? process.kill;
    this.readPortFileFn = deps.readPortFileFn ?? readDevToolsActivePort;
    this.isOccupiedFn = deps.isOccupiedFn ?? isPortOccupied;
    this.discoverPortFn = deps.discoverPortFn ?? discoverPort;
    this.fetchFn = deps.fetchFn ?? globalThis.fetch;
    this.fsFn = deps.fsFn ?? (() => import("node:fs/promises"));
    this.portRangeStart = deps.portRangeStart ?? DEFAULT_PORT_RANGE_START;
    this.portRangeEnd = deps.portRangeEnd ?? DEFAULT_PORT_RANGE_END;
  }

  /**
   * Execute one pulse-injection cycle.
   *
   * @param {number} pid — Target renderer process id.
   * @param {string} css — Raw CSS to inject.
   * @param {object} [options]
   * @param {string} [options.appId] — Agent/skin identifier used as a DOM marker.
   * @param {number} [options.port=0] — Explicit port to use (skip discovery).
   * @param {string} [options.devToolsActivePortFile] — Chromium port file path.
   * @param {number} [options.portDiscoveryTimeoutMs=5000] — Max wait for port.
   * @param {number} [options.cdpTimeoutMs=8000] — CDP command timeout.
   * @param {number} [options.signalTimeoutMs=2000] — Max wait after SIGUSR1.
   * @returns {Promise<{ ok: boolean, port: number|null, targetId: string|null }>}
   */
  async pulseInject(pid, css, options = {}) {
    const {
      appId = "agentskin-pulse",
      port = 0,
      devToolsActivePortFile = "",
      portDiscoveryTimeoutMs = 5000,
      cdpTimeoutMs = 8000,
    } = options;

    // 1. Verify the process exists before signaling.
    try {
      this.killFn(pid, 0);
    } catch (error) {
      const err = new Error(`Process ${pid} does not exist or cannot be signaled: ${error.message}`);
      err.code = "AGENTSKIN_PULSE_PROCESS_NOT_FOUND";
      err.pid = pid;
      throw err;
    }

    // 2. Fire SIGUSR1 to open the inspector port.
    try {
      this.killFn(pid, "SIGUSR1");
    } catch (error) {
      const err = new Error(`Failed to signal process ${pid}: ${error.message}`);
      err.code = "AGENTSKIN_PULSE_SIGNAL_FAILED";
      err.pid = pid;
      throw err;
    }

    // 3. Discover the temporary CDP port.
    let discoveredPort = port;
    if (!discoveredPort) {
      if (devToolsActivePortFile) {
        discoveredPort = await this.#waitForPortFile(devToolsActivePortFile, portDiscoveryTimeoutMs);
      }
      if (!discoveredPort) {
        discoveredPort = await this.#discoverPortWithTimeout(portDiscoveryTimeoutMs);
      }
    }

    if (!discoveredPort) {
      const err = new Error(
        `No CDP port discovered for process ${pid} within ${portDiscoveryTimeoutMs}ms after SIGUSR1.`,
      );
      err.code = "AGENTSKIN_PULSE_PORT_TIMEOUT";
      err.pid = pid;
      throw err;
    }

    // 4. Open the CDP session and inject.
    const targets = await this.#listTargets(discoveredPort, cdpTimeoutMs);
    const pageTargets = targets.filter(isPageTarget);
    if (!pageTargets.length) {
      const err = new Error(`No page target found on port ${discoveredPort} for process ${pid}.`);
      err.code = "AGENTSKIN_PULSE_NO_TARGET";
      err.pid = pid;
      err.port = discoveredPort;
      throw err;
    }

    const target = pageTargets[0];
    const expression = buildPulseInjectExpression(css, appId);
    let session;
    try {
      session = new CdpSession(target, cdpTimeoutMs);
      await session.open();
      const result = await session.evaluate(expression);
      return { ok: true, port: discoveredPort, targetId: target.id, result };
    } catch (error) {
      const err = new Error(`CSS injection failed on port ${discoveredPort}: ${error.message}`);
      err.code = "AGENTSKIN_PULSE_INJECT_FAILED";
      err.pid = pid;
      err.port = discoveredPort;
      err.cause = error;
      throw err;
    } finally {
      session?.close();
    }
  }

  /**
   * Register an agent for persistent pulse injection. Each time the agent
   * process is detected as starting, one `pulseInject` cycle fires.
   *
   * @param {string} agentId — Unique agent identifier.
   * @param {string} css — CSS to inject on each app start.
   * @param {object} [options]
   * @param {number} [options.intervalMs=2000] — Poll interval for pid detection.
   * @param {(agentId: string) => Promise<number[]>} [options.findPidsFn] — Pid discovery.
   */
  enablePersistentPulse(agentId, css, options = {}) {
    if (persistentAgents.has(agentId)) {
      throw new Error(`Persistent pulse already enabled for agent '${agentId}'.`);
    }
    const abortController = new AbortController();
    persistentAgents.set(agentId, { css, abortController, options });
    return { enabled: true, agentId };
  }

  /**
   * Unregister an agent from persistent pulse injection.
   *
   * @param {string} agentId — Agent identifier to disable.
   * @returns {{ disabled: boolean, agentId: string }}
   */
  disablePersistentPulse(agentId) {
    const entry = persistentAgents.get(agentId);
    if (!entry) {
      return { disabled: false, agentId, reason: "not-registered" };
    }
    entry.abortController.abort();
    persistentAgents.delete(agentId);
    return { disabled: true, agentId };
  }

  /** Returns a snapshot of currently-registered persistent agents. */
  listPersistentAgents() {
    return [...persistentAgents.keys()];
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Poll the DevToolsActivePort file until a valid port is written. */
  async #waitForPortFile(portFile, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const port = await this.readPortFileFn(portFile);
      if (port) return port;
      await delay(150);
    }
    return null;
  }

  /** Scan the port range for a live CDP endpoint within the timeout. */
  async #discoverPortWithTimeout(timeoutMs) {
    return this.discoverPortFn(
      this.portRangeStart,
      this.portRangeEnd,
      timeoutMs,
      this.fetchFn,
      this.isOccupiedFn,
    );
  }

  /** Fetch the CDP /json/list endpoint for a port. */
  async #listTargets(port, timeoutMs) {
    const response = await this.fetchFn(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`CDP /json/list returned HTTP ${response.status}.`);
    const targets = await response.json();
    if (!Array.isArray(targets)) throw new Error("CDP response is not an array.");
    return targets;
  }
}

// ---------------------------------------------------------------------------
// Module-level convenience (mirrors injector.mjs export style)
// ---------------------------------------------------------------------------

let defaultInstance = null;

/** Shared singleton for callers that do not need custom dependencies. */
export function getPulseInjector() {
  if (!defaultInstance) defaultInstance = new InspectorPulseInjector();
  return defaultInstance;
}

/** One-shot pulse injection using the default injector. */
export async function pulseInject(pid, css, options = {}) {
  return getPulseInjector().pulseInject(pid, css, options);
}

/** Enable persistent pulse on the default injector. */
export function enablePersistentPulse(agentId, css, options = {}) {
  return getPulseInjector().enablePersistentPulse(agentId, css, options);
}

/** Disable persistent pulse on the default injector. */
export function disablePersistentPulse(agentId) {
  return getPulseInjector().disablePersistentPulse(agentId);
}
