// SPDX-License-Identifier: MPL-2.0

/**
 * # CommandPalette
 *
 * Global Cmd+K / Ctrl+K command palette. International style:
 * bg-popover surface, border-border, rounded-md, hover uses bg-accent.
 *
 * Three command groups:
 *   导航 (Navigation)  → route switches
 *   主题 (Themes)      → apply a bundled theme by display name
 *   操作 (Actions)     → toggle theme mode, scan agents, dev tools
 */

import { useCallback, useMemo } from 'react';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import { getStoredThemeMode, setThemeMode } from '@/design/theme-mode';
import type { AppController } from '@/hooks/useAppController';

import type { AgentId, ThemeCatalogItem } from '@shared/types';
import {
  AppWindowIcon,
  BugIcon,
  ImageIcon,
  LayoutDashboardIcon,
  MoonIcon,
  PaletteIcon,
  RotateCcwIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react';

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  controller: AppController;
}

export default function CommandPalette({ open, onOpenChange, controller }: CommandPaletteProps) {
  const { route, setRoute, installed: themes, activeAgentId, t } = controller;

  /** Toggle dark ↔ light using the persisted mode as the source of truth. */
  const toggleThemeMode = useCallback(() => {
    const current = getStoredThemeMode();
    const resolved =
      current === 'system'
        ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : current;
    setThemeMode(resolved === 'dark' ? 'light' : 'dark');
  }, []);

  /**
   * Apply a theme to the active agent if any, otherwise the first known
   * agent. Falls back gracefully when no agent is registered.
   */
  const applyThemeByName = useCallback(
    async (themeId: string, displayName: string) => {
      const target: AgentId | undefined = (activeAgentId ?? controller.agents[0]?.id) as
        | AgentId
        | undefined;
      if (!target) return;
      await controller.applyToApp(themeId, displayName, target);
    },
    [controller, activeAgentId],
  );

  /** 主题 (Themes) — map installed catalog entries to palette items. */
  const themeItems = useMemo(
    () =>
      themes.map((theme: ThemeCatalogItem) => (
        <CommandItem
          key={`theme:${theme.id}`}
          onSelect={() => {
            void applyThemeByName(theme.id, theme.name);
            onOpenChange(false);
          }}
        >
          <PaletteIcon />
          <span className="truncate">
            {t.cmdApplyThemePrefix} {theme.name}
          </span>
        </CommandItem>
      )),
    [themes, applyThemeByName, onOpenChange, t],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t.cmdTitle}
      description={t.cmdDescription}
    >
      <CommandInput placeholder={t.cmdSearchPlaceholder} />
      <CommandList>
        <CommandEmpty>{t.cmdEmpty}</CommandEmpty>

        {/* ── 导航 ── */}
        <CommandGroup heading={t.cmdGroupNavigation}>
          <CommandItem
            onSelect={() => {
              setRoute('workspace');
              onOpenChange(false);
            }}
            disabled={route === 'workspace'}
          >
            <LayoutDashboardIcon />
            <span>{t.cmdGoDashboard}</span>
            <CommandShortcut>⌘ D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setRoute('themes');
              onOpenChange(false);
            }}
            disabled={route === 'themes'}
          >
            <PaletteIcon />
            <span>{t.cmdGoThemes}</span>
            <CommandShortcut>⌘ T</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setRoute('settings');
              onOpenChange(false);
            }}
            disabled={route === 'settings'}
          >
            <SettingsIcon />
            <span>{t.cmdGoSettings}</span>
            <CommandShortcut>⌘ ,</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setRoute('workspace');
              onOpenChange(false);
            }}
            disabled={route === 'workspace'}
          >
            <AppWindowIcon />
            <span>{t.cmdGoWorkspace}</span>
            <CommandShortcut>⌘ W</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => {
              setRoute('wallpaper');
              onOpenChange(false);
            }}
            disabled={route === 'wallpaper'}
          >
            <ImageIcon />
            <span>{t.cmdGoWallpaper}</span>
            <CommandShortcut>⌘ I</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* ── 主题 ── */}
        {themes.length > 0 && <CommandGroup heading={t.cmdGroupThemes}>{themeItems}</CommandGroup>}

        <CommandSeparator />

        {/* ── 操作 ── */}
        <CommandGroup heading={t.cmdGroupActions}>
          <CommandItem onSelect={toggleThemeMode}>
            <SunIcon className="dark:hidden" />
            <MoonIcon className="hidden dark:block" />
            <span>{t.cmdToggleThemeMode}</span>
          </CommandItem>
          <CommandItem disabled>
            <RotateCcwIcon />
            <span>{t.cmdScanAgents}</span>
          </CommandItem>
          <CommandItem disabled>
            <BugIcon />
            <span>{t.cmdDevTools}</span>
            <CommandShortcut>⌘ ⌥ I</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
