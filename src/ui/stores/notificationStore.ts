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
import { uiMessages } from '@shared/i18n';
import { isIpcTimeoutError, type SerializedIpcTimeoutError } from '@shared/withTimeout';
import { create } from 'zustand';

export type ToastTone = 'default' | 'destructive';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

export type ShowToast = (message: string, tone?: ToastTone) => void;

/** How long a toast stays visible (ms). */
const TOAST_DURATION = 3600;
/** Max toasts kept in the list. */
const MAX_TOASTS = 5;

/**
 * Map raw IPC / core error messages to user-friendly text.
 * Structured outcomes (port-occupied, requires-restart) are handled by
 * ApplyResponse.status in useThemes — they never reach fail(). This only
 * cleans up thrown-error boilerplate prefixes.
 */
function friendlyMessage(raw: string, locale: string): string {
  const t = uiMessages[locale as keyof typeof uiMessages] ?? uiMessages['zh-CN'];
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

interface NotificationState {
  toasts: Toast[];

  showToast: ShowToast;
  fail: (error: unknown) => void;
}

export const useNotificationStore = create<NotificationState>((set) => {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  const clearTimer = (id: number) => {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.delete(id);
    }
  };

  return {
    toasts: [],

    showToast: (message, tone = 'default') => {
      const id = Date.now() + Math.random();
      clearTimer(id);
      set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, message, tone }] }));
      const timer = setTimeout(() => {
        clearTimer(id);
        set((s) => ({ toasts: s.toasts.filter((tt) => tt.id !== id) }));
      }, TOAST_DURATION);
      timers.set(id, timer);
    },

    fail: (error) => {
      // Timeout-specific friendly message — uses i18n keys with interpolation
      // so channel name and seconds are shown in the user's locale.
      if (isIpcTimeoutError(error)) {
        const detail = error as SerializedIpcTimeoutError;
        const locale = useShellStore.getState().locale;
        const t = uiMessages[locale] ?? uiMessages['zh-CN'];
        const msg = t.studioTimeoutDesc
          .replace('{channel}', detail.channel ?? 'IPC')
          .replace('{ms/1000}', String(Math.round((detail.ms ?? 0) / 1000)));
        useNotificationStore.getState().showToast(msg, 'destructive');
        return;
      }
      const locale = useShellStore.getState().locale;
      const message = friendlyMessage(toMessage(error), String(locale));
      useNotificationStore.getState().showToast(message, 'destructive');
    },
  };
});
