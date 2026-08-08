// SPDX-License-Identifier: MPL-2.0

/**
 * # CDP Theme Snapshot — DevTools-grade DOM Visual Probe
 *
 * Drives the Theme Studio's replica pipeline:
 * 1. Apply the target theme to a running agent via core's applySkin.
 * 2. Connect to CDP, enable the CSS + DOM domains (the same stack Chrome
 *    DevTools uses), and resolve each landmark selector to a real DOM nodeId.
 * 3. For each landmark node, capture its full cascade via
 *    `captureNodeCascade` (matched rules w/ selector+origin+!important,
 *    authoritative computed values, actually-rendered fonts, protocol box
 *    model). See `node-cascade.ts`.
 * 4. Aggregate into a `ThemeVisualSnapshot` that the frontend renders as a
 *    mock DOM replica and inspects like DevTools' Elements panel.
 *
 * IMPORTANT: This is a read-only probe. It never modifies the live CDP session;
 * it connects fresh per call and closes immediately. If the CSS/DOM domains
 * are unavailable it degrades gracefully to a `Runtime.evaluate` probe so the
 * feature never regresses.
 */

import type { ApplicationAdapter } from '../../adapters/base';
import type {
  AgentId,
  CssMatchedRule,
  DomTreeNode,
  LandmarkSnapshot,
  NodeCascade,
  StudioSnapshotOptions,
  ThemeVisualSnapshot,
} from '../../shared/types';
import { type CdpSession, connectCdp } from './cdp-client';
import { findDomTargets } from './cdp-targets';
import { captureDomTree } from './dom-tree';
import { captureNodeCascade, compactStylesFromComputed } from './node-cascade';

// Re-export so existing importers (preload) keep working via this module.
export type { LandmarkSnapshot, ThemeVisualSnapshot } from '../../shared/types';

// ---------------------------------------------------------------------------
// Small CDP probe helpers for the Runtime.evaluate fall-back path.
//
// These are not shared types because they only describe the ad-hoc shapes
// returned by the inline functions in `captureLandmarkRuntimeProbe` — they
// live locally so we can replace the `as any` casts with named types, which
// keeps Biome's noExplicitAny rule happy without polluting `shared/types`.
// ---------------------------------------------------------------------------

type LandmarkExistenceValue = {
  exists?: boolean;
  tag?: string;
  classList?: string;
};

type LandmarkStylesValue = {
  styles?: Record<string, unknown>;
  boxModel?: { width: number; height: number; left: number; top: number } | null;
  visible?: boolean;
};

/**
 * Type-safe accessor for CDP `Runtime.evaluate` results.
 *
 * Runtime.evaluate returns a JSON-serialized value whose type depends on
 * the JavaScript evaluated in the page.  Callers pass a narrow marker type
 * `T` so the probe site can avoid `as any`; the function itself performs a
 * runtime structural check so callers with a wrong `T` still get a
 * well-behaved `null`.
 */
function evaluateValueAs<T>(value: unknown): T | null {
  // Runtime.evaluate can only return primitives, arrays, plain objects,
  // or null — structurally T must be one of those. Any more refined
  // guarantee is the caller's responsibility (they supplied the JS expr).
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  return null;
}

/**
 * Safe `unknown` record accessor.  `applyTheme` is the DI surface from
 * `AgentEngineService.apply` which returns `ApplyFlowResult` — we never
 * read fields off it, so treat it as opaque.  Replacing `Promise<any>`
 * here makes the dep interface explicit about that fact.
 */
type OpaqueApplyResult = unknown;

export const LANDMARK_SELECTORS: Record<string, string[]> = {
  codex: [
    '.panel-container',
    '.agents-sidebar',
    '.chat-input-box',
    '.chat-input-textarea',
    '.agent-card',
    '.message-bubble',
    '.nav-item',
    '.toolbar-container',
    '.title-bar',
    '.settings-panel',
  ],
  doubao: [
    '.main-container',
    '.sidebar-nav',
    '.chat-input-area',
    '.chat-input-editor',
    '.conversation-list-item',
    '.message-content',
    '.model-selector',
    '.header-bar',
    '.panel-root',
    '.tab-bar',
  ],
  qoderwork: [
    '.panel-container',
    '.sidebar-wrapper',
    '.chat-input-container',
    '.chat-input-textarea',
    '.message-card',
    '.code-block',
    '.nav-item',
    '.top-bar',
    '.title-bar',
    '.editor-container',
  ],
  traework: [
    '.panel-container',
    '.agents-sidebar',
    '.chat-input-box',
    '.chat-input-textarea',
    '.agent-card',
    '.message-bubble',
    '.nav-item',
    '.toolbar-container',
    '.title-bar',
    '.settings-panel',
  ],
  workbuddy: [
    '.teams-main-content',
    '.wb-home-page',
    '.sidebar-panel',
    '.chat-input-container',
    '.input-toolbar',
    '.message-cell',
    '.conversation-list',
    '.nav-tab',
    '.header-bar',
    '.settings-modal',
  ],
};

