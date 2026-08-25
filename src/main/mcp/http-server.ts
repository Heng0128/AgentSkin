// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP HTTP Server
 *
 * Streamable HTTP transport for AgentSkin MCP Server.
 * Provides a local HTTP endpoint that MCP clients (Cursor, Windsurf, etc.)
 * can connect to via Streamable HTTP protocol.
 *
 * ## Stateless pattern
 *
 * Following the SDK's `simpleStatelessStreamableHttp` example: each POST
 * request creates a fresh `McpServer` + `StreamableHTTPServerTransport`,
 * registers tools, handles the request, then tears down. This avoids
 * session-state conflicts that occur when a stateless transport is reused
 * across multiple requests.
 *
 * ## Endpoint
 *
 * POST http://127.0.0.1:<port>/mcp  — JSON-RPC requests
 * GET  http://127.0.0.1:<port>/mcp  — SSE stream (server→client notifications)
 * DELETE http://127.0.0.1:<port>/mcp — session termination
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { ZodRawShape } from 'zod';
import { generateApiKey, validateApiKey } from './auth';
import { executeTool } from './capability-orchestrator';
import { getMcpConfig } from './config';
import { getTool, listTools } from './tool-registry';
import type { McpContext } from './types';

// ---------------------------------------------------------------------------
// RC2-S2-B: Type-safe helpers for JSON-RPC and schema handling
// ---------------------------------------------------------------------------

/**
 * Safely extract the raw shape from a ZodObject for MCP SDK registration.
 * Validates the shape is a non-null object before casting.
 */
function extractSchemaShape(shape: unknown): ZodRawShape {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape)) {
    throw new Error('Invalid tool inputSchema: expected ZodObject.shape to be a non-null object');
  }
  return shape as ZodRawShape;
}

/**
 * Narrow an unknown parsed JSON body to a JSON-RPC-like record.
 * Returns null if the value is not a non-null object, allowing callers
 * to handle malformed input gracefully.
 */
function asJsonRpcBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Debug logging — writes to a file since stderr may be swallowed by electron-vite
// ---------------------------------------------------------------------------

const DEBUG_LOG = path.join(process.cwd(), 'mcp-debug.log');

function debugLog(msg: string): void {
  try {
    fs.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore
  }
}

// Log module load to verify path
debugLog(`MODULE LOADED. cwd=${process.cwd()}, DEBUG_LOG=${DEBUG_LOG}`);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum request body size (10 MiB) — prevents memory exhaustion from malformed clients. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;
/** Seconds before an idle connection is evicted. */
const IDLE_TIMEOUT_SEC = 60;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let httpServer: http.Server | null = null;
let serverPort: number | null = null;

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

/**
 * Start the MCP HTTP Server.
 *
 * Only the underlying TCP listener is long-lived. The MCP server instance
 * and transport are created per-request (stateless pattern).
 *
 * @param ctx - MCP context carrying service references for tool handlers.
 * @returns The actual port number the server is listening on.
 */
