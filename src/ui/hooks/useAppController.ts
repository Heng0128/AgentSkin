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

import { useCallback, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import type { Route } from '@/types/navigation';

import { type AppLocale, DEFAULT_LOCALE, type UiMessages, uiMessages } from '@shared/i18n';
import type { AgentId, SystemStatus } from '@shared/types';
import { AGENT_META } from '@shared/types';
import { useAgents } from './useAgents';
import { useBoot } from './useBoot';
import { type ProgressMap, type StructuredEvent, useBootProgress } from './useBootProgress';
import { useDialogs } from './useDialogs';
import { type Toast, useNotifications } from './useNotifications';
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
  // --- Shared state ---
  const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);
  const [appVersion, setAppVersion] = useState('');
  const [route, setRouteState] = useState<Route>('workspace');
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [booting, setBooting] = useState(true);
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const t: UiMessages = uiMessages[locale];

  // --- Shared functions ---
  // refreshStatus tracks in-flight state + last-success timestamp so the UI
  // can surface a "live" indicator with relative time and a refreshing pulse.
  const refreshStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setStatus(await api.refreshStatus());
      setLastStatusAt(Date.now());
    } catch {
      /* transient */
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  const setLocale = useCallback(async (next: AppLocale) => {
    setLocaleState(next);
    try {
      await api.setLocale(next);
    } catch {
      /* toast handled by caller */
    }
  }, []);

  const setRoute = useCallback((next: Route) => setRouteState(next), []);

  // --- Notifications (needed before boot so fail() is available) ---
  const { toasts: controllerToasts, showToast, fail } = useNotifications(t);

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
  const wallpaper = useWallpaper();
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
    logs,
    logsOpen,
    setLogsOpen,
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
