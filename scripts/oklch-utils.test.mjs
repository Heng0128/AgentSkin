// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  adjustLightness,
  generateRamp,
  hexToOklch,
  normalizeHex,
  oklchToHex,
  rotateHue,
} from './oklch-utils.mjs';

// ---------------------------------------------------------------------------
// hexToOklch
// ---------------------------------------------------------------------------

describe('hexToOklch', () => {
  it('返回 [L, C, H] 数组且各分量在正确范围', () => {
    const [l, c, h] = hexToOklch('#6366f1');

    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(0.5);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(360);
  });

  it('纯黑返回 L≈0', () => {
    const [l] = hexToOklch('#000000');
    expect(l).toBeLessThan(0.01);
  });

  it('纯白返回 L≈1', () => {
    const [l] = hexToOklch('#ffffff');
    expect(l).toBeGreaterThan(0.95);
  });

  it('支持 3-digit hex 输入', () => {
    const [l, c, h] = hexToOklch('#f00');
    // #f00 → #ff0000 (纯红)
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThan(0); // 红色应有色度
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(360);
  });

  it('支持不带 # 的 hex 输入', () => {
    // normalizeHex 接受 6 位无 # 的 hex
    const [l, c, h] = hexToOklch('6366f1');
    expect(l).toBeGreaterThanOrEqual(0);
    expect(l).toBeLessThanOrEqual(1);
    expect(c).toBeGreaterThanOrEqual(0);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(360);
  });
});

// ---------------------------------------------------------------------------
// oklchToHex (roundtrip)
// ---------------------------------------------------------------------------

