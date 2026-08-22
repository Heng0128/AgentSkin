// SPDX-License-Identifier: MPL-2.0

import type { ThemeVisualSnapshot } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';

// Toolbox.tsx transitively imports @/stores/studioStore and @/lib/palettePresets,
// which evaluate getAgentSkinClient() at module level and throw in node test
// environments (no window.agentSkin). Mock them before importing the module
// under test.
vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (_selector: unknown) => undefined,
}));
vi.mock('@/lib/palettePresets', () => ({
  loadPalettePresets: () => [],
  savePalettePreset: () => {},
  deletePalettePreset: () => {},
}));

import { computeSignature, fingerprintFromSnapshot } from './Toolbox';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSnapshot(over: Partial<ThemeVisualSnapshot> = {}): ThemeVisualSnapshot {
  return {
    themeId: 'test',
    themeName: 'Test Theme',
    agentId: 'traework',
    timestamp: '2026-01-01T00:00:00Z',
    landmarks: [],
    summary: {
      totalLandmarks: 0,
      visibleLandmarks: 0,
      selectorsTried: 0,
      boxModelAvailable: false,
      cascadeAvailable: false,
    },
    ...over,
  };
}

function makeLandmark(options: {
  selector: string;
  tag: string;
  styles: Array<{ property: string; value: string }>;
  visible?: boolean;
}): ThemeVisualSnapshot['landmarks'][number] {
  return {
    selector: options.selector,
    tag: options.tag,
    styles: options.styles,
    matchedRules: [],
    platformFonts: [],
    boxModel: null,
    visible: options.visible ?? true,
  };
}

// ---------------------------------------------------------------------------
// computeSignature — color mode detection
// ---------------------------------------------------------------------------

