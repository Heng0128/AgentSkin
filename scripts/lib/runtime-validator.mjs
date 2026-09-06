// SPDX-License-Identifier: MPL-2.0 OR MIT
//
// # runtime-validator.mjs
//
// Runtime quality gate: provides verifyRuntimeQuality() for post-injection
// inspection via CDP. Samples computed styles, checks contrast, horizontal
// overflow, and key-selector hit counts. Designed to be called from both
// scripts/runtime-check-all.mjs (live CDP) and unit tests (mock CDP).

/**
 * Compute the WCAG 2.1 contrast ratio between two colors.
 *
 * @param {string} hex1 - First 6-digit hex color (e.g. "#1a1a1a").
 * @param {string} hex2 - Second 6-digit hex color (e.g. "#ffffff").
 * @returns {number} Contrast ratio (1.0 – 21.0).
 */
export function wcagContrastRatio(hex1, hex2) {
  const lum = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return 0;
    const r = parseInt(m[1].slice(0, 2), 16) / 255;
    const g = parseInt(m[1].slice(2, 4), 16) / 255;
    const b = parseInt(m[1].slice(4, 6), 16) / 255;
    const ch = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
  };
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse any CSS color string to a 6-digit hex string.
 *
 * Supports: #rgb, #rrggbb, rgb(), rgba(). Returns null when the input
 * cannot be parsed to a valid color.
 *
 * @param {string} raw - CSS color value from computed style.
 * @returns {string | null} Normalized 6-digit hex (e.g. "#ff7a6b").
 */
export function normalizeColor(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // Hex forms.
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return `#${m[1].toLowerCase()}`;

  // rgb() / rgba() — extract r,g,b (ignore alpha).
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (m) {
    const r = Number(m[1]);
    const g = Number(m[2]);
    const b = Number(m[3]);
    const hx = (n) => n.toString(16).padStart(2, '0');
    return `#${hx(r)}${hx(g)}${hx(b)}`;
  }

  return null;
}

/**
 * Send a CDP command and resolve with the result object.
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @param {string} method - CDP method name.
 * @param {object} params - CDP method parameters.
 * @returns {Promise<object>} The CDP result object.
 */
async function sendCdp(conn, method, params = {}) {
  const res = await conn.send(method, params);
  return res;
}

/**
 * Evaluate a JavaScript expression in the page context and return the value.
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @param {string} expression - JavaScript expression to evaluate.
 * @returns {Promise<any>} The evaluated value.
 */
async function evalInPage(conn, expression) {
  const res = await sendCdp(conn, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  return res?.result?.value;
}

/**
 * Sample text elements from the page and verify WCAG AA contrast (4.5:1).
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @param {object} options - Options.
 * @param {number} [options.sampleLimit=30] - Maximum elements to sample.
 * @param {number} [options.minRatio=4.5] - Minimum acceptable contrast ratio.
 * @returns {Promise<{score: number, passed: boolean, passedCount: number, failedCount: number, total: number}>}
 */
async function verifyContrast(cdp, options = {}) {
  const sampleLimit = options.sampleLimit ?? 30;
  const minRatio = options.minRatio ?? 4.5;

  const expression = `(() => {
    const nodes = document.querySelectorAll('p, span, h1, h2, h3, h4, h5, h6, a, button, input, textarea, label');
    const results = [];
    const limit = Math.min(nodes.length, ${sampleLimit});
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      const cs = getComputedStyle(el);
      const fg = cs.color;
      const bg = cs.backgroundColor;
      if (!fg || !bg) continue;
      results.push({ fg, bg });
    }
    return results;
  })()`;

  const samples = (await evalInPage(cdp, expression)) ?? [];

  if (samples.length === 0) {
    return { score: 100, passed: true, passedCount: 0, failedCount: 0, total: 0 };
  }

  let passedCount = 0;
  for (const s of samples) {
    const fg = normalizeColor(s.fg);
    const bg = normalizeColor(s.bg);
    if (!fg || !bg) continue;
    const ratio = wcagContrastRatio(fg, bg);
    if (ratio >= minRatio) passedCount++;
  }

  const total = samples.length;
  const failedCount = total - passedCount;
  const score = total > 0 ? Math.round((passedCount / total) * 100) : 100;
  return { score, passed: failedCount === 0, passedCount, failedCount, total };
}

/**
 * Check whether the document overflows horizontally.
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @returns {Promise<boolean>} true if horizontal overflow detected.
 */
async function detectHorizontalOverflow(cdp) {
  const overflow = await evalInPage(
    cdp,
    'document.documentElement.scrollWidth > document.documentElement.clientWidth',
  );
  return overflow === true;
}

/**
 * Verify that each critical selector matches at least one element.
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @param {string[]} selectors - Array of CSS selectors to verify.
 * @returns {Promise<{score: number, passed: boolean, selectors: Array<{selector: string, matched: boolean, count: number}>}>}
 */
async function verifyComponentHit(cdp, selectors) {
  const results = [];

  // Use a single Runtime.evaluate call to query all selectors at once
  // and avoid intercepting returned objects as CDP handles.
  const selectorJson = JSON.stringify(selectors);
  const expression = `(() => {
    const sels = ${selectorJson};
    return sels.map((s) => {
      try {
        const count = document.querySelectorAll(s).length;
        return { selector: s, count };
      } catch { return { selector: s, count: 0 }; }
    });
  })()`;

  const raw = await evalInPage(cdp, expression);
  if (!Array.isArray(raw)) {
    return { score: 0, passed: false, selectors: [] };
  }

  for (const item of raw) {
    const count = Number(item.count) || 0;
    results.push({ selector: String(item.selector), matched: count > 0, count });
  }

  const total = results.length;
  const passedCount = results.filter((r) => r.matched).length;
  const score = total > 0 ? Math.round((passedCount / total) * 100) : 100;
  return { score, passed: passedCount === total, selectors: results };
}

/**
 * Runtime quality validation entry point.
 *
 * Performs three checks via CDP after theme injection:
 *   1. Contrast — sample text elements, verify WCAG AA (4.5:1).
 *   2. Overflow — detect horizontal scrollbar.
 *   3. Component hit — ensure key selectors match DOM elements.
 *
 * @param {{ send(method: string, params?: any) => Promise<any> }} cdp - The CDP connection.
 * @param {string[]} selectors - Critical selectors (e.g. ["#composer","#sidebar"]).
 * @param {object} [options] - Options.
 * @param {number} [options.sampleLimit] - Max elements for contrast sampling.
 * @param {number} [options.minRatio] - Minimum contrast ratio (default 4.5).
 * @returns {Promise<{component: object, contrast: object, viewport: object, overall: 'pass'|'fail', details: object}>}
 */
export async function validateRuntimeQuality(cdp, selectors, options = {}) {
  const [contrast, overflow, component] = await Promise.all([
    verifyContrast(cdp, options),
    detectHorizontalOverflow(cdp),
    verifyComponentHit(cdp, selectors),
  ]);

  const overall = contrast.passed && !overflow && component.passed ? 'pass' : 'fail';

  return {
    component,
    contrast,
    viewport: { passed: !overflow },
    overall,
    details: {
      contrastPassRate: contrast.score,
      contrastFailures: contrast.failedCount,
      viewportOverflow: overflow,
      componentMiss: component.selectors.filter((s) => !s.matched).length,
    },
  };
}

export default validateRuntimeQuality;
