// SPDX-License-Identifier: MPL-2.0

/** Typography tokens. */
export const fontFamily = {
  sans: 'var(--font-sans)',
  mono: 'var(--font-mono)',
} as const;

export const fontSize = {
  xs: '11px',
  sm: '12px',
  base: '13px',
  md: '14px',
  lg: '16px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
} as const;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
} as const;

export type FontSize = keyof typeof fontSize;
