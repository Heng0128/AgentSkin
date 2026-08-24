// SPDX-License-Identifier: MPL-2.0

/**
 * # MCP Context
 *
 * Bridge layer that exposes a safe, read-oriented slice of {@link MainContext}
 * to MCP tool handlers. The McpContext surface is intentionally narrower than
 * MainContext — MCP consumers can query state and trigger read-only operations
 * but cannot directly mutate core services or access Electron-specific handles
 * (windows, tray, disposables).
 *
 * ## Design rules
 *
 * - McpContext is a *view* of MainContext, not a copy — it holds references
 *   to the same service instances.
 * - Only methods that are safe to call from an external MCP client are exposed.
 *   Mutating operations (apply, delete, install, setWallpaper, etc.) are
 *   deliberately excluded.
 * - The context is created once after boot completes and is immutable from the
 *   MCP layer's perspective.
 */

import type { AgentId, InstalledTheme, SystemStatus } from '../../shared/types';
import type { MainContext } from '../main-context';
import type { ThemeCatalogItem } from '../catalog/types';
import type { AgentCatalogItem } from '../catalog/types';

/**
 * Read-only view of the theme catalog for MCP tool handlers.
 */
export interface McpThemeCatalog {
  listThemes(): Promise<ThemeCatalogItem[]>;
  getTheme(id: string): Promise<ThemeCatalogItem | null>;
  searchThemes(query: string): Promise<ThemeCatalogItem[]>;
  filterByAgent(agentId: AgentId): Promise<ThemeCatalogItem[]>;
}

/**
 * Read-only view of the agent catalog for MCP tool handlers.
 */
export interface McpAgentCatalog {
  listAgents(): AgentCatalogItem[];
  getAgent(id: string): AgentCatalogItem | null;
  getAvailableAgents(): AgentCatalogItem[];
}

/**
 * Read-only view of the theme library for MCP tool handlers.
 */
export interface McpThemeLibrary {
  summaries(): Promise<InstalledTheme[]>;
  coverPathFor(id: string): string | null;
  iconPathFor(id: string): string | null;
}

/**
 * Read-only view of settings for MCP tool handlers.
 */
export interface McpSettings {
  wallpaper(): import('../../shared/types').WallpaperSettings;
  agentWallpaper(appId: AgentId): import('../../shared/types').WallpaperAgentSetting;
  customThemeCss(): string;
  liveDomRefreshInterval(): number;
}

/**
 * Read-only view of the agent engine orchestrator for MCP tool handlers.
 */
export interface McpAgentEngine {
  status(): Promise<SystemStatus>;
}

/**
 * MCP-safe context exposing read-oriented service slices.
 *
 * Constructed from a fully-initialized {@link MainContext}. Holds references
 * to the same service instances — no data is copied.
 */
export interface McpContext {
  themeCatalog: McpThemeCatalog;
  agentCatalog: McpAgentCatalog;
  library: McpThemeLibrary;
  settings: McpSettings;
  core: McpAgentEngine;
}

/**
 * Create an {@link McpContext} from a fully-initialized {@link MainContext}.
 *
 * The returned object exposes only the read-oriented methods that are safe
 * for external MCP clients to call. Mutating operations are intentionally
 * omitted.
 *
 * @param mainCtx - The main process context (must be boot-complete).
 * @returns A McpContext safe for MCP tool handlers.
 */
export function createMcpContext(mainCtx: MainContext): McpContext {
  return {
    themeCatalog: {
      listThemes: () => mainCtx.themeCatalog.listThemes(),
      getTheme: (id: string) => mainCtx.themeCatalog.getTheme(id),
      searchThemes: (query: string) => mainCtx.themeCatalog.searchThemes(query),
      filterByAgent: (agentId: AgentId) => mainCtx.themeCatalog.filterByAgent(agentId),
    },
    agentCatalog: {
      listAgents: () => mainCtx.agentCatalog.listAgents(),
      getAgent: (id: string) => mainCtx.agentCatalog.getAgent(id),
      getAvailableAgents: () => mainCtx.agentCatalog.getAvailableAgents(),
    },
    library: {
      summaries: () => mainCtx.library.summaries(),
      coverPathFor: (id: string) => mainCtx.library.coverPathFor(id),
      iconPathFor: (id: string) => mainCtx.library.iconPathFor(id),
    },
    settings: {
      wallpaper: () => mainCtx.settings.wallpaper(),
      agentWallpaper: (appId: AgentId) => mainCtx.settings.agentWallpaper(appId),
      customThemeCss: () => mainCtx.settings.customThemeCss(),
      liveDomRefreshInterval: () => mainCtx.settings.liveDomRefreshInterval(),
    },
    core: {
      status: () => mainCtx.core.status(),
    },
  };
}
