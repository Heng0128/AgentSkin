// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemeMode,
  getStoredThemeMode,
  resolveMode,
  setThemeMode,
  type ThemeMode,
} from '@/design/theme-mode';

/** Access the Electron preload bridge (undefined outside Electron, e.g. tests). */
function getApi(): { setThemeMode?: (mode: ThemeMode) => Promise<void> } | undefined {
  return typeof window !== 'undefined'
    ? (window as unknown as { agentSkin?: { setThemeMode?: (mode: ThemeMode) => Promise<void> } })
        .agentSkin
    : undefined;
}

/**
 * React binding for the theme mode. Reads the persisted mode on first render,
 * applies it to <html>, and listens for OS preference changes while in
 * `system` mode.
 *
 * Phase 4 enhancements:
 *   · Real-time system theme sync — when mode is 'system', OS dark/light
 *     changes apply instantly without a reload.
 *   · Cross-tab sync — storage events propagate theme changes across tabs.
 *   · SSR-safe — guards window/localStorage/matchMedia access.
 */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode());

  // Apply the current mode on mount and when it changes.
  useEffect(() => {
    applyThemeMode(mode);
  }, [mode]);

  // Listen for OS-level dark/light preference changes.
  // When mode is 'system', resolveMode() re-reads matchMedia on every call,
  // so calling applyThemeMode(mode) re-resolves and flips the class if needed.
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;

    const onChange = () => {
      // Only re-apply if the user is in system mode — otherwise the user's
      // explicit choice should persist even if the OS theme changes.
      const current = getStoredThemeMode();
      if (current === 'system') {
        applyThemeMode('system');
      }
    };

    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Cross-tab/window sync — when another tab changes the theme,
  // the storage event fires here and we sync up.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'agentskin-theme' && e.newValue) {
        const next = e.newValue as ThemeMode;
        if (next === 'dark' || next === 'light' || next === 'system') {
          setMode(next);
        }
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((next: ThemeMode) => {
    setMode(next);
    setThemeMode(next);
    // Persist to the main process so the window backgroundColor can follow.
    // Fire-and-forget — failure only affects the next launch's background.
    void getApi()?.setThemeMode?.(next);
  }, []);

  // Expose the resolved mode (dark/light) for components that need to know
  // the actual rendered theme rather than the user's preference.
  const resolvedMode = resolveMode(mode);

  return { mode, setMode: update, resolvedMode };
}
