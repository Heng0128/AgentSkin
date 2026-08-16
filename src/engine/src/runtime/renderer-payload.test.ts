// SPDX-License-Identifier: MPL-2.0

/**
 * renderer-payload.mjs P1 批次单测（CV-03 / CV-05）
 *
 * 纯 builder 验证：断言生成表达式内嵌的 observer 排除集、条件 ensure、样式值对比。
 * 不触达真实 DOM / CDP。
 */

import { describe, expect, it } from 'vitest';
import {
  buildApplyExpression,
  buildVerifyExpression,
  buildStyleSamplingSnippet,
} from './renderer-payload.mjs';

const adapter = { id: 'traework' };

describe('buildApplyExpression — observer exclusion set (CV-03)', () => {
  const expression = buildApplyExpression({ adapter, targetTheme: { theme: { id: 't' }, css: '' } });

  it('embeds the full exclusion selector set', () => {
    expect(expression).toContain('[data-agentskin-baseline]');
    expect(expression).toContain('skin-chrome');
    expect(expression).toContain('agentskin-non-controlled');
    expect(expression).toContain('[data-agentskin-punched]');
    expect(expression).toContain('[aria-hidden="true"]');
  });

  it('gates conditional re-apply on missing <style> (no unconditional ensure)', () => {
    expect(expression).toContain("if (!document.getElementById(styleId)) ensure();");
  });
});

describe('buildVerifyExpression — style sampling (CV-05)', () => {
  it('embeds styleSampling as a non-blocking diagnostic (styleDrift)', () => {
    const expression = buildVerifyExpression(adapter, null, null, null);
    expect(expression).toContain('styleSampling');
    expect(expression).toContain('styleDrift');
    expect(expression).toContain('assessStyleCompliance');
    expect(expression).toContain('--agentskin-text');
    // 样式采样仅诊断，不硬性地参与 result.pass（避免偶尔的透明/currentColor
    // 等合法值被误判为未命中而拦截正常应用）。
    expect(expression).not.toContain('&& styleSampling.pass');
    expect(expression).toContain('result.pass = result.compatible && result.installed');
  });
});

describe('buildStyleSamplingSnippet', () => {
  it('returns a self-contained sampling snippet keyed by controlled semantic nodes', () => {
    const snippet = buildStyleSamplingSnippet(adapter);
    expect(snippet).toContain('styleSampling');
    expect(snippet).toContain('getComputedStyle');
    expect(snippet).toContain("document.getElementById('agentskin-theme-style-' + appId)");
    expect(snippet).toContain('root');
  });
});