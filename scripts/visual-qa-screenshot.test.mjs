// SPDX-License-Identifier: MPL-2.0
//
// Tests for visual-qa-screenshot.mjs — Visual QA screenshot verification
//
// Covers: pixel diff algorithm, HTML report generation, argument parsing,
// dimension mismatch handling, and threshold behaviour.

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { computePixelDiff, generateHtmlReport, parseArgs } from './visual-qa-screenshot.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a solid-colour PNG of the given dimensions.
 * @param {number} width
 * @param {number} height
 * @param {[number, number, number, number]} rgba - [r, g, b, a]
 * @returns {PNG}
 */
function createSolidPng(width, height, rgba) {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = rgba[0];
    png.data[i * 4 + 1] = rgba[1];
    png.data[i * 4 + 2] = rgba[2];
    png.data[i * 4 + 3] = rgba[3] ?? 255;
  }
  return png;
}

/**
 * Create a 2x2 PNG with specific pixel values for targeted testing.
 * @param {Array<Array<[number, number, number, number]>>} rows - 2 rows of 2 RGBA pixels
 * @returns {PNG}
 */
function create2x2Png(rows) {
  const png = new PNG({ width: 2, height: 2 });
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      const idx = (y * 2 + x) * 4;
      const [r, g, b, a] = rows[y][x];
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = a;
    }
  }
  return png;
}

// ---------------------------------------------------------------------------
// Tests: computePixelDiff
// ---------------------------------------------------------------------------

describe('computePixelDiff', () => {
  it('returns 100% similarity for identical images', () => {
    const a = createSolidPng(4, 4, [100, 150, 200, 255]);
    const b = createSolidPng(4, 4, [100, 150, 200, 255]);

    const result = computePixelDiff(a, b);

    expect(result.similarity).toBe(100);
    expect(result.changedPixels).toBe(0);
    expect(result.totalPixels).toBe(16);
  });

  it('detects changed pixels and computes correct similarity', () => {
    // 2x2 image: 3 identical pixels, 1 pixel with delta > threshold
    const a = create2x2Png([
      [
        [10, 20, 30, 255],
        [40, 50, 60, 255],
      ],
      [
        [70, 80, 90, 255],
        [100, 110, 120, 255],
      ],
    ]);
    const b = create2x2Png([
      [
        [10, 20, 30, 255],
        [40, 50, 60, 255],
      ],
      [
        [70, 80, 90, 255],
        [200, 110, 120, 255],
      ], // delta of 100 in R channel
    ]);

    const result = computePixelDiff(a, b, { threshold: 8 });

    expect(result.changedPixels).toBe(1);
    expect(result.totalPixels).toBe(4);
    expect(result.similarity).toBe(75); // 3/4 unchanged
  });

  it('treats sub-threshold delta as unchanged', () => {
    const a = createSolidPng(2, 2, [100, 100, 100, 255]);
    const b = createSolidPng(2, 2, [105, 100, 100, 255]); // delta of 5

    const result = computePixelDiff(a, b, { threshold: 8 });

    expect(result.changedPixels).toBe(0);
    expect(result.similarity).toBe(100);
  });

  it('respects custom threshold', () => {
    const a = createSolidPng(2, 2, [100, 100, 100, 255]);
    const b = createSolidPng(2, 2, [110, 100, 100, 255]); // delta of 10

    // With threshold 15, delta of 10 is below threshold
    const result = computePixelDiff(a, b, { threshold: 15 });
    expect(result.changedPixels).toBe(0);

    // With threshold 5, delta of 10 exceeds threshold
    const result2 = computePixelDiff(a, b, { threshold: 5 });
    expect(result2.changedPixels).toBe(4);
  });

  it('throws on dimension mismatch', () => {
    const a = createSolidPng(4, 4, [0, 0, 0, 255]);
    const b = createSolidPng(8, 8, [0, 0, 0, 255]);

    expect(() => computePixelDiff(a, b)).toThrow(/Dimension mismatch/u);
  });

  it('produces a diff PNG with the same dimensions', () => {
    const a = createSolidPng(3, 5, [0, 0, 0, 255]);
    const b = createSolidPng(3, 5, [255, 255, 255, 255]);

    const result = computePixelDiff(a, b);

    expect(result.diff.width).toBe(3);
    expect(result.diff.height).toBe(5);
  });

  it('paints changed pixels with highlight colour', () => {
    const a = createSolidPng(2, 2, [0, 0, 0, 255]);
    const b = createSolidPng(2, 2, [255, 0, 0, 255]);

    const result = computePixelDiff(a, b, { highlightR: 220, highlightG: 40, highlightB: 40 });

    // First pixel of diff should be the highlight colour
    expect(result.diff.data[0]).toBe(220);
    expect(result.diff.data[1]).toBe(40);
    expect(result.diff.data[2]).toBe(40);
    expect(result.diff.data[3]).toBe(255);
  });

  it('paints unchanged pixels as neutral grey', () => {
    const a = createSolidPng(2, 2, [50, 60, 70, 255]);
    const b = createSolidPng(2, 2, [50, 60, 70, 255]);

    const result = computePixelDiff(a, b);

    // All pixels should be grey (240)
    expect(result.diff.data[0]).toBe(240);
    expect(result.diff.data[1]).toBe(240);
    expect(result.diff.data[2]).toBe(240);
  });
});

