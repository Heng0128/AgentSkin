// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  DESIGN_LANGUAGES,
  DL_DEFAULTS,
  designLanguageBlock,
  resolveDesignLanguage,
} from '../../scripts/design-language.mjs';

describe('Design Language Block', () => {
  it('generates correct spacing variables for comfortable density (base values)', () => {
    const dl = {
      spacing: { density: 'comfortable' },
      radius: { scale: '2' },
      shadow: { elevation: 'float' },
      motion: { speed: 'fast' },
    };

    // isDefault optimization: this exact config matches defaults, so output is empty.
    // Use a non-default radius to force emission while keeping spacing at comfortable.
    const block = designLanguageBlock({
      ...dl,
      radius: { scale: '4' },
    });

    expect(block).toContain('--agentskin-space-1: 4px');
    expect(block).toContain('--agentskin-space-2: 8px');
    expect(block).toContain('--agentskin-space-3: 16px');
    expect(block).toContain('--agentskin-space-4: 24px');
    expect(block).toContain('--agentskin-space-5: 32px');
    expect(block).toContain('--agentskin-space-6: 48px');
  });

  it('scales spacing correctly for compact density (0.75x)', () => {
    const dl = {
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'instant' },
    };

    const block = designLanguageBlock(dl);

    // compact multiplier = 0.75; space-3 = round(16 * 0.75) = 12px
    expect(block).toContain('--agentskin-space-3: 12px');
    expect(block).toContain('--agentskin-space-1: 3px');
    expect(block).toContain('--agentskin-space-6: 36px');
  });

  it('scales spacing correctly for cozy density (1.25x)', () => {
    const dl = {
      spacing: { density: 'cozy' },
      radius: { scale: '8' },
      shadow: { elevation: 'subtle' },
      motion: { speed: 'smooth' },
    };

    const block = designLanguageBlock(dl);

    // cozy multiplier = 1.25; space-3 = round(16 * 1.25) = 20px
    expect(block).toContain('--agentskin-space-3: 20px');
    expect(block).toContain('--agentskin-space-1: 5px');
    expect(block).toContain('--agentskin-space-6: 60px');
  });

  it('generates correct radius variables for default and soft-rounded', () => {
    const defaultDl = designLanguageBlock({
      spacing: { density: 'comfortable' },
      radius: { scale: '2' },
      shadow: { elevation: 'float' },
      motion: { speed: 'smooth' },
    });

    // default: radius-md = 2px
    expect(defaultDl).toContain('--agentskin-radius-md: 2px');
    expect(defaultDl).toContain('--agentskin-radius-sm: 1px');
    expect(defaultDl).toContain('--agentskin-radius-lg: 6px');

    const soft = designLanguageBlock({
      spacing: { density: 'comfortable' },
      radius: { scale: '8' },
      shadow: { elevation: 'subtle' },
      motion: { speed: 'smooth' },
    });

    // soft-rounded: radius-md = 8px
    expect(soft).toContain('--agentskin-radius-md: 8px');
    expect(soft).toContain('--agentskin-radius-sm: 7px');
    expect(soft).toContain('--agentskin-radius-lg: 8px');
  });

  it('generates correct shadow values for flat, float, and subtle elevations', () => {
    const flat = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'fast' },
    });
    expect(flat).toContain('--agentskin-shadow-float: none');

    const float = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'float' },
      motion: { speed: 'fast' },
    });
    expect(float).toContain('--agentskin-shadow-float: 0 4px 16px rgba(0,0,0,0.12)');

    const subtle = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'subtle' },
      motion: { speed: 'fast' },
    });
    expect(subtle).toContain('--agentskin-shadow-float: 0 1px 3px rgba(0,0,0,0.08)');
  });

  it('generates correct motion duration values for instant, fast, and smooth speeds', () => {
    const instant = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'instant' },
    });
    expect(instant).toContain('--agentskin-duration-fast: 0ms');
    expect(instant).toContain('--agentskin-duration-smooth: 100ms');
    expect(instant).toContain('--agentskin-duration-normal: 50ms');

    const fast = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'fast' },
    });
    expect(fast).toContain('--agentskin-duration-fast: 100ms');
    expect(fast).toContain('--agentskin-duration-smooth: 200ms');
    expect(fast).toContain('--agentskin-duration-normal: 200ms');

    const smooth = designLanguageBlock({
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'smooth' },
    });
    expect(smooth).toContain('--agentskin-duration-fast: 200ms');
    expect(smooth).toContain('--agentskin-duration-smooth: 300ms');
    expect(smooth).toContain('--agentskin-duration-normal: 400ms');
  });

  it('returns empty string when config equals defaults (isDefault optimization)', () => {
    const block = designLanguageBlock(DL_DEFAULTS);
    expect(block).toBe('');
  });

  it('clamps radius-sm to minimum 0 when scale is 0', () => {
    const dl = {
      spacing: { density: 'compact' },
      radius: { scale: '0' },
      shadow: { elevation: 'flat' },
      motion: { speed: 'instant' },
    };

    const block = designLanguageBlock(dl);

    // radius-sm = max(0, 0 - 1) = 0px
    expect(block).toContain('--agentskin-radius-sm: 0px');
  });

  it('clamps radius-lg to maximum 8 when scale is 8', () => {
    const dl = {
      spacing: { density: 'cozy' },
      radius: { scale: '8' },
      shadow: { elevation: 'subtle' },
      motion: { speed: 'smooth' },
    };

    const block = designLanguageBlock(dl);

    // radius-lg = min(8, 8 + 4) = 8px
    expect(block).toContain('--agentskin-radius-lg: 8px');
  });
});

