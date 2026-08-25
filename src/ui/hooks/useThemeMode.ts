// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemeMode,
  getStoredThemeMode,
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
 */
export function useThemeMode() {
  const [mode, setMode] = useState<ThemeMode>(() => getStoredThemeMode());

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => applyThemeMode(getStoredThemeMode());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const update = useCallback((next: ThemeMode) => {
    setMode(next);
    setThemeMode(next);
    // Persist to the main process so the window backgroundColor can follow.
    // Fire-and-forget — failure only affects the next launch's background.
    void getApi()?.setThemeMode?.(next);
  }, []);

  return { mode, setMode: update };
}
