// SPDX-License-Identifier: MPL-2.0

/**
 * # notify — centralized error notification helpers
 *
 * Cross-store notification helpers. Instead of every store importing
 * `useNotificationStore` and calling `.fail(error)` directly (which creates
 * a hard dependency on the notification store), they call these helpers.
 *
 * ## Why
 *
 * Centralizing the notification call pattern means:
 *   1. Stores don't need to import `useNotificationStore` for error reporting.
 *   2. The notification contract (how errors are displayed) lives in one place.
 *   3. Future changes (e.g., adding a log-to-file step) have a single chokepoint.
 *
 * ## Architecture
 *
 * Uses a callback injection pattern to avoid shared → UI store dependency.
 * The UI layer (`notificationStore`) registers a notifier on init.
 * Shared code calls `notifyError()` which delegates to the registered callback.
 */

type ErrorNotifier = (error: unknown) => void;

let _notifier: ErrorNotifier | null = null;

/**
 * Register the error notifier callback.
 * Called once by the notification store on initialization.
 */
export function registerErrorNotifier(notifier: ErrorNotifier): void {
  _notifier = notifier;
}

/**
 * Report an error to the user via the notification system.
 * Delegates to the registered notifier (set by UI layer).
 * If no notifier is registered, the error is silently ignored (no-op).
 */
export function notifyError(error: unknown): void {
  _notifier?.(error);
}
