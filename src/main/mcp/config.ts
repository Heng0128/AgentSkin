// SPDX-License-Identifier: MPL-2.0

/**
 * MCP Configuration
 */

export interface McpConfig {
  /** Whether MCP Server is enabled */
  enabled: boolean;
  /** Whether API Key auth is required */
  authRequired: boolean;
  /** Server name reported to MCP clients */
  serverName: string;
  /** Server version */
  serverVersion: string;
  /** HTTP server host (always localhost for security) */
  httpHost: string;
  /** HTTP server port (default 3333) */
  httpPort: number;
  /** HTTP endpoint path */
  httpPath: string;
}

export function getMcpConfig(): McpConfig {
  return {
    enabled: process.env.AGENTSKIN_DISABLE_MCP !== '1',
    authRequired: process.env.AGENTSKIN_MCP_AUTH === '1',
    serverName: 'agentskin-mcp',
    serverVersion: '1.0.0',
    httpHost: '127.0.0.1',
    httpPort: parseInt(process.env.AGENTSKIN_MCP_PORT || '3333', 10),
    httpPath: '/mcp',
  };
}
