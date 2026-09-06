// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarProvider
 *
 * Combines shellStore subscription (Zustand) with a React Context to expose
 * sidebar state to all descendant components WITHOUT duplicating state
 * (single source of truth = shellStore).
 *
 * ## State flow
 *
 * ```
 * shellStore.sidebarCollapsed ──subscribe──► useSyncExternalStore
 *                                             │
 *                                             ▼
 *                                        Context value
 *                                             │
 *                        ┌────────────────────┼────────────────────┐
 *                        ▼                    ▼                    ▼
 *                  SidebarRail          SidebarContent        SidebarMenu
 * ```
 *
 * The Provider never holds a local copy of `sidebarCollapsed`.  Components
 * always read the freshest value from the store via the selector hook
 * `useSidebarStore`.
 *
 * ## Lifecycle
 *
 * On Electron `suspend`, the provider clears any pending hover timers to
 * prevent stale callbacks from firing after resume (cross-examination Q5).
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useShellStore } from '@/stores/shellStore';
import type { Route } from '@/types/navigation';

interface SidebarContextValue {
  /** Current collapse state — always fresh from shellStore. */
  collapsed: boolean;
  /** Toggle collapse. Persisted by shellStore persist middleware. */
  toggle: () => void;
  /** Programmatically set collapse state. */
  setCollapsed: (collapsed: boolean) => void;
  /** Currently hovered menu route — drives hover-to-open intermediate layer. */
  hoveredRoute: Route | null;
  setHoveredRoute: (route: Route | null) => void;
  /** Active keyboard-focused route — drives keyboard navigation ring. */
  focusedRoute: Route | null;
  setFocusedRoute: (route: Route | null) => void;
  /** Register a hover timer so the provider can clear it on suspend. */
  registerTimer: (id: ReturnType<typeof setTimeout>) => void;
  /** macOS safe-area inset (traffic-light region) — px. */
  safeAreaInset: number;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within <SidebarProvider>');
  }
  return ctx;
}

interface SidebarProviderProps {
  children: ReactNode;
}

export function SidebarProvider({ children }: SidebarProviderProps) {
  // Subscribe to shellStore slices — single source of truth
  const collapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const setSidebarCollapsed = useShellStore((s) => s.setSidebarCollapsed);
  const safeAreaInset = useShellStore((s) => s.safeAreaInset);

  // Hover state (intermediate layer)
  const [hoveredRoute, setHoveredRoute] = useState<Route | null>(null);
  // Keyboard focus state
  const [focusedRoute, setFocusedRoute] = useState<Route | null>(null);

  // Track hover timers for cleanup on Electron suspend
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const registerTimer = useCallback((id: ReturnType<typeof setTimeout>) => {
    timersRef.current.add(id);
    return () => {
      clearTimeout(id);
      timersRef.current.delete(id);
    };
  }, []);

  // Cleanup timers on Electron suspend (visibilitychange) and unmount
  useEffect(() => {
    const cleanup = () => {
      for (const id of timersRef.current) {
        clearTimeout(id);
      }
      timersRef.current.clear();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cleanup();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanup();
    };
  }, []);

  const value = useMemo<SidebarContextValue>(
    () => ({
      collapsed,
      toggle: toggleSidebar,
      setCollapsed: setSidebarCollapsed,
      hoveredRoute,
      setHoveredRoute,
      focusedRoute,
      setFocusedRoute,
      registerTimer,
      safeAreaInset,
    }),
    [
      collapsed,
      toggleSidebar,
      setSidebarCollapsed,
      hoveredRoute,
      focusedRoute,
      registerTimer,
      safeAreaInset,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
