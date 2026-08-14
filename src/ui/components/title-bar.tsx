// SPDX-License-Identifier: MPL-2.0

/**
 * # TitleBar
 *
 * Custom frameless title bar rendered at the top of the window. Replaces the
 * native Windows title bar (macOS keeps its traffic-light buttons via
 * `hiddenInset` and this bar only draws the functional buttons on the right,
 * leaving the left margin free for the native buttons).
 *
 * Design specs:
 *   - Height: 38px
 *   - Background: var(--surface) default; glass effect when wallpaper active
 *   - Brand: "AgentSkin" + version in font-display bold 13px
 *   - Icon buttons: 27×27px, transparent by default, hover → card2 + border
 *   - Close button: destructive background + white text on hover
 *   - Transition: background 0.4s; icon buttons 0.15s with scale(1.05) hover
 *
 * Layout (left → right):
 *   - drag region (the whole bar is draggable except interactive controls)
 *   - app brand + version
 *   - spacer
 *   - quick actions: import theme · restore all · refresh status
 *   - theme mode control (2-or-3 way segmented)
 *   - divider (Windows only)
 *   - window controls (Windows only): minimize · maximize/restore · close
 *
 * macOS skips the window controls and the divider; the native buttons sit in
 * the drag region's left padding.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { ThemeMode } from '@/design/theme-mode';
import { useThemeMode } from '@/hooks/useThemeMode';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { LucideIcon } from 'lucide-react';
import { Maximize, Minimize2, Minus, Monitor, Moon, Sun, X } from 'lucide-react';

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
            : route === 'settings'
              ? t.navSettings
              : 'AgentSkin';

  const themeModes: Array<{
    value: ThemeMode;
    icon: LucideIcon;
    label: string;
  }> = [
    { value: 'dark', icon: Moon, label: t.themeDark },
    { value: 'light', icon: Sun, label: t.themeLight },
    { value: 'system', icon: Monitor, label: t.themeSystem },
  ];

  // Icon button class — transparent by default, reveals bg + border on hover.
  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-muted-foreground transition-[background-color,border-color,color] duration-150 hover:bg-card2 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent';

  return (
    <header
      className={cn(
        'relative flex h-[38px] shrink-0 items-center justify-between gap-2 px-2 transition-[background] duration-400',
        '',
        // Surface solid default; glass switch when wallpaper active.
        hasWallpaper
          ? 'bg-[color-mix(in_srgb,var(--surface)_55%,transparent)]'
          : 'bg-[var(--surface)]',
        // The whole bar is a drag region; interactive elements opt out below.
        '[-webkit-app-region:drag]',
        isMac ? 'pl-20' : 'pl-2',
      )}
    >
      {/* Left: brand + page — font-display bold 13px, page label after a hairline divider. */}
      <div className="pointer-events-none flex items-center gap-2">
        <span className="font-display text-[13px] font-bold tracking-tight text-foreground">
          AgentSkin
        </span>
        <span className="h-3 w-px bg-border" aria-hidden />
        <span className="text-[11px] text-muted-foreground/70">{routeLabel}</span>
      </div>

      {/* Spacer — pushes everything after it to the far right. */}
      <div className="flex-1" />

      {/* Right cluster: theme mode + window controls.
          Each interactive element sets `no-drag` so clicks don't move the window. */}
      <div className="flex items-center gap-0 [-webkit-app-region:no-drag]">
        {/* Theme mode segmented control */}
        <SegmentedControl
          size="sm"
          value={mode}
          onChange={setMode}
          options={themeModes.map((opt) => ({
            value: opt.value,
            icon: opt.icon,
            title: opt.label,
          }))}
          className="ml-1"
        />

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
              <Minus className="size-4" />
            </button>
            <button
              type="button"
              title={maximized ? t.titlebarRestore : t.titlebarMaximize}
              aria-label={maximized ? t.titlebarRestore : t.titlebarMaximize}
              onClick={() => void api.windowToggleMaximize()}
              className={iconBtn}
            >
              {maximized ? <Minimize2 className="size-4" /> : <Maximize className="size-4" />}
            </button>
            <button
              type="button"
              title={t.titlebarClose}
              aria-label={t.titlebarClose}
              onClick={() => api.windowClose()}
              className={cn(
                iconBtn,
                'hover:bg-destructive hover:text-white hover:border-destructive',
              )}
            >
              <X className="size-4" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
