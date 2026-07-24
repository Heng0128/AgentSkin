// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isAppLocale, localeFromSystem, mainMessages, uiMessages } from './i18n';

describe('i18n', () => {
  it('always resolves to Chinese (app is Chinese-only)', () => {
    expect(localeFromSystem('zh-CN')).toBe('zh-CN');
    expect(localeFromSystem('zh-Hant')).toBe('zh-CN');
    expect(localeFromSystem('en-US')).toBe('zh-CN');
    expect(localeFromSystem('en-GB')).toBe('zh-CN');
    expect(localeFromSystem('fr-FR')).toBe(DEFAULT_LOCALE);
    expect(localeFromSystem(undefined)).toBe(DEFAULT_LOCALE);
  });

  it('accepts only application locales', () => {
    expect(isAppLocale('zh-CN')).toBe(true);
    expect(isAppLocale('en')).toBe(true);
    expect(isAppLocale('en-US')).toBe(false);
    expect(isAppLocale('fr')).toBe(false);
  });

  it('keeps Chinese and English dictionaries structurally aligned', () => {
    expect(Object.keys(uiMessages.en).sort()).toEqual(Object.keys(uiMessages['zh-CN']).sort());
    expect(Object.keys(mainMessages.en).sort()).toEqual(Object.keys(mainMessages['zh-CN']).sort());
  });
});
