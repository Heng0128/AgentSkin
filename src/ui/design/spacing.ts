// SPDX-License-Identifier: MPL-2.0

/** Spacing scale (px). Mirrors Tailwind's 4px base unit. */
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
