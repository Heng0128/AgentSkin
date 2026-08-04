// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  generatePunchThroughCss,
  type HealthCheckReport,
  isSemiTransparent,
  parseBgAlpha,
} from './theme-health-check';

// ---------------------------------------------------------------------------
// parseBgAlpha — P0-1 regression: the old inline regex `/[d.]+(?=s*)$/`
// treated `[d.]` as a character class, so every fractional-alpha rgba()
// failed to match and fell through to alpha=1 (semi-transparent surfaces
// misclassified as opaque blockers → bogus health score, bogus
// punch-through rules).
// ---------------------------------------------------------------------------

describe('parseBgAlpha', () => {
  it('parses fully transparent values as 0', () => {
    expect(parseBgAlpha('transparent')).toBe(0);
    expect(parseBgAlpha('rgba(0, 0, 0, 0)')).toBe(0);
    // P0-1: white fully-transparent must NOT be treated as opaque
    expect(parseBgAlpha('rgba(255, 255, 255, 0)')).toBe(0);
  });

  it('parses fractional alpha from rgba()', () => {
    // P0-1: these previously returned 1 (opaque) — the core bug
    expect(parseBgAlpha('rgba(255, 255, 255, 0.5)')).toBe(0.5);
    expect(parseBgAlpha('rgba(0, 0, 0, 0.06)')).toBeCloseTo(0.06);
    expect(parseBgAlpha('rgba(10, 20, 30, 0.95)')).toBeCloseTo(0.95);
    // Dense spacing variant
    expect(parseBgAlpha('rgba(255,255,255,0.4)')).toBe(0.4);
    // Alpha 1 explicitly written out
    expect(parseBgAlpha('rgba(0, 0, 0, 1)')).toBe(1);
  });

  it('treats rgb() / named / unparseable colors as opaque', () => {
    expect(parseBgAlpha('rgb(255, 255, 255)')).toBe(1);
    expect(parseBgAlpha('#ffffff')).toBe(1);
    expect(parseBgAlpha('white')).toBe(1);
    expect(parseBgAlpha('')).toBe(0);
    expect(parseBgAlpha(undefined)).toBe(0);
    // Opaque black in rgba form
    expect(parseBgAlpha('rgba(0, 0, 0, 1)')).toBe(1);
  });
});

describe('isSemiTransparent', () => {
  it('is true for fractional-alpha backgrounds', () => {
    expect(isSemiTransparent('rgba(0, 0, 0, 0.5)')).toBe(true);
    expect(isSemiTransparent('rgba(255, 255, 255, 0.9)')).toBe(true);
    expect(isSemiTransparent('transparent')).toBe(true);
  });

  it('is false for opaque backgrounds', () => {
    expect(isSemiTransparent('rgb(255, 255, 255)')).toBe(false);
    expect(isSemiTransparent('rgba(0, 0, 0, 1)')).toBe(false);
    expect(isSemiTransparent('#000000')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generatePunchThroughCss — semi-transparent layers must never be punched
// (P0-1 product-level regression: they were emitted as `background-color:
// transparent` rules, destroying intentional translucent surfaces).
// ---------------------------------------------------------------------------

function layer(
  overrides: Partial<HealthCheckReport['opaqueLayers'][number]>,
): HealthCheckReport['opaqueLayers'][number] {
  return {
    depth: 1,
    tagName: 'DIV',
    id: '',
    classes: 'test-panel',
    semanticAttr: '',
    backgroundColor: '',
    backgroundImage: '',
    size: '1200x800',
    visible: true,
    backdropFilter: '',
    ...overrides,
  };
}

function report(layers: HealthCheckReport['opaqueLayers']): HealthCheckReport {
  return {
    agentId: 'traework',
    timestamp: 0,
    heroArtActive: true,
    themeSheetPresent: true,
    accentToken: '--agentskin-accent',
    hostClassPresent: true,
    adapterPresent: true,
    nativeTokens: {},
    opaqueLayers: layers,
    blockingCount: layers.filter((l) => l.visible).length,
    score: 100,
  };
}

describe('generatePunchThroughCss', () => {
  it('skips semi-transparent layers (P0-1 regression)', () => {
    const r = report([
      layer({ backgroundColor: 'rgba(255, 255, 255, 0.5)', classes: 'translucent-panel' }),
    ]);
    expect(generatePunchThroughCss(r)).toBe('');
  });

  it('punches truly opaque layers', () => {
    const r = report([
      layer({ backgroundColor: 'rgb(18, 18, 24)', classes: 'opaque-shell', id: 'app-shell' }),
    ]);
    const css = generatePunchThroughCss(r);
    expect(css).toContain('background-color: transparent !important;');
  });

  it('skips frosted-glass layers (backdrop-filter)', () => {
    const r = report([
      layer({
        backgroundColor: 'rgb(18, 18, 24)',
        backdropFilter: 'blur(20px)',
        classes: 'frosted-panel',
      }),
    ]);
    expect(generatePunchThroughCss(r)).toBe('');
  });

  it('skips invisible layers', () => {
    const r = report([
      layer({ backgroundColor: 'rgb(18, 18, 24)', classes: 'hidden-shell', visible: false }),
    ]);
    expect(generatePunchThroughCss(r)).toBe('');
  });

  it('prefers semantic attributes, then id, then escaped class', () => {
    const r = report([
      layer({
        backgroundColor: 'rgb(0, 0, 0)',
        semanticAttr: 'chat-panel',
        id: 'ignored-id',
        classes: 'css-hash-abc123',
      }),
    ]);
    expect(generatePunchThroughCss(r)).toContain('[data-view-id="chat-panel"]');
  });
});
