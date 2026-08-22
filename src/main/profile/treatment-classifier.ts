// SPDX-License-Identifier: MPL-2.0

/**
 * # treatment-classifier — 处置分类器（中轴阶段 2）
 *
 * 对每个组件档案输出**处置 + 依据**（而非只给结论），取代
 * `src/main/cdp/wallpaper/shared.ts` 中"只看几何尺寸打全透明"的 punch-through
 * 判定（GOV-4 的解）。四档处置全部**属性驱动**，不依赖类名：
 *
 *   | 处置 | 含义 | 判据（阈值驱动打分） |
 *   |------|------|----------------------|
 *   | remove      | 不应渲染，打掉 | 面积≥80%、不透明底色、无文本/可交互后代、层级最深 |
 *   | transparentize | 背景直接打掉（纯布局壳/背景层） | 面积达标、有底色、**且不含可读文本** |
 *   | frost       | 毛玻璃（半透明 surface + blur 透壁纸） | 面积达标、有底色、**且承载可读文本/控件**（含中央对话区） |
 *   | keep        | 不动 | 小面积、纯文本/可交互叶子、前景色、已有 backdrop-filter |
 *
 * **文字可读性保护（硬约束）**：凡判据命中"承载文本"，一律不得全透明，
 * 改施毛玻璃。毛玻璃基线取既有偏好：surface 65% 不透明度 + blur 20px；
 * 若文字与有效背景（壁纸经 surface+blur 合成）的 WCAG 对比度不达标，
 * 自动加深 surface 不透明度直至达标（最高 92%）。
 *
 * 输出 `{ treatment, confidence, evidence }`，evidence 供阶段 4 展示、
 * 阶段 5 调阈值。分类器是纯函数：输入 ComponentProfile[] → 输出
 * TreatmentVerdict[]。
 */

import { blendOver, classifyAlpha, type Rgba, wcagContrast } from './color-quantize';
import type { ComponentProfile } from './native-profile';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type Treatment = 'remove' | 'transparentize' | 'frost' | 'keep';

export interface TreatmentEvidence {
  areaRatio: number;
  hasBg: boolean;
  hasText: boolean;
  hasInteractive: boolean;
  depth: number;
  bgAlpha: number;
  /** 毛玻璃参数（frost 时给出；transparentize/remove 为 null）。 */
  frost?: { opacity: number; blurPx: number };
  /** 不达标时由对比度守门加深后的不透明度（frost 时）。 */
  opacityAfterContrastGate?: number;
  /** WCAG 对比度（文字 vs 合成背景，frost 时给出）。 */
  contrastRatio?: number;
  contrastPass?: boolean;
  /** 判定命中的规则名，供审查面板显示依据。 */
  rule: string;
  /** 实际的 surface 色（用于 CSS 生成，避免硬编码白色）。 */
  surfaceColor?: { r: number; g: number; b: number };
}

export interface TreatmentVerdict {
  ref: string;
  role: ComponentProfile['role'];
  treatment: Treatment;
  confidence: number;
  evidence: TreatmentEvidence;
}

export interface ClassifyOptions {
  /** 壁纸激活时有效背景（壁纸平均色经 surface 合成后）。用于对比度守门。
   *  缺省 = 不透明纯色近似（白/黑按 scheme）。 */
  effectiveBackground?: { r: number; g: number; b: number };
  /** 毛玻璃基线不透明度（0-1，默认 0.65）。 */
  frostOpacity?: number;
  /** 毛玻璃基线模糊（px，默认 20）。 */
  frostBlurPx?: number;
  /** 对比度达标阈值（默认 4.5）。 */
  contrastThreshold?: number;
}

// ---------------------------------------------------------------------------
// 阈值常量（可被阶段 5 覆盖）
// ---------------------------------------------------------------------------

export const CLASSIFY_THRESHOLDS = {
  /** 移除：整屏品牌层/背景层（无文本、无交互、不透明）。 */
  removeAreaRatio: 0.8,
  /** 全透明/毛玻璃 的面积初筛门槛。 */
  bigAreaRatio: 0.08,
  /** 可读文本判定：子树文本长度阈值（字符）。 */
  minTextChars: 4,
  /** 可交互后代判定已存在（input/button/a/textarea…）。 */
  frostOpacityDefault: 0.65,
  frostBlurPxDefault: 20,
  contrastThresholdDefault: 4.5,
  /** 对比度守门的上限（保底可读，不无限加深）。 */
  maxFrostOpacity: 0.92,
} as const;

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

