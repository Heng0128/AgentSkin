// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDeepCore, resetDom } from '../unit/deep-core-helpers';

const { FragmentRegistry } = loadDeepCore();

describe('Fragment Priority (L2 Integration)', () => {
  let registry: InstanceType<typeof FragmentRegistry>;

  beforeEach(() => {
    resetDom();
    if (!document.adoptedStyleSheets) {
      (document as any).adoptedStyleSheets = [];
    }
    registry = new FragmentRegistry();
  });

  afterEach(() => {
    registry.dispose();
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
    registry.register('my-frag', '.my-class { color: green; }');
    registry.activate('my-frag');

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

    registry.register('frag-a', '.a { color: red; }');
    registry.register('frag-b', '.b { color: blue; }');
    registry.activate('frag-a');
    registry.activate('frag-b');

    // Expected: frag-a, frag-b, custom
    expect(document.adoptedStyleSheets.length).toBe(3);
    expect(document.adoptedStyleSheets[0].__agentskin_fragment).toBe('frag-a');
    expect(document.adoptedStyleSheets[1].__agentskin_fragment).toBe('frag-b');
    expect(document.adoptedStyleSheets[2].__agentskin_layer).toBe('custom');
  });

  it('hotReplace preserves position in adoptedStyleSheets array', () => {
    const customSheet = new CSSStyleSheet();
    customSheet.__agentskin_layer = 'custom';
    document.adoptedStyleSheets = [customSheet];

    registry.register('my-frag', '.test { color: red; }');
    registry.activate('my-frag');

    const originalSheet = document.adoptedStyleSheets[0];

    registry.hotReplace('my-frag', '.test { color: blue; }');

    // Same position, same sheet instance
    expect(document.adoptedStyleSheets.length).toBe(2);
    expect(document.adoptedStyleSheets[0]).toBe(originalSheet);
    expect(document.adoptedStyleSheets[1].__agentskin_layer).toBe('custom');
  });
});
