// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 *
 * Tests for the doubao background self-heal mechanism (Plan B):
 *   1. CSS generator produces a `div.agentskin-background-layer` rule
 *      (not body::before) with the fixed positioning contract.
 *   2. body background falls back to surface color.
 *   3. Runtime self-heal creates / restores the div and cleans up without leaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BG_LAYER_CLASS,
  BG_LAYER_ID_PREFIX,
  cleanupBackgroundSelfHeal,
  createBackgroundLayer,
  removeBackgroundLayer,
  setupBackgroundSelfHeal,
} from '../../engines/doubao/background-self-heal';
import doubaoCss from '../../scripts/generators/doubaoCss.mjs';
import { computeArtParams } from '../../scripts/theme-utils.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal theme context matching what buildContext() produces. */
function makeTheme(overrides: Record<string, unknown> = {}) {
  const defaultColors = {
    accent: '#4a90d9',
    secondary: '#7a8a99',
    background: '#1e1e1e',
    foreground: '#e0e0e0',
    muted: '#888888',
    surface: '#2a2a2a',
    surfaceElevated: '#333333',
    border: '#4a90d92e',
    codeBackground: '#161616',
    codeForeground: '#cdd6e0',
    inputBackground: '#2a2a2a',
    buttonBackground: '#4a90d918',
    buttonForeground: '#4a90d9',
  };
  const colors = { ...defaultColors, ...((overrides.colors as Record<string, string>) || {}) };
  // Merge: defaults < base overrides < colors override, so colors always wins.
  return {
    id: 'test-theme',
    name: 'Test Theme',
    mode: 'dark',
    isLight: false,
    signature: null,
    variableBridge: null,
    ...overrides,
    colors,
  };
}

// ---------------------------------------------------------------------------
// 1. CSS generator output
// ---------------------------------------------------------------------------

