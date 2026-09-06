// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { getPlaceholderCount } from '../placeholder-count';

describe('getPlaceholderCount', () => {
  it('returns minCount when width is 0', () => {
    expect(getPlaceholderCount(0, { minColumnWidth: 240, gap: 12 })).toBe(4);
  });

  it('calculates columns based on width', () => {
    // 1000px / (240 + 12) ≈ 4 columns, 4 * 3 rows = 12
    const count = getPlaceholderCount(1000, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 4,
      maxCount: 12,
      rows: 3,
    });
    expect(count).toBe(12);
  });

  it('respects maxCount', () => {
    const count = getPlaceholderCount(5000, {
      minColumnWidth: 100,
      gap: 10,
      minCount: 4,
      maxCount: 8,
      rows: 2,
    });
    expect(count).toBe(8);
  });

  it('respects minCount', () => {
    const count = getPlaceholderCount(100, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 4,
      maxCount: 12,
      rows: 3,
    });
    expect(count).toBe(4);
  });

  it('handles narrow container', () => {
    const count = getPlaceholderCount(300, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 2,
      maxCount: 12,
      rows: 3,
    });
    expect(count).toBe(3); // 1 column * 3 rows
  });

  it('does not exceed actualCount when provided (minCount wins when actualCount < minCount)', () => {
    // columns = floor((1000+12)/(240+12)) = 4, count = 4*3 = 12
    // min(12, 2) = 2, max(4, 2) = 4 → minCount floor wins
    const count = getPlaceholderCount(1000, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 4,
      maxCount: 12,
      rows: 3,
      actualCount: 2,
    });
    expect(count).toBe(4);
  });

  it('uses actualCount when smaller than calculated and above minCount', () => {
    // columns = floor((500+12)/(240+12)) = 2, count = 2*3 = 6
    // min(6, 2) = 2, max(1, 2) = 2
    const count = getPlaceholderCount(500, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 1,
      maxCount: 12,
      rows: 3,
      actualCount: 2,
    });
    expect(count).toBe(2);
  });

  it('ignores actualCount of 0 (treats as unknown)', () => {
    const count = getPlaceholderCount(1000, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 4,
      maxCount: 12,
      rows: 3,
      actualCount: 0,
    });
    expect(count).toBe(12); // same as without actualCount
  });

  it('ignores actualCount when undefined', () => {
    const count = getPlaceholderCount(1000, {
      minColumnWidth: 240,
      gap: 12,
      minCount: 4,
      maxCount: 12,
      rows: 3,
    });
    expect(count).toBe(12);
  });
});
