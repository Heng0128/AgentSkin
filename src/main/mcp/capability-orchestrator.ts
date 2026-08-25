// SPDX-License-Identifier: MPL-2.0

/**
 * # Capability Orchestrator
 *
 * Unified dispatch layer for MCP tools. The orchestrator looks up tools from
 * the {@link module:tool-registry}, invokes their handlers with a timeout
 * guard, and normalises all errors into `isError: true` results (no exceptions
 * escape to the transport layer).
 *
 * ## Lifecycle
 *
 * 1. The MCP server (transport layer) calls `executeTool(name, args, ctx)`.
 * 2. The orchestrator resolves the tool from the registry.
 * 3. If found, it invokes the handler with a 30-second timeout.
 * 4. All exceptions are caught and converted to `McpToolResult` with
 *    `isError: true`.
 */

import { getTool, listTools } from './tool-registry';
import type { McpContext, McpToolResult } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOOL_TIMEOUT_MS = 30_000; // 30 seconds

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute a registered MCP tool by name.
 *
 * Looks up the tool in the registry, calls its handler with the given args
 * and context, and returns the result. All failures (unknown tool, handler
 * exception, timeout) are converted to `McpToolResult` with `isError: true` —
 * no exceptions escape this function.
 *
 * @param toolName - The registered tool name to execute.
 * @param args - Parsed arguments (will be passed to the handler).
 * @param ctx - MCP context carrying service references.
 * @returns A {@link McpToolResult} — either from the handler or an error result.
 */
export async function executeTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: McpContext,
): Promise<McpToolResult> {
  const tool = getTool(toolName);
  if (!tool) {
    return {
      content: [{ type: 'text', text: `Unknown tool: "${toolName}"` }],
      isError: true,
    };
  }

  try {
    const result = await Promise.race([tool.handler(args as unknown, ctx), timeoutResult()]);
    return result;
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool "${toolName}" execution failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Get the names of all registered tools.
 *
 * @returns Array of tool name strings.
 */
export function getRegisteredTools(): string[] {
  return listTools();
}

/**
 * Get MCP-compatible definitions (name + description + inputSchema) for all
 * registered tools. Used by the MCP server during initialization to advertise
 * available tools to clients.
 *
 * @returns Array of tool definition objects suitable for MCP `tools/list`.
 */
export function getAllRegisteredToolDefinitions(): Array<{
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: any;
}> {
  const tools = listTools();
  // Dynamically import tool modules to trigger registration side-effects,
  // then collect definitions from the registry.
  // Note: In practice, tool modules are imported before this function is called
  // (via the tool loading entrypoint). This function just reads the registry.
  return tools.map((name) => {
    const def = getTool(name)!;
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema,
    };
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Create a rejected promise that fires when the tool execution times out.
 * The error message is a `never` return via `Promise.race` rejection.
 */
function timeoutResult(): Promise<never> {
  return new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`Tool execution timed out after ${TOOL_TIMEOUT_MS}ms`));
    }, TOOL_TIMEOUT_MS);
  });
}
