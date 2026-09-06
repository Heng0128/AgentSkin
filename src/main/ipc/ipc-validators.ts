// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Validators
 *
 * Shared parameter-validation helpers for IPC handlers. Centralises the
 * "parse + validate + throw on invalid" pattern so every IPC handler uses
 * the same error semantics:
 *
 *   - Invalid parameters always `throw new Error(getMainMessages().*)`
 *     (Electron converts this to an IPC rejection the renderer can catch).
 *   - Error messages are always localised via `getMainMessages()`.
 *   - Validation helpers use assertion-style (`assert*`) naming so call
 *     sites read as declarative guards.
 *
 * Before this module, IPC validation was scattered across 6 files with
 * three different error styles:
 *   1. Hardcoded English: `throw new Error('Invalid app id.')`
 *   2. Code-like identifiers: `throw new Error('INVALID_PORT')`
 *   3. Soft-fail returns: `return { ok: false, reason: '...' }`
 *
 * The soft-fail pattern was especially problematic — the renderer had to
 * check each IPC result differently depending on which channel it called,
 * and some channels silently returned empty results instead of errors.
 */

import { getMainMessages } from '../../shared/i18n';
import { isSafeThemeId } from '../../shared/theme-id';
import { type AgentId, isAgentId } from '../../shared/types';

/**
 * Assert that `value` is a valid `AgentId`. Throws a localised error if not.
 *
 * Used by every IPC handler that receives an `appId` parameter — previously
 * some handlers threw `'Invalid app id.'` (English), some threw
 * `'INVALID_AGENT_ID'` (code-like), and some returned `{ ok: false }`
 * (soft-fail). Now all use this single helper.
 */
export function assertAgentId(value: unknown): asserts value is AgentId {
  if (!isAgentId(value)) {
    throw new Error(getMainMessages().invalidAgentId);
  }
}

/**
 * Assert that `value` is a valid theme id. Throws a localised error if not.
 *
 * Used by IPC handlers that receive a `themeId` parameter. Delegates to
 * `isSafeThemeId` from shared/theme-id.ts to ensure consistent validation
 * rules across the application layer and the engine layer.
 */
export function assertSafeThemeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isSafeThemeId(value)) {
    throw new Error(getMainMessages().invalidThemeId);
  }
}

/**
 * Assert that `value` is a non-empty string. Used by IPC handlers that
 * receive a generic string parameter (path, search query, etc.).
 */
export function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== 'string' || !value) {
    throw new Error(message);
  }
}

/**
 * Assert that `value` is a valid port number (null, or an integer in
 * [1024, 65535]). Used by the settings IPC handler for port overrides.
 *
 * `null` is accepted because it means "clear the override".
 */
export function assertPortOrNull(value: unknown): asserts value is number | null {
  if (value !== null && !isPortInRange(value)) {
    throw new Error(getMainMessages().invalidPort);
  }
}

/**
 * Non-throwing port check. Returns true if `value` is an integer in
 * [1024, 65535]. Shared by {@link assertPortOrNull} (IPC layer) and
 * {@link SettingsService} (persistence layer) so both use the exact same
 * range definition — previously each had its own `isValidPort` with the
 * same logic, risking drift if the range ever changes.
 */
export function isPortInRange(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535;
}
