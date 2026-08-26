// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerformanceRecorder } from '../services/performance';
import { type CdpSession, connectCdp, connectEventCdp, type EventCdpSession } from './cdp-client';

// ---------------------------------------------------------------------------
// FakeWebSocket — a minimal, controllable stand-in for the global WebSocket.
//
// `cdp-client.ts` relies on the Node 22+ / Electron 37+ global WebSocket.
// We replace it with this fake so tests can deterministically drive the
// event callbacks (`onopen`, `onmessage`, `onclose`, `onerror`) and capture
// outgoing `send()` payloads to simulate CDP responses.
// ---------------------------------------------------------------------------

interface FakeWebSocketInstance {
  url: string;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(): void;
  /** Test-only: simulate the server sending a message. */
  serverSend(data: string): void;
  /** Test-only: trigger the open event. */
  triggerOpen(): void;
  /** Test-only: trigger the close event. */
  triggerClose(): void;
  /** Test-only: trigger the error event. */
  triggerError(): void;
  closed: boolean;
  sentMessages: string[];
}

let currentFake: FakeWebSocketInstance | null = null;

class FakeWebSocket {
  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
    currentFake = this as unknown as FakeWebSocketInstance;
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
}

// Keep a reference so we can restore it after each test.
const OriginalWebSocket = globalThis.WebSocket;