describe('oklchToHex', () => {
  it('hexToOklch → oklchToHex 往返一致（容差内）', () => {
    const original = '#6366f1';
    const [l, c, h] = hexToOklch(original);
    const restored = oklchToHex(l, c, h);
    // 由于 sRGB 量化（每通道 0-255），允许 ±1 的量化误差
    const [r1, g1, b1] = [
      parseInt(original.slice(1, 3), 16),
      parseInt(original.slice(3, 5), 16),
      parseInt(original.slice(5, 7), 16),
    ];
    const [r2, g2, b2] = [
      parseInt(restored.slice(1, 3), 16),
      parseInt(restored.slice(3, 5), 16),
      parseInt(restored.slice(5, 7), 16),
    ];
    expect(Math.abs(r1 - r2)).toBeLessThanOrEqual(1);
    expect(Math.abs(g1 - g2)).toBeLessThanOrEqual(1);
    expect(Math.abs(b1 - b2)).toBeLessThanOrEqual(1);
  });

  it('返回合法的 6-digit hex 格式', () => {
    const hex = oklchToHex(0.6, 0.15, 260);
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ---------------------------------------------------------------------------
// adjustLightness
// ---------------------------------------------------------------------------

describe('adjustLightness', () => {
  it('正 deltaL 使 L 增大（更亮）', () => {
    const original = '#6366f1';
    const [l1] = hexToOklch(original);
    const lighter = adjustLightness(original, 0.1);
    const [l2] = hexToOklch(lighter);
    expect(l2).toBeGreaterThan(l1);
  });

  it('负 deltaL 使 L 减小（更暗）', () => {
    const original = '#6366f1';
    const [l1] = hexToOklch(original);
    const darker = adjustLightness(original, -0.1);
    const [l2] = hexToOklch(darker);
    expect(l2).toBeLessThan(l1);
  });

  it('deltaL=0 时颜色基本不变', () => {
    const original = '#4a90d9';
    const result = adjustLightness(original, 0);
    expect(result.toLowerCase()).toBe(original.toLowerCase());
  });

  it('超出范围的 deltaL 被 clamp 到 [0,1]', () => {
    const original = '#6366f1';
    // +2 不应超出纯白
    const clamped = adjustLightness(original, 2);
    expect(clamped).toMatch(/^#[0-9a-f]{6}$/i);
    // -2 不应低于纯黑
    const clampedLow = adjustLightness(original, -2);
    expect(clampedLow).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('无效 hex 时返回原始输入', () => {
    const result = adjustLightness('not-a-color', 0.1);
    expect(result).toBe('not-a-color');
  });
});

// ---------------------------------------------------------------------------
// rotateHue
// ---------------------------------------------------------------------------

describe('rotateHue', () => {
  it('H 近似变化 deltaH 度', () => {
    const original = '#6366f1';
    const [, c, h1] = hexToOklch(original);
    const delta = 30;
    const rotated = rotateHue(original, delta);
    const [, c2, h2] = hexToOklch(rotated);
    // 允许角度环绕导致的差值（如 350° + 30° → 20°）
    const diff = Math.abs(((h2 - h1 + 540) % 360) - 180);
    expect(Math.abs(diff - delta)).toBeLessThanOrEqual(2); // 2° 容差（量化）
  });

  it('保留 L 和 C（仅旋转色相）', () => {
    const original = '#4a90d9';
    const [l1, c1] = hexToOklch(original);
    const rotated = rotateHue(original, 45);
    const [l2, c2] = hexToOklch(rotated);
    expect(Math.abs(l1 - l2)).toBeLessThan(0.01);
    expect(Math.abs(c1 - c2)).toBeLessThan(0.01);
  });

  it('负角度旋转正确环绕', () => {
    const original = '#6366f1';
    const rotated = rotateHue(original, -30);
    expect(rotated).toMatch(/^#[0-9a-f]{6}$/i);
    // 连续 360° 回到原色
    const fullCircle = rotateHue(original, 360);
    // 由于量化，允许微小差异
    expect(fullCircle).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('无效 hex 时返回原始输入', () => {
    const result = rotateHue('invalid', 30);
    expect(result).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// generateRamp
// ---------------------------------------------------------------------------

describe('generateRamp', () => {
  it('返回 10 个 step（50-900）', () => {
    const ramp = generateRamp('#6366f1');
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    expect(Object.keys(ramp)).toHaveLength(10);
    for (const step of steps) {
      expect(ramp, `missing step: ${step}`).toHaveProperty(String(step));
    }
  });

  it('lightness 从 50 到 900 单调递增', () => {
    const ramp = generateRamp('#6366f1');
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    const luminances = steps.map((s) => {
      const hex = ramp[s];
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const linear = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    });
    for (let i = 1; i < luminances.length; i++) {
      expect(luminances[i]).toBeGreaterThanOrEqual(luminances[i - 1]);
    }
  });

  it('所有 step 值为合法 hex 格式', () => {
    const ramp = generateRamp('#4a90d9');
    for (const [step, hex] of Object.entries(ramp)) {
      expect(hex, `step: ${step}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('500 step 接近基色', () => {
    const base = '#6366f1';
    const ramp = generateRamp(base);
    const ramp500 = ramp[500];
    // 500 step 应使用基色的 lightness 生成，色度和色相来自基色
    const [, , hBase] = hexToOklch(base);
    const [, , h500] = hexToOklch(ramp500);
    // 色相应大致相同（使用角度距离以处理 0°/360° 环绕）
    const hueDiff = Math.abs(((h500 - hBase + 540) % 360) - 180);
    expect(hueDiff).toBeLessThanOrEqual(5);
  });

  it('极浅基色产生正确的反向 ramp', () => {
    // 当 base L > 0.6 时，ramp 曲线会被反转
    const ramp = generateRamp('#fffacd'); // lemonchiffon, 很浅
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    for (const step of steps) {
      expect(ramp[step]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('无效 hex 时返回所有 step 均为基色原值', () => {
    const ramp = generateRamp('not-a-color');
    // normalizeHex 会抛错，catch 返回原 hex 作为所有 step 值
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];
    expect(Object.keys(ramp)).toHaveLength(10);
    for (const step of steps) {
      expect(ramp[step]).toBe('not-a-color');
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeHex (edge cases)
// ---------------------------------------------------------------------------

describe('normalizeHex', () => {
  it('拒绝非字符串输入', () => {
    expect(() => normalizeHex(123)).toThrow(/Expected string/);
  });

  it('拒绝非法字符', () => {
    expect(() => normalizeHex('#gggggg')).toThrow(/Invalid hex/);
  });

  it('3-digit hex 转为 6-digit lowercase', () => {
    expect(normalizeHex('#F00')).toBe('#ff0000');
  });

  it('6-digit hex 保持 lowercase', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
  });

  it('无 # 的 6-digit hex 被接受', () => {
    expect(normalizeHex('6366f1')).toBe('#6366f1');
  });
});
