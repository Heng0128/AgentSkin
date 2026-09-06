// SPDX-License-Identifier: MPL-2.0

/**
 * # readability-mask
 *
 * 阅读遮罩算法 —— 根据背景色、文字色和照片明暗度动态计算遮罩样式，
 * 提升复杂背景上的文字可读性。灵感来自 LingGlow 的连续阅读遮罩设计。
 *
 * ## 算法概述
 *
 * 1. 解析背景色与文字色为 RGB。
 * 2. 使用相对亮度公式（Rec. 609：L = 0.299R + 0.587G + 0.114B）计算亮度。
 * 3. 计算背景与文字的 WCAG 对比度。
 * 4. 对比度 >= 4.5（WCAG AA）时无需遮罩；否则根据照片明暗度与对比度缺口
 *    计算遮罩参数。
 * 5. 暗色背景 + 亮色文字 → 深色遮罩；亮色背景 + 暗色文字 → 浅色遮罩。
 *
 * ## 与现有模块的关系
 *
 * - `profile/color-quantize.ts`：提供 `parseColor` / `relativeLuminance` /
 *   `wcagContrast` 等底层颜色工具。本模块复用其解析与对比度基础设施，
 *   并在此基础上增加 HSL 解析与遮罩参数计算。
 * - `cdp/wallpaper/css-render.ts`：壁纸 CSS 渲染器，本模块的输出可直接
 *   注入到该渲染管线中。
 *
 * @packageDocumentation
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 阅读遮罩算法的输入参数。 */
export interface ReadabilityInput {
  /** 背景色（HEX / RGB / HSL 格式）。 */
  backgroundColor: string;
  /** 文字色（HEX / RGB / HSL 格式）。 */
  textColor: string;
  /** 照片明暗度（0-1，0 = 最暗，1 = 最亮）。 */
  imageLuminance: number;
  /** 遮罩强度（0-1），省略时自动计算。 */
  maskStrength?: number;
}

/** 计算得到的遮罩样式。 */
export interface ReadabilityMask {
  /** 遮罩背景色（HEX 格式）。 */
  backgroundColor: string;
  /** 遮罩透明度（0-1）。 */
  opacity: number;
  /** 可选的 backdrop-filter 值。 */
  backdropFilter?: string;
  /** 圆角。 */
  borderRadius?: string;
}

/** RGB 颜色通道。 */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// 颜色解析
// ---------------------------------------------------------------------------

/**
 * 解析 CSS 颜色字符串为 RGB。支持：
 *   - `#rgb` / `#rrggbb`
 *   - `rgb(r,g,b)` / `rgba(r,g,b,a)`
 *   - `hsl(h,s%,l%)` / `hsla(h,s%,l%,a)`
 *
 * 无法解析时返回 null。
 */
export function parseColor(color: string): Rgb | null {
  if (!color) return null;
  const s = color.trim();

  // HEX
  if (s.startsWith('#')) {
    return parseHex(s);
  }

  // rgb() / rgba()
  if (s.startsWith('rgb')) {
    return parseRgb(s);
  }

  // hsl() / hsla()
  if (s.startsWith('hsl')) {
    return parseHsl(s);
  }

  return null;
}

function parseHex(s: string): Rgb | null {
  const hex = s.slice(1);
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  return null;
}

function parseRgb(s: string): Rgb | null {
  const m = s.match(
    /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
  );
  if (!m) return null;
  return {
    r: clampByte(Number.parseFloat(m[1])),
    g: clampByte(Number.parseFloat(m[2])),
    b: clampByte(Number.parseFloat(m[3])),
  };
}

function parseHsl(s: string): Rgb | null {
  const m = s.match(
    /^hsla?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)%\s*[, ]\s*([\d.]+)%\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
  );
  if (!m) return null;
  const h = Number.parseFloat(m[1]) % 360;
  const sPct = Number.parseFloat(m[2]) / 100;
  const lPct = Number.parseFloat(m[3]) / 100;
  return hslToRgb(h < 0 ? h + 360 : h, sPct, lPct);
}

/**
 * HSL → RGB 转换。
 * @param h 色相 [0, 360)
 * @param s 饱和度 [0, 1]
 * @param l 亮度 [0, 1]
 */
export function hslToRgb(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  return {
    r: clampByte(Math.round((r + m) * 255)),
    g: clampByte(Math.round((g + m) * 255)),
    b: clampByte(Math.round((b + m) * 255)),
  };
}

function clampByte(v: number): number {
  return Math.min(255, Math.max(0, Math.round(v)));
}

// ---------------------------------------------------------------------------
// 亮度与对比度
// ---------------------------------------------------------------------------

/**
 * 计算相对亮度（Rec. 609 加权，归一化到 0-1）。
 *
 * 使用 L = 0.299R + 0.587G + 0.114B 公式，与 LingGlow 阅读遮罩的
 * 亮度计算口径一致。
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/**
 * 计算两个亮度值之间的 WCAG 2.1 对比度比（1-21）。
 *
 * @param lum1 亮度 1（0-1）
 * @param lum2 亮度 2（0-1）
 */
