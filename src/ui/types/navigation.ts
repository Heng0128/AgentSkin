// SPDX-License-Identifier: MPL-2.0

/**
 * Navigation model �?replaces the legacy
 * `View = 'store' | 'installed'` enum.
 *
 * AgentSkin is an Agent management platform, not a theme store. The primary
 * navigation reflects this:
 *
 *   🏠 Workspace  �?my AI programming environment: agents, recent themes, activity
 *   🤖 Agents     �?agent list + per-agent environment detail
 *   🎨 Themes     �?local theme library (not a store)
 *   �? Settings   �?preferences, app paths
 *
 * The old 'store' / 'installed' views are merged into Themes.
 */

export type Route = 'workspace' | 'themes' | 'wallpaper' | 'settings';
