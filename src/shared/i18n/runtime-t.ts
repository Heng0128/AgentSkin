// SPDX-License-Identifier: MPL-2.0

/**
 * # runtime-t — shared i18n accessor
 *
 * Single source of truth for reading the current locale's message dictionary.
 *
 * ## Why
 *
 * Five stores (`themeStore`, `settingsStore`, `environmentStore`,
 * `installFlowStore`, `notificationStore`) each had a private `currentT()`
 * helper that did `useShellStore.getState().locale` + `uiMessages[locale]`.
 * This extracts the pattern into one place so:
 *   1. The locale-to-messages lookup logic is consistent across stores.
 *   2. Future changes (e.g., lazy-loading locales) have one chokepoint.
 *
 * ## Architecture
 *
 * Uses a callback injection pattern to avoid shared → UI store dependency.
 * The UI layer (`shellStore`) registers a locale reader on init.
 * Shared code calls `getCurrentT()` which delegates to the registered callback.
 */

import type { UiMessages } from './index';
import { uiMessages } from './index';

type LocaleReader = () => UiMessages;

let _localeReader: LocaleReader | null = null;

/**
 * Register the locale reader callback.
 * Called once by the shell store on initialization.
 */
export function registerLocaleReader(reader: LocaleReader): void {
  _localeReader = reader;
}

/**
 * Build the i18n dictionary for the current locale.
 * Delegates to the registered locale reader (set by UI layer).
 * Falls back to the default locale's messages if no reader is registered.
 */
export function getCurrentT(): UiMessages {
  if (_localeReader) {
    return _localeReader();
  }
  // Fallback: return default locale messages.
  // Tries 'zh-CN' first (the production DEFAULT_LOCALE), then 'en' for
  // compatibility with test mocks that may use different key structures.
  return uiMessages['zh-CN'] ?? uiMessages.en;
}
