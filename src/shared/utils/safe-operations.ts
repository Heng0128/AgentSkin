// SPDX-License-Identifier: MPL-2.0
/**
 * Safe operation utilities for common error-prone patterns.
 *
 * Provides wrappers that prevent silent failures in:
 * - JSON parsing (with fallback and optional error logging).
 * - Resource cleanup (session close, socket teardown).
 */

/**
 * Safely parse a JSON string, returning a fallback on failure.
 *
 * @param json       The string to parse.
 * @param fallback   Value to return if parsing fails (default {}).
 * @param label      Optional label for error logging.
 * @param log        Optional logger function.
 * @returns Parsed object or fallback.
 *
 * @example
 * const data = safeJsonParse(raw, {}, 'config', console.error);
 */
export function safeJsonParse<T = Record<string, unknown>>(
  json: string | null | undefined,
  fallback: T = {} as T,
  label?: string,
  log?: (msg: string) => void,
): T {
  if (!json || typeof json !== 'string') {
    if (label && log) {
      log(`[${label}] expected string, got ${typeof json} — using fallback`);
    }
    return fallback;
  }
  try {
    return JSON.parse(json) as T;
  } catch (error) {
    if (label && log) {
      log(`[${label}] JSON.parse failed: ${String(error)}`);
    }
    return fallback;
  }
}

/**
 * Safely close a CDP session, swallowing and optionally logging errors.
 *
 * Use in `finally` blocks where a close error should not mask
 * the original operation result.
 *
 * @param close   Close function (may throw).
 * @param label   Optional label for error logging.
 * @param log     Optional logger function.
 */
export function safeClose(
  close: (() => void) | undefined,
  label?: string,
  log?: (msg: string) => void,
): void {
  if (!close) return;
  try {
    close();
  } catch (error) {
    if (label && log) {
      log(`[${label}] close error: ${String(error)}`);
    }
  }
}
