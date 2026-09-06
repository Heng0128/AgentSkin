// SPDX-License-Identifier: MPL-2.0

/**
 * css-variable-detection.mjs 单测（RFC §5 S10 / 语义过滤层 MVP）
 *
 * CSS 变量引用检测：从命中规则原文/已解析变量中抽取 var(--x) 引用，判定节点
 * 是否与主题域（--agentskin-* / --cb-* / --semi-* / --ant-* 等）关联。
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME_DOMAINS,
  analyzeNodeThemeAssociation,
  assessThemeAssociation,
  classifyNodesThemeControl,
  extractVarReferences,
  matchesThemeDomain,
} from './css-variable-detection.mjs';

describe('extractVarReferences', () => {
  it('extracts deduplicated, lowercased var() references', () => {
    expect(
      extractVarReferences('color: var(--CB-fg); background: var(--cb-fg); border: 1px solid var(--semi-border);'),
    ).toEqual(['--cb-fg', '--semi-border']);
  });

  it('handles fallback values and optional spacing', () => {
    expect(extractVarReferences('color: var( --agentskin-text , #333 );')).toEqual(['--agentskin-text']);
  });

  it('returns [] for non-string / empty / no-var input', () => {
    expect(extractVarReferences(undefined)).toEqual([]);
    expect(extractVarReferences(null)).toEqual([]);
    expect(extractVarReferences('color: #fff')).toEqual([]);
    expect(extractVarReferences('')).toEqual([]);
  });
});

describe('matchesThemeDomain', () => {
  it('matches known theme domains (case-insensitive)', () => {
    expect(matchesThemeDomain('--cb-fg')).toBe(true);
    expect(matchesThemeDomain('--semi-color-text')).toBe(true);
    expect(matchesThemeDomain('--Ant-Color')).toBe(true);
    expect(matchesThemeDomain('--agentskin-text')).toBe(true);
  });

  it('rejects non-theme / bare vars', () => {
    expect(matchesThemeDomain('--sizing-unit')).toBe(false);
    expect(matchesThemeDomain('--x-local-color')).toBe(false);
    expect(matchesThemeDomain('color', DEFAULT_THEME_DOMAINS)).toBe(false);
  });
});

describe('assessThemeAssociation', () => {
  it("controlled when at least one themed var (default required=1)", () => {
    const v = assessThemeAssociation(['--cb-fg', '--sizing-unit']);
    expect(v.controlled).toBe(true);
    expect(v.themedVars).toEqual(['--cb-fg']);
    expect(v.themedCount).toBe(1);
    expect(v.totalCount).toBe(2);
  });

  it('not controlled when no themed var matches', () => {
    const v = assessThemeAssociation(['--local', '--sizing-unit']);
    expect(v.controlled).toBe(false);
    expect(v.themedCount).toBe(0);
  });

  it('honors required threshold', () => {
    expect(assessThemeAssociation(['--cb-fg', '--semi-bg'], { required: 2 }).controlled).toBe(true);
    expect(assessThemeAssociation(['--cb-fg'], { required: 2 }).controlled).toBe(false);
  });
});

describe('analyzeNodeThemeAssociation', () => {
  it('flags a themed rule reference as controlled', () => {
    const v = analyzeNodeThemeAssociation({ rules: ['color: var(--cb-fg)', 'padding: 8px'] });
    expect(v.controlled).toBe(true);
    expect(v.reason).toBe('css-var-association');
  });

  it('flags customProperties containing a themed var', () => {
    expect(analyzeNodeThemeAssociation({ customProperties: { '--semi-bg': 'rgb(10,20,30)', width: '100px' } }).controlled).toBe(true);
  });

  it('not controlled for hard-coded colors only', () => {
    const v = analyzeNodeThemeAssociation({ rules: ['color: #000', 'background: transparent'] });
    expect(v.controlled).toBe(false);
    expect(v.reason).toBe('css-var-none');
  });

  it('merges rules and customProperties', () => {
    const v = analyzeNodeThemeAssociation({
      rules: ['color: #fff'],
      customProperties: ['--agentskin-text'],
    });
    expect(v.controlled).toBe(true);
    expect(v.referencedVars).toContain('--agentskin-text');
    expect(v.totalCount).toBe(1);
  });

  it('treats missing input as not controlled', () => {
    expect(analyzeNodeThemeAssociation({}).controlled).toBe(false);
    expect(analyzeNodeThemeAssociation().controlled).toBe(false);
  });
});

describe('classifyNodesThemeControl', () => {
  it('splits nodes into controlled / non-controlled and computes ratio', () => {
    const result = classifyNodesThemeControl([
      { key: 'chat', rules: ['color: var(--cb-fg)'] },
      { key: 'widget', rules: ['color: #000'] },
    ]);
    expect(result.controlled.map((c) => c.key)).toEqual(['chat']);
    expect(result.nonControlled.map((c) => c.key)).toEqual(['widget']);
    expect(result.ratio).toBe(0.5);
  });

  it('passes when ratio >= minRatio', () => {
    const r = classifyNodesThemeControl(
      [
        { key: 'a', rules: ['color: var(--cb-fg)'] },
        { key: 'b', rules: ['background: var(--semi-bg)'] },
      ],
      { minRatio: 0.5 },
    );
    expect(r.pass).toBe(true);
  });

  it('is neutral when there are no nodes', () => {
    const r = classifyNodesThemeControl([]);
    expect(r.ratio).toBe(1);
    expect(r.controlled).toEqual([]);
    expect(r.pass).toBeUndefined();
  });
});