// SPDX-License-Identifier: MPL-2.0

/**
 * # sidebarSurface
 *
 * Single source of truth for the sidebar's *container chrome* — the shell
 * background, border, header row and the hover-revealed collapse/expand
 * affordance. Both `SidebarRail` (collapsed) and `SidebarContent` (expanded)
 * consume these classes.
 *
 * ## Why this module exists
 *
 * The two branches used to style the same surface independently:
 *   - `SidebarContent` → `bg-surface` + `border-border`
 *   - `SidebarRail`    → inline `backgroundColor: var(--sidebar, rgba(15,23,42,.75))`
 *                        + `border-r` + `backdrop-blur-md`
 * `--sidebar` and `--surface` resolve to the same hex, so the *colour* matched
 * by accident — but the rail's `backdrop-blur-md` sat behind a fully opaque
 * background (zero visual effect, a real GPU compositing cost per frame while
 * the wallpaper layer animates), and the two different border tokens made the
 * divider change weight on every collapse toggle.
 *
 * Sharing one class set fixes both, and makes the swap read as one continuous
 * panel rather than two different widgets.
 *
 * ## Token consumption
 *
 * These classes move the sidebar onto the `--sidebar-*` family that
 * `docs/design-tokens.md` §9.1 documents but nothing consumed (only the rail's
 * inline fallback did). Values are identical to the previous `--surface` /
 * `--border` usage in both themes, so this is a wiring change, not a
 * re-colouring — with the benefit that a theme can now retint the navigation
 * chrome independently of the page surface.
 */

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sidebar branch widths — the single source for BOTH consumers:
 *   - `App` feeds them into `--sidebar-width` (the animated grid column);
 *   - each branch pins its own content to the TARGET width via inline style,
 *     so the body never reflows while the column tweens — the column's
 *     `overflow-hidden` does the revealing/clipping instead (fixed-width
 *     slide-out on collapse, fixed-width reveal on expand).
 */
export const SIDEBAR_EXPANDED_WIDTH = '12rem'; // 192px
export const SIDEBAR_COLLAPSED_WIDTH = '3.5rem'; // 56px

/**
 * Sidebar *sub-token bridge* (v2.8 视觉优化).
 *
 * Binds the `--ag-sidebar-*` family on the sidebar root; every descendant
 * (menu rows, hairlines, the globals.css scrollbar/reveal overrides)
 * inherits them. All values derive from the core `--sidebar-*` family through
 * `color-mix`, so a theme retints the navigation chrome by touching only the
 * core family. Every CSS consumer also carries an inline fallback matching
 * these values, so isolated renders without the binding degrade to the
 * pre-v2.8 look instead of breaking.
 *
 * v2.9: `--ag-sidebar-bg` was REMOVED — the one-canvas model paints the shell
 * with the plain page surface, so the nav-region tint bridge lost its last
 * consumer (the shell used to be the only one). `--ag-sidebar-logo-halo` was
 * removed with it: its only consumer was the rail logo's hover halo, a dead
 * style from the start (hovering the logo means the sidebar is hovered, which
 * is exactly when the logo fades out for the expand button).
 */
export function bindSidebarSubTokens(hasWallpaper: boolean): CSSProperties {
  return {
    // Hover: derived from the surface itself — depth comes from luminance,
    // not from a foreign colour, so any retint of --sidebar stays coherent.
    // Glass mode needs a stronger wash: hover states sit directly on the
    // moving wallpaper, so a 5% wash drowns against bright content.
    '--ag-sidebar-item-hover': hasWallpaper
      ? 'color-mix(in srgb, var(--sidebar-foreground) 8%, transparent)'
      : 'color-mix(in srgb, var(--sidebar-foreground) 5%, transparent)',
    '--ag-sidebar-item-active': 'var(--sidebar-accent)',
    // Divider pinned to the foreground's alpha family: the hairlines fade at
    // the same rate the text does across themes.
    '--ag-sidebar-hairline': 'color-mix(in srgb, var(--sidebar-foreground) 9%, transparent)',
    // Scrollbar thumb while the pointer rests inside the nav (globals.css).
    '--ag-sidebar-scroll-hover': 'color-mix(in srgb, var(--sidebar-foreground) 10%, transparent)',
    // Expanded-row hover shift — keeps the 3px step theme-adjustable.
    '--ag-sidebar-hover-shift': '3px',
  } as CSSProperties;
}

/**
 * The sidebar shell.
 *
 * `w-full` (not a fixed 192px/56px) is deliberate: `App.tsx` owns the geometry
 * through `--sidebar-width` on the grid column and animates it. A fixed child
 * width snapped to its final size on the first frame while the column was still
 * tweening, so the panel visibly detached from its own transition.
 *
 * v2.8-R2: `select-none` keeps drag-starts in the panel from initiating
 * accidental text selections (the TitleBar equivalent is inherited from its
 * drag region; the sidebar body needs its own).
 *
 * ## One canvas (v2.9)
 *
 * The whole window is ONE canvas: the shell surface equals the page surface
 * (`--background` — the `--sidebar` family is token-identical to it), and the
 * title layer is INVISIBLE chrome — `TitleBar` is only the main column's 36px
 * transparent drag strip with floating controls; it owns no visuals.
 *
 * Ownership is sidebar-first:
 *   - the brand header (logo + name + collapse affordance) belongs to the
 *     SIDEBAR, not to the title layer — it is sized as sidebar content
 *     (h-12, size-7 logo) instead of being squeezed into the title strip;
 *   - the vertical divider runs the FULL window height. It lives on App's
 *     left COLUMN wrapper, not on the branch — the branch's fixed width
 *     outruns the animating grid column, so a branch border would be clipped
 *     away mid-tween; on the column it rides the animated edge continuously;
 *   - surface structure comes from hairlines only (the divider + the menu's
 *     internal hairlines); no bar strip, no glass band, no tone seams.
 */
