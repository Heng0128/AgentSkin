// SPDX-License-Identifier: MPL-2.0

import { api } from '@/api/agentSkinClient';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import type { Route } from '@/types/navigation';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { Home, Image, LayoutGrid, PaintBucket, Settings } from 'lucide-react';

interface NavEntry {
  route: Route;
  icon: typeof Home;
  label: string;
}

interface NavButtonProps {
  item: NavEntry;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

const NavButton = ({ item, active, collapsed, onClick }: NavButtonProps) => {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
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
      {(() => {
        const Icon = item.icon;
        return <Icon className="w-4 h-4 shrink-0" />;
      })()}
      {!collapsed && <span className="text-[12.5px] truncate">{item.label}</span>}
    </Button>
  );
};

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
export function Sidebar() {
  const locale = useShellStore((s) => s.locale);
  const collapsed = useShellStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useShellStore((s) => s.toggleSidebar);
  const route = useShellStore((s) => s.route);
  const setRoute = useShellStore((s) => s.setRoute);
  const t: UiMessages = uiMessages[locale];

  // Swiss grouping — mirrors the A.html reference nav (CORE / MANAGE / SYSTEM).
  const navGroups: Array<{ label: string; items: NavEntry[] }> = [
    {
      label: t.navGroupCore,
      items: [
        { route: 'workspace', icon: Home, label: t.navWorkspace },
        { route: 'apps', icon: LayoutGrid, label: t.navApps },
        { route: 'themes', icon: PaintBucket, label: t.navThemes },
        { route: 'wallpaper', icon: Image, label: t.navWallpaperEngine },
      ],
    },
    {
      label: t.navGroupSystem,
      items: [{ route: 'settings', icon: Settings, label: t.navSettings }],
    },
  ];

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
        onClick={toggleSidebar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSidebar();
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
        <Logo variant="color" className="size-7 shrink-0" />
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
              <div className="px-[18px] pt-1 pb-1 font-mono text-[10px] font-semibold tracking-[.18em] uppercase text-[var(--muted-foreground)]">
                {group.label}
              </div>
            )}
            <div className="flex flex-col">
              {group.items.map((item) => (
                <NavButton
                  key={item.route}
                  item={item}
                  active={route === item.route}
                  collapsed={collapsed}
                  onClick={() => setRoute(item.route)}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t border-[var(--border)] p-2 flex flex-col gap-1.5">
        {/* Studio — dashed border, hover red */}
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
          <PaintBucket className="size-3.5 shrink-0" />
          {!collapsed && <span>{t.navStudio}</span>}
        </button>
      </div>
    </aside>
  );
}
