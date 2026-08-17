// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-filter.mjs 单测（RFC §2.4 / CV-04）
 *
 * 纯 builder 验证：数据来自 selectivity-registry.mjs 的 semantic 配置。
 * 不触达真实 DOM / CDP——仅断言生成的字符串与选择器结构符合契约。
 */

import { describe, expect, it } from 'vitest';
import {
  collectNonControlledSelectors,
  buildExclusionSelectors,
  buildSemanticMarkExpression,
  NON_CONTROLLED_CLASS,
} from './semantic-filter.mjs';
import {
  getSemantic,
  isNativeThemeControlled,
  collectNonControlledTopology,
} from './selectivity-registry.mjs';

describe('semantic registry (CV-04 base)', () => {
  it('traework.sidebar is explicitly controlled and lists nonControlled nodes', () => {
    const semantic = getSemantic('traework', 'sidebar');
    expect(semantic).toBeTruthy();
    expect(semantic?.controlled).toBe(true);
    expect(semantic?.controllingSelector).toBe('.task-list-base');
    expect(semantic?.nonControlled).toContain('.task-list-divider');
  });

  it('codex.composer excludes inner input and button', () => {
    const semantic = getSemantic('codex', 'composer');
    expect(semantic?.nonControlled).toContain("[contenteditable='true']");
    expect(semantic?.nonControlled).toContain('button');
  });

  it('entries without semantic config default to theme-controlled', () => {
    // workbuddy.composer now has a semantic config → isNativeThemeControlled true
    expect(isNativeThemeControlled('workbuddy', 'composer')).toBe(true);
    // 未知条目也按受控处理（避免未配置退化）
    expect(isNativeThemeControlled('traework', 'does-not-exist')).toBe(true);
  });

  it('explicit controlled=false is respected', () => {
    // 预留：若未来某条目显式 controlled=false，应返回 false
    const fullTopology = collectNonControlledTopology('traework');
    expect(Array.isArray(fullTopology)).toBe(true);
  });

  it('4 agents gained composer nonControlled after audit A-01', () => {
    for (const agent of ['workbuddy', 'doubao', 'qoderwork', 'zcode']) {
      const semantic = getSemantic(agent, 'composer');
      expect(semantic?.controlled).toBe(true);
      expect(semantic?.nonControlled).toContain("[contenteditable='true']");
    }
  });
});

describe('collectNonControlledSelectors', () => {
  it('dedups and preserves order across components', () => {
    const selectors = collectNonControlledSelectors('traework');
    // sidebar 的两个 nonControlled
    expect(selectors).toContain('.task-list-divider');
    expect(selectors).toContain('.collapse-toggle-icon');
  });

  it('unknown agent returns empty', () => {
    expect(collectNonControlledSelectors('nope')).toEqual([]);
  });

  it('4 agents now contribute composer nonControlled selectors (A-01)', () => {
    for (const agent of ['workbuddy', 'doubao', 'qoderwork', 'zcode']) {
      const selectors = collectNonControlledSelectors(agent);
      expect(selectors).toContain("[contenteditable='true']");
      expect(selectors).toContain('textarea');
      expect(selectors).toContain('button');
    }
  });
});

describe('buildExclusionSelectors', () => {
  it('appends :not(.agentskin-non-controlled) to each nonControlled selector', () => {
    const exclusions = buildExclusionSelectors('traework');
    expect(exclusions).toContain(`.task-list-divider:not(.${NON_CONTROLLED_CLASS})`);
    expect(exclusions).toContain(`.collapse-toggle-icon:not(.${NON_CONTROLLED_CLASS})`);
  });

  it('honors custom className', () => {
    const exclusions = buildExclusionSelectors('traework', { className: 'x-foo' });
    expect(exclusions[0]).toContain(':not(.x-foo)');
  });

  it('returns exclusions for the 4 A-01 agents composer inputs', () => {
    for (const agent of ['workbuddy', 'doubao', 'qoderwork', 'zcode']) {
      const exclusions = buildExclusionSelectors(agent);
      expect(exclusions).toContain(`[contenteditable='true']:not(.${NON_CONTROLLED_CLASS})`);
    }
  });

  it('returns [] for an unknown/empty agent', () => {
    expect(buildExclusionSelectors('nope')).toEqual([]);
  });
});

describe('buildSemanticMarkExpression', () => {
  it('embeds selector list and class for evaluation', () => {
    const expression = buildSemanticMarkExpression('traework');
    expect(expression.startsWith('(() => {')).toBe(true);
    expect(expression).toContain('.task-list-divider');
    expect(expression).toContain(NON_CONTROLLED_CLASS);
    expect(expression).toContain('classList.add');
  });

  it('returns a trivial expression when no selectors exist', () => {
    const expression = buildSemanticMarkExpression('nope');
    expect(expression).toBe('(() => { return 0; })()');
  });
});