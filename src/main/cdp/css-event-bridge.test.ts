// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventCdpSession } from './cdp-client';
import type { CdpTarget } from './cdp-targets';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test.
// ---------------------------------------------------------------------------

vi.mock('./cdp-client', () => ({
  connectEventCdp: vi.fn(),
}));

vi.mock('./cdp-targets', () => ({
  findPageTarget: vi.fn(),
}));

// Import mocked modules AFTER mock declarations.
const { connectEventCdp } = await import('./cdp-client');
const { findPageTarget } = await import('./cdp-targets');
const {
  startCssEventSession,
  stopCssEventSession,
  onCssEvent,
  getCssEventSessionKeys,
  disposeCssEventSessions,
} = await import('./css-event-bridge');

// ---------------------------------------------------------------------------
// Factories / helpers
// ---------------------------------------------------------------------------

/** A controllable event session: lets the test fire events through `handlers`. */
function makeEventSession() {
  const handlers = new Map<string, (params: unknown) => void>();
  const send = vi.fn().mockResolvedValue({});
  const evaluate = vi.fn().mockResolvedValue('{}');
  const close = vi.fn();
  const session = {
    send,
    evaluate,
    close,
    on: vi.fn((method: string, handler: (params: unknown) => void) => {
      handlers.set(method, handler);
    }),
    off: vi.fn((method: string, handler: (params: unknown) => void) => {
      if (handlers.get(method) === handler) handlers.delete(method);
    }),
  } as unknown as EventCdpSession;
  return { session, handlers };
}

const makeTarget = (wsUrl = 'ws://127.0.0.1:9222/devtools/page/1'): CdpTarget =>
  ({
    type: 'page',
    url: 'https://example.com',
    webSocketDebuggerUrl: wsUrl,
    title: 'Test Page',
    id: 'page-1',
  }) as CdpTarget;

const flushAsync = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(findPageTarget).mockResolvedValue(makeTarget());
  vi.mocked(connectEventCdp).mockResolvedValue(makeEventSession().session);
});

afterEach(() => {
  disposeCssEventSessions();
});

describe('startCssEventSession', () => {
  it('opens a long-lived event session and subscribes to CSS events', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    expect(findPageTarget).toHaveBeenCalledWith(9222);
    expect(connectEventCdp).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/page/1');
    expect(session.on).toHaveBeenCalledWith('CSS.styleSheetChanged', expect.any(Function));
    expect(session.on).toHaveBeenCalledWith('CSS.styleSheetAdded', expect.any(Function));
    expect(session.on).toHaveBeenCalledWith('CSS.styleSheetRemoved', expect.any(Function));
    expect(session.send).toHaveBeenCalledWith('CSS.enable');
    expect(getCssEventSessionKeys()).toEqual(['doubao']);
  });

  it('throws when no page target is found for the port', async () => {
    vi.mocked(findPageTarget).mockResolvedValue(undefined);

    await expect(startCssEventSession('doubao', 9999)).rejects.toThrow(
      /no page target for agent doubao/,
    );
    expect(connectEventCdp).not.toHaveBeenCalled();
  });

  it('is idempotent — re-starting the same agent does not create a duplicate session', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    await startCssEventSession('doubao', 9222);
    await flushAsync();
    await startCssEventSession('doubao', 9222);
    await flushAsync();

    expect(connectEventCdp).toHaveBeenCalledTimes(1);
    expect(session.close).not.toHaveBeenCalled();
    expect(getCssEventSessionKeys()).toEqual(['doubao']);
  });
});

describe('stopCssEventSession', () => {
  it('closes the session and unsubscribes all CSS event handlers', async () => {
    const { session } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    await stopCssEventSession('doubao');
    await flushAsync();

    expect(session.off).toHaveBeenCalledWith('CSS.styleSheetChanged', expect.any(Function));
    expect(session.off).toHaveBeenCalledWith('CSS.styleSheetAdded', expect.any(Function));
    expect(session.off).toHaveBeenCalledWith('CSS.styleSheetRemoved', expect.any(Function));
    expect(session.close).toHaveBeenCalled();
    expect(getCssEventSessionKeys()).toEqual([]);
  });

  it('is a no-op when no session exists for the agent', async () => {
    await stopCssEventSession('nonexistent');
    // No throw, no side effects.
    expect(getCssEventSessionKeys()).toEqual([]);
  });
});

describe('event forwarding', () => {
  it('forwards CSS.styleSheetChanged to the registered handler', async () => {
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    const handler = vi.fn();
    onCssEvent('doubao', handler);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    handlers.get('CSS.styleSheetChanged')!({ styleSheetId: 'sheet-42' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: 'changed',
      styleSheetId: 'sheet-42',
      agentId: 'doubao',
      timestamp: expect.any(Number),
    });
  });

  it('forwards CSS.styleSheetAdded (nested header) to the registered handler', async () => {
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    const handler = vi.fn();
    onCssEvent('doubao', handler);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    handlers.get('CSS.styleSheetAdded')!({ header: { styleSheetId: 'sheet-new' } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: 'added',
      styleSheetId: 'sheet-new',
      agentId: 'doubao',
      timestamp: expect.any(Number),
    });
  });

  it('forwards CSS.styleSheetRemoved to the registered handler', async () => {
    const { session, handlers } = makeEventSession();
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    const handler = vi.fn();
    onCssEvent('doubao', handler);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    handlers.get('CSS.styleSheetRemoved')!({ styleSheetId: 'sheet-gone' });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({
      type: 'removed',
      styleSheetId: 'sheet-gone',
      agentId: 'doubao',
      timestamp: expect.any(Number),
    });
  });
});

describe('error handling', () => {
  it('cleans up the session when connectEventCdp rejects', async () => {
    vi.mocked(connectEventCdp).mockRejectedValue(new Error('connection refused'));

    await expect(startCssEventSession('doubao', 9222)).rejects.toThrow(/connection refused/);
    expect(getCssEventSessionKeys()).toEqual([]);
  });

  it('closes the session on stop even if the session was already closed externally', async () => {
    const { session } = makeEventSession();
    session.close = vi.fn(() => {
      throw new Error('already closed');
    });
    vi.mocked(connectEventCdp).mockResolvedValue(session);

    await startCssEventSession('doubao', 9222);
    await flushAsync();

    // Should not throw even if close() throws.
    await stopCssEventSession('doubao');
    expect(getCssEventSessionKeys()).toEqual([]);
  });
});
