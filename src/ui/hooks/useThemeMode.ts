// SPDX-License-Identifier: MPL-2.0

import { useCallback, useEffect, useState } from 'react';
import {
  applyThemeMode,
  getStoredThemeMode,
  setThemeMode,
  type ThemeMode,
} from '@/design/theme-mode';

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
  }, []);

  return { mode, setMode: update };
}
