// SPDX-License-Identifier: MPL-2.0

/**
 * # TitleBar
 *
 * Custom frameless title bar rendered at the top of the window. Replaces the
 * native Windows title bar (macOS keeps its traffic-light buttons via
 * `hiddenInset` and this bar only draws the functional buttons on the right,
 * leaving the left margin free for the native buttons).
 *
 * Design specs (Refined Workbench):
 *   - Height: 36px (h-9)
 *   - Background: var(--surface) default; glass effect when wallpaper active
 *   - Brand: "AgentSkin" in medium weight text-[12px]
 *   - Icon buttons: 28x28px (size-7), transparent by default, hover → card2
 *   - Theme toggle: Sun/Moon icon button — dark/light two-way switch
 *   - Close button: destructive background + white text on hover
 *   - Transition: background 0.4s; icon buttons 0.15s
 *
 * Layout (left → right):
 *   - drag region (the whole bar is draggable except interactive controls)
 *   - app brand + version
 *   - spacer
 *   - theme mode toggle (Sun / Moon icon button)
 *   - divider (Windows only)
 *   - window controls (Windows only): minimize · maximize/restore · close
 *
 * macOS skips the window controls and the divider; the native buttons sit in
 * the drag region's left padding.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useThemeMode } from '@/hooks/useThemeMode';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { Maximize, Minimize2, Minus, Moon, Sun, X } from 'lucide-react';

export function TitleBar({ hasWallpaper = false }: { hasWallpaper?: boolean }) {
  const locale = useShellStore((s) => s.locale);
  const route = useShellStore((s) => s.route);
  const status = useStatusStore((s) => s.status);
  const t: UiMessages = uiMessages[locale];

  const isMac = status?.platform === 'darwin';
  const { mode, setMode } = useThemeMode();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void api.windowIsMaximized().then(setMaximized);
    const off = api.onWindowMaximizeChange(setMaximized);
    return off;
  }, []);

  const routeLabel =
    route === 'workspace'
      ? t.navWorkspace
      : route === 'themes'
        ? t.navThemes
        : route === 'studio'
          ? t.navStudio
          : route === 'wallpaper'
            ? t.navWallpaperEngine
            : route === 'apps'
              ? t.navApps
              : route === 'settings'
                ? t.navSettings
                : 'AgentSkin';

  function toggleThemeMode() {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }

  // Icon button class — transparent by default, reveals bg on hover.
  const iconBtn =
    'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-fast hover:bg-card2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <header
      className={cn(
        // Base: h-9 bar with surface background and drag region.
        'relative flex h-9 items-center gap-2 px-3 transition-[background] duration-slower',
        // Surface solid default; glass switch when wallpaper active.
        hasWallpaper ? 'as-glass border-b border-border/50' : 'bg-[var(--surface)]',
        // The whole bar is a drag region; interactive elements opt out below.
        '[-webkit-app-region:drag]',
        isMac ? 'pl-20' : 'pl-3',
      )}
    >
      {/* Left: brand + page — medium weight, page label after a hairline divider. */}
      <div className="pointer-events-none flex items-center gap-2">
        <span className="text-[12px] font-semibold tracking-tight text-foreground">AgentSkin</span>
        <span className="h-3.5 w-px bg-border-strong" aria-hidden />
        <span className="text-[11px] font-medium text-muted-foreground">{routeLabel}</span>
      </div>

      {/* Spacer — pushes everything after it to the far right. */}
      <div className="flex-1" />

      {/* Right cluster: theme toggle + window controls.
          Each interactive element sets its own no-drag so clicks don't move the window. */}
      <div className="flex items-center gap-1 [-webkit-app-region:no-drag]">
        {/* Theme mode toggle — Sun/Moon icon button, toggles dark <-> light. */}
        <button
          type="button"
          title={mode === 'dark' ? t.themeLight : t.themeDark}
          aria-label={mode === 'dark' ? t.themeLight : t.themeDark}
          onClick={toggleThemeMode}
          className={iconBtn}
        >
          {mode === 'dark' ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
        </button>

        {/* Window controls — Windows/Linux only. macOS uses native traffic lights. */}
        {!isMac && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              title={t.titlebarMinimize}
              aria-label={t.titlebarMinimize}
              onClick={() => api.windowMinimize()}
              className={iconBtn}
            >
              <Minus className="size-3.5" />
            </button>
            <button
              type="button"
              title={maximized ? t.titlebarRestore : t.titlebarMaximize}
              aria-label={maximized ? t.titlebarRestore : t.titlebarMaximize}
              onClick={() => void api.windowToggleMaximize()}
              className={iconBtn}
            >
              {maximized ? <Minimize2 className="size-3.5" /> : <Maximize className="size-3.5" />}
            </button>
            <button
              type="button"
              title={t.titlebarClose}
              aria-label={t.titlebarClose}
              onClick={() => api.windowClose()}
              className={cn(iconBtn, 'hover:bg-destructive hover:text-white')}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