describe('resolveDesignLanguage', () => {
  it('resolves inline config (designLanguageConfig) over preset ref and defaults', () => {
    const manifest = {
      designLanguage: 'compact-flat',
      designLanguageConfig: {
        spacing: { density: 'cozy' },
        radius: { scale: '8' },
        shadow: { elevation: 'subtle' },
        motion: { speed: 'smooth' },
      },
    };

    const result = resolveDesignLanguage(manifest);

    expect(result.spacing.density).toBe('cozy');
    expect(result.radius.scale).toBe('8');
    expect(result.shadow.elevation).toBe('subtle');
    expect(result.motion.speed).toBe('smooth');
  });

  it('resolves preset ref when inline config is absent', () => {
    const manifest = {
      designLanguage: 'soft-rounded',
    };

    const result = resolveDesignLanguage(manifest);

    expect(result.spacing.density).toBe('cozy');
    expect(result.radius.scale).toBe('8');
    expect(result.shadow.elevation).toBe('subtle');
    expect(result.motion.speed).toBe('smooth');
  });

  it('falls back to defaults for unknown preset id', () => {
    const manifest = {
      designLanguage: 'nonexistent-preset',
    };

    const result = resolveDesignLanguage(manifest);

    expect(result.spacing.density).toBe(DL_DEFAULTS.spacing.density);
    expect(result.radius.scale).toBe(DL_DEFAULTS.radius.scale);
    expect(result.shadow.elevation).toBe(DL_DEFAULTS.shadow.elevation);
    expect(result.motion.speed).toBe(DL_DEFAULTS.motion.speed);
  });

  it('falls back to defaults when manifest is undefined', () => {
    const result = resolveDesignLanguage(undefined);

    expect(result).toBe(DL_DEFAULTS);
  });

  it('merges partial inline config over defaults for missing sub-keys', () => {
    const manifest = {
      designLanguageConfig: {
        spacing: { density: 'compact' },
      },
    };

    const result = resolveDesignLanguage(manifest);

    expect(result.spacing.density).toBe('compact');
    expect(result.radius.scale).toBe(DL_DEFAULTS.radius.scale);
    expect(result.shadow.elevation).toBe(DL_DEFAULTS.shadow.elevation);
    expect(result.motion.speed).toBe(DL_DEFAULTS.motion.speed);
  });

  it('DESIGN_LANGUAGES contains default, soft-rounded, and compact-flat presets', () => {
    expect(DESIGN_LANGUAGES['default']).toBeDefined();
    expect(DESIGN_LANGUAGES['soft-rounded']).toBeDefined();
    expect(DESIGN_LANGUAGES['compact-flat']).toBeDefined();

    // Verify key preset properties
    expect(DESIGN_LANGUAGES['default'].spacing.density).toBe('comfortable');
    expect(DESIGN_LANGUAGES['soft-rounded'].radius.scale).toBe('8');
    expect(DESIGN_LANGUAGES['compact-flat'].shadow.elevation).toBe('flat');
  });
});

describe('Edge cases & coverage gaps', () => {
  it('generates correct radius when scale=0 (radius-sm floors at 0, not -1)', () => {
    const css = designLanguageBlock({ radius: { scale: '0' } });
    expect(css).toContain('--agentskin-radius-sm: 0px');
    expect(css).toContain('--agentskin-radius-md: 0px');
    expect(css).toContain('--agentskin-radius-lg: 4px');
  });

  it('generates correct radius when scale=4', () => {
    const css = designLanguageBlock({ radius: { scale: '4' } });
    expect(css).toContain('--agentskin-radius-sm: 3px');
    expect(css).toContain('--agentskin-radius-md: 4px');
    expect(css).toContain('--agentskin-radius-lg: 8px');
  });

  it('generates correct radius when scale=8 (radius-lg caps at 8)', () => {
    const css = designLanguageBlock({ radius: { scale: '8' } });
    expect(css).toContain('--agentskin-radius-sm: 7px');
    expect(css).toContain('--agentskin-radius-md: 8px');
    expect(css).toContain('--agentskin-radius-lg: 8px');
  });

  it('returns empty string for empty designLanguageConfig (all defaults)', () => {
    const css = designLanguageBlock(DL_DEFAULTS);
    expect(css).toBe('');
  });

  it('handles partial inline config (only spacing, rest defaults)', () => {
    const dl = resolveDesignLanguage({ designLanguageConfig: { spacing: { density: 'compact' } } });
    // Only spacing differs; radius/shadow/motion should be defaults
    expect(dl.spacing.density).toBe('compact');
    expect(dl.radius.scale).toBe('2');
    expect(dl.shadow.elevation).toBe('float');
    expect(dl.motion.speed).toBe('fast');
    // Output should NOT be empty (spacing is non-default)
    const css = designLanguageBlock(dl);
    expect(css).not.toBe('');
    expect(css).toContain('--agentskin-space-3: 12px');
  });

  it('handles partial inline config (only radius, rest defaults)', () => {
    const dl = resolveDesignLanguage({ designLanguageConfig: { radius: { scale: '8' } } });
    expect(dl.radius.scale).toBe('8');
    expect(dl.spacing.density).toBe('comfortable');
    const css = designLanguageBlock(dl);
    expect(css).not.toBe('');
    expect(css).toContain('--agentskin-radius-md: 8px');
  });
});
