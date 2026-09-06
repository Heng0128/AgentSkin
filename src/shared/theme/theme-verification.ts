// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-verification
 *
 * Theme verification evidence chain — tracks whether a theme has been
 * validated against a specific version of its target agent application.
 *
 * Inspired by dshworks/awesome-dsh-themes' evidence model: each theme
 * record carries an `evidence` field (path#key) that can be clicked to
 * verify, plus status tracking (verified / unverified / broken) and a
 * `verifiedAgainst` field recording the target app version at the time
 * of verification.
 *
 * ## Architecture
 *
 * ```
 * theme-verification.ts (pure types + helpers)
 * ├── ThemeVerification — verification metadata interface
 * ├── VerificationStatus — status union type
 * ├── EvidenceEntry — individual evidence record
 * ├── getVerificationStatus() — compute status from evidence + version
 * ├── isVerificationStale() — check if re-verification is needed
 * └── formatEvidenceRef() — format a clickable evidence reference
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * import {
 *   type ThemeVerification,
 *   getVerificationStatus,
 *   isVerificationStale,
 * } from '@shared/theme/theme-verification';
 *
 * const verification: ThemeVerification = {
 *   status: 'verified',
 *   verifiedAgainst: '2.4.1',
 *   evidence: [
 *     { path: 'assets/css/traework.css', key: 'solo-shell', passed: true },
 *   ],
 *   lastVerified: '2026-08-20T10:30:00Z',
 * };
 *
 * if (isVerificationStale(verification, '2.5.0')) {
 *   console.warn('Theme needs re-verification against new agent version');
 * }
 * ```
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Verification status of a theme against its target agent.
 *
 * - `verified`  — theme has been validated and all checks passed
 * - `unverified` — theme has not yet been validated (new or pending)
 * - `broken`    — theme was previously verified but now fails checks
 */
export type VerificationStatus = 'verified' | 'unverified' | 'broken';

/**
 * A single evidence entry — records one verification check result.
 *
 * The `path` field points to the file within the theme package, and
 * `key` identifies the specific check or selector group. When `passed`
 * is true, the evidence supports the `verified` status; when false,
 * it contributes to the `broken` status.
 */
export interface EvidenceEntry {
  /** Path to the file within the theme package (e.g., "assets/css/traework.css"). */
  readonly path: string;
  /** Identifier for the specific check or selector group (e.g., "solo-shell"). */
  readonly key: string;
  /** Whether this evidence check passed. */
  readonly passed: boolean;
  /** Optional human-readable detail (e.g., error message on failure). */
  readonly detail?: string;
}

/**
 * Theme verification metadata — the evidence chain for a theme.
 *
 * Attached to a theme record to track its validation state over time.
 * When the target agent application updates (version bump), the
 * `verifiedAgainst` field is compared with the current version to
 * determine if re-verification is needed.
 */
export interface ThemeVerification {
  /** Current verification status. */
  readonly status: VerificationStatus;
  /**
   * The version of the target agent application that this theme was
   * last verified against (semver string, e.g., "2.4.1").
   * `null` when status is `unverified`.
   */
  readonly verifiedAgainst: string | null;
  /** List of individual evidence records. */
  readonly evidence: readonly EvidenceEntry[];
  /**
   * ISO 8601 timestamp of the last verification run.
   * `null` when status is `unverified`.
   */
  readonly lastVerified: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Canonical 14 --agentskin-* tokens required by the theme contract. */
export const REQUIRED_TOKENS: readonly string[] = [
  '--agentskin-accent',
  '--agentskin-secondary',
  '--agentskin-bg',
  '--agentskin-text',
  '--agentskin-muted',
  '--agentskin-surface',
  '--agentskin-surface-elevated',
  '--agentskin-border',
  '--agentskin-code-bg',
  '--agentskin-code-fg',
  '--agentskin-input-bg',
  '--agentskin-button-bg',
  '--agentskin-focus-ring',
  '--agentskin-selection',
];

/** All known agent identifiers. */
export const KNOWN_AGENTS: readonly string[] = [
  'traework',
  'qoderwork',
  'workbuddy',
  'doubao',
  'codex',
  'zcode',
];

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Compute the verification status from a set of evidence entries.
 *
 * Rules:
 * - If no evidence exists → `unverified`
 * - If all evidence entries passed → `verified`
 * - If any evidence entry failed → `broken`
 *
 * @param evidence  Array of evidence entries to evaluate.
 * @returns The computed verification status.
 *
 * @example
 * ```ts
 * const status = getVerificationStatus([
 *   { path: 'a.css', key: 'check1', passed: true },
 *   { path: 'b.css', key: 'check2', passed: false, detail: 'missing selector' },
 * ]);
 * // status === 'broken'
 * ```
 */
export function getVerificationStatus(evidence: readonly EvidenceEntry[]): VerificationStatus {
  if (evidence.length === 0) return 'unverified';

  const allPassed = evidence.every((e) => e.passed);
  return allPassed ? 'verified' : 'broken';
}

/**
 * Check if a theme's verification is stale relative to a target version.
 *
 * A verification is considered stale when:
 * - The status is `unverified` or `broken` (always stale)
 * - The `verifiedAgainst` version differs from the `currentVersion`
 * - The `lastVerified` timestamp is older than `maxAgeDays` days
 *
 * @param verification   The theme verification metadata.
 * @param currentVersion The current version of the target agent application.
 * @param maxAgeDays     Maximum age in days before re-verification is recommended (default: 30).
 * @returns `true` if the theme should be re-verified.
 *
 * @example
 * ```ts
 * // Theme verified against 2.4.1, but agent is now at 2.5.0
 * const stale = isVerificationStale(verification, '2.5.0');
 * // stale === true
 * ```
 */
export function isVerificationStale(
  verification: ThemeVerification,
  currentVersion: string,
  maxAgeDays = 30,
): boolean {
  // Unverified or broken themes are always stale.
  if (verification.status === 'unverified' || verification.status === 'broken') {
    return true;
  }

  // Version mismatch — agent was updated since last verification.
  if (verification.verifiedAgainst !== currentVersion) {
    return true;
  }

  // Check age-based staleness.
  if (verification.lastVerified) {
    const lastDate = new Date(verification.lastVerified);
    const now = new Date();
    const ageMs = now.getTime() - lastDate.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > maxAgeDays) return true;
  }

  return false;
}

/**
 * Format an evidence entry as a clickable reference string.
 *
 * Produces a `path#key` string that can be used in CLI output or
 * UI links to pinpoint the exact evidence location within a
 * theme package.
 *
 * @param evidence  The evidence entry to format.
 * @returns Formatted string in `path#key` format.
 *
 * @example
 * ```ts
 * const ref = formatEvidenceRef({ path: 'assets/css/traework.css', key: 'solo-shell', passed: true });
 * // ref === 'assets/css/traework.css#solo-shell'
 * ```
 */
export function formatEvidenceRef(evidence: EvidenceEntry): string {
  return `${evidence.path}#${evidence.key}`;
}

/**
 * Build a complete ThemeVerification object from evidence entries
 * and metadata. Computes the status automatically.
 *
 * @param evidence         List of evidence entries.
 * @param verifiedAgainst  Target agent version (or null if unverified).
 * @param lastVerified     ISO 8601 timestamp of last verification (or null).
 * @returns A fully populated ThemeVerification object.
 */
export function buildVerification(
  evidence: readonly EvidenceEntry[],
  verifiedAgainst: string | null = null,
  lastVerified: string | null = null,
): ThemeVerification {
  return {
    status: getVerificationStatus(evidence),
    verifiedAgainst,
    evidence,
    lastVerified,
  };
}

/**
 * Count evidence entries by pass/fail status.
 *
 * Useful for summary reporting in verification scripts.
 *
 * @param evidence  Array of evidence entries.
 * @returns Object with `passed` and `failed` counts.
 */
export function summarizeEvidence(evidence: readonly EvidenceEntry[]): {
  passed: number;
  failed: number;
  total: number;
} {
  let passed = 0;
  let failed = 0;
  for (const entry of evidence) {
    if (entry.passed) passed++;
    else failed++;
  }
  return { passed, failed, total: evidence.length };
}
