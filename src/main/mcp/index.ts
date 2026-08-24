// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP Module
 *
 * Unified export entry point for the MCP bridge layer. Provides context
 * creation, authentication utilities, tool registry, orchestrator, and
 * server lifecycle for MCP integration.
 */

import { registerStatusTools } from './tools/status-tools';
import { registerThemeTools } from './tools/theme-tools';
import { registerWallpaperTools } from './tools/wallpaper-tools';
import { registerCreationTools } from './tools/creation-tools';

export { createMcpContext } from './context';
export type {
  McpContext,
  McpThemeCatalog,
  McpAgentCatalog,
  McpThemeLibrary,
  McpSettings,
  McpAgentEngine,
} from './context';

export { registerApiKey, validateApiKey, generateApiKey } from './auth';

export type {
  McpToolResult,
  McpToolHandler,
  McpToolDefinition,
  McpInputSchema,
  CreateThemeParams,
  ApplyThemeParams,
} from './types';

export { registerTool, getTool, listTools, getAllToolDefinitions } from './tool-registry';

export {
  executeTool,
  getRegisteredTools,
  getAllRegisteredToolDefinitions,
} from './capability-orchestrator';

export {
  createMcpServer,
  startMcpServer,
  stopMcpServer,
} from './mcp-server';

export { syncStatusToGui } from './status-sync';

export { startMcpHttpServer, stopMcpHttpServer, getMcpHttpPort, isMcpHttpRunning } from './http-server';

export { getMcpConfig } from './config';
export type { McpConfig } from './config';

/**
 * Register all MCP tools in the global tool registry.
 *
 * This is the single entrypoint that triggers tool registration across all
 * tool modules. Call this once during MCP initialization before starting
 * the server — without it, `createMcpServer` will register zero tools.
 */
export function registerAllTools(): void {
  registerStatusTools();
  registerThemeTools();
  registerWallpaperTools();
  registerCreationTools();
}
