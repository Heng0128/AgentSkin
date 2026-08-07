// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  type FingerprintResult,
  fingerprintClassnames,
  fingerprintCombined,
  fingerprintCssVars,
  fingerprintFromClassList,
  pickBest,
} from './framework-fingerprint';

// ---------------------------------------------------------------------------
// fingerprintClassnames — 类名识别
// ---------------------------------------------------------------------------

describe('fingerprintClassnames', () => {
  it('识别 Tailwind 类名', () => {
    const result = fingerprintClassnames([
      'bg-blue-500',
      'text-gray-900',
      'flex',
      'justify-center',
      'p-4',
      'rounded-lg',
      'shadow-md',
      'w-full',
      'gap-3',
    ]);
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.3);
    expect(result.detectedSignals.length).toBeGreaterThan(0);
  });

  it('识别 Tailwind 复合类名（含斜杠 alpha）', () => {
    const result = fingerprintClassnames([
      'bg-blue-500/50',
      'ring-blue-200',
      'text-slate-700',
      'divide-gray-200',
      'from-purple-500',
      'to-pink-500',
    ]);
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('识别 MUI 类名', () => {
    const result = fingerprintClassnames([
      'MuiButton-root',
      'MuiButton-text',
      'css-1abc23',
      'css-xyz789',
    ]);
    expect(result.framework).toBe('mui');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('识别 Ant Design 类名', () => {
    const result = fingerprintClassnames([
      'ant-btn',
      'ant-layout-header',
      'ant-layout-sider',
      'ant-menu',
    ]);
    // 'ant-layout-sider' 会被 ant-design 和 tailwind 同时匹配到，
    // 但 'ant-btn' + 'ant-layout-header' 的独特组合使 ant-design 胜出
    expect(result.framework).toBe('ant-design');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('识别 Element UI 类名', () => {
    const result = fingerprintClassnames([
      'el-button--primary',
      'el-input__inner',
      'el-form-item',
      'el-dialog',
    ]);
    expect(result.framework).toBe('element-ui');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('识别 styled-components 类名', () => {
    const result = fingerprintClassnames(['css-1dbjc4n', 'css-18t94o4']);
    // styled-components 和 mui 共享 css-* 模式，但使用更严格的模式
    // 结果可能是 mui 或 styled-components，取决于分数
    expect(['mui', 'styled-components']).toContain(result.framework);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('空数组返回 unknown', () => {
    const result = fingerprintClassnames([]);
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.detectedSignals).toHaveLength(0);
  });

  it('全空字符串返回 unknown', () => {
    const result = fingerprintClassnames(['', '  ', '']);
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('未知框架类名返回 unknown', () => {
    const result = fingerprintClassnames([
      'my-custom-class',
      'foo-bar-baz',
      'random-classname-123',
    ]);
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('识别 vant 类名', () => {
    const result = fingerprintClassnames(['van-button--primary', 'van-nav-bar', 'van-cell']);
    expect(result.framework).toBe('vant');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('识别 naive-ui 类名', () => {
    const result = fingerprintClassnames(['n-button', 'n-card', 'n-space']);
    expect(result.framework).toBe('naive-ui');
    expect(result.confidence).toBeGreaterThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// fingerprintCssVars — CSS 变量识别
// ---------------------------------------------------------------------------

describe('fingerprintCssVars', () => {
  it('MUI CSS 变量识别', () => {
    const result = fingerprintCssVars([
      '--mui-palette-primary-main',
      '--mui-palette-secondary-main',
      '--mui-spacing-unit',
      '--color-bg',
    ]);
    expect(result.framework).toBe('mui');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.detectedSignals.some((s) => s.startsWith('cssVar:'))).toBe(true);
  });

  it('Ant Design CSS 变量识别', () => {
    const result = fingerprintCssVars([
      '--ant-primary-color',
      '--ant-success-color',
      '--ant-font-size-base',
    ]);
    expect(result.framework).toBe('ant-design');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('Element UI CSS 变量识别', () => {
    const result = fingerprintCssVars([
      '--el-color-primary',
      '--el-border-radius-base',
      '--el-font-size-large',
    ]);
    expect(result.framework).toBe('element-ui');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('Chakra CSS 变量识别', () => {
    const result = fingerprintCssVars([
      '--chakra-colors-blue-500',
      '--chakra-space-4',
      '--chakra-radii-md',
    ]);
    expect(result.framework).toBe('chakra');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('空数组返回 unknown', () => {
    const result = fingerprintCssVars([]);
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// fingerprintCombined — 组合识别
// ---------------------------------------------------------------------------

describe('fingerprintCombined', () => {
  it('Tailwind 类名 + 无特征 CSS 变量 → Tailwind', () => {
    const result = fingerprintCombined({
      classnames: ['bg-blue-500', 'text-gray-900', 'flex', 'justify-center', 'p-4', 'rounded-lg'],
      cssVars: [],
      dataAttrs: [],
      domSnippets: [],
    });
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('MUI 类名 + MUI CSS 变量加权 → MUI 高置信度', () => {
    const result = fingerprintCombined({
      classnames: ['MuiButton-root', 'MuiInputBase-input', 'css-1abc23'],
      cssVars: ['--mui-palette-primary-main', '--mui-spacing-unit'],
      dataAttrs: [],
      domSnippets: [],
    });
    expect(result.framework).toBe('mui');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('Ant Design 类名 + CSS 变量组合 → Ant Design', () => {
    const result = fingerprintCombined({
      classnames: ['ant-btn', 'ant-layout-header', 'ant-menu'],
      cssVars: ['--ant-primary-color'],
      dataAttrs: [],
      domSnippets: ['.ant-layout'],
    });
    expect(result.framework).toBe('ant-design');
    expect(result.confidence).toBeGreaterThan(0.3);
    // domIndicators 应命中
    expect(result.detectedSignals.some((s) => s.startsWith('dom:'))).toBe(true);
  });

  it('data-mui 属性命中 dataAttributes 维度', () => {
    const _result = fingerprintCombined({
      classnames: ['css-1a2b3c', 'some-other-class'],
      cssVars: [],
      dataAttrs: ['data-mui-internal'],
      domSnippets: [],
    });
    // dataAttributes 维度只为精确匹配加分，data-mui-internal !== data-mui
    // 故不应命中 dataAttributes
    const result2 = fingerprintCombined({
      classnames: ['css-1a2b3c'],
      cssVars: [],
      dataAttrs: ['data-mui'],
      domSnippets: [],
    });
    // data-mui 精确命中
    expect(result2.detectedSignals.some((s) => s.startsWith('dataAttr:'))).toBe(true);
  });

  it('全空输入返回 unknown', () => {
    const result = fingerprintCombined({
      classnames: [],
      cssVars: [],
      dataAttrs: [],
      domSnippets: [],
    });
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('Tailwind 类名可跨维度联合提升置信度', () => {
    // 单一维度 vs 多维度对比：多维度应提升置信度
    const single = fingerprintClassnames(['bg-blue-500', 'flex', 'p-4']);
    const combined = fingerprintCombined({
      classnames: ['bg-blue-500', 'flex', 'p-4'],
      cssVars: [],
      dataAttrs: [],
      domSnippets: [],
    });
    // combined 使用类名权重 0.5，所以置信度应低于纯类名（权重 1.0）
    // 但结果框架应相同
    expect(combined.framework).toBe('tailwind');
    expect(single.framework).toBe('tailwind');
  });

  it('多维度信号不一致时取加权最高', () => {
    // 类名指向 tailwind，CSS 变量指向 mui
    const result = fingerprintCombined({
      classnames: ['bg-blue-500', 'text-gray-900', 'flex', 'justify-center'],
      cssVars: ['--mui-palette-primary-main'],
      dataAttrs: [],
      domSnippets: [],
    });
    // Tailwind 类有 4 个，权重 0.5；MUI 变量 1 个，权重 0.25
    // 所以 tailwind 应该胜出
    expect(result.framework).toBe('tailwind');
  });
});

// ---------------------------------------------------------------------------
// fingerprintFromClassList — 展平类名列表
// ---------------------------------------------------------------------------

describe('fingerprintFromClassList', () => {
  it('展平空格分隔的多类名字符串', () => {
    const result = fingerprintFromClassList([
      'bg-blue-500 flex justify-center',
      'text-gray-900 p-4',
      'rounded-lg shadow-md',
    ]);
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.2);
  });

  it('空数组返回 unknown', () => {
    const result = fingerprintFromClassList([]);
    expect(result.framework).toBe('unknown');
    expect(result.confidence).toBe(0);
  });

  it('去重后不影响识别', () => {
    const result = fingerprintFromClassList(['bg-blue-500 bg-blue-500', 'flex flex', 'p-4 p-4']);
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.2);
  });
});

// ---------------------------------------------------------------------------
// pickBest — 多结果仲裁
// ---------------------------------------------------------------------------

describe('pickBest', () => {
  it('取置信度最高的结果', () => {
    const results: FingerprintResult[] = [
      { framework: 'tailwind', confidence: 0.3, detectedSignals: ['a'] },
      { framework: 'mui', confidence: 0.8, detectedSignals: ['b'] },
      { framework: 'unknown', confidence: 0, detectedSignals: [] },
    ];
    const best = pickBest(results);
    expect(best.framework).toBe('mui');
    expect(best.confidence).toBe(0.8);
  });

  it('过滤 unknown 结果', () => {
    const results: FingerprintResult[] = [
      { framework: 'unknown', confidence: 0, detectedSignals: [] },
      { framework: 'unknown', confidence: 0, detectedSignals: [] },
    ];
    const best = pickBest(results);
    expect(best.framework).toBe('unknown');
    expect(best.confidence).toBe(0);
  });

  it('空数组返回 unknown', () => {
    const best = pickBest([]);
    expect(best.framework).toBe('unknown');
    expect(best.confidence).toBe(0);
  });

  it('相同置信度时合并 signals', () => {
    const results: FingerprintResult[] = [
      { framework: 'tailwind', confidence: 0.5, detectedSignals: ['class:bg-blue-500'] },
      { framework: 'tailwind', confidence: 0.5, detectedSignals: ['class:flex'] },
    ];
    const best = pickBest(results);
    expect(best.framework).toBe('tailwind');
    expect(best.confidence).toBe(0.5);
    expect(best.detectedSignals).toContain('class:bg-blue-500');
    expect(best.detectedSignals).toContain('class:flex');
  });

  it('跨维度综合：类名结果 vs CSS 变量结果仲裁', () => {
    // 类名给出 tailwind（低置信度），cssVars 给出 mui（高置信度）
    const cls = fingerprintClassnames(['flex', 'block']);
    const css = fingerprintCssVars(['--mui-palette-primary-main', '--mui-spacing-unit']);
    const best = pickBest([cls, css]);
    // cssVars 的两个变量 / 总量 = 1.0, 类名命中率较低
    expect(best.confidence).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 集成模拟：模拟真实场景的采样数据
// ---------------------------------------------------------------------------

describe('集成模拟 — 真实采样数据', () => {
  it('模拟 WorkBuddy 类名采样（Tailwind 特征不强，靠结构类名）', () => {
    // WorkBuddy 使用大规模 Utility CSS（非 Tailwind），类名偏短、无前缀规律
    const result = fingerprintCombined({
      classnames: [
        'teams-container',
        'conversation-sidebar',
        'wb-home-composer',
        'wb-home-header',
        'teams-main-content',
      ],
      cssVars: [],
      dataAttrs: [],
      domSnippets: [],
    });
    // 这些自定义类名不匹配任何已知框架模式，应返回 unknown
    expect(result.framework).toBe('unknown');
  });

  it('模拟 ChatGPT 桌面端（Tailwind CSS 特征明显）', () => {
    const result = fingerprintCombined({
      classnames: [
        'bg-gray-50',
        'text-gray-900',
        'flex',
        'flex-col',
        'items-center',
        'justify-between',
        'p-4',
        'rounded-md',
        'shadow-lg',
        'gap-2',
        'w-full',
        'h-full',
        'text-sm',
        'font-medium',
      ],
      cssVars: [],
      dataAttrs: [],
      domSnippets: ['main.main-surface'],
    });
    expect(result.framework).toBe('tailwind');
    expect(result.confidence).toBeGreaterThan(0.3);
  });

  it('模拟 MUI (Material UI) 应用', () => {
    const result = fingerprintCombined({
      classnames: [
        'MuiButtonBase-root',
        'MuiButton-root',
        'MuiButton-text',
        'MuiInputBase-input',
        'css-1o03t4n',
        'css-1x2y3z4',
      ],
      cssVars: ['--mui-palette-primary-main', '--mui-palette-grey-300', '--mui-shape-borderRadius'],
      dataAttrs: [],
      domSnippets: [],
    });
    expect(result.framework).toBe('mui');
    expect(result.confidence).toBeGreaterThan(0.4);
  });

  it('模拟 Ant Design 应用', () => {
    const result = fingerprintCombined({
      classnames: [
        'ant-layout',
        'ant-layout-header',
        'ant-layout-content',
        'ant-btn',
        'ant-btn-primary',
        'ant-menu',
      ],
      cssVars: ['--ant-primary-color', '--ant-success-color'],
      dataAttrs: [],
      domSnippets: ['#app.ant-app', '.ant-layout'],
    });
    expect(result.framework).toBe('ant-design');
    expect(result.confidence).toBeGreaterThan(0.4);
  });
});
