// SPDX-License-Identifier: MPL-2.0

import { api } from '@/api/agentSkinClient';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import type { Route } from '@/types/navigation';

import {
  File01Icon,
  Home02Icon,
  Image02Icon,
  PaintBoardIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';

interface NavEntry {
  route: Route;
  icon: typeof Home02Icon;
  label: string;
}

/**
 * Swiss/International-style sidebar.
 *
 * Structure:
 *   Brand (top)
 *   Navigation — grouped by Swiss section labels (CORE / SYSTEM), mono
 *     uppercase labels with wide tracking, active item gets a 3px red
 *     left rule (the classic Swiss "red line" indicator)
 *   Footer — Studio / Logs / Collapse
 *
 * Width: 224px expanded · 62px collapsed.
 */
export function Sidebar({ controller }: { controller: AppController }) {
  const { t } = controller;
  const collapsed = controller.sidebarCollapsed;

  // Swiss grouping — mirrors the A.html reference nav (CORE / MANAGE / SYSTEM).
  const navGroups: Array<{ label: string; items: NavEntry[] }> = [
    {
      label: t.navGroupCore,
      items: [
        { route: 'workspace', icon: Home02Icon, label: t.navWorkspace },
        { route: 'themes', icon: PaintBoardIcon, label: t.navThemes },
        { route: 'wallpaper', icon: Image02Icon, label: t.navWallpaperEngine },
      ],
    },
    {
      label: t.navGroupSystem,
      items: [{ route: 'settings', icon: Settings01Icon, label: t.navSettings }],
    },
  ];

  const NavButton = ({ item }: { item: NavEntry }) => {
    const active = controller.route === item.route;
    return (
      <Button
        variant="ghost"
        onClick={() => controller.setRoute(item.route)}
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={cn(
          'group relative h-[37px] justify-start gap-2.5 rounded-[2px] m-[2px_9px] text-muted-foreground font-medium transition-all duration-fast ease-out',
          collapsed && 'justify-center m-[2px_8px] p-0',
          'hover:bg-card2 hover:text-foreground',
          active && 'bg-accent text-foreground shadow-[inset_3px_0_0_var(--primary)]',
          active && '[&_svg]:text-primary',
        )}
      >
        <HugeIcon icon={item.icon} className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="text-[12.5px] truncate">{item.label}</span>}
      </Button>
    );
  };

  return (
    <aside
      style={{
        width: collapsed ? 62 : 224,
        transition: 'width 240ms cubic-bezier(.16,1,.3,1)',
        background: 'var(--surface)',
        borderRight: '1px solid var(--border)',
      }}
      className="flex h-full min-h-0 flex-col overflow-hidden flex-none z-[4]"
    >
      {/* Brand — clicking the logo toggles the collapsed state (Swiss: the
          brand mark doubles as the collapse control; the footer button
          remains as a secondary affordance). */}
      <button
        type="button"
        onClick={controller.toggleSidebar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            controller.toggleSidebar();
          }
        }}
        title={collapsed ? t.expandSidebar : t.collapseSidebar}
        aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
        aria-pressed={collapsed}
        className={cn(
          'flex items-center gap-2.5 px-4 py-3 shrink-0 cursor-pointer bg-transparent border-0 text-left transition-colors duration-fast',
          collapsed && 'justify-center px-0',
        )}
      >
        <Logo
          variant="color"
          className="size-7 shrink-0 transition-transform duration-250 ease-[cubic-bezier(.34,1.56,.64,1)] hover:rotate-[-4deg] hover:scale-105"
        />
        {!collapsed && (
          <span className="min-w-0 truncate font-display text-[13px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
            AgentSkin
          </span>
        )}
      </button>

      {/* Navigation — Swiss grouped sections */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden pt-2.5 pb-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-1">
            {!collapsed && (
              <div className="px-[18px] pt-1 pb-1 font-mono text-[8.5px] font-semibold tracking-[.18em] uppercase text-[var(--muted-foreground)]">
                {group.label}
              </div>
            )}
            <div className="flex flex-col">
              {group.items.map((item) => (
                <NavButton key={item.route} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--border)] p-2 flex flex-col gap-1.5">
        {/* Theme Studio — dashed border, hover red */}
        <button
          type="button"
          onClick={() => void api.openStudioWindow()}
          title={collapsed ? t.navStudio : undefined}
          className={cn(
            'flex h-8 w-full items-center justify-center gap-2 rounded-[2px] border border-dashed border-[var(--border-strong)] bg-transparent text-[11px] font-medium text-[var(--muted-foreground)] cursor-pointer whitespace-nowrap transition-colors duration-fast',
            'hover:text-primary hover:border-primary hover:bg-accent',
            collapsed && 'px-0',
          )}
        >
          <HugeIcon icon={PaintBoardIcon} className="size-3.5 shrink-0" />
          {!collapsed && <span>{t.navStudio}</span>}
        </button>

        {/* Logs */}
        <button
          type="button"
          onClick={() => controller.setLogsOpen(true)}
          title={collapsed ? t.showLogs : undefined}
          className={cn(
            'flex h-[30px] w-full items-center justify-center gap-2 rounded-[2px] border-0 bg-transparent text-[var(--muted-foreground)] cursor-pointer text-[10.5px] font-medium whitespace-nowrap transition-colors duration-fast',
            'hover:bg-card2 hover:text-[var(--foreground)]',
            collapsed && 'px-0',
          )}
        >
          <HugeIcon icon={File01Icon} className="size-3.5 shrink-0" />
          {!collapsed && <span>{t.showLogs}</span>}
        </button>

        {/* Collapse / expand toggle */}
        <button
          type="button"
          onClick={controller.toggleSidebar}
          title={collapsed ? t.expandSidebar : t.collapseSidebar}
          aria-label={collapsed ? t.expandSidebar : t.collapseSidebar}
          aria-pressed={collapsed}
          className={cn(
            'flex h-[30px] w-full items-center justify-center gap-2 rounded-[2px] border-0 bg-transparent text-[var(--muted-foreground)] cursor-pointer text-[10.5px] font-medium whitespace-nowrap transition-colors duration-fast',
            'hover:bg-card2 hover:text-[var(--foreground)]',
            collapsed && 'px-0',
          )}
        >
          <HugeIcon
            icon={collapsed ? PanelLeftOpenIcon : PanelLeftCloseIcon}
            className="size-3.5 shrink-0"
          />
          {!collapsed && <span>{t.collapseSidebar}</span>}
        </button>
      </div>
    </aside>
  );
}
