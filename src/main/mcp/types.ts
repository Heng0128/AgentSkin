// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP Types
 *
 * Core type definitions for the MCP tool layer. These types define the
 * contract between tool handlers, the tool registry, and the capability
 * orchestrator.
 */

import type { z } from 'zod';

// Re-export McpContext so consumers can import it from './types'
export type { McpContext } from './context';

import type { McpContext } from './context';

// ---------------------------------------------------------------------------
// Tool result types
// ---------------------------------------------------------------------------

/**
 * Standard MCP tool result. Follows the MCP protocol content block format.
 */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Tool handler and definition types
// ---------------------------------------------------------------------------

/**
 * Handler function signature for MCP tools.
 *
 * @param args - Parsed arguments (already validated by zod schema).
 * @param ctx - MCP context carrying read-only service references.
 * @returns A {@link McpToolResult} with content blocks and optional error flag.
 */
export type McpToolHandler = (args: unknown, ctx: McpContext) => Promise<McpToolResult>;

/**
 * Convenience alias for a zod object schema used as MCP tool input.
 */
export type McpInputSchema = z.ZodObject<z.ZodRawShape>;

/**
 * Complete definition of an MCP tool: name, description, input schema, and handler.
 */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: McpInputSchema;
  handler: McpToolHandler;
}

// ---------------------------------------------------------------------------
// Parameter interfaces (used by creation and theme tools)
// ---------------------------------------------------------------------------

/**
 * Parameters for creating a theme from an image.
 */
export interface CreateThemeParams {
  image_path: string;
  name: string;
  mode?: 'dark' | 'light' | 'auto';
  target_agents?: string[];
  auto_apply?: boolean;
}

/**
 * Parameters for applying a theme to an agent.
 */
export interface ApplyThemeParams {
  theme_id: string;
  agent_id: string;
}