beforeEach(() => {
  currentFake = null;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  globalThis.WebSocket = OriginalWebSocket;
  currentFake = null;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the last outgoing CDP message sent via ws.send(). */
function lastSentMessage(): { id: number; method: string; params: Record<string, unknown> } {
  const fake = currentFake!;
  const raw = fake.sentMessages[fake.sentMessages.length - 1];
  return JSON.parse(raw);
}

/** Connect and immediately trigger onopen so connectCdp resolves. */
async function connectAndOpen(): Promise<CdpSession> {
  const promise = connectCdp('ws://127.0.0.1:9336/devtools/page/abc');
  // Microtask: let connectCdp attach handlers before we trigger open.
  await Promise.resolve();
  currentFake!.triggerOpen();
  return promise;
}

/** Same as connectAndOpen but for the event-aware entry point. */
async function connectEventAndOpen(): Promise<EventCdpSession> {
  const promise = connectEventCdp('ws://127.0.0.1:9336/devtools/page/abc');
  await Promise.resolve();
  currentFake!.triggerOpen();
  return promise;
}

// ---------------------------------------------------------------------------
// connectCdp — connection lifecycle
// ---------------------------------------------------------------------------

describe('connectCdp', () => {
  describe('successful connection', () => {
    it('resolves with a CdpSession when ws.onopen fires', async () => {
      const session = await connectAndOpen();
      expect(session).toBeDefined();
      expect(typeof session.send).toBe('function');
      expect(typeof session.evaluate).toBe('function');
      expect(typeof session.close).toBe('function');
    });

    it('passes the webSocketDebuggerUrl to the WebSocket constructor', async () => {
      const url = 'ws://127.0.0.1:9999/devtools/page/xyz';
      const promise = connectCdp(url);
      await Promise.resolve();
      expect(currentFake!.url).toBe(url);
      currentFake!.triggerOpen();
      await promise;
    });
  });

  describe('connection timeout', () => {
    it('rejects with "CDP connect timeout" when onopen does not fire in time', async () => {
      vi.useFakeTimers();
      try {
        const promise = connectCdp('ws://localhost/x', 1000);
        await Promise.resolve();
        // Attach handler before advancing timers to avoid unhandled rejection.
        const assertion = expect(promise).rejects.toThrow('CDP connect timeout');
        await vi.advanceTimersByTimeAsync(1001);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it('calls session.close() on connect timeout to clean up the socket', async () => {
      vi.useFakeTimers();
      try {
        const promise = connectCdp('ws://localhost/x', 1000);
        await Promise.resolve();
        const assertion = expect(promise).rejects.toThrow();
        await vi.advanceTimersByTimeAsync(1001);
        await assertion;
        expect(currentFake!.closed).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('connection error', () => {
    it('rejects with "CDP connection failed" when ws.onerror fires', async () => {
      const promise = connectCdp('ws://localhost/x');
      await Promise.resolve();
      currentFake!.triggerError();
      await expect(promise).rejects.toThrow('CDP connection failed');
    });

    it('calls session.close() on connection error', async () => {
      const promise = connectCdp('ws://localhost/x');
      await Promise.resolve();
      currentFake!.triggerError();
      await expect(promise).rejects.toThrow();
      expect(currentFake!.closed).toBe(true);
    });
  });

  describe('default timeouts', () => {
    it('uses 5000ms open timeout by default', async () => {
      vi.useFakeTimers();
      try {
        const promise = connectCdp('ws://localhost/x');
        await Promise.resolve();
        // Advance just under 5000ms — should still be pending.
        await vi.advanceTimersByTimeAsync(4999);
        // Cross the threshold — should reject.
        const assertion = expect(promise).rejects.toThrow('CDP connect timeout');
        await vi.advanceTimersByTimeAsync(2);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// session.send()
// ---------------------------------------------------------------------------

describe('CdpSession.send', () => {
  it('sends a JSON message with incrementing id, method, and params', async () => {
    const session = await connectAndOpen();
    const sendPromise = session.send('Page.reload', { frameId: 'main' });
    await Promise.resolve();

    const msg = lastSentMessage();
    expect(msg.id).toBe(1);
    expect(msg.method).toBe('Page.reload');
    expect(msg.params).toEqual({ frameId: 'main' });

    // Respond so the promise resolves.
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { ok: true } }));
    await expect(sendPromise).resolves.toEqual({ ok: true });
  });

  it('defaults params to empty object when not provided', async () => {
    const session = await connectAndOpen();
    const sendPromise = session.send('Page.frameTree');
    await Promise.resolve();

    const msg = lastSentMessage();
    expect(msg.params).toEqual({});

    currentFake!.serverSend(JSON.stringify({ id: 1, result: {} }));
    await sendPromise;
  });

  it('increments id for each subsequent command', async () => {
    const session = await connectAndOpen();

    const p1 = session.send('Method.one');
    await Promise.resolve();
    expect(lastSentMessage().id).toBe(1);
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'r1' }));
    await p1;

    const p2 = session.send('Method.two');
    await Promise.resolve();
    expect(lastSentMessage().id).toBe(2);
    currentFake!.serverSend(JSON.stringify({ id: 2, result: 'r2' }));
    await p2;
  });

  it('resolves with the result field from the CDP response', async () => {
    const session = await connectAndOpen();
    const p = session.send<{ value: number }>('Runtime.evaluate', { expression: '1+1' });
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { value: 42 } }));
    await expect(p).resolves.toEqual({ value: 42 });
  });

  it('rejects with error message and code when CDP returns an error', async () => {
    const session = await connectAndOpen();
    const p = session.send('Page.navigate', { url: 'bad://' });
    await Promise.resolve();
    currentFake!.serverSend(
      JSON.stringify({ id: 1, error: { message: 'Cannot navigate', code: -32000 } }),
    );
    await expect(p).rejects.toThrow('Cannot navigate (-32000)');
  });

  it('rejects with "CDP request timed out: <method>" after commandTimeoutMs', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      currentFake!.triggerOpen();
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
      currentFake!.triggerOpen();
      const session = await promise;
      const p = session.send('Slow.method');
      await Promise.resolve();
      const assertion = expect(p).rejects.toThrow('CDP request timed out');
      await vi.advanceTimersByTimeAsync(201);
      await assertion;

      // Late response should be ignored (pending entry already deleted).
      currentFake!.serverSend(JSON.stringify({ id: 1, result: 'late' }));
      // Give it a microtask to potentially reject again.
      await Promise.resolve();
      // No unhandled rejection — the test passes if we get here.
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects if ws.send() throws (socket not ready)', async () => {
    const session = await connectAndOpen();
    // Override send to throw.
    currentFake!.send = () => {
      throw new Error('WebSocket is not open');
    };
    await expect(session.send('Any.method')).rejects.toThrow('WebSocket is not open');
  });

  it('handles non-Error throws from ws.send() by wrapping in Error', async () => {
    const session = await connectAndOpen();
    currentFake!.send = () => {
      throw 'string error';
    };
    await expect(session.send('Any.method')).rejects.toThrow('string error');
  });
});

// ---------------------------------------------------------------------------
// session.evaluate()
// ---------------------------------------------------------------------------

describe('CdpSession.evaluate', () => {
  it('sends Runtime.evaluate with expression, returnByValue, and awaitPromise', async () => {
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

    currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: { value: 'My Page' } } }));
    await expect(p).resolves.toBe('My Page');
  });

  it('returns stringified value when result.value is a number', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('1 + 1');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: { value: 2 } } }));
    await expect(p).resolves.toBe('2');
  });

  it('returns "null" when result.value is null or undefined', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('void 0');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: { value: null } } }));
    await expect(p).resolves.toBe('null');
  });

  it('returns "null" when result.value is missing entirely', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('someExpression');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: {} } }));
    await expect(p).resolves.toBe('null');
  });

  it('rejects with "Renderer evaluation failed: <desc>" when exceptionDetails has exception.description', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('throw new Error("boom")');
    await Promise.resolve();
    currentFake!.serverSend(
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

  it('falls back to exceptionDetails.text when exception.description is missing', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('badCode');
    await Promise.resolve();
    currentFake!.serverSend(
      JSON.stringify({
        id: 1,
        result: {
          result: {},
          exceptionDetails: { text: 'SyntaxError: Unexpected token' },
        },
      }),
    );
    await expect(p).rejects.toThrow('Renderer evaluation failed: SyntaxError: Unexpected token');
  });

  it('falls back to "unknown renderer error" when exceptionDetails has no text', async () => {
    const session = await connectAndOpen();
    const p = session.evaluate('badCode');
    await Promise.resolve();
    currentFake!.serverSend(
      JSON.stringify({
        id: 1,
        result: {
          result: {},
          exceptionDetails: {},
        },
      }),
    );
    await expect(p).rejects.toThrow('Renderer evaluation failed: unknown renderer error');
  });
});

