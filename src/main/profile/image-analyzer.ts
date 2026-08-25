// SPDX-License-Identifier: MPL-2.0

/**
 * # image-analyzer — 图像焦点检测与安全区推断
 *
 * 纯 TS 图像分析引擎，零运行时依赖，全部函数纯函数、无 I/O，方便单测。
 * 为壁纸注入和主题适配提供视觉理解能力。三大能力：
 *
 *   - **焦点检测**：基于梯度幅值（Sobel 算子）定位视觉重心
 *   - **安全区推断**：分析左右两侧信息量，推断内容放置区域
 *   - **主色调提取**：复用 medianCut 聚类，Top-5 主色按角色分类
 */

import { medianCut, toHex } from './color-quantize';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 像素数据：RGBA 扁平数组，每像素 4 字节，按行优先排列。 */
export interface PixelData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 焦点坐标（0..1 归一化，原点在左上角）。 */
export interface FocusPoint {
  x: number;
  y: number;
}

/** 安全区枚举：内容应放置的区域。 */
export type SafeArea = 'auto' | 'left' | 'right' | 'center' | 'none';

/** 主色角色。 */
export type ColorRole = 'accent' | 'secondary' | 'highlight';

/** 主色条目。 */
export interface DominantColor {
  color: { r: number; g: number; b: number };
  hex: string;
  weight: number;
  role: ColorRole;
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

/** 获取指定坐标像素的亮度（Rec. 709），越界返回 0。 */
function luminanceAt(p: PixelData, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
  const i = (y * p.width + x) * 4;
  return (0.2126 * p.data[i] + 0.7152 * p.data[i + 1] + 0.0722 * p.data[i + 2]) / 255;
}

/** 获取指定坐标像素的 RGB 对象。 */
function rgbAt(p: PixelData, x: number, y: number): { r: number; g: number; b: number } {
  const i = (y * p.width + x) * 4;
  return { r: p.data[i], g: p.data[i + 1], b: p.data[i + 2] };
}

/** 简单高斯平滑（3x3 kernel），用于梯度图降噪。 */
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
          // 3x3 gaussian kernel (sigma≈1): center=4, edge=2, corner=1
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

/**
 * 基于 Sobel 算子的焦点检测。
 *
 * 算法：
 *   1. 逐像素计算梯度幅值（Sobel Gx/Gy）
 *   2. 对梯度图做 3x3 高斯平滑
 *   3. 取加权平均位置作为焦点（视觉重心）
 *
 * @param p 像素数据
 * @returns 归一化焦点坐标 (0..1)
 */
export function detectFocus(p: PixelData): FocusPoint {
  const { width, height } = p;
  if (width < 3 || height < 3) {
    return { x: 0.5, y: 0.5 };
  }

  const gradients = new Float64Array(width * height);

  // Step 1: Sobel 梯度幅值
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Sobel Gx
      const gx =
        -luminanceAt(p, x - 1, y - 1) +
        luminanceAt(p, x + 1, y - 1) +
        -2 * luminanceAt(p, x - 1, y) +
        2 * luminanceAt(p, x + 1, y) +
        -luminanceAt(p, x - 1, y + 1) +
        luminanceAt(p, x + 1, y + 1);
      // Sobel Gy
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

  // Step 2: 高斯平滑
  const smoothed = gaussianSmooth(gradients, width, height);

  // Step 3: 加权平均位置
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

  if (totalWeight < 1e-10) {
    // 纯色图：无边缘，返回中心
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: sumX / totalWeight / (width - 1),
    y: sumY / totalWeight / (height - 1),
  };
}

// ---------------------------------------------------------------------------
// 安全区推断
// ---------------------------------------------------------------------------

/**
 * 分析单侧信息量（饱和度 + 对比度 + 亮度能量）。
 * 信息量越高，越不适合放置内容（会干扰视觉）。
 *
 * 亮度能量：明亮区域对视觉的干扰更大（叠加内容后更难辨识），
 * 因此高亮度 = 高信息量 = 不适合放置内容。
 */
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
      // 饱和度（简化 HSV 公式）
      const saturation = max === 0 ? 0 : (max - min) / max;
      totalSaturation += saturation;

      // 亮度（Rec. 709，0..1）
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      totalLuminance += lum;

