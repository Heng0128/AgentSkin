// SPDX-License-Identifier: MPL-2.0

/**
 * # Unified AgentSkin Client
 *
 * Renderer-side typed wrapper over the unified IPC surface exposed by preload's
 * `unifiedIpc` bridge. When the `useUnifiedIPC` feature flag is `true`, the
 * renderer calls these methods instead of the legacy `api.*` per-action calls.
 *
 * ## Design Goals
 *
 * - Single typed import path for every unified IPC call (mirrors the goals of
 *   `src/ui/api/agentSkinClient.ts` but for the new router).
 * - Zero business logic — this file is pure transport + typing.
 * - Drop-in replacement: the same Store code can switch between
 *   `api.refreshStatus()` (legacy) and `unified.status('system')` (unified)
 *   via the feature flag.
 *
 * ## Usage
 *
 * ```ts
 *   const unified = getUnifiedAgentSkinClient();
 *   const status = await unified.status('system');
 *   const themes = await unified.status('theme-list');
 * ```
 */

import type { AgentId, SystemStatus, WallpaperInfo } from '@shared/types';
import type { StatusQueryAction } from '@shared/types/unified-ipc';
import { UnifiedChannel } from '@shared/types/unified-ipc';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UnifiedStatusQueryApi {
  /** Full system status (all agents — installed/running/debugReady). */
  system(): Promise<SystemStatus>;
  /** Agent catalog + live running/installed/debugReady overlay. */
  agentList(): Promise<unknown>;
  /** List all installed themes (catalog wrapped). */
  themeList(): Promise<unknown>;
  /** Get a single theme by id. Returns null when missing. */
  themeGet(id: string): Promise<unknown>;
  /** Full-text search across theme names + descriptions. */
  themeSearch(query: string): Promise<unknown>;
  /** Filter themes compatible with a specific agent. */
  themeFilter(agentId: AgentId): Promise<unknown>;
  /** List all wallpapers (empty array when service is unavailable). */
  wallpaperList(): Promise<WallpaperInfo[]>;
}

/**
 * The shape exposed by preload's `unifiedIpc` bridge.
 * Declared as an interface so it's mocked trivially in tests.
 */
export interface UnifiedIpcBridge {
  invoke(channel: string, action: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Full unified client. Today only `status` is implemented; other domains
 * will land in follow-up PRs behind the same feature flag.
 */
export interface UnifiedAgentSkinClient {
  status: UnifiedStatusQueryApi;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const CHANNEL_STATUS_QUERY = UnifiedChannel.STATUS_QUERY;

/**
 * Build the unified client from a bridge. The bridge is obtained from
 * `window.unifiedIpc` (see preload.ts), injected at runtime.
 */
export function createUnifiedAgentSkinClient(bridge: UnifiedIpcBridge): UnifiedAgentSkinClient {
  const call = <T>(action: StatusQueryAction, ...args: unknown[]): Promise<T> =>
    bridge.invoke(CHANNEL_STATUS_QUERY, action, ...args) as Promise<T>;

  return {
    status: {
      system: () => call<SystemStatus>('system'),
      agentList: () => call<unknown>('agent-list'),
      themeList: () => call<unknown>('theme-list'),
      themeGet: (id: string) => call<unknown>('theme-get', id),
      themeSearch: (query: string) => call<unknown>('theme-search', query),
      themeFilter: (agentId: AgentId) => call<unknown>('theme-filter', agentId),
      wallpaperList: () => call<WallpaperInfo[]>('wallpaper-list'),
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton accessor (lazy, HMR-safe)
// ---------------------------------------------------------------------------

let _unifiedCache: UnifiedAgentSkinClient | null = null;

/**
 * Returns the unified IPC client singleton. Uses a Proxy so module load does
 * NOT eagerly evaluate `window.unifiedIpc` (prevents Vite-HMR 500).
 */
export function getUnifiedAgentSkinClient(): UnifiedAgentSkinClient {
  if (!_unifiedCache) {
    if (typeof window === 'undefined' || !('unifiedIpc' in window)) {
      throw new Error(
        'window.unifiedIpc is not exposed — preload.ts failed to register the unified bridge',
      );
    }
    const bridge = (window as unknown as { unifiedIpc: UnifiedIpcBridge }).unifiedIpc;
    _unifiedCache = createUnifiedAgentSkinClient(bridge);
  }
  return _unifiedCache;
}

/**
 * Proxy-based lazy accessor — same pattern as `src/ui/api/agentSkinClient.ts`.
 * Every method access defers to the cached client so existing code that does
 * `unified.status.system()` works without a re-write.
 */
export const unified: UnifiedAgentSkinClient = new Proxy({} as UnifiedAgentSkinClient, {
  get(_t, prop) {
    return getUnifiedAgentSkinClient()[prop as keyof UnifiedAgentSkinClient];
  },
});
