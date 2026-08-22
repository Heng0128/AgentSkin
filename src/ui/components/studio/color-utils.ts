// SPDX-License-Identifier: MPL-2.0

/**
 * Studio color utilities — shared helpers for color conversion and snapshot
 * feature extraction. Used by Toolbox, DockTabFX, and StudioStatusBar.
 */

/**
 * Convert an rgb()/rgba() computed value to #rrggbb for `<input type="color">`.
 * Also passes through hex values (#rgb, #rrggbb, #rrggbbaa) directly.
 * Returns null when it can't be parsed (e.g. named colors / gradients).
 */
export function rgbToHex(v: string | null | undefined): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  // Already hex → pass through
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    // Expand #rgb → #rrggbb
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  // 8-digit hex (#rrggbbaa) → strip alpha for <input type="color">
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    return trimmed.slice(0, 7);
  }
  const m = trimmed.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => s.trim());
  const r = Number.parseInt(parts[0], 10);
  const g = Number.parseInt(parts[1], 10);
  const b = Number.parseInt(parts[2], 10);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Shadow level options — shared by Toolbox and DockTabFX to avoid
 * duplicating the level map in both components.
 */
export const SHADOW_LEVELS = ['none', 'sm', 'md', 'lg', 'xl'] as const;

export type ShadowLevel = (typeof SHADOW_LEVELS)[number];

/**
 * Easing curve options — shared by Toolbox and DockTabFX.
 */
export const EASING_OPTIONS = [
  'ease',
  'linear',
  'ease-in',
  'ease-out',
  'ease-in-out',
  'cubic-bezier(.68,-.55,.27,1.55)',
] as const;
