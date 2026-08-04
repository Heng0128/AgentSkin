// SPDX-License-Identifier: MPL-2.0

/** Motion tokens — durations in ms, easings as CSS cubic-bezier strings. */
export const durations = {
  instant: 0,
  fast: 150,
  base: 200,
  slow: 300,
  slower: 500,
} as const;

export const easing = {
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  inOut: 'cubic-bezier(0.65, 0, 0.35, 1)',
  standard: 'cubic-bezier(0.4, 0, 0.2, 1)',
} as const;

/**
 * Keyframe animation utility class names registered in globals.css.
 * Usage: <div className={animation.breathe} />
 */
export const animation = {
  breathe: 'animate-breathe',
  pageEnter: 'animate-page-enter',
  progress: 'animate-progress',
} as const;

export type Duration = keyof typeof durations;
export type Easing = keyof typeof easing;