const GLOBAL_LANDMARKS = ['body', ':root', 'html', '.app-shell', '.main-layout', '[role="main"]'];

/** Properties surfaced in the compact `styles` subset (replica compatibility). */
const STYLE_PROPS = [
  'background-color',
  'color',
  'border-radius',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'box-shadow',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-color',
  'outline',
  'overflow',
  'display',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
] as const;

/** Build the effective landmark selectors for an agent. */
function selectorsForAgent(agentId: string): string[] {
  return LANDMARK_SELECTORS[agentId] ?? GLOBAL_LANDMARKS;
}

function isVisible(computed: Array<{ property: string; value: string }>): boolean {
  const display = computed.find((c) => c.property === 'display')?.value;
  const opacity = computed.find((c) => c.property === 'opacity')?.value;
  if (display === 'none') return false;
  if (opacity !== undefined && parseFloat(opacity) <= 0) return false;
  return true;
}

/**
 * Capture one landmark using the devtools-grade CSS/DOM domains.
 * Returns null if the node doesn't exist or the domains are unavailable.
 */
async function captureLandmarkViaProtocol(
  session: CdpSession,
  docNodeId: number,
  selector: string,
  pseudoStates: string[] = [],
): Promise<LandmarkSnapshot | null> {
  try {
    const query = await session.send<{ nodeId?: number }>('DOM.querySelector', {
      nodeId: docNodeId,
      selector,
    });
    const nodeId = query.nodeId;
    if (typeof nodeId !== 'number') return null;

    const described = await session.send<{
      node?: { localName?: string; nodeName?: string };
    }>('DOM.describeNode', { nodeId });
    const tag = described.node?.localName || described.node?.nodeName?.toLowerCase() || 'div';

    const cascade = await captureNodeCascade(session, nodeId);

    const styles = compactStylesFromComputed(cascade.computed, STYLE_PROPS);

    // Capture each requested pseudo-state as its own full cascade.
    const pseudo: Record<string, NodeCascade> = {};
    for (const p of pseudoStates) {
      pseudo[p] = await captureNodeCascade(session, nodeId, { pseudoStates: [p] });
    }

    return {
      selector,
      tag,
      styles,
      matchedRules: cascade.matchedRules,
      platformFonts: cascade.platformFonts,
      boxModel: cascade.boxModel,
      visible: isVisible(cascade.computed),
      pseudo: pseudoStates.length ? pseudo : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fallback probe: the old `Runtime.evaluate` approach. Used when the CSS/DOM
 * domains are unavailable. Produces the same shape minus cascade/fonts.
 */
async function captureLandmarkFallback(
  session: CdpSession,
  selector: string,
): Promise<LandmarkSnapshot | null> {
  try {
    const existenceResult = await session.send<{ result?: { value?: unknown } }>(
      'Runtime.evaluate',
      {
        expression: `(function() {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          return {
            tag: el.tagName.toLowerCase(),
            classList: Array.from(el.classList).slice(0, 6).join(' '),
            exists: true,
          };
        })()`,
        returnByValue: true,
      },
    );
    if (!existenceResult?.result?.value) return null;
    const ev = evaluateValueAs<LandmarkExistenceValue>(existenceResult.result.value);
    if (ev?.exists !== true) return null;
    const tag = ev.tag ?? '';
    if (!tag) return null;

    const probeExpr = `(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      var style = window.getComputedStyle(el);
      var props = ${JSON.stringify([...STYLE_PROPS])};
      var styles = {};
      for (var i = 0; i < props.length; i++) {
        styles[props[i]] = style.getPropertyValue(props[i]);
      }
      var bm = null;
      try {
        var r = el.getBoundingClientRect();
        bm = { width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), top: Math.round(r.top) };
      } catch(e) {}
      return { styles: styles, boxModel: bm, visible: style.display !== 'none' && parseFloat(style.opacity) > 0 };
    })()`;

    const detail = await session.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
      expression: probeExpr,
      returnByValue: true,
    });
    if (!detail?.result?.value) return null;
    const val = evaluateValueAs<LandmarkStylesValue>(detail.result.value);
    if (!val) return null;

    return {
      selector,
      tag,
      styles: Object.entries(val.styles ?? {}).map(([property, value]) => ({
        property,
        value: String(value),
      })),
      matchedRules: [] as CssMatchedRule[],
      platformFonts: [],
      boxModel: val.boxModel || null,
      visible: val.visible ?? false,
    };
  } catch {
    return null;
  }
}

/**
 * Full DOM visual snapshot for a single agent+theme pair.
 */
export async function snapshotThemeVisuals(
  agentId: AgentId,
  themeId: string | undefined,
  deps: {
    adapter: (id: AgentId) => ApplicationAdapter | null;
    applyTheme: (req: { themeId: string; appId: AgentId }) => Promise<OpaqueApplyResult>;
    findPortForAgent: (id: AgentId) => Promise<number | null>;
    log: (line: string) => void;
  },
  options?: StudioSnapshotOptions,
): Promise<ThemeVisualSnapshot> {
  const startedAt = Date.now();
  const port = await deps.findPortForAgent(agentId);

  if (!port) {
    throw new Error(`No debug port found for ${agentId}`);
  }

  // Apply theme first (optional) so the DOM reflects it. When no theme is
  // selected we capture the agent's current live interface as-is.
  if (themeId) {
    try {
      await deps.applyTheme({ themeId, appId: agentId });
      deps.log(`[studio] applied theme ${themeId} to ${agentId}, waiting for CDP...`);
    } catch (error) {
      deps.log(`[studio] apply failed: ${String(error)}`);
      throw error;
    }
  } else {
    deps.log(`[studio] no theme selected — capturing ${agentId} live interface`);
  }

  // P2-10/N4: Replaced the blind 1500ms setTimeout with a DOM-idle + theme-
  // readiness poll. Previously fast machines wasted over a second waiting
  // when the CSS had already rendered, while slow machines (first boot,
  // cold JIT, many browser extensions) could exit the wait before the
  // theme was flushed and capture a pre-theme DOM.
  //
  // Strategy:
  //   * No theme applied (live capture): wait a short 250ms cap for the
  //     agent's own render to settle, then proceed.
  //   * Theme applied: every 100ms probe the DOM via a short CDP evaluate
  //     until --agentskin-accent is present on :root (the injected CSS has
  //     been parsed & committed), OR we hit the 5s safety cap.
  const POLL_INTERVAL_MS = 100;
  const MAX_WAIT_MS = themeId ? 5000 : 250;
  // Use a poll-local start time because the outer-function `startedAt`
  // declared above already includes findPort + applyTheme latency — we want
  // the readiness timeout to be measured only AFTER the theme was applied.
  const pollStartedAt = Date.now();
  let probeSession: CdpSession | null = null;
  try {
    const pollTargets = themeId ? await findDomTargets(port) : [];
    if (pollTargets.length > 0 && pollTargets[0].webSocketDebuggerUrl) {
      probeSession = await connectCdp(pollTargets[0].webSocketDebuggerUrl, 3000, 3000);
    }
    while (Date.now() - pollStartedAt < MAX_WAIT_MS) {
      if (themeId && probeSession) {
        try {
          const accent = await probeSession.evaluate(
            `getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim()`,
          );
          if (accent.length > 0) break; // Theme tokens flushed — ready to capture
        } catch {
          // Session may have dropped; break the poll loop and fall through to
          // capture with whatever state we have (the callers handle errors).
          break;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } catch {
    // Best-effort readiness only — a poll failure must never prevent the
    // snapshot capture itself from proceeding; we just waited the minimum.
  } finally {
    if (probeSession) probeSession.close();
  }

  const domTargets = await findDomTargets(port);
  if (!domTargets.length) {
    throw new Error(`No DOM-bearing CDP targets on port ${port}`);
  }

  const baseSelectors = selectorsForAgent(agentId);
  const extraSelectors = options?.extraSelectors ?? [];
  const pseudoStates = options?.pseudoStates ?? [];
  const selectors = [...baseSelectors, ...extraSelectors];
  let session: CdpSession | null = null;

  try {
    // Larger command timeout: the DOM-tree capture now inlines images
    // asynchronously and the optional scheme pass re-captures landmarks, so a
    // single Runtime.evaluate can legitimately take several seconds.
    session = await connectCdp(domTargets[0].webSocketDebuggerUrl!, 5000, 30000);

    // Enable the devtools-grade domains. If both succeed we use the protocol
    // cascade path; otherwise we degrade to the Runtime fallback.
    let useProtocol = false;
    let docNodeId = 0;
    try {
      await session.send('DOM.enable');
      await session.send('CSS.enable');
      const doc = await session.send<{ root?: { nodeId?: number } }>('DOM.getDocument', {
        depth: -1,
        pierce: false,
      });
      docNodeId = doc.root?.nodeId ?? 0;
      useProtocol = typeof docNodeId === 'number' && docNodeId > 0;
    } catch {
      useProtocol = false;
    }

    const landmarks: LandmarkSnapshot[] = [];
    let visibleCount = 0;

    for (const selector of selectors) {
      const snap = useProtocol
        ? await captureLandmarkViaProtocol(session, docNodeId, selector, pseudoStates)
        : await captureLandmarkFallback(session, selector);
      if (snap) {
        snap.custom = extraSelectors.includes(selector);
        landmarks.push(snap);
        if (snap.visible) visibleCount++;
      }
    }

    // Capture the full real DOM subtree for an authentic preview. This runs as
    // a single Runtime.evaluate round trip and is independent of the
    // CSS/DOM-domain cascade path above, so it still works on the fallback.
    let domTree: DomTreeNode | null = null;
    try {
      domTree = await captureDomTree(session, 'body');
    } catch (error) {
      deps.log(`[studio] domTree capture failed: ${String(error)}`);
    }

    // Capture the agent's native `:root` custom properties so the RAW
    // (native-look) preview resolves `var()` references against the real
    // variable set instead of an empty `:root`. When a theme is applied the
    // injected `--agentskin-*` vars are included too (the current snapshot's
    // DOM references them); for the baseline (no theme) only native vars are
    // present. Degrades to undefined on any failure — the preview still works,
    // just without resolved custom properties.
    let rootVars: Record<string, string> | undefined;
    try {
      const rootVarsExpr = `(function(){
        var cs = getComputedStyle(document.documentElement);
        var out = {};
        for (var i = 0; i < cs.length; i++) {
          var name = cs[i];
          if (name && name.charAt(0) === '-' && name.charAt(1) === '-') {
            var val = cs.getPropertyValue(name);
            if (val) out[name] = String(val).trim();
          }
        }
        return JSON.stringify(out);
      })()`;
      const raw = await session.evaluate(rootVarsExpr);
      rootVars = raw && raw !== 'null' ? (JSON.parse(raw) as Record<string, string>) : undefined;
    } catch (error) {
      deps.log(`[studio] rootVars capture skipped: ${String(error)}`);
    }

    // Optional light/dark scheme variants via emulated media. Re-captures each
    // landmark's styles + cascade under forced prefers-color-scheme. Degrades
    // gracefully when the agent ignores emulated media.
    if (options?.captureSchemes && useProtocol) {
      try {
        await session.send('Emulation.enable');
        const schemes: Array<'light' | 'dark'> = ['light', 'dark'];
        for (const scheme of schemes) {
          await session.send('Emulation.setEmulatedMedia', {
            features: [{ name: 'prefers-color-scheme', value: scheme }],
          });
          await new Promise((resolve) => setTimeout(resolve, 400));
          for (const lm of landmarks) {
            const q = await session.send<{ nodeId?: number }>('DOM.querySelector', {
              nodeId: docNodeId,
              selector: lm.selector,
            });
            if (typeof q.nodeId !== 'number') continue;
            const c = await captureNodeCascade(session, q.nodeId);
            const styles = compactStylesFromComputed(c.computed, STYLE_PROPS);
            lm.scheme = lm.scheme ?? {
              light: { styles: [], matchedRules: [] },
              dark: { styles: [], matchedRules: [] },
            };
            lm.scheme[scheme] = { styles, matchedRules: c.matchedRules };
          }
        }
        await session.send('Emulation.setEmulatedMedia', { features: [] });
      } catch (error) {
        deps.log(`[studio] scheme capture failed: ${String(error)}`);
      }
    }

    deps.log(
      `[studio] ${agentId}: captured ${landmarks.length}/${selectors.length} landmarks (protocol=${useProtocol}) + domTree=${domTree ? 'yes' : 'no'} in ${Date.now() - startedAt}ms`,
    );

    return {
      themeId: themeId ?? '',
      themeName: '', // filled by the IPC layer (studio:snapshot resolves via the theme catalog)
      agentId,
      timestamp: new Date().toISOString(),
      landmarks,
      domTree: domTree ?? undefined,
      rootVars,
      summary: {
        totalLandmarks: selectors.length,
        visibleLandmarks: visibleCount,
        selectorsTried: selectors.length,
        boxModelAvailable: useProtocol,
        cascadeAvailable: useProtocol,
      },
    };
  } finally {
    if (session) session.close();
  }
}
