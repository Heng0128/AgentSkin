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
 */

/**
 * Community sub-routes — nest under the `community` parent route.
 * Adding a new source to the UI requires ONLY a new entry here +
 * the matching entry in the community store's `sources` record and
 * the Sidebar SOURCES config. No router changes needed.
 */
export type CommunitySubRoute = 'dreamskin' | 'codedrobe';

export type Route =
  | 'workspace'
  | 'apps'
  | 'themes'
  | 'wallpaper'
  | 'studio'
  | 'settings'
  | 'community'
  | `community.${CommunitySubRoute}`;
