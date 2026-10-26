// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarContent
 *
 * The expanded sidebar body — rendered only when the sidebar is NOT
 * collapsed.
 *
 * Structure:
 *   - Header (h-12, the SIDEBAR's own brand header — sidebar content, NOT
 *     title-layer chrome; see `sidebarHeaderClass`): brand chip + app name on
 *     the LEFT (left-aligned is the standard sidebar header — a centered
 *     orphan logo wastes both flanks), and an ALWAYS-VISIBLE `PanelLeftClose`
 *     collapse affordance on the right (v2.10). The previous hover-reveal
 *     version made the control conditional on entering the panel first — a
 *     hint you had to summon before you could use it. A persistent 32px
 *     button is discoverable at rest, live under the pointer, and matches
 *     how VS Code / Linear keep their sidebar toggles.
 *   - Navigation menu (SidebarMenu), with Settings pinned to the bottom.
 *     The sidebar's vertical divider is owned by the shell
 *     (`sidebarSurfaceClass`) and runs the FULL window height.
 *
 * The old bottom RunningAgentList (status dot + agent names) was removed from
 * the sidebar per UX direction — the sidebar is navigation-only.
 *
 * Container chrome is shared with `SidebarRail` through `./sidebarSurface`, so
 * the two branches of the same panel cannot drift apart visually.
 */

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { PanelLeftClose } from 'lucide-react';
import { SidebarMenu } from './SidebarMenu';
import { useSidebar } from './SidebarProvider';
import {
  bindSidebarSubTokens,
  SIDEBAR_EXPANDED_WIDTH,
  SIDEBAR_HEADER_BUTTON_CLASS,
  SIDEBAR_TOGGLE_SHORTCUT,
  sidebarHeaderClass,
  sidebarSurfaceClass,
} from './sidebarSurface';

export function SidebarContent() {
  const locale = useShellStore((s) => s.locale);
  const { safeAreaInset, setCollapsed, hasWallpaper, requestFocusOnMount } = useSidebar();

  const collapseLabel = locale === 'zh-CN' ? '收起侧边栏' : 'Collapse sidebar';

  return (
    <aside
      className={cn(sidebarSurfaceClass(hasWallpaper), 'as-fade-in')}
      // Fixed width = the EXPANDED target width. The animated grid column
      // (App's --sidebar-width) clips this while tweening, so collapsing
      // slides the 192px body out of view without any reflow, and expanding
      // reveals it without a squeeze-then-stretch pass.
      style={{
        ...bindSidebarSubTokens(hasWallpaper),
        width: SIDEBAR_EXPANDED_WIDTH,
        paddingTop: `${safeAreaInset}px`,
      }}
    >
      {/* Header — the SIDEBAR's own brand header (not title-layer chrome):
          lockup left, persistent collapse affordance right. Sized at
          sidebar proportions (h-12 / size-7 logo — see `sidebarHeaderClass`),
          transparent over the one-canvas surface. `justify-between` belongs
          to THIS flex branch (see sidebarHeaderClass — it must not leak into
          the rail's grid layout). */}
      <div className={sidebarHeaderClass('justify-between pl-3 pr-2')}>
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo variant="color" className="size-7 shrink-0 rounded-md" />
          {/* Wordmark only: the product name carries the text colour. The
              version number was removed — runtime metadata does not belong in
              the identity lockup (it lives in Settings). */}
          <span className="truncate text-sm font-semibold tracking-tight text-sidebar-foreground">
            AgentSkin
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            // Collapse unmounts this branch — hand focus to the rail's nav so it
            // does not drop to <body> and restart the tab order.
            requestFocusOnMount();
            setCollapsed(true);
          }}
          title={collapseLabel}
          aria-label={collapseLabel}
          aria-keyshortcuts={SIDEBAR_TOGGLE_SHORTCUT}
          className={SIDEBAR_HEADER_BUTTON_CLASS}
        >
          <PanelLeftClose className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Middle — navigation menu. The sidebar's vertical divider is NOT here:
          it belongs to App's full-height column wrapper (sidebarSurface doc),
          so the boundary line runs top-to-bottom like any other region edge. */}
      <div className="flex min-h-0 flex-1 flex-col">
        <SidebarMenu />
      </div>
    </aside>
  );
}
