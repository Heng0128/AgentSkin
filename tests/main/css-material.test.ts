// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  acrylicMaterial,
  bridgeMaterialToTokens,
  generateSurfaceRule,
  liquidGlassMaterial,
} from '../../scripts/lib/css-material.mjs';

// ---------------------------------------------------------------------------
// acrylicMaterial
// ---------------------------------------------------------------------------

describe('acrylicMaterial', () => {
  it('produces backdrop-filter, SVG data URI, and rgba with default params', () => {
    const css = acrylicMaterial();
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('data:image/svg+xml');
    expect(css).toContain('rgba');
    expect(css).toContain('blur(20px)');
    expect(css).toContain('saturate(1.2)');
  });

  it('reflects custom blur in backdrop-filter', () => {
    const css = acrylicMaterial({ blur: 40 });
    expect(css).toContain('blur(40px)');
  });

  it('reflects custom noiseOpacity in feFuncA table', () => {
    const css = acrylicMaterial({ noiseOpacity: 0.5 });
    // The table values embed the float opacity directly in the SVG.
    expect(css).toContain('tableValues');
    expect(css).toContain('0.5');
  });

  it('reflects custom saturation value', () => {
    const css = acrylicMaterial({ saturation: 1.8 });
    expect(css).toContain('saturate(1.8)');
  });

  it('uses custom tint color', () => {
    const css = acrylicMaterial({ tintColor: 'rgba(0,0,0,0.3)' });
    expect(css).toContain('rgba(0,0,0,0.3)');
  });

  it('embeds a valid, decodable SVG data URI', () => {
    const css = acrylicMaterial();
    const match = css.match(/data:image\/svg\+xml,([^")]+)/);
    expect(match).not.toBeNull();
    const encoded = match![1];
    // Should not throw.
    const decoded = decodeURIComponent(encoded);
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('fractalNoise');
    expect(decoded).toContain('feColorMatrix');
  });

  it('works with empty options object', () => {
    const css = acrylicMaterial({});
    expect(css).toContain('backdrop-filter');
    expect(css).toContain('fractalNoise');
  });
});

// ---------------------------------------------------------------------------
// liquidGlassMaterial
// ---------------------------------------------------------------------------

describe('liquidGlassMaterial', () => {
  it('outputs multi-layer box-shadow and backdrop-filter with defaults', () => {
    const css = liquidGlassMaterial();
    expect(css).toContain('box-shadow');
    expect(css).toContain('backdrop-filter');
    // Count comma-separated layers — should be at least 4 (highlight + dark + outer + dispersions).
    const shadowMatch = css.match(/box-shadow:\s*(.+?)!/s);
    expect(shadowMatch).not.toBeNull();
    const layers = shadowMatch![1].split(',').filter((l) => l.trim() !== '');
    expect(layers.length).toBeGreaterThanOrEqual(4);
  });

  it('produces RGB dispersion layers (rgba(255,0,0 / rgba(0,255,0 / rgba(0,0,255)', () => {
    const css = liquidGlassMaterial({ dispersion: 5 });
    expect(css).toContain('rgba(255,0,0');
    expect(css).toContain('rgba(0,255,0');
    expect(css).toContain('rgba(0,0,255');
  });

  it('omits RGB dispersion when dispersion=0', () => {
    const css = liquidGlassMaterial({ dispersion: 0 });
    expect(css).not.toContain('rgba(255,0,0');
    expect(css).not.toContain('rgba(0,255,0');
    expect(css).not.toContain('rgba(0,0,255');
  });

  it('adjusts reflection blur radius', () => {
    const css = liquidGlassMaterial({ refraction: 16 });
    expect(css).toContain('blur(16px)');
  });

  it('adjusts specular intensity — appears as white rgba alpha', () => {
    const css = liquidGlassMaterial({ specular: 0.5 });
    expect(css).toContain('rgba(255,255,255,0.500)');
  });

  it('adjusts shadow depth — appears as black rgba alpha', () => {
    const css = liquidGlassMaterial({ shadowDepth: 0.5 });
    expect(css).toContain('rgba(0,0,0,0.500)');
  });

  it('all 7 parameters affect output distinctly', () => {
    const defaults = liquidGlassMaterial();
    const customized = liquidGlassMaterial({
      edgeWidth: 4,
      refraction: 12,
      specular: 0.9,
      shadowDepth: 0.6,
      lightAngle: 90,
      dispersion: 6,
      materialBlur: 8,
    });
    expect(customized).not.toBe(defaults);
    expect(customized).toContain('blur(12px)');
    expect(customized).toContain('rgba(255,255,255,0.900)');
    expect(customized).toContain('rgba(0,0,0,0.600)');
    expect(customized).toContain('8px'); // materialBlur
  });

  it('works with empty options object', () => {
    const css = liquidGlassMaterial({});
    expect(css).toContain('box-shadow');
    expect(css).toContain('backdrop-filter');
  });
});

// ---------------------------------------------------------------------------
// generateSurfaceRule
// ---------------------------------------------------------------------------

describe('generateSurfaceRule', () => {
  it('returns a complete CSS rule for acrylic', () => {
    const rule = generateSurfaceRule('acrylic');
    expect(rule).toContain('.agentskin-surface');
    expect(rule).toContain('::before');
    expect(rule).toContain('position: relative');
    expect(rule).toContain('backdrop-filter');
  });

  it('returns a different rule for liquid-glass (uses ::after)', () => {
    const rule = generateSurfaceRule('liquid-glass');
    expect(rule).toContain('.agentskin-surface');
    expect(rule).toContain('::after');
    expect(rule).toContain('box-shadow');
  });

  it('passes options through to acrylic material', () => {
    const rule = generateSurfaceRule('acrylic', { blur: 30 });
    expect(rule).toContain('blur(30px)');
  });

  it('passes options through to liquid-glass material', () => {
    const rule = generateSurfaceRule('liquid-glass', { refraction: 20 });
    expect(rule).toContain('blur(20px)');
  });
});

// ---------------------------------------------------------------------------
// bridgeMaterialToTokens
// ---------------------------------------------------------------------------

describe('bridgeMaterialToTokens', () => {
  it('replaces hardcoded rgba colors with var() fallbacks', () => {
    const acrylic = acrylicMaterial();
    // 'surface' maps white tint → --agentskin-surface; 'overlay' maps black
    // which is absent from default acrylic so it stays unchanged.
    const bridged = bridgeMaterialToTokens(acrylic, {
      surface: '--agentskin-surface',
      overlay: '--agentskin-overlay',
    });
    expect(bridged).toContain('var(--agentskin-surface,');
    // Original colour should be preserved as the fallback.
    expect(bridged).toMatch(/var\(--agentskin-surface,\s*rgba\(255,255,255,0\.6\)\)/);
  });

  it('returns empty string for empty input', () => {
    expect(bridgeMaterialToTokens('')).toBe('');
    expect(bridgeMaterialToTokens('', { surface: '--agentskin-surface' })).toBe('');
  });

  it('leaves CSS intact when token map is empty', () => {
    const acrylic = acrylicMaterial();
    const bridged = bridgeMaterialToTokens(acrylic, {});
    expect(bridged).toBe(acrylic);
  });

  it('replaces dispersion colors in liquid-glass output', () => {
    const glass = liquidGlassMaterial({ dispersion: 5 });
    const bridged = bridgeMaterialToTokens(glass, {
      accent: '--agentskin-accent',
      secondary: '--agentskin-secondary',
      border: '--agentskin-border',
    });
    // Chromatic dispersion colours should be bridged.
    expect(bridged).toContain('var(--agentskin-accent,');
    expect(bridged).toContain('var(--agentskin-secondary,');
    expect(bridged).toContain('var(--agentskin-border,');
  });
});
