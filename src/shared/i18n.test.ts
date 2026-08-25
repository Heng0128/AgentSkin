// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, isAppLocale, localeFromSystem, mainMessages, uiMessages } from './i18n';

describe('i18n', () => {
  it('resolves system locale via BCP-47 prefix matching', () => {
    // Exact match
    expect(localeFromSystem('zh-CN')).toBe('zh-CN');
    expect(localeFromSystem('en')).toBe('en');
    // Prefix match (zh-Hant → zh-CN, en-US → en)
    expect(localeFromSystem('zh-Hant')).toBe('zh-CN');
    expect(localeFromSystem('en-US')).toBe('en');
    expect(localeFromSystem('en-GB')).toBe('en');
    // Unsupported locale falls back to DEFAULT_LOCALE
    expect(localeFromSystem('fr-FR')).toBe(DEFAULT_LOCALE);
    expect(localeFromSystem(undefined)).toBe(DEFAULT_LOCALE);
    // Underscore separator normalized to hyphen
    expect(localeFromSystem('en_US')).toBe('en');
    expect(localeFromSystem('zh_CN')).toBe('zh-CN');
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
