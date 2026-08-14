// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { mergeRenderOptions, themeRenderOptions } from './agent-engine-options';

describe('mergeRenderOptions', () => {
  it('returns base when override is undefined', () => {
    const base = { speed: 2, loop: true };
    expect(mergeRenderOptions(base, undefined)).toEqual({ speed: 2, loop: true });
  });

  it('returns override when base is undefined', () => {
    const override = { brightness: 120 };
    expect(mergeRenderOptions(undefined, override)).toEqual({ brightness: 120 });
  });

  it('merges both with override winning on conflict', () => {
    const base = { speed: 1, loop: true, alignment: 'fill' as const };
    const override = { speed: 2, brightness: 80 };
    expect(mergeRenderOptions(base, override)).toEqual({
      speed: 2,
      loop: true,
      alignment: 'fill',
      brightness: 80,
    });
  });

  it('returns merged object when both are defined but empty', () => {
    expect(mergeRenderOptions({}, {})).toEqual({});
  });

  it('does not mutate the input objects', () => {
    const base = { speed: 1 };
    const override = { loop: false };
    const result = mergeRenderOptions(base, override);
    expect(base).toEqual({ speed: 1 });
    expect(override).toEqual({ loop: false });
    expect(result).not.toBe(base);
    expect(result).not.toBe(override);
  });

  it('returns undefined when both are undefined', () => {
    expect(mergeRenderOptions(undefined, undefined)).toBeUndefined();
  });
});

describe('themeRenderOptions', () => {
  it('returns undefined when no fields are set', () => {
    expect(themeRenderOptions({})).toBeUndefined();
  });

  it('returns undefined when all legacy fields are undefined', () => {
    expect(
      themeRenderOptions({
        speed: undefined,
        loop: undefined,
        scrimOpacity: undefined,
      }),
    ).toBeUndefined();
  });

  it('folds speed into render when provided alone', () => {
    expect(themeRenderOptions({ speed: 2 })).toEqual({ speed: 2 });
  });

  it('folds loop into render when provided alone', () => {
    expect(themeRenderOptions({ loop: false })).toEqual({ loop: false });
  });

  it('folds scrimOpacity into render when provided alone', () => {
    expect(themeRenderOptions({ scrimOpacity: 60 })).toEqual({ scrimOpacity: 60 });
  });

  it('preserves existing render fields when legacy fields are added', () => {
    expect(
      themeRenderOptions({
        render: { alignment: 'fit' as const, brightness: 110 },
        speed: 1.5,
      }),
    ).toEqual({ alignment: 'fit', brightness: 110, speed: 1.5 });
  });

  it('legacy render overrides top-level render fields on conflict', () => {
    // Legacy fields are spread AFTER render, so they win on conflict
    expect(
      themeRenderOptions({
        render: { speed: 1, loop: true },
        speed: 3,
      }),
    ).toEqual({ speed: 3, loop: true });
  });

  it('preserves falsy legacy values (speed: 0)', () => {
    // Regression: speed=0 is a valid playback speed and should NOT be treated as undefined
    expect(themeRenderOptions({ speed: 0 })).toEqual({ speed: 0 });
  });

  it('preserves falsy legacy values (loop: false)', () => {
    expect(themeRenderOptions({ loop: false })).toEqual({ loop: false });
  });

  it('preserves falsy legacy values (scrimOpacity: 0)', () => {
    expect(themeRenderOptions({ scrimOpacity: 0 })).toEqual({ scrimOpacity: 0 });
  });

  it('merges all three legacy fields together', () => {
    expect(themeRenderOptions({ speed: 1.5, loop: false, scrimOpacity: 70 })).toEqual({
      speed: 1.5,
      loop: false,
      scrimOpacity: 70,
    });
  });
});