// ---------------------------------------------------------------------------
// session.close()
// ---------------------------------------------------------------------------

describe('CdpSession.close', () => {
  it('closes the underlying WebSocket', async () => {
    const session = await connectAndOpen();
    expect(currentFake!.closed).toBe(false);
    session.close();
    expect(currentFake!.closed).toBe(true);
  });

  it('rejects all pending commands with "CDP session closed."', async () => {
    const session = await connectAndOpen();
    const p1 = session.send('Pending.one');
    const p2 = session.send('Pending.two');
    await Promise.resolve();

    session.close();

    await expect(p1).rejects.toThrow('CDP session closed.');
    await expect(p2).rejects.toThrow('CDP session closed.');
  });

  it('does not throw if ws.close() throws (already closed)', async () => {
    const session = await connectAndOpen();
    currentFake!.close = () => {
      throw new Error('already closed');
    };
    // Should not throw.
    expect(() => session.close()).not.toThrow();
  });

  it('is safe to call multiple times', async () => {
    const session = await connectAndOpen();
    session.close();
    // Second call should not throw even though ws is already closed.
    expect(() => session.close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// CdpSession.close — resource cleanup (RC1 regression guard)
// ---------------------------------------------------------------------------

describe('CdpSession.close — resource cleanup (RC1)', () => {
  it('rejects pending command on close and clears its timeout timer (no dangling handle)', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      currentFake!.triggerOpen();
      const session = await promise;
      const p = session.send('Slow.method');
      await Promise.resolve();
      session.close();
      // close() must reject the pending command immediately (timer cleared).
      await expect(p).rejects.toThrow('CDP session closed.');
      // Advance well past the command timeout — the cleared timer must not
      // re-fire and must not leave a dangling handle in the event loop.
      await vi.advanceTimersByTimeAsync(1000);
      // Subsequent sends fail immediately, not after the (cleared) timeout.
      const p2 = session.send('After.close');
      await Promise.resolve();
      await expect(p2).rejects.toThrow('CDP session is closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears event listeners on close so registered handlers do not leak', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    session.on('Target.targetCreated', (p) => events.push(p));
    session.close();
    // After close, listeners must be cleared; event must not reach handler.
    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }));
    await Promise.resolve();
    expect(events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Unexpected socket close (ws.onclose)
// ---------------------------------------------------------------------------

describe('unexpected WebSocket close', () => {
  it('rejects all pending commands when ws.onclose fires', async () => {
    const session = await connectAndOpen();
    const p1 = session.send('Pending.one');
    const p2 = session.send('Pending.two');
    await Promise.resolve();

    currentFake!.triggerClose();

    await expect(p1).rejects.toThrow('CDP WebSocket closed unexpectedly');
    await expect(p2).rejects.toThrow('CDP WebSocket closed unexpectedly');
  });

  it('does not affect future commands after close (they just hang until timeout)', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      currentFake!.triggerOpen();
      const session = await promise;
      currentFake!.triggerClose();

      const p = session.send('After.close');
      await Promise.resolve();
      // The socket is closed; ws.send may or may not throw depending on impl.
      // Either way, after commandTimeoutMs the request times out.
      const assertion = expect(p).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(201);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// onmessage — edge cases
// ---------------------------------------------------------------------------

describe('onmessage edge cases', () => {
  it('ignores messages that are not valid JSON', async () => {
    const session = await connectAndOpen();
    const p = session.send('Test.method');
    await Promise.resolve();

    // Send garbage — should be silently ignored, not crash.
    currentFake!.serverSend('not valid json {{{');
    currentFake!.serverSend('');
    currentFake!.serverSend('{ broken');

    // The real response still works.
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('ignores messages with no id field', async () => {
    const session = await connectAndOpen();
    // These are events (e.g. Target.targetCreated) — no id, no pending waiter.
    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: {} }));
    currentFake!.serverSend(JSON.stringify({ result: 'orphan' }));

    // Session is still usable.
    const p = session.send('Test.method');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('ignores responses with unknown id (already resolved/timed out)', async () => {
    vi.useFakeTimers();
    try {
      const promise = connectCdp('ws://localhost/x', 5000, 200);
      await Promise.resolve();
      currentFake!.triggerOpen();
      const session = await promise;
      const p = session.send('Test.method');
      await Promise.resolve();
      const assertion = expect(p).rejects.toThrow('timed out');
      await vi.advanceTimersByTimeAsync(201);
      await assertion;

      // Late response with the timed-out id — should be silently ignored.
      currentFake!.serverSend(JSON.stringify({ id: 1, result: 'late' }));
      await Promise.resolve();
      // No crash, no unhandled rejection.
    } finally {
      vi.useRealTimers();
    }
  });

  it('correctly routes responses by id when multiple commands are in flight', async () => {
    const session = await connectAndOpen();
    const p1 = session.send<{ n: number }>('Method.a');
    const p2 = session.send<{ n: number }>('Method.b');
    const p3 = session.send<{ n: number }>('Method.c');
    await Promise.resolve();

    // Respond out of order.
    currentFake!.serverSend(JSON.stringify({ id: 2, result: { n: 20 } }));
    currentFake!.serverSend(JSON.stringify({ id: 3, result: { n: 30 } }));
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { n: 10 } }));

    await expect(p1).resolves.toEqual({ n: 10 });
    await expect(p2).resolves.toEqual({ n: 20 });
    await expect(p3).resolves.toEqual({ n: 30 });
  });
});

// ---------------------------------------------------------------------------
// connectEventCdp — event subscription (CDP-4)
// ---------------------------------------------------------------------------

describe('connectEventCdp', () => {
  it('exposes on/off alongside send/evaluate/close', async () => {
    const session = await connectEventAndOpen();
    expect(typeof session.send).toBe('function');
    expect(typeof session.evaluate).toBe('function');
    expect(typeof session.close).toBe('function');
    expect(typeof session.on).toBe('function');
    expect(typeof session.off).toBe('function');
  });

  it('dispatches events to subscribed handlers (CDP-4)', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    session.on('Overlay.inspectNodeRequested', (params) => events.push(params));

    currentFake!.serverSend(
      JSON.stringify({ method: 'Overlay.inspectNodeRequested', params: { backendNodeId: 7 } }),
    );
    await Promise.resolve();
    expect(events).toEqual([{ backendNodeId: 7 }]);
  });

  it('dispatches to multiple handlers for the same event', async () => {
    const session = await connectEventAndOpen();
    const a: unknown[] = [];
    const b: unknown[] = [];
    session.on('Target.targetCreated', (p) => a.push(p));
    session.on('Target.targetCreated', (p) => b.push(p));

    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }));
    await Promise.resolve();
    expect(a).toEqual([{ x: 1 }]);
    expect(b).toEqual([{ x: 1 }]);
  });

  it('does not dispatch after off()', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    const handler = (params: unknown) => events.push(params);
    session.on('Target.targetCreated', handler);
    session.off('Target.targetCreated', handler);

    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }));
    await Promise.resolve();
    expect(events).toEqual([]);
  });

  it('does not dispatch removed handler while keeping others', async () => {
    const session = await connectEventAndOpen();
    const a: unknown[] = [];
    const b: unknown[] = [];
    const handlerA = (p: unknown) => a.push(p);
    const handlerB = (p: unknown) => b.push(p);
    session.on('Target.targetCreated', handlerA);
    session.on('Target.targetCreated', handlerB);
    session.off('Target.targetCreated', handlerA);

    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }));
    await Promise.resolve();
    expect(a).toEqual([]);
    expect(b).toEqual([{ x: 1 }]);
  });

  it('ignores events with no subscribers', async () => {
    const session = await connectEventAndOpen();
    // No subscriber — must not throw or corrupt pending map.
    currentFake!.serverSend(JSON.stringify({ method: 'Some.event', params: { a: 1 } }));
    await Promise.resolve();

    // Session still usable.
    const p = session.send('Test.method');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('a throwing handler does not break the socket or other handlers', async () => {
    const session = await connectEventAndOpen();
    const b: unknown[] = [];
    session.on('Target.targetCreated', () => {
      throw new Error('bad handler');
    });
    session.on('Target.targetCreated', (p) => b.push(p));

    currentFake!.serverSend(JSON.stringify({ method: 'Target.targetCreated', params: { x: 1 } }));
    await Promise.resolve();
    expect(b).toEqual([{ x: 1 }]);

    // Socket still usable after the throwing handler.
    const p = session.send('Test.method');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('keeps evaluating while subscribed to events', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    session.on('Log.entryAdded', (p) => events.push(p));

    // Event and response interleaved — the event must not steal the response.
    currentFake!.serverSend(JSON.stringify({ method: 'Log.entryAdded', params: { entry: 1 } }));
    const p = session.evaluate('1+1');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { result: { value: 2 } } }));
    await expect(p).resolves.toBe('2');
    expect(events).toEqual([{ entry: 1 }]);
  });

  it('routes responses and events independently when both in flight', async () => {
    const session = await connectEventAndOpen();
    const events: unknown[] = [];
    session.on('Target.targetCreated', (p) => events.push(p));

    const p1 = session.send<{ n: number }>('Method.a');
    const p2 = session.send<{ n: number }>('Method.b');
    await Promise.resolve();

    // Interleave an event between the two responses.
    currentFake!.serverSend(JSON.stringify({ id: 1, result: { n: 10 } }));
    currentFake!.serverSend(
      JSON.stringify({ method: 'Target.targetCreated', params: { t: 'new' } }),
    );
    currentFake!.serverSend(JSON.stringify({ id: 2, result: { n: 20 } }));

    await expect(p1).resolves.toEqual({ n: 10 });
    await expect(p2).resolves.toEqual({ n: 20 });
    expect(events).toEqual([{ t: 'new' }]);
  });
});

