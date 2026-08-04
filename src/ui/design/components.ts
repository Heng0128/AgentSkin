// SPDX-License-Identifier: MPL-2.0

/**
 * # Component design primitives
 *
 * Shared, Tailwind-class string constants so every page (Dashboard / Agents /
 * Theme Center) renders surfaces, radii, hover lifts and transitions
 * identically. Importing these prevents the `hover:-translate-y-1 shadow-lg
 * transition` soup from being re-written per page.
 *
 * These are class *strings*, not components — compose them onto a `div` or
 * shadcn `Card`. They intentionally reference the design tokens declared in
 * `globals.css` (`bg-card`, `border-border`, `shadow-*`, `animate-*`).
 */

/** Base surface: Swiss sharp panel — 2px radius + hairline border. */
export const card = 'rounded-[2px] border border-border bg-card text-card-foreground shadow-xs';

/** Padding preset for a comfortable card interior. */
export const cardPadding = 'p-4';

/** Padding preset for a denser card interior (lists, tiles). */
export const cardPaddingSm = 'p-3';

/**
 * Interactive lift: applies on hover/focus. Uses a single transition
 * property set so cards animate smoothly without layout thrash.
 * Pair with {@link card}.
 */
export const cardInteractive =
  'transition-[transform,box-shadow,background-color] duration-slow ease-out ' +
  'hover:-translate-y-0.5 hover:shadow-md';

/** Pressable / clickable card: interactive lift + pointer cursor. */
export const cardClickable = `${cardInteractive} cursor-pointer`;

/** A subtle hairline divider between card sections. */
export const cardDivider = 'border-t border-border';

/** Status dot base — size + rounding; pair with a color + motion class. */
export const statusDot = 'inline-block size-2 rounded-full';

/**
 * Map an agent/connection status to its motion class.
 * - running  → breathing (emerald, defined in globals.css)
 * - idle     → soft opacity pulse (Tailwind built-in — no base-layer edit)
 * - offline  → static muted dot
 */
export const statusMotion: Record<'running' | 'idle' | 'offline', string> = {
  running: 'animate-breathe',
  idle: 'animate-pulse',
  offline: '',
};

/** Color classes for the three statuses (matches the breathing dot palette). */
export const statusColor: Record<'running' | 'idle' | 'offline', string> = {
  running: 'bg-cr-success',
  idle: 'bg-muted-foreground/40',
  offline: 'bg-muted-foreground/25',
};
