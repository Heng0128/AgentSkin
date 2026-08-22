// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDeepCore, resetDom } from './deep-core-helpers';

const { FragmentRegistry } = loadDeepCore();

describe('FragmentRegistry', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    FragmentRegistry.dispose();
    resetDom();
  });

  it('should register a fragment without activating it', () => {
    FragmentRegistry.register('test-frag', '.test { color: red; }');
    // No sheets should be adopted yet
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should activate a fragment by adopting its CSS into adoptedStyleSheets', () => {
    FragmentRegistry.register('test-frag', '.test { color: red; }');
    FragmentRegistry.activate('test-frag');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
  });

  it('should deactivate a fragment and remove its sheet', () => {
    FragmentRegistry.register('test-frag', '.test { color: red; }');
    FragmentRegistry.activate('test-frag');
    expect(document.adoptedStyleSheets.length).toBe(1);

    FragmentRegistry.deactivate('test-frag');
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should be idempotent when activating an already-active fragment', () => {
    FragmentRegistry.register('test-frag', '.test { color: red; }');
    FragmentRegistry.activate('test-frag');
    FragmentRegistry.activate('test-frag'); // Second call should be no-op

    expect(document.adoptedStyleSheets.length).toBe(1);
  });

  it('should insert fragment before custom layer (custom wins)', () => {
    // Simulate existing custom layer
    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';
    document.adoptedStyleSheets = [customSheet];

    FragmentRegistry.register('test-frag', '.test { color: blue; }');
    FragmentRegistry.activate('test-frag');

    // Fragment should be at index 0, custom at index 1
    expect(document.adoptedStyleSheets.length).toBe(2);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
    expect(document.adoptedStyleSheets[1].__agentskin_layer).toBe('custom');
  });

  it('should append fragment at end when no custom layer exists', () => {
    FragmentRegistry.register('test-frag', '.test { color: green; }');
    FragmentRegistry.activate('test-frag');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
  });

  it('hotReplace should atomically replace CSS without flicker', () => {
    FragmentRegistry.register('test-frag', '.test { color: red; }');
    FragmentRegistry.activate('test-frag');

    const originalSheet = document.adoptedStyleSheets[0];

    FragmentRegistry.hotReplace('test-frag', '.test { color: blue; }');

    // Same sheet instance (atomic replace, no deactivate+activate cycle)
    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0]).toBe(originalSheet);
  });

  it('hotReplace on unknown id should register and activate', () => {
    FragmentRegistry.hotReplace('new-frag', '.new { color: yellow; }');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('new-frag');
  });

  it('dispose should deactivate all fragments', () => {
    FragmentRegistry.register('frag-1', '.a { color: red; }');
    FragmentRegistry.register('frag-2', '.b { color: blue; }');
    FragmentRegistry.activate('frag-1');
    FragmentRegistry.activate('frag-2');
    expect(document.adoptedStyleSheets.length).toBe(2);

    FragmentRegistry.dispose();
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should handle invalid CSS gracefully (no throw)', () => {
    FragmentRegistry.register('bad-frag', '<<< invalid css >>>');
    // Should not throw, just skip activation
    expect(() => FragmentRegistry.activate('bad-frag')).not.toThrow();
  });
});
