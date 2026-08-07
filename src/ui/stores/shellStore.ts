// SPDX-License-Identifier: MPL-2.0

/**
 * # shellStore
 *
 * App shell state — locale, route, sidebar, inject dock, logs, booting.
 *
 * This is the first zustand store extracted from `useAppController` (Phase A1
 * of the UI architecture refactor). It owns the "application frame" state
 * that is independent of any domain (themes/wallpaper/agents/settings).
 *
 * i18n derived values (`t`) are intentionally NOT stored here — they are
 * derived via selector from `locale` so reference equality is stable and
 * consumers subscribe to the minimal slice they need.
 */

import type { Dispatch, SetStateAction } from 'react';
import type { Route } from '@/types/navigation';

import { type AppLocale, DEFAULT_LOCALE } from '@shared/i18n';
import { create } from 'zustand';

/** localStorage key for the sidebar collapse preference. */
const SIDEBAR_KEY = 'agentskin:sidebar-collapsed';

interface ShellState {
  locale: AppLocale;
  appVersion: string;
  booting: boolean;
  route: Route;
  activeAgentId: string | null;
  sidebarCollapsed: boolean;
  injectDockOpen: boolean;
  logs: string[];
  logsOpen: boolean;

  // --- actions ---
  setLocale: (locale: AppLocale) => void;
  setAppVersion: (version: string) => void;
  setBooting: (booting: boolean) => void;
  setRoute: (route: Route) => void;
  setActiveAgentId: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setInjectDockOpen: Dispatch<SetStateAction<boolean>>;
  toggleInjectDock: () => void;
  setLogs: Dispatch<SetStateAction<string[]>>;
  setLogsOpen: (open: boolean) => void;
}

function readSidebarPref(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
}

export const useShellStore = create<ShellState>((set) => ({
  locale: DEFAULT_LOCALE,
  appVersion: '',
  booting: true,
  route: 'dashboard',
  activeAgentId: null,
  sidebarCollapsed: readSidebarPref(),
  injectDockOpen: false,
  logs: [],
  logsOpen: false,

  setLocale: (locale) => set({ locale }),
  setAppVersion: (appVersion) => set({ appVersion }),
  setBooting: (booting) => set({ booting }),
  setRoute: (route) => set({ route }),
  setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    set({ sidebarCollapsed });
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? '1' : '0');
    } catch {
      /* ignore persistence failures */
    }
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setInjectDockOpen: (open) =>
    set((s) => ({
      injectDockOpen:
        typeof open === 'function' ? (open as (prev: boolean) => boolean)(s.injectDockOpen) : open,
    })),
  toggleInjectDock: () => set((s) => ({ injectDockOpen: !s.injectDockOpen })),
  setLogs: (logs) =>
    set((s) => ({
      logs: typeof logs === 'function' ? logs(s.logs) : logs,
    })),
  setLogsOpen: (logsOpen) => set({ logsOpen }),
}));
