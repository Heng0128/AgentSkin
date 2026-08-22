// SPDX-License-Identifier: MPL-2.0

/**
 * # color-quantize
 *
 * 纯 TS 颜色量化基建（中轴阶段 1「探针量化」的可复用底层）。零运行时依赖，
 * 全部函数纯函数、无 I/O，方便单测。用途：
 *
 *   - 解析 computed backgroundColor / color / border 等字符串（hex、rgb、
 *     rgba、named、transparent）为结构化 RGB + alpha。
 *   - 感知亮度（Rec. 709）与 WCAG 对比度（阶段 4 对比度仪表的基础）。
 *   - 颜色聚类（median-cut 降采样，阶段 1 palette 归类 / 阶段 5 阈值调参的
 *     输入），以及 alpha 的严格解析（与 theme-health-check 的 parseBgAlpha
 *     语义对齐，但这里直接返回 {r,g,b,a} 元组）。
 */

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0-1，不透明 = 1。 */
  a: number;
}

/**
 * 把 CSS 颜色字符串解析为 {r,g,b,a}。支持：
 *   - #rgb / #rrggbb / #rgba / #rrggbbaa
 *   - rgb(r,g,b) / rgba(r,g,b,a)（整数或小数，空格/逗号分隔）
 *   - 常见 named 颜色（subset）与 `transparent` / `none`
 *   - color-mix() / var() 等无法静态解析的 → null（调用方自行降级）
 */
export function parseColor(input: string | undefined): Rgba | null {
  if (!input) return null;
  const s = input.trim();
  if (s === 'transparent' || s === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-f]{3}$/i.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    // 4-digit hex (#RGBA)
    if (/^[0-9a-f]{4}$/i.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: Math.round((parseInt(hex[3] + hex[3], 16) / 255) * 100) / 100,
      };
    }
    if (/^[0-9a-f]{6}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{8}$/i.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: Math.round((parseInt(hex.slice(6, 8), 16) / 255) * 100) / 100,
      };
    }
    return null;
  }
  const rgb = s.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
  );
  if (rgb) {
    const aRaw = rgb[4];
    let a = 1;
    if (aRaw !== undefined) {
      a = aRaw.endsWith('%') ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
    }
    return {
      r: clampByte(parseFloat(rgb[1])),
      g: clampByte(parseFloat(rgb[2])),
      b: clampByte(parseFloat(rgb[3])),
      a: Math.min(1, Math.max(0, a)),
    };
  }
  const named = NAMED_COLORS[s.toLowerCase()];
  return named ? { ...named, a: 1 } : null;
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

/** 常用 named 颜色 subset（足够覆盖 computed style 的实际输出）。 */
const NAMED_COLORS: Record<string, { r: number; g: number; b: number }> = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 },
  red: { r: 255, g: 0, b: 0 },
  green: { r: 0, g: 128, b: 0 },
  blue: { r: 0, g: 0, b: 255 },
  yellow: { r: 255, g: 255, b: 0 },
  cyan: { r: 0, g: 255, b: 255 },
  magenta: { r: 255, g: 0, b: 255 },
  gray: { r: 128, g: 128, b: 128 },
  grey: { r: 128, g: 128, b: 128 },
  lightgray: { r: 211, g: 211, b: 211 },
  darkgray: { r: 169, g: 169, b: 169 },
  silver: { r: 192, g: 192, b: 192 },
  transparent: { r: 0, g: 0, b: 0 },
};

// ---------------------------------------------------------------------------
// 感知指标
// ---------------------------------------------------------------------------

/**
 * 感知亮度（Rec. 709 加权，0-255）。与 `src/main/theme/utils.ts` 的
 * `inferModeFromColors` 使用同一套权重，避免两处口径不一致。
 */
export function luminanceOf(c: Rgba): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

/** sRGB 线性化（WCAG 2.1 相对亮度用）。 */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 相对亮度（0-1）。 */
export function relativeLuminance(c: Rgba): number {
  return 0.2126 * linearize(c.r) + 0.7152 * linearize(c.g) + 0.0722 * linearize(c.b);
}

/**
 * WCAG 2.1 对比度比（1-21）。`a` 为前景，`b` 为背景。
 * 注意：这里假设两者均不透明；带 alpha 的调用方需先合成（见 blendOver）。
 */
