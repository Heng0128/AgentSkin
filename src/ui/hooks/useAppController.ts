// SPDX-License-Identifier: MPL-2.0

/**
 * # useAppController
 *
 * Pure composition layer that owns shared state (locale, status, busy, logs, view)
 * and wires domain hooks together.
 *
 *   useBoot          → one-time bootstrap + log subscription + status polling
 *   useNotifications  → toasts + showToast + fail
 *   useDialogs        → all prompt state (restart/delete/fileImport)
 *   useAgents         → agent catalog + status lookup
 *   useThemes         → installed themes CRUD + apply/restore/import
 *   useSettings       → settings dialog + app path/port
 *
 * Note: Built-in theme seeding is handled in main.ts (P3.1).
 * The renderer no longer seeds builtin themes from URLs.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import type { Route } from '@/types/navigation';

import { type AppLocale, type UiMessages, uiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import { AGENT_META } from '@shared/types';
import { useAgents } from './useAgents';
import { useBoot } from './useBoot';
import { type StructuredEvent, useBootProgress } from './useBootProgress';
import { useDialogs } from './useDialogs';
import { type SettingsSection, useSettings } from './useSettings';
import {
  type InstallFlowState,
  type InstallStep,
  useThemeInstallFlow,
} from './useThemeInstallFlow';
import { type BusyKey, type Selection, useThemes } from './useThemes';
import { useWallpaper } from './useWallpaper';

export type { AgentProgress, BootPhase, ProgressMap } from './useBootProgress';
export type { Toast } from './useNotifications';
export type { RestartPrompt } from './useThemes';
export type { BusyKey, InstallFlowState, InstallStep, Route, Selection, SettingsSection };

export function useAppController() {
  // --- Shared state (from shellStore) ---
  const locale = useShellStore((s) => s.locale);
  const appVersion = useShellStore((s) => s.appVersion);
  const route = useShellStore((s) => s.route);
  const activeAgentId = useShellStore((s) => s.activeAgentId);
  const booting = useShellStore((s) => s.booting);
  const logs = useShellStore((s) => s.logs);
  const logsOpen = useShellStore((s) => s.logsOpen);
  const injectDockOpen = useShellStore((s) => s.injectDockOpen);
  const sidebarCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const setLocaleState = useShellStore((s) => s.setLocale);
  const setAppVersion = useShellStore((s) => s.setAppVersion);
  const setBooting = useShellStore((s) => s.setBooting);
  const setLogs = useShellStore((s) => s.setLogs);
  const setLogsOpen = useShellStore((s) => s.setLogsOpen);
  const setActiveAgentId = useShellStore((s) => s.setActiveAgentId);

  const status = useStatusStore((s) => s.status);
  const lastStatusAt = useStatusStore((s) => s.lastStatusAt);
  const isRefreshing = useStatusStore((s) => s.isRefreshing);
  const setStatus = useStatusStore((s) => s.setStatus);
  const [busy, setBusy] = useState<BusyKey | null>(null);

  // Inject dock (A.html `#dock`) — floating quick-actions capsule toggled
  // from the status bar ⏏ button or Ctrl/Cmd+D.
  const setInjectDockOpen = useShellStore((s) => s.setInjectDockOpen);
  const toggleInjectDock = useShellStore((s) => s.toggleInjectDock);
  const setSidebarCollapsed = useShellStore((s) => s.setSidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);

  // Global shortcut (Ctrl/Cmd + \) — mirrors VS Code / Cursor so the toggle
  // is reachable without reaching for the mouse. Ignored while typing in a
  // field so it never hijacks app-level shortcuts.
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

  // Global shortcut (Ctrl/Cmd + D) — toggles the inject dock. Mirrors the
  // A.html ⌘D quick action. Ignored while typing in a field.
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

  const t: UiMessages = uiMessages[locale];

  // --- Shared functions ---
  const refreshStatus = useStatusStore((s) => s.refreshStatus);

  const setLocale = useCallback(
    async (next: AppLocale) => {
      setLocaleState(next);
      try {
        await api.setLocale(next);
      } catch {
        /* toast handled by caller */
      }
    },
    [setLocaleState],
  );

  const setRoute = useShellStore((s) => s.setRoute);

  // --- Notifications (needed before boot so fail() is available) ---
  const controllerToasts = useNotificationStore((s) => s.toasts);
  const showToast = useNotificationStore((s) => s.showToast);
  const fail = useNotificationStore((s) => s.fail);

  // --- Boot warnings: surface degraded boot steps as a toast once the main
  // window is ready. The main process pushes the list once (boot:warnings);
  // empty lists are never sent. Uses a ref for the locale so re-subscribing
  // isn't needed when the user switches language (the event fires once). ---
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

  // --- Boot: bootstrap + log subscription + status polling ---
  useBoot({
    fail,
    setLocaleState,
    setAppVersion,
    setBooting,
    setLogs,
    refreshStatus,
  });

  // --- Boot progress: parse structured log events into per-agent phases ---
  // onBootEvent fires toasts for the boot-restore lifecycle so the user
  // gets explicit feedback when themes are being restored after a reboot,
  // even if the workspace view isn't visible.
  const onBootEvent = useCallback(
    (event: StructuredEvent) => {
      const displayName = (id: string): string => AGENT_META[id as AgentId]?.displayName ?? id;
      switch (event.type) {
        case 'boot_start':
          if (event.agentCount && event.agentCount > 0) {
            showToast(t.bootRestoringToast(event.agentCount));
          }
          break;
        case 'boot_agent_done':
          showToast(t.bootAgentRestoredToast(displayName(event.agentId)));
          break;
        case 'boot_agent_failed':
          showToast(t.bootAgentFailedToast(displayName(event.agentId)), 'destructive');
          break;
      }
    },
    [showToast, t],
  );
  const bootProgress = useBootProgress(api.onRuntimeLog, onBootEvent);

  // --- Compose domain hooks ---
  const dialogs = useDialogs();
  const agentsHook = useAgents(status);
  // useWallpaper is created before useThemes so the theme-apply flow can
  // activate the theme's bundled video wallpaper after a successful apply.
  // `fail` reports wallpaper IPC errors instead of letting them become
  // unhandled rejections or silent .catch(() => undefined) drops.
  //
  // pywal-style wallpaper→theme linkage: when a wallpaper is applied to an
  // agent, auto-extract a matching theme, apply it, then re-apply the
  // wallpaper (theme apply clears per-agent wallpaper per "last applied
  // wins"). The companion needs `applyToApp` from useThemes, which is created
  // after useWallpaper — so it goes through a ref that useThemes populates.
  const wallpaperCompanionRef = useRef<
    ((appId: AgentId, wallpaperId: string) => Promise<void>) | null
  >(null);
  // Guards against recursion: the companion re-applies the wallpaper, which
  // triggers onWallpaperApplied again — short-circuit while it is running.
  const wallpaperCompanionBusyRef = useRef(false);
  const wallpaper = useWallpaper(fail, async (appId, wallpaperId) => {
    const run = wallpaperCompanionRef.current;
    if (run) await run(appId, wallpaperId);
  });
  const themesHook = useThemes({
    showToast,
    fail,
    busy,
    setBusy,
    t,
    status,
    setStatus,
    refreshStatus,
    deletePrompt: dialogs.deletePrompt,
    setDeletePrompt: dialogs.setDeletePrompt,
    fileImportPrompt: dialogs.fileImportPrompt,
    setFileImportPrompt: dialogs.setFileImportPrompt,
    setRestartPrompt: dialogs.setRestartPrompt,
    activateThemeWallpaper: wallpaper.activateThemeWallpaper,
  });

  // Keep the companion ref in sync with the latest themesHook / wallpaper
  // instances. Previously this assignment ran in the render body (a side
  // effect during render), and the closure captured the themesHook reference
  // from the first render — so if the theme list refreshed after boot, the
  // companion used a stale `applyToApp`. Updating via effect guarantees the
  // ref always holds the latest implementations.
  useEffect(() => {
    wallpaperCompanionRef.current = async (appId, wallpaperId) => {
      if (wallpaperCompanionBusyRef.current) return;
      wallpaperCompanionBusyRef.current = true;
      try {
        const theme = await api.extractThemeFromWallpaper(wallpaperId);
        const applied = await themesHook.applyToApp(theme.id, theme.displayName, appId);
        if (applied) {
          // Theme apply cleared the per-agent wallpaper preference (last
          // applied wins) — re-apply it to restore both. The re-apply triggers
          // onWallpaperApplied again, short-circuited by the busy ref.
          await wallpaper.setAndApplyAgentWallpaper(appId, true, wallpaperId);
        }
      } catch (error) {
        fail(error);
        showToast(t.wallpaperThemeAutoFailed, 'destructive');
      } finally {
        wallpaperCompanionBusyRef.current = false;
      }
    };
  }, [themesHook, wallpaper, fail, showToast, t.wallpaperThemeAutoFailed]);

  const settingsHook = useSettings({ showToast, fail, t, setStatus });

  // Install flow (real step sequence)
  const installFlow = useThemeInstallFlow({
    refreshThemes: themesHook.refreshThemes,
    showToast,
    fail,
    t,
  });

  return {
    // Shared
    t,
    locale,
    setLocale,
    appVersion,
    booting,
    route,
    setRoute,
    activeAgentId,
    setActiveAgentId,
    status,
    statusStale: status === null,
    lastStatusAt,
    isRefreshing,
    busy,
    toasts: controllerToasts,
    showToast,
    logs,
    logsOpen,
    setLogsOpen,
    injectDockOpen,
    setInjectDockOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    toggleSidebar,
    refreshStatus,
    bootProgress,

    // Agents
    agents: agentsHook.agents,
    appStatusFor: agentsHook.appStatusFor,

    // Themes
    ...themesHook,
    // Import theme — unified to always use the install flow (step-by-step
    // progress). Previously useThemes had a separate simple-toast importTheme
    // that duplicated the IPC call. The InstallProgress component is globally
    // rendered in App.tsx so the progress UI shows regardless of caller.
    importTheme: installFlow.runImport,

    // Install flow
    installSteps: installFlow.steps,
    flowState: installFlow.flowState,
    currentTheme: installFlow.currentTheme,
    lastError: installFlow.lastError,
    isInstalling: installFlow.isInstalling,
    isComplete: installFlow.isComplete,
    isFailed: installFlow.isFailed,
    isCancelled: installFlow.isCancelled,
    progress: installFlow.progress,
    retryInstall: installFlow.retryInstall,
    cancelInstall: installFlow.cancelInstall,
    setSteps: installFlow.setSteps,
    setFlowState: installFlow.setFlowState,

    // Dialogs
    ...dialogs,

    // Settings
    ...settingsHook,

    // Dynamic wallpapers
    wallpaper,
  };
}

export type AppController = ReturnType<typeof useAppController>;
