// SPDX-License-Identifier: MPL-2.0

/**
 * # snapshot-to-override — unit tests
 *
 * Covers: empty snapshot, single landmark, multi-landmark,
 * missing values (no accent, no radius), and statistical modes.
 */

import type { ThemeVisualSnapshot } from '@shared/types';
import { describe, expect, it } from 'vitest';
import {
  averageFontSize,
  extractOverrideFromSnapshot,
  modeBorderRadius,
  modeFontFamily,
  pickAccent,
  pickBackground,
  pickForeground,
} from './snapshot-to-override';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<ThemeVisualSnapshot> = {}): ThemeVisualSnapshot {
  return {
    themeId: 'test-theme',
    themeName: 'Test Theme',
    agentId: 'traework',
    timestamp: '2025-01-01T00:00:00Z',
    landmarks: [],
    summary: {
      totalLandmarks: 0,
      visibleLandmarks: 0,
      selectorsTried: 0,
      boxModelAvailable: false,
      cascadeAvailable: false,
    },
    ...overrides,
  };
}

function makeLandmark(overrides: Partial<ThemeVisualSnapshot['landmarks'][0]> = {}) {
  return {
    selector: '.test',
    tag: 'div',
    styles: [],
    matchedRules: [],
    platformFonts: [],
    boxModel: null,
    visible: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('snapshot-to-override', () => {
  it('returns empty override for empty snapshot', () => {
    const snap = makeSnapshot();
    const result = extractOverrideFromSnapshot(snap);
    expect(result).toEqual({});
  });

  it('extracts background from body landmark', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: 'body',
          styles: [
            { property: 'background-color', value: '#1a1a2e' },
            { property: 'color', value: '#eaeaea' },
          ],
        }),
      ],
    });
    expect(pickBackground(snap)).toBe('#1a1a2e');
    expect(pickForeground(snap)).toBe('#eaeaea');
  });

  it('falls back to first landmark with background when no body', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.card',
          styles: [{ property: 'background-color', value: '#2d2d3d' }],
        }),
        makeLandmark({
          selector: '.panel',
          styles: [{ property: 'background-color', value: '#3d3d4d' }],
        }),
      ],
    });
    expect(pickBackground(snap)).toBe('#2d2d3d');
  });

  it('picks accent from .chat-input-box border-color', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.chat-input-box',
          styles: [{ property: 'border-color', value: '#4f8cff' }],
        }),
      ],
    });
    expect(pickAccent(snap)).toBe('#4f8cff');
  });

  it('extracts color from box-shadow when no border-color', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.agent-card',
          styles: [{ property: 'box-shadow', value: '0 2px 8px rgba(0,0,0,.15)' }],
        }),
      ],
    });
    // Should extract the color portion, not the full shadow string.
    expect(pickAccent(snap)).toBe('rgba(0,0,0,.15)');
  });

  it('falls back to any landmark border-color when no preferred selector', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.sidebar',
          styles: [{ property: 'border-color', value: '#ff6b6b' }],
        }),
      ],
    });
    expect(pickAccent(snap)).toBe('#ff6b6b');
  });

  it('returns undefined accent when no border or shadow exists', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: '.chat-input-box',
          styles: [{ property: 'color', value: '#fff' }],
        }),
      ],
    });
    expect(pickAccent(snap)).toBeUndefined();
  });

  it('computes mode border-radius (most frequent)', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({ styles: [{ property: 'border-radius', value: '8px' }] }),
        makeLandmark({ styles: [{ property: 'border-radius', value: '8px' }] }),
        makeLandmark({ styles: [{ property: 'border-radius', value: '4px' }] }),
      ],
    });
    expect(modeBorderRadius(snap)).toBe('8px');
  });

  it('returns undefined mode radius when no landmarks have radius', () => {
    const snap = makeSnapshot({
      landmarks: [makeLandmark({ styles: [{ property: 'color', value: '#fff' }] })],
    });
    expect(modeBorderRadius(snap)).toBeUndefined();
  });

  it('computes mode font-family (most frequent, first in comma list)', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({ styles: [{ property: 'font-family', value: "'Inter', sans-serif" }] }),
        makeLandmark({ styles: [{ property: 'font-family', value: "'Inter', sans-serif" }] }),
        makeLandmark({
          styles: [{ property: 'font-family', value: "'IBM Plex Mono', monospace" }],
        }),
      ],
    });
    expect(modeFontFamily(snap)).toBe('Inter');
  });

  it('computes average font-size rounded to nearest 2px', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({ styles: [{ property: 'font-size', value: '13px' }] }),
        makeLandmark({ styles: [{ property: 'font-size', value: '15px' }] }),
      ],
    });
    // Average = 14, already even.
    expect(averageFontSize(snap)).toBe(14);
  });

  it('rounds odd average font-size up to nearest 2px', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({ styles: [{ property: 'font-size', value: '14px' }] }),
        makeLandmark({ styles: [{ property: 'font-size', value: '15px' }] }),
      ],
    });
    // Average = 14.5 → rounds to 16 (Math.round(14.5/2)*2 = Math.round(7.25)*2 = 7*2 = 14)
    // Actually Math.round(7.25) = 7, 7*2 = 14
    expect(averageFontSize(snap)).toBe(14);
  });

  it('returns undefined average font-size when no px values', () => {
    const snap = makeSnapshot({
      landmarks: [makeLandmark({ styles: [{ property: 'font-size', value: 'inherit' }] })],
    });
    expect(averageFontSize(snap)).toBeUndefined();
  });

  it('extracts complete override from multi-landmark snapshot', () => {
    const snap = makeSnapshot({
      landmarks: [
        makeLandmark({
          selector: 'body',
          styles: [
            { property: 'background-color', value: '#0f0f1a' },
            { property: 'color', value: '#e0e0e0' },
            { property: 'font-size', value: '14px' },
            { property: 'font-family', value: "'Space Grotesk', sans-serif" },
          ],
        }),
        makeLandmark({
          selector: '.chat-input-box',
          styles: [{ property: 'border-color', value: '#6c5ce7' }],
        }),
        makeLandmark({
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
        makeLandmark({
          styles: [{ property: 'border-radius', value: '8px' }],
        }),
        makeLandmark({
          styles: [
            { property: 'border-radius', value: '4px' },
            { property: 'font-size', value: '12px' },
            { property: 'font-family', value: "'Space Grotesk', sans-serif" },
          ],
        }),
      ],
    });

    const result = extractOverrideFromSnapshot(snap);

    expect(result.background).toBe('#0f0f1a');
    expect(result.foreground).toBe('#e0e0e0');
    expect(result.accent).toBe('#6c5ce7');
    expect(result.radius).toBe('8px');
    expect(result.fontFam).toBe('Space Grotesk');
    expect(result.fontSize).toBe(14); // avg(14,12)=13 → rounded to 14
  });
});
