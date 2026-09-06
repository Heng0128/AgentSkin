// SPDX-License-Identifier: MPL-2.0

/**
 * # image-analyzer — 图像焦点检测与安全区推断
 *
 * 纯 TS 图像分析引擎，零运行时依赖，全部函数纯函数、无 I/O，方便单测。
 * 三大能力：焦点检测（Sobel 梯度）、安全区推断（信息量分析）、主色调提取（medianCut）。
 */

import { medianCut, toHex } from './color-quantize';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface FocusPoint {
  x: number;
  y: number;
}

export type SafeArea = 'auto' | 'left' | 'right' | 'center' | 'none';
export type ColorRole = 'accent' | 'secondary' | 'highlight';

export interface DominantColor {
  color: { r: number; g: number; b: number };
  hex: string;
  weight: number;
  role: ColorRole;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function luminanceAt(p: PixelData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
  const i = (y * p.width + x) * 4;
  return (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255;
}

function rgbAt(p: PixelData, x: number, y: number): { r: number; g: number; b: number } {
  const i = (y * p.width + x) * 4;
  return { r: p.data[i], g: p.data[i + 1], b: p.data[i + 2] };
}

/** 3x3 高斯平滑（sigma≈1），用于梯度图降噪。 */
function gaussianSmooth(values: Float64Array, width: number, height: number): Float64Array {
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let wsum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const w = dx === 0 && dy === 0 ? 4 : dx === 0 || dy === 0 ? 2 : 1;
          sum += values[ny * width + nx] * w;
          wsum += w;
        }
      }
      out[y * width + x] = sum / wsum;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 焦点检测
// ---------------------------------------------------------------------------

/** Sobel 焦点检测：梯度幅值 → 高斯平滑 → 加权平均位置。 */
export function detectFocus(p: PixelData): FocusPoint {
  const { width, height } = p;
  if (width < 3 || height < 3) return { x: 0.5, y: 0.5 };

  const gradients = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const gx =
        -luminanceAt(p, x - 1, y - 1) +
        luminanceAt(p, x + 1, y - 1) +
        -2 * luminanceAt(p, x - 1, y) +
        2 * luminanceAt(p, x + 1, y) +
        -luminanceAt(p, x - 1, y + 1) +
        luminanceAt(p, x + 1, y + 1);
      const gy =
        -luminanceAt(p, x - 1, y - 1) -
        2 * luminanceAt(p, x, y - 1) -
        luminanceAt(p, x + 1, y - 1) +
        luminanceAt(p, x - 1, y + 1) +
        2 * luminanceAt(p, x, y + 1) +
        luminanceAt(p, x + 1, y + 1);
      gradients[y * width + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }

  const smoothed = gaussianSmooth(gradients, width, height);
  let totalWeight = 0;
  let sumX = 0;
  let sumY = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = smoothed[y * width + x];
      totalWeight += w;
      sumX += x * w;
      sumY += y * w;
    }
  }

  if (totalWeight < 1e-10) return { x: 0.5, y: 0.5 };
  return {
    x: sumX / totalWeight / (width - 1),
    y: sumY / totalWeight / (height - 1),
  };
}

// ---------------------------------------------------------------------------
// 安全区推断
// ---------------------------------------------------------------------------

/** 分析单侧信息量（饱和度 + 对比度 + 亮度能量）。 */
function analyzeSide(p: PixelData, xStart: number, xEnd: number): number {
  let totalSaturation = 0;
  let totalContrast = 0;
  let totalLuminance = 0;
  let count = 0;

  for (let y = 0; y < p.height; y++) {
    for (let x = xStart; x < xEnd; x++) {
      const { r, g, b } = rgbAt(p, x, y);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      totalSaturation += max === 0 ? 0 : (max - min) / max;
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      totalLuminance += lum;
      if (x + 1 < xEnd) {
        const neighbor = rgbAt(p, x + 1, y);
        const lum2 = (0.2126 * neighbor.r + 0.7152 * neighbor.g + 0.0722 * neighbor.b) / 255;
        totalContrast += Math.abs(lum - lum2);
      }
      count++;
    }
  }

  if (count === 0) return 0;
  return (
    (totalSaturation / count) * 0.3 + (totalContrast / count) * 0.3 + (totalLuminance / count) * 0.4
  );
}

/** 推断安全区：信息量低的一侧更适合放置内容。 */
export function inferSafeArea(p: PixelData, mode: SafeArea = 'auto'): SafeArea {
  if (mode !== 'auto') return mode;
  const midX = Math.floor(p.width / 2);
  const leftInfo = analyzeSide(p, 0, midX);
  const rightInfo = analyzeSide(p, midX, p.width);
  if (Math.abs(leftInfo - rightInfo) < 0.02) return 'center';
  return leftInfo < rightInfo ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// 主色调提取
// ---------------------------------------------------------------------------

/** 提取 Top-N 主色调，复用 medianCut 聚类，按权重区分 accent/secondary/highlight。 */
export function extractDominantColors(p: PixelData, maxColors = 5): DominantColor[] {
  const sampleCount = Math.min(4000, p.width * p.height);
  const step = Math.max(1, Math.floor((p.width * p.height) / sampleCount));
  const colorMap = new Map<string, number>();

  for (let i = 0; i < p.data.length; i += 4 * step) {
    const r = Math.round(p.data[i] / 5.1) * 5.1;
    const g = Math.round(p.data[i + 1] / 5.1) * 5.1;
    const b = Math.round(p.data[i + 2] / 5.1) * 5.1;
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  const colors: Array<{ r: number; g: number; b: number; weight: number }> = [];
  for (const [key, weight] of colorMap) {
    const [r, g, b] = key.split(',').map(Number);
    colors.push({ r, g, b, weight });
  }
  if (colors.length === 0) return [];

  const buckets = medianCut(colors, Math.min(maxColors, colors.length));
  buckets.sort((a, b) => b.weight - a.weight);

  return buckets.slice(0, maxColors).map((bucket, idx) => ({
    color: bucket.color,
    hex: toHex(bucket.color),
    weight: bucket.weight,
    role: idx === 0 ? 'accent' : idx === 1 ? 'secondary' : 'highlight',
  }));
}

// ---------------------------------------------------------------------------
// 综合接口
// ---------------------------------------------------------------------------

export interface ImageAnalysisResult {
  focus: FocusPoint;
  safeArea: SafeArea;
  dominantColors: DominantColor[];
}

/** 综合分析：一次性输出焦点、安全区、主色调。 */
export function analyzeImage(p: PixelData, safeAreaMode: SafeArea = 'auto'): ImageAnalysisResult {
  return {
    focus: detectFocus(p),
    safeArea: inferSafeArea(p, safeAreaMode),
    dominantColors: extractDominantColors(p),
  };
}
