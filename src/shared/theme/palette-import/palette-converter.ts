// SPDX-License-Identifier: MPL-2.0

/**
 * # Palette Converter -- Terminal Palette -> 14-Token Format
 *
 * Converts terminal color palettes (.itermcolors / JSON / YAML) to AgentSkin's
 * 14-token theme format. The pipeline:
 *
 * 1. **Parse** -- detect and parse the input format into a normalized
 *    `TerminalPalette` (16 ANSI colors + foreground + background).
 * 2. **Map** -- map terminal colors to 14-token slots using the contract
 *    defined in `MAPPING_RULES`.
 * 3. **Derive** -- use color theory (complementary / analogous hues) to
 *    fill any missing tokens.
 *
 * ## 14-Token Output
 *
 * | Token | Source |
 * |-------|--------|
 * | `primary` | ANSI blue / bright blue |
 * | `secondary` | ANSI cyan / bright cyan |
 * | `accent` | ANSI magenta / bright magenta |
 * | `muted` | desaturated text |
 * | `surface` | terminal background |
 * | `text` | terminal foreground |
 * | `border` | color-mix(surface, text) |
 * | `success` | ANSI green |
 * | `warning` | ANSI yellow / bright yellow |
 * | `error` | ANSI red / bright red |
 * | `info` | ANSI cyan / bright cyan |
 * | `shadow` | dark shadow color derived from surface |
 * | `scrim` | semi-transparent overlay derived from surface |
 * | `overlay` | surface overlay variant |
 *
 * ## Design
 *
 * Pure module -- no DOM, no Electron deps. Lives in the shared layer
 * so both the main process and renderer can import it. Reuses color
 * primitives from `contrast-utils.ts` and `tonal-palette.ts`.
 */

import { hexToRgb, rgbToHex } from '../../contrast-utils';
import { hexToHsl, hslToHex } from '../../tonal-palette';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported input formats. */
export type PaletteFormat = 'itermcolors' | 'json' | 'yaml';

/** Normalized terminal palette (16 ANSI colors + foreground + background). */
export interface TerminalPalette {
  /** Terminal foreground color. */
  foreground: string;
  /** Terminal background color. */
  background: string;
  /** ANSI black (normal). */
  black: string;
  /** ANSI red (normal). */
  red: string;
  /** ANSI green (normal). */
  green: string;
  /** ANSI yellow (normal). */
  yellow: string;
  /** ANSI blue (normal). */
  blue: string;
  /** ANSI magenta (normal). */
  magenta: string;
  /** ANSI cyan (normal). */
  cyan: string;
  /** ANSI black (bright). */
  brightBlack: string;
  /** ANSI red (bright). */
  brightRed: string;
  /** ANSI green (bright). */
  brightGreen: string;
  /** ANSI yellow (bright). */
  brightYellow: string;
  /** ANSI blue (bright). */
  brightBlue: string;
  /** ANSI magenta (bright). */
  brightMagenta: string;
  /** ANSI cyan (bright). */
  brightCyan: string;
}

/** The 14-token output format. */
export interface PaletteTokens {
  /** Primary brand / action color (ANSI blue). */
  primary: string;
  /** Secondary brand color (ANSI cyan). */
  secondary: string;
  /** Accent color (ANSI magenta). */
  accent: string;
  /** Muted / secondary text. */
  muted: string;
  /** Base surface (terminal background). */
  surface: string;
  /** Primary text color (terminal foreground). */
  text: string;
  /** Border color (derived). */
  border: string;
  /** Success color (ANSI green). */
  success: string;
  /** Warning color (ANSI yellow). */
  warning: string;
  /** Error color (ANSI red). */
  error: string;
  /** Info color (ANSI cyan). */
  info: string;
  /** Shadow color (derived dark). */
  shadow: string;
  /** Scrim overlay (derived semi-transparent). */
  scrim: string;
  /** Surface overlay variant (derived). */
  overlay: string;
}

