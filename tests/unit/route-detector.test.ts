// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDeepCore, resetDom } from './deep-core-helpers';

// RouteDetector and ContextAwareEngine are internal to deep-core.mjs but
// initRouteDetector is callable. We need to access internal functions.
// Since they're not exported, we test via the DeepCore class behavior.
// For now, we test the public interface through DeepCore.

describe('RouteDetector (via deep-core script)', () => {
  beforeEach(() => {
    resetDom();
  });

  afterEach(() => {
    resetDom();
  });

  it('deep-core script should load without errors', () => {
    const { DeepCore } = loadDeepCore();
    expect(DeepCore).toBeDefined();
    expect(typeof DeepCore).toBe('function');
  });

  it('DeepCore should be constructible with minimal config', () => {
    const { DeepCore } = loadDeepCore();
    // Mock document.adoptedStyleSheets if not available
    if (!document.adoptedStyleSheets) {
      (document as any).adoptedStyleSheets = [];
    }
    let instance: any;
    expect(() => {
      instance = new DeepCore(
        { shadowMode: 'open-only', routes: [], fragments: {} },
        { agent: 'codex' },
      );
    }).not.toThrow();

    expect(instance).toBeDefined();
    (window as any).__AGENTSKIN_DEEP_CORE__ = undefined;
  });

  it('DeepCore should write to window[MARKER] for cleanup chain compatibility (P0-2)', () => {
    const { DeepCore } = loadDeepCore();
    const origSheet = document.adoptedStyleSheets;
    (document as any).adoptedStyleSheets = [];

    const instance = new DeepCore(
      { shadowMode: 'open-only', routes: [], fragments: {} },
      { agent: 'codex' },
    );

    // Should write to both marker and deep core global
    expect((window as any).__agentskin_codex_adapter__).toBeDefined();
    expect((window as any).__agentskin_codex_adapter__.deepCore).toBe(true);
    expect((window as any).__AGENTSKIN_DEEP_CORE__).toBe(instance);

    document.adoptedStyleSheets = origSheet;
    delete (window as any).__AGENTSKIN_DEEP_CORE__;
  });
});
