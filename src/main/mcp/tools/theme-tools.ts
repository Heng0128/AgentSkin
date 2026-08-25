// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Tools (5 tools)
 *
 * Provides theme lifecycle operations:
 *   - apply_theme    — apply a theme to a specific agent
 *   - restore_theme  — restore an agent's native appearance
 *   - import_theme   — import a theme from a file path
 *   - delete_theme   — delete an installed theme
 *   - export_theme   — export a theme package to a destination path
 *
 * ## Service access note
 *
 * The McpContext exposes read-only views of the core services. For mutating
 * operations (apply, restore, import, delete, export) we access the full
 * service interfaces via type assertion — the underlying instances are the
 * same objects the read-only views wrap.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AgentId } from '../../../shared/types';
import type { AgentEngineServiceApi, ThemeLibraryApi } from '../../services/contracts';
import { syncStatusToGui } from '../status-sync';
import type { McpToolDefinition } from '../tool-registry';
import { registerTool } from '../tool-registry';
import type { McpContext, McpToolResult } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(data: unknown): McpToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): McpToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * Access the full AgentEngineServiceApi from the McpContext.
 * The McpContext.core is a read-only view that wraps the same underlying
 * AgentEngineServiceApi instance.
 */
function getEngine(ctx: McpContext): AgentEngineServiceApi {
  // The McpAgentEngine view wraps mainCtx.core — we recover the full interface
  // by casting. This is safe because the view holds a reference to the same
  // concrete AgentEngineService instance.
  return ctx.core as unknown as AgentEngineServiceApi;
}

/**
 * Access the full ThemeLibraryApi from the McpContext.
 * The McpContext.library is a read-only view that wraps the same underlying
 * ThemeLibraryApi instance.
 */
function getLibrary(ctx: McpContext): ThemeLibraryApi {
  return ctx.library as unknown as ThemeLibraryApi;
}

// ---------------------------------------------------------------------------
// apply_theme
// ---------------------------------------------------------------------------

const applyThemeSchema = z.object({
  theme_id: z.string().min(1, 'theme_id is required'),
  agent_id: z.string().min(1, 'agent_id is required'),
});

async function applyThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { theme_id, agent_id } = applyThemeSchema.parse(args);
  try {
    const response = await getEngine(ctx).apply({
      themeId: theme_id,
      appId: agent_id as AgentId,
    });
    syncStatusToGui('apply_theme');
    return ok({
      status: response.status,
      message: response.message,
      system: {
        platform: response.system.platform,
        apps: response.system.apps.map((a) => ({
          agent_id: a.appId,
          displayName: a.displayName,
          activeThemeId: a.activeThemeId,
          running: a.running,
          debugReady: a.debugReady,
        })),
      },
    });
  } catch (err) {
    return fail(`Failed to apply theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// restore_theme
// ---------------------------------------------------------------------------

const restoreThemeSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
});

async function restoreThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id } = restoreThemeSchema.parse(args);
  try {
    const status = await getEngine(ctx).restore(agent_id as AgentId);
    syncStatusToGui('restore_theme');
    return ok({
      message: `Agent "${agent_id}" restored to native appearance`,
      system: {
        platform: status.platform,
        apps: status.apps.map((a) => ({
          agent_id: a.appId,
          displayName: a.displayName,
          activeThemeId: a.activeThemeId,
          running: a.running,
        })),
      },
    });
  } catch (err) {
    return fail(`Failed to restore theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// import_theme
// ---------------------------------------------------------------------------

const importThemeSchema = z.object({
  file_path: z.string().min(1, 'file_path is required'),
});

async function importThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { file_path } = importThemeSchema.parse(args);
  try {
    await fs.access(file_path, fs.constants.R_OK);
    const ext = path.extname(file_path).toLowerCase();
    if (ext !== '.agenttheme' && ext !== '.agentskin-theme' && ext !== '.agentskin-bundle') {
      return fail(
        `Unsupported file extension "${ext}". Expected .agentskin-theme or .agentskin-bundle`,
      );
    }
    const installed = await getLibrary(ctx).importPackage(file_path);
    syncStatusToGui('import_theme');
    return ok({
      message: `Theme "${installed.displayName}" imported successfully`,
      theme: {
        id: installed.id,
        name: installed.displayName,
        version: installed.version,
        supportedAgents: installed.supportedAgents,
        mode: installed.mode ?? null,
      },
    });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return fail(`File not found: "${file_path}"`);
    }
    return fail(`Failed to import theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// delete_theme
// ---------------------------------------------------------------------------

const deleteThemeSchema = z.object({
  theme_id: z.string().min(1, 'theme_id is required'),
});

async function deleteThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { theme_id } = deleteThemeSchema.parse(args);
  try {
    await getLibrary(ctx).find(theme_id);
    await getLibrary(ctx).delete(theme_id);
    syncStatusToGui('delete_theme');
    const remaining = await ctx.library.summaries();
    return ok({
      message: `Theme "${theme_id}" deleted successfully`,
      remaining_count: remaining.length,
    });
  } catch (err) {
    return fail(`Failed to delete theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// export_theme
// ---------------------------------------------------------------------------

const exportThemeSchema = z.object({
  theme_id: z.string().min(1, 'theme_id is required'),
  output_path: z.string().min(1, 'output_path is required'),
});

async function exportThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { theme_id, output_path } = exportThemeSchema.parse(args);
  try {
    await getLibrary(ctx).find(theme_id);
    const outputDir = path.dirname(output_path);
    await fs.mkdir(outputDir, { recursive: true });
    await getLibrary(ctx).exportPackage(theme_id, output_path);
    return ok({
      message: `Theme "${theme_id}" exported to "${output_path}"`,
      theme_id,
      output_path,
    });
  } catch (err) {
    return fail(`Failed to export theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all theme lifecycle tools in the global tool registry.
 *
 * Call this function once during MCP initialization to make the five theme
 * management tools available to MCP clients.
 */
export function registerThemeTools(): void {
  registerTool({
    name: 'apply_theme',
    description: 'Apply a theme to a specific agent.',
    inputSchema: applyThemeSchema,
    handler: applyThemeHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'restore_theme',
    description: 'Restore an agent to its native (un-themed) appearance.',
    inputSchema: restoreThemeSchema,
    handler: restoreThemeHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'import_theme',
    description: 'Import a theme package from a file path (.agentskin-theme or .agentskin-bundle).',
    inputSchema: importThemeSchema,
    handler: importThemeHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'delete_theme',
    description: 'Delete an installed theme by its theme_id.',
    inputSchema: deleteThemeSchema,
    handler: deleteThemeHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'export_theme',
    description: 'Export an installed theme package to the specified output path.',
    inputSchema: exportThemeSchema,
    handler: exportThemeHandler,
  } satisfies McpToolDefinition);
}
