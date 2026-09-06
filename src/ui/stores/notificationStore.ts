// SPDX-License-Identifier: MPL-2.0

/**
 * # notificationStore
 *
 * Toast notification state and the shared showToast/fail utilities.
 *
 * Extracted from `useNotifications` (Phase A2). The `fail` helper needs the
 * current locale's messages to translate raw IPC errors — it reads the locale
 * from `shellStore` on demand (via getState) so no React hook is required
 * inside the store.
 */

import { useShellStore } from '@/stores/shellStore';

import { toMessage } from '@shared/errors';
import { registerErrorNotifier } from '@shared/errors/notify';
import { type AppLocale, DEFAULT_LOCALE, uiMessages } from '@shared/i18n';
import { getCurrentT } from '@shared/i18n/runtime-t';
import type { ShowToast, Toast } from '@shared/types';
import { isIpcTimeoutError, type SerializedIpcTimeoutError } from '@shared/withTimeout';
import { create } from 'zustand';

/** How long a toast stays visible (ms). */
const TOAST_DURATION = 3600;
/** Max toasts kept in the list. */
const MAX_TOASTS = 5;

// ---------------------------------------------------------------------------
// ToastState — encapsulates module-level toast counter + timers (P1-1 fix)
// ---------------------------------------------------------------------------

/**
 * ## ToastState
 *
 * Owns the monotonic toast id counter and the auto-dismiss timer map.
 * Previously `toastId` was a bare module-level `let` that leaked across test
 * runs, and `timers` was a closure-scoped Map with no reset entry point.
 */
class ToastState {
  private toastId = 0;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Generate the next unique toast id. */
  nextId(): number {
    return ++this.toastId;
  }

  /** Register an auto-dismiss timer for a toast. */
  setTimer(id: number, timer: ReturnType<typeof setTimeout>): void {
    this.clearTimer(id);
    this.timers.set(id, timer);
  }

  /** Clear a specific toast's timer. */
  clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Clear all pending timers — for test isolation. */
  clearAllTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /** Reset everything — for test isolation. */
  reset(): void {
    this.clearAllTimers();
    this.toastId = 0;
  }
}

/** Singleton toast state — shared across all store actions. */
const toastState = new ToastState();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map raw IPC / core error messages to user-friendly text.
 * Structured outcomes (port-occupied, requires-restart) are handled by
 * ApplyResponse.status in useThemes — they never reach fail(). This only
 * cleans up thrown-error boilerplate prefixes.
 */
function friendlyMessage(raw: string, locale: AppLocale): string {
  const t = uiMessages[locale] ?? uiMessages[DEFAULT_LOCALE];
  const cleaned = raw
    .replace(/^Error invoking remote method\s*:\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .replace(/^Error\s*$/i, '')
    .trim();

  if (!cleaned || cleaned === raw) {
    return t.actionFailed;
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

interface NotificationState {
  toasts: Toast[];

  showToast: ShowToast;
  fail: (error: unknown) => void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useNotificationStore = create<NotificationState>((set) => {
  // RC1 Fix: Register the error notifier so shared/errors/notify.ts can
  // delegate to this store without a shared → UI import dependency.
  registerErrorNotifier((error: unknown) => {
    useNotificationStore.getState().fail(error);
  });

  return {
    toasts: [],

    showToast: (message, tone = 'default') => {
      const id = toastState.nextId();
      set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, message, tone }] }));
      const timer = setTimeout(() => {
        toastState.clearTimer(id);
        set((s) => ({ toasts: s.toasts.filter((tt) => tt.id !== id) }));
      }, TOAST_DURATION);
      toastState.setTimer(id, timer);
    },

    fail: (error) => {
      // Timeout-specific friendly message — uses i18n function key so channel
      // name and seconds are safely interpolated in the user's locale.
      if (isIpcTimeoutError(error)) {
        const detail = error as SerializedIpcTimeoutError;
        // RC-6: Use shared accessor for the current locale's messages.
        const t = getCurrentT();
        const msg = t.studioTimeoutDesc(
          detail.channel ?? 'IPC',
          String(Math.round((detail.ms ?? 0) / 1000)),
        );
        useNotificationStore.getState().showToast(msg, 'destructive');
        return;
      }
      const locale = useShellStore.getState().locale;
      const message = friendlyMessage(toMessage(error), locale);
      useNotificationStore.getState().showToast(message, 'destructive');
    },
  };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset all module-level toast state (id counter + pending timers).
 * Call this in test `beforeEach` to prevent state leakage across tests.
 */
export function resetToastState(): void {
  toastState.reset();
  useNotificationStore.setState({ toasts: [] });
}