      // 局部对比度：与右侧邻居的亮度差
      if (x + 1 < xEnd) {
        const neighbor = rgbAt(p, x + 1, y);
        const lum2 = (0.2126 * neighbor.r + 0.7152 * neighbor.g + 0.0722 * neighbor.b) / 255;
        totalContrast += Math.abs(lum - lum2);
      }
      count++;
    }
  }

  if (count === 0) return 0;
  const avgSaturation = totalSaturation / count;
  const avgContrast = totalContrast / count;
  const avgLuminance = totalLuminance / count;
  // 信息量 = 饱和度 + 对比度 + 亮度能量（权重分配）
  return avgSaturation * 0.3 + avgContrast * 0.3 + avgLuminance * 0.4;
}

/**
 * 推断安全区（适合放置内容的区域）。
 *
 * 算法：
 *   1. 将图片分为左/右两半
 *   2. 分别计算信息量（平均饱和度 + 对比度）
 *   3. 信息量低的一侧更适合放置内容
 *
 * @param p 像素数据
 * @param mode 推断模式，'auto' 自动选择信息量低的一侧
 * @returns 安全区枚举
 */
export function inferSafeArea(p: PixelData, mode: SafeArea = 'auto'): SafeArea {
  if (mode !== 'auto') return mode;

  const midX = Math.floor(p.width / 2);
  const leftInfo = analyzeSide(p, 0, midX);
  const rightInfo = analyzeSide(p, midX, p.width);

  // 差异阈值：信息量接近时返回 center
  const diff = Math.abs(leftInfo - rightInfo);
  if (diff < 0.02) {
    // 两侧信息量接近，检查是否整体都很空或都很满
    const avgInfo = (leftInfo + rightInfo) / 2;
    if (avgInfo < 0.05) return 'center'; // 纯色图，任意位置均可
    return 'center';
  }

  return leftInfo < rightInfo ? 'left' : 'right';
}

// ---------------------------------------------------------------------------
// 主色调提取
// ---------------------------------------------------------------------------

/**
 * 从像素数据提取 Top-5 主色调。
 *
 * 复用 medianCut 聚类，按权重排序后区分角色：
 *   - accent：权重最高的主色（品牌色/主题色候选）
 *   - secondary：权重次高的辅助色
 *   - highlight：其余为点缀色
 *
 * @param p 像素数据
 * @param maxColors 最大返回颜色数（默认 5）
 * @returns 按权重降序排列的主色数组
 */
export function extractDominantColors(p: PixelData, maxColors = 5): DominantColor[] {
  // 采样：为性能考虑，最多采样 4000 像素
  const sampleCount = Math.min(4000, p.width * p.height);
  const step = Math.max(1, Math.floor((p.width * p.height) / sampleCount));

  const colors: Array<{ r: number; g: number; b: number; weight: number }> = [];
  const colorMap = new Map<string, number>();

  // 量化到 48 级以减少聚类噪声（每通道 / 5.1 取整）
  for (let i = 0; i < p.data.length; i += 4 * step) {
    const r = Math.round(p.data[i] / 5.1) * 5.1;
    const g = Math.round(p.data[i + 1] / 5.1) * 5.1;
    const b = Math.round(p.data[i + 2] / 5.1) * 5.1;
    const key = `${r},${g},${b}`;
    colorMap.set(key, (colorMap.get(key) ?? 0) + 1);
  }

  for (const [key, weight] of colorMap) {
    const [r, g, b] = key.split(',').map(Number);
    colors.push({ r, g, b, weight });
  }

  if (colors.length === 0) return [];

  // medianCut 聚类
  const buckets = medianCut(colors, Math.min(maxColors, colors.length));

  // 按权重降序排序
  buckets.sort((a, b) => b.weight - a.weight);

  // 分配角色
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

/**
 * 综合分析：一次性输出焦点、安全区、主色调。
 *
 * @param p 像素数据
 * @param safeAreaMode 安全区模式（默认 'auto'）
 * @returns 完整分析结果
 */
export function analyzeImage(p: PixelData, safeAreaMode: SafeArea = 'auto'): ImageAnalysisResult {
  return {
    focus: detectFocus(p),
    safeArea: inferSafeArea(p, safeAreaMode),
    dominantColors: extractDominantColors(p),
  };
}
