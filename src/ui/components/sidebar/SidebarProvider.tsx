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
 * ## Collapse hand-off (presentation lag)
 *
 * `App` drives a two-phase collapse: the grid column tweens first and the
 * Rail branch mounts only after the tween. During that window the expanded
 * branch is still mounted, so the context's `collapsed` must describe the
 * MOUNTED BRANCH, not the store target — otherwise the still-visible body
 * would snap to icon-only styling mid-tween. `App` passes its staged branch
 * state via the `presentation` prop and it wins over the store here.
 *
 * ## Wallpaper awareness
 *
 * `hasWallpaper` is passed in by `App` (it already owns
 * `controller.wallpaper.active`) and re-exposed here so Rail and Content can
 * derive the wallpaper-aware hover wash (`--ag-sidebar-item-hover`, 8% vs 5%)
 * — hover states sit directly on the scrimmed wallpaper, so they need a
 * stronger wash to stay visible against bright content. (v2.9: the shell no
 * longer paints `as-glass` — the one-canvas model lets the wallpaper show
 * through the whole window, with the readability scrim handling contrast.)
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
  /**
   * True while a live wallpaper paints behind the window. Drives the
   * glass-vs-solid sidebar surface decision shared with `TitleBar`.
   */
  hasWallpaper: boolean;
  /**
   * Ask the next `SidebarMenu` mount to take focus. Called by the collapse /
   * expand affordances so that focus follows the panel instead of falling to
   * `<body>` when the old branch unmounts.
   */
  requestFocusOnMount: () => void;
  /** Read-and-clear `requestFocusOnMount()` — returns true once at most. */
  consumeFocusIntent: () => boolean;
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
  /**
   * Whether a live wallpaper is painted behind the window. Optional (defaults
   * to false) so the provider stays usable in isolation — tests and any future
   * host that has no wallpaper concept can omit it.
   */
  hasWallpaper?: boolean;
  /**
   * Presentation override for the mounted branch (see "Collapse hand-off").
   * `undefined` = follow the shell store; `true/false` = the branch App has
   * staged for rendering (may lag the store during the collapse tween).
   */
  presentation?: boolean;
}

export function SidebarProvider({
  children,
  hasWallpaper = false,
  presentation,
}: SidebarProviderProps) {
  // Subscribe to shellStore slices — single source of truth
  const storeCollapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  // Context `collapsed` describes the MOUNTED BRANCH: during the collapse
  // hand-off it lags the store (see "Collapse hand-off" in the header doc).
  const collapsed = presentation ?? storeCollapsed;
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

  // Focus intent — a ref, not state: it must survive the rail⇄content remount
  // and must never trigger a render of its own.
  const focusIntentRef = useRef(false);
  const requestFocusOnMount = useCallback(() => {
    focusIntentRef.current = true;
  }, []);
  const consumeFocusIntent = useCallback(() => {
    const intent = focusIntentRef.current;
    focusIntentRef.current = false;
    return intent;
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
      hasWallpaper,
      requestFocusOnMount,
      consumeFocusIntent,
    }),
    [
      collapsed,
      toggleSidebar,
      setSidebarCollapsed,
      hoveredRoute,
      focusedRoute,
      registerTimer,
      safeAreaInset,
      hasWallpaper,
      requestFocusOnMount,
      consumeFocusIntent,
    ],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}
