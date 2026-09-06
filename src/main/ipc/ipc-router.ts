// SPDX-License-Identifier: MPL-2.0

/**
 * # Unified IPC Router
 *
 * Single-handler-per-domain router that replaces the per-action `ipcMain.handle`
 * registration pattern. One `ipcMain.handle` per core channel; the first
 * argument in every request is an `action` discriminator that routes to the
 * appropriate service call.
 *
 * ## Design
 *
 * - **Channel ownership**: Each domain is owned by exactly one router handler.
 * - **Action routing**: The handler switch-cases on `action` and dispatches to
 *   existing service code — no business logic lives here.
 * - **Timeout**: Every action is wrapped in `withMonitoredTimeout` with a
 *   per-action timeout budget so a slow query doesn't hang the UI forever.
 * - **Validation**: Each action validates its own arguments (same invariants as
 *   the legacy handlers) before reaching service code.
 *
 * ## Lifecycle
 *
 * `registerUnifiedIpcRouter()` is called alongside legacy handlers. The
 * `useUnifiedIPC` flag determines which set actually serves requests. During
 * rollout both coexist; once the flag is permanently true, legacy handlers
 * are removed.
 */

import { ipcMain } from 'electron';
import { getMainMessages } from '../../shared/i18n';
import { isAgentId } from '../../shared/types';
import type { StatusQueryAction } from '../../shared/types/unified-ipc';
import { UnifiedChannel } from '../../shared/types/unified-ipc';
import type { MainContext } from '../main-context';
import { wrapCatalog } from '../main-context';
import { assertNonEmptyString, assertSafeThemeId } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

// ---------------------------------------------------------------------------
// Unified channel names (re-exported from shared/types/unified-ipc.ts)
// ---------------------------------------------------------------------------

export type { UnifiedChannelName } from '../../shared/types/unified-ipc';
export { UnifiedChannel } from '../../shared/types/unified-ipc';

// ---------------------------------------------------------------------------
// Per-action timeout budgets (ms)
// ---------------------------------------------------------------------------

const TIMEOUT_SYSTEM_STATUS = 15_000;
const TIMEOUT_AGENT_LIST = 15_000;
const TIMEOUT_THEME_LIST = 10_000;
const TIMEOUT_THEME_GET = 5_000;
const TIMEOUT_THEME_SEARCH = 10_000;
const TIMEOUT_THEME_FILTER = 10_000;
const TIMEOUT_WALLPAPER_LIST = 5_000;

// ---------------------------------------------------------------------------
// status:query handler
// ---------------------------------------------------------------------------

type StatusQueryHandler = (action: StatusQueryAction, ...args: unknown[]) => Promise<unknown>;

function createStatusQueryHandler(deps: MainContext): StatusQueryHandler {
  return async (action: StatusQueryAction, ...args: unknown[]) => {
    switch (action) {
      case 'system': {
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:system`,
          TIMEOUT_SYSTEM_STATUS,
          deps.core.status(),
        );
      }

      case 'agent-list': {
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:agent-list`,
          TIMEOUT_AGENT_LIST,
          (async () => {
            const items = deps.agentCatalog.listAgents();
            const sysStatus = await deps.core.status();
            const merged = items.map((item) => {
              if (!item.supported) return item;
              const appStatus = sysStatus.apps.find((a) => a.appId === item.id);
              return {
                ...item,
                status: {
                  installed: appStatus?.installed ?? false,
                  running: appStatus?.running ?? false,
                  debugReady: appStatus?.debugReady ?? false,
                },
              };
            });
            return wrapCatalog(merged);
          })(),
        );
      }

      case 'theme-list': {
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:theme-list`,
          TIMEOUT_THEME_LIST,
          (async () => wrapCatalog(await deps.themeCatalog.listThemes()))(),
        );
      }

      case 'theme-get': {
        const id = args[0];
        assertSafeThemeId(id);
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:theme-get`,
          TIMEOUT_THEME_GET,
          Promise.resolve(deps.themeCatalog.getTheme(id)),
        );
      }

      case 'theme-search': {
        const query = args[0];
        assertNonEmptyString(query, getMainMessages().invalidSearchQuery);
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:theme-search`,
          TIMEOUT_THEME_SEARCH,
          (async () => wrapCatalog(await deps.themeCatalog.searchThemes(query)))(),
        );
      }

      case 'theme-filter': {
        const agentId = args[0];
        if (!isAgentId(agentId)) {
          throw new Error(getMainMessages().invalidApplyRequest);
        }
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:theme-filter`,
          TIMEOUT_THEME_FILTER,
          (async () => wrapCatalog(await deps.themeCatalog.filterByAgent(agentId)))(),
        );
      }

      case 'wallpaper-list': {
        return withMonitoredTimeout(
          `${UnifiedChannel.STATUS_QUERY}:wallpaper-list`,
          TIMEOUT_WALLPAPER_LIST,
          Promise.resolve(deps.wallpapers?.list() ?? []),
        );
      }

      default: {
        // exhaustive check — if a new action is added without a case, TS errors here.
        const _exhaustive: never = action;
        throw new Error(`Unknown status:query action: ${String(_exhaustive)}`);
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Router registration
// ---------------------------------------------------------------------------

export interface UnifiedIpcRouterDeps {
  ctx: MainContext;
}

/**
 * Register the unified IPC router. Each domain gets exactly one `ipcMain.handle`
 * that dispatches on the `action` field.
 *
 * This function is IDEMPOTENT — calling it multiple times (e.g. HMR) replaces
 * handlers cleanly (ipcMain.handle overwrites by channel name).
 */
export function registerUnifiedIpcRouter(deps: UnifiedIpcRouterDeps): void {
  const { ctx } = deps;
  const statusQuery = createStatusQueryHandler(ctx);

  ipcMain.handle(
    UnifiedChannel.STATUS_QUERY,
    async (_event, action: StatusQueryAction, ...args) => {
      return statusQuery(action, ...args);
    },
  );
}

/**
 * Remove all unified IPC handlers. Used during teardown / flag-toggle.
 */
export function disposeUnifiedIpcRouter(): void {
  ipcMain.removeHandler(UnifiedChannel.STATUS_QUERY);
  // Future: remove other channels as they are added.
}
