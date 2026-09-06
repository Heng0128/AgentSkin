// SPDX-License-Identifier: MPL-2.0

/**
 * # Status Tools (6 read-only tools)
 *
 * Provides read-only access to theme, agent, and system state:
 *   - list_themes       — list installed themes (optional agent_id filter)
 *   - get_theme         — get single theme by id
 *   - search_themes     — search themes by query
 *   - list_agents       — list all supported agents
 *   - get_agent_status  — get injection status for one agent
 *   - get_system_status — get overall system status
 */

import { z } from 'zod';
import type { AgentId } from '../../../shared/types';
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

// ---------------------------------------------------------------------------
// list_themes
// ---------------------------------------------------------------------------

const listThemesSchema = z.object({
  agent_id: z.string().optional(),
});

async function listThemesHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id } = listThemesSchema.parse(args);
  try {
    const themes = agent_id
      ? await ctx.themeCatalog.filterByAgent(agent_id as AgentId)
      : await ctx.themeCatalog.listThemes();
    return ok({
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        version: t.version,
        author: t.author,
        category: t.category,
        mode: t.mode ?? null,
        supportedAgents: t.supportedAgents,
      })),
      count: themes.length,
    });
  } catch (err) {
    return fail(`Failed to list themes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// get_theme
// ---------------------------------------------------------------------------

const getThemeSchema = z.object({
  theme_id: z.string().min(1, 'theme_id is required'),
});

async function getThemeHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { theme_id } = getThemeSchema.parse(args);
  try {
    const theme = await ctx.themeCatalog.getTheme(theme_id);
    if (!theme) {
      return fail(`Theme not found: "${theme_id}"`);
    }
    return ok({
      id: theme.id,
      name: theme.name,
      version: theme.version,
      author: theme.author,
      category: theme.category,
      mode: theme.mode ?? null,
      supportedAgents: theme.supportedAgents,
      tags: theme.tags,
      colors: theme.colors ?? null,
      description: theme.description,
    });
  } catch (err) {
    return fail(`Failed to get theme: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// search_themes
// ---------------------------------------------------------------------------

const searchThemesSchema = z.object({
  query: z.string(),
  mode: z.enum(['dark', 'light', 'auto']).optional(),
  agent_id: z.string().optional(),
});

async function searchThemesHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { query, mode, agent_id } = searchThemesSchema.parse(args);
  try {
    // Start with either filtered-by-agent or all themes.
    let themes = agent_id
      ? await ctx.themeCatalog.filterByAgent(agent_id as AgentId)
      : await ctx.themeCatalog.listThemes();

    // Apply search query.
    const q = query.trim().toLowerCase();
    if (q) {
      themes = themes.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.category.toLowerCase().includes(q),
      );
    }

    // Optional mode filter.
    if (mode) {
      themes = themes.filter((t) => t.mode === mode);
    }

    return ok({
      themes: themes.map((t) => ({
        id: t.id,
        name: t.name,
        version: t.version,
        mode: t.mode ?? null,
        supportedAgents: t.supportedAgents,
      })),
      count: themes.length,
    });
  } catch (err) {
    return fail(`Failed to search themes: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// list_agents
// ---------------------------------------------------------------------------

const listAgentsSchema = z.object({});

async function listAgentsHandler(_args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const agents = ctx.agentCatalog.listAgents();
  return ok({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      displayName: a.displayName,
      officialName: a.officialName,
      region: a.region,
      type: a.type,
      supported: a.supported,
      status: a.status,
    })),
    count: agents.length,
  });
}

// ---------------------------------------------------------------------------
// get_agent_status
// ---------------------------------------------------------------------------

const getAgentStatusSchema = z.object({
  agent_id: z.string().min(1, 'agent_id is required'),
});

async function getAgentStatusHandler(args: unknown, ctx: McpContext): Promise<McpToolResult> {
  const { agent_id } = getAgentStatusSchema.parse(args);
  try {
    const catalogAgent = ctx.agentCatalog.getAgent(agent_id);
    if (!catalogAgent) {
      return fail(`Unknown agent_id: "${agent_id}"`);
    }
    const status = await ctx.core.status();
    const app = status.apps.find((a) => a.appId === agent_id);
    return ok({
      agent_id,
      displayName: catalogAgent.displayName,
      installed: app?.installed ?? false,
      running: app?.running ?? false,
      debugReady: app?.debugReady ?? false,
      port: app?.port ?? null,
      activeThemeId: app?.activeThemeId ?? null,
      activeSchemeId: app?.activeSchemeId ?? null,
      version: app?.version ?? null,
    });
  } catch (err) {
    return fail(`Failed to get agent status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// get_system_status
// ---------------------------------------------------------------------------

const getSystemStatusSchema = z.object({});

async function getSystemStatusHandler(_args: unknown, ctx: McpContext): Promise<McpToolResult> {
  try {
    const status = await ctx.core.status();
    return ok({
      platform: status.platform,
      apps: status.apps.map((a) => ({
        agent_id: a.appId,
        displayName: a.displayName,
        installed: a.installed,
        running: a.running,
        debugReady: a.debugReady,
        port: a.port,
        activeThemeId: a.activeThemeId,
        version: a.version ?? null,
      })),
      agentCount: status.apps.length,
    });
  } catch (err) {
    return fail(`Failed to get system status: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all status tools in the global tool registry.
 *
 * Call this function once during MCP initialization to make the six read-only
 * status tools available to MCP clients.
 */
export function registerStatusTools(): void {
  registerTool({
    name: 'list_themes',
    description: 'List all installed themes. Optionally filter by agent_id.',
    inputSchema: listThemesSchema,
    handler: listThemesHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'get_theme',
    description: 'Get details of a single theme by its theme_id.',
    inputSchema: getThemeSchema,
    handler: getThemeHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'search_themes',
    description: 'Search installed themes by query string. Optionally filter by mode and agent_id.',
    inputSchema: searchThemesSchema,
    handler: searchThemesHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'list_agents',
    description: 'List all supported agents (their id, display name, region, type).',
    inputSchema: listAgentsSchema,
    handler: listAgentsHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'get_agent_status',
    description: 'Get the current injection/status of a specific agent.',
    inputSchema: getAgentStatusSchema,
    handler: getAgentStatusHandler,
  } satisfies McpToolDefinition);

  registerTool({
    name: 'get_system_status',
    description: 'Get the overall system status (platform + per-agent status).',
    inputSchema: getSystemStatusSchema,
    handler: getSystemStatusHandler,
  } satisfies McpToolDefinition);
}
