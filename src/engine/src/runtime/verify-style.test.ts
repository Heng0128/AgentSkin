// SPDX-License-Identifier: MPL-2.0

/**
 * verify-style.mjs 单测（RFC §2.7 序5 / CV-05）
 *
 * 纯函数验证——无 DOM / CDP 依赖。断言颜色解析、距离与样式合规判定。
 */

import { describe, expect, it } from 'vitest';
import {
  normalizeColor,
  colorDistance,
  matchesToken,
  assessStyleCompliance,
  STYLE_RUNTIME_SOURCE,
} from './verify-style.mjs';

describe('normalizeColor', () => {
  it('parses #rrggbb and #rgb hex', () => {
    expect(normalizeColor('#336699')).toEqual({ r: 0x33, g: 0x66, b: 0x99 });
    expect(normalizeColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('parses rgb(...) / rgba(...)', () => {
    expect(normalizeColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(normalizeColor('rgba(10,20,30,0.5)')).toEqual({ r: 10, g: 20, b: 30 });
  });

  it('rejects unparseable / non-pixel values', () => {
    for (const input of ['transparent', 'currentcolor', 'inherit', 'initial', 'unset', 'none', '', 'var(--x)', 'not-a-color']) {
      expect(normalizeColor(input)).toBeNull();
    }
  });
});

describe('colorDistance / matchesToken', () => {
  it('identical colors match within any tolerance', () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(0);
    expect(matchesToken('#0a141e', '#0a141e', 0.08)).toBe(true);
  });

  it('opposite colors do not match', () => {
    expect(matchesToken('#000000', '#ffffff', 0.08)).toBe(false);
  });

  it('unparseable expected token → null (cannot judge)', () => {
    expect(matchesToken('#ffffff', 'transparent', 0.08)).toBeNull();
  });

  it('unparseable actual → false', () => {
    expect(matchesToken('transparent', '#ffffff', 0.08)).toBe(false);
  });
});

describe('assessStyleCompliance', () => {
  const tokens = { text: '#111111', surface: '#f0f0f0' };

  it('passes when root text and a controlled node match the tokens', () => {
    const verdict = assessStyleCompliance(
      [
        { key: 'root', color: 'rgb(17,17,17)', bg: 'transparent' },
        { key: 'sidebar', color: '#111111', bg: '#f0f0f0' },
      ],
      tokens,
    );
    expect(verdict.pass).toBe(true);
    expect(verdict.matchRatio).toBe(1);
    expect(verdict.misses).toEqual([]);
  });

  it('flags drift when a controlled node carries neither themed color nor bg', () => {
    const verdict = assessStyleCompliance(
      [
        { key: 'root', color: '#111111', bg: 'transparent' },
        { key: 'sidebar', color: '#ffffff', bg: '#000000' },
      ],
      tokens,
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.misses.some((m) => m.key === 'sidebar')).toBe(true);
  });

  it('treats root background as neutral (transparent art layer, not compared)', () => {
    const verdict = assessStyleCompliance([{ key: 'root', color: '#111111', bg: 'transparent' }], tokens);
    expect(verdict.pass).toBe(true);
    expect(verdict.judged).toBe(1);
  });

  it('is neutral (pass) when no tokens are parseable', () => {
    const verdict = assessStyleCompliance([{ key: 'root', color: 'red', bg: 'blue' }], {});
    expect(verdict.pass).toBe(true);
    expect(verdict.judged).toBe(0);
  });
});

describe('STYLE_RUNTIME_SOURCE', () => {
  it('is a self-contained IIFE exposing the compliance functions', () => {
    const trimmed = STYLE_RUNTIME_SOURCE.trim();
    expect(trimmed.startsWith('(() => {')).toBe(true);
    expect(trimmed.endsWith('})()')).toBe(true);
    expect(trimmed).toContain('assessStyleCompliance');
    expect(trimmed).toContain('normalizeColor');
  });
});