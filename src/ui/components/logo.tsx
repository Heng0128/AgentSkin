// SPDX-License-Identifier: MPL-2.0

import { cn } from '@/lib/utils';

/**
 * # Logo
 *
 * AgentSkin brand mark — a white rounded square with a red "A" monogram
 * constructed from geometric shapes (triangle + serif + baseline bar).
 * Matches the reference design in A.html.
 *
 * Variants:
 *   - `color`: full brand mark — white bg, red "A", warm serif accent.
 *   - `mono`: single color (currentColor) with layered opacity — the sidebar
 *     brand chip and other compact UI where the mark inherits text color.
 *
 * Size is controlled via className (e.g. `size-4`, `size-16`); the SVG fills
 * its box.
 */
export function Logo({
  variant = 'color',
  className,
  title = 'AgentSkin',
}: {
  variant?: 'color' | 'mono';
  className?: string;
  title?: string;
}) {
  const svgClass = cn(
    'block shrink-0 drop-shadow-[0_1px_3px_rgba(0,0,0,0.3)] transition-transform duration-[250ms] ease-[cubic-bezier(.34,1.56,.64,1)] hover:-rotate-[4deg] hover:scale-[1.06]',
    className,
  );

  if (variant === 'mono') {
    return (
      <svg viewBox="0 0 48 48" className={svgClass} role="img" aria-label={title} fill="none">
        {/* White rounded-square background */}
        <rect x="1" y="1" width="46" height="46" rx="11.5" fill="currentColor" fillOpacity="0.08" />
        <rect
          x="1.3"
          y="1.3"
          width="45.4"
          height="45.4"
          rx="11.2"
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
      {/* White rounded-square background */}
      <rect x="1" y="1" width="46" height="46" rx="11.5" fill="#FFFFFF" />
      {/* "A" triangle — the main body of the letter */}
      <path d="M24 8.5L39.5 39.5h-7.6L24 22.4l-7.9 17.1H8.5Z" fill="#E30613" />
      {/* Baseline bar — sits under the "A" crossbar area */}
      <path d="M20 30.1h8l1.5 3.5H18.5Z" fill="#E30613" />
      {/* Top serif accent — lighter warm red */}
      <path d="M24 8.5L27 14.6 24 13.2 21 14.6Z" fill="#FF6B61" />
    </svg>
  );
}
