// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/contract-validator
 *
 * Declarative verification contract validator for adapter injection.
 *
 * ## Why this exists
 *
 * Before this module, verification logic was either absent from the
 * orchestrator or hand-coded inline, making it impossible for theme
 * authors to understand or extend what "successful injection" means
 * for each adapter.
 *
 * This module elevates verification to a declarative JSON contract
 * (see `verification-contract.schema.json`) with three-level semantics:
 *
 *   - `required`     — must-pass checks; failure = injection error
 *   - `recommended`  — best-effort checks; failure = warning
 *   - `contexts`     — conditional checks evaluated only when a
 *                      `when` selector matches the current DOM
 *
 * ## Architecture
 *
 * ```
 *  contract-validator.ts (pure logic, DOM-free)
 *  ├── loadContract(adapterId) → VerificationContract
 *  ├── validateContract(snapshot, contract) → VerificationResult
 *  └── DomSnapshot (interface — caller provides selector check)
 *
 *  contracts/*.contract.json (declarative per-adapter contracts)
 *  verification-contract.schema.json (JSON Schema for editors)
 * ```
 *
 * ## DomSnapshot abstraction
 *
 * This module is DOM-free (shared layer constraint). Callers provide
 * a `DomSnapshot` implementation that answers "does this selector
 * match in the current DOM?" — typically backed by a CDP evaluate or
 * a test fixture.
 */

import type { AgentId } from '../types/agent';
import codexContract from './contracts/codex.contract.json';
import doubaoContract from './contracts/doubao.contract.json';
import qoderworkContract from './contracts/qoderwork.contract.json';
import traeworkContract from './contracts/traework.contract.json';
import workbuddyContract from './contracts/workbuddy.contract.json';
import zcodeContract from './contracts/zcode.contract.json';

// ---------------------------------------------------------------------------
// Types (mirror verification-contract.schema.json)
// ---------------------------------------------------------------------------

/**
 * Evidence source and coverage metadata for a check.
 *
 * Provenance annotates where a check's selectors came from and how
 * trustworthy the evidence is. Optional — checks without provenance
 * still validate but produce a warning in CI.
 */
export interface Provenance {
  /** Evidence source. */
  readonly source: 'maintainer' | 'reporter' | 'fixture' | 'inferred' | 'reverse-engineering';
  /** Evidence strength. */
  readonly strength: 'strong' | 'medium' | 'weak';
  /** Known coverage gaps — scenarios where this check may not hold. */
  readonly knownGaps?: readonly string[];
  /** Application versions where this check has been verified. */
  readonly coveredVersions?: readonly string[];
  /** ISO 8601 date (YYYY-MM-DD) when this check was last verified. */
  readonly lastVerified?: string;
}

/**
 * A single check: at least one selector in `any` must match the DOM.
 *
 * The `any` array provides alternative selectors — injection is
 * considered successful for this check if ANY selector matches.
 * This handles adapter DOM variations across versions.
 */
export interface ContractCheck {
  /** Human-readable check identifier. */
  readonly name: string;
  /** Alternative CSS selectors — at least one must match. */
  readonly any: readonly string[];
  /** Optional evidence source and coverage metadata. */
  readonly provenance?: Provenance;
}

/**
 * Conditional context check — only evaluated when the `when` clause
 * matches the current DOM snapshot.
 */
export interface ContractContextCheck {
  /** Context identifier. */
  readonly name: string;
  /** Condition that activates this context. */
  readonly when: WhenClause;
  /** Checks that must pass when context is active. */
  readonly required: readonly ContractCheck[];
}

/** Condition: at least one selector must match. */
export interface WhenClause {
  /** Alternative CSS selectors — at least one must match. */
  readonly any: readonly string[];
}

/**
 * Three-level verification contract for a single adapter.
 */
export interface VerificationContract {
  /** Must-pass checks. */
  readonly required: readonly ContractCheck[];
  /** Best-effort checks (failure = warning). */
  readonly recommended: readonly ContractCheck[];
  /** Conditional checks (evaluated when `when` matches). */
  readonly contexts: readonly ContractContextCheck[];
}

/**
 * Result of evaluating a single check.
 */
export interface CheckResult {
  /** Check name. */
  readonly name: string;
  /** Whether the check passed (at least one selector matched). */
  readonly passed: false | true;
  /** Selectors that matched (empty if failed). */
  readonly matchedSelectors: readonly string[];
  /** Evidence source and coverage metadata (if provided by the contract). */
  readonly provenance?: Provenance;
}

/**
 * Structured result of contract validation.
 */
export interface VerificationResult {
  /** Whether all required checks and active context checks passed. */
  readonly passed: false | true;
  /** Results from required checks. */
  readonly required: readonly CheckResult[];
  /** Results from recommended checks. */
  readonly recommended: readonly CheckResult[];
  /** Results from context checks (only active contexts are included). */
  readonly contexts: readonly ContextResult[];
  /** Names of failed required checks (for quick diagnostics). */
  readonly errors: readonly string[];
  /** Names of failed recommended checks (for quick diagnostics). */
  readonly warnings: readonly string[];
}

/**
 * Result of evaluating a conditional context.
 */
export interface ContextResult {
  /** Context name. */
  readonly name: string;
  /** Whether the context was active (when clause matched). */
  readonly active: false | true;
  /** Check results for this context (empty if inactive). */
  readonly checks: readonly CheckResult[];
  /** Names of failed checks within this context. */
  readonly errors: readonly string[];
}

