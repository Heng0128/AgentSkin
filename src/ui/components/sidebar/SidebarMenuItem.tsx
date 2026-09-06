// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenuItem
 *
 * Single navigation entry. Displays:
 *   - Active indicator bar (left 3px accent line)
 *   - Lucide icon (15px — standard icon size)
 *   - Localized label (13px medium) — hidden in collapsed rail
 *
 * Interaction models:
 *   - Click → navigate
 *   - Hover (collapsed) → show tooltip + trigger hover-to-open intermediate layer
 *   - Keyboard: ↑↓ cycle focus, Enter/Space activate, Esc collapse
 *   - Touch: long-press (600ms) shows popover menu
 *
 * Swiss/International: 6px radius, bg-accent on active, no spring ease,
 * no icon scale transform (removes per UX audit feedback #13).
 */

import { useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import type { Route } from '@/types/navigation';

import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import { useSidebar } from './SidebarProvider';
import { SidebarTooltip } from './SidebarTooltip';

export interface SidebarMenuItemProps {
  route: Route;
  label: string;
  icon: LucideIcon;
  /** When true, renders the active indicator bar. */
  active: boolean;
  /** When true, item is inside the collapsed rail (icon-only view). */
  collapsed: boolean;
  /** Optional badge (e.g. agent count). */
  badge?: number;
  /** Disabled state (e.g. offline community source). */
  disabled?: boolean;
  /** Whether this item triggers a submenu expand. */
  expandable?: boolean;
  expanded?: boolean;
  ariaControls?: string;
}

export function SidebarMenuItem({
  route,
  label,
  icon: Icon,
  active,
  collapsed,
  badge = 0,
  disabled = false,
  expandable = false,
  expanded = false,
  ariaControls,
}: SidebarMenuItemProps) {
  const setRoute = useShellStore((s) => s.setRoute);
  const { setHoveredRoute, registerTimer, setFocusedRoute, hoveredRoute } = useSidebar();
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClick = useCallback(() => {
    if (disabled) return;
    setRoute(route);
  }, [route, disabled, setRoute]);

  const handleMouseEnter = useCallback(() => {
    if (collapsed) {
      hoverTimerRef.current = setTimeout(() => {
        setHoveredRoute(route);
      }, 300);
      registerTimer(hoverTimerRef.current);
    }
  }, [collapsed, route, setHoveredRoute, registerTimer]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (collapsed) setHoveredRoute(null);
  }, [collapsed, setHoveredRoute]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const widthClass = collapsed ? 'size-8 justify-center' : 'h-8 w-full gap-2.5 px-2.5';

  return (
    <SidebarTooltip label={label} visible={collapsed && hoveredRoute === route}>
      <span className={cn('relative inline-flex w-full', collapsed ? 'justify-center' : '')}>
        <button
          type="button"
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onFocus={() => setFocusedRoute(route)}
          onKeyDown={handleKeyDown}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? label : undefined}
          aria-disabled={disabled || undefined}
          aria-expanded={expandable ? expanded : undefined}
          aria-controls={ariaControls}
          tabIndex={0}
          className={cn(
            'group relative flex w-full items-center rounded-[6px] text-muted-foreground',
            'transition-colors duration-fast',
            'hover:bg-card2 hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            widthClass,
            active && !disabled && 'bg-accent text-accent-foreground',
            disabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {/* Active indicator — 3px left accent line */}
          {active && !disabled && (
            <span
              className="as-brand-line absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full"
              aria-hidden="true"
            />
          )}

          <Icon
            className="shrink-0 size-[15px]"
            strokeWidth={active ? 2.2 : 1.8}
            aria-hidden="true"
          />

          {/* Label — expanded only */}
          {!collapsed && (
            <span className="flex-1 truncate text-left text-[13px] font-medium">{label}</span>
          )}

          {/* Chevron for expandable (expanded mode only) */}
          {expandable && !collapsed && (
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-base',
                expanded && 'rotate-180',
              )}
              aria-hidden="true"
            />
          )}

          {/* Badge — collapsed: dot; expanded: count pill */}
          {badge > 0 &&
            (collapsed ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary"
                aria-hidden="true"
              />
            ) : (
              <span className="ml-auto rounded-[6px] bg-card2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {badge}
              </span>
            ))}
        </button>
      </span>
    </SidebarTooltip>
  );
}
