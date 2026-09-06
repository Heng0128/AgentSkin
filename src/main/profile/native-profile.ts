// SPDX-License-Identifier: MPL-2.0

/**
 * # native-profile — AgentNativeProfile 数据模型与提取（中轴阶段 1）
 *
 * 把 CDP 抓到的原生 DOM（`DomTreeNode`，见 `src/shared/types.ts`，来源
 * `src/main/cdp/dom-tree.ts` 的 `captureDomTree`）提炼为**持久化原生档案**：
 * 按 agent + appVersion 存档，作为主题创作参考轨、注入透明度判定的地面真相、
 * 以及版本升级漂移检测的基线。
 *
 * 本模块是纯 TS：输入 DomTreeNode + 元信息 → 输出 AgentNativeProfile，
 * 不做任何 CDP 连接（连接由调用方完成，这里只做结构化为数据）。
 *
 * 数据模型见 MATURATION-PLAN §2 阶段 1；相比方案，这里落地了可判定的
 * 组件角色（role）判定规则（面积/位置/深度启发式），供阶段 2 分类器复用。
 */

import type { DomTreeNode } from '../../shared/types';
import { classifyAlpha, luminanceOf, parseColor, type Rgba, wcagContrast } from './color-quantize';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type ComponentRole =
  | 'backdrop'
  | 'sidebar'
  | 'chatlist'
  | 'message'
  | 'composer'
  | 'codeblock'
  | 'button'
  | 'scrollbar'
  | 'other';

export interface QuantifiedStyle {
  background?: Rgba | null;
  color?: Rgba | null;
  border?: Rgba | null;
  borderRadius?: number;
  blur?: number;
  shadow?: string | null;
  font?: string | null;
}

export interface ComponentProfile {
  role: ComponentRole;
  /** 结构路径（祖先标签序列），不依赖类名 —— 台账稳定引用的基础。 */
  path: string;
  ref: string;
  boxModel: { w: number; h: number; x: number; y: number } | null;
  depth: number;
  area: number;
  areaRatio: number;
  quantified: QuantifiedStyle;
  hasText: boolean;
  hasInteractiveDescendant: boolean;
  descendantCount: number;
  zIndex: number;
}

export interface PaletteEntry {
  color: string;
  luminance: number;
  usage: number;
  role: string;
}

export interface AgentNativeProfile {
  meta: {
    agentId: string;
    appVersion: string;
    capturedAt: string;
    scheme: 'dark' | 'light' | 'auto';
    viewport: { w: number; h: number };
  };
  components: ComponentProfile[];
  palette: {
    backgrounds: PaletteEntry[];
    texts: PaletteEntry[];
    accents: PaletteEntry[];
    borders: PaletteEntry[];
  };
  metrics: {
    elevationLadder: Array<{ level: number; color: string; deltaLuminance: number }>;
    contrastPairs: Array<{ fg: string; bg: string; wcagRatio: number; pass: boolean }>;
    radiusScale: number[];
    spacingScale: number[];
    blurValues: number[];
  };
}

// ---------------------------------------------------------------------------
// 组件量化
// ---------------------------------------------------------------------------

const INTERACTIVE_TAGS = new Set(['input', 'textarea', 'button', 'a', 'select', 'option']);

function textLength(node: DomTreeNode): number {
  return (node.text ?? '').trim().length;
}

function countDescendants(node: DomTreeNode): number {
  let n = 0;
  for (const c of node.children) n += 1 + countDescendants(c);
  return n;
}

function hasInteractive(node: DomTreeNode): boolean {
  if (INTERACTIVE_TAGS.has(node.tag)) return true;
  return node.children.some(hasInteractive);
}

/** 从 DomTreeNode 的 style 提取量化样式。 */
export function quantifyStyle(node: DomTreeNode): QuantifiedStyle {
  const s = node.style ?? {};
  const radiusRaw = parseFloat(s['border-radius'] ?? '');
  // backdrop-filter 形如 blur(20px) / blur(20px) saturate(1.1) —— 提取 blur 值。
  const bf = s['backdrop-filter'] ?? s['-webkit-backdrop-filter'] ?? '';
  const blurMatch = /blur\(([\d.]+)px?\)/.exec(bf);
  return {
    background: parseColor(s['background-color']),
    color: parseColor(s.color),
    border: parseColor(s['border-color']),
    borderRadius: Number.isFinite(radiusRaw) ? radiusRaw : undefined,
    blur: blurMatch ? parseFloat(blurMatch[1]) : undefined,
    shadow: s['box-shadow'] && s['box-shadow'] !== 'none' ? s['box-shadow'] : null,
    font: s['font-family'] && s['font-family'] !== 'none' ? s['font-family'] : null,
  };
}