/**
 * DOM snapshot interface — DOM-free abstraction for testing and runtime.
 *
 * Implementations answer the question: "Does this CSS selector match
 * at least one element in the current DOM?"
 *
 * The shared layer cannot depend on `document`, so callers provide
 * this adapter. In production, this is backed by a CDP
 * `Runtime.evaluate` call; in tests, by a fixture map.
 */
export interface DomSnapshot {
  /** Returns `true` if at least one element matches the selector. */
  has(selector: string): boolean;
}

// ---------------------------------------------------------------------------
// Contract registry (static imports — no runtime file I/O)
// ---------------------------------------------------------------------------

/**
 * Pre-loaded contract registry keyed by agent id.
 *
 * Using static imports (rather than dynamic file reads) means:
 *   - Contracts are type-checked at compile time
 *   - No async I/O needed at verification time
 *   - Vitest can resolve them without fs mocks
 */
/**
 * JSON imports widen nested fields (e.g. `provenance.source`) to `string`,
 * while the contract type requires literal unions. The contract JSON files
 * are authored against the same schema, so a single narrowing assertion is
 * safe here — it only tightens types, never changes values.
 */
function toVerificationContract(c: unknown): VerificationContract {
  return c as VerificationContract;
}

const CONTRACT_REGISTRY: Readonly<Record<AgentId, VerificationContract>> = {
  traework: toVerificationContract(traeworkContract.targets.traework.verification),
  qoderwork: toVerificationContract(qoderworkContract.targets.qoderwork.verification),
  workbuddy: toVerificationContract(workbuddyContract.targets.workbuddy.verification),
  doubao: toVerificationContract(doubaoContract.targets.doubao.verification),
  codex: toVerificationContract(codexContract.targets.codex.verification),
  zcode: toVerificationContract(zcodeContract.targets.zcode.verification),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load the verification contract for a given adapter.
 *
 * @param agentId  Target adapter id.
 * @returns The verification contract, or `undefined` if no contract exists.
 *
 * @example
 * ```ts
 * const contract = loadContract('doubao');
 * if (contract) {
 *   const result = validateContract(domSnapshot, contract);
 *   console.log(result.passed ? 'OK' : 'FAILED');
 * }
 * ```
 */
export function loadContract(agentId: AgentId): VerificationContract | undefined {
  return CONTRACT_REGISTRY[agentId];
}

/**
 * Validate a DOM snapshot against a verification contract.
 *
 * Evaluates all required, recommended, and (when active) context checks.
 * Pure function — no side effects, safe to call repeatedly.
 *
 * @param snapshot  DOM snapshot to validate against.
 * @param contract  Verification contract to evaluate.
 * @returns Structured verification result with pass/fail status.
 *
 * @example
 * ```ts
 * const snapshot: DomSnapshot = {
 *   has: (sel) => document.querySelectorAll(sel).length > 0,
 * };
 * const result = validateContract(snapshot, contract);
 * if (!result.passed) {
 *   console.error('Failed checks:', result.errors);
 * }
 * ```
 */
export function validateContract(
  snapshot: DomSnapshot,
  contract: VerificationContract,
): VerificationResult {
  // Evaluate required checks.
  const required = contract.required.map((check) => evalCheck(snapshot, check));
  const errors = required.filter((r) => !r.passed).map((r) => r.name);

  // Evaluate recommended checks.
  const recommended = contract.recommended.map((check) => evalCheck(snapshot, check));
  const warnings = recommended.filter((r) => !r.passed).map((r) => r.name);

  // Evaluate context checks (only when `when` clause is active).
  const contexts = contract.contexts.map((ctx) => evalContext(snapshot, ctx));
  const contextErrors = contexts.flatMap((c) => c.errors);

  // Overall pass = all required passed AND no active context errors.
  const passed = errors.length === 0 && contextErrors.length === 0;

  return {
    passed: passed as false | true,
    required,
    recommended,
    contexts,
    errors: [...errors, ...contextErrors],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Internal evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single check against the DOM snapshot.
 *
 * A check passes if ANY selector in its `any` array matches.
 */
function evalCheck(snapshot: DomSnapshot, check: ContractCheck): CheckResult {
  const matchedSelectors = check.any.filter((sel) => snapshot.has(sel));
  return {
    name: check.name,
    passed: (matchedSelectors.length > 0) as false | true,
    matchedSelectors,
    provenance: check.provenance,
  };
}

/**
 * Evaluate a conditional context check.
 *
 * If the `when` clause does not match, the context is inactive
 * and no checks are evaluated. If active, all `required` checks
 * must pass.
 */
function evalContext(snapshot: DomSnapshot, ctx: ContractContextCheck): ContextResult {
  // Check if the context is active (any 'when' selector matches).
  const active = ctx.when.any.some((sel) => snapshot.has(sel));

  if (!active) {
    return {
      name: ctx.name,
      active: false,
      checks: [],
      errors: [],
    };
  }

  const checks = ctx.required.map((check) => evalCheck(snapshot, check));
  const errors = checks.filter((r) => !r.passed).map((r) => r.name);

  return {
    name: ctx.name,
    active: true,
    checks,
    errors,
  };
}
