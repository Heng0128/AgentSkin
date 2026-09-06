// SPDX-License-Identifier: MPL-2.0

/**
 * # L2 — CDP Client State Transitions (Integration)
 *
 * Tests the CDP client's connection lifecycle, message dispatch, and state
 * transitions using a mocked WebSocket. This validates that the client
 * correctly handles the CDP protocol layer: request/response matching by id,
 * event routing, timeout, and close behavior.
 *
 * The ws module is fully mocked — no real network I/O occurs.
 *
 * Run: npm run test:backtest:l2
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpSession, EventCdpSession } from '../../src/main/cdp/cdp-client';
import { connectCdp, connectEventCdp } from '../../src/main/cdp/cdp-client';

// ---------------------------------------------------------------------------
// FakeWebSocket — controllable stand-in for the `ws` WebSocket
// ---------------------------------------------------------------------------

interface FakeWebSocketInstance {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
  serverSend(data: string): void;
  triggerOpen(): void;
  triggerClose(): void;
  triggerError(): void;
  closed: boolean;
  sentMessages: string[];
}

const fakeState = vi.hoisted(() => {
  return { currentFake: null as FakeWebSocketInstance | null };
});

vi.mock('ws', () => ({
  WebSocket: class {
    readonly url: string;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    closed = false;
    sentMessages: string[] = [];

    constructor(url: string) {
      this.url = url;
      fakeState.currentFake = this;
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }

    close(): void {
      this.closed = true;
    }

    serverSend(data: string): void {
      this.onmessage?.({ data });
    }

    triggerOpen(): void {
      this.onopen?.();
    }

    triggerClose(): void {
      this.onclose?.();
    }

    triggerError(): void {
      this.onerror?.();
    }
  },
}));

beforeEach(() => {
  fakeState.currentFake = null;
});

afterEach(() => {
  fakeState.currentFake = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function lastSentMessage(): { id: number; method: string; params: Record<string, unknown> } {
  const fake = fakeState.currentFake!;
  const raw = fake.sentMessages[fake.sentMessages.length - 1];
  return JSON.parse(raw);
}

async function connectAndOpen(): Promise<CdpSession> {
  const promise = connectCdp('ws://127.0.0.1:9336/devtools/page/abc');
  await Promise.resolve();
  fakeState.currentFake!.triggerOpen();
  return promise;
}

async function connectEventAndOpen(): Promise<EventCdpSession> {
  const promise = connectEventCdp('ws://127.0.0.1:9336/devtools/page/abc');
  await Promise.resolve();
  fakeState.currentFake!.triggerOpen();
  return promise;
}

// ---------------------------------------------------------------------------
// Tests — connection lifecycle
// ---------------------------------------------------------------------------

describe('L2 — connectCdp: connection lifecycle', () => {
  it('resolves with a CdpSession when ws.onopen fires', async () => {
    const session = await connectAndOpen();
    expect(session).toBeDefined();
    expect(typeof session.send).toBe('function');
    expect(typeof session.evaluate).toBe('function');
    expect(typeof session.close).toBe('function');
  });

  it('passes the webSocketDebuggerUrl to WebSocket constructor', async () => {
    const url = 'ws://127.0.0.1:9999/devtools/page/xyz';
    const promise = connectCdp(url);
    await Promise.resolve();
    expect(fakeState.currentFake!.url).toBe(url);
    fakeState.currentFake!.triggerOpen();
    await promise;
  });

  it('rejects with "CDP connect timeout" when onopen does not fire', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 1000);
      await Promise.resolve();
      const assertion = expect(promise).rejects.toThrow('CDP connect timeout');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects with "CDP connection failed" when ws.onerror fires', async () => {
    const promise = connectCdp('ws://localhost/x');
    await Promise.resolve();
    fakeState.currentFake!.triggerError();
    await expect(promise).rejects.toThrow('CDP connection failed');
  });
});

// ---------------------------------------------------------------------------
// Tests — session.send()
// ---------------------------------------------------------------------------

describe('L2 — CdpSession: send', () => {
  it('sends JSON with incrementing id, method, params', async () => {
    const session = await connectAndOpen();
    const sendPromise = session.send('Page.reload', { frameId: 'main' });
    await Promise.resolve();

    const msg = lastSentMessage();
    expect(msg.id).toBe(1);
    expect(msg.method).toBe('Page.reload');
    expect(msg.params).toEqual({ frameId: 'main' });

    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: { ok: true } }));
    await expect(sendPromise).resolves.toEqual({ ok: true });
  });

  it('defaults params to empty object', async () => {
    const session = await connectAndOpen();
    const p = session.send('Page.frameTree');
    await Promise.resolve();

    expect(lastSentMessage().params).toEqual({});
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: {} }));
    await p;
  });

  it('rejects with error message + code when CDP returns an error', async () => {
    const session = await connectAndOpen();
    const p = session.send('Page.navigate', { url: 'bad://' });
    await Promise.resolve();

    fakeState.currentFake!.serverSend(
      JSON.stringify({ id: 1, error: { message: 'Cannot navigate', code: -32000 } }),
    );
    await expect(p).rejects.toThrow('Cannot navigate (-32000)');
  });

  it('rejects with "CDP request timed out" after commandTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      fakeState.currentFake!.triggerOpen();
      const session = await promise;

      const p = session.send('Slow.method');
      await Promise.resolve();
      const assertion = expect(p).rejects.toThrow('CDP request timed out: Slow.method');
      await vi.advanceTimersByTimeAsync(201);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reject twice if a late response arrives after timeout', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      fakeState.currentFake!.triggerOpen();
      const session = await promise;

      const p = session.send('Slow.method');
      await Promise.resolve();
      const assertion = expect(p).rejects.toThrow('CDP request timed out');
      await vi.advanceTimersByTimeAsync(201);
      await assertion;

      // Late response should be ignored.
      fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: 'late' }));
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles ws.send() throwing (socket not ready)', async () => {
    const session = await connectAndOpen();
    fakeState.currentFake!.send = () => {
      throw new Error('WebSocket is not open');
    };
    await expect(session.send('Any.method')).rejects.toThrow('WebSocket is not open');
  });
});

// ---------------------------------------------------------------------------
// Tests — session.evaluate()
// ---------------------------------------------------------------------------

describe('L2 — CdpSession: evaluate', () => {
  it('sends Runtime.evaluate with correct params', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('document.title');
    await Promise.resolve();

    const msg = lastSentMessage();
    expect(msg.method).toBe('Runtime.evaluate');
    expect(msg.params).toEqual({
      expression: 'document.title',
      returnByValue: true,
      awaitPromise: true,
    });

    fakeState.currentFake!.serverSend(
      JSON.stringify({ id: 1, result: { result: { value: 'My Page' } } }),
    );
    await expect(p).resolves.toBe('My Page');
  });

  it('returns stringified value for numbers', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('1 + 1');
    await Promise.resolve();
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: { value: 2 } } }));
    await expect(p).resolves.toBe('2');
  });

  it('returns "null" when result.value is null or undefined', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('void 0');
    await Promise.resolve();
    fakeState.currentFake!.serverSend(
      JSON.stringify({ id: 1, result: { result: { value: null } } }),
    );
    await expect(p).resolves.toBe('null');
  });

  it('rejects with renderer error on exception', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('throw new Error("boom")');
    await Promise.resolve();
    fakeState.currentFake!.serverSend(
      JSON.stringify({
        id: 1,
        result: {
          result: {},
          exceptionDetails: {
            exception: { description: 'Error: boom at eval:1:1' },
          },
        },
      }),
    );
    await expect(p).rejects.toThrow('Renderer evaluation failed: Error: boom at eval:1:1');
  });
});

// ---------------------------------------------------------------------------
// Tests — session.close()
// ---------------------------------------------------------------------------

describe('L2 — CdpSession: close', () => {
  it('closes the underlying WebSocket', async () => {
    const session = await connectAndOpen();
    expect(fakeState.currentFake!.closed).toBe(false);
    session.close();
    expect(fakeState.currentFake!.closed).toBe(true);
  });

  it('rejects all pending commands on close', async () => {
    const session = await connectAndOpen();
    const p1 = session.send('Pending.one');
    const p2 = session.send('Pending.two');
    await Promise.resolve();

    session.close();

    await expect(p1).rejects.toThrow('CDP session closed.');
    await expect(p2).rejects.toThrow('CDP session closed.');
  });

  it('is idempotent — multiple calls do not throw', async () => {
    const session = await connectAndOpen();
    session.close();
    expect(() => session.close()).not.toThrow();
    expect(() => session.close()).not.toThrow();
  });

  it('rejects sends after close with "CDP session is closed"', async () => {
    const session = await connectAndOpen();
    session.close();
    await expect(session.send('After.close')).rejects.toThrow('CDP session is closed');
  });
});

// ---------------------------------------------------------------------------
// Tests — unexpected WebSocket close
// ---------------------------------------------------------------------------

describe('L2 — CdpSession: unexpected close', () => {
  it('rejects all pending commands when ws.onclose fires', async () => {
    const session = await connectAndOpen();
    const p1 = session.send('Pending.one');
    const p2 = session.send('Pending.two');
    await Promise.resolve();

    fakeState.currentFake!.triggerClose();

    await expect(p1).rejects.toThrow('CDP WebSocket closed unexpectedly');
    await expect(p2).rejects.toThrow('CDP WebSocket closed unexpectedly');
  });
});

// ---------------------------------------------------------------------------
// Tests — connectEventCdp event subscriptions
// ---------------------------------------------------------------------------

describe('L2 — connectEventCdp: event subscriptions', () => {
  it('exposes on/off for event subscription', async () => {
    const session = await connectEventAndOpen();
    expect(typeof session.on).toBe('function');
    expect(typeof session.off).toBe('function');
  });

  it('dispatches events to subscribed handlers', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    session.on('Overlay.inspectNodeRequested', (p) => events.push(p));

    fakeState.currentFake!.serverSend(
      JSON.stringify({ method: 'Overlay.inspectNodeRequested', params: { backendNodeId: 7 } }),
    );
    await Promise.resolve();
    expect(events).toEqual([{ backendNodeId: 7 }]);
  });

  it('does not dispatch after off()', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    const handler = (params: unknown) => events.push(params);
    session.on('Target.targetCreated', handler);
    session.off('Target.targetCreated', handler);

    fakeState.currentFake!.serverSend(
      JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }),
    );
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it('ignores events with no subscribers', async () => {
    const session = await connectEventAndOpen();
    fakeState.currentFake!.serverSend(JSON.stringify({ method: 'Some.event', params: { a: 1 } }));
    await Promise.resolve();

    const p = session.send('Test.method');
    await Promise.resolve();
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Tests — onmessage edge cases
// ---------------------------------------------------------------------------

describe('L2 — CdpSession: onmessage edge cases', () => {
  it('ignores messages that are not valid JSON', async () => {
    const session = await connectAndOpen();
    const p = session.send('Test.method');
    await Promise.resolve();

    fakeState.currentFake!.serverSend('not valid json {{{');
    fakeState.currentFake!.serverSend('');

    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('silently ignores responses with unknown id', async () => {
    const session = await connectAndOpen();
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 42, result: 'ghost' }));
    await Promise.resolve();

    const p = session.send('Test.method');
    await Promise.resolve();
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('routes responses by id when multiple commands in flight', async () => {
    const session = await connectAndOpen();
    const p1 = session.send<{ n: number }>('Method.a');
    const p2 = session.send<{ n: number }>('Method.b');
    const p3 = session.send<{ n: number }>('Method.c');
    await Promise.resolve();

    fakeState.currentFake!.serverSend(JSON.stringify({ id: 2, result: { n: 20 } }));
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 3, result: { n: 30 } }));
    fakeState.currentFake!.serverSend(JSON.stringify({ id: 1, result: { n: 10 } }));

    await expect(p1).resolves.toEqual({ n: 10 });
    await expect(p2).resolves.toEqual({ n: 20 });
    await expect(p3).resolves.toEqual({ n: 30 });
  });
});
