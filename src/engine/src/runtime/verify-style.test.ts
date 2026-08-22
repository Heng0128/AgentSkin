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
  aggregateByRegion,
  resolveStyleSamplingOpts,
  DEFAULT_TOLERANCE,
  DEFAULT_MIN_RATIO,
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

  it('is UNVERIFIABLE (not silent pass) when no tokens are parseable (A-13)', () => {
    // A-13 三态：无可判定样本 → status=unverifiable，pass=false，
    // 不再像旧逻辑那样静默通过。
    const verdict = assessStyleCompliance([{ key: 'root', color: 'red', bg: 'blue' }], {});
    expect(verdict.status).toBe('unverifiable');
    expect(verdict.pass).toBe(false);
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

  it('serializes minRatio defaults as literals, not module references (A-02)', () => {
    // 浏览器端 IIFE 不定义模块级常量；若默认值内联成 `DEFAULT_MIN_RATIO`
    // 引用会直接 ReferenceError。
    expect(STYLE_RUNTIME_SOURCE).not.toContain('DEFAULT_MIN_RATIO');
    expect(STYLE_RUNTIME_SOURCE).not.toContain('DEFAULT_TOLERANCE');
    expect(STYLE_RUNTIME_SOURCE).toContain('minRatio ?? 0.85');
  });
});

describe('resolveStyleSamplingOpts — per-Agent 预算 (A-02)', () => {
  it('defaults to DEFAULT_TOLERANCE / DEFAULT_MIN_RATIO for unregistered agents', () => {
    expect(DEFAULT_MIN_RATIO).toBe(0.85);
    expect(DEFAULT_TOLERANCE).toBe(0.08);
    expect(resolveStyleSamplingOpts()).toEqual({ tolerance: 0.08, minRatio: 0.85 });
    expect(resolveStyleSamplingOpts('workbuddy')).toEqual({ tolerance: 0.08, minRatio: 0.85 });
  });

  it('explicit override wins over the default', () => {
    expect(resolveStyleSamplingOpts('workbuddy', { minRatio: 1 })).toEqual({ tolerance: 0.08, minRatio: 1 });
  });

  it('assessStyleCompliance honors default minRatio 0.85 (partial drift tolerable)', () => {
    // 7 个受控节点，1 个未命中 → ratio 6/7≈0.857 ≥ 0.85 → pass（minRatio=1 会 fail）
    const allHit = [...Array(6)].map((_, i) => ({
      key: `workspace-${i}`, color: '#111111', bg: '#f0f0f0',
    }));
    const verdict = assessStyleCompliance(
      [
        { key: 'root', color: '#111111', bg: 'transparent' },
        ...allHit,
        { key: 'workspace-6', color: '#ffffff', bg: '#000000' },
      ],
      { text: '#111111', surface: '#f0f0f0' },
    );
    expect(verdict.matchRatio).toBeCloseTo(7 / 8, 5);
    expect(verdict.pass).toBe(true);
  });

  it('still fails when drift exceeds 0.85 threshold (theme essentially not applied)', () => {
    // 仅 root 命中（1/3≈0.33 < 0.85）→ fail：拦截主题完全未生效的真漂移
    const verdict = assessStyleCompliance(
      [
        { key: 'root', color: '#111111', bg: 'transparent' },
        { key: 'sidebar', color: '#ffffff', bg: '#000000' },
        { key: 'workspace', color: '#ffffff', bg: '#000000' },
      ],
      { text: '#111111', surface: '#f0f0f0' },
    );
    expect(verdict.matchRatio).toBeCloseTo(1 / 3, 5);
    expect(verdict.pass).toBe(false);
  });
});

describe('aggregateByRegion（双通道报告，RFC §4.5）', () => {
  const tokens = { text: '#111111', surface: '#f0f0f0' };

  it('全部通过 → 双通道均为空', () => {
    const verdict = aggregateByRegion(
      [
        { key: 'root', color: '#111111', bg: 'transparent' },
        { key: 'sidebar', color: '#111111', bg: '#f0f0f0' },
      ],
      tokens,
    );
    expect(verdict.hardErrors).toEqual([]);
    expect(verdict.semanticWarnings).toEqual([]);
  });

  it('high 风险组件失败 → hardErrors（阻断 CI）', () => {
    const verdict = aggregateByRegion(
      [{ key: 'sidebar', color: '#ffffff', bg: '#000000' }],
      tokens,
    );
    expect(verdict.hardErrors).toHaveLength(1);
    expect(verdict.hardErrors[0].componentId).toBe('sidebar');
    expect(verdict.hardErrors[0].riskLevel).toBe('high');
    expect(verdict.semanticWarnings).toEqual([]);
  });

  it('medium 风险组件失败 → semanticWarnings（仅提示）', () => {
    const verdict = aggregateByRegion(
      [{ key: 'workspace', color: '#ffffff', bg: '#000000' }],
      tokens,
    );
    expect(verdict.hardErrors).toEqual([]);
    expect(verdict.semanticWarnings).toHaveLength(1);
    expect(verdict.semanticWarnings[0].componentId).toBe('workspace');
    expect(verdict.semanticWarnings[0].riskLevel).toBe('medium');
  });

  it('key→componentId 映射：messageList（registry 语义名）→ message-list（high）', () => {
    const verdict = aggregateByRegion(
      [{ key: 'messageList', color: '#ffffff', bg: '#000000' }],
      tokens,
    );
    expect(verdict.hardErrors).toHaveLength(1);
    expect(verdict.hardErrors[0].componentId).toBe('message-list');
    expect(verdict.hardErrors[0].riskLevel).toBe('high');
  });

  it('显式 componentId 优先于 key 映射', () => {
    const verdict = aggregateByRegion(
      [{ key: 'sidebar', componentId: 'workspace', color: '#ffffff', bg: '#000000' }],
      tokens,
    );
    expect(verdict.semanticWarnings).toHaveLength(1);
    expect(verdict.semanticWarnings[0].componentId).toBe('workspace');
  });

  it('COMPONENT_INDEX 未登记组件（索引漏登记场景）→ 默认 medium → 仅提示，绝不阻断', () => {
    const verdict = aggregateByRegion(
      [{ key: 'future-tab-bar', color: '#ffffff', bg: '#000000' }],
      tokens,
    );
    expect(verdict.hardErrors).toEqual([]);
    expect(verdict.semanticWarnings).toHaveLength(1);
    expect(verdict.semanticWarnings[0].riskLevel).toBe('medium');
  });
});

describe('aggregateByRegion — UNVERIFIABLE 通道 (A-13)', () => {
  const tokens = { text: '#111111', surface: '#f0f0f0' };

  it('无法判定的组件走 unverifiable 而非 hardErrors/semanticWarnings', () => {
    const verdict = aggregateByRegion(
      [
        // sidebar 实际可判定（color 不可解析 → usableProps 为 0 → judged 仍为 0）
        { key: 'sidebar', color: 'none', bg: 'transparent' },
      ],
      {},
    );
    expect(verdict.hardErrors).toEqual([]);
    expect(verdict.semanticWarnings).toEqual([]);
    expect(verdict.unverifiable).toHaveLength(1);
    expect(verdict.unverifiable[0].componentId).toBe('sidebar');
    expect(verdict.unverifiable[0].status).toBe('unverifiable');
    expect(verdict.unverifiable[0].pass).toBe(false);
  });
});