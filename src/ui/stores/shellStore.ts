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
 *
 * ## Persistence
 *
 * Since v2026-09-05, the sidebar collapse preference is persisted via the
 * `persist` middleware (zustand/middleware) instead of hand-rolled
 * localStorage. The localStorage key is `agentskin:sidebar` (persist
 * namespace); only the `sidebarCollapsed` field rehydrates — all other
 * fields reset to defaults on app launch.
 */

import type { Route } from '@/types/navigation';

import { type AppLocale, DEFAULT_LOCALE, isAppLocale, uiMessages } from '@shared/i18n';
import { registerLocaleReader } from '@shared/i18n/runtime-t';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** A value, or an updater function producing a value from the previous one —
 *  the React-free equivalent of `Dispatch<SetStateAction<T>>`. */
type SetStateValue<T> = T | ((prev: T) => T);

/** A setter function accepting a {@link SetStateValue} — the React-free
 *  equivalent of `Dispatch<SetStateAction<T>>`. */
type SetStateSetter<T> = (value: SetStateValue<T>) => void;

interface ShellState {
  locale: AppLocale;
  appVersion: string;
  booting: boolean;
  route: Route;
  activeAgentId: string | null;
  sidebarCollapsed: boolean;
  /** macOS hiddenInset traffic-light inset padding (px) — 0 on Win/Linux. */
  safeAreaInset: number;
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
  setSafeAreaInset: (inset: number) => void;
  setInjectDockOpen: SetStateSetter<boolean>;
  toggleInjectDock: () => void;
  setLogs: SetStateSetter<string[]>;
  setLogsOpen: (open: boolean) => void;
}

export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      locale: DEFAULT_LOCALE,
      appVersion: '',
      booting: true,
      route: 'themes',
      activeAgentId: null,
      sidebarCollapsed: false,
      safeAreaInset: 0,
      injectDockOpen: false,
      logs: [],
      logsOpen: false,

      setLocale: (locale) => {
        // Runtime guard: only accept valid AppLocale values
        if (isAppLocale(locale)) {
          set({ locale });
        }
      },
      setAppVersion: (appVersion) => set({ appVersion }),
      setBooting: (booting) => set({ booting }),
      setRoute: (route) => set({ route }),
      setActiveAgentId: (activeAgentId) => set({ activeAgentId }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSafeAreaInset: (safeAreaInset) => set({ safeAreaInset }),
      setInjectDockOpen: (open) =>
        set((s) => ({
          injectDockOpen:
            typeof open === 'function'
              ? (open as (prev: boolean) => boolean)(s.injectDockOpen)
              : open,
        })),
      toggleInjectDock: () => set((s) => ({ injectDockOpen: !s.injectDockOpen })),
      setLogs: (logs) =>
        set((s) => ({
          logs: typeof logs === 'function' ? logs(s.logs) : logs,
        })),
      setLogsOpen: (logsOpen) => set({ logsOpen }),
    }),
    {
      name: 'agentskin:sidebar',
      partialize: (s) => ({ sidebarCollapsed: s.sidebarCollapsed }),
    },
  ),
);

// RC1 Fix: Register the locale reader so shared/i18n/runtime-t.ts can
// read the current locale's messages without a shared → UI import dependency.
registerLocaleReader(() => {
  const locale = useShellStore.getState().locale;
  return uiMessages[locale] ?? uiMessages[DEFAULT_LOCALE];
});