/**
 * 组件角色判定（面积/位置/深度启发式，属性驱动、不依赖类名）。
 * 与 MATURATION-PLAN 阶段 2 分类器的"几何初筛"共用同一套口径。
 */
export function inferRole(
  node: DomTreeNode,
  viewport: { w: number; h: number },
  depth: number,
): ComponentRole {
  const { w, h } = node.rect;
  const areaRatio = (w * h) / (viewport.w * viewport.h);
  const alpha = quantifyStyle(node).background?.a ?? 0;
  const hasBg = classifyAlpha(alpha) !== 'transparent';

  // backdrop：整屏壳且**自身**无直接文本（后代文本不算——壳必含内容区）。
  if (depth <= 1 && areaRatio >= 0.8 && textLength(node) === 0 && hasBg) return 'backdrop';
  // composer：底部输入条（宽 ≥40% 视口、高度 <40%、位于视口下半）。
  if (
    node.rect.y > viewport.h * 0.55 &&
    w >= viewport.w * 0.4 &&
    h <= viewport.h * 0.4 &&
    areaRatio >= 0.08
  ) {
    return 'composer';
  }
  // 大块内容区（含文本）→ chatlist。
  if (w >= viewport.w * 0.4 && areaRatio >= 0.3 && hasTextLike(node)) return 'chatlist';
  // 窄高列 → sidebar。
  if (w < viewport.w * 0.35 && h >= viewport.h * 0.4) return 'sidebar';
  // 小面积文本卡片 → message。
  if (areaRatio <= 0.12 && areaRatio >= 0.005 && hasTextLike(node)) return 'message';
  // 代码块：pre 标签或类名/等宽字体提示。
  if (
    node.tag === 'pre' ||
    (node.tag === 'div' && (sHas(node, 'code') || quantifyStyle(node).font?.includes('mono')))
  ) {
    return 'codeblock';
  }
  if (INTERACTIVE_TAGS.has(node.tag)) return 'button';
  return 'other';
}

function sHas(node: DomTreeNode, substr: string): boolean {
  return node.cls.toLowerCase().includes(substr);
}

function hasTextLike(node: DomTreeNode): boolean {
  if (textLength(node) > 0) return true;
  if (INTERACTIVE_TAGS.has(node.tag)) return true;
  return node.children.some((c) => hasTextLike(c));
}

/** 从子树聚合文本长度（含后代）。 */
export function subtreeTextLength(node: DomTreeNode): number {
  return textLength(node) + node.children.reduce((s, c) => s + subtreeTextLength(c), 0);
}

// ---------------------------------------------------------------------------
// 档案构建
// ---------------------------------------------------------------------------

export interface BuildProfileOptions {
  agentId: string;
  appVersion: string;
  scheme?: 'dark' | 'light' | 'auto';
  viewport?: { w: number; h: number };
}

const MAX_COMPONENTS = 400;

/**
 * 从 DomTreeNode（captureDomTree 的输出）构建 AgentNativeProfile。
 * 遍历全部节点，按"几何 + 文本 + 深度"的启发式量化每个可见、非装饰节点。
 */
