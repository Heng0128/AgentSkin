// SPDX-License-Identifier: MPL-2.0

/**
 * CDP Tools — Unit Tests
 *
 * Tests for `registerCdpTools` covering:
 *   - All 5 tools are registered
 *   - Schema validation rejects invalid input
 *   - Port resolution from ctx.core.status()
 *   - CDP session connect/disconnect handling
 *   - Error isolation per tool
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state (shared across tests, reset in beforeEach)
// ---------------------------------------------------------------------------

const mockConnectCdp = vi.fn();
const mockFindDomTargets = vi.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../cdp/cdp-client', () => ({
  connectCdp: (...args: unknown[]) => mockConnectCdp(...args),
}));

vi.mock('../../cdp/cdp-targets', () => ({
  findDomTargets: (...args: unknown[]) => mockFindDomTargets(...args),
}));

vi.mock('../tool-registry', async () => {
  const tools = new Map<string, { name: string; description: string; handler: unknown }>();
  return {
    registerTool: vi.fn((def: { name: string; description: string; handler: unknown }) => {
      tools.set(def.name, def);
    }),
    getTool: vi.fn((name: string) => tools.get(name)),
    listTools: vi.fn(() => [...tools.keys()]),
  };
});

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

import type { AgentId } from '../../../shared/types';

function makeFakeSession(
  overrides: {
    evalResult?: unknown;
    screenshotData?: string;
    querySelectorResult?: { nodeId: number };
    sendError?: Error | null;
  } = {},
) {
  const sent: Array<{ method: string; params?: unknown }> = [];
  return {
    sent,
    send: vi.fn(async (method: string, params?: unknown) => {
      sent.push({ method, params });
      if (overrides.sendError) throw overrides.sendError;
      if (method === 'Runtime.evaluate') {
        return { result: { value: overrides.evalResult ?? null } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: overrides.screenshotData ?? 'iVBORKGgoAAAANSUhEUg==' };
      }
      if (method === 'DOM.querySelector') {
        return overrides.querySelectorResult ?? { nodeId: 42 };
      }
      // Overlay.enable, Overlay.disable, Overlay.highlightNode, Overlay.hideHighlight, Page.enable
      return {};
    }),
    close: vi.fn(),
  };
}

const _MOCK_AGENT_ID: AgentId = 'traework';
const _MOCK_PORT = 9222;

const MOCK_CTX = {
  core: {
    status: vi.fn().mockResolvedValue({
      platform: 'win32' as const,
      apps: [
        {
          appId: 'traework' as AgentId,
          displayName: 'TraeWork',
          installed: true,
          running: true,
          debugReady: true,
          port: 9222,
          activeThemeId: 'theme-1',
          activeSchemeId: null,
          version: '1.0.0',
        },
      ],
    }),
  },
} as unknown as import('../types').McpContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registerCdpTools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('registers exactly 5 tools', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { listTools } = await import('../tool-registry');
    registerCdpTools();
    expect(listTools()).toHaveLength(5);
  });

  it('registers tools with the expected names', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { listTools } = await import('../tool-registry');
    registerCdpTools();
    const names = listTools();
    expect(names).toContain('get-dom-snapshot');
    expect(names).toContain('take-screenshot');
    expect(names).toContain('verify-injection');
    expect(names).toContain('get-computed-style');
    expect(names).toContain('highlight-element');
  });
});

describe('get-dom-snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('returns error when agent has no debug port', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    // Override status to return no port
    const ctx = {
      core: {
        status: vi.fn().mockResolvedValue({
          platform: 'win32' as const,
          apps: [
            {
              appId: 'traework' as AgentId,
              displayName: 'TraeWork',
              installed: true,
              running: false,
              debugReady: false,
              port: null,
              activeThemeId: null,
              activeSchemeId: null,
              version: null,
            },
          ],
        }),
      },
    } as unknown as import('../types').McpContext;

    const tool = getTool('get-dom-snapshot');
    expect(tool).toBeDefined();
    const result = await tool!.handler({ agent_id: 'traework' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no CDP debug port');
  });

  it('connects to CDP and evaluates walk expression', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({
      evalResult: JSON.stringify({
        elements: [
          { selector: '#app', tagName: 'div', classNames: ['app-root'], depth: 0, isVisible: true },
        ],
        totalWalked: 1,
      }),
    });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-dom-snapshot');
    const result = await tool!.handler({ agent_id: 'traework', max_nodes: 100 }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('captured');
    expect(data.elements).toHaveLength(1);
    expect(mockConnectCdp).toHaveBeenCalledWith(
      'ws://127.0.0.1:9222/devtools/page/abc',
      5000,
      10000,
    );
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it('returns error when no DOM target found', async () => {
    mockFindDomTargets.mockResolvedValue([]);
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-dom-snapshot');
    const result = await tool!.handler({ agent_id: 'traework' }, MOCK_CTX);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('No DOM-bearing CDP target');
  });

  it('rejects empty agent_id via zod validation error', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-dom-snapshot');
    // Zod validation errors propagate as exceptions — the capability-orchestrator
    // catches them and converts to isError: true.
    await expect(tool!.handler({ agent_id: '' }, MOCK_CTX)).rejects.toThrow();
  });
});

describe('take-screenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('captures screenshot and returns base64 data URL', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({ screenshotData: 'AAAA_BASE64_PNG_DATA' });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('take-screenshot');
    const result = await tool!.handler({ agent_id: 'traework' }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.format).toBe('png');
    expect(data.data_url).toBe('data:image/png;base64,AAAA_BASE64_PNG_DATA');
    // Verify Page.enable was called before captureScreenshot
    const methods = fakeSession.sent.map((s) => s.method);
    expect(methods).toContain('Page.enable');
    expect(methods).toContain('Page.captureScreenshot');
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it('returns error when agent has no debug port', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const ctx = {
      core: {
        status: vi.fn().mockResolvedValue({
          platform: 'win32' as const,
          apps: [
            {
              appId: 'traework' as AgentId,
              displayName: 'T',
              installed: false,
              running: false,
              debugReady: false,
              port: null,
              activeThemeId: null,
              activeSchemeId: null,
              version: null,
            },
          ],
        }),
      },
    } as unknown as import('../types').McpContext;

    const tool = getTool('take-screenshot');
    const result = await tool!.handler({ agent_id: 'traework' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no CDP debug port');
  });
});

describe('verify-injection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('detects injected CSS variables', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({
      evalResult: JSON.stringify({
        injected: true,
        variables_found: { '--agentskin-bg': '#1e1e1e', '--agentskin-text': '#d4d4d4' },
        variables_missing: ['--agentskin-focus-ring'],
        host_marker: true,
        html_classes: 'agentskin-host-traework',
      }),
    });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('verify-injection');
    const result = await tool!.handler({ agent_id: 'traework' }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.injected).toBe(true);
    expect(data.status).toBe('injected');
    expect(data.variables_found['--agentskin-bg']).toBe('#1e1e1e');
    expect(data.host_marker).toBe(true);
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it('reports not-injected when no variables found', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({
      evalResult: JSON.stringify({
        injected: false,
        variables_found: {},
        variables_missing: ['--agentskin-bg', '--agentskin-text'],
        host_marker: false,
        html_classes: '',
      }),
    });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('verify-injection');
    const result = await tool!.handler({ agent_id: 'traework' }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.injected).toBe(false);
    expect(data.status).toBe('not-injected');
  });
});

describe('get-computed-style', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('returns computed styles for a valid selector', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({
      evalResult: JSON.stringify({
        selector: '#chat-input',
        tagName: 'textarea',
        style: {
          'background-color': 'rgb(30, 30, 30)',
          color: 'rgb(212, 212, 212)',
          display: 'block',
        },
        boundingBox: { x: 100, y: 500, width: 800, height: 40 },
      }),
    });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-computed-style');
    const result = await tool!.handler({ agent_id: 'traework', selector: '#chat-input' }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.selector).toBe('#chat-input');
    expect(data.tagName).toBe('textarea');
    expect(data.style['background-color']).toBe('rgb(30, 30, 30)');
    expect(data.boundingBox.width).toBe(800);
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it('returns error when selector matches no element', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({
      evalResult: JSON.stringify({ error: 'Selector matched no element: #nonexistent' }),
    });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-computed-style');
    const result = await tool!.handler(
      { agent_id: 'traework', selector: '#nonexistent' },
      MOCK_CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Selector matched no element');
  });

  it('rejects empty selector via zod validation error', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('get-computed-style');
    // Zod validation errors propagate as exceptions — the capability-orchestrator
    // catches them and converts to isError: true.
    await expect(tool!.handler({ agent_id: 'traework', selector: '' }, MOCK_CTX)).rejects.toThrow();
  });
});

describe('highlight-element', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConnectCdp.mockReset();
    mockFindDomTargets.mockReset();
  });

  it('highlights element via Overlay domain', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({ querySelectorResult: { nodeId: 7 } });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('highlight-element');
    const result = await tool!.handler({ agent_id: 'traework', selector: '.chat-input' }, MOCK_CTX);

    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0].text);
    expect(data.status).toBe('highlighted');
    expect(data.node_id).toBe(7);
    // Verify Overlay domain was used
    const methods = fakeSession.sent.map((s) => s.method);
    expect(methods).toContain('DOM.querySelector');
    expect(methods).toContain('Overlay.highlightNode');
    expect(methods).toContain('Overlay.hideHighlight');
    expect(methods).toContain('Overlay.disable');
    expect(fakeSession.close).toHaveBeenCalled();
  });

  it('returns error when selector matches no element', async () => {
    mockFindDomTargets.mockResolvedValue([
      {
        type: 'page',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/abc',
        url: 'https://app.example.com',
      },
    ]);
    const fakeSession = makeFakeSession({ querySelectorResult: { nodeId: 0 } });
    mockConnectCdp.mockResolvedValue(fakeSession);

    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const tool = getTool('highlight-element');
    const result = await tool!.handler(
      { agent_id: 'traework', selector: '.nonexistent' },
      MOCK_CTX,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Selector matched no element');
  });

  it('returns error when agent has no debug port', async () => {
    const { registerCdpTools } = await import('./cdp-tools');
    const { getTool } = await import('../tool-registry');
    registerCdpTools();

    const ctx = {
      core: {
        status: vi.fn().mockResolvedValue({
          platform: 'win32' as const,
          apps: [
            {
              appId: 'traework' as AgentId,
              displayName: 'T',
              installed: false,
              running: false,
              debugReady: false,
              port: null,
              activeThemeId: null,
              activeSchemeId: null,
              version: null,
            },
          ],
        }),
      },
    } as unknown as import('../types').McpContext;

    const tool = getTool('highlight-element');
    const result = await tool!.handler({ agent_id: 'traework', selector: '.foo' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no CDP debug port');
  });
});
