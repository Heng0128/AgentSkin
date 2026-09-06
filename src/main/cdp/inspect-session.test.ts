// SPDX-License-Identifier: MPL-2.0

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeCascade } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test.
// ---------------------------------------------------------------------------

const connectEventCdp = vi.fn();
const captureNodeCascade = vi.fn();

vi.mock('./cdp-client', () => ({
  connectEventCdp: (...args: unknown[]) => connectEventCdp(...args),
}));
vi.mock('./node-cascade', () => ({
  captureNodeCascade: (...args: unknown[]) => captureNodeCascade(...args),
}));

const { startInspect } = await import('./inspect-session');

// ---------------------------------------------------------------------------
// Fake CDP session
// ---------------------------------------------------------------------------

function makeSession() {
  const handlers = new Map<string, (params: unknown) => unknown>();
  const sent: Array<{ method: string; params?: unknown }> = [];
  return {
    sent,
    emit(name: string, params: unknown) {
      const h = handlers.get(name);
      if (h) return h(params);
      return undefined;
    },
    send: vi.fn(async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (method === 'DOM.pushNodesByBackendIdsToFrontend') {
        return { nodeIds: [7] };
      }
      if (method === 'DOM.describeNode') {
        return {
          node: {
            localName: 'div',
            nodeName: 'DIV',
            attributes: ['id', 'chat-panel', 'class', 'panel main'],
          },
        };
      }
      return {};
    }),
    on: vi.fn((name: string, handler: (params: unknown) => unknown) => {
      handlers.set(name, handler);
    }),
    off: vi.fn((name: string, handler: (params: unknown) => unknown) => {
      if (handlers.get(name) === handler) handlers.delete(name);
    }),
    close: vi.fn(),
  };
}

function makeCascade(): NodeCascade {
  return {
    computed: [{ property: 'display', value: 'flex' }],
    matchedRules: [],
    platformFonts: [],
    boxModel: null,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('inspect-session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captureNodeCascade.mockResolvedValue(makeCascade());
  });

  it('enables DOM/CSS/Overlay and enters searchForNode inspect mode', async () => {
    const session = makeSession();
    connectEventCdp.mockResolvedValue(session);
    await startInspect({
      agentId: 'traework',
      webSocketDebuggerUrl: 'ws://x',
      onPick: vi.fn(),
    });
    expect(connectEventCdp).toHaveBeenCalledWith('ws://x');
    const methods = session.sent.map((s) => s.method);
    expect(methods).toEqual([
      'DOM.enable',
      'CSS.enable',
      'Overlay.enable',
      'Overlay.setInspectMode',
    ]);
    expect(session.sent[3].params).toMatchObject({ mode: 'searchForNode' });
  });

  it('resolves a picked node and calls onPick with tag/path/cascade', async () => {
    const session = makeSession();
    connectEventCdp.mockResolvedValue(session);
    const onPick = vi.fn();
    await startInspect({ agentId: 'traework', webSocketDebuggerUrl: 'ws://x', onPick });

    await session.emit('Overlay.inspectNodeRequested', { backendNodeId: 42 });

    expect(session.send).toHaveBeenCalledWith('DOM.pushNodesByBackendIdsToFrontend', {
      backendNodeIds: [42],
    });
    expect(captureNodeCascade).toHaveBeenCalledWith(session, 7);
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'traework',
        tag: 'div',
        path: 'div#chat-panel.panel.main',
      }),
    );
  });

  it('ignores picks without a backendNodeId', async () => {
    const session = makeSession();
    connectEventCdp.mockResolvedValue(session);
    const onPick = vi.fn();
    await startInspect({ agentId: 'traework', webSocketDebuggerUrl: 'ws://x', onPick });

    await session.emit('Overlay.inspectNodeRequested', {});
    expect(onPick).not.toHaveBeenCalled();
  });

  it('ignores picks that resolve to no frontend nodeId', async () => {
    const session = makeSession();
    session.send.mockImplementation(async (method: string) => {
      if (method === 'DOM.pushNodesByBackendIdsToFrontend') return { nodeIds: [] };
      return {};
    });
    connectEventCdp.mockResolvedValue(session);
    const onPick = vi.fn();
    await startInspect({ agentId: 'traework', webSocketDebuggerUrl: 'ws://x', onPick });

    await session.emit('Overlay.inspectNodeRequested', { backendNodeId: 1 });
    expect(onPick).not.toHaveBeenCalled();
  });

  it('builds a bare tag path when the node has no attributes', async () => {
    const session = makeSession();
    session.send.mockImplementation(async (method: string) => {
      if (method === 'DOM.pushNodesByBackendIdsToFrontend') return { nodeIds: [3] };
      if (method === 'DOM.describeNode') {
        return { node: { localName: 'button', nodeName: 'BUTTON', attributes: [] } };
      }
      return {};
    });
    connectEventCdp.mockResolvedValue(session);
    const onPick = vi.fn();
    await startInspect({ agentId: 'traework', webSocketDebuggerUrl: 'ws://x', onPick });

    await session.emit('Overlay.inspectNodeRequested', { backendNodeId: 2 });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ path: 'button' }));
  });

  it('reports pick failures via onError', async () => {
    const session = makeSession();
    session.send.mockImplementation(async (method: string) => {
      if (method === 'DOM.pushNodesByBackendIdsToFrontend') {
        throw new Error('domain crashed');
      }
      return {};
    });
    connectEventCdp.mockResolvedValue(session);
    const onError = vi.fn();
    await startInspect({
      agentId: 'traework',
      webSocketDebuggerUrl: 'ws://x',
      onPick: vi.fn(),
      onError,
    });

    await session.emit('Overlay.inspectNodeRequested', { backendNodeId: 1 });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('domain crashed'));
  });

  it('stop exits inspect mode, disables the overlay and closes the session', async () => {
    const session = makeSession();
    connectEventCdp.mockResolvedValue(session);
    const controller = await startInspect({
      agentId: 'traework',
      webSocketDebuggerUrl: 'ws://x',
      onPick: vi.fn(),
    });

    await controller.stop();

    expect(session.send).toHaveBeenCalledWith('Overlay.setInspectMode', { mode: 'none' });
    expect(session.send).toHaveBeenCalledWith('Overlay.disable');
    expect(session.off).toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it('stop does not throw when the overlay is already gone', async () => {
    const session = makeSession();
    let setInspectModeCalls = 0;
    session.send.mockImplementation(async (method: string) => {
      if (method === 'Overlay.setInspectMode') {
        setInspectModeCalls += 1;
        // First call (entering inspect mode) succeeds; stop-time calls fail.
        if (setInspectModeCalls > 1) throw new Error('no overlay');
      }
      if (method === 'Overlay.disable') throw new Error('no overlay');
      return {};
    });
    connectEventCdp.mockResolvedValue(session);
    const controller = await startInspect({
      agentId: 'traework',
      webSocketDebuggerUrl: 'ws://x',
      onPick: vi.fn(),
    });
    await expect(controller.stop()).resolves.toBeUndefined();
  });
});
