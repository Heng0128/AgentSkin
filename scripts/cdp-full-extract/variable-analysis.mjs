// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — 变量分析
 *
 * 对提取的 CSS 变量进行分类、色板分析、API 指纹检测。
 */

import { isAgentVar } from './constants.mjs';

// ============== 变量分类 ==============

/**
 * 按语义角色分类 CSS 变量。
 * @param {Object} flatVars 展平的变量对象 { name: { value, selectors[] } }
 * @param {string} agentName Agent 名称（用于命名空间过滤）
 * @returns {Object} 分类后的变量
 */
export function categorizeVars(flatVars, agentName) {
  const categories = {
    color: [],
    bg: [],
    text: [],
    border: [],
    surface: [],
    accent: [],
    neutral: [],
    spacing: [],
    shadow: [],
    font: [],
    button: [],
    input: [],
    other: [],
  };
  const otherProps = {
    ignored: [],
  };

  const colorPattern =
    /color|bg|background|fill|stroke|surface|elevated|card|panel|modal|popover|tooltip|overlay|backdrop/i;
  const textPattern = /text|foreground|fg|label|muted|placeholder/i;
  const borderPattern = /border|separator|divider/i;
  const accentPattern = /accent|primary|brand|theme|focus|selection/i;
  const spacingPattern = /spacing|gap|margin|padding|size|width|height|radius|space/i;
  const shadowPattern = /shadow/i;
  const fontPattern = /font|family/i;
  const buttonPattern = /button|btn/i;
  const inputPattern = /input|editor|field/i;

  for (const [name, data] of Object.entries(flatVars)) {
    // A-17：命名空间过滤——非本 Agent 命名空间变量不参与归类。
    if (!isAgentVar(name, agentName)) {
      otherProps.ignored.push(name);
      continue;
    }

    const entry = { name, value: data.value, selectors: data.selectors };

    if (colorPattern.test(name)) {
      if (textPattern.test(name)) categories.text.push(entry);
      else if (borderPattern.test(name)) categories.border.push(entry);
      else if (
        accentPattern.test(name) ||
        (/#|rgb|hsl/.test(data.value) && accentPattern.test(name))
      ) {
        categories.accent.push(entry);
      } else if (fontPattern.test(name)) {
        categories.font.push(entry);
      } else if (buttonPattern.test(name)) {
        categories.button.push(entry);
      } else if (inputPattern.test(name)) {
        categories.input.push(entry);
      } else {
        categories.color.push(entry);
      }
    } else if (spacingPattern.test(name)) {
      categories.spacing.push(entry);
    } else if (shadowPattern.test(name)) {
      categories.shadow.push(entry);
    } else {
      categories.other.push(entry);
    }
  }

  if (otherProps.ignored.length > 0) categories._ignoredNamespaceVars = otherProps.ignored;

  return categories;
}

// ============== 色板分析 ==============

/**
 * 分析颜色使用频率。
 * @param {Object} flatVars 展平的变量对象
 * @returns {Array} 按频率排序的颜色数组
 */
export function analyzeColorPalette(flatVars) {
  const colorFreq = {};

  for (const [name, data] of Object.entries(flatVars)) {
    const colors = extractAllColors(data.value);
    for (const c of colors) {
      const normalized = c.toLowerCase();
      if (!colorFreq[normalized]) colorFreq[normalized] = { count: 0, vars: [] };
      colorFreq[normalized].count++;
      colorFreq[normalized].vars.push(name);
    }
  }

  const sorted = Object.entries(colorFreq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 60)
    .map(([color, data]) => ({ color, ...data }));

  return sorted;
}

/**
 * 从 CSS 值中提取所有颜色。
 */
function extractAllColors(value) {
  const colors = [];
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m;
  while ((m = hexRe.exec(value)) !== null) colors.push(m[0]);
  const funcRe = /(rgba?|hsla?)\([^)]+\)/g;
  while ((m = funcRe.exec(value)) !== null) colors.push(m[0]);
  return colors;
}

// ============== 运行时 API 指纹（审计 A-16）==============

/**
 * 检测页面是否 monkey-patch 了影响采样的关键 API。
 */
export async function probeApiFingerprint(client) {
  const expr = `(() => {
    const describe = (name, fn) => {
      const src = Function.prototype.toString.call(fn || (() => {}));
      return { present: !!fn, native: /\\[native code\\]/.test(src) };
    };
    const probe = typeof document !== 'undefined' ? document.createElement('div') : null;
    return {
      querySelectorAll: describe('querySelectorAll', document && document.querySelectorAll),
      getComputedStyle: describe('getComputedStyle', window && window.getComputedStyle),
      matchMedia: describe('matchMedia', window && window.matchMedia),
      getPropertyValue: describe('getPropertyValue', probe && probe.style && probe.style.getPropertyValue),
    };
  })()`;
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    const value = res?.result?.value;
    if (!value) return null;
    const fingerprint = Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, { present: v.present, native: v.native }]),
    );
    return {
      fingerprint,
      polluted: Object.keys(fingerprint).filter((k) => !fingerprint[k].native),
    };
  } catch {
    return null;
  }
}
