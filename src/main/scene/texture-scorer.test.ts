// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  createScoringContext,
  scoreTexture,
  selectBestTexture,
  type TextureCandidate,
} from './texture-scorer';

const CONTEXT = createScoringContext(1920, 1080);

function candidate(overrides: Partial<TextureCandidate> = {}): TextureCandidate {
  return {
    id: 'obj1',
    name: 'texture',
    width: 2048,
    height: 2048,
    position: { x: 960, y: 540 },
    opacity: 1.0,
    blendMode: 'normal',
    ...overrides,
  };
}

describe('scoreTexture', () => {
  it('gives higher score to larger resolution', () => {
    const small = scoreTexture(candidate({ width: 512, height: 512 }), CONTEXT);
    const large = scoreTexture(candidate({ width: 4096, height: 4096 }), CONTEXT);
    expect(large).toBeGreaterThan(small);
  });

  it('gives higher score to "hero" name vs "mask" name', () => {
    const hero = scoreTexture(candidate({ name: 'hero-art' }), CONTEXT);
    const mask = scoreTexture(candidate({ name: 'mask-effect' }), CONTEXT);
    expect(hero).toBeGreaterThan(mask);
  });

  it('gives higher score to 16:9 aspect ratio vs 1:1', () => {
    const wide = scoreTexture(candidate({ width: 1920, height: 1080 }), CONTEXT);
    const square = scoreTexture(candidate({ width: 1024, height: 1024 }), CONTEXT);
    expect(wide).toBeGreaterThan(square);
  });

  it('gives higher score to centered position vs edge', () => {
    const centered = scoreTexture(candidate({ position: { x: 960, y: 540 } }), CONTEXT);
    const edge = scoreTexture(candidate({ position: { x: 0, y: 0 } }), CONTEXT);
    expect(centered).toBeGreaterThan(edge);
  });

  it('gives higher score to full opacity vs half opacity', () => {
    const full = scoreTexture(candidate({ opacity: 1.0 }), CONTEXT);
    const half = scoreTexture(candidate({ opacity: 0.5 }), CONTEXT);
    expect(full).toBeGreaterThan(half);
  });

  it('gives higher score to normal blend mode vs additive', () => {
    const normal = scoreTexture(candidate({ blendMode: 'normal' }), CONTEXT);
    const additive = scoreTexture(candidate({ blendMode: 'additive' }), CONTEXT);
    expect(normal).toBeGreaterThan(additive);
  });

  it('returns 0 for zero-dimension texture', () => {
    const score = scoreTexture(candidate({ width: 0, height: 0 }), CONTEXT);
    expect(score).toBe(0);
  });

  it('returns score in [0, 1] range', () => {
    const score = scoreTexture(candidate(), CONTEXT);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

describe('selectBestTexture', () => {
  it('returns null for empty list', () => {
    expect(selectBestTexture([], CONTEXT)).toBeNull();
  });

  it('returns the only candidate for single-element list', () => {
    const c = candidate({ id: 'only' });
    expect(selectBestTexture([c], CONTEXT)?.id).toBe('only');
  });

  it('selects the highest-scoring candidate', () => {
    const candidates = [
      candidate({ id: 'small', width: 256, height: 256 }),
      candidate({ id: 'large', width: 4096, height: 4096 }),
      candidate({ id: 'medium', width: 1024, height: 1024 }),
    ];
    expect(selectBestTexture(candidates, CONTEXT)?.id).toBe('large');
  });

  it('selects hero-named texture over others', () => {
    const candidates = [
      candidate({ id: 'mask1', name: 'mask', width: 4096, height: 4096 }),
      candidate({ id: 'hero1', name: 'hero', width: 1024, height: 1024 }),
    ];
    // Hero name should boost score despite lower resolution
    expect(selectBestTexture(candidates, CONTEXT)?.id).toBe('hero1');
  });

  it('returns null when all scores are 0', () => {
    const candidates = [
      candidate({ id: 'zero1', width: 0, height: 0 }),
      candidate({ id: 'zero2', width: 0, height: 0 }),
    ];
    expect(selectBestTexture(candidates, CONTEXT)).toBeNull();
  });
});

describe('createScoringContext', () => {
  it('computes aspect ratio correctly', () => {
    const ctx = createScoringContext(1920, 1080);
    expect(ctx.sceneAspectRatio).toBeCloseTo(16 / 9, 5);
  });

  it('falls back to 16:9 for zero dimensions', () => {
    const ctx = createScoringContext(0, 0);
    expect(ctx.sceneAspectRatio).toBe(16 / 9);
  });
});
