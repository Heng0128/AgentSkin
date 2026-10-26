// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenu
 *
 * Renders the full navigation list, switching between expanded (icon +
 * label) and collapsed (icon-only) modes based on sidebar state.
 *
 * Layout: primary destinations fill the top, `Settings` is pinned to the bottom
 * behind a hairline (`mt-auto`). Settings is a different kind of destination —
 * system preferences rather than a work surface — and the trailing slot is both
 * where users look for it and what gives the panel a readable top/bottom frame.
 *
 * Keyboard navigation walks the RENDERED buttons (`[data-nav-item]`) rather than
 * the NAV_ITEMS table, so ArrowUp/ArrowDown also reach the community sub-source
 * rows, which the index-based version silently skipped over. Home/End jump to
 * the ends; ArrowRight expands the rail; ArrowLeft / Escape collapse it.
 *
 * Focus policy: the menu never claims focus just because it mounted. The old
 * `focus the active item on mount` effect fired on every rail⇄content remount,
 * so collapsing the sidebar yanked focus out of whatever the user was doing,
 * including on the very first paint. Focus is only taken when a toggle handler
 * asked for it via `requestFocusOnMount()` (see SidebarProvider).
 */

import { Fragment, useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
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
  /** Pinned items sit below the hairline, flush with the panel's bottom edge. */
  pinned?: boolean;
}

const NAV_ITEMS: NavDef[] = [
  { route: 'themes', labelKey: 'navThemes', icon: PaintBucket },
  { route: 'wallpaper', labelKey: 'navWallpaperEngine', icon: Image },
  { route: 'workspace', labelKey: 'navWorkspace', icon: Home },
  { route: 'apps', labelKey: 'navApps', icon: LayoutGrid },
  { route: 'community', labelKey: 'navCommunity', icon: Users },
  { route: 'settings', labelKey: 'navSettings', icon: Settings, pinned: true },
];

export function SidebarMenu() {
  const locale = useShellStore((s) => s.locale);
  const route = useShellStore((s) => s.route);
  const { collapsed, setCollapsed, setFocusedRoute, requestFocusOnMount, consumeFocusIntent } =
    useSidebar();
  const t = uiMessages[locale as 'zh-CN' | 'en'];

  const navRef = useRef<HTMLElement | null>(null);

  // Take focus only when a collapse/expand activation asked us to — never on a
  // plain mount (see the focus-policy note in the header comment).
  useEffect(() => {
    if (!consumeFocusIntent()) return;
    const root = navRef.current;
    if (!root) return;
    const target =
      root.querySelector<HTMLElement>('[aria-current="page"]') ??
      root.querySelector<HTMLElement>('[data-nav-item]');
    target?.focus();
  }, [consumeFocusIntent]);

  /** Rendered, enabled nav buttons in visual (DOM) order — includes sub-rows. */
  const navButtons = useCallback((): HTMLElement[] => {
    const root = navRef.current;
    if (!root) return [];
    return Array.from(
      root.querySelectorAll<HTMLElement>('[data-nav-item]:not([aria-disabled="true"])'),
    );
  }, []);

  const focusAt = useCallback(
    (items: HTMLElement[], index: number) => {
      const target = items[index];
      if (!target) return;
      target.focus();
      const nextRoute = target.dataset.navRoute;
      if (nextRoute) setFocusedRoute(nextRoute as Route);
    },
    [setFocusedRoute],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const items = navButtons();
    if (items.length === 0) return;
    const active = document.activeElement;
    const current = active instanceof HTMLElement ? items.indexOf(active) : -1;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (current === -1) focusAt(items, 0);
        else focusAt(items, (current + 1) % items.length);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (current === -1) focusAt(items, items.length - 1);
        else focusAt(items, (current - 1 + items.length) % items.length);
        break;
      }
      case 'Home': {
        e.preventDefault();
        focusAt(items, 0);
        break;
      }
      case 'End': {
        e.preventDefault();
        focusAt(items, items.length - 1);
        break;
      }
      case 'ArrowRight': {
        if (!collapsed) return;
        e.preventDefault();
        requestFocusOnMount();
        setCollapsed(false);
        break;
      }
      case 'ArrowLeft':
      case 'Escape': {
        if (collapsed) return;
        e.preventDefault();
        requestFocusOnMount();
        setCollapsed(true);
        break;
      }
      default:
        break;
    }
  };

  const renderItem = (item: NavDef) => {
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
      <Fragment key={item.route}>
        <SidebarMenuItem
          route={effectiveRoute}
          label={t[item.labelKey]}
          icon={item.icon}
          active={showAsActive}
          collapsed={collapsed}
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
      </Fragment>
    );
  };

  const primary = NAV_ITEMS.filter((item) => !item.pinned);
  const pinned = NAV_ITEMS.filter((item) => item.pinned);

  return (
    <nav
      ref={navRef}
      onKeyDown={handleKeyDown}
      className={cn(
        // Vertical-only scrolling. overflow-x-hidden is load-bearing: any
        // horizontal overflow here grows a visible horizontal scrollbar and
        // lets the menu pan sideways (see SidebarTooltip portal note).
        // `scroll-fade-y` masks the scrollport edges so items dissolve under
        // the header/footer boundaries while scrolling instead of being cut
        // by them — scroll-driven, zero fade at rest (C13-safe: the utility
        // ships from shadcn-tailwind.css). `sidebar-nav-scroll` scopes the
        // thumb to a hover-only hairline instead of the global gray bar.
        'sidebar-nav-scroll scroll-fade-y flex min-w-0 flex-1 flex-col items-stretch gap-1 overflow-y-auto overflow-x-hidden py-3',
        collapsed ? 'items-center px-2.5' : 'px-3',
      )}
      aria-label={locale === 'zh-CN' ? '主导航' : 'Main navigation'}
    >
      {primary.map(renderItem)}

      {/* Pinned footer — Settings, separated by the panel's own hairline.
          v2.8: the divider consumes `--ag-sidebar-hairline` (foreground-alpha
          family) instead of the border token, so it fades in lockstep with
          the text across themes; the collapsed rail keeps its short centred
          hairline. */}
      <div className="mt-auto flex w-full min-w-0 flex-col gap-1 pt-3">
        <span
          className={cn(
            'h-px w-full bg-[var(--ag-sidebar-hairline,var(--sidebar-border))]',
            collapsed && 'w-6 self-center',
          )}
          aria-hidden="true"
        />
        {pinned.map(renderItem)}
      </div>
    </nav>
  );
}
