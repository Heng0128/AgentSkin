// SPDX-License-Identifier: MPL-2.0

import type { AgentId } from './agent';

// ---------------------------------------------------------------------------
// ToolOverride — live preview override dimensions (8 core + extras)
// ---------------------------------------------------------------------------

export interface ToolOverride {
  // shape
  radius?: string;
  spacing?: number;
  shadowLevel?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  blurPx?: number;
  borderWidth?: number;
  // color (re-themed by role in the replica)
  accent?: string;
  background?: string;
  foreground?: string;
  surface?: string;
  // typography
  fontSize?: number;
  fontFam?: string;
  lineHeight?: number;
  // motion
  duration?: string;
  timing?: string;
  // layout / density (preview-only)
  scale?: number;
  separators?: boolean;
  // filter (preview-only)
  invert?: boolean;
  contrast?: number;
  saturate?: number;
  // visual effects (preview-only)
  dim?: number;
  opacity?: number;
  // gradient (bakeable)
  gradientAccent?: boolean;
  // Full semantic palette (e.g. image-to-theme / preset load)
  colors?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// TweakSession — live-tweak session bound to a single agent
// ---------------------------------------------------------------------------

/**
 * Active tweak session bound to a single agent. The renderer holds one
 * instance per connected agent and mutates `overrides` in real time as
 * the user adjusts sliders / color pickers.
 *
 * Extracted here from `src/main/services/tweak-injector.ts` so the renderer
 * can import the type without pulling main-process code across the L4 boundary.
 */
export interface TweakSession {
  agentId: AgentId;
  port: number;
  overrides: ToolOverride;
  dirty: boolean;
}
