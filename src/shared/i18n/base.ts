// SPDX-License-Identifier: MPL-2.0

export const APP_LOCALES = ['zh-CN', 'en'] as const;
export type AppLocale = (typeof APP_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'zh-CN';
export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === 'string' && APP_LOCALES.includes(value as AppLocale);
}
export function localeFromSystem(value: string | undefined): AppLocale {
  // P3-3: Replaced the hardcoded "always return zh-CN" with a proper lookup
  // against the supported APP_LOCALES list. Future locales only need to be
  // added to APP_LOCALES + the uiMessages map below — this function will
  // automatically resolve system or user-provided values via BCP-47 prefix
  // match (zh → zh-CN, en → en, en-US → en, etc.) so no extra edit is
  // required when a new translation is shipped. Falls back to DEFAULT_LOCALE
  // for unknown / unsupported values.
  if (!value) return DEFAULT_LOCALE;
  const normalized = value.trim().replace('_', '-');
  const exact = APP_LOCALES.find((l) => l.toLowerCase() === normalized.toLowerCase());
  if (exact) return exact;
  const prefix = normalized.toLowerCase().split('-')[0];
  const byPrefix = APP_LOCALES.find((l) => {
    const lower = l.toLowerCase();
    return lower === prefix || lower.startsWith(`${prefix}-`);
  });
  if (byPrefix) return byPrefix;
  return DEFAULT_LOCALE;
}