export async function startMcpHttpServer(ctx: McpContext): Promise<number> {
  if (httpServer) {
    console.error(`agentskin-mcp: HTTP server already running on port ${serverPort}`);
    return serverPort!;
  }

  const cfg = getMcpConfig();
  const MCP_HOST = cfg.httpHost;
  const MCP_PORT_DEFAULT = cfg.httpPort;
  const MCP_PATH = cfg.httpPath;

  // Generate API key for this session if auth is required
  let sessionApiKey: string | null = null;
  if (cfg.authRequired) {
    sessionApiKey = generateApiKey();
    console.error(`agentskin-mcp: auth enabled — API key: ${sessionApiKey}`);
  } else {
    console.error('agentskin-mcp: auth disabled');
  }

  // Create HTTP server — MCP server and transport are per-request
  const httpSrv = http.createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${MCP_HOST}`);

    // Only handle /mcp path
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
      return;
    }

    // Auth check (when enabled)
    if (cfg.authRequired && sessionApiKey) {
      const authHeader = req.headers['authorization'];
      const providedKey = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
      if (!validateApiKey(providedKey)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({ error: 'Unauthorized — provide Bearer token in Authorization header' }),
        );
        return;
      }
    }

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Accept, Authorization, mcp-session-id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET/DELETE not supported in stateless mode
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed in stateless mode' }));
      return;
    }

    // Only POST is handled beyond this point
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Read body — with size limit and idle timeout.
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let timedOut = false;

    const idleTimer = setTimeout(() => {
      timedOut = true;
      console.error('agentskin-mcp: connection idle timeout, closing');
      req.destroy();
    }, IDLE_TIMEOUT_SEC * 1000);

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_REQUEST_BYTES) {
        clearTimeout(idleTimer);
        console.error(`agentskin-mcp: request exceeds ${MAX_REQUEST_BYTES} byte limit, rejecting`);
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Request exceeds ${MAX_REQUEST_BYTES} byte limit` }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (timedOut) return;
      clearTimeout(idleTimer);
      if (chunks.length === 0 && res.writableEnded) return;

      const body = Buffer.concat(chunks).toString('utf-8');
      let parsedBody: unknown;
      try {
        parsedBody = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // RC2-S2-B: Use type-safe narrowing instead of (parsedBody as any)
      const rpcBody = asJsonRpcBody(parsedBody);
      debugLog(`POST received: method=${rpcBody?.method}, id=${rpcBody?.id}`);

      // Stateless: create a new server + transport per request
      try {
        const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
        const { StreamableHTTPServerTransport } = await import(
          '@modelcontextprotocol/sdk/server/streamableHttp.js'
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        const server = new McpServer(
          { name: cfg.serverName, version: cfg.serverVersion },
          {
            capabilities: { tools: {} },
            instructions: 'AgentSkin MCP Server — theme management for AI coding agents.',
          },
        );

        // Register tools directly on this server instance
        const toolNames = listTools();
        for (const toolName of toolNames) {
          const toolDef = getTool(toolName);
          if (!toolDef) continue;
          try {
            // RC2-S2-B: Use type-safe schema shape extraction
            const schemaShape = extractSchemaShape(toolDef.inputSchema.shape);
            server.registerTool(
              toolDef.name,
              {
                description: toolDef.description,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK inputSchema type is opaque
                inputSchema: schemaShape as any,
              },
              async (args: Record<string, unknown>) => {
                const result = await executeTool(toolDef.name, args, ctx);
                return {
                  content: result.content,
                  isError: result.isError,
                };
              },
            );
          } catch (err) {
            debugLog(`failed to register tool "${toolName}": ${err}`);
          }
        }

        debugLog('server connecting...');
        await server.connect(transport);
        debugLog(`handling request: ${rpcBody?.method}`);
        await transport.handleRequest(req as any, res, parsedBody);
        debugLog('handleRequest completed');

        // Clean up when response closes
        res.on('close', () => {
          debugLog('response closed, cleaning up transport + server');
          transport.close();
          server.close();
        });
      } catch (error) {
        debugLog(`handleRequest ERROR: ${error}`);
        debugLog(`stack: ${error instanceof Error ? error.stack : 'no stack'}`);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    });
    req.on('error', (error) => {
      clearTimeout(idleTimer);
      console.error(`agentskin-mcp: request error: ${error}`);
    });
  });

  // Find an available port
  let port = MCP_PORT_DEFAULT;
  for (let attempt = 0; attempt <= 10; attempt++) {
    try {
      port = MCP_PORT_DEFAULT + attempt;
      await new Promise<void>((resolve, reject) => {
        httpSrv.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            reject(new Error('EADDRINUSE'));
          } else {
            reject(err);
          }
        });
        httpSrv.listen(port, MCP_HOST, () => resolve());
      });
      break;
    } catch (err) {
      if ((err as Error).message === 'EADDRINUSE') {
        continue;
      }
      throw err;
    }
  }

  httpServer = httpSrv;
  serverPort = port;

  console.error(`agentskin-mcp: HTTP server listening on http://${MCP_HOST}:${port}${MCP_PATH}`);
  return port;
}

/**
 * Stop the MCP HTTP Server.
 */
export async function stopMcpHttpServer(): Promise<void> {
  if (!httpServer) return;

  console.error('agentskin-mcp: stopping HTTP server...');
  await new Promise<void>((resolve) => {
    httpServer!.close(() => resolve());
  });
  httpServer = null;
  serverPort = null;
  console.error('agentskin-mcp: HTTP server stopped');
}

/**
 * Get the current HTTP server port.
 */
export function getMcpHttpPort(): number | null {
  return serverPort;
}

/**
 * Check if the HTTP server is running.
 */
export function isMcpHttpRunning(): boolean {
  return httpServer !== null;
}
