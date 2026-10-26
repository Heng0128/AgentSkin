// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — CSS 解析器
 *
 * 从 CSS 文本中提取变量定义，按作用域分组。
 */

/**
 * 从 CSS 文本中提取变量定义，按作用域分组
 * @param {string} cssText
 * @returns {Object} { selector: [{ name, value }] }
 */
export function extractVariablesFromCss(cssText) {
  const result = {};
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match = ruleRegex.exec(cssText);

  while (match !== null) {
    const selector = match[1].trim();
    const body = match[2];

    const varDeclRegex = /(--[a-zA-Z_][\w-]*)\s*:\s*([^;]+);/g;
    let varMatch = varDeclRegex.exec(body);
    while (varMatch !== null) {
      const name = varMatch[1];
      const value = varMatch[2].trim();
      if (!result[selector]) result[selector] = [];
      result[selector].push({ name, value });
      varMatch = varDeclRegex.exec(body);
    }
    match = ruleRegex.exec(cssText);
  }

  return result;
}

/**
 * 从 CSS 文本中提取变量，按主题方案分组（dark/light/neutral）
 * @param {string} cssText
 * @returns {Object} { dark: {}, light: {}, neutral: {} }
 */
export function extractVariablesWithMedia(cssText) {
  const result = { dark: {}, light: {}, neutral: {} };
  // 匹配 @media (prefers-color-scheme: dark/light) 块
  const mediaRegex = /@media\s*\(prefers-color-scheme:\s*(dark|light)\)\s*\{([\s\S]*?)\}/g;
  let mediaMatch = mediaRegex.exec(cssText);
  while (mediaMatch !== null) {
    const scheme = mediaMatch[1];
    const block = mediaMatch[2];
    const vars = extractVariablesFromCss(block);
    for (const [sel, entries] of Object.entries(vars)) {
      if (!result[scheme][sel]) result[scheme][sel] = [];
      result[scheme][sel].push(...entries);
    }
    mediaMatch = mediaRegex.exec(cssText);
  }
  // 提取非媒体查询的变量（neutral）
  const neutralVars = extractVariablesFromCss(cssText);
  for (const [sel, entries] of Object.entries(neutralVars)) {
    if (!result.neutral[sel]) result.neutral[sel] = [];
    result.neutral[sel].push(...entries);
  }
  return result;
}

/**
 * 从 CSS 值中提取所有颜色
 * @param {string} value
 * @returns {string[]} 颜色数组
 */
export function extractAllColors(value) {
  const colors = [];
  // 匹配 hex 颜色
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m = hexRe.exec(value);
  while (m !== null) {
    colors.push(m[0]);
    m = hexRe.exec(value);
  }
  // 匹配 rgb/rgba/hsl/hsla
  const funcRe = /(rgba?|hsla?)\([^)]+\)/g;
  m = funcRe.exec(value);
  while (m !== null) {
    colors.push(m[0]);
    m = funcRe.exec(value);
  }
  return colors;
}

/**
 * 展平变量分组为 { name: { value, selectors[] } }
 * @param {Object} varGroups
 * @returns {Object}
 */
export function flattenVars(varGroups) {
  const flat = {};
  for (const [selector, vars] of Object.entries(varGroups)) {
    for (const { name, value } of vars) {
      if (!flat[name]) flat[name] = { value, selectors: [] };
      flat[name].selectors.push(selector);
    }
  }
  return flat;
}
