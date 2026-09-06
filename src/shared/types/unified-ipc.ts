// SPDX-License-Identifier: MPL-2.0

/**
 * # Unified IPC Contract
 *
 * Replaces the flat 137-handler IPC surface with 6 domain channels + 1 batch.
 * Each channel accepts an `action` discriminator so a single `ipcMain.handle`
 * registration serves every operation within that domain.
 *
 * ## Channel Catalog
 *
 * | Channel       | Policy         | Actions (status:query shown; others TBD in follow-up PRs) |
 * |---------------|----------------|-----------------------------------------------------------|
 * | `status:query` | Read-only     | `system`, `agent-list`, `theme-list`, `theme-get`, `theme-search`, `theme-filter`, `wallpaper-list` |
 * | `app:discover` | Write         | TBD                                                       |
 * | `theme:apply`  | Write         | TBD                                                       |
 * | `wallpaper:apply` | Write      | TBD                                                       |
 * | `bundle:install` | Write       | TBD                                                       |
 * | `studio:command` | Write       | TBD                                                       |
 * | `batch`        | Multi-op      | TBD                                                       |
 *
 * ## Rollout
 *
 * A `useUnifiedIPC` feature flag (default `false`) toggles whether the router
 * or legacy per-action handlers are registered in the main process. This file
 * is the type contract only — it compiles regardless of the flag.
 */

import type { AgentId, SystemStatus, WallpaperInfo } from './index';
import type { ThemeCatalogItem } from './theme';

// ---------------------------------------------------------------------------
// Channel names (shared between main-process router and preload bridge)
// ---------------------------------------------------------------------------

/** The 6 core domain channels + 1 batch channel. */
export const UnifiedChannel = {
  STATUS_QUERY: 'status:query',
  APP_DISCOVER: 'app:discover',
  THEME_APPLY: 'theme:apply',
  WALLPAPER_APPLY: 'wallpaper:apply',
  BUNDLE_INSTALL: 'bundle:install',
  STUDIO_COMMAND: 'studio:command',
  BATCH: 'batch',
} as const;

export type UnifiedChannelName = (typeof UnifiedChannel)[keyof typeof UnifiedChannel];

// ---------------------------------------------------------------------------
// status:query
// ---------------------------------------------------------------------------

export type StatusQueryAction =
  | 'system'
  | 'agent-list'
  | 'theme-list'
  | 'theme-get'
  | 'theme-search'
  | 'theme-filter'
  | 'wallpaper-list';

/** Discriminated-union request payload for `status:query`. */
export type StatusQueryRequest =
  | { action: 'system' }
  | { action: 'agent-list' }
  | { action: 'theme-list' }
  | { action: 'theme-get'; id: string }
  | { action: 'theme-search'; query: string }
  | { action: 'theme-filter'; agentId: AgentId }
  | { action: 'wallpaper-list' };

/** Discriminated-union response payload for `status:query`. */
export type StatusQueryResponse<System, AgentList, ThemeList, ThemeItem, WallpaperList> =
  | { action: 'system'; data: System }
  | { action: 'agent-list'; data: AgentList }
  | { action: 'theme-list'; data: ThemeList }
  | { action: 'theme-get'; data: ThemeItem | null }
  | { action: 'theme-search'; data: ThemeList }
  | { action: 'theme-filter'; data: ThemeList }
  | { action: 'wallpaper-list'; data: WallpaperList };

/** Concrete status:query response using project types. */
export type StatusQueryResponseConcrete = StatusQueryResponse<
  SystemStatus,
  unknown, // AgentCatalogItem[] — keep loose to avoid circular import
  ThemeCatalogItem[],
  ThemeCatalogItem,
  WallpaperInfo[]
>;

// ---------------------------------------------------------------------------
// batch
// ---------------------------------------------------------------------------

export interface BatchItem {
  channel: string;
  action: string;
  params?: unknown[];
}

export interface BatchResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}
