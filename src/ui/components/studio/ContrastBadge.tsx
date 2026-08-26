// SPDX-License-Identifier: MPL-2.0

/**
 * # ContrastBadge
 *
 * WCAG 2.1 AA/AAA contrast traffic-light indicator.
 *
 * Displays compliance status for a foreground/background color pair.
 * Two modes:
 *   · compact — green/red dot with check/cross (default)
 *   · full    — ratio number with color-coded text and optional AAA badge
 *
 * Inspired by Realtime Colors' traffic-light pattern.
 */

import { wcagCheck } from '../../../../scripts/extended-colors.mjs';

interface ContrastBadgeProps {
  /** Foreground (text) color — 6-digit hex. */
  fgHex: string;
  /** Background color — 6-digit hex. */
  bgHex: string;
  /** Display mode: 'compact' shows dot + icon, 'full' shows ratio number. */
  mode?: 'compact' | 'full';
  className?: string;
}

export function ContrastBadge({
  fgHex,
  bgHex,
  mode = 'compact',
  className = '',
}: ContrastBadgeProps) {
  const { ratio, passesAA, passesAAA } = wcagCheck(fgHex, bgHex);

  if (mode === 'compact') {
    const pass = passesAA;
    return (
      <span className={`inline-flex items-center gap-1 text-[11px] ${className}`}>
        <span
          className={`inline-block h-2 w-2 rounded-full ${pass ? 'bg-cr-success' : 'bg-destructive'}`}
          aria-hidden="true"
        />
        <span className={pass ? 'text-cr-success' : 'text-destructive'}>{pass ? '✓' : '✗'}</span>
      </span>
    );
  }

  // full mode
  const ratioText = `${ratio.toFixed(1)}:1`;
  const colorClass = passesAA ? 'text-cr-success' : 'text-destructive';

  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${colorClass} ${className}`}>
      <span>{ratioText}</span>
      {passesAAA && (
        <span className="rounded-md bg-cr-success/15 px-1 text-[9px] font-normal leading-none">
          AAA
        </span>
      )}
    </span>
  );
}
