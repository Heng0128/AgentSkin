// SPDX-License-Identifier: MPL-2.0

/**
 * meta-inference.mjs 单测（Layer3 加权融合推理）
 *
 * 纯逻辑：当前模式推断 + 指纹相似度 + 加权置信度分档。不触达 CDP/DOM。
 */

import { describe, expect, it } from 'vitest';
import { fingerprintSimilarity, inferCurrentMode, inferMeta } from './meta-inference.mjs';

describe('inferCurrentMode —— 当前原生模式推断', () => {
  it('prefers-color-scheme: dark 优先判定为 dark', () => {
    const dom = { prefersDark: true, prefersLight: false, dataset: {}, themeStorage: [] };
    expect(inferCurrentMode(dom)).toBe('dark');
  });

  it('prefers-color-scheme: light 判定为 light', () => {
    const dom = { prefersDark: false, prefersLight: true, dataset: {}, themeStorage: [] };
    expect(inferCurrentMode(dom)).toBe('light');
  });

  it('dataset.theme = classic-dark 判定为 dark（如 qoderwork）', () => {
    const dom = { prefersDark: null, dataset: { theme: 'classic-dark' }, themeStorage: [] };
    expect(inferCurrentMode(dom)).toBe('dark');
  });

  it('dataset.theme = light 判定为 light', () => {
    const dom = { prefersDark: null, dataset: { theme: 'light' }, themeStorage: [] };
    expect(inferCurrentMode(dom)).toBe('light');
  });

  it('storage theme=dark 判定为 dark', () => {
    const dom = { prefersDark: null, dataset: {}, themeStorage: [{ key: 'theme', value: 'dark' }] };
    expect(inferCurrentMode(dom)).toBe('dark');
  });

  it('无任何信号判定为 unknown', () => {
    const dom = { prefersDark: null, dataset: {}, themeStorage: [] };
    expect(inferCurrentMode(dom)).toBe('unknown');
  });

  it('dom 为空/有 error 时返回 unknown', () => {
    expect(inferCurrentMode(null)).toBe('unknown');
    expect(inferCurrentMode({ error: 'boom' })).toBe('unknown');
  });
});

describe('fingerprintSimilarity —— 指纹相似度打分', () => {
  const fp = { dataset: { theme: 'classic-dark' }, cssVars: { '--bg': '#000' } };

  it('完全匹配 → 100', () => {
    const obs = { dataset: { theme: 'classic-dark' }, cssVars: { '--bg': '#000' } };
    expect(fingerprintSimilarity(fp, obs)).toBe(100);
  });

  it('半匹配 → 50', () => {
    const obs = { dataset: { theme: 'classic-dark' }, cssVars: { '--bg': '#fff' } };
    expect(fingerprintSimilarity(fp, obs)).toBe(50);
  });

  it('完全不匹配 → 0', () => {
    const obs = { dataset: { theme: 'light' }, cssVars: { '--bg': '#fff' } };
    expect(fingerprintSimilarity(fp, obs)).toBe(0);
  });

  it('空指纹（如通用 fallback）→ 0', () => {
    expect(fingerprintSimilarity(null, { dataset: {}, cssVars: {} })).toBe(0);
    expect(fingerprintSimilarity({ dataset: null, cssVars: {} }, { dataset: {}, cssVars: {} })).toBe(0);
  });
});

describe('inferMeta —— 加权融合推理', () => {
  const runtime = {
    domContext: { prefersDark: null, dataset: { theme: 'classic-dark' }, themeStorage: [] },
    styleAst: { rootVars: [{ name: '--bg', value: '#000' }], adoptedRootVars: [], adoptedSheets: 0 },
    shadowDom: {},
  };
  const darkFp = { dataset: { theme: 'classic-dark' }, cssVars: { '--bg': '#000' } };

  it('指纹完全吻合 → confidence=high + ruleValid', () => {
    const rule = { agentId: 'x', lightFingerprint: null, darkFingerprint: darkFp, themePersistCandidates: [], lazyRiskComponents: [] };
    const meta = inferMeta(rule, runtime);
    expect(meta.confidence).toBe('high');
    expect(meta.ruleValid).toBe(true);
    expect(meta.fingerprintMatchScore).toBe(100);
    expect(meta.currentNativeMode).toBe('dark');
  });

  it('指纹部分吻合 → confidence=medium', () => {
    // 2 个 key，1 个匹配 → 50 分（40-84 区间）
    const rule = {
      agentId: 'x',
      lightFingerprint: null,
      darkFingerprint: { dataset: { theme: 'classic-dark' }, cssVars: { '--bg': '#fff' } },
      themePersistCandidates: [],
      lazyRiskComponents: [],
    };
    expect(inferMeta(rule, runtime).confidence).toBe('medium');
  });

  it('指纹不吻合 → confidence=low + rule 失效', () => {
    const rule = {
      agentId: 'x',
      lightFingerprint: { dataset: { theme: 'zzz' }, cssVars: { '--bg': '#f00' } },
      darkFingerprint: { dataset: { theme: 'zzz' }, cssVars: { '--bg': '#0f0' } },
      themePersistCandidates: [],
      lazyRiskComponents: [],
    };
    const meta = inferMeta(rule, runtime);
    expect(meta.confidence).toBe('low');
    expect(meta.ruleValid).toBe(false);
  });

  it('无规则（无先验）→ confidence=low', () => {
    const meta = inferMeta(null, runtime);
    expect(meta.confidence).toBe('low');
    expect(meta.fingerprintMatchScore).toBe(0);
  });

  it('canSilentSwitch 时 switchMethod 按 API > dataset > localStorage 排序', () => {
    const rule = {
      agentId: 'x',
      lightFingerprint: null,
      darkFingerprint: darkFp,
      canSilentSwitch: true,
      globalApiCandidates: ['window.__bridge.setTheme'],
      themePersistCandidates: [
        { type: 'dataset', key: 'data-theme' },
        { type: 'localStorage', key: 'theme' },
      ],
      lazyRiskComponents: [],
    };
    const meta = inferMeta(rule, runtime);
    expect(meta.canSilentSwitch).toBe(true);
    expect(meta.switchMethod).toEqual(['globalApi', 'dataset', 'localStorage']);
  });

  it('adoptedStyleSheetDetected 反映运行时构造样式表', () => {
    const rule = { agentId: 'x', lightFingerprint: null, darkFingerprint: darkFp, themePersistCandidates: [], lazyRiskComponents: [] };
    const withAdopted = { ...runtime, styleAst: { ...runtime.styleAst, adoptedSheets: 5 } };
    expect(inferMeta(rule, withAdopted).adoptedStyleSheetDetected).toBe(true);
    expect(inferMeta(rule, runtime).adoptedStyleSheetDetected).toBe(false);
  });
});
