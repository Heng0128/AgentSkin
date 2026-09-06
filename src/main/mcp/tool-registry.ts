// SPDX-License-Identifier: MPL-2.0

/**
 * # Tool Registry
 *
 * Singleton registry for MCP tool definitions. Tools register themselves
 * at import time by calling {@link registerTool}. The registry is consumed
 * by the capability orchestrator to dispatch tool executions.
 *
 * ## Design notes
 *
 * - Module-import side-effect pattern: each tool module calls `registerTool()`
 *   at the top level. Importing the module is sufficient to register the tool.
 * - Duplicate names are rejected with a console.error (not thrown) to avoid
 *   crashing the server on misconfiguration.
 */

import type { McpToolDefinition } from './types';

// Re-export McpToolDefinition so consumers can import it from './tool-registry'
export type { McpToolDefinition } from './types';

// ---------------------------------------------------------------------------
// Internal storage
// ---------------------------------------------------------------------------

const tools = new Map<string, McpToolDefinition>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register a tool definition in the global registry.
 *
 * @param definition - The complete tool definition (name, schema, handler).
 *
 * @throws Error if a tool with the same name is already registered.
 */
export function registerTool(definition: McpToolDefinition): void {
  if (tools.has(definition.name)) {
    throw new Error(`Duplicate tool registration: "${definition.name}"`);
  }
  tools.set(definition.name, definition);
}

/**
 * Retrieve a tool definition by name.
 *
 * @param name - The tool name to look up.
 * @returns The tool definition, or `undefined` if not found.
 */
export function getTool(name: string): McpToolDefinition | undefined {
  return tools.get(name);
}

/**
 * List all registered tool names.
 *
 * @returns Array of registered tool name strings.
 */
export function listTools(): string[] {
  return [...tools.keys()];
}

/**
 * Get all registered tool definitions in MCP-compatible format.
 *
 * @returns Array of `{ name, description, inputSchema }` objects.
 */
export function getAllToolDefinitions(): Array<{
  name: string;
  description: string;
  inputSchema: McpToolDefinition['inputSchema'];
}> {
  return [...tools.values()].map((def) => ({
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
  }));
}