export function buildNativeProfile(
  root: DomTreeNode | null,
  options: BuildProfileOptions,
): AgentNativeProfile {
  const viewport = options.viewport ?? { w: 1920, h: 1080 };
  const components: ComponentProfile[] = [];
  const bgs: PaletteEntry[] = [];
  const texts: PaletteEntry[] = [];
  const accents: PaletteEntry[] = [];
  const borders: PaletteEntry[] = [];
  const radiusValues: number[] = [];
  const spacingValues: number[] = [];
  const blurValues: number[] = [];

  const walk = (node: DomTreeNode, depth: number, path: string) => {
    if (components.length >= MAX_COMPONENTS) return;
    const q = quantifyStyle(node);
    const area = node.rect.w * node.rect.h;
    const areaRatio = area / (viewport.w * viewport.h);
    const hasText = subtreeTextLength(node) > 0;
    const zIndexRaw = parseFloat(node.style?.['z-index'] ?? '');
    const component: ComponentProfile = {
      role: inferRole(node, viewport, depth),
      path: path || node.tag,
      ref: buildRef(node, path),
      boxModel:
        node.rect.w > 0 && node.rect.h > 0
          ? { w: node.rect.w, h: node.rect.h, x: node.rect.x, y: node.rect.y }
          : null,
      depth,
      area,
      areaRatio,
      quantified: q,
      hasText,
      hasInteractiveDescendant: hasInteractive(node),
      descendantCount: countDescendants(node),
      zIndex: Number.isFinite(zIndexRaw) ? zIndexRaw : 0,
    };
    components.push(component);

    if (q.background && classifyAlpha(q.background.a) !== 'transparent') {
      bgs.push(colorEntry(q.background, component.role, area));
    }
    if (q.color) {
      texts.push(colorEntry(q.color, component.role, hasText ? area : Math.max(area, 100)));
    }
    if (q.border && classifyAlpha(q.border.a) !== 'transparent') {
      borders.push(colorEntry(q.border, component.role, area));
    }
    if (q.borderRadius && q.borderRadius > 0) radiusValues.push(q.borderRadius);
    if (q.blur && q.blur > 0) blurValues.push(q.blur);
    // 间距近似：父节点 padding 均值的 2 倍（粗粒度层级刻度）
    const pad = parseFloat(node.style?.padding ?? '');
    if (Number.isFinite(pad) && pad > 0) spacingValues.push(pad * 2);

    for (const [i, child] of node.children.entries()) {
      walk(child, depth + 1, `${path}/${node.tag}[${i}]`);
    }
  };

  if (root) walk(root, 0, '');

  return {
    meta: {
      agentId: options.agentId,
      appVersion: options.appVersion,
      capturedAt: new Date().toISOString(),
      scheme: options.scheme ?? 'auto',
      viewport,
    },
    components,
    palette: {
      backgrounds: dedupeSort(bgs),
      texts: dedupeSort(texts),
      accents: dedupeSort(accents),
      borders: dedupeSort(borders),
    },
    metrics: {
      elevationLadder: buildElevationLadder(components),
      contrastPairs: buildContrastPairs(texts, bgs),
      radiusScale: uniqueSorted(radiusValues, 8),
      spacingScale: uniqueSorted(spacingValues, 8),
      blurValues: uniqueSorted(blurValues, 6),
    },
  };
}

function colorEntry(c: Rgba, role: string, usage: number): PaletteEntry {
  return { color: toHexStr(c), luminance: luminanceOf(c), usage, role };
}

function toHexStr(c: Rgba): string {
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  return `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`;
}

/** 同色合并（近似到 8 位桶），按 usage 降序，保留首个 role。 */
function dedupeSort(entries: PaletteEntry[]): PaletteEntry[] {
  const map = new Map<string, PaletteEntry>();
  for (const e of entries) {
    const bucket = bucketKey(e.color);
    const existing = map.get(bucket);
    if (existing) {
      existing.usage += e.usage;
    } else {
      map.set(bucket, { ...e });
    }
  }
  return [...map.values()].sort((a, b) => b.usage - a.usage).slice(0, 24);
}

function bucketKey(hex: string): string {
  // 取 R/G/B 各高 4 位 → 4096 桶，视觉相近的颜色合并
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `#${m[1][0]}${m[2][0]}${m[3][0]}`;
}

function uniqueSorted(values: number[], max: number): number[] {
  return [...new Set(values.map((v) => Math.round(v)))].sort((a, b) => a - b).slice(0, max);
}

/** 层级阶梯：按组件背景亮度升序排列，输出相邻级差。 */
function buildElevationLadder(
  components: ComponentProfile[],
): Array<{ level: number; color: string; deltaLuminance: number }> {
  const steps = components
    .filter((c) => c.quantified.background && c.quantified.background.a >= 0.05)
    .map((c) => ({
      color: toHexStr(c.quantified.background!),
      lum: luminanceOf(c.quantified.background!),
    }))
    .sort((a, b) => a.lum - b.lum)
    .slice(0, 16);
  return steps.map((s, i) => ({
    level: i,
    color: s.color,
    deltaLuminance: i === 0 ? 0 : Math.abs(s.lum - steps[i - 1].lum),
  }));
}

/** 对比度对：取高频 text 色 × 高频 bg 色交叉算 WCAG 比。 */
function buildContrastPairs(
  texts: PaletteEntry[],
  bgs: PaletteEntry[],
): Array<{ fg: string; bg: string; wcagRatio: number; pass: boolean }> {
  const topTexts = texts.slice(0, 4);
  const topBgs = bgs.slice(0, 4);
  const pairs: Array<{ fg: string; bg: string; wcagRatio: number; pass: boolean }> = [];
  for (const t of topTexts) {
    for (const b of topBgs) {
      const fg = parseColor(t.color);
      const bg = parseColor(b.color);
      if (!fg || !bg) continue;
      const ratio = wcagContrast(fg, bg);
      pairs.push({ fg: t.color, bg: b.color, wcagRatio: ratio, pass: ratio >= 4.5 });
    }
  }
  return pairs.slice(0, 8);
}

/** 稳定元素引用：结构路径 + 标签指纹（台账/纠错用，不依赖类名）。 */
export function buildRef(node: DomTreeNode, path: string): string {
  return `${path}::${node.tag}`;
}
