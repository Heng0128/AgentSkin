// SPDX-License-Identifier: MPL-2.0

/**
 * MCP Server — Unit Tests
 *
 * Tests for `createMcpServer` covering:
 *   - Tool registration from mock tool definitions
 *   - Throws when no tools register
 *   - Isolated tool registration failure (one bad tool doesn't block others)
 *   - Tool handler delegation to executeTool
 *   - Error isolation per tool registration
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock state (shared across tests, reset in beforeEach)
// ---------------------------------------------------------------------------

const mockRegisterTool = vi.fn();
const mockGetAllRegisteredToolDefinitions = vi.fn();
const mockExecuteTool = vi.fn();

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: vi.fn().mockImplementation(function () {
    return {
      registerTool: mockRegisterTool,
      connect: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock('./capability-orchestrator', async () => {
  const actual = await vi.importActual<typeof import('./capability-orchestrator')>('./capability-orchestrator');
  return {
    ...actual,
    executeTool: mockExecuteTool,
    getAllRegisteredToolDefinitions: mockGetAllRegisteredToolDefinitions,
  };
});

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

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const MOCK_CONTEXT = {} as Parameters<typeof import('./mcp-server').createMcpServer>[0];

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
    mockRegisterTool.mockReset();
    mockGetAllRegisteredToolDefinitions.mockReset();
    mockExecuteTool.mockReset();
  });

  it('registers all tools returned by the tool registry', async () => {
    const tools = [makeToolDef('tool_a'), makeToolDef('tool_b'), makeToolDef('tool_c')];
    mockGetAllRegisteredToolDefinitions.mockReturnValue(tools);

    const { createMcpServer } = await import('./mcp-server');
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
    mockGetAllRegisteredToolDefinitions.mockReturnValue([]);

    const { createMcpServer } = await import('./mcp-server');
    expect(() => createMcpServer(MOCK_CONTEXT)).toThrow(
      'No MCP tools could be registered',
    );
    expect(mockRegisterTool).not.toHaveBeenCalled();
  });

  it('isolates tool registration failure — one bad tool does not block others', async () => {
    const tools = [makeToolDef('good_1'), makeToolDef('bad'), makeToolDef('good_2')];
    mockGetAllRegisteredToolDefinitions.mockReturnValue(tools);

    // 'bad' tool registration throws
    mockRegisterTool.mockImplementation((name: string) => {
      if (name === 'bad') {
        throw new Error('Schema validation failed');
      }
    });

    const { createMcpServer } = await import('./mcp-server');

    // Should not throw — error is caught internally
    expect(() => createMcpServer(MOCK_CONTEXT)).not.toThrow();

    // All 3 tools attempted
    expect(mockRegisterTool).toHaveBeenCalledTimes(3);
  });

  it('passes inputSchema.shape as the schema to registerTool', async () => {
    mockGetAllRegisteredToolDefinitions.mockReturnValue([
      { name: 'test_tool', description: 'A tool', inputSchema: { shape: { x: {} } } },
    ]);

    const { createMcpServer } = await import('./mcp-server');
    createMcpServer(MOCK_CONTEXT);

    // The handler's second argument (description + inputSchema) should pass
    // the shape property from the definition
    const callArgs = mockRegisterTool.mock.calls[0];
    expect(callArgs[1]).toEqual({
      description: 'A tool',
      inputSchema: { x: {} },
    });
  });
});

describe('tool handler delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterTool.mockReset();
    mockGetAllRegisteredToolDefinitions.mockReset();
    mockExecuteTool.mockReset();
  });

  it('tool handler delegates to executeTool with correct args and context', async () => {
    mockGetAllRegisteredToolDefinitions.mockReturnValue([makeToolDef('my_tool')]);
    mockExecuteTool.mockResolvedValue({
      content: [{ type: 'text', text: 'result' }],
    });

    const { createMcpServer } = await import('./mcp-server');
    createMcpServer(MOCK_CONTEXT);

    // Extract the registered handler for 'my_tool'
    const registerCall = mockRegisterTool.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === 'my_tool',
    );
    expect(registerCall).toBeDefined();
    const handler = registerCall![2] as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

    // Call the handler with test args
    const result = await handler({ param1: 'value1' });

    expect(mockExecuteTool).toHaveBeenCalledWith('my_tool', { param1: 'value1' }, MOCK_CONTEXT);
    expect(result).toEqual({
      content: [{ type: 'text', text: 'result' }],
      isError: undefined,
    });
  });

  it('tool handler propagates isError from executeTool result', async () => {
    mockGetAllRegisteredToolDefinitions.mockReturnValue([makeToolDef('failing_tool')]);
    mockExecuteTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true,
    });

    const { createMcpServer } = await import('./mcp-server');
    createMcpServer(MOCK_CONTEXT);

    const registerCall = mockRegisterTool.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === 'failing_tool',
    );
    const handler = registerCall![2] as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

    const result = await handler({});

    expect(result.isError).toBe(true);
  });

  it('handler returns structured error when executeTool returns isError', async () => {
    mockGetAllRegisteredToolDefinitions.mockReturnValue([makeToolDef('err_tool')]);
    mockExecuteTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Validation failed: missing theme_id' }],
      isError: true,
    });

    const { createMcpServer } = await import('./mcp-server');
    createMcpServer(MOCK_CONTEXT);

    const registerCall = mockRegisterTool.mock.calls.find(
      (call: unknown[]) => (call[0] as string) === 'err_tool',
    );
    const handler = registerCall![2] as (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }>;

    const result = await handler({ bad_param: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
  });
});

describe('config passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRegisterTool.mockReset();
    mockGetAllRegisteredToolDefinitions.mockReset();
    mockExecuteTool.mockReset();
  });

  it('passes server name and version from config to McpServer constructor', async () => {
    mockGetAllRegisteredToolDefinitions.mockReturnValue([makeToolDef('t1')]);

    const { createMcpServer } = await import('./mcp-server');
    createMcpServer(MOCK_CONTEXT);

    // Verify the McpServer was instantiated with config-derived params
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    expect(McpServer).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'test-mcp', version: '0.1.0' }),
      expect.objectContaining({
        capabilities: expect.any(Object),
        instructions: expect.any(String),
      }),
    );
  });
});
