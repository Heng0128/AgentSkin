// SPDX-License-Identifier: MPL-2.0

/**
 * # CommandPalette
 *
 * Global Cmd+K / Ctrl+K command palette. Swiss/International style:
 * bg-popover surface, border-border, rounded-[2px], hover uses bg-accent.
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
  const { route, setRoute, installed: themes, activeAgentId } = controller;

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
      themes.map((t: ThemeCatalogItem) => (
        <CommandItem
          key={`theme:${t.id}`}
          onSelect={() => {
            void applyThemeByName(t.id, t.name);
            onOpenChange(false);
          }}
        >
          <PaletteIcon />
          <span className="truncate">应用主题 → {t.name}</span>
        </CommandItem>
      )),
    [themes, applyThemeByName, onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="命令面板"
      description="输入命令或搜索"
    >
      <CommandInput placeholder="输入命令或搜索..." />
      <CommandList>
        <CommandEmpty>无结果</CommandEmpty>

        {/* ── 导航 ── */}
        <CommandGroup heading="导航">
          <CommandItem
            onSelect={() => {
              setRoute('dashboard');
              onOpenChange(false);
            }}
            disabled={route === 'dashboard'}
          >
            <LayoutDashboardIcon />
            <span>仪表盘</span>
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
            <span>主题库</span>
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
            <span>设置</span>
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
            <span>工作空间</span>
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
            <span>壁纸引擎</span>
            <CommandShortcut>⌘ I</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* ── 主题 ── */}
        {themes.length > 0 && <CommandGroup heading="主题">{themeItems}</CommandGroup>}

        <CommandSeparator />

        {/* ── 操作 ── */}
        <CommandGroup heading="操作">
          <CommandItem onSelect={toggleThemeMode}>
            <SunIcon className="dark:hidden" />
            <MoonIcon className="hidden dark:block" />
            <span>切换主题模式</span>
          </CommandItem>
          <CommandItem disabled>
            <RotateCcwIcon />
            <span>重新扫描 Agent</span>
          </CommandItem>
          <CommandItem disabled>
            <BugIcon />
            <span>开发者工具</span>
            <CommandShortcut>⌘ ⌥ I</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
