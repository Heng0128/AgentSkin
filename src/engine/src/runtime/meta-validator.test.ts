// SPDX-License-Identifier: MPL-2.0

/**
 * meta-validator.mjs 单测（Layer4 元模型自校验探针）
 *
 * 纯逻辑：颜色亮度解析 + landmark 采样模式判定 + 元模型校验（pass/warn/fail）。不触达 CDP/DOM。
 */

import { describe, expect, it } from 'vitest';
import { colorLuminance, inferModeFromLandmarkColors, validateMeta } from './meta-validator.mjs';

describe('colorLuminance —— 颜色亮度解析', () => {
  it('rgb 白 → 255', () => {
    expect(colorLuminance('rgb(255, 255, 255)')).toBe(255);
  });

  it('rgb 黑 → 0', () => {
    expect(colorLuminance('rgb(0, 0, 0)')).toBe(0);
  });

  it('rgba 全透明（alpha=0）→ null（无背景证据）', () => {
    expect(colorLuminance('rgba(0, 0, 0, 0)')).toBeNull();
  });

  it('rgba 半透明仍按色值计算', () => {
    expect(colorLuminance('rgba(255, 255, 255, 0.5)')).toBe(255);
  });

  it('#ffffff → 255', () => {
    expect(colorLuminance('#ffffff')).toBe(255);
  });

  it('#000 → 0（3 位缩写）', () => {
    expect(colorLuminance('#000')).toBe(0);
  });

  it('color(srgb ...) 现代格式 → null（暂不支持，降级跳过）', () => {
    expect(colorLuminance('color(srgb 0.25 0.15 0.22 / 0.22)')).toBeNull();
  });

  it('空值/非法值 → null', () => {
    expect(colorLuminance(null)).toBeNull();
    expect(colorLuminance(undefined)).toBeNull();
    expect(colorLuminance('not-a-color')).toBeNull();
  });
});

describe('inferModeFromLandmarkColors —— landmark 采样模式判定', () => {
  it('亮底黑字 → light', () => {
    expect(inferModeFromLandmarkColors([{ backgroundColor: 'rgb(255,255,255)', color: 'rgb(0,0,0)' }])).toBe('light');
  });

  it('暗底白字 → dark', () => {
    expect(inferModeFromLandmarkColors([{ backgroundColor: 'rgb(10,10,10)', color: 'rgb(255,255,255)' }])).toBe('dark');
  });

  it('透明底 + 亮字 → dark（透明背景不产生证据）', () => {
    expect(inferModeFromLandmarkColors([{ backgroundColor: 'rgba(0,0,0,0)', color: 'rgb(232,222,228)' }])).toBe('dark');
  });

  it('背景与文字信号冲突 → unknown', () => {
    expect(inferModeFromLandmarkColors([{ backgroundColor: 'rgb(255,255,255)', color: 'rgb(255,255,255)' }])).toBe('unknown');
  });

  it('空采样 → unknown', () => {
    expect(inferModeFromLandmarkColors([])).toBe('unknown');
  });

  it('多个采样取多数（暗色背景主导）', () => {
    const samples = [
      { backgroundColor: 'rgb(10,10,10)', color: 'rgb(255,255,255)' },
      { backgroundColor: 'rgb(20,20,20)', color: 'rgb(240,240,240)' },
      { backgroundColor: 'rgb(255,255,255)', color: 'rgb(0,0,0)' }, // 少数亮色
    ];
    expect(inferModeFromLandmarkColors(samples)).toBe('dark');
  });
});

describe('validateMeta —— 元模型自校验', () => {
  const metaDark = { currentNativeMode: 'dark', canSilentSwitch: false, adoptedStyleSheetDetected: true };

  it('声称 dark 且 landmark 实为 dark → pass', () => {
    const rt = {
      styleAst: { adoptedSheets: 1 },
      landmarkColors: [{ backgroundColor: 'rgb(10,10,10)', color: 'rgb(255,255,255)' }],
    };
    const result = validateMeta(metaDark, rt);
    expect(result.status).toBe('pass');
  });

  it('声称 dark 但 landmark 实为 light → fail（强制降级）', () => {
    const rt = {
      styleAst: { adoptedSheets: 1 },
      landmarkColors: [{ backgroundColor: 'rgb(255,255,255)', color: 'rgb(0,0,0)' }],
    };
    const result = validateMeta(metaDark, rt);
    expect(result.status).toBe('fail');
    expect(result.summary).toContain('禁止静默切换');
  });

  it('无 landmark 采样 → warn（无法校验）', () => {
    const rt = { styleAst: { adoptedSheets: 1 }, landmarkColors: [] };
    const result = validateMeta(metaDark, rt);
    expect(result.status).toBe('warn');
  });

  it('adoptedStyleSheetDetected=true 但运行时无构造样式表 → fail', () => {
    const rt = {
      styleAst: { adoptedSheets: 0 },
      landmarkColors: [{ backgroundColor: 'rgb(10,10,10)', color: 'rgb(255,255,255)' }],
    };
    const result = validateMeta(metaDark, rt);
    expect(result.status).toBe('fail');
    expect(result.checks.find((c) => c.check === 'adoptedStyleSheetDetected').pass).toBe(false);
  });

  it('canSilentSwitch=true 但无 globalApi 探测数据 → warn', () => {
    const meta = { currentNativeMode: 'dark', canSilentSwitch: true, adoptedStyleSheetDetected: false };
    const rt = {
      styleAst: { adoptedSheets: 0 },
      landmarkColors: [{ backgroundColor: 'rgb(10,10,10)', color: 'rgb(255,255,255)' }],
    };
    const result = validateMeta(meta, rt);
    expect(result.status).toBe('warn');
    expect(result.checks.some((c) => c.check === 'canSilentSwitch')).toBe(true);
  });

  it('无任何可校验字段 → pass（空校验 = 无矛盾发现）', () => {
    const meta = { currentNativeMode: 'unknown', canSilentSwitch: false, adoptedStyleSheetDetected: false };
    expect(validateMeta(meta, {}).status).toBe('pass');
  });
});
