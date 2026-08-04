/** Owns toast notification state and the shared showToast/fail utilities. */

import { useCallback, useEffect, useRef, useState } from 'react';

import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'destructive';
}

export type ShowToast = (message: string, tone?: Toast['tone']) => void;

/**
 * Map raw IPC / core error messages to user-friendly text.
 *
 * NOTE: structured outcomes (port-occupied, requires-restart) are already
 * handled by ApplyResponse.status in useThemes — they never reach fail().
 * This function only cleans up the message text of *thrown* errors (IPC
 * boilerplate prefixes, empty strings) so the user sees the real reason
 * instead of "Error invoking remote method: ...".
 */
function friendlyMessage(raw: string, t: UiMessages): string {
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

export function useNotifications(t: UiMessages) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastTimerRef = useRef<Map<number, number>>(new Map());
  // Keep the latest messages for stable fail(): fail is consumed by one-time
  // effects (useBoot, event listeners) whose dep arrays must not churn when
  // the locale changes — otherwise the whole boot sequence re-runs.
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);

  const clearTimer = useCallback((id: number) => {
    const timer = toastTimerRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      toastTimerRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback<ShowToast>(
    (message, tone = 'default') => {
      const id = Date.now() + Math.random();
      clearTimer(id);
      setToasts((prev) => [...prev.slice(-4), { id, message, tone }]);
      const timer = window.setTimeout(() => {
        clearTimer(id);
        setToasts((prev) => prev.filter((tt) => tt.id !== id));
      }, 3600);
      toastTimerRef.current.set(id, timer);
    },
    [clearTimer],
  );

  const fail = useCallback(
    (error: unknown) => {
      const current = tRef.current;
      const message = friendlyMessage(toMessage(error), current);
      showToast(message || current.actionFailed, 'destructive');
    },
    [showToast],
  );

  // P2-15: Clear all pending toast timers on unmount. Without this, the
  // setTimeout callbacks fire after the component tree is torn down and
  // trigger React's "Can't perform a React state update on an unmounted
  // component" warning in StrictMode / HMR reloads.
  useEffect(() => {
    return () => {
      for (const [id, timer] of toastTimerRef.current.entries()) {
        window.clearTimeout(timer);
        toastTimerRef.current.delete(id);
      }
    };
  }, []);

  return { toasts, showToast, fail };
}
