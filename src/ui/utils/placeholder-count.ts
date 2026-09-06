// SPDX-License-Identifier: MPL-2.0

/**
 * 根据容器宽度和列宽计算占位数量
 */
export function getPlaceholderCount(
  containerWidth: number,
  options: {
    /** 单列最小宽度 */
    minColumnWidth: number;
    /** 间距 */
    gap: number;
    /** 内边距 */
    padding?: number;
    /** 最少显示数量 */
    minCount?: number;
    /** 最多显示数量 */
    maxCount?: number;
    /** 行数（多行时） */
    rows?: number;
    /** 实际数据量（如果已知），占位数量不会超过此值 */
    actualCount?: number;
  },
): number {
  const {
    minColumnWidth,
    gap,
    padding = 0,
    minCount = 4,
    maxCount = 12,
    rows = 3,
    actualCount,
  } = options;

  if (containerWidth <= 0) return minCount;

  const usableWidth = containerWidth - padding * 2;
  const columns = Math.max(1, Math.floor((usableWidth + gap) / (minColumnWidth + gap)));
  let count = columns * rows;

  // 如果已知实际数据量，占位数量不超过实际数据量
  if (actualCount !== undefined && actualCount > 0) {
    count = Math.min(count, actualCount);
  }

  return Math.max(minCount, Math.min(maxCount, count));
}
