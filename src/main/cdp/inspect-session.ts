// SPDX-License-Identifier: MPL-2.0

/**
 * # inspect-session — DevTools-style live element picker
 *
 * Tier B of the Theme Studio capture upgrade. Lets the user hover/click the
 * real running agent and have the Studio pull that node's full cascade live,
 * exactly like Chrome DevTools' "inspect element" tool.
 *
 * Uses the shared event-aware CDP client ({@link connectEventCdp}) so the
 * socket / dispatch core stays in one place (see `cdp-client.ts` — the same
 * entry point serves the cdp-watcher). The inspector subscribes to
 * `Overlay.inspectNodeRequested` and resolves each picked backend node's
 * cascade via {@link captureNodeCascade}.
 */

import type { AgentId, InspectedNode } from '../../shared/types';
import { connectEventCdp } from './cdp-client';
import { captureNodeCascade } from './node-cascade';

function highlightConfig() {
  return {
    showInfo: true,
    showStyles: true,
    contentColor: { r: 59, g: 130, b: 246, a: 0.28 },
    paddingColor: { r: 59, g: 130, b: 246, a: 0.18 },
    borderColor: { r: 59, g: 130, b: 246, a: 0.85 },
    marginColor: { r: 59, g: 130, b: 246, a: 0.1 },
    eventTargetColor: { r: 59, g: 130, b: 246, a: 0.3 },
    shapeColor: { r: 59, g: 130, b: 246, a: 0.3 },
    selectorColor: { r: 59, g: 130, b: 246, a: 0.3 },
  };
}

function buildPath(attributes: string[] | undefined, tag: string): string {
  if (!attributes) return tag;
  let id = '';
  const classes: string[] = [];
  for (let i = 0; i + 1 < attributes.length; i += 2) {
    const name = attributes[i];
    const value = attributes[i + 1] ?? '';
    if (name === 'id' && value) id = `#${value}`;
    else if (name === 'class' && value) {
      for (const c of value.split(/\s+/)) if (c) classes.push(`.${c}`);
    }
  }
  return `${tag}${id}${classes.join('')}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InspectController {
  stop(): Promise<void>;
}

export interface StartInspectOptions {
  agentId: AgentId;
  webSocketDebuggerUrl: string;
  onPick: (node: InspectedNode) => void;
  onError?: (message: string) => void;
}

/**
 * Enter live-inspect mode on the given agent target. The user can now hover
 * and click the real agent window; each click resolves the node's cascade and
 * invokes `onPick`. Returns a controller whose `stop()` exits inspect mode.
 */
export async function startInspect(opts: StartInspectOptions): Promise<InspectController> {
  const session = await connectEventCdp(opts.webSocketDebuggerUrl);

  // Race the CDP domain-enable sequence against an 8s timeout so a
  // half-open WebSocket cannot hang the main process indefinitely. On
  // timeout we close the session and let the error propagate to the caller.
  const enablePromise = async (): Promise<void> => {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    await session.send('Overlay.enable');
    await session.send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: highlightConfig(),
    });
  };
  const timeoutPromise = <T>(): Promise<T> =>
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CDP domain enable timed out (8000ms)')), 8000),
    );
  try {
    await Promise.race([enablePromise(), timeoutPromise<void>()]);
  } catch (error) {
    session.close();
    throw error;
  }

  const pickHandler = async (params: unknown) => {
    const backendNodeId = (params as { backendNodeId?: number }).backendNodeId;
    if (typeof backendNodeId !== 'number') return;
    try {
      const pushed = await session.send<{ nodeIds?: number[] }>(
        'DOM.pushNodesByBackendIdsToFrontend',
        { backendNodeIds: [backendNodeId] },
      );
      const nodeId = pushed.nodeIds?.[0];
      if (typeof nodeId !== 'number') return;

      const described = await session.send<{
        node?: { localName?: string; nodeName?: string; attributes?: string[] };
      }>('DOM.describeNode', { nodeId });

      const tag = described.node?.localName || described.node?.nodeName?.toLowerCase() || 'div';
      const path = buildPath(described.node?.attributes, tag);
      const cascade = await captureNodeCascade(session, nodeId);

      opts.onPick({ agentId: opts.agentId, tag, path, cascade });
    } catch (error) {
      opts.onError?.(String(error));
    }
  };

  session.on('Overlay.inspectNodeRequested', pickHandler);

  return {
    async stop() {
      try {
        await session.send('Overlay.setInspectMode', { mode: 'none' });
      } catch {
        /* ignore */
      }
      try {
        await session.send('Overlay.disable');
      } catch {
        /* ignore */
      }
      session.off('Overlay.inspectNodeRequested', pickHandler);
      session.close();
    },
  };
}
