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
  Copy01Icon,
  Maximize02Icon,
  Minimize01Icon,
  Moon02Icon,
  Refresh01Icon,
  Sun03Icon,
  Upload04Icon,
} from '@hugeicons/core-free-icons';

/**
 * # TitleBar
 *
 * Custom frameless title bar rendered at the top of the window. Replaces the
 * native Windows title bar (macOS keeps its traffic-light buttons via
 * `hiddenInset` and this bar only draws the functional buttons on the right,
 * leaving the left margin free for the native buttons).
 *
 * Layout (left → right):
 *   - drag region (the whole bar is draggable except interactive controls)
 *   - app name / current route label
 *   - spacer
 *   - quick actions: import theme · restore all · refresh status · theme mode
 *   - divider (Windows only)
 *   - window controls (Windows only): minimize · maximize/restore · close
 *
 * macOS skips the window controls and the divider; the native buttons sit in
 * the drag region's left padding.
 */
export function TitleBar({ controller }: { controller: AppController }) {
  const { t, status, route } = controller;
  const isMac = status?.platform === 'darwin';
  const { mode, setMode } = useThemeMode();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    void api.windowIsMaximized().then(setMaximized);
    const off = api.onWindowMaximizeChange(setMaximized);
    return off;
  }, []);

  // Restore every app that currently has an active theme.
  // Delegates to controller.restoreAll (shared with WorkspacePage).
  const restoreAll = () => controller.restoreAll();

  const routeLabel =
    route === 'workspace'
      ? t.navWorkspace
      : route === 'themes'
        ? t.navThemes
        : route === 'settings'
          ? t.navSettings
          : 'AgentSkin';

  const themeModes: Array<{ value: ThemeMode; icon: typeof Sun03Icon; label: string }> = [
    { value: 'dark', icon: Moon02Icon, label: t.themeDark },
    { value: 'light', icon: Sun03Icon, label: t.themeLight },
    { value: 'system', icon: ComputerIcon, label: t.themeSystem },
  ];

  const quickActions: Array<{
    icon: typeof Refresh01Icon;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [
    {
      icon: Upload04Icon,
      label: t.titlebarImport,
      onClick: () => void controller.importTheme(),
    },
    {
      icon: Copy01Icon,
      label: t.titlebarRestoreAll,
      onClick: () => void restoreAll(),
      disabled: !status?.apps.some((app) => app.activeThemeId),
    },
    {
      icon: Refresh01Icon,
      label: t.titlebarRefresh,
      onClick: () => void controller.refreshStatus(),
    },
  ];

  return (
    <div
      className={cn(
        'relative flex h-9 shrink-0 items-center justify-between gap-2 border-b bg-background/80 px-2 backdrop-blur-xl',
        // The whole bar is a drag region; interactive elements opt out below.
        '[-webkit-app-region:drag]',
        isMac ? 'pl-20' : 'pl-2',
      )}
    >
      {/* Left: current route label (non-draggable only on click targets). */}
      <div className="pointer-events-none flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <span className="text-foreground/80">AgentSkin</span>
        <span className="text-muted-foreground/40">/</span>
        <span>{routeLabel}</span>
      </div>

      {/* Right cluster: quick actions + theme mode + window controls.
          Each interactive element sets `no-drag` so clicks don't move the window. */}
      <div className="flex items-center gap-0.5 [-webkit-app-region:no-drag]">
        {/* Quick actions */}
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            title={action.label}
            aria-label={action.label}
            disabled={action.disabled}
            onClick={action.onClick}
            className={cn(
              'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors',
              'hover:bg-muted hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
            )}
          >
            <HugeIcon icon={action.icon} className="size-4" />
          </button>
        ))}

        {/* Theme mode segmented control */}
        <div className="ml-1 mr-0.5 inline-flex items-center gap-0.5 rounded-[11px] bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
          {themeModes.map((opt) => (
            <button
              key={opt.value}
              type="button"
              title={opt.label}
              aria-label={opt.label}
              aria-pressed={mode === opt.value}
              onClick={() => setMode(opt.value)}
              className={cn(
                'flex size-6 items-center justify-center rounded-lg transition-all duration-200 ease-out',
                mode === opt.value
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <HugeIcon icon={opt.icon} className="size-3.5" />
            </button>
          ))}
        </div>

        {/* Window controls — Windows/Linux only. macOS uses native traffic lights. */}
        {!isMac && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            <button
              type="button"
              title={t.titlebarMinimize}
              aria-label={t.titlebarMinimize}
              onClick={() => api.windowMinimize()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeIcon icon={Minimize01Icon} className="size-4" />
            </button>
            <button
              type="button"
              title={maximized ? t.titlebarRestore : t.titlebarMaximize}
              aria-label={maximized ? t.titlebarRestore : t.titlebarMaximize}
              onClick={() => void api.windowToggleMaximize()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeIcon icon={Maximize02Icon} className="size-3.5" />
            </button>
            <button
              type="button"
              title={t.titlebarClose}
              aria-label={t.titlebarClose}
              onClick={() => api.windowClose()}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            >
              <HugeIcon icon={Cancel01Icon} className="size-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
