// SPDX-License-Identifier: MPL-2.0

/**
 * # wallpaper/constants
 *
 * Constants extracted from the split of {@link ./shared}. Shared across
 * guard, punch-through, and signal-bridge sub-modules — defined once here
 * to avoid circular imports.
 */

import {
  RENDERER_SELF_HEAL_INTERVAL_MS,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_GUARD_ID,
  WALLPAPER_HEAL_GLOBAL,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_RESIZE_GLOBAL,
  WALLPAPER_STYLE_ID,
} from '../../../shared/injection-constants';

// Re-export for consumers that reference them directly
export {
  RENDERER_SELF_HEAL_INTERVAL_MS,
  WALLPAPER_CONTAINER_ID,
  WALLPAPER_GUARD_ID,
  WALLPAPER_HEAL_GLOBAL,
  WALLPAPER_OBSERVER_GLOBAL,
  WALLPAPER_PUNCH_CLASS,
  WALLPAPER_PUNCH_GLOBAL,
  WALLPAPER_PUNCH_STYLE_ID,
  WALLPAPER_RESIZE_GLOBAL,
  WALLPAPER_STYLE_ID,
};

// ---------------------------------------------------------------------------
// Global window property names (defined here, not in injection-constants,
// because they are wallpaper-specific, not injection-protocol-level).
// ---------------------------------------------------------------------------

export const WALLPAPER_BRIDGE_GLOBAL = '__agentskinWpBridge';
export const WALLPAPER_MESSAGE_NS = '__agentskin';

// ---------------------------------------------------------------------------
// Transparency CSS
// ---------------------------------------------------------------------------

/**
 * Transparency CSS text injected by all wallpaper strategies. Extracted as a
 * shared constant so the guard function can re-create the `<style>` element
 * with identical content if the agent removes it.
 *
 * Both `html,body` AND root wrappers (`#root`, `#app`, `.app-root`) must
 * neutralize containing-block-creating properties (`transform`, `filter`,
 * `perspective`, `will-change`, `contain`). When any ancestor of a
 * `position:fixed` wallpaper element has one of these properties set, it
 * becomes the containing block — the wallpaper is then positioned relative
 * to that ancestor instead of the viewport, causing offset / clipped /
 * wrong-position rendering.
 */
// prettier-ignore
export const WALLPAPER_TRANSPARENCY_CSS =
  'html,body{background:transparent!important;background-color:transparent!important;background-image:none!important;contain:none!important;overflow:visible!important;transform:none!important;will-change:auto!important;filter:none!important;perspective:none!important}#root,#app,[data-testid="root"],.app-root,[role="application"],.monaco-workbench,.monaco-workbench>.part,.workspace-shell,.chat-container,.main-container,.app-shell,.webview-wrap{background-color:transparent!important;background-image:none!important;background:none!important;contain:none!important;overflow:visible!important;transform:none!important;will-change:auto!important;filter:none!important;perspective:none!important}';
