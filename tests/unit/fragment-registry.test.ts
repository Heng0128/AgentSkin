// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDeepCore, resetDom } from './deep-core-helpers';

const { FragmentRegistry } = loadDeepCore();

describe('FragmentRegistry', () => {
  let registry: InstanceType<typeof FragmentRegistry>;

  beforeEach(() => {
    resetDom();
    registry = new FragmentRegistry();
  });

  afterEach(() => {
    registry.dispose();
    resetDom();
  });

  it('should register a fragment without activating it', () => {
    registry.register('test-frag', '.test { color: red; }');
    // No sheets should be adopted yet
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should activate a fragment by adopting its CSS into adoptedStyleSheets', () => {
    registry.register('test-frag', '.test { color: red; }');
    registry.activate('test-frag');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
  });

  it('should deactivate a fragment and remove its sheet', () => {
    registry.register('test-frag', '.test { color: red; }');
    registry.activate('test-frag');
    expect(document.adoptedStyleSheets.length).toBe(1);

    registry.deactivate('test-frag');
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should be idempotent when activating an already-active fragment', () => {
    registry.register('test-frag', '.test { color: red; }');
    registry.activate('test-frag');
    registry.activate('test-frag'); // Second call should be no-op

    expect(document.adoptedStyleSheets.length).toBe(1);
  });

  it('should insert fragment before custom layer (custom wins)', () => {
    // Simulate existing custom layer
    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';
    document.adoptedStyleSheets = [customSheet];

    registry.register('test-frag', '.test { color: blue; }');
    registry.activate('test-frag');

    // Fragment should be at index 0, custom at index 1
    expect(document.adoptedStyleSheets.length).toBe(2);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
    expect(document.adoptedStyleSheets[1].__agentskin_layer).toBe('custom');
  });

  it('should append fragment at end when no custom layer exists', () => {
    registry.register('test-frag', '.test { color: green; }');
    registry.activate('test-frag');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('test-frag');
  });

  it('hotReplace should atomically replace CSS without flicker', () => {
    registry.register('test-frag', '.test { color: red; }');
    registry.activate('test-frag');

    const originalSheet = document.adoptedStyleSheets[0];

    registry.hotReplace('test-frag', '.test { color: blue; }');

    // Same sheet instance (atomic replace, no deactivate+activate cycle)
    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0]).toBe(originalSheet);
  });

  it('hotReplace on unknown id should register and activate', () => {
    registry.hotReplace('new-frag', '.new { color: yellow; }');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('new-frag');
  });

  it('dispose should deactivate all fragments', () => {
    registry.register('frag-1', '.a { color: red; }');
    registry.register('frag-2', '.b { color: blue; }');
    registry.activate('frag-1');
    registry.activate('frag-2');
    expect(document.adoptedStyleSheets.length).toBe(2);

    registry.dispose();
    expect(document.adoptedStyleSheets.length).toBe(0);
  });

  it('should handle invalid CSS gracefully (no throw)', () => {
    registry.register('bad-frag', '<<< invalid css >>>');
    // Should not throw, just skip activation
    expect(() => registry.activate('bad-frag')).not.toThrow();
  });
});
