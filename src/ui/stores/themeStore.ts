// SPDX-License-Identifier: MPL-2.0

/**
 * # themeStore
 *
 * Manages the installed-themes lifecycle: catalog fetching, search, selection,
 * apply/restore, import (file-open + drag-drop), delete, and export.
 *
 * Extracted from `useThemes` (Phase A3). Cross-store dependencies
 * (notificationStore, statusStore, dialogStore, wallpaperStore) are accessed
 * via `getState()` so no React-level prop threading is required.
 *
 * ## IPC events wired at boot
 *
 * The store subscribes to agentSkin IPC events inside `create()` so that
 * file-open, tray-apply, and file-import-confirm events are captured once at
 * module lifecycle — not per-component-mount. Cancellation functions are
 * stashed and returned from `unsubscribe()` for app shutdown.
 */

import { api } from '@/api/agentSkinClient';
import { APP_META } from '@/components/AppMark';
import { useDialogStore } from '@/stores/dialogStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStatusStore } from '@/stores/statusStore';
import { wallpaperHandlers } from '@/stores/wallpaper-handler-registry';
import { useWallpaperStore } from '@/stores/wallpaperStore';

import { notifyError } from '@shared/errors/notify';
import type { UiMessages } from '@shared/i18n';
import { getCurrentT } from '@shared/i18n/runtime-t';
import type { AgentId, DesignLanguageConfig, ThemeCatalogItem } from '@shared/types';
import { AGENT_IDS } from '@shared/types';
import { create } from 'zustand';
import { handleApplyResult } from '../hooks/apply-result';
import type { RestartPrompt } from './dialogStore';
import { withImportLock } from './import-guard';

export type Selection = { kind: 'installed'; theme: ThemeCatalogItem } | null;

/**
 * Discriminated busy-state key. Replaces the loose `string | null` so the
 * literal `'import'` check in the UI is type-safe.
 */
export type BusyKey =
  | 'import'
  | `apply:${string}`
  | `restore:${string}`
  | `delete:${string}`
  | `export:${string}`
  | `bundle:${string}`;

/** Build the i18n dictionary for the current locale. */
function currentT(): UiMessages {
  // RC-6: Delegates to the shared accessor (single source of truth).
  return getCurrentT();
}

/**
 * Safely read a possibly-optional i18n key. The typed `UiMessages` only
 * includes keys present in ALL locales; optional per-locale keys (e.g.
 * `themeSchemeSwitched`) require this accessor instead of a bare `as unknown`
 * cast at every call site.
 */
function getMessageSafe(msgs: UiMessages, key: string): unknown {
  return (msgs as Record<string, unknown>)[key];
}

/** Call `fn` with `arg` only if `fn` is a function; otherwise return undefined. */
function callIfFn<T>(fn: unknown, arg: T): string | undefined {
  return typeof fn === 'function' ? (fn as (arg: T) => string)(arg) : undefined;
}

// ---------------------------------------------------------------------------
// ChainController — encapsulates module-level promise-chain state (P0-1 fix)
// ---------------------------------------------------------------------------

/**
 * ## ChainController
 *
 * Owns the per-agent and global promise chains used by `withAgentBusy` and
 * `withGlobalBusy`. Previously these were bare module-level `Map` + `let`
 * bindings that leaked across test runs and HMR rounds.
 *
 * Concurrency model: **per-agent serial, cross-agent parallel**. Each agent
 * owns a promise chain; apply/restore for the same agent are queued onto that
 * chain and run one at a time, while operations for different agents run
 * concurrently. Non-agent operations (import/export/delete/bundle) share a
 * single global chain.
 */
class ChainController {
  private readonly agentChains = new Map<AgentId, Promise<void>>();
  private globalChain: Promise<void> = Promise.resolve();

  /**
   * Queue `fn` onto the per-agent chain. Runs one at a time per agent, agents
   * in parallel. Errors are routed to notification `fail` and swallowed here
   * (same contract as the legacy `withBusy`).
   */
  async withAgent<T>(
    appId: AgentId,
    key: BusyKey,
    fn: () => Promise<T>,
    setBusy: (appId: AgentId, key: BusyKey | null) => void,
  ): Promise<T | undefined> {
    const prev = this.agentChains.get(appId) ?? Promise.resolve();
    const result = prev.then(() => {
      setBusy(appId, key);
      return fn();
    });
    // Keep the chain alive regardless of success/failure.
    this.agentChains.set(
      appId,
      result.then(
        () => undefined,
        () => undefined,
      ),
    );
    try {
      return await result;
    } catch (error) {
      notifyError(error);
      return undefined;
    } finally {
      setBusy(appId, null);
    }
  }