export function contrastRatio(lum1: number, lum2: number): number {
  const [hi, lo] = lum1 >= lum2 ? [lum1, lum2] : [lum2, lum1];
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// 遮罩计算
// ---------------------------------------------------------------------------

/** WCAG AA 对比度阈值。 */
const WCAG_AA = 4.5;

/** 最大遮罩透明度。 */
const MAX_MASK_OPACITY = 0.85;

/** 最小遮罩透明度（低于此值视为无需遮罩）。 */
const MIN_MASK_OPACITY = 0.05;

/**
 * 根据背景色、文字色和照片明暗度计算阅读遮罩样式。
 *
 * 算法逻辑：
 * 1. 解析颜色并计算亮度与对比度。
 * 2. 对比度 >= WCAG AA 且未指定 maskStrength → 返回透明遮罩。
 * 3. 否则根据对比度缺口计算基础遮罩强度，再由 imageLuminance 调整：
 *    - 照片越亮 → 遮罩越强（亮背景更容易干扰文字）。
 *    - 照片越暗 → 遮罩越弱。
 * 4. 遮罩颜色与文字色相反：亮色文字 → 深色遮罩；暗色文字 → 浅色遮罩。
 */
export function calculateReadabilityMask(input: ReadabilityInput): ReadabilityMask {
  const { backgroundColor, textColor, imageLuminance } = input;

  const bg = parseColor(backgroundColor);
  const txt = parseColor(textColor);

  if (!bg || !txt) {
    // 颜色解析失败 → 返回安全默认值（半透明深色遮罩）。
    return {
      backgroundColor: '#000000',
      opacity: 0.5,
      borderRadius: '4px',
    };
  }

  const bgLum = relativeLuminance(bg.r, bg.g, bg.b);
  const txtLum = relativeLuminance(txt.r, txt.g, txt.b);
  const contrast = contrastRatio(bgLum, txtLum);

  // 高对比度且未指定强度 → 无需遮罩。
  if (contrast >= WCAG_AA && input.maskStrength === undefined) {
    return {
      backgroundColor: 'transparent',
      opacity: 0,
      borderRadius: '0px',
    };
  }

  // 计算遮罩透明度。
  let opacity: number;
  if (input.maskStrength !== undefined) {
    opacity = clamp(input.maskStrength, 0, 1);
  } else {
    // 对比度缺口越大 → 遮罩越强。
    const deficit = Math.max(0, WCAG_AA - contrast) / WCAG_AA;
    opacity = clamp(deficit * 0.7, 0, MAX_MASK_OPACITY);
  }

  // 照片明暗度调整：亮照片增强遮罩，暗照片减弱遮罩。
  // 系数范围 0.5-1.5：imageLuminance = 0 → 0.5；imageLuminance = 1 → 1.5。
  if (input.maskStrength === undefined) {
    const luminanceFactor = 0.5 + imageLuminance;
    opacity = clamp(opacity * luminanceFactor, 0, MAX_MASK_OPACITY);
  }

  // 低于最小阈值 → 无需遮罩。
  if (opacity < MIN_MASK_OPACITY) {
    return {
      backgroundColor: 'transparent',
      opacity: 0,
      borderRadius: '0px',
    };
  }

  // 遮罩颜色：与文字色相反。
  const isLightText = txtLum > 0.5;
  const maskRgb = isLightText ? darkenForMask(bg, opacity) : lightenForMask(bg, opacity);

  const maskHex = rgbToHex(maskRgb.r, maskRgb.g, maskRgb.b);

  // 强遮罩时添加轻微模糊以提升可读性。
  const backdropFilter = opacity > 0.4 ? 'blur(2px) saturate(1.2)' : undefined;

  return {
    backgroundColor: maskHex,
    opacity: round2(opacity),
    backdropFilter,
    borderRadius: '4px',
  };
}

/**
 * 生成 CSS 自定义属性（CSS variables）形式的遮罩样式。
 *
 * 输出可直接用于 `:root` 或容器元素的 style 属性。
 */
export function generateCSSVariables(mask: ReadabilityMask): Record<string, string> {
  const vars: Record<string, string> = {
    '--agentskin-mask-bg': mask.backgroundColor,
    '--agentskin-mask-opacity': String(mask.opacity),
  };
  if (mask.backdropFilter) {
    vars['--agentskin-mask-backdrop'] = mask.backdropFilter;
  }
  if (mask.borderRadius) {
    vars['--agentskin-mask-radius'] = mask.borderRadius;
  }
  return vars;
}

// ---------------------------------------------------------------------------
// 内部辅助
// ---------------------------------------------------------------------------

/**
 * 生成深色遮罩色：将背景色向黑色方向混合。
 * 用于亮色文字场景。
 */
function darkenForMask(bg: Rgb, factor: number): Rgb {
  // 混合系数：factor 越高 → 越接近纯黑。
  const t = Math.min(1, factor * 1.2);
  return {
    r: clampByte(bg.r * (1 - t)),
    g: clampByte(bg.g * (1 - t)),
    b: clampByte(bg.b * (1 - t)),
  };
}

/**
 * 生成浅色遮罩色：将背景色向白色方向混合。
 * 用于暗色文字场景。
 */
function lightenForMask(bg: Rgb, factor: number): Rgb {
  const t = Math.min(1, factor * 1.2);
  return {
    r: clampByte(bg.r + (255 - bg.r) * t),
    g: clampByte(bg.g + (255 - bg.g) * t),
    b: clampByte(bg.b + (255 - bg.b) * t),
  };
}

/** RGB → HEX。 */
export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
}

/** 数值钳制。 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 保留两位小数。 */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
