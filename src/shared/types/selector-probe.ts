// SPDX-License-Identifier: MPL-2.0

/**
 * # selector-probe
 *
 * Types for CDP selector validation results.
 */

export type SelectorProbeKind = 'hit' | 'miss' | 'invalid' | 'timeout';

export interface SelectorProbeResult {
  selector: string;
  kind: SelectorProbeKind;
  /** Number of matched elements (0 for miss). */
  count: number;
  /** Bounding box of first matched element, if any. */
  boundingBox?: { x: number; y: number; width: number; height: number };
  /** Error message if kind is 'invalid'. */
  error?: string;
}

export interface SelectorValidationReport {
  agentId: string;
  results: SelectorProbeResult[];
  /** Summary counts. */
  summary: {
    total: number;
    hit: number;
    miss: number;
    invalid: number;
    timeout: number;
  };
  timestamp: number;
}
