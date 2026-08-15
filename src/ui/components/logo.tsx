// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';

/**
 * # Logo
 *
 * AgentSkin brand mark — a rounded square with a monogram "A" constructed
 * from geometric shapes (triangle + serif + baseline bar).
 *
 * Variants:
 *   - `color`: full brand mark — **fixed** brand red on a fixed white
 *     rounded square. The mark is the product's identity and MUST stay
 *     visually identical in both dark and light themes; otherwise the
 *     dark-mode sidebar eats the white tile and the brand disappears.
 *     A subtle fixed gray border keeps the tile defined against any
 *     surrounding surface (light or dark).
 *   - `mono`: single color (currentColor) with layered opacity — the sidebar
 *     brand chip and other compact UI where the mark inherits text color.
 *
 * Size is controlled via className (e.g. `size-4`, `size-16`); the SVG fills
 * its box.
 */
/** Fixed brand palette — kept in sync with `splash.html` and `assets/branding/logo.svg`.
 *  Do NOT theme-ify these: the AgentSkin brand mark must be visually identical
 *  regardless of light/dark mode. */
const BRAND_BG = '#FFFFFF';
const BRAND_FG = '#E30613';
const BRAND_HIGHLIGHT = '#FF6B61';
const BRAND_BORDER = 'rgba(15, 23, 42, 0.08)';

export function Logo({
  variant = 'color',
  className,
  title = 'AgentSkin',
}: {
  variant?: 'color' | 'mono';
  className?: string;
  title?: string;
}) {
  const svgClass = cn('block shrink-0', className);

  if (variant === 'mono') {
    return (
      <svg viewBox="0 0 48 48" className={svgClass} role="img" aria-label={title} fill="none">
        {/* Faint rounded-square background — inherits text color at 8% opacity */}
        <rect x="1" y="1" width="46" height="46" rx="2" fill="currentColor" fillOpacity="0.08" />
        <rect
          x="1.3"
          y="1.3"
          width="45.4"
          height="45.4"
          rx="2"
          stroke="currentColor"
          strokeOpacity="0.12"
          strokeWidth="0.6"
        />
        {/* "A" triangle */}
        <path d="M24 8.5L39.5 39.5h-7.6L24 22.4l-7.9 17.1H8.5Z" fill="currentColor" />
        {/* Baseline bar */}
        <path d="M20 30.1h8l1.5 3.5H18.5Z" fill="currentColor" />
        {/* Top serif accent */}
        <path d="M24 8.5L27 14.6 24 13.2 21 14.6Z" fill="currentColor" fillOpacity="0.6" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" className={svgClass} role="img" aria-label={title} fill="none">
      {/* Brand background — fixed white, never theme-adaptive, so the mark
          stays recognizable in the dark sidebar (where var(--card) would
          collapse to near-invisible dark gray). rx=11.5 (iOS-squircle)
          matches assets/branding/logo.svg and splash.html — the brand
          mark must be pixel-identical everywhere it appears. */}
      <rect x="1" y="1" width="46" height="46" rx="11.5" fill={BRAND_BG} />
      <rect
        x="1.3"
        y="1.3"
        width="45.4"
        height="45.4"
        rx="11.5"
        stroke={BRAND_BORDER}
        strokeWidth="0.6"
      />
      {/* "A" triangle — the main body of the letter */}
      <path d="M24 8.5L39.5 39.5h-7.6L24 22.4l-7.9 17.1H8.5Z" fill={BRAND_FG} />
      {/* Baseline bar — sits under the "A" crossbar area */}
      <path d="M20 30.1h8l1.5 3.5H18.5Z" fill={BRAND_FG} />
      {/* Top serif accent — lighter brand red */}
      <path d="M24 8.5L27 14.6 24 13.2 21 14.6Z" fill={BRAND_HIGHLIGHT} />
    </svg>
  );
}
