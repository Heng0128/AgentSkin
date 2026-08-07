// SPDX-License-Identifier: MPL-2.0

/**
 * Type declarations for color-theory.mjs — the JSDoc-typed .mjs module
 * is imported from .tsx via its .d.ts shim (electron-vite / Vite resolve
 * .mjs without forcing allowJs).
 */

export declare function hexToRgb(hex: string): [number, number, number] | null;
export declare function rgbToHex(rgb: number[]): string;
export declare function hexToHsl(hex: string): [number, number, number];
export declare function hslToHex(h: number, s: number, l: number): string;
export declare function harmonyPalette(
  baseHex: string,
  harmony: string,
  opts?: { sat?: number; light?: number },
): string[];
export declare function complementary(): number[];
export declare function splitComplementary(): number[];
export declare function triadic(): number[];
export declare function analogous(): number[];
export declare function tetradic(): number[];
export declare function monochromatic(): null;

export declare function relLuminance(hex: string): number;
export declare function contrastRatio(hexA: string, hexB: string): number;
export declare function classifyHue(hex: string): string;
export declare function scorePalette(palette: Record<string, string>): {
  contrast: number;
  harmony: number;
  semantic: number;
  total: number;
};

export declare function assemblePalette(opts: {
  baseHue: number;
  scheme: 'dark' | 'light';
  semanticOverrides?: Record<string, string>;
  accentHint?: string;
}): Record<string, string>;

type Proposal = {
  palette: Record<string, string>;
  score: { total: number; contrast: number; harmony: number; semantic: number };
  harmony: string;
  sourceHue: number;
};

export declare function generatePalettes(
  profile: Record<string, unknown>,
  opts?: { count?: number; scheme?: 'dark' | 'light'; seed?: number },
): Proposal[];
