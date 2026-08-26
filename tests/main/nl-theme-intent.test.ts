// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { intentToParams, parseThemeIntent } from '../../scripts/lib/nl-theme-intent.mjs';

// ---------------------------------------------------------------------------
// parseThemeIntent — color hints
// ---------------------------------------------------------------------------

describe('parseThemeIntent — color hints', () => {
  it('parses blue color hint', () => {
    const intent = parseThemeIntent('把主题换成蓝色系');
    expect(intent.colorHint).toBe('blue');
    expect(intent.hueRange).toEqual([200, 240]);
  });

  it('parses warm color hint', () => {
    const intent = parseThemeIntent('换成暖色调');
    expect(intent.colorHint).toBe('warm');
    expect(intent.hueRange).toEqual([0, 60]);
  });

  it('parses cool color hint', () => {
    const intent = parseThemeIntent('cool theme');
    expect(intent.colorHint).toBe('cool');
    expect(intent.hueRange).toEqual([180, 300]);
  });

  it('parses dark mode hint', () => {
    const intent = parseThemeIntent('暗色主题');
    expect(intent.colorHint).toBe('dark');
    expect(intent.hueRange).toBeUndefined();
  });

  it('parses light mode hint', () => {
    const intent = parseThemeIntent('light theme');
    expect(intent.colorHint).toBe('light');
  });

  it('parses neutral color hint', () => {
    const intent = parseThemeIntent('中性色');
    expect(intent.colorHint).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// parseThemeIntent — scene hints
// ---------------------------------------------------------------------------

describe('parseThemeIntent — scene hints', () => {
  it('parses presentation scene', () => {
    const intent = parseThemeIntent('投屏模式');
    expect(intent.scene).toBe('presentation');
  });

  it('parses eye-care scene', () => {
    const intent = parseThemeIntent('护眼模式');
    expect(intent.scene).toBe('eye-care');
  });

  it('parses night scene', () => {
    const intent = parseThemeIntent('夜间模式');
    expect(intent.scene).toBe('night');
  });

  it('parses reading scene', () => {
    const intent = parseThemeIntent('reading mode');
    expect(intent.scene).toBe('reading');
  });

  it('parses focus scene', () => {
    const intent = parseThemeIntent('专注模式');
    expect(intent.scene).toBe('focus');
  });
});

// ---------------------------------------------------------------------------
// parseThemeIntent — intensity
// ---------------------------------------------------------------------------

describe('parseThemeIntent — intensity', () => {
  it('parses low intensity', () => {
    const intent = parseThemeIntent('低调一点');
    expect(intent.intensity).toBe(0.3);
  });

  it('parses high intensity', () => {
    const intent = parseThemeIntent('浓郁一些');
    expect(intent.intensity).toBe(0.8);
  });

  it('defaults intensity to undefined when not specified', () => {
    const intent = parseThemeIntent('蓝色主题');
    expect(intent.intensity).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseThemeIntent — action recognition
// ---------------------------------------------------------------------------

describe('parseThemeIntent — action recognition', () => {
  it('parses restore action', () => {
    const intent = parseThemeIntent('恢复默认主题');
    expect(intent.action).toBe('restore');
  });

  it('parses preview action', () => {
    const intent = parseThemeIntent('预览一下蓝色');
    expect(intent.action).toBe('preview');
  });

  it('parses apply action from explicit keyword', () => {
    const intent = parseThemeIntent('换成蓝色');
    expect(intent.action).toBe('apply');
  });

  it('parses adjust action', () => {
    const intent = parseThemeIntent('调亮一点');
    expect(intent.action).toBe('adjust');
  });
});

// ---------------------------------------------------------------------------
// parseThemeIntent — mixed intent
// ---------------------------------------------------------------------------

describe('parseThemeIntent — mixed intent', () => {
  it('parses blue + presentation + low intensity', () => {
    const intent = parseThemeIntent('投屏用蓝色系，低调一点');
    expect(intent.colorHint).toBe('blue');
    expect(intent.scene).toBe('presentation');
    expect(intent.intensity).toBe(0.3);
    expect(intent.action).toBe('apply');
    expect(intent.confidence).toBeGreaterThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// parseThemeIntent — edge cases
// ---------------------------------------------------------------------------

describe('parseThemeIntent — edge cases', () => {
  it('returns unknown for empty string', () => {
    const intent = parseThemeIntent('');
    expect(intent.action).toBe('unknown');
    expect(intent.confidence).toBe(0);
  });

  it('returns unknown for whitespace-only input', () => {
    const intent = parseThemeIntent('   ');
    expect(intent.action).toBe('unknown');
    expect(intent.confidence).toBe(0);
  });

  it('returns unknown for unrecognizable input', () => {
    const intent = parseThemeIntent('今天天气怎么样');
    expect(intent.action).toBe('unknown');
    expect(intent.confidence).toBeLessThan(0.3);
  });
});

// ---------------------------------------------------------------------------
// intentToParams — color mapping
// ---------------------------------------------------------------------------

describe('intentToParams — color mapping', () => {
  it('maps blue intent to blue accent and dark mode', () => {
    const intent = parseThemeIntent('蓝色');
    const params = intentToParams(intent);
    expect(params.accent).toContain('hsl(220');
    expect(params.mode).toBe('dark');
    expect(params.intensity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// intentToParams — scene mapping
// ---------------------------------------------------------------------------

describe('intentToParams — scene mapping', () => {
  it('maps presentation to high contrast and low atmosphere', () => {
    const intent = parseThemeIntent('投屏');
    const params = intentToParams(intent);
    expect(params.mode).toBe('dark');
    expect(params.intensity).toBeLessThanOrEqual(0.3);
    expect(params.bg).toBeDefined();
    expect(params.surface).toBeDefined();
  });

  it('maps eye-care to warm light mode', () => {
    const intent = parseThemeIntent('护眼');
    const params = intentToParams(intent);
    expect(params.mode).toBe('light');
    expect(params.intensity).toBeLessThanOrEqual(0.4);
  });
});

// ---------------------------------------------------------------------------
// intentToParams — intensity passthrough
// ---------------------------------------------------------------------------

describe('intentToParams — intensity passthrough', () => {
  it('passes low intensity through', () => {
    const intent = parseThemeIntent('蓝色低调');
    const params = intentToParams(intent);
    expect(params.intensity).toBe(0.3);
  });

  it('passes high intensity through', () => {
    const intent = parseThemeIntent('暖色浓郁');
    const params = intentToParams(intent);
    expect(params.intensity).toBe(0.8);
  });

  it('defaults intensity to 0.5 when not specified', () => {
    const intent = parseThemeIntent('蓝色');
    const params = intentToParams(intent);
    expect(params.intensity).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// intentToParams — description
// ---------------------------------------------------------------------------

describe('intentToParams — description', () => {
  it('builds a human-readable description', () => {
    const intent = parseThemeIntent('投屏蓝色低调');
    const params = intentToParams(intent);
    expect(params.description).toContain('投屏');
    expect(params.description).toContain('蓝色');
    expect(params.description).toContain('低调');
    expect(params.description).toContain('dark');
  });
});

// ---------------------------------------------------------------------------
// End-to-end flow
// ---------------------------------------------------------------------------

describe('end-to-end flow', () => {
  it('natural language → ThemeIntent → ThemeParams', () => {
    const input = '把主题换成蓝色系，投屏用，低调一点';
    const intent = parseThemeIntent(input);
    const params = intentToParams(intent);

    expect(intent.action).toBe('apply');
    expect(intent.colorHint).toBe('blue');
    expect(intent.scene).toBe('presentation');
    expect(intent.intensity).toBe(0.3);

    expect(params.accent).toBeDefined();
    expect(params.mode).toBe('dark');
    expect(params.intensity).toBeLessThanOrEqual(0.3);
    expect(params.description).toBeTruthy();
  });
});
