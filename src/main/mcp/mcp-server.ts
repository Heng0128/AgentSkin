// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP Server
 *
 * AgentSkin MCP Server entry point. Wraps the `@modelcontextprotocol/sdk`
 * `McpServer` with:
 *
 *   - Stdio transport (stdout is reserved for JSON-RPC; all logs go to stderr)
 *   - Tool registration from the tool registry
 *   - Graceful start / stop lifecycle
 *
 * ## Boundary
 *
 * This module is the MCP transport layer. It depends on the capability
 * orchestrator for tool dispatch and on `McpContext` for service access.
 * It does NOT import Electron modules directly — the context is injected.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { ZodRawShape } from 'zod';
import { executeTool, getAllRegisteredToolDefinitions } from './capability-orchestrator';
import { getMcpConfig } from './config';
import type { McpContext } from './types';

// ---------------------------------------------------------------------------
// RC2-S2-B: Type-safe schema shape extraction
// ---------------------------------------------------------------------------

/**
 * Safely extract the raw shape from a ZodObject for MCP SDK registration.
 * Validates the shape is a non-null object before casting, providing a
 * runtime guard against malformed tool definitions.
 */
function extractSchemaShape(shape: unknown): ZodRawShape {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
    throw new Error('Invalid tool inputSchema: expected ZodObject.shape to be a non-null object');
  }
  return shape as ZodRawShape;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let SERVER_NAME = 'agentskin-mcp';
let SERVER_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let serverInstance: McpServer | null = null;
let transportInstance: StdioServerTransport | null = null;

/**
 * Create and configure the MCP Server instance.
 *
 * Registers all tools from the tool registry. The server is not connected
 * to any transport until `startMcpServer()` is called.
 *
 * @param ctx - MCP context carrying service references for tool handlers.
 * @returns Configured McpServer instance (not yet connected).
 */
export function createMcpServer(ctx: McpContext): McpServer {
  const cfg = getMcpConfig();
  SERVER_NAME = cfg.serverName;
  SERVER_VERSION = cfg.serverVersion;

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: { listChanged: true },
      },
      instructions:
        'AgentSkin MCP Server — theme management for AI coding agents. Use tools to create, apply, and manage themes.',
    },
  );

  // Register all tools from the registry — isolated failure per tool.
  const toolDefs = getAllRegisteredToolDefinitions();
  let registeredCount = 0;

  for (const definition of toolDefs) {
    try {
      // RC2-S2-B: Use type-safe schema shape extraction with runtime guard
      const schemaShape = extractSchemaShape(definition.inputSchema.shape);
      server.registerTool(
        definition.name,
        {
          description: definition.description,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK inputSchema type is opaque
          inputSchema: schemaShape as any,
        },
        async (args: Record<string, unknown>) => {
          // args is already Record<string, unknown> per SDK signature — no cast needed
          const result = await executeTool(definition.name, args, ctx);
          return {
            content: result.content,
            isError: result.isError,
          };
        },
      );
      registeredCount++;
    } catch (err) {
      console.error(`agentskin-mcp: failed to register tool "${definition.name}": ${err}`);
    }
  }

  if (registeredCount === 0) {
    throw new Error('No MCP tools could be registered — refusing to start server');
  }

  serverInstance = server;
  return server;
}

/**
 * Start the MCP Server with stdio transport.
 *
 * Connects the server to stdin/stdout and begins listening for JSON-RPC
 * messages. All diagnostic output goes to stderr to avoid corrupting
 * the JSON-RPC stream on stdout.
 *
 * Outputs version info, registered tool count, and auth status at startup.
 *
 * @param ctx - MCP context carrying service references for tool handlers.
 */
export async function startMcpServer(ctx: McpContext): Promise<void> {
  if (!serverInstance) {
    createMcpServer(ctx);
  }

  const cfg = getMcpConfig();
  const toolCount = getAllRegisteredToolDefinitions().length;

  console.error(`agentskin-mcp: starting ${SERVER_NAME} v${SERVER_VERSION}`);
  console.error(`agentskin-mcp: ${toolCount} tools registered`);
  console.error(`agentskin-mcp: auth ${cfg.authRequired ? 'enabled' : 'disabled'}`);

  const transport = new StdioServerTransport();
  transportInstance = transport;

  await serverInstance!.connect(transport);

  console.error('agentskin-mcp: connected');
}

/**
 * Gracefully stop the MCP Server.
 *
 * Closes the transport and releases references. Safe to call multiple times.
 */
export async function stopMcpServer(): Promise<void> {
  console.error('agentskin-mcp: stopping...');

  if (transportInstance) {
    await transportInstance.close();
    transportInstance = null;
  }

  if (serverInstance) {
    await serverInstance.close();
    serverInstance = null;
  }

  console.error('agentskin-mcp: stopped');
}
