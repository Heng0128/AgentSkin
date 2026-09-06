// SPDX-License-Identifier: MPL-2.0

/**
 * # intl — Localization formatting utilities
 *
 * Provides Intl.DateTimeFormat and Intl.NumberFormat wrappers that respect
 * the application's selected locale (from shellStore) rather than relying on
 * the browser's default locale.
 */

import type { AppLocale } from './i18n';

/**
 * BCP-47 to Intl locale mapping for locales whose BCP-47 tag does not match
 * the Intl API's expected locale string.
 *
 * `en` maps to `en-US` because the Intl API requires a region subtag for
 * proper number/date formatting (e.g. `Intl.NumberFormat('en')` uses US-style
 * grouping by default on some platforms, but `en-US` is explicit and portable).
 * `zh-CN` maps to itself since the BCP-47 tag is already a valid Intl locale.
 */
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

/**
 * Format a date as a relative time string (e.g. "3 小时前", "2 天前", "just now").
 * Falls back to a short date for timestamps older than 30 days.
 */
export function formatRelativeTime(date: Date, locale: AppLocale): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHour = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHour / 24);

  const isZh = locale === 'zh-CN';

  if (diffSec < 60) return isZh ? '刚刚' : 'just now';
  if (diffMin < 60) return isZh ? `${diffMin} 分钟前` : `${diffMin}m ago`;
  if (diffHour < 24) return isZh ? `${diffHour} 小时前` : `${diffHour}h ago`;
  if (diffDay < 30) return isZh ? `${diffDay} 天前` : `${diffDay}d ago`;
  // Older than 30 days → short date
  return formatDate(date, locale);
}

/** Format a file size in bytes to a human-readable string (B, KB, MB, GB) */
export function formatFileSize(bytes: number, locale: AppLocale): string {
  if (bytes < 1024) return `${formatNumber(bytes, locale)} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(Math.round(bytes / 1024), locale)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${formatNumber(Number((bytes / (1024 * 1024)).toFixed(1)), locale)} MB`;
  return `${formatNumber(Number((bytes / (1024 * 1024 * 1024)).toFixed(1)), locale)} GB`;
}
