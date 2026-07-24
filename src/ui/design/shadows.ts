// SPDX-License-Identifier: MPL-2.0

/**
 * Elevation shadows. Dark UI uses subtle, low-opacity shadows; light UI uses
 * the same shapes with lighter tints. Reference these for inline styles only —
 * prefer Tailwind `shadow-*` utilities (mapped in globals.css) when possible.
 */
export const shadows = {
  sm: '0 1px 3px 0 rgba(0, 0, 0, 0.06), 0 1px 2px -1px rgba(0, 0, 0, 0.04)',
  md: '0 4px 16px -2px rgba(0, 0, 0, 0.08), 0 2px 6px -2px rgba(0, 0, 0, 0.04)',
  lg: '0 12px 32px -4px rgba(0, 0, 0, 0.1), 0 4px 12px -4px rgba(0, 0, 0, 0.05)',
  glow: '0 0 0 1px rgba(124, 58, 237, 0.25), 0 8px 24px -4px rgba(124, 58, 237, 0.2)',
} as const;

export type Shadow = keyof typeof shadows;
