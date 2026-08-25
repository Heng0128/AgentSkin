// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP Module
 *
 * Unified export entry point for the MCP bridge layer. Provides context
 * creation, authentication utilities, tool registry, orchestrator, and
 * server lifecycle for MCP integration.
 */

import { registerCreationTools } from './tools/creation-tools';
import { registerStatusTools } from './tools/status-tools';
import { registerThemeTools } from './tools/theme-tools';
import { registerWallpaperTools } from './tools/wallpaper-tools';

export { generateApiKey, registerApiKey, validateApiKey } from './auth';
export {
  executeTool,
  getAllRegisteredToolDefinitions,
  getRegisteredTools,
} from './capability-orchestrator';
export type { McpConfig } from './config';
export { getMcpConfig } from './config';
export type {
  McpAgentCatalog,
  McpAgentEngine,
  McpContext,
  McpSettings,
  McpThemeCatalog,
  McpThemeLibrary,
} from './context';
export { createMcpContext } from './context';
export {
  getMcpHttpPort,
  isMcpHttpRunning,
  startMcpHttpServer,
  stopMcpHttpServer,
} from './http-server';
export {
  createMcpServer,
  startMcpServer,
  stopMcpServer,
} from './mcp-server';
export { syncStatusToGui } from './status-sync';
export { getAllToolDefinitions, getTool, listTools, registerTool } from './tool-registry';
export type {
  ApplyThemeParams,
  CreateThemeParams,
  McpInputSchema,
  McpToolDefinition,
  McpToolHandler,
  McpToolResult,
} from './types';

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
