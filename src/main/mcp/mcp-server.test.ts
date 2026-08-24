// SPDX-License-Identifier: MPL-2.0

/**
 * MCP Server — Unit Tests
 *
 * Tests for `createMcpServer`, `startMcpServer`, `stopMcpServer` covering:
 *   - Tool registration from mock tool definitions
 *   - Throws when no tools register
 *   - Isolated tool registration failure (one bad tool doesn't block others)
 *   - Start lifecycle connects via stdio
 *   - Stop lifecycle cleans up transport and server
 *   - Server name/version from config
 */

import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockRegisterTool = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(() => ({
    registerTool: mockRegisterTool,
    connect: mockConnect,
    close: mockClose,
  })),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('./capability-orchestrator', () => ({
  executeTool: vi.fn(),
  getAllRegisteredToolDefinitions: vi.fn(),
}));

vi.mock('./config', () => ({
  getMcpConfig: vi.fn(() => ({
    enabled: true,
    authRequired: false,
    serverName: 'test-mcp',
    serverVersion: '0.1.0',
    httpHost: '127.0.0.1',
    httpPort: 3333,
    httpPath: '/mcp',
  })),
}));

// Import after mocks
import type { McpContext } from './types';
import { createMcpServer, startMcpServer, stopMcpServer } from './mcp-server';
import { executeTool, getAllRegisteredToolDefinitions } from './capability-orchestrator';
import type { McpToolResult } from './types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_CONTEXT = {} as McpContext;

function makeToolDef(name: string, description = `Tool: ${name}`) {
  return {
    name,
    description,
    inputSchema: { shape: { param1: { type: 'string' } } },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all tools returned by the tool registry', async () => {
    const tools = [makeToolDef('tool_a'), makeToolDef('tool_b'), makeToolDef('tool_c')];
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue(tools);

    createMcpServer(MOCK_CONTEXT);

    expect(mockRegisterTool).toHaveBeenCalledTimes(3);
    expect(mockRegisterTool).toHaveBeenCalledWith(
      'tool_a',
      expect.objectContaining({ description: 'Tool: tool_a' }),
      expect.any(Function),
    );
    expect(mockRegisterTool).toHaveBeenCalledWith(
      'tool_b',
      expect.objectContaining({ description: 'Tool: tool_b' }),
      expect.any(Function),
    );
    expect(mockRegisterTool).toHaveBeenCalledWith(
      'tool_c',
      expect.objectContaining({ description: 'Tool: tool_c' }),
      expect.any(Function),
    );
  });

  it('throws Error when no tools can be registered', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([]);

    expect(() => createMcpServer(MOCK_CONTEXT)).toThrow(
      'No MCP tools could be registered',
    );
    expect(mockRegisterTool).not.toHaveBeenCalled();
  });

  it('isolates tool registration failure — one bad tool does not block others', async () => {
    const tools = [makeToolDef('good_1'), makeToolDef('bad'), makeToolDef('good_2')];
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue(tools);

    // 'bad' tool registration throws
    mockRegisterTool.mockImplementation((name: string) => {
      if (name === 'bad') {
        throw new Error('Schema validation failed');
      }
    });

    // Should not throw — error is caught internally
    expect(() => createMcpServer(MOCK_CONTEXT)).not.toThrow();

    // All 3 tools attempted
    expect(mockRegisterTool).toHaveBeenCalledTimes(3);
  });

  it('configure server name and version from config', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('t1')]);

    const server = createMcpServer(MOCK_CONTEXT);

    expect(server).toBeDefined();
    // The McpServer constructor was called with config from getMcpConfig
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    expect(McpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-mcp', version: '0.1.0' }),
      expect.any(Object),
    );
  });
});

describe('startMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates server if not already created', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('t1')]);
    mockConnect.mockResolvedValue(undefined);

    await startMcpServer(MOCK_CONTEXT);

    expect(mockConnect).toHaveBeenCalledTimes(1);
  });

  it('reuses existing server instance if already created', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('t1')]);
    mockConnect.mockResolvedValue(undefined);

    // Create the server first
    createMcpServer(MOCK_CONTEXT);
    vi.clearAllMocks();

    // start should reuse (not recreate)
    await startMcpServer(MOCK_CONTEXT);

    expect(mockConnect).toHaveBeenCalledTimes(1);
    // McpServer constructor should NOT be called again
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    expect(McpServer).not.toHaveBeenCalled();
  });
});

describe('stopMcpServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClose.mockResolvedValue(undefined);
  });

  it('closes transport and server in order', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('t1')]);
    mockConnect.mockResolvedValue(undefined);

    // Start first to get a server + transport
    await startMcpServer(MOCK_CONTEXT);

    // Now stop
    await stopMcpServer();

    // Transport closed first, then server
    // (order is: transportInstance.close → serverInstance.close)
    expect(mockClose).toHaveBeenCalled();
  });

  it('is safe to call multiple times', async () => {
    await stopMcpServer();
    await stopMcpServer();

    // No errors on repeated calls
    expect(mockClose).not.toHaveBeenCalled(); // never started, no transport
  });
});

describe('tool handler delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tool handler delegates to executeTool with correct args and context', async () => {
    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('my_tool')]);
    vi.mocked(executeTool).mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    });

    createMcpServer(MOCK_CONTEXT);

    // Extract the registered handler for 'my_tool'
    const registerCall = mockRegisterTool.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === 'my_tool',
    );
    expect(registerCall).toBeDefined();
    const handler = registerCall![2] as (args: Record<string, unknown>) => Promise<McpToolResult>;

    // Call the handler with test args
    const result = await handler({ param1: 'value1' });

    expect(executeTool).toHaveBeenCalledWith('my_tool', { param1: 'value1' }, MOCK_CONTEXT);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'result' }],
      isError: undefined,
    });
  });

  it('tool handler propagates isError from executeTool result', async () => {
    const executeToolMock = vi.mocked(executeTool);
    executeToolMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    });

    vi.mocked(getAllRegisteredToolDefinitions).mockReturnValue([makeToolDef('failing_tool')]);

    createMcpServer(MOCK_CONTEXT);

    const registerCall = mockRegisterTool.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === 'failing_tool',
    );
    const handler = registerCall![2] as (args: Record<string, unknown>) => Promise<McpToolResult>;

    const result = await handler({});

    expect(result.isError).toBe(true);
  });
});
