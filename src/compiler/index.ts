// SPDX-License-Identifier: MPL-2.0

/**
 * # compiler/index.ts — Package entry point
 *
 * Re-exports the λ compiler safety guardrails:
 *   - sanitize (P0-2): keyframes / declaration block sanitization
 *   - specificity (P0-1): per-adapter specificity profiling + guard
 *   - sandbox (P0-3): zero-dependency isolated hook execution
 */

export type { SandboxErrorCode, SandboxOptions, SandboxResult } from './sandbox';
export { runInSandbox } from './sandbox';
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