  /**
   * Queue `fn` onto the global chain (import/export/delete/bundle). Serializes
   * against every other global operation.
   */
  async withGlobal<T>(
    key: BusyKey,
    fn: () => Promise<T>,
    setBusy: (key: BusyKey | null) => void,
  ): Promise<T | undefined> {
    const prev = this.globalChain;
    const result = prev.then(() => {
      setBusy(key);
      return fn();
    });
    this.globalChain = result.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await result;
    } catch (error) {
      notifyError(error);
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  /** Reset all chains — for test isolation. */
  reset(): void {
    this.agentChains.clear();
    this.globalChain = Promise.resolve();
  }

  /** Current size of agentChains — used by diagnostics. */
  get agentChainSize(): number {
    return this.agentChains.size;
  }
}

/** Singleton chain controller — shared across all store actions. */
const chainController = new ChainController();

function emptyAgentBusy(): Record<AgentId, BusyKey | null> {
  return AGENT_IDS.reduce(
    (acc, id) => {
      acc[id] = null;
      return acc;
    },
    {} as Record<AgentId, BusyKey | null>,
  );
}

/** Resolve the agent id from a busy key like `apply:traework` / `restore:traework`. */
function busyKeyAgent(key: BusyKey): AgentId | null {
  const idx = key.indexOf(':');
  if (idx === -1) return null;
  const rest = key.slice(idx + 1);
  return (AGENT_IDS as readonly string[]).includes(rest) ? (rest as AgentId) : null;
}

/**
 * Dispatch a busy-keyed operation: agent-scoped keys (apply/restore) run on
 * the per-agent chain, everything else on the global chain.
 */
async function withBusy<T>(
  key: BusyKey,
  fn: () => Promise<T>,
  setAgentBusy: (appId: AgentId, key: BusyKey | null) => void,
  setGlobalBusy: (key: BusyKey | null) => void,
): Promise<T | undefined> {
  const appId = busyKeyAgent(key);
  return appId !== null
    ? chainController.withAgent(appId, key, fn, setAgentBusy)
    : chainController.withGlobal(key, fn, setGlobalBusy);
}

/** Aggregate representative busy key — drives the controller's global-disable
 *  checks (`busy !== null`, `startsWith('apply:')`, etc.). Prefers the global
 *  slot, then the first active per-agent slot. */
export function aggregateBusyKey(
  busy: Record<AgentId, BusyKey | null>,
  globalBusy: BusyKey | null,
): BusyKey | null {
  if (globalBusy !== null) return globalBusy;
  for (const appId of AGENT_IDS) {
    const key = busy[appId];
    if (key !== null) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ThemeModuleState — debounce timer + IPC cancelers (P0-1 fix)
// ---------------------------------------------------------------------------

/**
 * ## ThemeModuleState
 *
 * Owns the module-level debounce timer and IPC event canceler handles.
 * Previously these were bare `let` bindings scattered across the module.
 */
class ThemeModuleState {
  refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  offFileImported: (() => void) | null = null;
  offFileImportConfirm: (() => void) | null = null;
  offFileImportFailed: (() => void) | null = null;
  offTrayApply: (() => void) | null = null;
  offThemeHotReload: (() => void) | null = null;

  /** Detach all registered IPC listeners (idempotent). */
  detachAllListeners(): void {
    this.offFileImported?.();
    this.offFileImportConfirm?.();
    this.offFileImportFailed?.();
    this.offTrayApply?.();
    this.offThemeHotReload?.();
    this.offFileImported = null;
    this.offFileImportConfirm = null;
    this.offFileImportFailed = null;
    this.offTrayApply = null;
    this.offThemeHotReload = null;
  }

  /** Clear the debounce timer if pending. */
  clearDebounce(): void {
    if (this.refreshDebounceTimer !== null) {
      clearTimeout(this.refreshDebounceTimer);
      this.refreshDebounceTimer = null;
    }
  }

  /** Reset everything — for test isolation. */
  reset(): void {
    this.clearDebounce();
    this.detachAllListeners();
  }
}

const moduleState = new ThemeModuleState();

// ---------------------------------------------------------------------------
// state shape
// ---------------------------------------------------------------------------

export interface ThemeState {
  installed: ThemeCatalogItem[];
  loading: boolean;
  selection: Selection;
  /** Per-agent busy keys (spinner granularity). Non-null while an apply or
   *  restore for that agent is queued or running. */
  busy: Record<AgentId, BusyKey | null>;
  /** Global busy key (import/export/delete/bundle — non-agent operations). */
  globalBusy: BusyKey | null;
  /** Design Language inline config (v2.6+). Drives Studio UI + generated CSS. */
  designLanguage: DesignLanguageConfig;

  // --- queries ---
  installedById: (id: string) => ThemeCatalogItem | undefined;
  setSelection: (sel: Selection) => void;
  /** Update Design Language config (partial merge). */
  setDesignLanguage: (dl: Partial<DesignLanguageConfig>) => void;
  /** Internal per-agent busy setter — used by withAgentBusy so busy writes
   *  stay inside the store action boundary instead of calling setState directly. */
  _setAgentBusy: (appId: AgentId, key: BusyKey | null) => void;
  /** Internal global busy setter — used by withGlobalBusy. */
  _setGlobalBusy: (key: BusyKey | null) => void;

  // --- lifecycle ---
  /** Fetch themes from IPC; reports failures via notificationStore. */
  refreshThemes: () => Promise<void>;
  /** Wire IPC events (file-open, file-import-confirm, tray-apply). */
  unsubscribe: () => void;

  // --- mutations ---
  applyToApp: (
    themeId: string,
    themeName: string,
    appId: AgentId,
    options?: { restartExisting?: boolean; schemeId?: string },
  ) => Promise<boolean>;
  restoreApp: (appId: AgentId) => Promise<void>;
  restoreAll: () => Promise<void>;
  exportTheme: (themeId: string) => Promise<void>;
  createBundle: (themeId: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  confirmFileImport: () => Promise<void>;
  dropThemeFiles: (files: File[]) => void;
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export const useThemeStore = create<ThemeState>((set, get) => {
  // --- ipc cancelers (owned by moduleState; filled inside create, called by unsubscribe) ---

  function unsubscribe() {
    moduleState.detachAllListeners();
  }

  // Idempotent: HMR / repeated create() should not accumulate listeners.
  // Detach any listeners a previous create() round registered (module-level
  // vars hold them) before new ones are attached below.
  moduleState.detachAllListeners();

  // Wire IPC subscriptions at module load — mirrors useThemes' boot effect.
  // `get()` is safe to call here; zustand closures capture bound selectors.
  moduleState.offFileImported = api.onFileImported(async (result) => {
    await get().refreshThemes();
    useNotificationStore.getState().showToast(currentT().importedTheme(result.theme.displayName));
  });
  // RC: Use lazy lookup instead of capturing at module-load time.
  // On HMR, dialogStore may re-create its actions, making a direct
  // capture stale. The lazy wrapper always reads the latest reference.
  moduleState.offFileImportConfirm = api.onFileImportConfirm((...args) =>
    useDialogStore.getState().setFileImportPrompt(...args),
  );
  moduleState.offFileImportFailed = api.onFileImportFailed((message) => {
    useNotificationStore.getState().showToast(message || currentT().actionFailed, 'destructive');
  });
  moduleState.offTrayApply = api.onTrayApply((request) => {
    void get().applyToApp(request.themeId, request.themeName, request.appId);
  });
  moduleState.offThemeHotReload = api.onThemeHotReload((payload) => {
    // P1: Theme hot-reload notification from the main process. The CSS has
    // already been injected into the target agent via CDP; this handler only
    // updates the UI to reflect the new state.
    if (payload.reloadKind === 'scheme-switch') {
      // RC-3: Safe property access — themeSchemeSwitched is an optional
      // i18n key not present in all locales. Use a bounded accessor
      // instead of `as unknown as Record<string, unknown>`.
      const message = callIfFn(
        getMessageSafe(currentT(), 'themeSchemeSwitched' as never),
        payload.mode,
      );
      useNotificationStore.getState().showToast(message ?? `已切换到${payload.mode}模式`);
    }
    // StatusChanged will also fire from the main process, so we don't need
    // to call refreshThemes here — the apply flow already updated the state.
    // However, we ensure a status refresh so the UI reflects the new mode.
    void useStatusStore.getState().refreshStatus?.();
  });

  return {
    installed: [],
    loading: true,
    selection: null,
    busy: emptyAgentBusy(),
    globalBusy: null,
    designLanguage: {},

    installedById: (id) => get().installed.find((theme) => theme.id === id),
    setSelection: (selection) => set({ selection }),
    setDesignLanguage: (dl) => set((s) => ({ designLanguage: { ...s.designLanguage, ...dl } })),
    _setAgentBusy: (appId, key) => set((current) => ({ busy: { ...current.busy, [appId]: key } })),
    _setGlobalBusy: (key) => set({ globalBusy: key }),

    refreshThemes: () => {
      // Debounce: coalesce rapid successive calls (e.g. IPC file-imported
      // burst) into a single IPC round-trip. 100ms is imperceptible to users.
      return new Promise<void>((resolve) => {
        if (moduleState.refreshDebounceTimer !== null)
          clearTimeout(moduleState.refreshDebounceTimer);
        moduleState.refreshDebounceTimer = setTimeout(async () => {
          moduleState.refreshDebounceTimer = null;
          try {
            set({ installed: (await api.catalog.themes.list()).items });
          } catch (error) {
            // RC-2: Centralized notification.
            notifyError(error);
          } finally {
            resolve();
          }
        }, 100);
      });
    },

    unsubscribe,

    applyToApp: async (themeId, themeName, appId, options = {}) => {
      const { setRestartPrompt } = useDialogStore.getState();
      const t = currentT();

      const result = await withBusy(
        `apply:${appId}`,
        async () => {
          // Two-phase CDP discovery: first attempt probes only (no restart).
          return api.applyTheme({
            themeId,
            appId,
            restartExisting: options.restartExisting,
            schemeId: options.schemeId,
          });
        },
        (a, k) => get()._setAgentBusy(a, k),
        (k) => get()._setGlobalBusy(k),
      );

      if (!result) return false;

      // Response-as-Truth (RFC 2026-08-19 R3): the main process returns the
      // authoritative post-operation snapshot in `result.system`, so we adopt
      // it directly instead of issuing a second refreshStatus() round-trip.
      // Per-agent serialization (withAgentBusy) guarantees a later snapshot
      // includes earlier operations' effects; cross-agent staleness is bounded
      // by each response being captured at its own completion time.
      useStatusStore.getState().setStatus(result.system);

      const outcome = handleApplyResult(result, { themeId, themeName, appId });
      switch (outcome.kind) {
        case 'requires-restart':
          setRestartPrompt({
            themeId,
            themeName,
            appId,
            schemeId: options.schemeId,
            restartReason: outcome.restartReason,
          } satisfies RestartPrompt);
          return false;
        case 'port-occupied':
          useNotificationStore.getState().showToast(outcome.message, 'destructive');
          return false;
        case 'success': {
          useNotificationStore.getState().showToast(t.themeApplied(themeName));
          return true;
        }
        case 'unknown-status':
          useNotificationStore
            .getState()
            .showToast(t.themeApplyUnexpectedStatus(outcome.status), 'destructive');
          return false;
        case 'skipped-concurrent':
          return true;
      }
      // Exhaustiveness fallback — handleApplyResult returns all kinds above,
      // but TS control flow across await boundaries needs this. If a new
      // outcome kind is added without a branch, this logs instead of silently
      // returning a value that TS would have masked behind `as never`.
      console.error(
        `[themeStore] applyToApp: unhandled outcome kind: ${(outcome as { kind?: unknown }).kind}`,
      );
      return false;
    },

    restoreApp: async (appId) => {
      const t = currentT();
      const result = await withBusy(
        `restore:${appId}`,
        () => api.restoreApp(appId),
        (a, k) => get()._setAgentBusy(a, k),
        (k) => get()._setGlobalBusy(k),
      );
      if (!result) return;
      // Response-as-Truth (R3): restore returns the authoritative SystemStatus.
      useStatusStore.getState().setStatus(result);
      const appName =
        result.apps.find((a) => a.appId === appId)?.displayName ?? APP_META[appId]?.name ?? appId;
      useNotificationStore.getState().showToast(t.nativeRestored(appName));
      // Symmetry with applyToApp: deactivate the per-agent wallpaper that
      // was activated alongside the theme. Without this, restoring the
      // theme leaves the wallpaper injected — a visual inconsistency.
      // RC-1: callback injection — no longer calls useWallpaperStore directly.
      for (const h of wallpaperHandlers) {
        try {
          h(appId, true, null);
        } catch (error) {
          console.warn('[themeStore] wallpaper handler failed for', appId, error);
        }
      }
    },

    restoreAll: async () => {
      const t = currentT();
      const status = useStatusStore.getState().status;
      const apps = status?.apps ?? [];
      const targets = apps.filter((app) => app.activeThemeId);
      if (targets.length === 0) {
        useNotificationStore.getState().showToast(t.restoreAllNothing);
        return;
      }
      const settled = await Promise.all(
        targets.map(async (app) => {
          const result = await withBusy(
            `restore:${app.appId}`,
            () => api.restoreApp(app.appId),
            (a, k) => get()._setAgentBusy(a, k),
            (k) => get()._setGlobalBusy(k),
          );
          return { ok: result !== undefined, status: result };
        }),
      );
      const okCount = settled.filter((r) => r.ok).length;
      const failCount = settled.length - okCount;
      // RC4-A fix: aggregate N setStatus calls into one with the last successful snapshot.
      if (okCount > 0) {
        const lastOkEntry = [...settled].reverse().find((r) => r.ok);
        if (lastOkEntry?.status) {
          useStatusStore.getState().setStatus(lastOkEntry.status);
        }
      }
      if (failCount === 0) {
        useNotificationStore.getState().showToast(t.restoreAllDone(okCount));
      } else if (okCount === 0) {
        useNotificationStore.getState().showToast(t.restoreAllFailed, 'destructive');
      } else {
        useNotificationStore
          .getState()
          .showToast(t.restoreAllPartial(okCount, failCount), 'destructive');
      }
    },

    confirmFileImport: async () => {
      const { fileImportPrompt, setFileImportPrompt } = useDialogStore.getState();
      const t = currentT();
      if (!fileImportPrompt) return;
      const targetPath = fileImportPrompt.path;
      setFileImportPrompt(null);
      const didAcquire = await withImportLock(targetPath, async () => {
        const result = await withBusy(
          'import',
          () => api.importThemeFromPath(targetPath),
          (a, k) => get()._setAgentBusy(a, k),
          (k) => get()._setGlobalBusy(k),
        );
        if (!result) return;
        get().refreshThemes();
        // REQ-I-009: Refresh wallpaper list — imported theme may bundle wallpapers.
        void useWallpaperStore.getState().initialize();
        useNotificationStore.getState().showToast(t.importedTheme(result.theme.displayName));
      });
      if (!didAcquire) {
        void get().refreshThemes();
      }
    },

    dropThemeFiles: (files) => {
      for (const file of files) {
        if (!/\.(agenttheme|agentskin-theme|codex-theme)$/.test(file.name)) continue;
        const path = api.getPathForFile(file);
        if (path) void api.openThemeFile(path).catch(notifyError);
      }
    },

    exportTheme: async (themeId) => {
      const t = currentT();
      const result = await withBusy(
        `export:${themeId}`,
        () => api.exportTheme(themeId),
        (a, k) => get()._setAgentBusy(a, k),
        (k) => get()._setGlobalBusy(k),
      );
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.packageExported);
    },

    createBundle: async (themeId) => {
      const t = currentT();
      const result = await withBusy(
        `bundle:${themeId}`,
        () => api.createBundle(themeId),
        (a, k) => get()._setAgentBusy(a, k),
        (k) => get()._setGlobalBusy(k),
      );
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.bundleExported);
    },

    confirmDelete: async () => {
      const { deletePrompt, setDeletePrompt } = useDialogStore.getState();
      const t = currentT();
      if (!deletePrompt) return;
      const theme = deletePrompt;
      const affectedApps =
        useStatusStore
          .getState()
          .status?.apps.filter((app) => app.activeThemeId === theme.id)
          .map((app) => app.appId) ?? [];
      if (affectedApps.length > 0) {
        useNotificationStore
          .getState()
          .showToast(
            t.themeDeleteWarning?.(affectedApps.join(', ')) ??
              `Theme "${theme.name}" is active on ${affectedApps.length} agent(s); deleting will restore native UI.`,
            'destructive',
          );
      }
      const result = await withBusy(
        `delete:${theme.id}`,
        () => api.deleteTheme(theme.id),
        (a, k) => get()._setAgentBusy(a, k),
        (k) => get()._setGlobalBusy(k),
      );
      setDeletePrompt(null);
      if (!result) return;
      await get().refreshThemes();
      useStatusStore.getState().setStatus(result.status);
      set((current) =>
        current.selection?.kind === 'installed' && current.selection.theme.id === theme.id
          ? { selection: null }
          : {},
      );
      useNotificationStore.getState().showToast(t.themeDeleted(theme.name));
      // REQ-I-010: Clean up environment presets referencing the deleted theme.
      useEnvironmentStore.getState().purgeTheme(theme.id);
      for (const appId of affectedApps) {
        for (const h of wallpaperHandlers) {
          try {
            h(appId, true, null);
          } catch (error) {
            console.warn('[themeStore] wallpaper handler failed for', appId, error);
          }
        }
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Test helpers — reset module-level state for test isolation
// ---------------------------------------------------------------------------

/**
 * Reset all module-level mutable state owned by this module.
 * Call this in test `beforeEach` to prevent state leakage across tests.
 */
export function resetThemeModuleState(): void {
  chainController.reset();
  moduleState.reset();
}
