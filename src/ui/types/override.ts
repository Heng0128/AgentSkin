// SPDX-License-Identifier: MPL-2.0

/**
 * Studio override types — extracted from Toolbox.tsx to break the
 * studioStore → Toolbox circular-type dependency and allow clean
 * cross-module imports without pulling in React component code.
 *
 * `ToolOverride` and `TweakSession` now live in `@shared/types/override`
 * (pure types, no React/DOM deps) and are re-exported here for existing
 * UI consumers importing from `@/types/override`.
 */

// ---------------------------------------------------------------------------
// StudioColorSets — original color roles extracted from the snapshot
// ---------------------------------------------------------------------------

export interface StudioColorSets {
  primaryBg: string | null;
  surfaceBgs: string[];
  texts: string[];
  accents: string[];
}

export type { ToolOverride, TweakSession } from '@shared/types/override';
