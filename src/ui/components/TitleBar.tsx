// SPDX-License-Identifier: MPL-2.0

/**
 * # TitleBar
 *
 * Custom frameless title bar — and deliberately INVISIBLE chrome. The bar
 * draws no surface of its own: it floats over the page canvas (solid mode:
 * the section's `--background`; wallpaper mode: the raw wallpaper), so the
 * title bar and the main page are literally the same face — you cannot point
 * at a "title bar strip". Only the floating controls (theme toggle, window
 * controls) mark it. This is the integrated-title-bar endgame: VS Code /
 * Notion / Linear all dissolve the bar into the canvas.
 *
 * Replaces the native Windows title bar (macOS keeps its traffic-light
 * buttons via `hiddenInset`).
 *
 * Design specs:
 *   - Height: 36px (h-9), transparent — NO bg, NO border in either mode
 *     (a bg-* utility would also race `.as-glass` panels in wallpaper mode)
 *   - Icon buttons: 28x28px (size-7), transparent by default, hover → card2
 *   - Theme toggle: Sun/Moon icon button — dark/light two-way switch
 *   - Close button: destructive background + white text on hover
 *   - Icon buttons 0.15s transitions
 *
 * Ownership (v2.9):
 *   - the title layer owns NO visuals — not the brand, not a hairline, not a
 *     surface. Its whole inventory is this 36px transparent drag strip and the
 *     controls floating at its right edge.
 *   - the brand lockup (logo + name) belongs to the SIDEBAR, which renders it
 *     as its own h-12 brand header (`sidebarHeaderClass`) at sidebar
 *     proportions; the sidebar's full-height `border-r` boundary runs straight
 *     past the window's top edge, uninterrupted by any title strip.
 *   - the window's top edge is still ONE continuous drag region: the sidebar
 *     header is itself a drag region (`.as-sidebar-header`), so grabbing the
 *     top-left moves the window exactly like grabbing here.
 *
 * Layout:
 *   - full-width drag region (the whole bar is draggable except interactive
 *     controls). NO brand/page label here — the sidebar header carries the
 *     brand lockup and the active nav item marks the page; repeating
 *     "AgentSkin <page>" was redundant double-branding (and for community
 *     routes the old routeLabel fallback even rendered
 *     "AgentSkin | AgentSkin").
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

export function TitleBar() {
  const locale = useShellStore((s) => s.locale);
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

  function toggleThemeMode() {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }

  // Icon button class — transparent by default, reveals bg on hover.
  const iconBtn =
    'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color] duration-base hover:bg-card2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';

  return (
    <header
      className={cn(
        // Base: h-9 transparent drag strip. NO background, NO border — the
        // page canvas (or the wallpaper) shows straight through; the bar is
        // pure chrome. (A bg-* utility here would also race `.as-glass`
        // panels in wallpaper mode in the cascade.)
        'relative flex h-9 items-center gap-2 px-3',
        // The whole bar is a drag region; interactive elements opt out below.
        '[-webkit-app-region:drag]',
        isMac ? 'pl-20' : 'pl-3',
      )}
    >
      {/* Left: pure drag space — the sidebar header owns the brand lockup. */}

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
              className={cn(iconBtn, 'hover:bg-destructive hover:text-destructive-foreground')}
            >
              <X className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
