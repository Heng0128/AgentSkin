// SPDX-License-Identifier: MPL-2.0

/**
 * Color tokens — design contract.
 *
 * This module is a **design contract**, not dead code. It mirrors the CSS
 * variables declared in `globals.css` and serves two purposes:
 *
 * 1. **Documentation** — the source of truth for semantic color names and
 *    their CSS variable bindings, so contributors don't hard-code hex values.
 * 2. **JS inline-style interop** — when a canvas context, chart library, or
 *    inline `style` attribute needs a concrete color value (CSS classes
 *    can't reach these), import from here instead of duplicating hex.
 *
 * Tailwind utilities (`bg-background`, `text-cr-success`, …) remain the
 * preferred consumption path for normal JSX className usage.
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
  warning: 'var(--cr-warning)',
  info: 'var(--cr-info)',
  danger: 'var(--destructive)',
  sidebar: 'var(--sidebar)',
  sidebarForeground: 'var(--sidebar-foreground)',
} as const;

/** Static brand palette — used where CSS variables don't reach (canvas, charts).
 *  AgentSkin brand rule: only brand red + semantic aliases. No violet/amber/rainbow. */
export const brandColors = {
  amber: 'var(--cr-warning)',
  success: 'var(--cr-success)',
  danger: 'var(--destructive)',
} as const;

export type SemanticColor = keyof typeof semanticColors;
export type BrandColor = keyof typeof brandColors;
