// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Tools (5 tools)
 *
 * Provides direct Chrome DevTools Protocol access to target agents:
 *   - get-dom-snapshot   — capture a structural DOM snapshot via CDP
 *   - take-screenshot    — capture a screenshot of the target page via CDP
 *   - verify-injection   — verify that AgentSkin CSS variables are present
 *   - get-computed-style — read computed CSS styles for a specific selector
 *   - highlight-element  — overlay-style element highlight in the live page
 *
 * ## Service access note
 *
 * All five tools resolve the agent's CDP debug port from `ctx.core.status()`
 * and then use the standalone CDP helpers (`findDomTargets`, `connectCdp`)
 * from `src/main/cdp/`. No Electron modules are imported — the MCP context
 * carries the port reference.
 */

import { z } from 'zod';
import { connectCdp } from '../../cdp/cdp-client';
import { findDomTargets } from '../../cdp/cdp-targets';
import type { McpToolDefinition } from '../tool-registry';
import { registerTool } from '../tool-registry';
import type { McpContext, McpToolResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** AgentSkin-injected CSS custom properties (14-token contract). */
const AGENTSKIN_CSS_VARS = [
  '--agentskin-bg',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-text',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-button-text',
  '--agentskin-focus-ring',
];

/**
 * Resolve the CDP debug port for an agent from the engine status.
 * Returns `null` when the agent is unknown or has no debug port.
 */
async function resolvePort(ctx: McpContext, agentId: string): Promise<number | null> {
  const status = await ctx.core.status();
  const app = status.apps.find((a) => a.appId === agentId);
  return app?.port ?? null;
}

/**
 * Connect to the first DOM-bearing CDP target for the given port.
 * Returns `null` when no target is available or the connection fails.
 */
async function connectToDom(port: number, commandTimeoutMs = 10000) {
  const targets = await findDomTargets(port);
  const wsTarget = targets.find((t) => Boolean(t.webSocketDebuggerUrl));
  if (!wsTarget?.webSocketDebuggerUrl) return null;
  return connectCdp(wsTarget.webSocketDebuggerUrl, 5000, commandTimeoutMs);
}

// ---------------------------------------------------------------------------
// get-dom-snapshot
// ---------------------------------------------------------------------------

const getDomSnapshotSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  max_nodes: z.number().int().positive().max(5000).optional(),
});

