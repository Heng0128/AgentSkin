// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenu
 *
 * Renders the full navigation list, switching between expanded (icon +
 * label) and collapsed (icon-only) modes based on sidebar state.
 *
 * Handles keyboard navigation across all items via ArrowUp/ArrowDown
 * and auto-focuses the active item on mount.
 */

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import type { CommunitySubRoute, Route } from '@/types/navigation';

import { uiMessages } from '@shared/i18n';
import { Home, Image, LayoutGrid, PaintBucket, Settings, Users } from 'lucide-react';
import { SidebarMenuItem } from './SidebarMenuItem';
import { SidebarMenuSub } from './SidebarMenuSub';
import { useSidebar } from './SidebarProvider';

interface NavDef {
  route: Route;
  labelKey:
    | 'navThemes'
    | 'navWallpaperEngine'
    | 'navWorkspace'
    | 'navApps'
    | 'navSettings'
    | 'navCommunity';
  icon: typeof Home;
}

const NAV_ITEMS: NavDef[] = [
  { route: 'themes', labelKey: 'navThemes', icon: PaintBucket },
  { route: 'wallpaper', labelKey: 'navWallpaperEngine', icon: Image },
  { route: 'workspace', labelKey: 'navWorkspace', icon: Home },
  { route: 'apps', labelKey: 'navApps', icon: LayoutGrid },
  { route: 'community', labelKey: 'navCommunity', icon: Users },
  { route: 'settings', labelKey: 'navSettings', icon: Settings },
];

export function SidebarMenu() {
  const locale = useShellStore((s) => s.locale);
  const route = useShellStore((s) => s.route);
  const { collapsed, focusedRoute, setFocusedRoute } = useSidebar();
  const t = uiMessages[locale as 'zh-CN' | 'en'];

  // Running agent count (for contextual badges)
  const status = useStatusStore((s) => s.status);
  const _runningCount = status?.apps.filter((a) => a.running).length ?? 0;

  // Focus active item on mount
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const activeBtn = containerRef.current.querySelector<HTMLElement>('[aria-current="page"]');
    activeBtn?.focus();
  }, []);

  // Keyboard navigation (ArrowUp/ArrowDown)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const currentIndex = NAV_ITEMS.findIndex((item) => item.route === (focusedRoute ?? route));
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + delta + NAV_ITEMS.length) % NAV_ITEMS.length;
    setFocusedRoute(NAV_ITEMS[nextIndex].route);
    // Focus the DOM element
    const buttons = containerRef.current?.querySelectorAll<HTMLElement>('button[tabindex="0"]');
    buttons?.[nextIndex]?.focus();
  };

  return (
    <nav
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn(
        'flex flex-1 flex-col items-stretch gap-1 overflow-y-auto px-3 py-3',
        collapsed ? 'px-1' : 'px-3',
      )}
      aria-label={locale === 'zh-CN' ? '主导航' : 'Main navigation'}
    >
      {NAV_ITEMS.map((item) => {
        const active = route === item.route;
        const isCommunity = item.route === 'community';
        const isCommunityChild = typeof route === 'string' && route.startsWith('community.');
        const showAsActive = active || (isCommunity && isCommunityChild);

        // When clicking the "Community" button while NOT already in a sub-route,
        // navigate directly to the default sub-source (dreamskin) so that the
        // sub-menu renders immediately and the page shows content instead of
        // "Unknown community source".
        let effectiveRoute: Route = item.route;
        if (isCommunity && !isCommunityChild) {
          effectiveRoute = `community.${'dreamskin' as CommunitySubRoute}`;
        }

        return (
          <span key={item.route}>
            <SidebarMenuItem
              route={effectiveRoute}
              label={t[item.labelKey]}
              icon={item.icon}
              active={showAsActive}
              collapsed={collapsed}
              badge={0}
              {...(isCommunity
                ? {
                    expandable: true,
                    expanded: isCommunityChild,
                    ariaControls: 'community-subnav',
                  }
                : {})}
            />

            {/* Community submenu — only when expanded and route is under community */}
            {isCommunity && isCommunityChild && !collapsed && <SidebarMenuSub />}
          </span>
        );
      })}
    </nav>
  );
}
