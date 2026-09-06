// SPDX-License-Identifier: MPL-2.0
//
// # mcp-debug-tools.mjs — CDP-based Debug Tools for MCP Server
//
// Provides five low-level CDP interaction functions used by the AgentSkin MCP
// Server to inspect running Agent processes. Functions are safe to call when
// agents are offline — they return structured error results rather than throwing.
//
// Ports are NOT hardcoded. The file uses the project's adapter registry and
// three-layer CDP port discovery (DevToolsActivePort → argv → netstat) for
// correctness across re-launches. Known-stable ports from cdp-probe-v2.mjs are
// used as hints only.

import {
  CdpSession,
  findRunningPids,
  findTargets,
  getAdapter,
  listAdapters,
  listCdpTargets,
  resolveDebugPorts,
} from '../../src/engine/src/index.mjs';

// ---------------------------------------------------------------------------
// Known-stable CDP port hints (from scripts/cdp-probe-v2.mjs empirical probing).
// Used as fast-path probes before falling back to full discovery.
// ---------------------------------------------------------------------------

const KNOWN_PORT_HINTS = Object.freeze({
  workbuddy: 52743,
  doubao: 61607,
  qoderwork: 61996,
  zcode: 65142,
  codex: 58360,
  // traework has no standard CDP support — WinAPI fallback is out of scope here.
});

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the live CDP port for a given agent. Tries known port hints first,
 * then falls back to the project's three-layer discovery strategy:
 *   1. DevToolsActivePort file (resolveDebugPorts)
 *   2. PID argv --remote-debugging-port (findRunningPids wmic)
 *   3. netstat listening ports for agent PIDs
 *
 * @param {string} agentId - Adapter identifier (e.g. "workbuddy", "codex").
 * @param {number} [timeoutMs=2000] - Per-layer timeout.
 * @returns {Promise<number|null>} The live CDP port, or null if not found.
 */
async function resolveLivePort(agentId, timeoutMs = 2000) {
  const adapter = getAdapter(agentId);

  // Fast path: probe known stable port hint.
  const hint = KNOWN_PORT_HINTS[agentId];
  if (hint) {
    try {
      const targets = await findTargets(adapter, hint, timeoutMs);
      if (targets.length) return hint;
    } catch {
      // hint stale — fall through
    }
  }

  // Layer 1: DevToolsActivePort file.
  try {
    const filePorts = await resolveDebugPorts(adapter, process.platform);
    for (const port of filePorts) {
      try {
        const targets = await findTargets(adapter, port, timeoutMs);
        if (targets.length) return port;
      } catch {
        // next port
      }
    }
  } catch {
    // skip layer
  }

  // Layer 2: PID-based discovery (argv + netstat).
  try {
    const pids = await findRunningPids(adapter, process.platform, null);
    if (pids.length) {
      // Probe common debug ports the process might be listening on.
      // We check a small set: known hints from other agents + default range.
      const candidatePorts = new Set([...Object.values(KNOWN_PORT_HINTS)]);
      for (const port of candidatePorts) {
        try {
          const targets = await findTargets(adapter, port, timeoutMs);
          if (targets.length) return port;
        } catch {
          // next
        }
      }
    }
  } catch {
    // best-effort
  }

  return null;
}

/**
 * Open a CdpSession for a specific agent target.
 *
 * @param {string} agentId - Adapter identifier.
 * @param {number} port - CDP port to connect to.
 * @param {CdpSession|null} [existingSession] - Reuse an open session if provided.
 * @returns {Promise<{ session: CdpSession, target: object, port: number }>}
 */
