// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP IPC
 *
 * MCP-related IPC handlers: get server status, start/stop the HTTP server
 * at runtime from the Settings UI. The HTTP server is started during boot
 * (boot-sequence.ts) when AGENTSKIN_DISABLE_MCP !== '1'; these handlers let
 * the user toggle it on/off without restarting the app.
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';
import { createMcpContext } from '../mcp/context';
import {
  getMcpHttpPort,
  isMcpHttpRunning,
  startMcpHttpServer,
  stopMcpHttpServer,
} from '../mcp/http-server';
import { registerAllTools } from '../mcp/index';

export function registerMcpIpc(deps: MainContext): void {
  // Get current MCP HTTP server status
  ipcMain.handle(IpcChannel.MCP_GET_STATUS, () => {
    const running = isMcpHttpRunning();
    const port = getMcpHttpPort();
    return {
      running,
      url: running && port ? `http://127.0.0.1:${port}/mcp` : null,
    };
  });

  // Start the MCP HTTP server
  ipcMain.handle(IpcChannel.MCP_START, async () => {
    if (isMcpHttpRunning()) {
      return { ok: true, url: 'http://127.0.0.1:3333/mcp', alreadyRunning: true };
    }
    try {
      // Ensure tools are registered (ignore duplicate errors — tools may
      // already be registered from boot-time initialization).
      try {
        registerAllTools();
      } catch {
        // Already registered — safe to ignore.
      }
      const mcpCtx = createMcpContext(deps);
      const port = await startMcpHttpServer(mcpCtx);
      const url = `http://127.0.0.1:${port}/mcp`;
      return { ok: true, url };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });

  // Stop the MCP HTTP server
  ipcMain.handle(IpcChannel.MCP_STOP, async () => {
    if (!isMcpHttpRunning()) {
      return { ok: true, alreadyStopped: true };
    }
    try {
      await stopMcpHttpServer();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  });
}
