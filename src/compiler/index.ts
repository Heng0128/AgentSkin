// SPDX-License-Identifier: MPL-2.0

/**
 * # compiler/index.ts — Package entry point
 *
 * Re-exports the keyframes sanitization API for the λ compiler pipeline.
 */

export type { SanitizeOptions, SanitizeResult } from './sanitize';
export {
  sanitizeDeclarationBlock,
  sanitizeKeyframes,
  sanitizeKeyframesBatch,
} from './sanitize';
export type { ScopeStrategy, SpecificityProfile, SpecificityReport } from './specificity';
export {
  AGENT_SPECIFICITY_PROFILES,
  calculateSpecificity,
  guardSpecificity,
  validateSpecificity,
} from './specificity';