describe('computeSignature', () => {
  it('returns mode "dark" when root background is a dark color', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'background-color', value: '#1a1a2e' },
            { property: 'color', value: '#e0e0e0' },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.color.mode).toBe('dark');
    expect(sig.color.rootBackground).toBe('#1a1a2e');
    expect(sig.color.rootColor).toBe('#e0e0e0');
  });

  it('returns mode "light" when root background is a light color', () => {
    // The function first runs bg.match(/\d+/g); if no digits are found it
    // short-circuits to 'dark'. So the hex color MUST contain at least one
    // digit for the hex-aware branch to execute. #e0e0e0 satisfies this.
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'background-color', value: '#e0e0e0' },
            { property: 'color', value: '#222222' },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.color.mode).toBe('light');
    expect(sig.color.rootBackground).toBe('#e0e0e0');
    expect(sig.color.rootColor).toBe('#222222');
  });

  it('returns mode "dark" for near-black hex root background', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [{ property: 'background-color', value: '#201a40' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.color.mode).toBe('dark');
  });

  it('returns mode "light" for light rgb root background', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [{ property: 'background-color', value: 'rgb(245, 245, 245)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.color.mode).toBe('light');
  });

  // -----------------------------------------------------------------------
  // shadow blur grading
  // -----------------------------------------------------------------------

  it('classifies shadow with blur <= 4px as "sm"', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.card',
          tag: 'div',
          styles: [{ property: 'box-shadow', value: '0 1px 2px rgba(0,0,0,0.1)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.shadow.level).toBe('sm');
  });

  it('classifies shadow with blur between 5-12px as "md"', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.card',
          tag: 'div',
          styles: [{ property: 'box-shadow', value: '0 2px 8px rgba(0,0,0,0.15)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.shadow.level).toBe('md');
  });

  it('classifies shadow with blur between 13-24px as "lg"', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.modal',
          tag: 'div',
          styles: [{ property: 'box-shadow', value: '0 4px 20px rgba(0,0,0,0.2)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.shadow.level).toBe('lg');
  });

  it('classifies shadow with blur > 24px as "xl"', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.popover',
          tag: 'div',
          styles: [{ property: 'box-shadow', value: '0 8px 32px rgba(0,0,0,0.25)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.shadow.level).toBe('xl');
  });

  it('returns shadow level "none" when no box-shadow is present', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.plain',
          tag: 'div',
          styles: [{ property: 'background-color', value: '#ffffff' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.shadow.level).toBe('none');
  });

  // -----------------------------------------------------------------------
  // radius frequency statistics
  // -----------------------------------------------------------------------

  it('identifies the most frequent radius as primary', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.btn',
          tag: 'button',
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
        makeLandmark({
          selector: '.card',
          tag: 'div',
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
        makeLandmark({
          selector: '.badge',
          tag: 'span',
          styles: [{ property: 'border-radius', value: '4px' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.radius.primary).toBe('8px');
    expect(sig.radius.values).toContain('8px');
    expect(sig.radius.values).toContain('4px');
  });

  it('returns "0px" as primary radius when all radii are unique', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.a',
          tag: 'div',
          styles: [{ property: 'border-radius', value: '4px' }],
        }),
        makeLandmark({
          selector: '.b',
          tag: 'div',
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
        makeLandmark({
          selector: '.c',
          tag: 'div',
          styles: [{ property: 'border-radius', value: '12px' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.radius.primary).toBe('0px');
  });

  // -----------------------------------------------------------------------
  // gradient detection
  // -----------------------------------------------------------------------

  it('detects gradients in background-image', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.hero',
          tag: 'div',
          styles: [
            {
              property: 'background-image',
              value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.decoration.gradients).toHaveLength(1);
    expect(sig.decoration.gradients[0]).toContain('linear-gradient');
  });

  it('detects gradients in background shorthand', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.sidebar',
          tag: 'div',
          styles: [
            {
              property: 'background',
              value: 'radial-gradient(circle, #fff 0%, #ddd 100%)',
            },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.decoration.gradients).toHaveLength(1);
    expect(sig.decoration.gradients[0]).toContain('gradient');
  });

  it('deduplicates identical gradients', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.a',
          tag: 'div',
          styles: [
            {
              property: 'background-image',
              value: 'linear-gradient(90deg, #000, #fff)',
            },
          ],
        }),
        makeLandmark({
          selector: '.b',
          tag: 'div',
          styles: [
            {
              property: 'background-image',
              value: 'linear-gradient(90deg, #000, #fff)',
            },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.decoration.gradients).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // empty landmarks safety
  // -----------------------------------------------------------------------

  it('does not throw when landmarks array is empty', () => {
    const snap = makeSnapshot({ landmarks: [] });
    expect(() => computeSignature(snap)).not.toThrow();
  });

  it('returns sensible defaults for empty landmarks', () => {
    const snap = makeSnapshot({ landmarks: [] });
    const sig = computeSignature(snap);
    expect(sig.color.mode).toBe('dark');
    expect(sig.color.backgrounds).toEqual([]);
    expect(sig.radius.values).toEqual([]);
    expect(sig.shadow.level).toBe('none');
    expect(sig.decoration.gradients).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // spacing computation
  // -----------------------------------------------------------------------

  it('computes average padding from landmarks', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.container',
          tag: 'div',
          styles: [{ property: 'padding', value: '16px' }],
        }),
        makeLandmark({
          selector: '.section',
          tag: 'section',
          styles: [{ property: 'padding-top', value: '24px' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.spacing.avgPadding).toBe(20);
  });

  it('falls back to default avgPadding of 8 when no padding values exist', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.no-padding',
          tag: 'div',
          styles: [{ property: 'background-color', value: '#fff' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.spacing.avgPadding).toBe(8);
  });

  // -----------------------------------------------------------------------
  // font detection
  // -----------------------------------------------------------------------

  it('extracts font family and sizes', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: 'body',
          tag: 'body',
          styles: [
            { property: 'font-family', value: "'Inter', sans-serif" },
            { property: 'font-size', value: '14px' },
          ],
        }),
        makeLandmark({
          selector: '.heading',
          tag: 'h1',
          styles: [{ property: 'font-size', value: '24px' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.font.family).toBe("'Inter', sans-serif");
    expect(sig.font.sizes).toContain('14px');
    expect(sig.font.sizes).toContain('24px');
  });

  // -----------------------------------------------------------------------
  // motion detection
  // -----------------------------------------------------------------------

  it('detects most frequent transition duration and timing', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.btn',
          tag: 'button',
          styles: [
            { property: 'transition-duration', value: '0.2s' },
            { property: 'transition-timing-function', value: 'ease-in-out' },
          ],
        }),
        makeLandmark({
          selector: '.card',
          tag: 'div',
          styles: [
            { property: 'transition-duration', value: '0.2s' },
            { property: 'transition-timing-function', value: 'ease-in-out' },
          ],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.motion.defaultDuration).toBe('0.2s');
    expect(sig.motion.defaultTiming).toBe('ease-in-out');
  });

  // -----------------------------------------------------------------------
  // backdrop-filter blur detection
  // -----------------------------------------------------------------------

  it('collects backdrop-filter blur values', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.glass',
          tag: 'div',
          styles: [{ property: 'backdrop-filter', value: 'blur(12px)' }],
        }),
        makeLandmark({
          selector: '.frosted',
          tag: 'div',
          styles: [{ property: '-webkit-backdrop-filter', value: 'blur(8px)' }],
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.blur.values).toHaveLength(2);
    expect(sig.blur.countWithBlur).toBe(2);
  });

  // -----------------------------------------------------------------------
  // invisible landmarks are skipped
  // -----------------------------------------------------------------------

  it('ignores invisible landmarks when computing signature', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.hidden',
          tag: 'div',
          styles: [
            { property: 'background-color', value: '#ff0000' },
            { property: 'border-radius', value: '999px' },
          ],
          visible: false,
        }),
        makeLandmark({
          selector: '.visible',
          tag: 'div',
          styles: [
            { property: 'background-color', value: '#00ff00' },
            { property: 'border-radius', value: '4px' },
          ],
          visible: true,
        }),
      ],
    });
    const sig = computeSignature(snap);
    expect(sig.color.backgrounds).toEqual(['#00ff00']);
    expect(sig.radius.values).toEqual(['4px']);
  });
});

// ---------------------------------------------------------------------------
// fingerprintFromSnapshot
// ---------------------------------------------------------------------------

describe('fingerprintFromSnapshot', () => {
  it('produces a non-empty string from a valid snapshot', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'background-color', value: '#ffffff' },
            { property: 'color', value: '#000000' },
            { property: 'border-radius', value: '8px' },
            { property: 'padding', value: '16px' },
            { property: 'box-shadow', value: '0 2px 8px rgba(0,0,0,0.1)' },
            { property: 'font-family', value: "'Space Grotesk', sans-serif" },
            { property: 'transition-duration', value: '0.15s' },
          ],
        }),
        makeLandmark({
          selector: '.btn',
          tag: 'button',
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
      ],
    });
    const fp = fingerprintFromSnapshot(snap);
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
    // Fingerprint uses " · " as separator
    expect(fp).toContain(' · ');
  });

  it('includes radius, spacing, shadow, blur, font, and duration segments', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'border-radius', value: '4px' },
            { property: 'padding', value: '12px' },
            { property: 'box-shadow', value: '0 1px 3px rgba(0,0,0,0.1)' },
            { property: 'font-family', value: "'IBM Plex Mono', monospace" },
            { property: 'transition-duration', value: '0.2s' },
          ],
        }),
        // Second radius so primary becomes '4px' (frequency > 1)
        makeLandmark({
          selector: '.btn',
          tag: 'button',
          styles: [
            { property: 'border-radius', value: '4px' },
            // Second duration so defaultDuration becomes '0.2s' (frequency > 1)
            { property: 'transition-duration', value: '0.2s' },
          ],
        }),
      ],
    });
    const fp = fingerprintFromSnapshot(snap);
    // Should contain "4px" (radius), "12px" (spacing), "sm" (shadow),
    // "no-blur" (no backdrop-filter), "IBM Plex Mono" (font), "0.2s" (duration)
    expect(fp).toContain('4px');
    expect(fp).toContain('12px');
    expect(fp).toContain('sm');
    expect(fp).toContain('no-blur');
    expect(fp).toContain('IBM Plex Mono');
    expect(fp).toContain('0.2s');
  });

  it('produces "blur" segment when backdrop-filter is present', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.glass',
          tag: 'div',
          styles: [{ property: 'backdrop-filter', value: 'blur(10px)' }],
        }),
      ],
    });
    const fp = fingerprintFromSnapshot(snap);
    expect(fp).toContain('blur');
    expect(fp).not.toContain('no-blur');
  });

  it('produces different fingerprints for structurally different snapshots', () => {
    const snapA = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'border-radius', value: '8px' },
            { property: 'padding', value: '16px' },
            { property: 'box-shadow', value: '0 2px 8px rgba(0,0,0,0.1)' },
          ],
        }),
        makeLandmark({
          selector: '.btn',
          tag: 'button',
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
      ],
    });
    const snapB = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: ':root',
          tag: 'html',
          styles: [
            { property: 'border-radius', value: '4px' },
            { property: 'padding', value: '8px' },
            { property: 'box-shadow', value: 'none' },
          ],
        }),
        makeLandmark({
          selector: '.card',
          tag: 'div',
          styles: [{ property: 'border-radius', value: '4px' }],
        }),
      ],
    });
    const fpA = fingerprintFromSnapshot(snapA);
    const fpB = fingerprintFromSnapshot(snapB);
    expect(fpA).not.toBe(fpB);
  });

  it('strips quotes from font family name in fingerprint', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: 'body',
          tag: 'body',
          styles: [{ property: 'font-family', value: "'Space Grotesk', sans-serif" }],
        }),
      ],
    });
    const fp = fingerprintFromSnapshot(snap);
    expect(fp).toContain('Space Grotesk');
    expect(fp).not.toContain("'");
  });
});
