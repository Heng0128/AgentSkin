// SPDX-License-Identifier: MPL-2.0

import {
  Home02Icon,
  PaintBoardIcon,
  Settings01Icon,
  File01Icon,
  Image02Icon,
} from '@hugeicons/core-free-icons';
import type { AppController } from '@/hooks/useAppController';
import type { Route } from '@/types/navigation';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';

interface NavEntry {
  route: Route;
  icon: typeof Home02Icon;
  label: string;
}

/**
 * # Sidebar
 *
 * Product-first sidebar — Linear/Raycast style.
 *
 * Structure:
 *   Brand (top)
 *   Navigation (Workspace, Themes)
 *   Footer (Settings, Logs)
 *
 * Kept deliberately minimal — agent detection status lives on the
 * Workspace page, not the sidebar.
 */
export function Sidebar({ controller }: { controller: AppController }) {
  const { t } = controller;

  const navItems: readonly NavEntry[] = [
    { route: 'workspace', icon: Home02Icon, label: t.navWorkspace },
    { route: 'themes', icon: PaintBoardIcon, label: t.navThemes },
    { route: 'wallpaper', icon: Image02Icon, label: t.navWallpaperEngine },
  ];

  const NavButton = ({ item }: { item: NavEntry }) => {
    const active = controller.route === item.route;
    return (
      <Button
        variant="ghost"
        onClick={() => controller.setRoute(item.route)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group relative h-9 justify-start gap-2.5 rounded-[10px] px-3 text-sm font-medium transition-all duration-200 ease-out active:scale-[0.98]',
          'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-xs'
            : 'text-sidebar-foreground/60',
        )}
      >
        <HugeIcon icon={item.icon} className="size-4" />
        {item.label}
      </Button>
    );
  };

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-y-auto border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur-2xl backdrop-saturate-150">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-4 py-3">
        <Logo variant="color" className="size-7" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">AgentSkin</p>
        </div>
      </div>

      {/* Navigation */}
      <div className="mt-2 flex flex-col gap-0.5 px-2">
        {navItems.map((item) => (
          <NavButton key={item.route} item={item} />
        ))}
      </div>

      {/* Footer */}
      <div className="mt-auto border-t border-sidebar-border/60 px-2 py-3">
        <NavButton item={{ route: 'settings', icon: Settings01Icon, label: t.navSettings }} />
        <button
          type="button"
          onClick={() => controller.setLogsOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium text-sidebar-foreground/45 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground/70"
        >
          <HugeIcon icon={File01Icon} className="size-3.5" />
          {t.showLogs}
        </button>
      </div>
    </aside>
  );
}
