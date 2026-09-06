// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/session-types
 *
 * Pure type definitions for CSS variable session and health checks.
 * Extracted from health-monitor.ts to break the reverse dependency:
 *   types.ts → health-monitor.ts (BAD)
 * becomes:
 *   types.ts → session-types.ts (GOOD)
 *   health-monitor.ts → session-types.ts (GOOD)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a single health check. */
export interface HealthCheckResult {
  /** Whether all expected tokens match their actual values. */
  readonly healthy: boolean;
  /** Tokens that have drifted (name → { expected, actual }). */
  readonly drift: ReadonlyArray<{
    readonly token: string;
    readonly expected: string;
    readonly actual: string;
  }>;
  /** Tokens that are missing from the target. */
  readonly missing: readonly string[];
  /** Timestamp of the check. */
  readonly timestamp: number;
}

/** Configuration for the health monitor. */
export interface HealthMonitorConfig {
  /** Interval between health checks in ms (default: 5000). */
  intervalMs: number;
  /** Maximum self-heal attempts before marking FAILED (default: 3). */
  maxRetries: number;
  /** Initial backoff delay in ms (default: 1000). */
  initialBackoffMs: number;
  /** Maximum backoff delay in ms (default: 10000). */
  maxBackoffMs: number;
  /** Whether to auto-heal on drift detection (default: true). */
  autoHeal: boolean;
}

/** Minimal session interface for CSS variable reads. */
export interface CssVariableSession {
  evaluate(expression: string): Promise<unknown>;
}
