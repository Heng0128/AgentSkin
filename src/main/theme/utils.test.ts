// SPDX-License-Identifier: MPL-2.0

/**
 * Tests for theme/utils.ts — pure functions for theme data transformation.
 * Cover extForMime, extractColors, inferModeFromColors, extractWallpaper.
 */

import { describe, expect, it } from 'vitest';
import type { ThemeBundle } from '../../legacy/agentskin-core-runtime';
import { extForMime, extractColors, extractWallpaper, inferModeFromColors } from './utils';

// ---------------------------------------------------------------------------
// extForMime
// ---------------------------------------------------------------------------

describe('extForMime', () => {
  it('maps image/jpeg → jpg', () => {
    expect(extForMime('image/jpeg')).toBe('jpg');
    expect(extForMime('image/jpg')).toBe('jpg');
  });

  it('maps image/webp → webp', () => {
    expect(extForMime('image/webp')).toBe('webp');
  });

  it('maps image/gif → gif', () => {
    expect(extForMime('image/gif')).toBe('gif');
  });

  it('maps image/svg+xml → svg', () => {
    expect(extForMime('image/svg+xml')).toBe('svg');
  });

  it('defaults to png for unknown mime', () => {
    expect(extForMime('image/bmp')).toBe('png');
    expect(extForMime(undefined)).toBe('png');
    expect(extForMime('')).toBe('png');
  });
});

// ---------------------------------------------------------------------------
// extractColors
// ---------------------------------------------------------------------------

function createBundleWithCss(css: string): ThemeBundle {
  return {
    theme: { id: 'test', displayName: 'Test', version: '1.0' },
    targets: {
      traework: { css, agentId: 'traework' },
    },
  } as unknown as ThemeBundle;
}

describe('extractColors', () => {
  it('extracts --agentskin-* CSS variables from target CSS', () => {
    const bundle = createBundleWithCss(`
      --agentskin-accent: #4f8cff;
      --agentskin-background: #f8fafc;
      --agentskin-foreground: #1f2937;
    `);
    const colors = extractColors(bundle);
    expect(colors).toBeDefined();
    expect(colors?.accent).toBe('#4f8cff');
    expect(colors?.background).toBe('#f8fafc');
    expect(colors?.foreground).toBe('#1f2937');
  });

  it('normalizes hyphenated tokens (surface-elevated → surfaceelevated)', () => {
    const bundle = createBundleWithCss('--agentskin-surface-elevated: #f8fafc;');
    const colors = extractColors(bundle);
    expect(colors?.surfaceelevated).toBe('#f8fafc');
  });

  it('returns undefined when no CSS is present', () => {
    const bundle = createBundleWithCss('');
    expect(extractColors(bundle)).toBeUndefined();
  });

  it('returns undefined when CSS has no --agentskin- tokens', () => {
    const bundle = createBundleWithCss('--other-var: red; color: blue;');
    expect(extractColors(bundle)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// inferModeFromColors
// ---------------------------------------------------------------------------

describe('inferModeFromColors', () => {
  it('returns "dark" for dark backgrounds', () => {
    expect(inferModeFromColors({ background: '#000000' })).toBe('dark');
    expect(inferModeFromColors({ background: '#333333' })).toBe('dark');
    expect(inferModeFromColors({ background: '#1f2937' })).toBe('dark');
  });

  it('returns "light" for light backgrounds', () => {
    expect(inferModeFromColors({ background: '#ffffff' })).toBe('light');
    expect(inferModeFromColors({ background: '#f8fafc' })).toBe('light');
    expect(inferModeFromColors({ background: '#eeeeee' })).toBe('light');
  });

  it('accepts short-form hex', () => {
    expect(inferModeFromColors({ background: '#fff' })).toBe('light');
    expect(inferModeFromColors({ background: '#000' })).toBe('dark');
  });

  it('accepts rgb() format', () => {
    expect(inferModeFromColors({ background: 'rgb(255, 255, 255)' })).toBe('light');
    expect(inferModeFromColors({ background: 'rgb(0, 0, 0)' })).toBe('dark');
  });

  it('falls back to "bg" key', () => {
    expect(inferModeFromColors({ bg: '#ffffff' })).toBe('light');
  });

  it('returns null for empty/missing colors', () => {
    expect(inferModeFromColors(undefined)).toBeNull();
    expect(inferModeFromColors({})).toBeNull();
  });

  it('returns null for unparseable color values', () => {
    expect(inferModeFromColors({ background: 'not-a-color' })).toBeNull();
    expect(inferModeFromColors({ background: 'hsl(0,0%,0%)' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractWallpaper
// ---------------------------------------------------------------------------

describe('extractWallpaper', () => {
  it('returns null for non-object input', () => {
    expect(extractWallpaper(null)).toBeNull();
    expect(extractWallpaper(undefined)).toBeNull();
    expect(extractWallpaper('string')).toBeNull();
    expect(extractWallpaper(42)).toBeNull();
  });

  it('returns null when neither workshopId nor video is present', () => {
    expect(extractWallpaper({ speed: 1.0 })).toBeNull();
  });

  it('extracts workshopId-only config', () => {
    const result = extractWallpaper({ workshopId: 'ws-123' });
    expect(result).toEqual({ workshopId: 'ws-123' });
  });

  it('extracts video-only config', () => {
    const result = extractWallpaper({ video: '/path/to/video.mp4' });
    expect(result).toEqual({ video: '/path/to/video.mp4' });
  });

  it('extracts full wallpaper config with optional fields', () => {
    const result = extractWallpaper({
      workshopId: 'ws-456',
      poster: '/path/to/poster.jpg',
      speed: 1.5,
      loop: true,
      scrimOpacity: 0.3,
    });
    expect(result).toEqual({
      workshopId: 'ws-456',
      poster: '/path/to/poster.jpg',
      speed: 1.5,
      loop: true,
      scrimOpacity: 0.3,
    });
  });

  it('ignores unknown fields', () => {
    const result = extractWallpaper({
      workshopId: 'ws-789',
      unknownField: 'ignored',
    });
    expect(result).toEqual({ workshopId: 'ws-789' });
    expect(result).not.toHaveProperty('unknownField');
  });
});
