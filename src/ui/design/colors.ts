// SPDX-License-Identifier: MPL-2.0

/**
 * Color tokens.
 *
 * Most UI should use Tailwind utilities (bg-background, text-foreground, …)
 * which read these CSS variables under the hood. This module exists for the
 * few places that need a concrete color value in JS — canvas theme previews,
 * charts, or inline styles that CSS classes can't reach.
 *
 * `semanticColors` references the active theme's CSS variables, so values stay
 * in sync with the light/dark toggle automatically.
 */
export const semanticColors = {
  background: 'var(--background)',
  surface: 'var(--card)',
  elevated: 'var(--popover)',
  border: 'var(--border)',
  foreground: 'var(--foreground)',
  muted: 'var(--muted-foreground)',
  accent: 'var(--primary)',
  accentForeground: 'var(--primary-foreground)',
  accentSoft: 'var(--accent)',
  success: 'var(--cr-success)',
  danger: 'var(--destructive)',
  sidebar: 'var(--sidebar)',
  sidebarForeground: 'var(--sidebar-foreground)',
} as const;

/** Static brand palette — used where CSS variables don't reach (canvas, charts). */
export const brandColors = {
  violet: '#7C3AED',
  violetHover: '#6D28D9',
  violetSoft: '#C4B5FD',
  amber: '#F2B84B',
  success: '#22C55E',
  danger: '#EF4444',
} as const;

export type SemanticColor = keyof typeof semanticColors;
export type BrandColor = keyof typeof brandColors;
