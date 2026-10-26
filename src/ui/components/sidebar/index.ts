// SPDX-License-Identifier: MPL-2.0

/**
 * # sidebar (barrel)
 *
 * Composable Sidebar component suite.
 *
 * Tree:
 *   SidebarProvider                ← Context wrapper (collapsed = MOUNTED
 *                                    branch state; may lag the store during
 *                                    the two-phase collapse hand-off — App
 *                                    stages the swap via `presentation`)
 *   ├── SidebarRail (collapsed)   ← 56px icon column
 *   └── SidebarContent (expanded) ← 192px sidebar body
 *       ├── header                ← brand + hover-reveal collapse affordance
 *       └── SidebarMenu           ← navigation items
 *           ├── SidebarMenuItem   ← single nav entry
 *           └── SidebarMenuSub    ← community sub-sources
 *
 * Animation contract (App.tsx owns the staging): the grid column tweens via
 * `--sidebar-width` while each branch holds its FIXED target width
 * (SIDEBAR_EXPANDED_WIDTH / SIDEBAR_COLLAPSED_WIDTH) — collapse slides the
 * expanded body out under the clip and swaps to the rail after the tween;
 * expand swaps immediately and reveals. The full-height divider lives on
 * App's column wrapper so it rides the animated edge.
 *
 * `SidebarToggle` and `RunningAgentList` were removed (2026-09-07 UX pass):
 * collapse/expand moved into the header as a hover-reveal affordance, and the
 * agent status strip left the sidebar entirely.
 */

export { SidebarContent } from './SidebarContent';
export { SidebarMenu } from './SidebarMenu';
export { SidebarMenuItem } from './SidebarMenuItem';
export { SidebarMenuSub } from './SidebarMenuSub';
export { SidebarProvider, useSidebar } from './SidebarProvider';
export { SidebarRail } from './SidebarRail';
export { SidebarTooltip } from './SidebarTooltip';
export { SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_EXPANDED_WIDTH } from './sidebarSurface';
