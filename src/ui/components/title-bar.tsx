// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { HugeIcon } from '@/components/ui/huge-icon';
import type { ThemeMode } from '@/design/theme-mode';
import type { AppController } from '@/hooks/useAppController';
import { useThemeMode } from '@/hooks/useThemeMode';
import { cn } from '@/lib/utils';

import {
  Cancel01Icon,
  ComputerIcon,
  Maximize02Icon,
  Minimize01Icon,
  Moon02Icon,
  Sun03Icon,
} from '@hugeicons/core-free-icons';

/**
 * # TitleBar — Swiss Edition
 *
 * Custom frameless title bar rendered at the top of the window. Replaces the
 * native Windows title bar (macOS keeps its traffic-light buttons via
 * `hiddenInset` and this bar only draws the functional buttons on the right,
 * leaving the left margin free for the native buttons).
 *
 * Swiss design specs:
 *   - Height: 38px sharp, no rounded corners
 *   - Background: var(--surface) default; glass effect when wallpaper active
 *   - Brand: "AgentSkin" + version in Space Grotesk bold 13px
 *   - Icon buttons: 27×27px, transparent by default, hover → card2 + border
 *   - Close button: red background + white text on hover
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
export function TitleBar({
  controller,
  hasWallpaper = false,
}: {
  controller: AppController;
  /** When an active wallpaper is rendering, the bar switches to glass mode. */
  hasWallpaper?: boolean;
}) {
  const { t, status, route } = controller;
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

  const themeModes: Array<{ value: ThemeMode; icon: typeof Sun03Icon; label: string }> = [
    { value: 'dark', icon: Moon02Icon, label: t.themeDark },
    { value: 'light', icon: Sun03Icon, label: t.themeLight },
    { value: 'system', icon: ComputerIcon, label: t.themeSystem },
  ];

  // Swiss-style icon button class — transparent by default, reveals bg + border on hover.
  const swissBtn =
    'flex h-[27px] w-[27px] items-center justify-center rounded-[2px] border border-transparent text-muted-foreground transition-all duration-150 hover:scale-[1.05] hover:border-border hover:bg-card2 hover:text-foreground active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:scale-100';

  return (
    <header
      className={cn(
        'relative flex h-[38px] shrink-0 items-center justify-between gap-2 px-2 transition-[background] duration-400',
        'border-b border-border',
        // Surface solid default; glass switch when wallpaper active.
        hasWallpaper
          ? 'bg-[var(--glass)] backdrop-blur-[20px] backdrop-saturate-[1.2]'
          : 'bg-[var(--surface)]',
        // The whole bar is a drag region; interactive elements opt out below.
        '[-webkit-app-region:drag]',
        isMac ? 'pl-20' : 'pl-2',
      )}
    >
      {/* Left: brand + page — Space Grotesk bold 13px, mono page label after
          a Swiss hairline divider. */}
      <div className="pointer-events-none flex items-center gap-2">
        <span className="font-display text-[13px] font-bold tracking-tight text-foreground">
          AgentSkin
        </span>
        <span className="h-3 w-px bg-border" aria-hidden />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          {routeLabel}
        </span>
      </div>

      {/* Spacer — pushes everything after it to the far right. */}
      <div className="flex-1" />

      {/* Right cluster: theme mode + window controls.
          Each interactive element sets `no-drag` so clicks don't move the window. */}
      <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        {/* Theme mode segmented control — Swiss flat style. */}
        <div className="ml-1 mr-0.5 inline-flex items-center gap-0.5 rounded-[2px] border border-border bg-[var(--bg2)] p-0.5">
          {themeModes.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={mode === opt.value}
              onClick={() => setMode(opt.value)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-[1px] text-muted-foreground transition-all duration-150',
                mode === opt.value ? 'bg-card text-foreground shadow-xs' : 'hover:text-foreground',
              )}
            >
              <HugeIcon icon={opt.icon} className="size-3" />
            </button>
          ))}
        </div>

        {/* Window controls — Windows/Linux only. macOS uses native traffic lights. */}
        {!isMac && (
          <>
            <div className="mx-1.5 h-4 w-px bg-border" />
            <button
              type="button"
              title={t.titlebarMinimize}
              aria-label={t.titlebarMinimize}
              onClick={() => api.windowMinimize()}
              className={swissBtn}
            >
              <HugeIcon icon={Minimize01Icon} className="size-3.5" />
            </button>
            <button
              type="button"
              title={maximized ? t.titlebarRestore : t.titlebarMaximize}
              aria-label={maximized ? t.titlebarRestore : t.titlebarMaximize}
              onClick={() => void api.windowToggleMaximize()}
              className={swissBtn}
            >
              <HugeIcon icon={Maximize02Icon} className="size-3" />
            </button>
            <button
              type="button"
              title={t.titlebarClose}
              aria-label={t.titlebarClose}
              onClick={() => api.windowClose()}
              className={cn(
                swissBtn,
                'hover:bg-[var(--brand-red)] hover:text-white hover:border-[var(--brand-red)]',
              )}
            >
              <HugeIcon icon={Cancel01Icon} className="size-3.5" />
            </button>
          </>
        )}
      </div>
    </header>
  );
}