async function getDomSnapshotHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id, max_nodes } = getDomSnapshotSchema.parse(args);
  try {
    const port = await resolvePort(ctx, agent_id);
    if (!port) {
      return fail(
        `Agent "${agent_id}" has no CDP debug port — is it running with --remote-debugging-port?`,
      );
    }

    // Inline DOM walk (mirrors the engine's dom-snapshot contract):
    //  - captures tag, classes, bounding box, visibility, selector candidates
    //  - skips script/style/link/meta/svg internals
    //  - bounds depth + node count for predictable latency
    const maxNodes = max_nodes ?? 500;
    const walkExpr = buildDomWalkExpr(maxNodes, 12);

    const session = await connectToDom(port);
    if (!session) {
      return fail(`No DOM-bearing CDP target found on port ${port}`);
    }

    try {
      const result = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: walkExpr,
        returnByValue: true,
        awaitPromise: true,
      });

      const raw = result?.result?.value;
      let elements: unknown[] = [];
      let totalWalked = 0;
      if (raw && typeof raw === 'string' && raw !== 'null') {
        try {
          const parsed = JSON.parse(raw) as { elements?: unknown[]; totalWalked?: number };
          elements = parsed.elements ?? [];
          totalWalked = parsed.totalWalked ?? 0;
        } catch {
          // Malformed result — leave elements empty
        }
      }

      return ok({
        agent_id,
        port,
        elements,
        count: elements.length,
        total_walked: totalWalked,
        status: elements.length > 0 ? 'captured' : 'empty',
      });
    } finally {
      session.close();
    }
  } catch (err) {
    return fail(
      `Failed to capture DOM snapshot: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Build a self-contained DOM walk expression that runs via Runtime.evaluate.
 * Captures the same structural data as the engine's dom-snapshot: tag,
 * semantic classes, bounding box, visibility, and selector candidates.
 */
function buildDomWalkExpr(maxNodes: number, maxDepth: number): string {
  return `(async function(){
    var MAX_EL = ${maxNodes};
    var MAX_DEPTH = ${maxDepth};
    var SKIP = ['script','style','link','meta','noscript','template','svg','path','use','symbol','defs','clippath','mask','filter','stop','lineargradient','radialgradient'];
    var count = 0;
    var results = [];

    function isSemanticClass(c){
      if (!c) return false;
      if (/[-_A-Z]/.test(c)) return true;
      if (/^(css|sc|cx|-[a-z0-9]{4,})$/i.test(c)) return false;
      if (/^[a-z0-9]{1,3}$/i.test(c)) return false;
      return true;
    }

    function buildCandidates(el){
      var cands = [];
      var id = el.id;
      if (id && /^[a-zA-Z]/.test(id) && !/[^a-zA-Z0-9_-]/.test(id)) {
        cands.push({ selector: '#' + id, kind: 'id', unique: true });
      }
      var testid = el.getAttribute && el.getAttribute('data-testid');
      if (testid) {
        cands.push({ selector: '[data-testid="' + testid.replace(/"/g, '\\\\"') + '"]', kind: 'data-testid', unique: true });
      }
      var role = el.getAttribute && el.getAttribute('role');
      if (role) {
        cands.push({ selector: '[role="' + role + '"]', kind: 'role', unique: false });
      }
      var cls = el.getAttribute && el.getAttribute('class');
      if (cls) {
        var parts = cls.split(/\\s+/).filter(function(c){ return isSemanticClass(c); });
        if (parts.length > 0) {
          cands.push({ selector: '.' + parts[0], kind: 'class', unique: false });
        }
      }
      return cands;
    }

    function walk(el, depth){
      if (!el || count >= MAX_EL || depth > MAX_DEPTH) return;
      if (el.nodeType !== 1) return;
      var tag = (el.tagName || 'div').toLowerCase();
      if (SKIP.indexOf(tag) !== -1) return;
      count++;
      var r = el.getBoundingClientRect();
      var cs = window.getComputedStyle(el);
      var cls = el.getAttribute ? (el.getAttribute('class') || '') : '';
      var classNames = cls.split(/\\s+/).filter(function(c){ return isSemanticClass(c); });
      var cands = buildCandidates(el);
      var best = cands.length > 0 ? cands[0].selector : tag;
      results.push({
        selector: best,
        tagName: tag,
        classNames: classNames,
        boundingBox: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
        isVisible: cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && (r.width > 0 || r.height > 0),
        selectorCandidates: cands,
        depth: depth,
        childCount: el.children ? el.children.length : 0
      });
      var kids = el.children;
      for (var k = 0; k < kids.length; k++) walk(kids[k], depth + 1);
      if (el.shadowRoot && el.shadowRoot.mode === 'open') {
        var sk = el.shadowRoot.children;
        for (var s = 0; s < sk.length; s++) walk(sk[s], depth + 1);
      }
    }

    var root = document.body;
    if (!root) return JSON.stringify({ elements: [], totalWalked: 0 });
    walk(root, 0);
    return JSON.stringify({ elements: results, totalWalked: count });
  })()`;
}

// ---------------------------------------------------------------------------
// take-screenshot
// ---------------------------------------------------------------------------

const takeScreenshotSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  full_page: z.boolean().optional(),
});

async function takeScreenshotHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id, full_page } = takeScreenshotSchema.parse(args);
  try {
    const port = await resolvePort(ctx, agent_id);
    if (!port) {
      return fail(
        `Agent "${agent_id}" has no CDP debug port — is it running with --remote-debugging-port?`,
      );
    }

    const session = await connectToDom(port);
    if (!session) {
      return fail(`No DOM-bearing CDP target found on port ${port}`);
    }

    try {
      // Enable Page domain, capture screenshot, return base64 data URL.
      await session.send('Page.enable', {}).catch(() => {});
      const result = await session.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: full_page ?? false,
      });

      return ok({
        agent_id,
        port,
        format: 'png',
        mime: 'image/png',
        data_url: `data:image/png;base64,${result.data}`,
        full_page: full_page ?? false,
      });
    } finally {
      session.close();
    }
  } catch (err) {
    return fail(
      `Failed to capture screenshot: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// verify-injection
// ---------------------------------------------------------------------------

const verifyInjectionSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
});

async function verifyInjectionHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id } = verifyInjectionSchema.parse(args);
  try {
    const port = await resolvePort(ctx, agent_id);
    if (!port) {
      return fail(
        `Agent "${agent_id}" has no CDP debug port — is it running with --remote-debugging-port?`,
      );
    }

    const session = await connectToDom(port);
    if (!session) {
      return fail(`No DOM-bearing CDP target found on port ${port}`);
    }

    try {
      // Probe for AgentSkin CSS custom properties on :root.
      const probeExpr = `(function(){
        var vars = ${JSON.stringify(AGENTSKIN_CSS_VARS)};
        var cs = getComputedStyle(document.documentElement);
        var found = {};
        var missing = [];
        for (var i = 0; i < vars.length; i++) {
          var v = cs.getPropertyValue(vars[i]).trim();
          if (v) { found[vars[i]] = v; }
          else { missing.push(vars[i]); }
        }
        // Also check for the agentskin-host-<agent> marker class on <html>.
        var htmlClasses = document.documentElement.className || '';
        var hostMarker = /agentskin-host-\\S+/.test(htmlClasses);
        return JSON.stringify({
          injected: Object.keys(found).length > 0 || hostMarker,
          variables_found: found,
          variables_missing: missing,
          host_marker: hostMarker,
          html_classes: htmlClasses
        });
      })()`;

      const result = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: probeExpr,
        returnByValue: true,
      });

      const raw = result?.result?.value;
      if (raw && typeof raw === 'string' && raw !== 'null') {
        const parsed = JSON.parse(raw) as {
          injected: boolean;
          variables_found: Record<string, string>;
          variables_missing: string[];
          host_marker: boolean;
          html_classes: string;
        };
        return ok({
          agent_id,
          port,
          ...parsed,
          total_variables: AGENTSKIN_CSS_VARS.length,
          found_count: Object.keys(parsed.variables_found).length,
          status: parsed.injected ? 'injected' : 'not-injected',
        });
      }

      return ok({
        agent_id,
        port,
        injected: false,
        variables_found: {},
        variables_missing: AGENTSKIN_CSS_VARS.length,
        status: 'unknown',
        message: 'Could not evaluate CSS variables — page may be empty or cross-origin',
      });
    } finally {
      session.close();
    }
  } catch (err) {
    return fail(`Failed to verify injection: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// get-computed-style
// ---------------------------------------------------------------------------

const getComputedStyleSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  selector: z.string().min(1, 'selector is required'),
  computed_properties: z.array(z.string()).optional(),
});

const COMPUTED_STYLE_DEFAULT_PROPS = [
  'background-color',
  'color',
  'border-color',
  'border-width',
  'border-radius',
  'box-shadow',
  'display',
  'position',
  'visibility',
  'opacity',
  'overflow',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'width',
  'height',
  'margin',
  'padding',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'text-align',
  'z-index',
  'transform',
  'cursor',
] as const;

async function getComputedStyleHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id, selector, computed_properties } = getComputedStyleSchema.parse(args);
  try {
    const port = await resolvePort(ctx, agent_id);
    if (!port) {
      return fail(
        `Agent "${agent_id}" has no CDP debug port — is it running with --remote-debugging-port?`,
      );
    }

    const session = await connectToDom(port);
    if (!session) {
      return fail(`No DOM-bearing CDP target found on port ${port}`);
    }

    try {
      const props = computed_properties ?? [...COMPUTED_STYLE_DEFAULT_PROPS];
      const expr = `(function(){
        var props = ${JSON.stringify(props)};
        var el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return JSON.stringify({ error: 'Selector matched no element: ${selector.replace(/'/g, "\\'")}' });
        var cs = window.getComputedStyle(el);
        var style = {};
        for (var i = 0; i < props.length; i++) {
          var v = cs.getPropertyValue(props[i]);
          if (v) style[props[i]] = v;
        }
        var r = el.getBoundingClientRect();
        return JSON.stringify({
          selector: ${JSON.stringify(selector)},
          tagName: el.tagName.toLowerCase(),
          style: style,
          boundingBox: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
        });
      })()`;

      const result = await session.send<{ result?: { value?: string } }>('Runtime.evaluate', {
        expression: expr,
        returnByValue: true,
      });

      const raw = result?.result?.value;
      if (raw && typeof raw === 'string' && raw !== 'null') {
        const parsed = JSON.parse(raw) as {
          error?: string;
          selector?: string;
          tagName?: string;
          style?: Record<string, string>;
          boundingBox?: { x: number; y: number; width: number; height: number };
        };
        if (parsed.error) {
          return fail(parsed.error);
        }
        return ok({
          agent_id,
          port,
          ...parsed,
          property_count: Object.keys(parsed.style ?? {}).length,
        });
      }

      return fail('Failed to evaluate computed style — empty result from CDP');
    } finally {
      session.close();
    }
  } catch (err) {
    return fail(
      `Failed to get computed style: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// highlight-element
// ---------------------------------------------------------------------------

const highlightElementSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
  selector: z.string().min(1, 'selector is required'),
});