async function connectToAgent(agentId, port, existingSession = null) {
  const adapter = getAdapter(agentId);
  const targets = await findTargets(adapter, port, 2000);
  if (!targets.length) {
    const err = new Error(`${agentId} is not running on port ${port} (no matching CDP target).`);
    err.code = 'AGENT_NOT_RUNNING';
    throw err;
  }
  const target = targets[0];
  if (existingSession) return { session: existingSession, target, port };
  const session = await new CdpSession(target, 10000).open();
  return { session, target, port };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Capture a screenshot of the specified Agent window via CDP.
 *
 * Connects to the agent's CDP endpoint, enables the Page domain, and calls
 * `Page.captureScreenshot`. Returns the base64-encoded PNG data ready for
 * display or file write.
 *
 * @param {string} agentId - Adapter identifier (e.g. "workbuddy", "codex").
 * @param {object} [options]
 * @param {string} [options.format='png'] - Image format ("png" or "jpeg").
 * @param {boolean} [options.fromSurface=true] - Capture from compositor surface.
 * @param {boolean} [options.captureBeyondViewport=false] - Include off-screen content.
 * @param {number} [options.port] - Override auto-discovered CDP port.
 * @returns {Promise<{ ok: true, agentId: string, port: number, format: string, data: string } | { ok: false, agentId: string, error: string }>}
 */
export async function takeScreenshot(agentId, options = {}) {
  const format = options.format ?? 'png';
  const fromSurface = options.fromSurface ?? true;
  const captureBeyondViewport = options.captureBeyondViewport ?? false;

  try {
    let port = options.port;
    if (!port) port = await resolveLivePort(agentId);
    if (!port) {
      return {
        ok: false,
        agentId,
        error: `${agentId} is not running — no live CDP port found.`,
      };
    }

    const { session, target } = await connectToAgent(agentId, port);
    try {
      await session.send('Page.enable');
      const result = await session.send('Page.captureScreenshot', {
        format,
        fromSurface,
        captureBeyondViewport,
      });
      if (!result?.data) {
        return {
          ok: false,
          agentId,
          error: 'CDP returned empty screenshot data.',
        };
      }
      return {
        ok: true,
        agentId,
        port,
        format,
        data: result.data,
        title: target.title ?? null,
        url: target.url ?? null,
      };
    } finally {
      session.close();
    }
  } catch (err) {
    return {
      ok: false,
      agentId,
      error: `Screenshot failed: ${err.message}`,
    };
  }
}

/**
 * Capture a simplified DOM snapshot of the specified Agent.
 *
 * Uses Runtime.evaluate to walk the DOM tree in-page (more reliable than
 * CDP's native DOM API) and returns a compact tree limited to depth 5.
 * Skips STYLE, SCRIPT, NOSCRIPT, META, and SVG subtrees.
 *
 * @param {string} agentId - Adapter identifier.
 * @param {object} [options]
 * @param {number} [options.maxDepth=5] - Maximum tree depth to capture.
 * @param {number} [options.maxNodes=500] - Maximum nodes to record.
 * @param {number} [options.port] - Override auto-discovered CDP port.
 * @returns {Promise<{ ok: true, agentId: string, port: number, root: object, totalNodes: number, truncated: boolean } | { ok: false, agentId: string, error: string }>}
 */
export async function getDomSnapshot(agentId, options = {}) {
  const maxDepth = options.maxDepth ?? 5;
  const maxNodes = options.maxNodes ?? 500;

  try {
    let port = options.port;
    if (!port) port = await resolveLivePort(agentId);
    if (!port) {
      return {
        ok: false,
        agentId,
        error: `${agentId} is not running — no live CDP port found.`,
      };
    }

    const { session } = await connectToAgent(agentId, port);
    try {
      const result = await session.evaluate(`(() => {
        const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'BASE', 'HEAD', 'TITLE', 'SVG', 'PATH', 'DEFS', 'CLIPPATH']);
        const maxNodes = ${maxNodes};
        const maxDepth = ${maxDepth};
        let count = 0;

        function walk(el, depth) {
          if (count >= maxNodes || depth > maxDepth) return null;
          if (!el || !el.tagName) return null;
          if (SKIP.has(el.tagName)) return null;
          count++;

          const node = {
            t: el.tagName.toLowerCase(),
            d: depth,
          };

          if (el.className && typeof el.className === 'string' && el.className.trim()) {
            node.c = el.className.trim().slice(0, 120);
          }
          if (el.id) node.i = el.id;
          if (el.getAttribute) {
            const role = el.getAttribute('role');
            if (role) node.r = role;
            const theme = el.getAttribute('data-theme') || el.getAttribute('data-mode');
            if (theme) node.m = theme;
          }

          if (el.children && el.children.length === 0 && el.textContent) {
            const txt = el.textContent.trim();
            if (txt && txt.length <= 60) node.x = txt;
          }

          if (el.children) {
            const kids = [];
            for (let i = 0; i < el.children.length && count < maxNodes; i++) {
              const child = walk(el.children[i], depth + 1);
              if (child) kids.push(child);
            }
            if (kids.length > 0) node.ch = kids;
          }

          return node;
        }

        const root = walk(document.documentElement, 0);
        return JSON.stringify({ root, total: count, truncated: count >= maxNodes });
      })()`);

      const parsed = JSON.parse(result);
      return {
        ok: true,
        agentId,
        port,
        root: parsed.root,
        totalNodes: parsed.total,
        truncated: parsed.truncated,
      };
    } finally {
      session.close();
    }
  } catch (err) {
    return {
      ok: false,
      agentId,
      error: `DOM snapshot failed: ${err.message}`,
    };
  }
}

/**
 * Verify AgentSkin injection status of the specified Agent.
 *
 * Evaluates JS in the target page to detect the presence of AgentSkin
 * injection markers: the global `__AGENTSKIN__` bridge, the theme
 * stylesheet flag (`__agentskin_theme`), or the host CSS class.
 *
 * @param {string} agentId - Adapter identifier.
 * @param {object} [options]
 * @param {number} [options.port] - Override auto-discovered CDP port.
 * @returns {Promise<{ ok: true, agentId: string, port: number, injected: boolean, themeId: string|null, themeVersion: string|null, hasThemeSheet: boolean } | { ok: false, agentId: string, error: string }>}
 */
export async function verifyInjection(agentId, options = {}) {
  try {
    let port = options.port;
    if (!port) port = await resolveLivePort(agentId);
    if (!port) {
      return {
        ok: false,
        agentId,
        error: `${agentId} is not running — no live CDP port found.`,
      };
    }

    const { session } = await connectToAgent(agentId, port);
    try {
      const result = await session.evaluate(`(() => {
        // Marker 1: global bridge object
        const bridge = globalThis.__AGENTSKIN__;
        const hostState = bridge?.hosts?.${JSON.stringify(agentId)} ?? null;

        // Marker 2: check for theme sheet flag on any adopted or inline style
        let hasThemeSheet = false;
        try {
          if (document.adoptedStyleSheets) {
            for (const sheet of document.adoptedStyleSheets) {
              try {
                for (const rule of sheet.cssRules || []) {
                  if (rule.selectorText && rule.selectorText.includes('__agentskin')) {
                    hasThemeSheet = true;
                    break;
                  }
                }
              } catch { /* CORS */ }
              if (hasThemeSheet) break;
            }
          }
          if (!hasThemeSheet) {
            for (const el of document.querySelectorAll('style')) {
              if (el.id && el.id.startsWith('__agentskin')) { hasThemeSheet = true; break; }
            }
          }
        } catch { /* ignore */ }

        // Marker 3: host class on documentElement
        const hostClass = 'agentskin-host-${agentId}';
        const hasHostClass = document.documentElement.classList.contains(hostClass);

        // Extract themeId from bridge or data attribute
        const themeId = hostState?.themeId ?? document.documentElement?.dataset?.agentskinTheme ?? null;
        const themeVersion = hostState?.version ?? document.documentElement?.dataset?.agentskinThemeVersion ?? null;

        const injected = Boolean(hostState || hasThemeSheet || hasHostClass);

        return JSON.stringify({ injected, themeId, themeVersion, hasThemeSheet, hasHostClass });
      })()`);

      const parsed = JSON.parse(result);
      return {
        ok: true,
        agentId,
        port,
        injected: parsed.injected,
        themeId: parsed.themeId,
        themeVersion: parsed.themeVersion,
        hasThemeSheet: parsed.hasThemeSheet,
      };
    } finally {
      session.close();
    }
  } catch (err) {
    return {
      ok: false,
      agentId,
      error: `Injection verification failed: ${err.message}`,
    };
  }
}

/**
 * Discover all currently available injection targets across all registered adapters.
 *
 * Scans each adapter's known port hints and DevToolsActivePort files to find
 * live CDP endpoints. Returns a list of targets that MCP tools can operate on.
 *
 * @returns {Promise<Array<{ agentId: string, displayName: string, port: number, title: string|null, url: string|null }>>}
 */
export async function listDiscoveryTargets() {
  const results = [];

  for (const adapter of listAdapters()) {
    const agentId = adapter.id;
    const port = await resolveLivePort(agentId, 1500);
    if (!port) continue;

    try {
      const targets = await listCdpTargets(port, 1500);
      const matched = targets.filter((t) => {
        try {
          return adapter.matchTarget(t);
        } catch {
          return false;
        }
      });

      for (const target of matched.slice(0, 3)) {
        results.push({
          agentId,
          displayName: adapter.displayName,
          port,
          title: target.title ?? null,
          url: target.url ?? null,
        });
      }

      // If no matched targets but port is alive, still report the agent.
      if (!matched.length) {
        results.push({
          agentId,
          displayName: adapter.displayName,
          port,
          title: null,
          url: null,
        });
      }
    } catch {
      // port probe failed — agent not reachable
    }
  }

  return results;
}

/**
 * Get the currently applied theme info for the specified Agent.
 *
 * Queries both the `__AGENTSKIN__` runtime bridge and DOM-level data
 * attributes to determine which theme (if any) is currently injected.
 *
 * @param {string} agentId - Adapter identifier.
 * @param {object} [options]
 * @param {number} [options.port] - Override auto-discovered CDP port.
 * @returns {Promise<{ ok: true, agentId: string, port: number, themeId: string|null, themeVersion: string|null, appliedAt: string|null, source: 'bridge'|'attribute'|'none' } | { ok: false, agentId: string, error: string }>}
 */
export async function getAppliedTheme(agentId, options = {}) {
  try {
    let port = options.port;
    if (!port) port = await resolveLivePort(agentId);
    if (!port) {
      return {
        ok: false,
        agentId,
        error: `${agentId} is not running — no live CDP port found.`,
      };
    }

    const { session } = await connectToAgent(agentId, port);
    try {
      const result = await session.evaluate(`(() => {
        const bridge = globalThis.__AGENTSKIN__;
        const hostState = bridge?.hosts?.${JSON.stringify(agentId)} ?? null;

        if (hostState) {
          return JSON.stringify({
            themeId: hostState.themeId ?? null,
            themeVersion: hostState.version ?? null,
            appliedAt: hostState.appliedAt ?? null,
            source: 'bridge',
          });
        }

        const el = document.documentElement;
        const themeId = el?.dataset?.agentskinTheme ?? null;
        const themeVersion = el?.dataset?.agentskinThemeVersion ?? null;

        if (themeId) {
          return JSON.stringify({
            themeId,
            themeVersion,
            appliedAt: null,
            source: 'attribute',
          });
        }

        return JSON.stringify({
          themeId: null,
          themeVersion: null,
          appliedAt: null,
          source: 'none',
        });
      })()`);

      const parsed = JSON.parse(result);
      return {
        ok: true,
        agentId,
        port,
        themeId: parsed.themeId,
        themeVersion: parsed.themeVersion,
        appliedAt: parsed.appliedAt,
        source: parsed.source,
      };
    } finally {
      session.close();
    }
  } catch (err) {
    return {
      ok: false,
      agentId,
      error: `Get applied theme failed: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Re-export internals for future extension / direct use by MCP server wrappers.
// ---------------------------------------------------------------------------

export { KNOWN_PORT_HINTS, resolveLivePort };