describe('doubaoCss generator — background layer', () => {
  it('emits a div.agentskin-background-layer rule with the fixed positioning contract', () => {
    const css = doubaoCss(makeTheme());

    // Core selector exists
    expect(css).toContain('div.agentskin-background-layer');

    // Fixed positioning contract
    expect(css).toContain('position: fixed !important;');
    expect(css).toContain('inset: 0 !important;');
    expect(css).toContain('z-index: -1 !important;');
    expect(css).toContain('pointer-events: none !important;');
    expect(css).toContain('background-size: cover !important;');

    // Art variable reference (hero image)
    expect(css).toContain('var(--agentskin-art, none)');
  });

  it('no longer emits a body::before art layer', () => {
    const css = doubaoCss(makeTheme());
    expect(css).not.toMatch(/body::before\s*\{[^}]*agentskin-art/);
  });

  it('falls back to surface color on body (not transparent)', () => {
    const css = doubaoCss(makeTheme({ colors: { surface: '#2a2a2a' } }));
    // body background should be the surface color, not transparent
    expect(css).toContain('background: #2a2a2a !important;');
    expect(css).not.toMatch(
      /html\.agentskin-host-doubao\s+body\s*\{[^}]*background:\s*transparent/,
    );
  });

  it('still emits the art wash (left/mid/bottom gradients + radial glow)', () => {
    const css = doubaoCss(makeTheme());
    expect(css).toContain('linear-gradient(90deg');
    expect(css).toContain('radial-gradient(120% 80%');
  });

  it('computeArtParams returns wash/glow values for a dark theme', () => {
    const t = makeTheme();
    const p = computeArtParams(t);
    expect(p.washLeft).toBeGreaterThan(0);
    expect(p.washMid).toBeGreaterThan(0);
    expect(p.washBottom).toBeGreaterThan(0);
    expect(p.glowStrength).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Runtime self-heal logic (happy-dom)
// ---------------------------------------------------------------------------

describe('background-self-heal runtime', () => {
  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('createBackgroundLayer returns null when --agentskin-art is not set', () => {
    // No art variable set
    const div = createBackgroundLayer();
    expect(div).toBeNull();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
  });

  it('createBackgroundLayer creates a div when --agentskin-art is set', () => {
    // Set the art variable on documentElement
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');

    const div = createBackgroundLayer();

    expect(div).not.toBeNull();
    expect(div!.className).toBe(BG_LAYER_CLASS);
    expect(div!.getAttribute('aria-hidden')).toBe('true');
    expect(div!.id.startsWith(BG_LAYER_ID_PREFIX)).toBe(true);
    // Should be prepended to body
    expect(document.body.firstElementChild).toBe(div);
    expect(div!.style.getPropertyValue('--agentskin-art')).toBe('');
  });

  it('removeBackgroundLayer removes existing div(s)', () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    createBackgroundLayer();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(1);

    removeBackgroundLayer();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
  });

  it('removeBackgroundLayer is idempotent when no div exists', () => {
    expect(() => removeBackgroundLayer()).not.toThrow();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
  });

  it('createBackgroundLayer leaves existing div in place (caller is responsible for remove)', () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    const first = createBackgroundLayer();
    // Calling createBackgroundLayer again without removeBackgroundLayer creates
    // a second div — the adapter's responsibility is to remove first (as the
    // inline BACKGROUND_SELF_HEAL block does). This test documents that contract.
    createBackgroundLayer();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(2);
    // The original first div should still be in the DOM
    expect(first!.isConnected).toBe(true);
  });

  it('the adapter flow (remove then create) yields exactly one div', () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    // Simulate two injection cycles: each removes the old div before creating new
    removeBackgroundLayer();
    const first = createBackgroundLayer();
    removeBackgroundLayer();
    const second = createBackgroundLayer();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(1);
    expect(first!.isConnected).toBe(false);
    expect(second!.isConnected).toBe(true);
  });

  it('setupBackgroundSelfHeal returns a MutationObserver', () => {
    const observer = setupBackgroundSelfHeal();
    expect(observer).toBeDefined();
    // Clean up
    cleanupBackgroundSelfHeal(observer);
  });

  it('cleanupBackgroundSelfHeal disconnects observer and removes div', () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    createBackgroundLayer();
    const observer = setupBackgroundSelfHeal();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(1);

    // Spy on disconnect
    const disconnectSpy = vi.spyOn(observer, 'disconnect');
    cleanupBackgroundSelfHeal(observer);

    expect(disconnectSpy).toHaveBeenCalledOnce();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
  });

  it('cleanupBackgroundSelfHeal handles null observer gracefully', () => {
    expect(() => cleanupBackgroundSelfHeal(null)).not.toThrow();
  });

  it('self-heal restores div when body style is reset after div removal', async () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    createBackgroundLayer();
    const observer = setupBackgroundSelfHeal();

    // Simulate Doubao removing the div (e.g., theme switch destroys it)
    removeBackgroundLayer();
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);

    // Simulate Doubao's native CSS mutating body background via setAttribute
    // (happy-dom MutationObserver requires an attribute mutation, not CSSOM).
    document.body.setAttribute('style', 'background-color: transparent;');

    // MutationObserver callbacks fire asynchronously — flush microtasks
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The self-heal should have restored the div
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(1);

    cleanupBackgroundSelfHeal(observer);
  });

  it('does NOT create a div when body style changes but art variable is unset', async () => {
    // Art NOT set
    const observer = setupBackgroundSelfHeal();

    // No div should exist yet
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);

    // Simulate Doubao resetting body background
    document.body.setAttribute('style', 'background-color: transparent;');
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Should NOT have created a div (no art variable)
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);

    cleanupBackgroundSelfHeal(observer);
  });

  it('observer cleanup leaves no leaked div and disconnects', () => {
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    createBackgroundLayer();
    const observer = setupBackgroundSelfHeal();
    const disconnectSpy = vi.spyOn(observer, 'disconnect');

    cleanupBackgroundSelfHeal(observer);

    // div removed
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
    // observer disconnected
    expect(disconnectSpy).toHaveBeenCalled();
    // Calling cleanup again is safe (no throw)
    expect(() => cleanupBackgroundSelfHeal(observer)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 3. Cleanup expression contract (engine-runtime)
// ---------------------------------------------------------------------------

describe('CLEAR_HOST_BODY cleanup contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('style');
  });

  it('buildClearEngineInjectionExpression removes div.agentskin-background-layer', async () => {
    const { buildClearEngineInjectionExpression } = await import(
      '../../src/shared/injection-runtime'
    );

    // Set up: create the background div
    document.documentElement.style.setProperty('--agentskin-art', 'url("blob:test")');
    document.body.prepend(
      Object.assign(document.createElement('div'), { className: BG_LAYER_CLASS }),
    );

    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(1);

    // Run the cleanup expression
    const expr = buildClearEngineInjectionExpression();
    // eslint-disable-next-line no-new-func
    const fn = new Function(expr);
    fn.call(window);

    // Background div should be removed
    expect(document.querySelectorAll(`div.${BG_LAYER_CLASS}`).length).toBe(0);
  });
});
