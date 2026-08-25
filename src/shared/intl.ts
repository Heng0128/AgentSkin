// SPDX-License-Identifier: MPL-2.0

/**
 * # intl — Localization formatting utilities
 *
 * Provides Intl.DateTimeFormat and Intl.NumberFormat wrappers that respect
 * the application's selected locale (from shellStore) rather than relying on
 * the browser's default locale.
 */

import type { AppLocale } from './i18n';

/** BCP-47 to Intl locale mapping (for locales that differ from BCP-47) */
const LOCALE_MAP: Record<AppLocale, string> = {
  'zh-CN': 'zh-CN',
  en: 'en-US',
};

function toIntlLocale(locale: AppLocale): string {
  return LOCALE_MAP[locale] ?? locale;
}

/** Format a time as HH:mm:ss using the app's selected locale */
export function formatTime(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

/** Format a date as a short date string using the app's selected locale */
export function formatDate(date: Date, locale: AppLocale): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Format a number with locale-appropriate grouping separators */
export function formatNumber(value: number, locale: AppLocale): string {
  return new Intl.NumberFormat(toIntlLocale(locale)).format(value);
}

/** Format a file size in bytes to a human-readable string (B, KB, MB, GB) */
export function formatFileSize(bytes: number, locale: AppLocale): string {
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024), locale)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${formatNumber(Number((bytes / (1024 * 1024)).toFixed(1)), locale)} MB`;
  return `${formatNumber(Number((bytes / (1024 * 1024 * 1024)).toFixed(1)), locale)} GB`;
}
