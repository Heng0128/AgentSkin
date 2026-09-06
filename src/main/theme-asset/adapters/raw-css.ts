// SPDX-License-Identifier: MPL-2.0

import { readFile } from 'node:fs/promises';
import type { ThemeColors } from '../../../main/catalog/theme-manifest';
import { AdapterParseError, InvalidInputError } from '../ir/errors';
import type { AdapterInput, AdapterResult, ThemeAdapter } from '../ir/types';

/**
 * 裸 CSS 适配器。
 * 输入形态：裸 CSS 字符串/文件。
 * 实现策略：css-extract → 颜色 token 化 → 语义聚类。
 *
 * detect：检查 .css 扩展名或内容特征。
 * parse：正则提取颜色 → 按使用频率排序 → 按上下文语义聚类。
 *
 * 风险：逆向提取 CSS→token 语义错判率高，confidence 设置较低（0.55）。
 */

/** 颜色值正则 */
const COLOR_REGEX = /#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b|rgba?\([^)]+\)|hsla?\([^)]+\)/gi;

/** 语义聚类：选择器上下文 → token 语义 */
const SEMANTIC_PATTERNS: Array<{
  pattern: RegExp;
  token: string;
  weight: number;
}> = [
  // 背景色（最高优先级）
  { pattern: /body|html|background|bg|main|app/i, token: 'background', weight: 10 },
  // 文字色
  { pattern: /color|text|font/i, token: 'foreground', weight: 8 },
  // 边框色
  { pattern: /border|outline|divider/i, token: 'border', weight: 6 },
  // 强调色（hover/active/focus/primary/accent）
  { pattern: /hover|active|focus|primary|accent|button/i, token: 'accent', weight: 9 },
  // 表面色
  { pattern: /surface|card|panel|container/i, token: 'surface', weight: 7 },
];

/** 提取 CSS 中所有颜色值及其上下文 */
function extractColorsWithContext(
  css: string,
): Array<{ color: string; context: string; index: number }> {
  const results: Array<{ color: string; context: string; index: number }> = [];
  const lines = css.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const colorMatches = line.match(COLOR_REGEX);
    if (colorMatches) {
      for (const color of colorMatches) {
        // 获取上下文：当前行 + 前后各一行
        const contextStart = Math.max(0, i - 1);
        const contextEnd = Math.min(lines.length, i + 2);
        const context = lines.slice(contextStart, contextEnd).join(' ');
        results.push({ color, context, index: i });
      }
    }
  }

  return results;
}

/** 简单的颜色相似度（RGB 距离） */
function colorDistance(a: string, b: string): number {
  const parse = (c: string): [number, number, number] => {
    if (c.startsWith('#')) {
      const hex = c.slice(1);
      if (hex.length === 3) {
        return [
          parseInt(hex[0] + hex[0], 16),
          parseInt(hex[1] + hex[1], 16),
          parseInt(hex[2] + hex[2], 16),
        ];
      }
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    if (c.startsWith('rgb')) {
      const match = c.match(/\d+/g);
      if (match) return [+match[0], +match[1], +match[2]];
    }
    return [0, 0, 0];
  };

  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** 聚类颜色（按 RGB 距离分桶） */
function clusterColors(
  colors: Array<{ color: string; context: string; index: number }>,
  threshold = 30,
): Array<{ representative: string; items: typeof colors }> {
  const clusters: Array<{ representative: string; items: typeof colors }> = [];

  for (const item of colors) {
    let found = false;
    for (const cluster of clusters) {
      if (colorDistance(cluster.representative, item.color) < threshold) {
        cluster.items.push(item);
        found = true;
        break;
      }
    }
    if (!found) {
      clusters.push({ representative: item.color, items: [item] });
    }
  }

  return clusters;
}

/** 根据上下文语义判定 token */
function classifyColor(cluster: {
  representative: string;
  items: Array<{ context: string }>;
}): { token: string; confidence: number } | null {
  const contexts = cluster.items.map((i) => i.context).join(' ');

  let bestMatch: { token: string; score: number } | null = null;

  for (const { pattern, token, weight } of SEMANTIC_PATTERNS) {
    const matchCount = (contexts.match(new RegExp(pattern.source, 'gi')) ?? []).length;
    if (matchCount > 0) {
      const score = matchCount * weight;
      if (!bestMatch || score > bestMatch.score) {
        bestMatch = { token, score };
      }
    }
  }

  return bestMatch ? { token: bestMatch.token, confidence: 0.5 } : null;
}

export const rawCssAdapter: ThemeAdapter = {
  priority: 40,

  detect(input: AdapterInput): boolean {
    const name = (input.filename ?? input.path ?? '').toLowerCase();
    if (name.endsWith('.css')) return true;

    // 内容特征检测：buffer 内容包含 CSS 特征
    if (input.buffer) {
      const preview = input.buffer.subarray(0, 200).toString('utf-8');
      return /[{}:;]/.test(preview) && /color|background|border/i.test(preview);
    }

    return false;
  },

  async parse(input: AdapterInput): Promise<AdapterResult> {
    let cssContent: string;

    if (input.path) {
      try {
        cssContent = await readFile(input.path, 'utf-8');
      } catch (error) {
        throw new AdapterParseError(
          `Failed to read CSS file: ${(error as Error).message}`,
          'raw-css',
        );
      }
    } else if (input.buffer) {
      cssContent = input.buffer.toString('utf-8');
    } else {
      throw new InvalidInputError('raw-css adapter requires input.path or input.buffer');
    }

    try {
      // 1. 提取所有颜色及其上下文
      const colorItems = extractColorsWithContext(cssContent);

      if (colorItems.length === 0) {
        throw new AdapterParseError('No color values found in CSS content', 'raw-css');
      }

      // 2. 聚类相似颜色
      const clusters = clusterColors(colorItems);

      // 3. 按使用频率排序（出现次数多的优先）
      clusters.sort((a, b) => b.items.length - a.items.length);

      // 4. 语义聚类 → tokens
      const colors: Record<string, string> = {};
      const inference: Record<string, 'provided' | 'derived' | 'default'> = {};

      // 最常见的颜色优先分配（背景或主色）
      const primaryColor = clusters[0]?.representative ?? '#1e1e1e';
      colors.background = primaryColor;
      inference.background = 'derived';

      // 次常见颜色分配
      for (let i = 1; i < Math.min(clusters.length, 6); i++) {
        const classification = classifyColor(clusters[i]);
        if (classification && !colors[classification.token]) {
          colors[classification.token] = clusters[i].representative;
          inference[classification.token] = 'derived';
        }
      }

      // 如果还没提取到 foreground（文字色），尝试找对比度高的颜色
      if (!colors.foreground) {
        // 找与背景色对比度最大的作为文字色
        let maxDist = 0;
        let bestFg = '#e0e0e0';
        for (const cluster of clusters) {
          const dist = colorDistance(cluster.representative, primaryColor);
          if (dist > maxDist) {
            maxDist = dist;
            bestFg = cluster.representative;
          }
        }
        colors.foreground = bestFg;
        inference.foreground = 'derived';
      }

      return {
        colors: colors as unknown as ThemeColors,
        meta: {
          name: input.filename ?? 'Raw CSS Theme',
          sourceFormat: 'raw-css',
        },
        confidence: 0.55,
      };
    } catch (error) {
      if (error instanceof AdapterParseError) throw error;
      throw new AdapterParseError(`Failed to parse CSS: ${(error as Error).message}`, 'raw-css');
    }
  },
};
