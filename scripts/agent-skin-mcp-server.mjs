// SPDX-License-Identifier: MPL-2.0
// AgentSkin MCP Server — stdio transport exposing debug tools for AI assistants.
// Implements MCP JSON-RPC 2.0 protocol with 7 tools: list-targets, get-server-status,
// take-screenshot, get-dom-snapshot, verify-injection, list-discovery-targets, get-applied-theme.

import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ADAPTER_PRESETS, BUILTIN_ADAPTERS } from './lib/adapter-registry.mjs';
import { PortLeasePool } from './lib/cdp-port-lease.mjs';
import {
  getAppliedTheme,
  getDomSnapshot,
  listDiscoveryTargets,
  takeScreenshot,
  verifyInjection,
} from './lib/mcp-debug-tools.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const _ROOT = join(__dirname, '..');

/** MCP protocol version supported by this server. */
const MCP_PROTOCOL_VERSION = '2024-11-05';

/** Server identity advertised during initialization. */
const SERVER_INFO = {
  name: 'agent-skin-mcp',
  version: '0.2.0',
};

/** Default CDP port range for lease pool queries. */
const CDP_MIN_PORT = 9222;
const CDP_MAX_PORT = 9227;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} McpTool
 * @property {string} name - Tool identifier.
 * @property {string} description - Human-readable description.
 * @property {Object} inputSchema - JSON Schema for tool parameters.
 * @property {(args: Object) => Promise<{ content: Array<{ type: string, text: string }> }>} handler
 */

/**
 * list-targets — enumerate all injectable AI application targets.
 * Returns the six built-in adapters with their CDP port and platform info.
 * @param {Object} _args - No parameters required.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleListTargets(_args) {
  const targets = BUILTIN_ADAPTERS.map((id) => {
    const preset = ADAPTER_PRESETS[id];
    return {
      agentId: preset.agentId,
      name: preset.name,
      cdpPort: preset.cdpPort,
      platform: preset.platform,
      capabilities: preset.capabilities,
    };
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ targets }, null, 2),
      },
    ],
  };
}

/**
 * get-server-status — report MCP server health and CDP port lease state.
 * Queries the PortLeasePool to show which CDP ports are currently claimed.
 * @param {Object} _args - No parameters required.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleServerStatus(_args) {
  const lockRoot = join(tmpdir(), 'agentskin-mcp-lock');
  if (!existsSync(lockRoot)) {
    mkdirSync(lockRoot, { recursive: true });
  }

  const pool = new PortLeasePool({
    minPort: CDP_MIN_PORT,
    maxPort: CDP_MAX_PORT,
    lockRoot,
  });

  const leasedPorts = await pool.list();
  const allPorts = [];
  for (let port = CDP_MIN_PORT; port <= CDP_MAX_PORT; port++) {
    const lease = leasedPorts.find((l) => l.port === port);
    allPorts.push({
      port,
      status: lease ? 'leased' : 'available',
      leaseId: lease?.leaseId ?? null,
      pid: lease?.pid ?? null,
    });
  }

  const status = {
    server: SERVER_INFO,
    protocol: MCP_PROTOCOL_VERSION,
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    cdpPorts: allPorts,
    timestamp: new Date().toISOString(),
  };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(status, null, 2),
      },
    ],
  };
}

/**
 * take-screenshot — capture a screenshot of the specified Agent window via CDP.
 * On success, returns both metadata (text) and base64 image data (image content).
 * @param {Object} args - Tool arguments.
 * @param {string} args.agentId - Target agent identifier.
 * @param {string} [args.format] - Image format ("png" or "jpeg").
 * @returns {Promise<{ content: Array<{ type: string, text?: string, data?: string, mimeType?: string }> }>}
 */
async function handleTakeScreenshot(args) {
  const result = await takeScreenshot(args.agentId, {
    format: args.format,
  });

  if (!result.ok) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  const { data, ...metadata } = result;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(metadata, null, 2),
      },
      {
        type: 'image',
        data,
        mimeType: 'image/png',
      },
    ],
  };
}

/**
 * get-dom-snapshot — capture a simplified DOM snapshot of the specified Agent.
 * @param {Object} args - Tool arguments.
 * @param {string} args.agentId - Target agent identifier.
 * @param {number} [args.maxDepth] - Maximum tree depth (default 5).
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleGetDomSnapshot(args) {
  const result = await getDomSnapshot(args.agentId, {
    maxDepth: args.maxDepth,
  });

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

/**
 * verify-injection — verify AgentSkin injection status of the specified Agent.
 * @param {Object} args - Tool arguments.
 * @param {string} args.agentId - Target agent identifier.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleVerifyInjection(args) {
  const result = await verifyInjection(args.agentId);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

/**
 * list-discovery-targets — discover all currently available injection targets.
 * @param {Object} _args - No parameters required.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleListDiscoveryTargets(_args) {
  const result = await listDiscoveryTargets();

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ targets: result }, null, 2),
      },
    ],
  };
}

/**
 * get-applied-theme — get the currently applied theme info for the specified Agent.
 * @param {Object} args - Tool arguments.
 * @param {string} args.agentId - Target agent identifier.
 * @returns {Promise<{ content: Array<{ type: string, text: string }> }>}
 */
