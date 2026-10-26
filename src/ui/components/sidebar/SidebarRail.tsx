// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarRail
 *
 * Collapsed-only rail — a narrow (56px) activity-bar style column:
 *   - Header (h-12, the rail's OWN brand header — sidebar content, not
 *     title-layer chrome): a single PERSISTENT expand button whose visible
 *     glyph cross-dresses — the brand LOGO at rest, the `PanelLeftOpen`
 *     chevron on hover / keyboard focus. The button (32px hit target) is
 *     always present and always clickable: clicking the logo expands too,
 *     only the displayed glyph swaps, in a short opacity/scale crossfade.
 *     This revives the pre-v2.10 logo default WITHOUT its failure mode: the
 *     old hover-reveal hid the control itself (`opacity-0` +
 *     `pointer-events-none` behind a 100ms entrance delay), so a drifting
 *     pointer dissolved the target mid-click. Here the target never
 *     disappears — the choreography is purely visual, zero-delay, and the
 *     button works in both glyph states.
 *   - Icon-only navigation menu (shared SidebarMenu in collapsed mode).
 *
 * The bottom expand toggle is gone: the collapse/expand affordance lives in
 * the header, matching how VS Code / TRAE place it.
 *
 * Surface chrome comes from `./sidebarSurface`, shared verbatim with
 * `SidebarContent`. The rail used to add `backdrop-blur-md` over the opaque
 * `--sidebar` colour: the blur was invisible (nothing translucent behind it)
 * yet cost a compositing pass on every frame the wallpaper layer animated.
 */

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { PanelLeftOpen } from 'lucide-react';
import { SidebarMenu } from './SidebarMenu';
import { useSidebar } from './SidebarProvider';
import {
  bindSidebarSubTokens,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_HEADER_BUTTON_CLASS,
  SIDEBAR_TOGGLE_SHORTCUT,
  sidebarHeaderClass,
  sidebarSurfaceClass,
} from './sidebarSurface';

export function SidebarRail() {
  const locale = useShellStore((s) => s.locale);
  const { safeAreaInset, setCollapsed, hasWallpaper, requestFocusOnMount } = useSidebar();

  const expandLabel = locale === 'zh-CN' ? '展开侧边栏' : 'Expand sidebar';

  return (
    <div
      className={cn(sidebarSurfaceClass(hasWallpaper), 'shrink-0 as-fade-in')}
      // Fixed width = the COLLAPSED target width (see SidebarContent for the
      // fixed-width rationale — no reflow while the grid column tweens).
      style={{
        ...bindSidebarSubTokens(hasWallpaper),
        width: SIDEBAR_COLLAPSED_WIDTH,
        paddingTop: `${safeAreaInset}px`,
      }}
    >
      {/* Header — the SIDEBAR's own brand header row (h-12, see
          `sidebarHeaderClass`): one PERSISTENT expand button. The LOGO is
          the resting visual (brand identity stays visible on the narrow
          rail); hovering or keyboard-focusing crossfades it to the
          `PanelLeftOpen` chevron. The button itself — 32px target, live
          from mount — never changes: clicks expand in either state. */}
      <div className={sidebarHeaderClass('grid place-items-center')}>
        <button
          type="button"
          onClick={() => {
            // Expand unmounts this branch — hand focus to the rail's nav so it
            // does not drop to <body> and restart the tab order.
            requestFocusOnMount();
            setCollapsed(false);
          }}
          title={expandLabel}
          aria-label={expandLabel}
          aria-keyshortcuts={SIDEBAR_TOGGLE_SHORTCUT}
          className={cn(SIDEBAR_HEADER_BUTTON_CLASS, 'group/rail-btn relative')}
        >
          {/* Rest state: brand logo (aria-hidden — the button's label owns
              the accessible name in both glyph states). */}
          <span
            aria-hidden="true"
            className="transition duration-fast ease-out group-hover/rail-btn:scale-95 group-hover/rail-btn:opacity-0 group-focus-visible/rail-btn:scale-95 group-focus-visible/rail-btn:opacity-0"
          >
            <Logo variant="color" className="size-6 rounded-md" />
          </span>
          {/* Hover / keyboard-focus state: expand affordance. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 flex items-center justify-center scale-90 opacity-0 transition duration-fast ease-out group-hover/rail-btn:scale-100 group-hover/rail-btn:opacity-100 group-focus-visible/rail-btn:scale-100 group-focus-visible/rail-btn:opacity-100"
          >
            <PanelLeftOpen className="size-4" />
          </span>
        </button>
      </div>

      {/* Icon-only navigation — collapsed mode of the shared menu. The
          sidebar's vertical divider is owned by App's full-height column
          wrapper (`sidebarSurface` doc), not by this region.
          w-full so the nav fills the 56px rail and its items center on it. */}
      <div className="flex w-full min-h-0 flex-1 flex-col">
        <SidebarMenu />
      </div>
    </div>
  );
}
