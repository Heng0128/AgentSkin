// SPDX-License-Identifier: MPL-2.0

/**
 * Theme mode runtime.
 *
 * Dual-theme support (dark / light / system) backed by localStorage. We keep
 * the shadcn `:root` (light) + `.dark` (dark) token convention, so flipping
 * the mode is just toggling the `dark` class on <html>. This keeps every
 * shadcn component's `dark:` variants working without touching them.
 */

export type ThemeMode = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'agentskin-theme';

function systemPrefersDark(): boolean {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
}

export function getStoredThemeMode(): ThemeMode {
  if (typeof localStorage === 'undefined') return 'dark';
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'dark';
}

export function resolveMode(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return mode;
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = document.documentElement;
  const resolved = resolveMode(mode);
  // Temporarily enable a color/background transition on the root element so
  // the dark↔light flip fades smoothly instead of snapping. The transition
  // is removed after it completes to avoid trapping future property changes
  // (e.g. hover states) in a 240ms ramp. Only the root element transitions;
  // shadcn surfaces keyed off `--background` / `--foreground` follow because
  // those variables are inherited from :root.
  root.style.transition = 'background-color 240ms ease, color 240ms ease';
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
  root.style.colorScheme = resolved;
  window.setTimeout(() => {
    root.style.transition = '';
  }, 280);
}

export function setThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* storage may be unavailable; ignore */
  }
  applyThemeMode(mode);
}
