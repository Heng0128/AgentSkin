// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock CdpSession: in-memory stub that records send() calls and resolves
// immediately (no real WebSocket).
// ---------------------------------------------------------------------------
class MockCdpSession {
  target: object;
  timeoutMs: number;
  closed = false;
  sentMessages: Array<{ method: string; params: object }> = [];
  evaluateCalls: string[] = [];
  private listeners = new Map<string, Set<(params: unknown) => void>>();

  constructor(target: object, timeoutMs = 10000) {
    this.target = target;
    this.timeoutMs = timeoutMs;
  }

  async open() {
    return this;
  }

  async send(method: string, params: object = {}) {
    this.sentMessages.push({ method, params });
    // Synthesize a plausible CDP result frame.
    if (method === 'Runtime.evaluate') {
      return { result: { type: 'string', value: `evaluated:${(params as { expression: string }).expression}` } };
    }
    return {};
  }

  async evaluate(expression: string) {
    this.evaluateCalls.push(expression);
    return `eval:${expression}`;
  }

  on(method: string, listener: (params: unknown) => void) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method)!.add(listener);
  }

  close() {
    this.closed = true;
  }
}

/** Factory stub: returns a MockCdpSession and records its construction. */
const createdSessions: MockCdpSession[] = [];
function mockSessionFactory(target: object, timeoutMs: number) {
  const s = new MockCdpSession(target, timeoutMs);
  createdSessions.push(s);
  return Promise.resolve(s);
}

// ---------------------------------------------------------------------------
// Mock fetch: returns a configurable target list for /json/list.
// ---------------------------------------------------------------------------
let mockTargets: object[] = [];
const mockFetch = vi.fn((_url: string, _init?: RequestInit) => {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(mockTargets),
  } as Response);
});

// Mock listCdpTargets so SessionCollection uses our fake target list without
// touching the real network. We inline the filter logic here to mirror the
// production code's behavior (SessionCollection calls listCdpTargets directly).
vi.mock('../../src/engine/src/cdp/session.mjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/src/cdp/session.mjs')>();
  return {
    ...actual,
    listCdpTargets: vi.fn((_port: number, _timeoutMs?: number) => Promise.resolve(mockTargets)),
  };
});

// Import AFTER mock is declared (vitest hoists vi.mock, but ESM needs this order for the import binding).
const { SessionCollection } = await import('../../src/engine/src/cdp/session-collection.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'target-1',
    type: 'page',
    url: 'http://localhost',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    title: 'Test Page',
    ...overrides,
  };
}

beforeEach(() => {
  mockTargets = [];
  createdSessions.length = 0;
  mockFetch.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('SessionCollection', () => {
  it('discover() filters targets by type and does NOT open connections', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'page-3', type: 'page' }),
      makeTarget({ id: 'worker-1', type: 'service_worker' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    const found = await coll.discover();
    expect(found).toHaveLength(3); // worker filtered out
    expect(coll.size).toBe(0); // discover does not connect
  });

  it('connect() opens a CdpSession for every discovered target', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'iframe-1', type: 'iframe' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    expect(coll.size).toBe(3);
    expect(createdSessions).toHaveLength(3);
    expect(coll.sessions.map((s) => s.id).sort()).toEqual(['iframe-1', 'page-1', 'page-2']);
  });

  it('send(method, params, targetId) routes to a single session', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    const result = await coll.send('Runtime.evaluate', { expression: '1+1' }, 'page-1');
    // Only page-1's session should have received the message.
    expect(createdSessions[0].sentMessages).toHaveLength(1);
    expect(createdSessions[0].sentMessages[0].method).toBe('Runtime.evaluate');
    expect(createdSessions[1].sentMessages).toHaveLength(0);
    expect((result as { result: { value: string } }).result.value).toContain('evaluated');
  });

  it('broadcast(method) sends to every page session (not iframe)', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'iframe-1', type: 'iframe' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    const results = await coll.broadcast('Page.reload', {}, 'page');
    expect(results).toHaveLength(2); // only the 2 page sessions
    expect(createdSessions[0].sentMessages).toHaveLength(1);
    expect(createdSessions[1].sentMessages).toHaveLength(1);
    expect(createdSessions[2].sentMessages).toHaveLength(0); // iframe skipped
  });

  it('evaluate(expression) wraps Runtime.evaluate on a specific target', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    const result = await coll.evaluate('document.title', 'page-1');
    expect(createdSessions[0].evaluateCalls).toEqual(['document.title']);
    expect(createdSessions[1].evaluateCalls).toEqual([]);
    expect(result).toBe('eval:document.title');
  });

  it('evaluate(expression) without targetId broadcasts to all pages', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'iframe-1', type: 'iframe' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    const results = await coll.evaluate('document.title');
    expect(results).toHaveLength(2); // 2 page sessions only
  });

  it('remove(targetId) closes the session and decrements size', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    expect(coll.size).toBe(2);
    const removed = coll.remove('page-1');
    expect(removed).toBe(true);
    expect(coll.size).toBe(1);
    expect(createdSessions[0].closed).toBe(true);
    expect(createdSessions[1].closed).toBe(false);
    // Removing a non-existent id is a no-op.
    expect(coll.remove('page-1')).toBe(false);
  });

  it('stats() returns correct byType counts', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'iframe-1', type: 'iframe' }),
      makeTarget({ id: 'worker-1', type: 'service_worker' }),
    ];
    // Include 'worker' type so the worker is managed.
    const coll = new SessionCollection({ port: 9222, types: ['page', 'iframe', 'worker'], sessionFactory: mockSessionFactory });
    await coll.connect();
    const stats = coll.stats();
    expect(stats.total).toBe(4);
    expect(stats.byType).toEqual({ page: 2, iframe: 1, worker: 1 });
  });

  it('closeAll() closes every session and clears the collection', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    expect(coll.size).toBe(2);
    await coll.closeAll();
    expect(coll.size).toBe(0);
    expect(coll.sessions).toEqual([]);
    expect(createdSessions.every((s) => s.closed)).toBe(true);
  });

  it('send() with no targetId broadcasts to page sessions', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
      makeTarget({ id: 'iframe-1', type: 'iframe' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    const results = await coll.send('Page.reload') as unknown[];
    expect(results).toHaveLength(2); // 2 page sessions
    expect(createdSessions[0].sentMessages).toHaveLength(1);
    expect(createdSessions[1].sentMessages).toHaveLength(1);
    expect(createdSessions[2].sentMessages).toHaveLength(0); // iframe skipped
  });

  it('connect() drops sessions whose target disappeared between discovers', async () => {
    mockTargets = [
      makeTarget({ id: 'page-1', type: 'page' }),
      makeTarget({ id: 'page-2', type: 'page' }),
    ];
    const coll = new SessionCollection({ port: 9222, sessionFactory: mockSessionFactory });
    await coll.connect();
    expect(coll.size).toBe(2);
    // Remove page-1 from the target list; next connect should drop it.
    mockTargets = [makeTarget({ id: 'page-2', type: 'page' })];
    await coll.connect();
    expect(coll.size).toBe(1);
    expect(createdSessions[0].closed).toBe(true); // page-1's session closed
    expect(createdSessions[1].closed).toBe(false); // page-2's session alive
  });
});