async function handleGetAppliedTheme(args) {
  const result = await getAppliedTheme(args.agentId);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

/** Registry of all tools exposed by this server. */
const TOOLS = Object.freeze({
  'list-targets': {
    name: 'list-targets',
    description:
      'List all injectable AI application targets (traework, qoderwork, workbuddy, doubao, codex, zcode) with their CDP ports and capabilities.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: handleListTargets,
  },
  'get-server-status': {
    name: 'get-server-status',
    description:
      'Get the MCP server status including uptime, PID, and CDP port lease state (which ports are available vs leased).',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: handleServerStatus,
  },
  'take-screenshot': {
    name: 'take-screenshot',
    description:
      'Capture a screenshot of the specified Agent window via CDP. Returns base64 image data on success.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent identifier (e.g. "codex", "workbuddy").',
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg'],
          description: 'Image format (default: png).',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: handleTakeScreenshot,
  },
  'get-dom-snapshot': {
    name: 'get-dom-snapshot',
    description:
      'Capture a simplified DOM snapshot of the specified Agent, returning a compact tree structure.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent identifier.',
        },
        maxDepth: {
          type: 'number',
          description: 'Maximum tree depth to capture (default: 5).',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: handleGetDomSnapshot,
  },
  'verify-injection': {
    name: 'verify-injection',
    description:
      'Verify AgentSkin injection status of the specified Agent by checking runtime markers.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent identifier.',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: handleVerifyInjection,
  },
  'list-discovery-targets': {
    name: 'list-discovery-targets',
    description:
      'Discover all currently available injection targets across all registered adapters with live CDP endpoints.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: handleListDiscoveryTargets,
  },
  'get-applied-theme': {
    name: 'get-applied-theme',
    description:
      'Get the currently applied theme info for the specified Agent (themeId, version, source).',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Target agent identifier.',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: handleGetAppliedTheme,
  },
});

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 message handling
// ---------------------------------------------------------------------------

/**
 * Send a JSON-RPC response to stdout.
 * @param {Object|null} id - Request id (null for notifications).
 * @param {Object} result - Response payload.
 */
function sendResponse(id, result) {
  const message = JSON.stringify({ jsonrpc: '2.0', id, result });
  process.stdout.write(`${message}\n`);
}

/**
 * Send a JSON-RPC error to stdout.
 * @param {Object|null} id - Request id.
 * @param {number} code - Error code.
 * @param {string} message - Error message.
 * @param {Object} [data] - Additional error data.
 */
function sendError(id, code, message, data) {
  const message_obj = JSON.stringify({
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data ? { data } : {}) },
  });
  process.stdout.write(`${message_obj}\n`);
}

/**
 * Handle an incoming JSON-RPC request.
 * @param {Object} request - Parsed JSON-RPC request object.
 */
async function handleRequest(request) {
  if (request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    sendError(request.id ?? null, -32600, 'Invalid Request');
    return;
  }

  const { id, method, params = {} } = request;

  try {
    switch (method) {
      case 'initialize': {
        sendResponse(id, {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
        break;
      }

      case 'tools/list': {
        const tools = Object.values(TOOLS).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        }));
        sendResponse(id, { tools });
        break;
      }

      case 'tools/call': {
        const toolName = params.name;
        const tool = TOOLS[toolName];
        if (!tool) {
          sendError(id, -32601, `Unknown tool: ${toolName}`);
          break;
        }
        const result = await tool.handler(params.arguments ?? {});
        sendResponse(id, result);
        break;
      }

      case 'notifications/initialized':
        // Client acknowledged initialization — no response needed.
        break;

      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    sendError(id, -32603, err instanceof Error ? err.message : String(err));
  }
}

// ---------------------------------------------------------------------------
// Stdio transport
// ---------------------------------------------------------------------------

/**
 * Start the MCP server on stdio transport.
 * Reads JSON-RPC requests from stdin, writes responses to stdout.
 */
function start() {
  const rl = createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    try {
      const request = JSON.parse(line);
      handleRequest(request);
    } catch {
      sendError(null, -32700, 'Parse error');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });

  // Handle graceful shutdown.
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

// Auto-start when run directly (not when imported by tests).
if (process.argv[1]?.endsWith('agent-skin-mcp-server.mjs')) {
  start();
}

// Export for testing.
export { handleRequest, TOOLS };