/** Result of a palette conversion. */
export interface PaletteConversionResult {
  /** The 14-token palette. */
  tokens: PaletteTokens;
  /** Detected color mode. */
  mode: 'light' | 'dark';
  /** Which tokens were directly mapped vs derived. */
  metadata: {
    /** Source format. */
    source: PaletteFormat;
    /** Token names that were directly mapped from the input. */
    mapped: string[];
    /** Token names that were derived via color theory. */
    derived: string[];
  };
}

/** Error thrown when parsing fails. */
export class PaletteParseError extends Error {
  constructor(
    message: string,
    readonly format: PaletteFormat,
  ) {
    super(message);
    this.name = 'PaletteParseError';
  }
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Adjust lightness by a signed delta (positive = lighter).
 * Equivalent to `color-mix(in hsl, hex, white delta%)` for positive delta.
 */
function adjustLightness(hex: string, delta: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, l: clamp(hsl.l + delta, 0, 1) });
}

/**
 * Scale saturation by a factor (0 = greyscale, 1 = unchanged).
 * Equivalent to `color-mix(in hsl, hex, hsl(h, 0%, l))`.
 */
function adjustSaturation(hex: string, factor: number): string {
  const hsl = hexToHsl(hex);
  return hslToHex({ ...hsl, s: clamp(hsl.s * factor, 0, 1) });
}

/**
 * Linear interpolation between two hex colors (ratio 0 = hex1, 1 = hex2).
 * Equivalent to `color-mix(in srgb, hex1, hex2 ratio%)`.
 *
 * Returns uppercase hex to stay consistent with `hslToHex` convention.
 */