async function highlightElementHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id, selector } = highlightElementSchema.parse(args);
  try {
    const port = await resolvePort(ctx, agent_id);
    if (!port) {
      return fail(
        `Agent "${agent_id}" has no CDP debug port — is it running with --remote-debugging-port?`,
      );
    }

    const session = await connectToDom(port);
    if (!session) {
      return fail(`No DOM-bearing CDP target found on port ${port}`);
    }

    try {
      // Resolve the selector to a DOM node ID, then highlight via Overlay domain.
      const { nodeId } = await session.send<{ nodeId: number }>('DOM.querySelector', {
        nodeId: 1,
        selector,
      });

      if (!nodeId || nodeId <= 0) {
        return fail(`Selector matched no element: "${selector}"`);
      }

      await session.send('Overlay.enable', {}).catch(() => {});
      await session.send('Overlay.highlightNode', {
        nodeId,
        highlightConfig: {
          showInfo: true,
          showStyles: true,
          contentColor: { r: 59, g: 130, b: 246, a: 0.28 },
          paddingColor: { r: 59, g: 130, b: 246, a: 0.18 },
          borderColor: { r: 59, g: 130, b: 246, a: 0.85 },
          marginColor: { r: 59, g: 130, b: 246, a: 0.1 },
          eventTargetColor: { r: 59, g: 130, b: 246, a: 0.3 },
          shapeColor: { r: 59, g: 130, b: 246, a: 0.3 },
          selectorColor: { r: 59, g: 130, b: 246, a: 0.3 },
        },
      });

      return ok({
        agent_id,
        port,
        selector,
        node_id: nodeId,
        status: 'highlighted',
        message: `Element "${selector}" highlighted. Press Escape or click elsewhere to dismiss.`,
      });
    } finally {
      // Attempt to dismiss the highlight and clean up the Overlay domain.
      try {
        await session.send('Overlay.hideHighlight', {});
        await session.send('Overlay.disable', {});
      } catch {
        // Best-effort cleanup
      }
      session.close();
    }
  } catch (err) {
    return fail(`Failed to highlight element: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all CDP tools in the global tool registry.
 *
 * Call this function once during MCP initialization to make the five CDP
 * access tools available to MCP clients.
 */
export function registerCdpTools(): void {
  registerTool({
    name: 'get-dom-snapshot',
    description:
      'Capture a structural DOM snapshot of a running agent via CDP. ' +
      'Returns element tree with selectors, bounding boxes, and visibility flags.',
    inputSchema: getDomSnapshotSchema,
    handler: getDomSnapshotHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'take-screenshot',
    description:
      'Capture a screenshot of a running agent via CDP Page.captureScreenshot. ' +
      'Returns a base64 data URL in PNG format.',
    inputSchema: takeScreenshotSchema,
    handler: takeScreenshotHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'verify-injection',
    description:
      'Verify that AgentSkin CSS variables (--agentskin-*) are present on a running agent. ' +
      'Reports which of the 14-token variables are found, plus host-marker class status.',
    inputSchema: verifyInjectionSchema,
    handler: verifyInjectionHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'get-computed-style',
    description:
      'Read computed CSS styles for a specific selector in a running agent. ' +
      'Returns the resolved style object and viewport bounding box.',
    inputSchema: getComputedStyleSchema,
    handler: getComputedStyleHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'highlight-element',
    description:
      'Highlight an element in the running agent using CDP Overlay domain ' +
      '(DevTools-style inspect highlight with content/padding/margin overlays).',
    inputSchema: highlightElementSchema,
    handler: highlightElementHandler,
  } satisfies McpToolDefinition);
}
