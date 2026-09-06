// SPDX-License-Identifier: MPL-2.0

/**
 * # sidebar (barrel)
 *
 * Composable Sidebar component suite — Swiss/International design system.
 *
 * Tree:
 *   SidebarProvider                ← Context wrapper
 *   ├── SidebarRail (collapsed)   ← narrow icon column
 *   └── SidebarContent (expanded) ← full sidebar body
 *       ├── SidebarMenu            ← navigation items
 *       │   ├── SidebarMenuItem    ← single nav entry
 *       │   └── SidebarMenuSub     ← community sub-sources
 *       ├── RunningAgentList       ← bottom status strip
 *       └── SidebarToggle          ← collapse/expand button
 */

export { RunningAgentList } from './RunningAgentList';
export { SidebarContent } from './SidebarContent';
export { SidebarMenu } from './SidebarMenu';
export { SidebarMenuItem } from './SidebarMenuItem';
export { SidebarMenuSub } from './SidebarMenuSub';
export { SidebarProvider, useSidebar } from './SidebarProvider';
export { SidebarRail } from './SidebarRail';
export { SidebarToggle } from './SidebarToggle';
export { SidebarTooltip } from './SidebarTooltip';
