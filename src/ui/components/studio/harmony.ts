// SPDX-License-Identifier: MPL-2.0

/**
 * Color-harmony palette generator for the Studio "Inspire" feature.
 *
 * Given a base accent color, it produces a handful of tasteful, fully-formed
 * 4-role palettes (accent / background / foreground / surface) using classic
 * harmony rules (complementary, analogous, triadic, …). Each result is ready
 * to feed straight into {@link setPaletteLoaded} so the editor preview updates.
 */

/** i18n key in {@link UiMessages} used to render this harmony rule's name. */
export type HarmonyName =
  | 'harmonyComplementary'
  | 'harmonyAnalogous'
  | 'harmonyTriadic'
  | 'harmonySplitComplementary'
  | 'harmonyMonochromatic';

export interface HarmonyPalette {
  /** Stable id (harmony name key). */
  id: string;
  /** i18n key — resolve via {@link UiMessages}[labelKey] at the call site. */
  labelKey: HarmonyName;
  accent: string;
  background: string;
  foreground: string;
  surface: string;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function hexToHsl(hex: string): Hsl {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 222, s: 80, l: 55 }; // sensible default (blue)
  const int = Number.parseInt(m[1], 16);
  const r = ((int >> 16) & 0xff) / 255;
  const g = ((int >> 8) & 0xff) / 255;
  const b = (int & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const mm = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) =>
    Math.round((v + mm) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rotate(h: Hsl, deg: number): Hsl {
  return { ...h, h: (h.h + deg + 360) % 360 };
}

/** Convert an HSL triple (h 0-360, s/l 0-1) to an RGB triple 0-255. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Best-effort parse of a CSS color string (hex / rgb() / hsl()) to RGB. */
function cssColorToRgb(raw: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw.trim());
  if (hex) {
    let h = hex[1].slice(0, 6);
    if (hex[1].length === 3)
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(raw.trim());
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hsl = /^hsla?\(\s*([\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(raw.trim());
  if (hsl) return hslToRgb(Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100);
  return null;
}

/**
 * Read a CSS custom property from the document root at runtime and convert it
 * to a 6-digit hex string. Falls back to `fallback` when the var is unset,
 * not parseable, or there is no DOM (tests / SSR / Node scripts). This keeps
 * the neutral scaffolding in sync with the live theme instead of hardcoding
 * black/white values.
 */
export function cssVarToHex(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const rgb = value ? cssColorToRgb(value) : null;
    if (!rgb) return fallback;
    return `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return fallback;
  }
}

/** Is this hex "dark" (used to decide light vs dark neutral scaffolding)? */
export function isDark(hex: string): boolean {
  const { h, s, l } = hexToHsl(hex);
  void h;
  void s;
  return l < 50;
}

function buildPalette(
  id: string,
  labelKey: HarmonyName,
  accentHsl: Hsl,
  dark: boolean,
): HarmonyPalette {
  const accent = hslToHex({
    ...accentHsl,
    s: clamp(accentHsl.s, 60, 92),
    l: clamp(accentHsl.l, 48, 62),
  });
  if (dark) {
    return {
      id,
      labelKey,
      accent,
      background: cssVarToHex('--background', '#0e0e13'),
      foreground: cssVarToHex('--foreground', '#ededf2'),
      surface: cssVarToHex('--card', '#1a1a22'),
    };
  }
  return {
    id,
    labelKey,
    accent,
    background: cssVarToHex('--background', '#f7f7fa'),
    foreground: cssVarToHex('--foreground', '#16161c'),
    surface: cssVarToHex('--card', '#ffffff'),
  };
}

/**
 * Generate harmony palettes from a base accent. `dark` picks the neutral
 * scaffolding (background / foreground / surface) so the result matches the
 * user's current light/dark posture.
 */
export function generateInspirations(baseAccent: string, dark: boolean): HarmonyPalette[] {
  const base = hexToHsl(baseAccent);
  return [
    buildPalette('complementary', 'harmonyComplementary', rotate(base, 180), dark),
    buildPalette('analogous', 'harmonyAnalogous', rotate(base, 30), dark),
    buildPalette('triadic', 'harmonyTriadic', rotate(base, 120), dark),
    buildPalette('split', 'harmonySplitComplementary', rotate(base, 150), dark),
    buildPalette(
      'monochrome',
      'harmonyMonochromatic',
      { ...base, s: clamp(base.s * 0.55, 20, 70) },
      dark,
    ),
  ];
}
