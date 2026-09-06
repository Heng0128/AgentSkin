// SPDX-License-Identifier: MPL-2.0

/**
 * Notification / Toast types — shared between UI layer and shared modules.
 *
 * Originally defined in `notificationStore.ts`, moved here so UI components
 * can import the type without coupling to the store module (RC3: type dedup).
 */

/** Toast visual tone — controls color/icon rendering. */
export type ToastTone = 'default' | 'destructive';

/** Type guard for ToastTone values. */
export function isToastTone(value: unknown): value is ToastTone {
  return value === 'default' || value === 'destructive';
}

/** A single toast notification displayed in the toast stack. */
export interface Toast {
  /** Monotonic unique id — used for DOM keying and timer cleanup. */
  id: number;
  /** Localized message text displayed to the user. */
  message: string;
  /** Visual tone — 'default' (neutral) or 'destructive' (error/warning). */
  tone: ToastTone;
}

/** Callback type for displaying a toast. */
export type ShowToast = (message: string, tone?: ToastTone) => void;