export function sidebarSurfaceClass(hasWallpaper: boolean, extra?: string): string {
  return cn(
    // NO width and NO border-r here: width is pinned per branch (the target
    // width via inline style — see SIDEBAR_EXPANDED_WIDTH/COLLAPSED_WIDTH) so
    // the body never reflows while the grid column tweens, and the divider
    // belongs to App's column wrapper (see above).
    'flex h-full min-h-0 min-w-0 select-none flex-col overflow-hidden',
    'transition-[background-color] duration-slower ease-out',
    // One canvas: the shell surface EQUALS the page surface (`--background`;
    // the `--sidebar` token is value-identical). Transparent in wallpaper
    // mode so the wallpaper layer shows through — glass treatment belongs to
    // the cards floating above it, not to the panel itself.
    hasWallpaper ? 'bg-transparent' : 'bg-background',
    extra,
  );
}

/**
 * The global sidebar toggle shortcut (Ctrl/Cmd+\, bound in
 * `useAppController`). Declared once so BOTH header buttons announce the same
 * keys via `aria-keyshortcuts` and the strings cannot drift from the actual
 * window-level handler.
 */
export const SIDEBAR_TOGGLE_SHORTCUT = 'Control+\\ Meta+\\';

/**
 * The brand header — SIDEBAR content, not title-layer chrome.
 *
 * Ownership: the logo + name + collapse affordance belong to the sidebar
 * (the title layer is invisible drag chrome and owns no visuals), so this
 * header is sized as sidebar content: h-12 — taller than the 36px drag strip
 * so the brand breathes at sidebar proportions — and the sidebar's full-height
 * `border-r` boundary passes behind it uninterrupted.
 *
 * Transparent in both modes (brand floats on the one-canvas surface or the
 * scrimmed wallpaper); `.as-sidebar-header` makes the row a window-drag
 * region (`-webkit-app-region: drag`; buttons opt back out) so the top-left
 * of the window stays grabbable.
 *
 * NO `justify-between` here — it is the flex-layout concern of the EXPANDED
 * header (lockup left, collapse button right) and lives in that branch's
 * extra. On the collapsed rail the header is `grid place-items-center`:
 * space-between would survive twMerge (different property group than
 * place-items) and — critically — stop the single implicit grid track from
 * stretching, pinning a 28px track (and the logo filling it) to the left
 * edge, 14px off the rail's center line. Base keeps the track default
 * (`normal` → stretch) so `place-items-center` centers against the full 56px.
 */
export function sidebarHeaderClass(extra?: string): string {
  return cn('as-sidebar-header flex h-12 shrink-0 items-center gap-1', extra);
}

/**
 * Collapse / expand affordance — shared by BOTH header buttons
 * (`SidebarRail` expand, `SidebarContent` collapse).
 *
 * ALWAYS-VISIBLE by design (v2.10): the previous hover-reveal version kept the
 * button `opacity-0 + pointer-events-none` until the whole sidebar was hovered
 * (hand-written `.sidebar-reveal` rule) — which meant the affordance did not
 * EXIST for a pointer that had never entered the panel, and on the 56px rail
 * it vanished the instant the pointer drifted out mid-click. A control that
 * materialises on hover is undiscoverable and unclickable; a persistent one
 * needs no choreography.
 *
 * v2.11 (rail logo 复位): the BUTTON stays persistent — only the displayed
 * GLYPH cross-dresses. The collapsed rail shows the brand LOGO at rest and
 * crossfades to the `PanelLeftOpen` chevron on hover / keyboard focus, so the
 * 32px target is live from mount and never disappears (the pre-v2.10 failure
 * mode was the control itself hiding, not a glyph swap). The expanded panel
 * keeps its persistent `PanelLeftClose` beside the brand lockup.
 *
 * Sizing: `size-8` (32px square) — a comfortable pointer target inside the
 * h-12 header row; 28px proved tight, especially on the narrow rail.
 *
 * v2.8-R3 (统一两侧头按钮):
 *   - hover paints `--ag-sidebar-item-hover` — same surface-derived material
 *     as the menu rows, so the header affordance and the nav read as one
 *     system instead of two different widget families.
 *   - press flashes the brand accent (`--sidebar-accent`) — the rose-marks-
 *     interaction rule from the design-token principles, applied to chrome.
 */
export const SIDEBAR_HEADER_BUTTON_CLASS = cn(
  'flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground',
  'transition-[background-color,color] duration-base ease-out',
  'hover:bg-[var(--ag-sidebar-item-hover,var(--card2))] hover:text-sidebar-foreground',
  'active:bg-[var(--ag-sidebar-item-active,var(--sidebar-accent))] active:text-sidebar-accent-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
);
