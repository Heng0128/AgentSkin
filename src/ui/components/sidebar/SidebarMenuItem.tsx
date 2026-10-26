// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenuItem
 *
 * Single navigation entry. Displays:
 *   - Active indicator bar (3px brand line, flush with the sidebar's left edge)
 *   - Lucide icon (16px expanded / 18px rail)
 *   - Localized label (13px medium) — hidden in collapsed rail
 *
 * Interaction models:
 *   - Click → navigate
 *   - Hover (collapsed) → show tooltip + trigger hover-to-open intermediate layer
 *   - Keyboard: the row itself handles Enter/Space; ArrowUp/Down/Left/Right,
 *     Home/End and Escape are handled by the parent `SidebarMenu` (it walks the
 *     rendered `[data-nav-item]` set, which also covers the sub-rows).
 *   - Touch: long-press (600ms) shows popover menu
 *
 * Visual (v2.8): 36px target in both modes (the rail's previous 32px tile was
 * below the 40px-ish comfort floor for a pointer target that is the only way to
 * reach a page), 6px radius (`rounded-md`, --dl-radius derived — the hardcoded
 * 8px literal violated the radius contract), `--sidebar-accent` on active with
 * a brand-tinted icon, no icon scale transform (per UX audit feedback #13).
 * Hover lifts expanded rows by a 3px padding shift on the shared Spring curve,
 * gated behind `motion-safe:` so reduced-motion users get a flat hover.
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

  // Collapsed: a fixed 36px square, centered by the rail's flex column.
  // (Previously `size-8 w-full` were both present — conflicting width
  // semantics in a shrink-to-fit container made the button width unpredictable.)
  // Expanded: full-width row with comfortable padding.
  // v2.8: hover lifts the row with a 3px lateral shift (--ag-sidebar-hover-
  // shift, spacing token, var fallback for unbound renders) over
  // --duration-base. `motion-safe:` gates it so prefers-reduced-motion users
  // get a flat hover.
  const buttonClass = collapsed
    ? 'relative flex size-9 items-center justify-center rounded-md'
    : 'relative flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 motion-safe:transition-[background-color,color,padding] motion-safe:duration-base motion-safe:ease-out hover:pl-[calc(10px+var(--ag-sidebar-hover-shift,3px))]';

  // The active brand line is pinned to the sidebar's left edge (x=0) in BOTH
  // modes, so its negative inset must match each mode's nav padding: the rail
  // insets its tiles by 10px, the expanded list by 12px. A single -left-3 would
  // push the 3px bar 2px past the edge in the rail, where the nav's
  // overflow-x-hidden clips it away entirely.
  const brandLineInset = collapsed ? '-left-2.5' : '-left-3';

  return (
    <SidebarTooltip label={label} visible={collapsed && hoveredRoute === route}>
      <span className={cn('relative inline-flex', collapsed ? '' : 'w-full justify-center')}>
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
          data-nav-item=""
          data-nav-route={route}
          className={cn(
            'group text-muted-foreground',
            'transition-[background-color,color] duration-fast ease-out',
            'hover:bg-[var(--ag-sidebar-item-hover,var(--card2))] hover:text-sidebar-foreground',
            // No ring-offset: v4 defaults --tw-ring-offset-color to #fff, which
            // drew a white halo around the focus ring of the dark sidebar.
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
            buttonClass,
            active &&
              !disabled &&
              'bg-[var(--ag-sidebar-item-active,var(--sidebar-accent))] text-sidebar-accent-foreground',
            disabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {/* Active indicator — 3px brand line flush with the sidebar's left
              edge in both modes (see `brandLineInset` for the per-mode math).
              The `as-brand-line` gradient (0.8 → 0.3 alpha) IS the "soft glow"
              treatment: no extra box-shadow needed. `as-brand-line-in` scales
              the line in vertically on route switches (v2.8-R2) — the remount
              reads as the indicator sliding into place, not a hard pop. */}
          {active && !disabled && (
            <span
              className={cn(
                'as-brand-line as-brand-line-in absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full',
                brandLineInset,
              )}
              aria-hidden="true"
            />
          )}

          {/* Icon — brand-tinted on active (accent-foreground is the rose pair
              of --sidebar-accent), neutral otherwise. No scale transform: the
              UX audit (#13) explicitly rejected icon scaling. */}
          <Icon
            className={cn(
              'shrink-0',
              collapsed ? 'size-[18px]' : 'size-4',
              'transition-colors duration-base ease-out',
              active && !disabled && 'text-sidebar-accent-foreground',
            )}
            strokeWidth={active ? 2.2 : 1.8}
            aria-hidden="true"
          />

          {/* Label — expanded only. Hover nudges the label by the same 3px
              shift as the row padding, so text tracks the edge instead of
              paddings sliding under a static label. */}
          {!collapsed && (
            <span className="flex-1 truncate text-left text-ui font-medium">{label}</span>
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
              <span className="ml-auto rounded-md bg-card2 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                {badge}
              </span>
            ))}
        </button>
      </span>
    </SidebarTooltip>
  );
}