// ---------------------------------------------------------------------------
// Tests: generateHtmlReport
// ---------------------------------------------------------------------------

describe('generateHtmlReport', () => {
  it('produces valid HTML with embedded similarity score', () => {
    const baselinePng = PNG.sync.write(createSolidPng(2, 2, [0, 0, 0, 255]));
    const resultPng = PNG.sync.write(createSolidPng(2, 2, [255, 255, 255, 255]));
    const diffPng = PNG.sync.write(createSolidPng(2, 2, [128, 128, 128, 255]));

    const html = generateHtmlReport({
      baselinePng,
      resultPng,
      diffPng,
      changedPixels: 100,
      totalPixels: 1000,
      similarity: 90.0,
      agent: 'workbuddy',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('90.00%');
    expect(html).toContain('workbuddy');
    expect(html).toContain('100'); // changedPixels
    expect(html).toContain('1,000'); // totalPixels (formatted)
    expect(html).toContain('data:image/png;base64');
    expect(html).toContain('</html>');
  });

  it('escapes HTML special characters in agent name', () => {
    const dummy = PNG.sync.write(createSolidPng(1, 1, [0, 0, 0, 255]));

    const html = generateHtmlReport({
      baselinePng: dummy,
      resultPng: dummy,
      diffPng: dummy,
      changedPixels: 0,
      totalPixels: 1,
      similarity: 100,
      agent: '<script>alert("xss")</script>',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('assigns correct verdict class based on similarity', () => {
    const dummy = PNG.sync.write(createSolidPng(1, 1, [0, 0, 0, 255]));

    // PASS (>= 99.5%)
    const pass = generateHtmlReport({
      baselinePng: dummy,
      resultPng: dummy,
      diffPng: dummy,
      changedPixels: 0,
      totalPixels: 1000,
      similarity: 99.8,
      agent: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(pass).toContain('ok');
    expect(pass).toContain('PASS');

    // WARN (>= 95%, < 99.5%)
    const warn = generateHtmlReport({
      baselinePng: dummy,
      resultPng: dummy,
      diffPng: dummy,
      changedPixels: 30,
      totalPixels: 1000,
      similarity: 97.0,
      agent: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(warn).toContain('warn');
    expect(warn).toContain('WARN');

    // FAIL (< 95%)
    const fail = generateHtmlReport({
      baselinePng: dummy,
      resultPng: dummy,
      diffPng: dummy,
      changedPixels: 100,
      totalPixels: 1000,
      similarity: 90.0,
      agent: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(fail).toContain('fail');
    expect(fail).toContain('FAIL');
  });

  it('embeds all three images as data URIs', () => {
    const baselinePng = PNG.sync.write(createSolidPng(2, 2, [10, 20, 30, 255]));
    const resultPng = PNG.sync.write(createSolidPng(2, 2, [40, 50, 60, 255]));
    const diffPng = PNG.sync.write(createSolidPng(2, 2, [70, 80, 90, 255]));

    const html = generateHtmlReport({
      baselinePng,
      resultPng,
      diffPng,
      changedPixels: 0,
      totalPixels: 4,
      similarity: 100,
      agent: 'test',
      timestamp: '2026-01-01T00:00:00.000Z',
    });

    // Count occurrences of data:image/png;base64
    const matches = html.match(/data:image\/png;base64/gu);
    expect(matches).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('parses --key value pairs', () => {
    const args = parseArgs(['--port', '9222', '--agent', 'workbuddy']);
    expect(args.port).toBe('9222');
    expect(args.agent).toBe('workbuddy');
  });

  it('parses --key=value pairs', () => {
    const args = parseArgs(['--port=52743', '--agent=doubao']);
    expect(args.port).toBe('52743');
    expect(args.agent).toBe('doubao');
  });

  it('treats boolean flags as "true"', () => {
    const args = parseArgs(['--verbose']);
    expect(args.verbose).toBe('true');
  });

  it('handles mixed formats', () => {
    const args = parseArgs(['--port', '9222', '--delay=3000', '--verbose']);
    expect(args.port).toBe('9222');
    expect(args.delay).toBe('3000');
    expect(args.verbose).toBe('true');
  });

  it('returns empty object for no args', () => {
    const args = parseArgs([]);
    expect(Object.keys(args)).toHaveLength(0);
  });
});
