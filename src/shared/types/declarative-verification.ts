// SPDX-License-Identifier: MPL-2.0

/**
 * # declarative-verification
 *
 * Declarative verification type definitions for AgentSkin adapter injection.
 *
 * Provides a unified, DOM-free verification contract that adapters can
 * optionally supply to declare what landmarks they expect in the target
 * DOM, what routes they support, and how to verify injection success.
 *
 * ## Why this exists
 *
 * Before this module, verification was performed by the imperative
 * `contract-validator.ts` (selector-matching) and `landmark-preflight.ts`
 * (CDP-based). While both work, they lack a unified abstraction that
 * adapters can extend to self-declare their compatibility requirements.
 *
 * This module introduces a declarative, hierarchical verification model:
 *
 *   - **LandmarkRule** — a single DOM anchor (name + selectors + required flag)
 *   - **RouteContext** — a conditional context activated when route matches
 *   - **AdapterVerificationConfig** — full config (required + recommended + contexts)
 *   - **VerificationResult** — structured outcome (pass/skip/warn/fail)
 *
 * ## Architecture
 *
 * ```
 * declarative-verification.ts (types)
 * ├── LandmarkRule        — single DOM anchor check
 * ├── RouteContext        — conditional route-based verification
 * ├── VerificationResult  — outcome with granular status
 * └── AdapterVerificationConfig — complete adapter verification contract
 *
 * declarative-verifier.ts (pure logic, DOM-free)
 * ├── verifyLandmarks()   — checks landmark presence against DOM
 * ├── detectRoute()       — detects current page route from URL/DOM
 * ├── verifyForWindow()   — full verification for a single window
 * └── verifyWithFallback()— multi-window fallback (primary/secondary)
 * ```
 *
 * ## DOM-free design
 *
 * Like `contract-validator.ts`, all types are pure data. The verifier
 * module accepts a `DomSnapshot` abstraction so it can be tested with
 * mock implementations and run in production via CDP-backed snapshots.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * A single DOM landmark rule — describes one semantic anchor point
 * that must (or should) exist in the target page.
 *
 * The `selectors` array provides alternative CSS selectors. A landmark
 * is considered "present" if ANY selector matches. This handles DOM
 * variations across different versions of the same application.
 *
 * @example
 * ```ts
 * const chatSurface: LandmarkRule = {
 *   name: 'chat-surface',
 *   selectors: ['.chat-container', '.message-list', "[role='log']"],
 *   required: true,
 * };
 * ```
 */
export interface LandmarkRule {
  /** Human-readable landmark identifier. */
  readonly name: string;
  /** Alternative CSS selectors — at least one must match. */
  readonly selectors: readonly string[];
  /** When true, missing this landmark fails verification. */
  readonly required: boolean;
}

/**
 * Condition that activates a route context — at least one selector
 * in `any` must match the current DOM.
 */
export interface RouteWhenCondition {
  /** Alternative CSS selectors — at least one must match. */
  readonly any: readonly string[];
}

/**
 * A conditional route context — only evaluated when the `when` clause
 * matches the current DOM snapshot.
 *
 * Route contexts allow adapters to declare: "When the user is on page X,
 * these additional landmarks must be present." This handles SPAs where
 * different routes expose different DOM structures.
 *
 * @example
 * ```ts
 * const sidebarContext: RouteContext = {
 *   name: 'sidebar-expanded',
 *   when: { any: ["[class*='sidebar--expanded']"] },
 *   required: [
 *     { name: 'sidebar-content', selectors: ['.sidebar-content'], required: true },
 *   ],
 * };
 * ```
 */
export interface RouteContext {
  /** Context identifier (e.g. 'sidebar-expanded', 'settings-page'). */
  readonly name: string;
  /** Condition that activates this context. */
  readonly when: RouteWhenCondition;
  /** Landmark rules that must pass when this context is active. */
  readonly required: readonly LandmarkRule[];
}

/**
 * Structured result of declarative verification.
 *
 * Unlike `contract-validator.ts`'s `VerificationResult` (which is
 * check-centric), this result is outcome-centric — designed for
 * downstream consumers that need a quick pass/fail decision plus
 * actionable diagnostics.
 */