function mixHex(hex1: string, hex2: string, ratio: number): string {
  const c1 = hexToRgb(hex1);
  const c2 = hexToRgb(hex2);
  if (!c1 || !c2) return hex1;
  return rgbToHex(
    c1.r + (c2.r - c1.r) * ratio,
    c1.g + (c2.g - c1.g) * ratio,
    c1.b + (c2.b - c1.b) * ratio,
  ).toUpperCase();
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/** Default terminal palette (fallback when colors are missing). */
const DEFAULT_PALETTE: TerminalPalette = {
  foreground: '#CCCCCC',
  background: '#1E1E1E',
  black: '#000000',
  red: '#CD3131',
  green: '#0DBC79',
  yellow: '#E5E510',
  blue: '#2472C8',
  magenta: '#BC3FBC',
  cyan: '#11A8CD',
  brightBlack: '#666666',
  brightRed: '#F14C4C',
  brightGreen: '#23D18B',
  brightYellow: '#F5F543',
  brightBlue: '#3B8EEA',
  brightMagenta: '#D670D6',
  brightCyan: '#29B8DB',
};

/**
 * Color families (normal + bright). When the user provides either variant,
 * the other falls back to it instead of to the global default. This ensures
 * that a user-supplied `green` is used for the success token even when they
 * don't provide a `brightGreen`.
 */
const COLOR_FAMILIES: Array<[keyof TerminalPalette, keyof TerminalPalette]> = [
  ['red', 'brightRed'],
  ['green', 'brightGreen'],
  ['yellow', 'brightYellow'],
  ['blue', 'brightBlue'],
  ['magenta', 'brightMagenta'],
  ['cyan', 'brightCyan'],
  ['black', 'brightBlack'],
];

/**
 * Merge a partial palette (user-provided) with defaults.
 *
 * For each color family: if the user provided either the normal or bright
 * variant, the other falls back to the user's value. Only when neither is
 * provided do we use the global defaults for that family.
 */
function mergeWithDefaults(partial: Partial<TerminalPalette>): TerminalPalette {
  const result: Partial<TerminalPalette> = {};

  // Standalone fields (no bright/normal family).
  const standaloneFields: Array<keyof TerminalPalette> = ['foreground', 'background'];
  for (const field of standaloneFields) {
    result[field] = partial[field] ?? DEFAULT_PALETTE[field];
  }

  // Color families.
  for (const [normal, bright] of COLOR_FAMILIES) {
    const userNormal = partial[normal];
    const userBright = partial[bright];

    if (userNormal !== undefined && userBright !== undefined) {
      result[normal] = userNormal;
      result[bright] = userBright;
    } else if (userNormal !== undefined) {
      // User provided only normal; use it for both.
      result[normal] = userNormal;
      result[bright] = userNormal;
    } else if (userBright !== undefined) {
      // User provided only bright; use it for both.
      result[normal] = userBright;
      result[bright] = userBright;
    } else {
      // User provided neither; use defaults.
      result[normal] = DEFAULT_PALETTE[normal];
      result[bright] = DEFAULT_PALETTE[bright];
    }
  }

  return result as TerminalPalette;
}

/**
 * Parse an .itermcolors XML plist file into a TerminalPalette.
 *
 * The format is an Apple plist with `<key>` elements mapping to `<dict>` color
 * components (Red, Green, Blue as 0-1 floating point).
 */
function parseItermcolors(xml: string): TerminalPalette {
  const result: Partial<TerminalPalette> = {};

  // Map of plist key names to TerminalPalette field names.
  const keyMap: Record<string, keyof TerminalPalette> = {
    'Foreground Color': 'foreground',
    'Background Color': 'background',
    'Ansi 0 Color': 'black',
    'Ansi 1 Color': 'red',
    'Ansi 2 Color': 'green',
    'Ansi 3 Color': 'yellow',
    'Ansi 4 Color': 'blue',
    'Ansi 5 Color': 'magenta',
    'Ansi 6 Color': 'cyan',
    'Ansi 7 Color': 'brightBlack',
    'Ansi 8 Color': 'brightRed',
    'Ansi 9 Color': 'brightGreen',
    'Ansi 10 Color': 'brightYellow',
    'Ansi 11 Color': 'brightBlue',
    'Ansi 12 Color': 'brightMagenta',
    'Ansi 13 Color': 'brightCyan',
  };

  // Extract each color dict block.
  const keyPattern = /<key>([^<]+)<\/key>\s*<dict>([\s\S]*?)<\/dict>/g;
  let match: RegExpExecArray | null;

  do {
    match = keyPattern.exec(xml);
    if (match === null) continue;
    const keyName = match[1];
    const dictContent = match[2];
    const fieldName = keyMap[keyName];

    if (!fieldName) continue;

    // Extract Red, Green, Blue components (0-1 float).
    const redMatch = /<key>Red Component<\/key>\s*<real>([^<]+)<\/real>/i.exec(dictContent);
    const greenMatch = /<key>Green Component<\/key>\s*<real>([^<]+)<\/real>/i.exec(dictContent);
    const blueMatch = /<key>Blue Component<\/key>\s*<real>([^<]+)<\/real>/i.exec(dictContent);

    if (redMatch && greenMatch && blueMatch) {
      const r = Math.round(parseFloat(redMatch[1]) * 255);
      const g = Math.round(parseFloat(greenMatch[1]) * 255);
      const b = Math.round(parseFloat(blueMatch[1]) * 255);
      result[fieldName] = rgbToHex(r, g, b).toUpperCase();
    }
  } while (match !== null);

  // Merge with defaults for any missing colors.
  return mergeWithDefaults(result);
}

/**
 * Parse a JSON palette into a TerminalPalette.
 *
 * Expected format: `{ name: string, colors: { foreground, background, accent, ... } }`
 * or a flat record of color names to hex values.
 */
function parseJsonPalette(json: string): TerminalPalette {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new PaletteParseError('Invalid JSON: parse error', 'json');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new PaletteParseError('JSON must be an object', 'json');
  }

  const obj = parsed as Record<string, unknown>;

  // Support both nested { colors: { ... } } and flat { ... } formats.
  const colorsObj = (obj.colors ?? obj) as Record<string, unknown>;

  if (typeof colorsObj !== 'object' || colorsObj === null) {
    throw new PaletteParseError('JSON colors must be an object', 'json');
  }

  const colors = colorsObj as Record<string, string>;

  // Map JSON color names to TerminalPalette fields.
  const result: Partial<TerminalPalette> = {};

  if (colors.foreground) result.foreground = normalizeHex(colors.foreground);
  if (colors.background) result.background = normalizeHex(colors.background);
  if (colors.red) result.red = normalizeHex(colors.red);
  if (colors.green) result.green = normalizeHex(colors.green);
  if (colors.yellow) result.yellow = normalizeHex(colors.yellow);
  if (colors.blue) result.blue = normalizeHex(colors.blue);
  if (colors.magenta) result.magenta = normalizeHex(colors.magenta);
  if (colors.cyan) result.cyan = normalizeHex(colors.cyan);
  if (colors.brightRed) result.brightRed = normalizeHex(colors.brightRed);
  if (colors.brightGreen) result.brightGreen = normalizeHex(colors.brightGreen);
  if (colors.brightYellow) result.brightYellow = normalizeHex(colors.brightYellow);
  if (colors.brightBlue) result.brightBlue = normalizeHex(colors.brightBlue);
  if (colors.brightMagenta) result.brightMagenta = normalizeHex(colors.brightMagenta);
  if (colors.brightCyan) result.brightCyan = normalizeHex(colors.brightCyan);

  // Also accept ANSI-numbered keys.
  if (colors.ansi0 || colors.black)
    result.black = normalizeHex(colors.ansi0 || colors.black || '#000000');
  if (colors.ansi7 || colors.brightBlack) {
    result.brightBlack = normalizeHex(colors.ansi7 || colors.brightBlack || '#666666');
  }

  return mergeWithDefaults(result);
}

