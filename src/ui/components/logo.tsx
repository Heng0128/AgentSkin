// SPDX-License-Identifier: MPL-2.0

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * # Logo
 *
 * AgentSkin's "skin layers" brand mark — three fanned rounded panels
 * (cyan → violet → pink) representing interchangeable skins layered over an
 * AI agent. This is the single source of truth for the in-app brand mark; the
 * raster app/tray/file icons in `assets/branding` are drawn from the same
 * concept.
 *
 * Variants:
 *   - `color`: full brand gradients — splash screens, about panels, hero.
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
  // useId may contain characters (e.g. ":") that are awkward inside url(#...)
  // references — keep only alphanumerics for safe gradient ids.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  if (variant === 'mono') {
    return (
      <svg
        viewBox="0 0 24 24"
        className={cn('shrink-0', className)}
        role="img"
        aria-label={title}
        fill="currentColor"
      >
        <rect x="2.1" y="8.9" width="13" height="13" rx="3" fillOpacity="0.38" />
        <rect x="5.5" y="5.5" width="13" height="13" rx="3" fillOpacity="0.62" />
        <rect x="8.9" y="2.1" width="13" height="13" rx="3" fillOpacity="1" />
      </svg>
    );
  }

  const cyan = `asCyan${uid}`;
  const violet = `asViolet${uid}`;
  const pink = `asPink${uid}`;

  return (
    <svg viewBox="0 0 24 24" className={cn('shrink-0', className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id={cyan} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
        <linearGradient id={violet} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <linearGradient id={pink} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f9a8d4" />
          <stop offset="100%" stopColor="#db2777" />
        </linearGradient>
      </defs>
      <rect x="2.1" y="8.9" width="13" height="13" rx="3" fill={`url(#${cyan})`} />
      <rect x="5.5" y="5.5" width="13" height="13" rx="3" fill={`url(#${violet})`} />
      <rect x="8.9" y="2.1" width="13" height="13" rx="3" fill={`url(#${pink})`} />
    </svg>
  );
}