function hasReadableText(c: ComponentProfile): boolean {
  // 子树含文本节点数量/文本密度超阈值，或含可交互（输入区必然承载文本）。
  return c.hasText && subtreeTextEstimate(c) >= CLASSIFY_THRESHOLDS.minTextChars;
}

/** 从量化档案估算子树文本量：有文本标记 + 组件尺寸近似（字符数粗估）。 */
function subtreeTextEstimate(c: ComponentProfile): number {
  // 无精确文本长度时，用"含文本 + 面积"推断文本量（足够区分空壳与内容区）。
  if (!c.hasText) return 0;
  return Math.max(CLASSIFY_THRESHOLDS.minTextChars, Math.round(c.area / 4000));
}

/** 前景文字色：组件自身的 color，缺省按亮色界面近似。 */
function textColor(c: ComponentProfile, fallback: Rgba): Rgba {
  return c.quantified.color ?? fallback;
}

/**
 * 对单个组件分类。纯函数。
 */
export function classifyComponent(
  c: ComponentProfile,
  options: ClassifyOptions = {},
): TreatmentVerdict {
  const thresholds = CLASSIFY_THRESHOLDS;
  const bg = c.quantified.background;
  const bgAlpha = bg?.a ?? 0;
  const hasBg = classifyAlpha(bgAlpha) !== 'transparent';
  const hasText = hasReadableText(c);
  const hasInteractive = c.hasInteractiveDescendant;
  const { areaRatio, depth } = c;

  // ---- 移除：整屏、不透明、无文本/交互、层级最深的品牌/背景层 ----
  if (
    areaRatio >= thresholds.removeAreaRatio &&
    hasBg &&
    bgAlpha >= 0.9 &&
    !hasText &&
    !hasInteractive &&
    depth <= 1
  ) {
    return {
      ref: c.ref,
      role: c.role,
      treatment: 'remove',
      confidence: 0.9,
      evidence: {
        areaRatio,
        hasBg,
        hasText,
        hasInteractive,
        depth,
        bgAlpha,
        rule: 'fullscreen-brand-layer',
      },
    };
  }

  // ---- 面积初筛：小元素 / 叶子控件 / 前景元素不动 ----
  if (areaRatio < thresholds.bigAreaRatio || (!hasBg && !hasText)) {
    return {
      ref: c.ref,
      role: c.role,
      treatment: 'keep',
      confidence: 0.8,
      evidence: {
        areaRatio,
        hasBg,
        hasText,
        hasInteractive,
        depth,
        bgAlpha,
        rule: 'small-or-fg-leaf',
      },
    };
  }

  // ---- 已有 backdrop-filter：已是毛玻璃，视为保持 ----
  if (c.quantified.blur && c.quantified.blur > 0) {
    return {
      ref: c.ref,
      role: c.role,
      treatment: 'keep',
      confidence: 0.85,
      evidence: {
        areaRatio,
        hasBg,
        hasText,
        hasInteractive,
        depth,
        bgAlpha,
        rule: 'already-frosted',
      },
    };
  }

  // ---- 文字可读性保护（GOV-4 核心）：承载文本 → 毛玻璃，绝不全透明 ----
  if (hasText || hasInteractive) {
    return buildFrostVerdict(c, options, {
      areaRatio,
      hasBg,
      hasText,
      hasInteractive,
      depth,
      bgAlpha,
      rule: hasInteractive ? 'interactive-container' : 'text-container',
    });
  }

  // ---- 无文本的大面积背景层 → 全透明（原 punch-through 的保守化） ----
  if (hasBg) {
    return {
      ref: c.ref,
      role: c.role,
      treatment: 'transparentize',
      confidence: 0.75,
      evidence: {
        areaRatio,
        hasBg,
        hasText,
        hasInteractive,
        depth,
        bgAlpha,
        rule: 'large-plain-shell',
      },
    };
  }

  // 兜底
  return {
    ref: c.ref,
    role: c.role,
    treatment: 'keep',
    confidence: 0.5,
    evidence: {
      areaRatio,
      hasBg,
      hasText,
      hasInteractive,
      depth,
      bgAlpha,
      rule: 'fallback',
    },
  };
}

