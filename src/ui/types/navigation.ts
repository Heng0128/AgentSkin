// SPDX-License-Identifier: MPL-2.0

/**
 * Navigation model — replaces the legacy `View = 'store' | 'installed'` enum.
 *
 * AgentSkin is an Agent management platform, not a theme store. The primary
 * navigation reflects this:
 *
 *   🏠 Workspace  · live tweak panel — real-time override injection for running agents
 *   📱 Apps       · quick launcher — discover & launch local Electron apps
 *   🎨 Themes     · local theme library (not a store)
 *   🖼 Wallpaper  · wallpaper engine integration
 *   🔬 Studio     · theme visual replica + mock DOM preview
 *   ⚙️ Settings   · preferences, app paths
 *
 * The old 'dashboard' / 'agents' / 'workspace' views are merged into Workspace + Apps.
 */

export type Route = 'workspace' | 'apps' | 'themes' | 'wallpaper' | 'studio' | 'settings';
