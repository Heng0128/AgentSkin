// SPDX-License-Identifier: MPL-2.0

/**
 * Spacing scale — design contract.
 *
 * This module is a **design contract**, not dead code. It documents the
 * spacing scale (4px base unit, mirroring Tailwind) and provides concrete
 * values for JS inline-style scenarios (canvas layouts, chart padding,
 * dynamic gap calculations) where Tailwind spacing utilities cannot reach.
 *
 * Prefer Tailwind spacing utilities (`gap-4`, `p-8`, …) for normal JSX
 * className usage.
 */
export const spacing = {
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '32px',
  '4xl': '40px',
} as const;

export type Spacing = keyof typeof spacing;
