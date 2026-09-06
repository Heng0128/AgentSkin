// SPDX-License-Identifier: MPL-2.0
//
// Unit tests for mcp-debug-tools.mjs — CDP-based Debug Tools for MCP Server.
//
// Three test tiers:
//   1. Structure validation — verify exports and constants (no CDP needed).
//   2. Offline scenarios — agents not running, structured error returns.
//   3. Mocked CDP — vi.mock to simulate live targets and verify success paths.

import { afterEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock setup — vi.mock is hoisted by vitest, so we can use a normal import
// after it and the module under test will receive the stubbed engine functions.
// ---------------------------------------------------------------------------

class MockCdpSession {
  constructor(target, timeout) {
    this.target = target;
    this.timeout = timeout;
  }

  async open() {
    return mockSession;
  }
}

const mockSession = {
  send: vi.fn(),
  evaluate: vi.fn(),
  close: vi.fn(),
};

const mockFindTargets = vi.fn();
const mockListCdpTargets = vi.fn();
const mockResolveDebugPorts = vi.fn();
const mockFindRunningPids = vi.fn();
const mockGetAdapter = vi.fn();
const mockListAdapters = vi.fn();

vi.mock('../../src/engine/src/index.mjs', () => ({
  CdpSession: MockCdpSession,
  findTargets: mockFindTargets,
  listCdpTargets: mockListCdpTargets,
  resolveDebugPorts: mockResolveDebugPorts,
  findRunningPids: mockFindRunningPids,
  getAdapter: mockGetAdapter,
  listAdapters: mockListAdapters,
}));

// Import after mock declaration (vitest hoists vi.mock above the import).
// NOTE: No cache-busting query param — Vite cannot resolve dynamic imports
// with a `?timestamp` suffix (throws "Unknown variable dynamic import").
const {
  KNOWN_PORT_HINTS,
  getAppliedTheme,
  getDomSnapshot,
  listDiscoveryTargets,
  resolveLivePort,
  takeScreenshot,
  verifyInjection,
} = await import('./mcp-debug-tools.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake adapter for a given agentId. */
function fakeAdapter(agentId, overrides = {}) {
  return {
    id: agentId,
    displayName: `${agentId} Display`,
    matchTarget: () => true,
    ...overrides,
  };
}

/** Reset all mocks to a clean state. */
function resetMocks() {
  mockFindTargets.mockReset();
  mockListCdpTargets.mockReset();
  mockResolveDebugPorts.mockReset();
  mockFindRunningPids.mockReset();
  mockGetAdapter.mockReset();
  mockListAdapters.mockReset();
  mockSession.send.mockReset();
  mockSession.evaluate.mockReset();
  mockSession.close.mockReset();
}

/** Configure mocks to simulate an agent running on a known port. */
function setupOnlineAgent(agentId, port) {
  const adapter = fakeAdapter(agentId);
  mockGetAdapter.mockReturnValue(adapter);
  mockFindTargets.mockResolvedValue([
    { title: `${agentId} window`, url: `http://localhost:${port}/index.html`, type: 'page' },
  ]);
  mockResolveDebugPorts.mockResolvedValue([]);
  mockFindRunningPids.mockResolvedValue([]);
  return adapter;
}

// ---------------------------------------------------------------------------
// Group 1: Export structure validation (4 tests)
// ---------------------------------------------------------------------------

describe('export structure validation', () => {
  it('KNOWN_PORT_HINTS is a frozen non-null object', () => {
    expect(KNOWN_PORT_HINTS).toBeTypeOf('object');
    expect(KNOWN_PORT_HINTS).not.toBeNull();
    expect(Object.isFrozen(KNOWN_PORT_HINTS)).toBe(true);
  });

  it('takeScreenshot is an async function', () => {
    expect(takeScreenshot).toBeTypeOf('function');
    expect(takeScreenshot.constructor.name).toBe('AsyncFunction');
  });

  it('getDomSnapshot and verifyInjection are async functions', () => {
    expect(getDomSnapshot).toBeTypeOf('function');
    expect(getDomSnapshot.constructor.name).toBe('AsyncFunction');
    expect(verifyInjection).toBeTypeOf('function');
    expect(verifyInjection.constructor.name).toBe('AsyncFunction');
  });

  it('listDiscoveryTargets and getAppliedTheme are async functions', () => {
    expect(listDiscoveryTargets).toBeTypeOf('function');
    expect(listDiscoveryTargets.constructor.name).toBe('AsyncFunction');
    expect(getAppliedTheme).toBeTypeOf('function');
    expect(getAppliedTheme.constructor.name).toBe('AsyncFunction');
  });
});

// ---------------------------------------------------------------------------
// Group 2: KNOWN_PORT_HINTS content validation (3 tests)
// ---------------------------------------------------------------------------

describe('KNOWN_PORT_HINTS content', () => {
  it('contains all five agents with standard CDP support', () => {
    const keys = Object.keys(KNOWN_PORT_HINTS);
    expect(keys).toContain('workbuddy');
    expect(keys).toContain('doubao');
    expect(keys).toContain('qoderwork');
    expect(keys).toContain('zcode');
    expect(keys).toContain('codex');
  });

  it('each hint is a positive integer port number', () => {
    for (const [_agentId, port] of Object.entries(KNOWN_PORT_HINTS)) {
      expect(Number.isInteger(port)).toBe(true);
      expect(port).toBeGreaterThan(0);
      expect(port).toBeLessThanOrEqual(65535);
    }
  });

  it('excludes traework (no standard CDP support)', () => {
    expect(KNOWN_PORT_HINTS).not.toHaveProperty('traework');
    expect(Object.keys(KNOWN_PORT_HINTS)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Group 3: Offline / agent-not-running scenarios (5 tests)
// ---------------------------------------------------------------------------

describe('offline scenarios — agent not running', () => {
  afterEach(resetMocks);

  it('takeScreenshot returns ok:false when agent is not running', async () => {
    resetMocks();
    const result = await takeScreenshot('codex');
    expect(result).toHaveProperty('ok', false);
    expect(result).toHaveProperty('agentId', 'codex');
    expect(result).toHaveProperty('error');
  });

  it('getDomSnapshot returns ok:false when agent is not running', async () => {
    resetMocks();
    const result = await getDomSnapshot('workbuddy');
    expect(result.ok).toBe(false);
    expect(result.agentId).toBe('workbuddy');
    expect(result.error).toBeTypeOf('string');
  });

  it('verifyInjection returns ok:false when agent is not running', async () => {
    resetMocks();
    const result = await verifyInjection('zcode');
    expect(result.ok).toBe(false);
    expect(result.agentId).toBe('zcode');
    expect(result.error).toBeTypeOf('string');
  });

  it('getAppliedTheme returns ok:false when agent is not running', async () => {
    resetMocks();
    const result = await getAppliedTheme('qoderwork');
    expect(result.ok).toBe(false);
    expect(result.agentId).toBe('qoderwork');
    expect(result.error).toBeTypeOf('string');
  });

  it('listDiscoveryTargets returns empty array when no agents are running', async () => {
    resetMocks();
    mockListAdapters.mockReturnValue([fakeAdapter('codex'), fakeAdapter('workbuddy')]);
    mockListCdpTargets.mockRejectedValue(new Error('ECONNREFUSED'));
    mockFindTargets.mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await listDiscoveryTargets();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Offline error structure consistency (3 tests)
// ---------------------------------------------------------------------------

describe('offline error structure consistency', () => {
  afterEach(resetMocks);

  it('offline error snapshot for takeScreenshot has required fields', async () => {
    resetMocks();
    const result = await takeScreenshot('workbuddy');
    // Must have exactly the documented ok:false shape.
    expect(Object.keys(result).sort()).toEqual(['agentId', 'error', 'ok']);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not running/);
  });

  it('offline error mentions the agentId in the message', async () => {
    resetMocks();
    const result = await getDomSnapshot('doubao');
    expect(result.error).toContain('doubao');
  });

  it('verifyInjection offline error message matches documented pattern', async () => {
    resetMocks();
    const result = await verifyInjection('codex');
    expect(result.error).toMatch(/codex.*not running/);
  });
});

// ---------------------------------------------------------------------------
// Group 5: Mocked CDP — takeScreenshot success path (3 tests)
// ---------------------------------------------------------------------------

describe('takeScreenshot — mocked success path', () => {
  afterEach(resetMocks);

  it('returns ok:true with base64 data when CDP target is live', async () => {
    resetMocks();
    setupOnlineAgent('codex', KNOWN_PORT_HINTS.codex);
    mockSession.send
      .mockResolvedValueOnce({}) // Page.enable
      .mockResolvedValueOnce({ data: 'iVBORKoRdA==fakeImageData' }); // Page.captureScreenshot

    const result = await takeScreenshot('codex');

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('codex');
    expect(result.port).toBe(KNOWN_PORT_HINTS.codex);
    expect(result.format).toBe('png');
    expect(result.data).toBe('iVBORKoRdA==fakeImageData');
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('url');
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('returns ok:false when CDP returns empty screenshot data', async () => {
    resetMocks();
    setupOnlineAgent('codex', KNOWN_PORT_HINTS.codex);
    mockSession.send
      .mockResolvedValueOnce({}) // Page.enable
      .mockResolvedValueOnce({ data: '' }); // empty screenshot

    const result = await takeScreenshot('codex');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty screenshot/i);
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('uses explicit port option when provided', async () => {
    resetMocks();
    setupOnlineAgent('codex', 99999);
    mockSession.send
      .mockResolvedValueOnce({}) // Page.enable
      .mockResolvedValueOnce({ data: 'abc123==' });

    const result = await takeScreenshot('codex', { port: 99999 });
    expect(result.ok).toBe(true);
    expect(result.port).toBe(99999);
  });
});

// ---------------------------------------------------------------------------
// Group 6: Mocked CDP — getDomSnapshot success path (2 tests)
// ---------------------------------------------------------------------------

describe('getDomSnapshot — mocked success path', () => {
  afterEach(resetMocks);

  it('returns ok:true with DOM tree structure when target is live', async () => {
    resetMocks();
    setupOnlineAgent('workbuddy', KNOWN_PORT_HINTS.workbuddy);

    const fakeDomResult = JSON.stringify({
      root: { t: 'html', d: 0, ch: [{ t: 'body', d: 1 }] },
      total: 42,
      truncated: false,
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeDomResult);

    const result = await getDomSnapshot('workbuddy');

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('workbuddy');
    expect(result.port).toBe(KNOWN_PORT_HINTS.workbuddy);
    expect(result).toHaveProperty('root');
    expect(result).toHaveProperty('totalNodes');
    expect(result).toHaveProperty('truncated');
    expect(result.totalNodes).toBe(42);
    expect(result.truncated).toBe(false);
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('respects maxDepth and maxNodes options via CDP evaluate injection', async () => {
    resetMocks();
    setupOnlineAgent('workbuddy', KNOWN_PORT_HINTS.workbuddy);

    const fakeDomResult = JSON.stringify({
      root: { t: 'html', d: 0 },
      total: 5,
      truncated: true,
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeDomResult);

    const result = await getDomSnapshot('workbuddy', { maxDepth: 3, maxNodes: 50 });

    expect(result.ok).toBe(true);
    // Verify the evaluate call included our custom params.
    const evalArg = mockSession.evaluate.mock.calls[0]?.[0];
    expect(evalArg).toContain('maxDepth = 3');
    expect(evalArg).toContain('maxNodes = 50');
  });
});

// ---------------------------------------------------------------------------
// Group 7: Mocked CDP — verifyInjection success path (2 tests)
// ---------------------------------------------------------------------------

describe('verifyInjection — mocked success path', () => {
  afterEach(resetMocks);

  it('returns ok:true with injection markers when agent is live', async () => {
    resetMocks();
    setupOnlineAgent('zcode', KNOWN_PORT_HINTS.zcode);

    const fakeResult = JSON.stringify({
      injected: true,
      themeId: 'catppuccin-mocha',
      themeVersion: '1.2.0',
      hasThemeSheet: true,
      hasHostClass: true,
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeResult);

    const result = await verifyInjection('zcode');

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('zcode');
    expect(result.injected).toBe(true);
    expect(result.themeId).toBe('catppuccin-mocha');
    expect(result.themeVersion).toBe('1.2.0');
    expect(result.hasThemeSheet).toBe(true);
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('reports not-injected when no markers are found', async () => {
    resetMocks();
    setupOnlineAgent('codex', KNOWN_PORT_HINTS.codex);

    const fakeResult = JSON.stringify({
      injected: false,
      themeId: null,
      themeVersion: null,
      hasThemeSheet: false,
      hasHostClass: false,
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeResult);

    const result = await verifyInjection('codex');

    expect(result.ok).toBe(true);
    expect(result.injected).toBe(false);
    expect(result.themeId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 8: Mocked CDP — getAppliedTheme success path (2 tests)
// ---------------------------------------------------------------------------

describe('getAppliedTheme — mocked success path', () => {
  afterEach(resetMocks);

  it('returns ok:true with bridge-sourced theme data when agent has __AGENTSKIN__', async () => {
    resetMocks();
    setupOnlineAgent('doubao', KNOWN_PORT_HINTS.doubao);

    const fakeResult = JSON.stringify({
      themeId: 'nord',
      themeVersion: '2.0.0',
      appliedAt: '2026-01-15T10:30:00Z',
      source: 'bridge',
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeResult);

    const result = await getAppliedTheme('doubao');

    expect(result.ok).toBe(true);
    expect(result.agentId).toBe('doubao');
    expect(result.themeId).toBe('nord');
    expect(result.themeVersion).toBe('2.0.0');
    expect(result.source).toBe('bridge');
    expect(result.appliedAt).toBe('2026-01-15T10:30:00Z');
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('returns source:none when no theme is applied', async () => {
    resetMocks();
    setupOnlineAgent('codex', KNOWN_PORT_HINTS.codex);

    const fakeResult = JSON.stringify({
      themeId: null,
      themeVersion: null,
      appliedAt: null,
      source: 'none',
    });
    mockSession.evaluate.mockResolvedValueOnce(fakeResult);

    const result = await getAppliedTheme('codex');

    expect(result.ok).toBe(true);
    expect(result.themeId).toBeNull();
    expect(result.source).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Group 9: Mocked CDP — listDiscoveryTargets (2 tests)
// ---------------------------------------------------------------------------

describe('listDiscoveryTargets — mocked discovery', () => {
  afterEach(resetMocks);

  it('returns targets for adapters with live CDP endpoints', async () => {
    resetMocks();
    const codexAdapter = fakeAdapter('codex');
    const workbuddyAdapter = fakeAdapter('workbuddy');
    mockListAdapters.mockReturnValue([codexAdapter, workbuddyAdapter]);

    // Both agents respond on their hint ports.
    mockFindTargets.mockResolvedValue([{ title: 'Codex Window', url: 'http://localhost:58360/' }]);
    mockListCdpTargets.mockResolvedValue([
      { title: 'Codex Window', url: 'http://localhost:58360/', type: 'page' },
    ]);
    mockResolveDebugPorts.mockResolvedValue([]);
    mockFindRunningPids.mockResolvedValue([]);

    const result = await listDiscoveryTargets();

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    for (const target of result) {
      expect(target).toHaveProperty('agentId');
      expect(target).toHaveProperty('displayName');
      expect(target).toHaveProperty('port');
    }
  });

  it('returns empty array when listAdapters yields no adapters', async () => {
    resetMocks();
    mockListAdapters.mockReturnValue([]);

    const result = await listDiscoveryTargets();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Group 10: resolveLivePort behavior (3 tests)
// ---------------------------------------------------------------------------

describe('resolveLivePort — discovery strategy', () => {
  afterEach(resetMocks);

  it('returns the hint port when findTargets succeeds immediately', async () => {
    resetMocks();
    const adapter = fakeAdapter('codex');
    mockGetAdapter.mockReturnValue(adapter);
    mockFindTargets.mockResolvedValue([{ type: 'page' }]);
    mockResolveDebugPorts.mockResolvedValue([]);
    mockFindRunningPids.mockResolvedValue([]);

    const port = await resolveLivePort('codex');
    expect(port).toBe(KNOWN_PORT_HINTS.codex);
  });

  it('returns null when no discovery layer finds a live port', async () => {
    resetMocks();
    const adapter = fakeAdapter('codex');
    mockGetAdapter.mockReturnValue(adapter);
    mockFindTargets.mockRejectedValue(new Error('ECONNREFUSED'));
    mockResolveDebugPorts.mockRejectedValue(new Error('ENOENT'));
    mockFindRunningPids.mockRejectedValue(new Error('no pids'));

    const port = await resolveLivePort('codex');
    expect(port).toBeNull();
  });

  it('does not throw even when all discovery layers fail', async () => {
    resetMocks();
    mockGetAdapter.mockReturnValue(fakeAdapter('unknown-agent'));
    mockFindTargets.mockRejectedValue(new Error('fail'));
    mockResolveDebugPorts.mockRejectedValue(new Error('fail'));
    mockFindRunningPids.mockRejectedValue(new Error('fail'));

    const result = resolveLivePort('unknown-agent');
    await expect(result).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 11: Error resilience — CdpSession exceptions (2 tests)
// ---------------------------------------------------------------------------

describe('error resilience — session exceptions', () => {
  afterEach(resetMocks);

  it('takeScreenshot returns ok:false when CdpSession.open throws', async () => {
    resetMocks();
    setupOnlineAgent('codex', KNOWN_PORT_HINTS.codex);
    // Make open() reject to simulate connection failure during session init.
    MockCdpSession.prototype.open = vi.fn().mockRejectedValue(new Error('WebSocket timeout'));

    const result = await takeScreenshot('codex');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Screenshot failed/);

    // Restore the prototype method.
    MockCdpSession.prototype.open = vi.fn().mockResolvedValue(mockSession);
  });

  it('getDomSnapshot returns ok:false when session.evaluate throws', async () => {
    resetMocks();
    setupOnlineAgent('workbuddy', KNOWN_PORT_HINTS.workbuddy);
    mockSession.evaluate.mockRejectedValue(new Error('Script execution failed'));

    const result = await getDomSnapshot('workbuddy');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/DOM snapshot failed/);
    // close() is called in the finally block of the try in the source.
    expect(mockSession.close).toHaveBeenCalled();
  });
});