function buildFrostVerdict(
  c: ComponentProfile,
  options: ClassifyOptions,
  base: TreatmentEvidence,
): TreatmentVerdict {
  const opacity = options.frostOpacity ?? CLASSIFY_THRESHOLDS.frostOpacityDefault;
  const blurPx = options.frostBlurPx ?? CLASSIFY_THRESHOLDS.frostBlurPxDefault;
  const threshold = options.contrastThreshold ?? CLASSIFY_THRESHOLDS.contrastThresholdDefault;

  // 毛玻璃 surface = 组件自身的背景色（"surface 65% + blur"中的 surface 就是
  // agent 的表面色，暗色 agent 是深色、亮色 agent 是浅色——绝不硬编码白）。
  const surfaceBase = c.quantified.background
    ? { r: c.quantified.background.r, g: c.quantified.background.g, b: c.quantified.background.b }
    : { r: 245, g: 245, b: 245, a: 1 };
  const text = textColor(c, { r: 235, g: 235, b: 245, a: 1 });
  const wallpaperBg: Rgba = options.effectiveBackground
    ? { ...options.effectiveBackground, a: 1 }
    : { r: 24, g: 24, b: 32, a: 1 };

  const surfaceAt = (a: number) => blendOver({ ...surfaceBase, a }, wallpaperBg);
  let composed = surfaceAt(opacity);
  let ratio = wcagContrast(text, composed);
  let finalOpacity = opacity;
  let pass = ratio >= threshold;

  // 不达标 → 加深 surface 不透明度（越接近表面色 → 文字对比度回到设计值），
  // 最多到 maxFrostOpacity。
  while (!pass && finalOpacity < CLASSIFY_THRESHOLDS.maxFrostOpacity) {
    finalOpacity = Math.min(finalOpacity + 0.05, CLASSIFY_THRESHOLDS.maxFrostOpacity);
    composed = surfaceAt(finalOpacity);
    ratio = wcagContrast(text, composed);
    pass = ratio >= threshold;
  }

  return {
    ref: c.ref,
    role: c.role,
    treatment: 'frost',
    confidence: 0.85,
    evidence: {
      ...base,
      frost: { opacity: finalOpacity, blurPx },
      opacityAfterContrastGate: finalOpacity,
      contrastRatio: ratio,
      contrastPass: pass,
      rule: `${base.rule}${pass ? '' : ':contrast-gated'}`,
      surfaceColor: c.quantified.background
        ? {
            r: c.quantified.background.r,
            g: c.quantified.background.g,
            b: c.quantified.background.b,
          }
        : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// 批量分类
// ---------------------------------------------------------------------------

export interface ClassifyResult {
  verdicts: TreatmentVerdict[];
  summary: {
    remove: number;
    transparentize: number;
    frost: number;
    keep: number;
  };
}

/**
 * 对一组组件档案批量分类，返回裁定 + 汇总。
 */
export function classifyAll(
  components: ComponentProfile[],
  options: ClassifyOptions = {},
): ClassifyResult {
  const verdicts = components.map((c) => classifyComponent(c, options));
  const summary = { remove: 0, transparentize: 0, frost: 0, keep: 0 };
  for (const v of verdicts) summary[v.treatment]++;
  return { verdicts, summary };
}

/** 生成可注入的 punch-through/毛玻璃 CSS（台账回灌的产物）。 */
export function buildTreatmentCss(verdicts: TreatmentVerdict[]): string {
  const rules: string[] = [];
  for (const v of verdicts) {
    if (v.treatment === 'remove' || v.treatment === 'transparentize') {
      rules.push(`[data-as-ref="${cssEscape(v.ref)}"] { background: transparent !important; }`);
    } else if (v.treatment === 'frost' && v.evidence.frost) {
      const { opacity, blurPx } = v.evidence.frost;
      // Use actual surface color instead of hardcoded white
      const surf = v.evidence.surfaceColor;
      const rgb = surf ? `${surf.r},${surf.g},${surf.b}` : '255,255,255';
      rules.push(
        `[data-as-ref="${cssEscape(v.ref)}"] { background: rgba(${rgb},${opacity.toFixed(2)}) !important; backdrop-filter: blur(${blurPx}px) !important; }`,
      );
    }
  }
  return rules.join('\n');
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1');
}
