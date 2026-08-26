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
import { connectEventCdp, type EventCdpSession } from './cdp-client';
import { captureNodeCascade } from './node-cascade';
import {
  acquireSession,
  type CdpSessionPool,
  releaseSession,
  type SessionHandle,
  targetKeyFor,
} from './session-pool';

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
  /**
   * Optional session pool. When provided, the inspect session is acquired from
   * the pool (reusing an existing connection to the same target) and released
   * back on `stop()`. Without a pool a one-shot connect-then-close session is
   * used (backwards-compatible path for callers that don't pass one).
   */
  pool?: CdpSessionPool;
}

/**
 * Enter live-inspect mode on the given agent target. The user can now hover
 * and click the real agent window; each click resolves the node's cascade and
 * invokes `onPick`. Returns a controller whose `stop()` exits inspect mode.
 */
export async function startInspect(opts: StartInspectOptions): Promise<InspectController> {
  const targetKey = targetKeyFor(null, opts.webSocketDebuggerUrl);
  const handle: SessionHandle = await acquireSession(opts.pool, opts.agentId, targetKey, () =>
    connectEventCdp(opts.webSocketDebuggerUrl),
  );
  // The pool stores CdpSession, but our open callback created an
  // EventCdpSession — cast so we can subscribe to CDP events (event
  // delegation: the pooled socket is shared, events are dispatched here).
  const session = handle.session as EventCdpSession | null;
  if (!session) {
    throw new Error('CDP connect failed: no session available');
  }

  // Release-or-close helper: pooled sessions are released back to the pool;
  // one-shot sessions are closed. Used by both the error path and stop().
  const releaseOrClose = (): void => {
    if (handle.pooled) {
      releaseSession(opts.pool, opts.agentId, targetKey);
    } else {
      try {
        session.close();
      } catch {
        /* already closed */
      }
    }
  };

  // Race the CDP domain-enable sequence against an 8s timeout so a
  // half-open WebSocket cannot hang the main process indefinitely. On
  // timeout we release the session and let the error propagate to the caller.
  const enablePromise = async (): Promise<void> => {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    await session.send('Overlay.enable');
    await session.send('Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: highlightConfig(),
    });
  };
  // Keep the timeout handle so we can cancel it once the domain-enable
  // sequence completes — otherwise the 8s timer dangles in the event loop
  // after enable succeeds (RC2: dangling timeout timer).
  let enableTimeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = <T>(): Promise<T> =>
    new Promise((_, reject) => {
      enableTimeout = setTimeout(
        () => reject(new Error('CDP domain enable timed out (8000ms)')),
        8000,
      );
    });
  try {
    await Promise.race([enablePromise(), timeoutPromise<void>()]);
  } catch (error) {
    if (enableTimeout) clearTimeout(enableTimeout);
    releaseOrClose();
    throw error;
  }
  if (enableTimeout) clearTimeout(enableTimeout);

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

  let stopped = false;
  return {
    async stop() {
      if (stopped) return; // idempotent: never double-disable / double-release
      stopped = true;
      if (enableTimeout) clearTimeout(enableTimeout);
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
      releaseOrClose();
    },
  };
}
