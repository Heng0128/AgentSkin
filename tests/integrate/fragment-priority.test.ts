// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadDeepCore, resetDom } from '../unit/deep-core-helpers';

const { FragmentRegistry } = loadDeepCore();

describe('Fragment Priority (L2 Integration)', () => {
  beforeEach(() => {
    resetDom();
    if (!document.adoptedStyleSheets) {
      (document as any).adoptedStyleSheets = [];
    }
  });

  afterEach(() => {
    FragmentRegistry.dispose();
    resetDom();
  });

  it('fragment should always be inserted before custom layer', () => {
    // Simulate existing layers: palette, custom
    const paletteSheet = new CSSStyleSheet();
    paletteSheet.__agentskin_layer = 'palette';

    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';

    document.adoptedStyleSheets = [paletteSheet, customSheet];

    // Register and activate a fragment
    FragmentRegistry.register('my-frag', '.my-class { color: green; }');
    FragmentRegistry.activate('my-frag');

    // Expected order: palette, my-frag, custom
    expect(document.adoptedStyleSheets.length).toBe(3);
    expect(document.adoptedStyleSheets[0].__agentskin_layer).toBe('palette');
    expect(document.adoptedStyleSheets[1].__agentskin_fragment).toBe('my-frag');
    expect(document.adoptedStyleSheets[2].__agentskin_layer).toBe('custom');
  });

  it('multiple fragments should all be before custom layer', () => {
    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';
    document.adoptedStyleSheets = [customSheet];

    FragmentRegistry.register('frag-a', '.a { color: red; }');
    FragmentRegistry.register('frag-b', '.b { color: blue; }');
    FragmentRegistry.activate('frag-a');
    FragmentRegistry.activate('frag-b');

    // Expected: frag-a, frag-b, custom
    expect(document.adoptedStyleSheets.length).toBe(3);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('frag-a');
    expect(document.adoptedStyleSheets[1].__agentskin_fragment).toBe('frag-b');
    expect(document.adoptedStyleSheets[2].__agentskin_layer).toBe('custom');
  });

  it('fragment without custom layer appends at end', () => {
    FragmentRegistry.register('my-frag', '.test { color: yellow; }');
    FragmentRegistry.activate('my-frag');

    expect(document.adoptedStyleSheets.length).toBe(1);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('my-frag');
  });

  it('hotReplace preserves position in adoptedStyleSheets array', () => {
    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';
    document.adoptedStyleSheets = [customSheet];

    FragmentRegistry.register('my-frag', '.test { color: red; }');
    FragmentRegistry.activate('my-frag');

    const originalSheet = document.adoptedStyleSheets[0];

    FragmentRegistry.hotReplace('my-frag', '.test { color: blue; }');

    // Same position, same sheet instance
    expect(document.adoptedStyleSheets.length).toBe(2);
    expect(document.adoptedStyleSheets[0]).toBe(originalSheet);
    expect(document.adoptedStyleSheets[1].__agentskin_layer).toBe('custom');
  });
});
