// SPDX-License-Identifier: MPL-2.0
//
// # css-modules-matcher.test.mjs
//
// Unit tests for the CSS Modules class name matching utilities.
// Covers: generateCssModulesSelector, detectCssModulesPatterns,
// createMutationObserverConfig, extractCssModulesStems,
// groupPatternsByPrefix, createDebouncedMutationCallback, and edge cases.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CSS_MODULES_PATTERN,
  createDebouncedMutationCallback,
  createMutationObserverConfig,
  detectCssModulesPatterns,
  extractCssModulesStems,
  generateCssModulesSelector,
  generateCssModulesSelectors,
  groupPatternsByPrefix,
  MIN_STEM_LENGTH,
} from './css-modules-matcher.mjs';

// ---------------------------------------------------------------------------
// generateCssModulesSelector
// ---------------------------------------------------------------------------

describe('generateCssModulesSelector', () => {
  it('generates a basic substring attribute selector', () => {
    expect(generateCssModulesSelector('assistantRow')).toBe('[class*="assistantRow"]');
  });

  it('handles underscore-prefixed stems', () => {
    expect(generateCssModulesSelector('_header')).toBe('[class*="_header"]');
  });

  it('handles stems with numbers', () => {
    expect(generateCssModulesSelector('mainArea')).toBe('[class*="mainArea"]');
  });

  it('escapes double quotes in prefix', () => {
    const selector = generateCssModulesSelector('foo"bar');
    expect(selector).toBe('[class*="foo\\"bar"]');
  });

  it('escapes backslashes in prefix', () => {
    const selector = generateCssModulesSelector('foo\\bar');
    expect(selector).toBe('[class*="foo\\\\bar"]');
  });

  it('throws TypeError for empty string', () => {
    expect(() => generateCssModulesSelector('')).toThrow(TypeError);
  });

  it('throws TypeError for non-string input', () => {
    expect(() => generateCssModulesSelector(123)).toThrow(TypeError);
    expect(() => generateCssModulesSelector(null)).toThrow(TypeError);
    expect(() => generateCssModulesSelector(undefined)).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// generateCssModulesSelectors (multi)
// ---------------------------------------------------------------------------

describe('generateCssModulesSelectors', () => {
  it('generates multiple selectors joined by comma', () => {
    const result = generateCssModulesSelectors(['assistantRow', 'header']);
    expect(result).toBe('[class*="assistantRow"],[class*="header"]');
  });

  it('uses custom separator when provided', () => {
    const result = generateCssModulesSelectors(['a', 'b'], ' ');
    expect(result).toBe('[class*="a"] [class*="b"]');
  });

  it('returns empty string for empty array', () => {
    expect(generateCssModulesSelectors([])).toBe('');
  });

  it('throws TypeError for non-array input', () => {
    expect(() => generateCssModulesSelectors('assistantRow')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// detectCssModulesPatterns
// ---------------------------------------------------------------------------

describe('detectCssModulesPatterns', () => {
  it('detects CSS Modules patterns from a className string', () => {
    const result = detectCssModulesPatterns('_assistantRow_14nyt_184');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      original: '_assistantRow_14nyt_184',
      stem: 'assistantRow',
      selector: '[class*="assistantRow"]',
    });
  });

  it('returns empty array for BEM class names (no hash)', () => {
    const result = detectCssModulesPatterns('conversation-sidebar wb-button--primary');
    expect(result).toHaveLength(0);
  });

  it('detects multiple patterns from a space-separated string', () => {
    const result = detectCssModulesPatterns(
      '_assistantRow_14nyt_184 _header_abc123 conversation-sidebar',
    );
    expect(result).toHaveLength(2);
    expect(result[0].stem).toBe('assistantRow');
    expect(result[1].stem).toBe('header');
  });

  it('accepts an array of class name strings', () => {
    const result = detectCssModulesPatterns([
      '_mainArea_def456',
      '_gridViewItem_ghi789',
      'plain-class',
    ]);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.stem)).toEqual(['mainArea', 'gridViewItem']);
  });

  it('accepts an array of objects with className property', () => {
    const result = detectCssModulesPatterns([
      { className: '_base_x7k9_abc' },
      { className: 'ignore-me' },
      { className: '_send_btn_hash1_hash2' },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].stem).toBe('base');
    expect(result[1].stem).toBe('send');
  });

  it('accepts an array of objects with class property', () => {
    const result = detectCssModulesPatterns([
      { class: '_composer_input_hash1_hash2' },
      { class: 'static-class' },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].stem).toBe('composer');
  });

  it('deduplicates identical class names', () => {
    const result = detectCssModulesPatterns('_foo_abc123_def456 _foo_abc123_def456');
    expect(result).toHaveLength(1);
  });

  it('returns empty array for null or undefined input', () => {
    expect(detectCssModulesPatterns(null)).toEqual([]);
    expect(detectCssModulesPatterns(undefined)).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(detectCssModulesPatterns('')).toEqual([]);
  });

  it('filters out stems shorter than MIN_STEM_LENGTH', () => {
    // _x_abc123 has stem "x" (length 1), which is below MIN_STEM_LENGTH (2)
    const result = detectCssModulesPatterns('_x_abc123_def456');
    expect(result).toHaveLength(0);
  });

  it('handles realistic WorkBuddy DOM snapshot', () => {
    const snapshot =
      '_assistantRow_14nyt_184 _messageBubble_3k9f_22 conversation-sidebar _mainArea_abc_42 wb-button';
    const result = detectCssModulesPatterns(snapshot);
    const stems = result.map((p) => p.stem);
    expect(stems).toContain('assistantRow');
    expect(stems).toContain('messageBubble');
    expect(stems).toContain('mainArea');
    expect(stems).not.toContain('conversation');
    expect(stems).not.toContain('wb');
  });
});

// ---------------------------------------------------------------------------
// extractCssModulesStems
// ---------------------------------------------------------------------------

describe('extractCssModulesStems', () => {
  it('returns array of stem strings', () => {
    const result = extractCssModulesStems('_foo_bar_baz _qux_quux_123');
    expect(result).toEqual(['foo', 'qux']);
  });

  it('returns empty array when no patterns match', () => {
    expect(extractCssModulesStems('plain-class another')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// groupPatternsByPrefix
// ---------------------------------------------------------------------------

describe('groupPatternsByPrefix', () => {
  it('groups patterns by lowercase prefix', () => {
    const patterns = [
      { original: '_assistantRow_a_b', stem: 'assistantRow', selector: '' },
      { original: '_assistantText_c_d', stem: 'assistantText', selector: '' },
      { original: '_header_e_f', stem: 'header', selector: '' },
    ];
    const groups = groupPatternsByPrefix(patterns);
    expect(groups).toHaveProperty('assistant');
    expect(groups).toHaveProperty('header');
    expect(groups.assistant).toHaveLength(2);
    expect(groups.header).toHaveLength(1);
  });

  it('returns empty object for empty patterns array', () => {
    expect(groupPatternsByPrefix([])).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// createMutationObserverConfig
// ---------------------------------------------------------------------------

describe('createMutationObserverConfig', () => {
  it('returns correct default configuration', () => {
    const config = createMutationObserverConfig();
    expect(config).toEqual({
      attributes: true,
      attributeFilter: ['class'],
      subtree: true,
      childList: true,
      attributeOldValue: true,
    });
  });

  it('allows overrides of specific properties', () => {
    const config = createMutationObserverConfig({ childList: false });
    expect(config.childList).toBe(false);
    expect(config.attributes).toBe(true);
    expect(config.attributeFilter).toEqual(['class']);
  });

  it('allows adding custom properties via spread', () => {
    const config = createMutationObserverConfig({ characterData: true });
    expect(config.characterData).toBe(true);
    expect(config.attributes).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// createDebouncedMutationCallback
// ---------------------------------------------------------------------------

describe('createDebouncedMutationCallback', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('invokes callback with batched mutations after delay', () => {
    const callback = vi.fn();
    const debounced = createDebouncedMutationCallback(callback, 0);

    const mutationA = { type: 'attributes' };
    const mutationB = { type: 'childList' };

    debounced([mutationA]);
    debounced([mutationB]);

    // Should not have been called synchronously.
    expect(callback).not.toHaveBeenCalled();

    // Advance timers past the debounce delay.
    vi.advanceTimersByTime(0);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([mutationA, mutationB]);
  });

  it('groups rapid successive calls into a single callback', () => {
    const callback = vi.fn();
    const debounced = createDebouncedMutationCallback(callback, 20);

    debounced([{ type: 'attributes' }]);

    // Advance partway — not enough to trigger.
    vi.advanceTimersByTime(10);
    debounced([{ type: 'childList' }]);

    // The original timer is still pending (second call does not reset it).
    // Advance to just before the original timer fires.
    vi.advanceTimersByTime(9);
    expect(callback).not.toHaveBeenCalled();

    // Now the original 20ms window expires.
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([{ type: 'attributes' }, { type: 'childList' }]);
  });

  it('throws TypeError for non-function callback', () => {
    expect(() => createDebouncedMutationCallback(null)).toThrow(TypeError);
    expect(() => createDebouncedMutationCallback('not-a-function')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// CSS_MODULES_PATTERN constant
// ---------------------------------------------------------------------------

describe('CSS_MODULES_PATTERN', () => {
  it('matches valid CSS Modules class names', () => {
    expect('_assistantRow_14nyt_184'.match(CSS_MODULES_PATTERN)).toBeTruthy();
    expect('_header_abc123'.match(CSS_MODULES_PATTERN)).toBeTruthy();
    expect('_mainArea_def456_ghi789'.match(CSS_MODULES_PATTERN)).toBeTruthy();
  });

  it('does not match BEM class names', () => {
    expect('conversation-sidebar'.match(CSS_MODULES_PATTERN)).toBeFalsy();
    expect('wb-button--primary'.match(CSS_MODULES_PATTERN)).toBeFalsy();
  });

  it('does not match AgentSkin host markers', () => {
    expect('_agentskin-host-workbuddy'.match(CSS_MODULES_PATTERN)).toBeFalsy();
  });

  it('matches class names with a single hash segment', () => {
    expect('_foo_bar123'.match(CSS_MODULES_PATTERN)).toBeTruthy();
  });

  it('does not match class names with no hash segments', () => {
    expect('_foobar'.match(CSS_MODULES_PATTERN)).toBeFalsy();
  });

  it('does not match hash segments shorter than 2 chars', () => {
    expect('_foo_b'.match(CSS_MODULES_PATTERN)).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// MIN_STEM_LENGTH constant
// ---------------------------------------------------------------------------

describe('MIN_STEM_LENGTH', () => {
  it('is set to 2', () => {
    expect(MIN_STEM_LENGTH).toBe(2);
  });
});
