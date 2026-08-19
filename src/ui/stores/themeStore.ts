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
import { APP_META } from '@/components/app-mark';
import { useDialogStore } from '@/stores/dialogStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useWallpaperStore } from '@/stores/wallpaperStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { AgentId, ThemeCatalogItem } from '@shared/types';
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
  const locale = useShellStore.getState().locale;
  return uiMessages[locale];
}

/**
 * Run an async operation under a per-agent busy guard (RFC 2026-08-19 R2).
 *
 * Concurrency model: **per-agent serial, cross-agent parallel**. Each agent
 * owns a promise chain (`agentChains`); apply/restore for the same agent are
 * queued onto that chain and run one at a time, while operations for
 * different agents run concurrently. Non-agent operations (import/export/
 * delete/bundle) share a single global chain (`globalChain`).
 *
 * The previous implementation used a global `busyKeys` Set with a
 * `MAX_CONCURRENCY` spin-wait (50ms polling, 60s cap) — that model (a) made
 * the busy key granularity `apply:${appId}:${themeId}`, so switching themes
 * on the same agent bypassed the guard; (b) burned CPU polling for a slot;
 * (c) let `restoreAll` (6 parallel restores) occupy every slot and starve
 * applies; (d) tracked busy as one scalar value, so a wallpaper-page apply
 * showed a spinner on the themes page. All four are eliminated by promise
 * chaining: no polling, per-agent slots, scalar busy replaced by a per-agent
 * map.
 *
 * The scalar `busy` state is retained for UI feedback but as a per-agent map
 * (`busy[appId]`) plus a global slot (`globalBusy`); the controller exposes
 * an aggregate "representative" key for the existing global-disable checks.
 */
const agentChains = new Map<AgentId, Promise<void>>();
let globalChain: Promise<void> = Promise.resolve();

function emptyAgentBusy(): Record<AgentId, BusyKey | null> {
  return Object.fromEntries(AGENT_IDS.map((id) => [id, null])) as Record<AgentId, BusyKey | null>;
}

/** Resolve the agent id from a busy key like `apply:traework` / `restore:traework`. */
function busyKeyAgent(key: BusyKey): AgentId | null {
  const idx = key.indexOf(':');
  if (idx === -1) return null;
  const rest = key.slice(idx + 1);
  return (AGENT_IDS as readonly string[]).includes(rest) ? (rest as AgentId) : null;
}

/**
 * Queue `fn` onto the per-agent chain. Runs one at a time per agent, agents
 * in parallel. Errors are routed to notification `fail` and returned as
 * `undefined` (same contract as the legacy `withBusy`).
 */