export interface VerificationResult {
  /** Whether all required landmarks and active context rules passed. */
  readonly pass: boolean;
  /**
   * Names of landmarks that were skipped because their containing
   * window lacked required parent landmarks (secondary window fallback).
   */
  readonly skipped: readonly string[];
  /**
   * Names of recommended landmarks that did not match — non-blocking
   * but worth surfacing in diagnostics.
   */
  readonly warnings: readonly string[];
  /**
   * Names of required landmarks that did not match — these caused
   * verification to fail.
   */
  readonly failures: readonly string[];
}

/**
 * Complete verification configuration for a single adapter.
 *
 * Adapters can optionally implement this interface to self-declare
 * their verification requirements. When absent, the system falls
 * back to the default landmark definitions from `landmarks.ts`.
 *
 * @example
 * ```ts
 * const codexConfig: AdapterVerificationConfig = {
 *   required: [
 *     { name: 'main-content', selectors: ['main', '#root'], required: true },
 *   ],
 *   recommended: [
 *     { name: 'composer', selectors: ['.composer-surface'], required: false },
 *   ],
 *   contexts: [
 *     {
 *       name: 'settings-page',
 *       when: { any: ['[data-route="settings"]'] },
 *       required: [
 *         { name: 'settings-panel', selectors: ['.settings-panel'], required: true },
 *       ],
 *     },
 *   ],
 * };
 * ```
 */
export interface AdapterVerificationConfig {
  /**
   * Must-pass landmarks. If any required landmark is missing,
   * verification fails (pass = false).
   */
  readonly required: readonly LandmarkRule[];
  /**
   * Best-effort landmarks. Missing recommended landmarks produce
   * warnings but do not fail verification.
   */
  readonly recommended: readonly LandmarkRule[];
  /**
   * Conditional contexts evaluated only when their `when` clause
   * matches the current DOM. Active context failures count as
   * verification failures.
   */
  readonly contexts: readonly RouteContext[];
}

// ---------------------------------------------------------------------------
// Result constructors (convenience)
// ---------------------------------------------------------------------------

/**
 * Create a successful verification result.
 *
 * @param warnings - Optional warning names (recommended landmarks that failed).
 */
export function createPassResult(warnings: readonly string[] = []): VerificationResult {
  return { pass: true, skipped: [], warnings, failures: [] };
}

/**
 * Create a failed verification result.
 *
 * @param failures - Names of required landmarks that failed.
 * @param warnings - Optional warning names.
 */
export function createFailResult(
  failures: readonly string[],
  warnings: readonly string[] = [],
): VerificationResult {
  return { pass: false, skipped: [], warnings, failures };
}

/**
 * Create a partial result for a secondary window (some landmarks skipped).
 *
 * @param skipped  - Names of landmarks that were skipped (window not applicable).
 * @param failures - Names of required landmarks that failed.
 * @param warnings - Optional warning names.
 */
export function createPartialResult(
  skipped: readonly string[],
  failures: readonly string[],
  warnings: readonly string[] = [],
): VerificationResult {
  return { pass: failures.length === 0, skipped, warnings, failures };
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

/**
 * Type guard for `LandmarkRule`.
 *
 * Validates that the value has the required `name`, `selectors`,
 * and `required` fields with correct types.
 */
export function isLandmarkRule(value: unknown): value is LandmarkRule {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    Array.isArray(obj.selectors) &&
    obj.selectors.length > 0 &&
    typeof obj.required === 'boolean'
  );
}

/**
 * Type guard for `AdapterVerificationConfig`.
 *
 * Validates that the value has the required `required`, `recommended`,
 * and `contexts` array fields, and that each element in `required` and
 * `recommended` passes the `isLandmarkRule` guard.
 */
export function isAdapterVerificationConfig(value: unknown): value is AdapterVerificationConfig {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.required) &&
    Array.isArray(obj.recommended) &&
    Array.isArray(obj.contexts) &&
    obj.required.every(isLandmarkRule)
  );
}