/**
 * Parse a YAML theme file into a TerminalPalette.
 *
 * Supports a simple `colors:` node with color name -> hex value mappings.
 * This is a pragmatic parser for the common YAML theme format; it does not
 * aim to be a full YAML spec implementation.
 */
function parseYamlPalette(yaml: string): TerminalPalette {
  const result: Partial<TerminalPalette> = {};

  // Map of YAML key names to TerminalPalette field names.
  const keyMap: Record<string, keyof TerminalPalette> = {
    foreground: 'foreground',
    background: 'background',
    red: 'red',
    green: 'green',
    yellow: 'yellow',
    blue: 'blue',
    magenta: 'magenta',
    cyan: 'cyan',
    bright_red: 'brightRed',
    bright_green: 'brightGreen',
    bright_yellow: 'brightYellow',
    bright_blue: 'brightBlue',
    bright_magenta: 'brightMagenta',
    bright_cyan: 'brightCyan',
    black: 'black',
    bright_black: 'brightBlack',
  };

  // Find the colors section and parse key-value pairs.
  const lines = yaml.split('\n');
  let inColors = false;
  let colorsIndent = -1;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Detect the colors: key at root level.
    if (/^colors\s*:/.test(trimmed)) {
      inColors = true;
      colorsIndent = line.indexOf('colors');
      continue;
    }

    if (inColors) {
      // Check if we've exited the colors block (less indented non-empty line at root).
      const currentIndent = line.length - line.trimStart().length;
      if (currentIndent <= colorsIndent && trimmed && !trimmed.startsWith('#')) {
        inColors = false;
        continue;
      }

      // Parse key: value pairs.
      const kvMatch = /^(\w+):\s*(.+)$/.exec(trimmed);
      if (kvMatch) {
        const key = kvMatch[1];
        const value = kvMatch[2].trim().replace(/^["']|["']$/g, '');
        const fieldName = keyMap[key];

        if (fieldName && /^#[0-9a-fA-F]{3,8}$/.test(value)) {
          result[fieldName] = normalizeHex(value);
        }
      }
    }
  }

  return mergeWithDefaults(result);
}

/**
 * Normalize a hex color string to uppercase #RRGGBB form.
 * Accepts #RGB and #RRGGBB formats.
 */
function normalizeHex(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, '');

  if (cleaned.length === 3) {
    const expanded = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
    return `#${expanded.toUpperCase()}`;
  }

  if (cleaned.length === 6) {
    return `#${cleaned.toUpperCase()}`;
  }

  // Try to handle 8-char (with alpha) by taking first 6.
  if (cleaned.length >= 6) {
    return `#${cleaned.slice(0, 6).toUpperCase()}`;
  }

  return hex;
}