// ---------------------------------------------------------------------------
// connectEventCdp — error path records timing step (RFC §4.9)
// ---------------------------------------------------------------------------

describe('connectEventCdp — error path records timing step', () => {
  it('calls recordNamedStep with step "connectEventCdp" when connection fails', async () => {
    const spy = vi.spyOn(PerformanceRecorder, 'recordNamedStep');
    try {
      const promise = connectEventCdp('ws://localhost/x');
      await Promise.resolve();
      currentFake!.triggerError();
      await expect(promise).rejects.toThrow('CDP connection failed');

      // Verify the error-path .catch() branch recorded the step with the
      // correct name ('connectEventCdp') and success=false.
      expect(spy).toHaveBeenCalledWith(
        undefined,
        'connectEventCdp',
        expect.any(Number),
        false,
        expect.any(String),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('calls recordNamedStep with step "connectEventCdp" on connect timeout', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(PerformanceRecorder, 'recordNamedStep');
    try {
      const promise = connectEventCdp('ws://localhost/x', 1000);
      await Promise.resolve();
      const assertion = expect(promise).rejects.toThrow('CDP connect timeout');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;

      // Timeout path must also record the step (success=false by default).
      expect(spy).toHaveBeenCalledWith(
        undefined,
        'connectEventCdp',
        expect.any(Number),
        false,
        expect.any(String),
      );
    } finally {
      vi.useRealTimers();
      spy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// pending Map — ghost response (id not in pending)
// ---------------------------------------------------------------------------

describe('pending Map ghost response', () => {
  it('silently ignores a response whose id is not in the pending map', async () => {
    const session = await connectAndOpen();
    // No command was sent — id 42 does not exist in pending. Must not throw.
    currentFake!.serverSend(JSON.stringify({ id: 42, result: 'ghost' }));
    await Promise.resolve();

    // Session remains usable after the ghost response.
    const p = session.send('Test.method');
    await Promise.resolve();
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'ok' }));
    await expect(p).resolves.toBe('ok');
  });

  it('does not corrupt the pending map when a ghost response arrives between real commands', async () => {
    const session = await connectAndOpen();
    const p1 = session.send('Method.one');
    await Promise.resolve();

    // Ghost response for a non-existent id — must not affect p1.
    currentFake!.serverSend(JSON.stringify({ id: 999, result: 'phantom' }));
    await Promise.resolve();

    // The real response still resolves correctly.
    currentFake!.serverSend(JSON.stringify({ id: 1, result: 'real' }));
    await expect(p1).resolves.toBe('real');
  });
});
