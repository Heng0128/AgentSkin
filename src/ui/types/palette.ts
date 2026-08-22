// SPDX-License-Identifier: MPL-2.0

/**
 * Shared palette-source + output contracts for the unified PaletteTab.
 *
 * Each sub-tab (Presets / Harmony / Extract / Generate) emits a
 * `PaletteResult`; PaletteTab normalises that to a `PaletteOutput` and
 * forwards the canonical 4-role projection into `studioStore.setPaletteLoaded`.
 */

/** Tag identifying which sub-tab produced a given palette. */
export type PaletteSource =
  | { type: 'preset'; id: string }
  | { type: 'harmony'; hue: number; scheme: string }
  | { type: 'image'; file: string }
  | { type: 'manual' };

/** Output of any sub-tab pipeline — semantic-keyed color map + source meta. */
export interface PaletteResult {
  /** Semantic-keyed colours (`{ accent, background, foreground, surface, … }`). */
  colors: Record<string, string>;
  meta: { source: PaletteSource; score?: number; derivation?: string[] };
}

/**
 * Lifted workspace model — what PaletteTab hands to its bottom action bar.
 * `colors` are already in the role-shape `setPaletteLoaded` expects
 * (i.e. `accent / background / foreground / surface` are guaranteed present).
 */
export interface PaletteOutput {
  colors: Record<string, string>;
  meta: PaletteResult['meta'];
  /** Optional 0–100 score to display next to the action bar (from Harmony/Generate). */
  score?: number;
}