// ---------------------------------------------------------------------------
// Mapping & derivation
// ---------------------------------------------------------------------------

/**
 * Determine the color mode (light/dark) based on background luminance.
 */
function detectMode(background: string): 'light' | 'dark' {
  const rgb = hexToRgb(background);
  if (!rgb) return 'dark';
  // Use a simplified luminance check (gamma-expanded approximation).
  const lum =
    0.2126 * (rgb.r / 255) ** 2.2 + 0.7152 * (rgb.g / 255) ** 2.2 + 0.0722 * (rgb.b / 255) ** 2.2;
  return lum >= 0.5 ? 'light' : 'dark';
}

/**
 * Convert a TerminalPalette to the 14-token format.
 *
 * Mapping rules:
 * - foreground -> text
 * - background -> surface
 * - blue / brightBlue -> primary
 * - cyan / brightCyan -> secondary
 * - red / brightRed -> error
 * - green / brightGreen -> success
 * - yellow / brightYellow -> warning
 * - magenta / brightMagenta -> accent
 * - Remaining tokens derived via color theory.
 */
function tokensFromPalette(
  palette: TerminalPalette,
  format: PaletteFormat,
): PaletteConversionResult {
  const mode = detectMode(palette.background);
  const direction = mode === 'light' ? -1 : 1;

  const mapped: string[] = [];
  const derived: string[] = [];

  // --- Direct mappings ---
  const text = palette.foreground;
  mapped.push('text');

  const surface = palette.background;
  mapped.push('surface');

  // Prefer bright variants for more vivid tokens when available.
  const primary = palette.brightBlue || palette.blue;
  mapped.push('primary');

  const secondary = palette.brightCyan || palette.cyan;
  mapped.push('secondary');

  const accent = palette.brightMagenta || palette.magenta;
  mapped.push('accent');

  const error = palette.brightRed || palette.red;
  mapped.push('error');

  const success = palette.brightGreen || palette.green;
  mapped.push('success');

  const warning = palette.brightYellow || palette.yellow;
  mapped.push('warning');

  const info = palette.brightCyan || palette.cyan;
  mapped.push('info');

  // --- Derived tokens ---
  const muted = adjustSaturation(text, 0.35);
  derived.push('muted');

  const border = mixHex(surface, text, mode === 'light' ? 0.15 : 0.2);
  derived.push('border');

  // Shadow: a dark color derived from surface, shifted darker.
  const shadow = adjustLightness(surface, direction * 0.15);
  derived.push('shadow');

  // Scrim: a semi-transparent overlay (represented as a darkened surface variant).
  const scrim = mixHex(surface, '#000000', mode === 'light' ? 0.3 : 0.5);
  derived.push('scrim');

  // Overlay: a surface variant slightly different from base surface.
  const overlay = adjustLightness(surface, direction * 0.05);
  derived.push('overlay');

  return {
    tokens: {
      primary,
      secondary,
      accent,
      muted,
      surface,
      text,
      border,
      success,
      warning,
      error,
      info,
      shadow,
      scrim,
      overlay,
    },
    mode,
    metadata: {
      source: format,
      mapped,
      derived,
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a terminal palette (itermcolors / JSON / YAML) to AgentSkin's
 * 14-token format.
 *
 * @param input   The palette content as a string.
 * @param format  The format of the input ('itermcolors' | 'json' | 'yaml').
 * @returns       A `PaletteConversionResult` with the 14-token palette.
 * @throws        `PaletteParseError` if the input cannot be parsed.
 */
export function convertPalette(input: string, format: PaletteFormat): PaletteConversionResult {
  if (!input || typeof input !== 'string') {
    throw new PaletteParseError('Input must be a non-empty string', format);
  }

  let palette: TerminalPalette;

  switch (format) {
    case 'itermcolors':
      palette = parseItermcolors(input);
      break;
    case 'json':
      palette = parseJsonPalette(input);
      break;
    case 'yaml':
      palette = parseYamlPalette(input);
      break;
    default:
      throw new PaletteParseError(`Unsupported format: ${format}`, format);
  }

  return tokensFromPalette(palette, format);
}