export function wcagContrast(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** 把前景 `fg` 按 alpha 合成到不透明背景 `bg` 上，返回不透明结果色。 */
export function blendOver(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  if (a >= 1) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
  if (a <= 0) return { r: bg.r, g: bg.g, b: bg.b, a: 1 };
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

// ---------------------------------------------------------------------------
// 聚类（median-cut 降采样，阶段 1 palette 归类）
// ---------------------------------------------------------------------------

/**
 * 对一组颜色做 median-cut 聚类。每次在 RGB 通道中取跨度最大者从中位数劈开，
 * 直到目标桶数；每桶取算术平均色 + 桶内样本数。输入颜色按出现频次加权
 * （`samples` 传出现次数，避免平铺）。
 */
export function medianCut(
  colors: Array<{ r: number; g: number; b: number; weight?: number }>,
  bucketCount: number,
): Array<{ color: { r: number; g: number; b: number }; weight: number }> {
  if (colors.length === 0) return [];
  const target = Math.max(1, Math.min(bucketCount, colors.length));
  const buckets = [colors];
  while (buckets.length < target) {
    // 选可劈（长度 ≥2）且跨度最大的桶；否则停止（避免产生空桶）。
    let splitIdx = -1;
    let splitRange = -1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i].length < 2) continue;
      const range = channelRange(buckets[i]);
      if (range > splitRange) {
        splitRange = range;
        splitIdx = i;
      }
    }
    if (splitIdx === -1 || splitRange < 0.001) break; // 纯色/不可劈
    const bucket = buckets[splitIdx];
    const channel = widestChannel(bucket);
    bucket.sort((x, y) => x[channel] - y[channel]);
    // 保证两半各 ≥1 个元素 —— 空桶会让平均色变 null（加权亮度 NaN）。
    const mid = Math.max(1, Math.min(bucket.length - 1, Math.floor(bucket.length / 2)));
    buckets.splice(splitIdx, 1, bucket.slice(0, mid), bucket.slice(mid));
  }
  return buckets.map((bucket) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let w = 0;
    for (const c of bucket) {
      const weight = c.weight ?? 1;
      r += c.r * weight;
      g += c.g * weight;
      b += c.b * weight;
      w += weight;
    }
    return {
      color:
        w > 0
          ? { r: Math.round(r / w), g: Math.round(g / w), b: Math.round(b / w) }
          : { r: 0, g: 0, b: 0 },
      weight: w,
    };
  });
}

function channelRange(colors: Array<{ r: number; g: number; b: number }>): number {
  let min = 255;
  let max = 0;
  for (const c of colors) {
    min = Math.min(min, c.r, c.g, c.b);
    max = Math.max(max, c.r, c.g, c.b);
  }
  return max - min;
}

function widestChannel(colors: Array<{ r: number; g: number; b: number }>): 'r' | 'g' | 'b' {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const c of colors) {
    minR = Math.min(minR, c.r);
    maxR = Math.max(maxR, c.r);
    minG = Math.min(minG, c.g);
    maxG = Math.max(maxG, c.g);
    minB = Math.min(minB, c.b);
    maxB = Math.max(maxB, c.b);
  }
  const rRange = maxR - minR;
  const gRange = maxG - minG;
  const bRange = maxB - minB;
  if (rRange >= gRange && rRange >= bRange) return 'r';
  if (gRange >= bRange) return 'g';
  return 'b';
}

/** 把颜色格式化为 #rrggbb（用于台账/档案序列化）。 */
export function toHex(c: { r: number; g: number; b: number }): string {
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/**
 * 背景 alpha 判定分级（与 B1 的 parseBgAlpha 语义对齐，供分类器复用）：
 *   - <0.05   → 'transparent'（视同无底色）
 *   - <0.5    → 'translucent'（半透明，毛玻璃候选）
 *   - 否则     → 'opaque'（不透明，遮挡候选）
 */
export function classifyAlpha(a: number): 'transparent' | 'translucent' | 'opaque' {
  if (a < 0.05) return 'transparent';
  if (a <= 0.5) return 'translucent';
  return 'opaque';
}
