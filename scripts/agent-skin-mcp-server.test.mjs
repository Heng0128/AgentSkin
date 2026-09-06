// SPDX-License-Identifier: MPL-2.0
//
// Unit tests for agent-skin-mcp-server.mjs — MCP protocol and tool registration.
//
// Mocks the 5 CDP debug functions from lib/mcp-debug-tools.mjs to test the
// server's JSON-RPC message handling without requiring live CDP connections.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the 5 CDP debug functions from lib/mcp-debug-tools.mjs.
// vi.mock is hoisted by vitest, so we define mocks before the dynamic import.
// ---------------------------------------------------------------------------

const mockTakeScreenshot = vi.fn();
const mockGetDomSnapshot = vi.fn();
const mockVerifyInjection = vi.fn();
const mockListDiscoveryTargets = vi.fn();
const mockGetAppliedTheme = vi.fn();

vi.mock('./lib/mcp-debug-tools.mjs', () => ({
  takeScreenshot: mockTakeScreenshot,
  getDomSnapshot: mockGetDomSnapshot,
  verifyInjection: mockVerifyInjection,
  listDiscoveryTargets: mockListDiscoveryTargets,
  getAppliedTheme: mockGetAppliedTheme,
}));

// Import after mock declaration (vitest hoists vi.mock above the import).
const { handleRequest, TOOLS } = await import('./agent-skin-mcp-server.mjs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Capture JSON-RPC responses written to stdout. */
function createStdoutCapture() {
  const lines = [];
  const original = process.stdout.write;
  process.stdout.write = (chunk) => {
    lines.push(chunk.toString().trim());
    return true;
  };
  return {
    lines,
    /** Parse the last written line as a JSON-RPC response. */
    lastResponse() {
      return JSON.parse(lines.at(-1));
    },
    restore() {
      process.stdout.write = original;
    },
  };
}

/** Reset all mock functions. */
function resetMocks() {
  mockTakeScreenshot.mockReset();
  mockGetDomSnapshot.mockReset();
  mockVerifyInjection.mockReset();
  mockListDiscoveryTargets.mockReset();
  mockGetAppliedTheme.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('agent-skin-mcp-server', () => {
  let capture;

  beforeEach(() => {
    capture = createStdoutCapture();
    resetMocks();
  });

  afterEach(() => {
    capture.restore();
  });

  // ------------------------------------------------------------------
  // initialize protocol
  // ------------------------------------------------------------------

  describe('initialize protocol', () => {
    it('returns protocol version, server info, and capabilities', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {},
      });

      const response = capture.lastResponse();
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe('2024-11-05');
      expect(response.result.serverInfo).toEqual({
        name: 'agent-skin-mcp',
        version: '0.2.0',
      });
      expect(response.result.capabilities).toEqual({ tools: {} });
    });
  });

  // ------------------------------------------------------------------
  // tools/list
  // ------------------------------------------------------------------

  describe('tools/list', () => {
    it('returns exactly 7 tools', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      });

      const response = capture.lastResponse();
      expect(response.result.tools).toHaveLength(7);
    });

    it('includes all expected tool names', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      });

      const response = capture.lastResponse();
      const names = response.result.tools.map((t) => t.name);

      expect(names).toContain('list-targets');
      expect(names).toContain('get-server-status');
      expect(names).toContain('take-screenshot');
      expect(names).toContain('get-dom-snapshot');
      expect(names).toContain('verify-injection');
      expect(names).toContain('list-discovery-targets');
      expect(names).toContain('get-applied-theme');
    });

    it('each tool has name, description, and inputSchema', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list',
      });

      const response = capture.lastResponse();
      for (const tool of response.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.inputSchema.type).toBe('object');
      }
    });
  });

  // ------------------------------------------------------------------
  // list-targets tool call
  // ------------------------------------------------------------------

  describe('list-targets tool call', () => {
    it('returns adapter targets as JSON text content', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list-targets' },
      });

      const response = capture.lastResponse();
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe('text');

      const data = JSON.parse(response.result.content[0].text);
      expect(data).toHaveProperty('targets');
      expect(Array.isArray(data.targets)).toBe(true);
      expect(data.targets.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------------
  // get-server-status tool call
  // ------------------------------------------------------------------

  describe('get-server-status tool call', () => {
    it('returns server status with uptime and pid', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get-server-status' },
      });

      const response = capture.lastResponse();
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe('text');

      const data = JSON.parse(response.result.content[0].text);
      expect(data).toHaveProperty('server');
      expect(data).toHaveProperty('pid');
      expect(data).toHaveProperty('cdpPorts');
      expect(data.server.name).toBe('agent-skin-mcp');
    });
  });

  // ------------------------------------------------------------------
  // take-screenshot tool call (mocked)
  // ------------------------------------------------------------------

  describe('take-screenshot tool call (mocked)', () => {
    it('returns text + image content on success', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        ok: true,
        agentId: 'codex',
        port: 58360,
        format: 'png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        title: 'Codex Window',
        url: 'http://localhost:58360/',
      });

      await handleRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: {
          name: 'take-screenshot',
          arguments: { agentId: 'codex' },
        },
      });

      const response = capture.lastResponse();
      expect(response.result.content).toHaveLength(2);

      // First element: metadata as text.
      expect(response.result.content[0].type).toBe('text');
      const metadata = JSON.parse(response.result.content[0].text);
      expect(metadata.ok).toBe(true);
      expect(metadata.agentId).toBe('codex');
      expect(metadata.port).toBe(58360);
      expect(metadata).not.toHaveProperty('data');

      // Second element: base64 image.
      expect(response.result.content[1].type).toBe('image');
      expect(response.result.content[1].mimeType).toBe('image/png');
      expect(response.result.content[1].data).toContain('iVBORw0KGgo');

      // Verify the mock was called with correct arguments.
      expect(mockTakeScreenshot).toHaveBeenCalledWith('codex', { format: undefined });
    });

    it('returns single text content on failure', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        ok: false,
        agentId: 'codex',
        error: 'codex is not running — no live CDP port found.',
      });

      await handleRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: {
          name: 'take-screenshot',
          arguments: { agentId: 'codex' },
        },
      });

      const response = capture.lastResponse();
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe('text');

      const data = JSON.parse(response.result.content[0].text);
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/not running/);
    });

    it('passes format option through to the debug function', async () => {
      mockTakeScreenshot.mockResolvedValueOnce({
        ok: true,
        agentId: 'codex',
        port: 58360,
        format: 'jpeg',
        data: 'base64jpegdata==',
        title: 'Codex',
        url: 'http://localhost:58360/',
      });

      await handleRequest({
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {
          name: 'take-screenshot',
          arguments: { agentId: 'codex', format: 'jpeg' },
        },
      });

      expect(mockTakeScreenshot).toHaveBeenCalledWith('codex', { format: 'jpeg' });
    });
  });

  // ------------------------------------------------------------------
  // verify-injection tool call (mocked)
  // ------------------------------------------------------------------

  describe('verify-injection tool call (mocked)', () => {
    it('returns injection status as text content', async () => {
      mockVerifyInjection.mockResolvedValueOnce({
        ok: true,
        agentId: 'codex',
        port: 58360,
        injected: true,
        themeId: 'catppuccin-mocha',
        themeVersion: '1.2.0',
        hasThemeSheet: true,
      });

      await handleRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'verify-injection',
          arguments: { agentId: 'codex' },
        },
      });

      const response = capture.lastResponse();
      expect(response.result.content).toHaveLength(1);
      expect(response.result.content[0].type).toBe('text');

      const data = JSON.parse(response.result.content[0].text);
      expect(data.ok).toBe(true);
      expect(data.agentId).toBe('codex');
      expect(data.injected).toBe(true);
      expect(data.themeId).toBe('catppuccin-mocha');
      expect(data.themeVersion).toBe('1.2.0');
      expect(data.hasThemeSheet).toBe(true);

      expect(mockVerifyInjection).toHaveBeenCalledWith('codex');
    });

    it('returns ok:false when agent is not running', async () => {
      mockVerifyInjection.mockResolvedValueOnce({
        ok: false,
        agentId: 'codex',
        error: 'codex is not running — no live CDP port found.',
      });

      await handleRequest({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'verify-injection',
          arguments: { agentId: 'codex' },
        },
      });

      const response = capture.lastResponse();
      const data = JSON.parse(response.result.content[0].text);
      expect(data.ok).toBe(false);
      expect(data.error).toMatch(/not running/);
    });
  });

  // ------------------------------------------------------------------
  // Unknown tool name
  // ------------------------------------------------------------------

  describe('unknown tool name', () => {
    it('returns a JSON-RPC error for unregistered tool', async () => {
      await handleRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'nonexistent-tool' },
      });

      const response = capture.lastResponse();
      expect(response).toHaveProperty('error');
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('Unknown tool');
    });
  });

  // ------------------------------------------------------------------
  // TOOLS registry structure
  // ------------------------------------------------------------------

  describe('TOOLS registry', () => {
    it('has frozen 7 entries', () => {
      expect(Object.keys(TOOLS)).toHaveLength(7);
      expect(Object.isFrozen(TOOLS)).toBe(true);
    });

    it('take-screenshot has correct inputSchema with required agentId', () => {
      const tool = TOOLS['take-screenshot'];
      expect(tool.inputSchema.required).toContain('agentId');
      expect(tool.inputSchema.properties.format.enum).toEqual(['png', 'jpeg']);
    });

    it('get-dom-snapshot has optional maxDepth property', () => {
      const tool = TOOLS['get-dom-snapshot'];
      expect(tool.inputSchema.required).toContain('agentId');
      expect(tool.inputSchema.properties.maxDepth.type).toBe('number');
    });

    it('list-discovery-targets has empty properties', () => {
      const tool = TOOLS['list-discovery-targets'];
      expect(Object.keys(tool.inputSchema.properties)).toHaveLength(0);
    });
  });
});
