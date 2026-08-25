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
    // Edge cases
    expect(isAppLocale('')).toBe(false);
    expect(isAppLocale(null)).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
    expect(isAppLocale(123)).toBe(false);
  });

  it('keeps Chinese and English dictionaries structurally aligned', () => {
    expect(Object.keys(uiMessages.en).sort()).toEqual(Object.keys(uiMessages['zh-CN']).sort());
    expect(Object.keys(mainMessages.en).sort()).toEqual(Object.keys(mainMessages['zh-CN']).sort());
  });

  it('has no empty string translations in either locale', () => {
    for (const [key, value] of Object.entries(uiMessages['zh-CN'])) {
      if (typeof value === 'string') {
        expect(value, `uiMessages['zh-CN'].${key} should not be empty`).not.toBe('');
      }
    }
    for (const [key, value] of Object.entries(uiMessages.en)) {
      if (typeof value === 'string') {
        expect(value, `uiMessages.en.${key} should not be empty`).not.toBe('');
      }
    }
  });

  it('has matching function signatures between locales', () => {
    type UiMsgKey = keyof (typeof uiMessages)['zh-CN'];
    const zhKeys = Object.keys(uiMessages['zh-CN']) as UiMsgKey[];
    for (const key of zhKeys) {
      const zhVal = uiMessages['zh-CN'][key];
      const enVal = uiMessages.en[key];
      expect(typeof zhVal, `uiMessages['zh-CN'].${key} type mismatch with en`).toBe(typeof enVal);
      // Arity check: if both are functions, parameter counts must match
      if (typeof zhVal === 'function' && typeof enVal === 'function') {
        expect(zhVal.length, `uiMessages['zh-CN'].${key} arity mismatch with en`).toBe(
          enVal.length,
        );
      }
    }
  });

  it('has no duplicate keys within a locale (case-insensitive collision check)', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const keys = Object.keys(uiMessages[locale]);
      const lowerKeys = keys.map((k) => k.toLowerCase());
      const uniqueKeys = new Set(lowerKeys);
      expect(uniqueKeys.size, `uiMessages.${locale} has case-insensitive duplicate keys`).toBe(
        lowerKeys.length,
      );
    }
  });

  it('DEFAULT_LOCALE is a valid AppLocale', () => {
    expect(isAppLocale(DEFAULT_LOCALE)).toBe(true);
  });
});
