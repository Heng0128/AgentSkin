// SPDX-License-Identifier: MPL-2.0

/**
 * # health-check
 *
 * Shared type contract for the post-injection DOM probe that walks the render
 * tree from the art layer downward, identifying elements whose opaque
 * backgrounds block the hero art from being visible.
 *
 * Originally defined in `src/main/theme-health-check.ts`. Extracted here so
 * both the main process (producer) and the renderer (consumer via IPC) can
 * reference the same contract without violating the architecture boundary
 * (UI → preload → IPC → main).
 */

export interface OpaqueLayer {
  /** Depth from the art root (#root or body). */
  depth: number;
  tagName: string;
  id: string;
  /** First 120 chars of className. */
  classes: string;
  /** data-view-id or similar semantic attribute (empty if none). */
  semanticAttr: string;
  /** Computed backgroundColor (non-transparent). */
  backgroundColor: string;
  /** Computed backgroundImage snippet (if any). */
  backgroundImage: string;
  /** Element dimensions "WxH". */
  size: string;
  /** Whether the element is actually visible (offsetWidth > 0). */
  visible: boolean;
  /** backdrop-filter value (empty if none). */
  backdropFilter: string;
}

export interface HealthCheckReport {
  /** Agent ID this report is for. */
  agentId: string;
  /** Timestamp of the check. */
  timestamp: number;
  /** Whether --agentskin-art is set and active. */
  heroArtActive: boolean;
  /** Whether an __agentskin adoptedStyleSheet is present. */
  themeSheetPresent: boolean;
  /** --agentskin-accent value (confirms token injection). */
  accentToken: string;
  /** Whether agentskin-host-<agentId> class is on <html>. */
  hostClassPresent: boolean;
  /** Whether adapter.mjs marker (window.__agentskin_<agentId>_adapter__) exists. */
  adapterPresent: boolean;
  /** Sampled native token values (e.g. --dbx-bg-body-web) to verify overrides. */
  nativeTokens: Record<string, string>;
  /** Opaque layers that block the hero art, sorted by depth. */
  opaqueLayers: OpaqueLayer[];
  /** Summary: how many visible opaque layers remain. */
  blockingCount: number;
  /** Overall health score 0-100 (100 = perfect transparency). */
  score: number;
}
