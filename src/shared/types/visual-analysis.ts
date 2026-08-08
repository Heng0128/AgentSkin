// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';

/**
 * Compact per-agent visual-analysis summary surfaced by the Studio profile
 * browser (InspectStudioTab PROFILE mode).
 *
 * Derived from the bundled `agents-profiles/` asset: the lightweight
 * `_profiles-summary.json` provides token counts / stats / categories, while
 * the brand accent color is extracted lazily from each
 * `<id>-profile.json` (`tokens.core.*.accent`). This avoids shipping the
 * multi-MB raw profiles to the renderer just to render a card.
 */
export interface VisualAnalysisSummary {
  id: AgentId;
  tokensLight: number;
  tokensDark: number;
  categories: string[];
  stats: {
    rootVars: { default: number; dark: number; light: number };
    domNodes: { default: number; dark: number; light: number };
    styleVars: { dark: number; light: number; neutral: number };
    computedSamples: { default: number; dark: number; light: number };
  };
  /** Brand/accent color (normalized hex or raw CSS value) from core dark tokens. */
  brandDark?: string;
  /** Brand/accent color from core light tokens. */
  brandLight?: string;
}
