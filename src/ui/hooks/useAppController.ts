// SPDX-License-Identifier: MPL-2.0

/**
 * # useAppController
 *
 * Pure composition layer that aggregates all zustand stores into a single
 * object (the "controller") consumed by pages and global chrome components.
 *
 * After Phase A3 this hook owns NO domain state — every piece of state lives
 * in its own store (`themeStore`, `wallpaperStore`, `dialogStore`, ...). This
 * hook's remaining responsibilities are:
 *
 *   1. Wire boot-time side effects (log subscription, status polling, theme /
 *      wallpaper / agent catalog refresh) — these need access to the `api`
 *      singleton so they stay here rather than inside any one store.
 *   2. Wire cross-cutting IPC subscribers (boot:warnings → toast) that span
 *      multiple stores.
 *   3. Wire global keyboard shortcuts (Ctrl+\ sidebar, Ctrl+D inject dock).
 *   4. Subscribe to each store's slices and re-expose them under the legacy
 *      field names so 13 downstream components need zero changes.
 *
 * The returned shape is intentionally unchanged from pre-A3 — see the
 * `AppController` type. Fields are grouped by their owning store.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { api } from '@/api/agentSkinClient';
import { appStatusFor, useAgentStore } from '@/stores/agentStore';
import { useAppsStore } from '@/stores/appsStore';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';
import { useDialogStore } from '@/stores/dialogStore';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { selectInstallFlags, useInstallFlowStore } from '@/stores/installFlowStore';
import { useNotificationStore } from '@/stores/notificationStore';
import { useSecondaryInjectStore } from '@/stores/secondaryInjectStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { aggregateBusyKey, useThemeStore } from '@/stores/themeStore';
import { selectActiveWallpaper, useWallpaperStore } from '@/stores/wallpaperStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { AGENT_META, type AgentId } from '@shared/types';
import { useShallow } from 'zustand/react/shallow';
import { useBoot } from './useBoot';
import { type StructuredEvent, useBootProgress } from './useBootProgress';

export type { AgentProgress, BootPhase, ProgressMap } from '@/stores/bootProgressStore';
export type { RestartPrompt } from '@/stores/dialogStore';
export type {
  InstallFlowState,
  InstallStep,
} from '@/stores/installFlowStore';
export type { Toast } from '@/stores/notificationStore';
export type { SettingsSection } from '@/stores/settingsStore';
export type {
  BusyKey,
  Selection,
} from '@/stores/themeStore';
export type { Route } from '@/types/navigation';

export function useAppController() {
  // -----------------------------------------------------------------------
  // Shell slice — app frame state
  // -----------------------------------------------------------------------
  const locale = useShellStore((s) => s.locale);
  const appVersion = useShellStore((s) => s.appVersion);
  const route = useShellStore((s) => s.route);
  const activeAgentId = useShellStore((s) => s.activeAgentId);
  const logs = useShellStore((s) => s.logs);
  const injectDockOpen = useShellStore((s) => s.injectDockOpen);
  const setAppVersion = useShellStore((s) => s.setAppVersion);
  const setBooting = useShellStore((s) => s.setBooting);
  const setLocaleState = useShellStore((s) => s.setLocale);
  const setLogs = useShellStore((s) => s.setLogs);
  const setInjectDockOpen = useShellStore((s) => s.setInjectDockOpen);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const toggleInjectDock = useShellStore((s) => s.toggleInjectDock);

  // -----------------------------------------------------------------------
  // Install dock — Ctrl/Cmd+\ shortcut
  // -----------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '\\') return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      toggleSidebar();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleSidebar]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd') return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      toggleInjectDock();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleInjectDock]);

  // -----------------------------------------------------------------------
  // i18n — derived from locale so reference identity is stable per language
  // -----------------------------------------------------------------------
  const t: UiMessages = uiMessages[locale];

  // -----------------------------------------------------------------------
  // Notifications
  // -----------------------------------------------------------------------
  const controllerToasts = useNotificationStore((s) => s.toasts);
  const showToast = useNotificationStore((s) => s.showToast);
  const fail = useNotificationStore((s) => s.fail);

  // -----------------------------------------------------------------------
  // Status slice
  // -----------------------------------------------------------------------
  const status = useStatusStore((s) => s.status);
  const lastStatusAt = useStatusStore((s) => s.lastStatusAt);
  const isRefreshing = useStatusStore((s) => s.isRefreshing);
  const refreshStatus = useStatusStore((s) => s.refreshStatus);

  const setLocale = useCallback(
    async (next: typeof locale) => {
      try {
        await api.setLocale(next);
        setLocaleState(next);
      } catch {
        /* toast handled by caller — locale state stays unchanged on failure */
      }
    },
    [setLocaleState],
  );

  const setRoute = useShellStore((s) => s.setRoute);

  // RC5-1: Subscribe forceRestartLaunch reactively to avoid getState() during render.
  const forceRestartLaunch = useAppsStore((s) => s.forceRestartLaunch);

  // -----------------------------------------------------------------------
  // Status slice
  // -----------------------------------------------------------------------

  // -----------------------------------------------------------------------
  // Dialog prompt slice
  // -----------------------------------------------------------------------
  const restartPrompt = useDialogStore((s) => s.restartPrompt);
  const wallpaperRestartPrompt = useDialogStore((s) => s.wallpaperRestartPrompt);
  const launchRestartPrompt = useDialogStore((s) => s.launchRestartPrompt);
  const deletePrompt = useDialogStore((s) => s.deletePrompt);
  const fileImportPrompt = useDialogStore((s) => s.fileImportPrompt);
  const restoreAllPrompt = useDialogStore((s) => s.restoreAllPrompt);
  const setDeletePrompt = useDialogStore((s) => s.setDeletePrompt);
  const setFileImportPrompt = useDialogStore((s) => s.setFileImportPrompt);
  const setRestartPrompt = useDialogStore((s) => s.setRestartPrompt);
  const setLaunchRestartPrompt = useDialogStore((s) => s.setLaunchRestartPrompt);
  const setRestoreAllPrompt = useDialogStore((s) => s.setRestoreAllPrompt);

  // -----------------------------------------------------------------------
  // Agent slice
  // -----------------------------------------------------------------------
  const agents = useAgentStore((s) => s.agents);

  // -----------------------------------------------------------------------
  // Boot warnings — surface degraded boot steps as a toast once ready.
  // Uses a ref for locale so re-subscribing isn't needed on language switch.
  // -----------------------------------------------------------------------
  const bootWarningTRef = useRef(t);
  useEffect(() => {
    bootWarningTRef.current = t;
  }, [t]);
  useEffect(() => {
    const off = api.onBootWarnings((warnings) => {
      if (!warnings || warnings.length === 0) return;
      showToast(bootWarningTRef.current.bootWarningToast(warnings.length), 'destructive');
    });
    return off;
  }, [showToast]);

  // -----------------------------------------------------------------------
  // Boot orchestration (log subscription, status polling)
  // -----------------------------------------------------------------------
  useBoot({
    fail,
    setLocaleState,
    setAppVersion,
    setBooting,
    setLogs,
    refreshStatus,
  });

  // -----------------------------------------------------------------------
  // Boot progress — per-agent phase map + lifecycle toasts
  // -----------------------------------------------------------------------
  // RC5-2: Use refs for t and showToast so onBootEvent has a stable identity
  // across renders, preventing re-subscription in useBootProgress.
  const tRef = useRef(t);
  tRef.current = t;
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const onBootEvent = useCallback((event: StructuredEvent) => {
    const displayName = (id: string): string => AGENT_META[id as AgentId]?.displayName ?? id;
    switch (event.type) {
      case 'boot_start':
        if (event.agentCount && event.agentCount > 0) {
          showToastRef.current(tRef.current.bootRestoringToast(event.agentCount));
        }
        break;
      case 'boot_agent_done':
        showToastRef.current(tRef.current.bootAgentRestoredToast(displayName(event.agentId)));
        break;
      case 'boot_agent_failed':
        showToastRef.current(
          tRef.current.bootAgentFailedToast(displayName(event.agentId)),
          'destructive',
        );
        break;
    }
  }, []);
  const bootProgress = useBootProgress(api.onRuntimeLog, onBootEvent);

  // Boot-time catalog / data refresh — these call IPC so they stay in the
  // hook rather than inside store create().
  //
  // Defer via requestAnimationFrame (macrotask), NOT queueMicrotask (microtask).
  // React 9's useSyncExternalStore tearing check runs during the passive-commit
  // phase. A microtask queued from useEffect runs BEFORE that check completes,
  // so any synchronous zustand set() in the microtask is detected as tearing →
  // forceStoreRerender → excessive re-render loop → error #185. A macrotask
  // (rAF) runs at the start of the next frame, AFTER all passive-commit and
  // tearing-check work finishes. This lets store updates land as normal
  // scheduled re-renders instead of tearing violations (fixes error #185).
  useEffect(() => {
    let disposed = false;
    const rafId = requestAnimationFrame(() => {
      if (disposed) return;
      void useThemeStore
        .getState()
        .refreshThemes()
        .finally(() => useThemeStore.setState({ loading: false }));
      void useWallpaperStore.getState().initialize();
      void useAgentStore.getState().loadAgents();
      useEnvironmentStore.getState().loadPresets();
    });
    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Secondary-injection trace — wire IPC subscriptions once at boot.
  // -----------------------------------------------------------------------
  useEffect(() => {
    useSecondaryInjectStore.getState().init();
  }, []);

  // -----------------------------------------------------------------------
  // P3 Self-Healing drift status — subscribe once at boot.
  // Uses getState().setDriftReport() to dispatch into the store without
  // re-subscribing on every render. Module-level Set guard inside the store
  // is not needed because useEffect cleanup handles HMR correctly.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const off = api.onThemeDriftStatus((status) => {
      useDiagnosticsStore.getState().setDriftReport(status);
    });
    return off;
  }, []);

  // -----------------------------------------------------------------------
  // Engine injection failure — surface a non-blocking toast when the
  // multi-layer engine injection falls back to legacy single-CSS mode.
  // -----------------------------------------------------------------------
  useEffect(() => {
    const off = api.onThemeEngineInjectFailure(({ agent, themeId, message }) => {
      const agentName = AGENT_META[agent as AgentId]?.displayName ?? agent;
      const toastMsg = `主题引擎注入失败，已降级到兼容模式 (${agentName} / ${themeId}): ${message}`;
      useNotificationStore.getState().showToast(toastMsg, 'destructive');
    });
    return off;
  }, []);

  // -----------------------------------------------------------------------
  // Persist failure warnings — subscribe once at boot.
  // Increment persistFailures in the store whenever the main process fires
  // PERSIST_FAILURE_WARNING (threshold reached).
  // -----------------------------------------------------------------------
  useEffect(() => {
    const off = api.onPersistFailureWarning(({ failureCount }) => {
      useDiagnosticsStore.getState().incrementPersistFailures(failureCount);
    });
    return off;
  }, []);

  // -----------------------------------------------------------------------
  // Theme slice
  // -----------------------------------------------------------------------
  const installed = useThemeStore((s) => s.installed);
  const themeLoading = useThemeStore((s) => s.loading);
  const selection = useThemeStore((s) => s.selection);
  const themeBusy = useThemeStore((s) => s.busy);
  const themeGlobalBusy = useThemeStore((s) => s.globalBusy);
  const setSelection = useThemeStore((s) => s.setSelection);
  const applyToApp = useThemeStore((s) => s.applyToApp);
  const restoreApp = useThemeStore((s) => s.restoreApp);
  const restoreAll = useThemeStore((s) => s.restoreAll);
  const exportTheme = useThemeStore((s) => s.exportTheme);
  const createBundle = useThemeStore((s) => s.createBundle);
  const confirmDelete = useThemeStore((s) => s.confirmDelete);
  const confirmFileImport = useThemeStore((s) => s.confirmFileImport);
  const dropThemeFiles = useThemeStore((s) => s.dropThemeFiles);

  // -----------------------------------------------------------------------
  // Install flow slice
  // -----------------------------------------------------------------------
  const installSteps = useInstallFlowStore((s) => s.steps);
  const currentTheme = useInstallFlowStore((s) => s.currentTheme);
  const lastError = useInstallFlowStore((s) => s.lastError);
  const retryInstall = useInstallFlowStore((s) => s.retryInstall);
  const cancelInstall = useInstallFlowStore((s) => s.cancelInstall);
  const setInstallSteps = useInstallFlowStore((s) => s.setSteps);
  const setFlowStateAction = useInstallFlowStore((s) => s.setFlowState);
  const installFlags = useInstallFlowStore(useShallow(selectInstallFlags));

  // -----------------------------------------------------------------------
  // Settings slice
  // -----------------------------------------------------------------------
  const settingsSection = useSettingsStore((s) => s.settingsSection);
  const settings = useSettingsStore((s) => s.settings);
  const setSettingsSection = useSettingsStore((s) => s.setSettingsSection);
  const openSettings = useSettingsStore((s) => s.openSettings);

  // -----------------------------------------------------------------------
  // Wallpaper slice
  // -----------------------------------------------------------------------
  // Individual field selectors instead of `(s) => s`. Subscribing to the whole
  // store returns a new reference on every field change, which:
  //   (a) forces unrelated consumers to re-render, and
  //   (b) feeds burst re-renders into the mount-phase guard that React 19's
  //       useSyncExternalStore installs (error #185).
  const wpWallpapers = useWallpaperStore((s) => s.wallpapers);
  const wpLoading = useWallpaperStore((s) => s.loading);
  const wpEnabled = useWallpaperStore((s) => s.enabled);
  const wpSelectedId = useWallpaperStore((s) => s.selectedId);
  const wpAgentWallpapers = useWallpaperStore((s) => s.agentWallpapers);
  const wpRender = useWallpaperStore((s) => s.render);
  const wpError = useWallpaperStore((s) => s.error);
  const wallpaperActive = useWallpaperStore(selectActiveWallpaper);

  // Reactive subscriptions for values previously read via non-reactive
  // getState() inside the return object below. Keeps render-body reads fresh.
  const installedById = useThemeStore((s) => s.installedById);
  const refreshThemes = useThemeStore((s) => s.refreshThemes);
  const importTheme = useInstallFlowStore((s) => s.runImport);
  const setWallpaperRestartPrompt = useDialogStore((s) => s.setWallpaperRestartPrompt);
  const setWallpaper = useWallpaperStore((s) => s.setWallpaper);
  const importWallpaper = useWallpaperStore((s) => s.importWallpaper);
  const deleteWallpaper = useWallpaperStore((s) => s.deleteWallpaper);
  const setAndApplyAgentWallpaper = useWallpaperStore((s) => s.setAndApplyAgentWallpaper);
  const wpInitialize = useWallpaperStore((s) => s.initialize);

  // R5: 用 useMemo 包裹 controller 返回值，确保引用稳定性。
  // 避免每次渲染创建新对象导致下游 React.memo 子组件失效。
  return useMemo(
    () => ({
      // ── Shared / shell ─────────────────────────────────────────────────
      t,
      locale,
      setLocale,
      appVersion,
      route,
      setRoute,
      activeAgentId,
      status,
      statusStale: status === null,
      lastStatusAt,
      isRefreshing,
      busy: aggregateBusyKey(themeBusy, themeGlobalBusy),
      toasts: controllerToasts,
      showToast,
      logs,
      injectDockOpen,
      setInjectDockOpen,
      toggleSidebar,
      refreshStatus,
      bootProgress,

      // ── Agents ────────────────────────────────────────────────────────
      agents,
      appStatusFor,

      // ── Themes ───────────────────────────────────────────────────────
      installed,
      installedById,
      selection,
      setSelection,
      applyToApp,
      restoreApp,
      restoreAll,
      exportTheme,
      createBundle,
      confirmDelete,
      confirmFileImport,
      dropThemeFiles,
      refreshThemes,
      loading: themeLoading,

      // ── Import / install flow ────────────────────────────────────────
      importTheme,
      installSteps,
      setSteps: setInstallSteps,
      setFlowState: setFlowStateAction,
      currentTheme,
      lastError,
      isInstalling: installFlags.isInstalling,
      isComplete: installFlags.isComplete,
      isFailed: installFlags.isFailed,
      isCancelled: installFlags.isCancelled,
      progress: installFlags.progress,
      retryInstall,
      cancelInstall,

      // ── Dialogs ──────────────────────────────────────────────────────
      restartPrompt,
      setRestartPrompt,
      wallpaperRestartPrompt,
      setWallpaperRestartPrompt,
      launchRestartPrompt,
      setLaunchRestartPrompt,
      forceRestartLaunch,
      deletePrompt,
      setDeletePrompt,
      fileImportPrompt,
      setFileImportPrompt,
      restoreAllPrompt,
      setRestoreAllPrompt,

      // ── Settings ─────────────────────────────────────────────────────
      settingsSection,
      setSettingsSection,
      settings,
      openSettings,

      // ── Dynamic wallpapers ───────────────────────────────────────────
      wallpaper: {
        wallpapers: wpWallpapers,
        loading: wpLoading,
        enabled: wpEnabled,
        selectedId: wpSelectedId,
        agentWallpapers: wpAgentWallpapers,
        active: wallpaperActive,
        render: wpRender,
        error: wpError,
        initialize: wpInitialize,
        setWallpaper,
        importWallpaper,
        deleteWallpaper,
        setAndApplyAgentWallpaper,
      },
    }),
    [
      // Shell / shared
      t,
      locale,
      setLocale,
      appVersion,
      route,
      setRoute,
      activeAgentId,
      status,
      lastStatusAt,
      isRefreshing,
      themeBusy,
      themeGlobalBusy,
      controllerToasts,
      showToast,
      logs,
      injectDockOpen,
      setInjectDockOpen,
      toggleSidebar,
      refreshStatus,
      bootProgress,
      // Agents
      agents,
      // Themes
      installed,
      installedById,
      selection,
      setSelection,
      applyToApp,
      restoreApp,
      restoreAll,
      exportTheme,
      createBundle,
      confirmDelete,
      confirmFileImport,
      dropThemeFiles,
      refreshThemes,
      themeLoading,
      // Install flow
      importTheme,
      installSteps,
      setInstallSteps,
      setFlowStateAction,
      currentTheme,
      lastError,
      installFlags,
      retryInstall,
      cancelInstall,
      // Dialogs
      restartPrompt,
      setRestartPrompt,
      wallpaperRestartPrompt,
      setWallpaperRestartPrompt,
      launchRestartPrompt,
      setLaunchRestartPrompt,
      forceRestartLaunch,
      deletePrompt,
      setDeletePrompt,
      fileImportPrompt,
      setFileImportPrompt,
      restoreAllPrompt,
      setRestoreAllPrompt,
      // Settings
      settingsSection,
      setSettingsSection,
      settings,
      openSettings,
      // Wallpapers
      wpWallpapers,
      wpLoading,
      wpEnabled,
      wpSelectedId,
      wpAgentWallpapers,
      wallpaperActive,
      wpRender,
      wpError,
      wpInitialize,
      setWallpaper,
      importWallpaper,
      deleteWallpaper,
      setAndApplyAgentWallpaper,
    ],
  );
}

export type AppController = ReturnType<typeof useAppController>;
