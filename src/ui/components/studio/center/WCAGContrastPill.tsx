// SPDX-License-Identifier: MPL-2.0

/**
 * # WCAGContrastPill
 *
 * Inline ratio display — renders a WCAG contrast ratio with a pass/fail
 * color and optional AAA badge. Used by CenterTabThemeEditor to annotate
 * color token swatches.
 *
 * Extracted from CenterTabThemeEditor (RC-12) to shrink the parent component
 * to a manageable size.
 */

import { wcagCheck } from '@/studio/design-bridge';

export function WCAGContrastPill({ fgHex, bgHex }: { fgHex: string; bgHex: string }) {
  const { ratio, passesAA, passesAAA } = wcagCheck(fgHex, bgHex);
  const ratioText = `${ratio.toFixed(1)}:1`;

  return (
    <span className="inline-flex items-center gap-1 font-mono text-[11px]">
      <span className={passesAA ? 'text-cr-success' : 'text-destructive'}>{ratioText}</span>
      {passesAAA && (
        <span className="rounded-md bg-cr-success/15 px-1 text-[10px] font-normal leading-none text-cr-success">
          AAA
        </span>
      )}
      {!passesAA && (
        <span className="rounded-md bg-destructive/15 px-1 text-[10px] font-normal leading-none text-destructive">
          AA
        </span>
      )}
    </span>
  );
}