async function withAgentBusy<T>(
  appId: AgentId,
  key: BusyKey,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const prev = agentChains.get(appId) ?? Promise.resolve();
  const result = prev.then(() => {
    useThemeStore.getState()._setAgentBusy(appId, key);
    return fn();
  });
  // Keep the chain alive regardless of success/failure; the task's own
  // rejection is captured by the caller below.
  agentChains.set(
    appId,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  try {
    return await result;
  } catch (error) {
    useNotificationStore.getState().fail(error);
    return undefined;
  } finally {
    useThemeStore.getState()._setAgentBusy(appId, null);
  }
}

/**
 * Queue `fn` onto the global chain (import/export/delete/bundle). Serializes
 * against every other global operation; errors behave like `withAgentBusy`.
 */
async function withGlobalBusy<T>(key: BusyKey, fn: () => Promise<T>): Promise<T | undefined> {
  const prev = globalChain;
  const result = prev.then(() => {
    useThemeStore.getState()._setGlobalBusy(key);
    return fn();
  });
  globalChain = result.then(
    () => undefined,
    () => undefined,
  );
  try {
    return await result;
  } catch (error) {
    useNotificationStore.getState().fail(error);
    return undefined;
  } finally {
    useThemeStore.getState()._setGlobalBusy(null);
  }
}

/**
 * Dispatch a busy-keyed operation: agent-scoped keys (apply/restore) run on
 * the per-agent chain, everything else on the global chain. Backwards-compatible
 * entry point so call sites only need to fix their key granularity.
 */
async function withBusy<T>(key: BusyKey, fn: () => Promise<T>): Promise<T | undefined> {
  const appId = busyKeyAgent(key);
  return appId !== null ? withAgentBusy(appId, key, fn) : withGlobalBusy(key, fn);
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

/** Debounce timer for refreshThemes — coalesces rapid successive calls
 *  (e.g. IPC file-imported burst) into a single IPC round-trip. */
let refreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// --- IPC event cancelers ---
// Module-level so a re-run of create() (HMR) can detach the listeners that a
// PREVIOUS create() round registered. A per-create() local would always be
// null on re-run, leaking the old listeners (the prior `if (offFileImported)
// unsubscribe()` guard was therefore dead code).
let offFileImported: (() => void) | null = null;
let offFileImportConfirm: (() => void) | null = null;
let offFileImportFailed: (() => void) | null = null;
let offTrayApply: (() => void) | null = null;

// ---------------------------------------------------------------------------
// state shape
// ---------------------------------------------------------------------------

interface ThemeState {
  installed: ThemeCatalogItem[];
  loading: boolean;
  selection: Selection;
  /** Per-agent busy keys (spinner granularity). Non-null while an apply or
   *  restore for that agent is queued or running. */
  busy: Record<AgentId, BusyKey | null>;
  /** Global busy key (import/export/delete/bundle — non-agent operations). */
  globalBusy: BusyKey | null;

  // --- queries ---
  installedById: (id: string) => ThemeCatalogItem | undefined;
  setSelection: (sel: Selection) => void;
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
  // --- ipc cancelers (module-level; filled inside create, called by unsubscribe) ---

  // Idempotent: HMR / repeated create() should not accumulate listeners.
  // Detach any listeners a previous create() round registered (module-level
  // vars hold them) before new ones are attached below.
  function unsubscribe() {
    offFileImported?.();
    offFileImportConfirm?.();
    offFileImportFailed?.();
    offTrayApply?.();
    offFileImported = null;
    offFileImportConfirm = null;
    offFileImportFailed = null;
    offTrayApply = null;
  }

  // Clean up the previous create() round's listeners (no-op on first mount).
  // Cancelers are module-level, so after the first create() round this guard
  // is live (not dead code) and detaches the prior round's listeners.
  if (offFileImported) unsubscribe();

  // Wire IPC subscriptions at module load — mirrors useThemes' boot effect.
  // `get()` is safe to call here; zustand closures capture bound selectors.
  offFileImported = api.onFileImported(async (result) => {
    await get().refreshThemes();
    useNotificationStore.getState().showToast(currentT().importedTheme(result.theme.displayName));
  });
  offFileImportConfirm = api.onFileImportConfirm(useDialogStore.getState().setFileImportPrompt);
  offFileImportFailed = api.onFileImportFailed((message) => {
    useNotificationStore.getState().showToast(message || currentT().actionFailed, 'destructive');
  });
  offTrayApply = api.onTrayApply((request) => {
    void get().applyToApp(request.themeId, request.themeName, request.appId);
  });

  return {
    installed: [],
    loading: true,
    selection: null,
    busy: emptyAgentBusy(),
    globalBusy: null,

    installedById: (id) => get().installed.find((theme) => theme.id === id),
    setSelection: (selection) => set({ selection }),
    _setAgentBusy: (appId, key) => set((current) => ({ busy: { ...current.busy, [appId]: key } })),
    _setGlobalBusy: (key) => set({ globalBusy: key }),

    refreshThemes: () => {
      // Debounce: coalesce rapid successive calls (e.g. IPC file-imported
      // burst) into a single IPC round-trip. 100ms is imperceptible to users.
      return new Promise<void>((resolve) => {
        if (refreshDebounceTimer !== null) clearTimeout(refreshDebounceTimer);
        refreshDebounceTimer = setTimeout(async () => {
          refreshDebounceTimer = null;
          try {
            set({ installed: (await api.catalog.themes.list()).items });
          } catch (error) {
            useNotificationStore.getState().fail(error);
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

      const result = await withBusy(`apply:${appId}`, async () => {
        // Two-phase CDP discovery: first attempt probes only (no restart).
        return api.applyTheme({
          themeId,
          appId,
          restartExisting: options.restartExisting,
          schemeId: options.schemeId,
        });
      });

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
          // Single-Injector (RFC 2026-08-19 R1): the theme's bundled wallpaper
          // is injected by the main-process apply flow's background chain
          // (theme-apply-flow.ts → injectAgentWallpaperFromApply), which also
          // persists the per-agent wallpaper setting. The renderer must NOT
          // re-inject — a second CDP injection here caused a race with the
          // background chain (P0-1 triple injection).
          return true;
        }
        case 'unknown-status':
          // Unknown status from main process — treat as transient failure.
          useNotificationStore
            .getState()
            .showToast(t.themeApplyUnexpectedStatus(outcome.status), 'destructive');
          return false;
        case 'skipped-concurrent':
          // RFC §4.10: a concurrent apply is already in-flight — benign no-op.
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
      const result = await withBusy(`restore:${appId}`, () => api.restoreApp(appId));
      if (!result) return;
      // Response-as-Truth (R3): restore returns the authoritative SystemStatus.
      useStatusStore.getState().setStatus(result);
      const appName =
        result.apps.find((a) => a.appId === appId)?.displayName ?? APP_META[appId]?.name ?? appId;
      useNotificationStore.getState().showToast(t.nativeRestored(appName));
      // Symmetry with applyToApp: deactivate the per-agent wallpaper that
      // was activated alongside the theme. Without this, restoring the
      // theme leaves the wallpaper injected — a visual inconsistency.
      void useWallpaperStore
        .getState()
        .setAgentWallpaper(appId, false, null)
        .catch(() => undefined);
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
          const result = await withBusy(`restore:${app.appId}`, () => api.restoreApp(app.appId));
          // withBusy returns undefined on: thrown error (logged via fail),
          // same-key collision, or concurrency cap.
          return { ok: result !== undefined, status: result };
        }),
      );
      const okCount = settled.filter((r) => r.ok).length;
      const failCount = settled.length - okCount;
      // Response-as-Truth (R3): the last-settled restore's snapshot is the
      // final system state — every restore has resolved by this point, so no
      // extra refreshStatus() round-trip is needed.
      for (const entry of settled) {
        if (entry.status) useStatusStore.getState().setStatus(entry.status);
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
        const result = await withBusy('import', () => api.importThemeFromPath(targetPath));
        if (!result) return;
        get().refreshThemes();
        useNotificationStore.getState().showToast(t.importedTheme(result.theme.displayName));
      });
      if (!didAcquire) {
        // Another store is already importing this same path — refresh the
        // catalog in case the other side finished before we checked, but
        // skip the IPC and the toast to avoid duplicate entries / alerts.
        void get().refreshThemes();
      }
    },

    dropThemeFiles: (files) => {
      for (const file of files) {
        if (!/\.(agenttheme|agentskin-theme|codex-theme)$/.test(file.name)) continue;
        const path = api.getPathForFile(file);
        if (path) void api.openThemeFile(path).catch(useNotificationStore.getState().fail);
      }
    },

    exportTheme: async (themeId) => {
      const t = currentT();
      const result = await withBusy(`export:${themeId}`, () => api.exportTheme(themeId));
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.packageExported);
    },

    createBundle: async (themeId) => {
      const t = currentT();
      const result = await withBusy(`bundle:${themeId}`, () => api.createBundle(themeId));
      if (result && !result.canceled) useNotificationStore.getState().showToast(t.bundleExported);
    },

    confirmDelete: async () => {
      const { deletePrompt, setDeletePrompt } = useDialogStore.getState();
      const t = currentT();
      if (!deletePrompt) return;
      const theme = deletePrompt;
      // Capture affected apps BEFORE delete: agents that have this theme active
      // will need wallpaper deactivated after the CDP restore.
      const affectedApps =
        useStatusStore
          .getState()
          .status?.apps.filter((app) => app.activeThemeId === theme.id)
          .map((app) => app.appId) ?? [];
      // A-5: warn if the theme is currently applied to any agent. The user
      // should know that deleting will restore those agents to native UI.
      if (affectedApps.length > 0) {
        useNotificationStore
          .getState()
          .showToast(
            t.themeDeleteWarning?.(affectedApps.join(', ')) ??
              `Theme "${theme.name}" is active on ${affectedApps.length} agent(s); deleting will restore native UI.`,
            'destructive',
          );
      }
      const result = await withBusy(`delete:${theme.id}`, () => api.deleteTheme(theme.id));
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
      // WP-1 + R4 (RFC 2026-08-19): the deleteTheme IPC channel already
      // restores the CDP shell for every agent running this theme
      // (theme-ipc.ts THEME_DELETE → core.restore per affected app). The
      // renderer must NOT issue a second restoreApp here (P0-3 double
      // restore). The per-agent wallpaper preference is NOT handled by the
      // main-process delete, so we clear it explicitly — the wallpapers
      // themselves are torn down by the delete's restore flow.
      for (const appId of affectedApps) {
        try {
          await useWallpaperStore.getState().setAgentWallpaper(appId, false, null);
        } catch {
          /* Wallpaper restore failure must not block the delete flow */
        }
      }
    },
  };
});
