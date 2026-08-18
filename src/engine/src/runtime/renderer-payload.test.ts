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
  buildPersistenceScript,
  buildVerifyExpression,
  buildStyleSamplingSnippet,
  SESSION_DISABLED_KEY,
} from './renderer-payload.mjs';
import { DIAGNOSTICS_KILL_SWITCH } from './diagnostics-kill-switch.mjs';

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

  it('gates conditional re-apply on a missing adopted theme sheet (no unconditional ensure)', () => {
    expect(expression).toContain("(document.adoptedStyleSheets || []).some((s) => s.__agentskin_theme === true)");
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
    expect(snippet).toContain("__agentskin_theme === true)");
    expect(snippet).toContain('root');
  });

  it('embeds per-Agent sampling opts with default minRatio 0.85 (A-02)', () => {
    const snippet = buildStyleSamplingSnippet({ id: 'zcode' });
    expect(snippet).toContain('"minRatio":0.85');
    expect(snippet).toContain('"tolerance":0.08');
  });

  it('drops composer probe when the anchor is itself nonControlled and has no shell (A-03)', () => {
    // zcode composer = 可编辑输入框（无 controllingSelector），锚点在 nonControlled 内 →
    // 不再采样该非受控节点，避免漂移误报。
    const snippet = buildStyleSamplingSnippet({ id: 'zcode' });
    expect(snippet).not.toContain('"name":"composer"');
  });

  it('keeps and prefers the controlling shell for codex composer (A-03)', () => {
    // codex composer 有独立受控壳体 .composer-surface-chrome → 保留采样并优先采样它。
    const snippet = buildStyleSamplingSnippet({ id: 'codex' });
    expect(snippet).toContain('"controllingSelector":".composer-surface-chrome"');
    expect(snippet).toContain('"name":"composer"');
  });

  it('yields a neutral pass when the agent diagnostic is kill-switched (A-18)', () => {
    // 临时写入门控，验证特异性关闭路径；测试末尾还原。
    DIAGNOSTICS_KILL_SWITCH.zcode = { styleSampling: true };
    try {
      const snippet = buildStyleSamplingSnippet({ id: 'zcode' });
      expect(snippet).toContain("reason: 'diagnostics-kill-switched'");
      expect(snippet).toContain('pass: true');
      // 不再触发真实采样/比对逻辑（不内嵌 assessStyleCompliance / 真实 probe）
      expect(snippet).not.toContain('assessStyleCompliance');
      expect(snippet).not.toContain('"name":"composer"');
    } finally {
      delete DIAGNOSTICS_KILL_SWITCH.zcode;
    }
  });
});

describe('buildApplyExpression — bridge compilation (S3)', () => {
  const bridgeAdapter = {
    id: 'zcode',
    bridge: [
      { var: '--text-primary', role: 'text' },
      { var: '--bg-surface', role: 'surface', alpha: 0.8 },
      { var: '--accent', role: 'accent' },
    ],
  };

  it('compiles bridge entries into the host `:root` rule of the theme <style>', () => {
    const expression = buildApplyExpression({ adapter: bridgeAdapter, targetTheme: { theme: { id: 't' }, css: '/* theme */' } });
    expect(expression).toContain('html.agentskin-host-zcode:root');
    expect(expression).toContain('--text-primary: var(--agentskin-text) !important');
    expect(expression).toContain('--accent: var(--agentskin-accent) !important');
    // alpha < 1 wraps the token ref in color-mix, mirroring tokens.css translucency.
    expect(expression).toContain('--bg-surface: color-mix(in srgb, var(--agentskin-surface) 80%, transparent) !important');
  });

  it('appends no bridge rule when the adapter declares empty entries', () => {
    const expression = buildApplyExpression({
      adapter: { id: 'traework', bridge: [] },
      targetTheme: { theme: { id: 't' }, css: ':root{}' },
    });
    expect(expression).not.toContain('agentskin-host-traework:root');
    expect(expression).toContain('":root{}"');
  });

  it('appends no bridge rule when the adapter omits a bridge', () => {
    const expression = buildApplyExpression({
      adapter: { id: 'workbuddy' },
      targetTheme: { theme: { id: 't' }, css: ':root{}' },
    });
    expect(expression).not.toContain('agentskin-host-workbuddy:root');
    expect(expression).toContain('":root{}"');
  });
});

describe('buildPersistenceScript — new-document persistence (RFC P1)', () => {
  const targetTheme = { theme: { id: 't', version: '1' }, css: ':root{}' };

  it('reuses the exact same injection body as buildApplyExpression (no drift)', () => {
    const persistence = buildPersistenceScript({ adapter, targetTheme });
    const applyBody = buildApplyExpression({ adapter, targetTheme });
    // The persistence script embeds the full apply expression verbatim.
    expect(persistence).toContain(JSON.stringify(applyBody));
    // …and therefore inherits every injection marker of the apply body
    // (host class embedded in the apply body's JSON host literal).
    expect(persistence).toContain('__agentskin_theme');
    expect(persistence).toContain('agentskin-host-traework');
  });

  it('skips early when the sessionStorage disabled flag is set (removeTheme fallback)', () => {
    const persistence = buildPersistenceScript({ adapter, targetTheme });
    expect(persistence).toContain(`sessionStorage.getItem(${JSON.stringify(SESSION_DISABLED_KEY)}) === '1'`);
    expect(persistence).toContain('return');
  });

  it('waits for document.documentElement on early new documents', () => {
    const persistence = buildPersistenceScript({ adapter, targetTheme });
    expect(persistence).toContain('document.documentElement');
    expect(persistence).toContain('new MutationObserver');
    expect(persistence).toContain('obs.observe(document, { childList: true, subtree: false })');
  });

  it('executes the injection body via (0, eval) — self-contained, no closure drift', () => {
    const persistence = buildPersistenceScript({ adapter, targetTheme });
    expect(persistence).toContain('(0, eval)(APPLY_BODY)');
    // Idempotency is delegated to the shared apply body (ensure() skips when
    // the style element already exists), so repeated executions do not pile up.
    expect(persistence).toContain('const APPLY_BODY');
  });
});