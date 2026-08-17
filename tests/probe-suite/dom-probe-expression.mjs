// SPDX-License-Identifier: MPL-2.0

/**
 * dom-probe-expression.mjs — 构建 CDP 探测表达式
 *
 * 生成注入到渲染进程的 IIFE 表达式，采集：
 * 1. CSS 变量（:root 及各层级）
 * 2. DOM 结构（标签、类名、层级）
 * 3. 计算样式采样
 * 仅用于新建测试，不修改现有 cdp-full-extract.mjs。
 */

export function buildCssVariableProbe(namespaces = ['--*']) {
  const nsPattern = namespaces
    .map((ns) => ns.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');

  return `(() => {
    const result = { variables: {}, sources: [] };
    const seen = new Map();
    const nsPattern = /${nsPattern}/;

    function scanSheet(sheet, source) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        if (!rules) return;
        for (const rule of rules) {
          if (rule.style) {
            for (let i = 0; i < rule.style.length; i++) {
              const name = rule.style[i];
              if ((name.startsWith('--agentskin-') || nsPattern.test(name)) && !seen.has(name)) {
                seen.set(name, { source, declared: rule.style.getPropertyValue(name).trim() });
              }
            }
          }
          try {
            if (rule.cssRules) {
              for (const sub of rule.cssRules) {
                scanSheet({ cssRules: [sub], rules: [sub] }, source + ' > sub');
              }
            }
          } catch (e) { /* nested CORS */ }
        }
      } catch (e) {
        result.sources.push({ source, error: e.message });
      }
    }

    for (const sheet of document.styleSheets) {
      scanSheet(sheet, sheet.href || 'inline');
    }

    const rootStyle = getComputedStyle(document.documentElement);
    for (const [name, info] of seen) {
      info.computed = rootStyle.getPropertyValue(name).trim();
      result.variables[name] = info;
    }

    return result;
  })()`;
}

export function buildDomStructureProbe(maxNodes = 2000, maxDepth = 12) {
  return `(() => {
    const MAX_NODES = ${maxNodes};
    const MAX_DEPTH = ${maxDepth};
    const nodes = [];
    const tags = {};
    const classes = new Set();
    const ids = new Set();
    let totalElements = 0;
    let truncated = false;
    let openShadowRoots = 0;

    function walk(el, depth) {
      if (nodes.length >= MAX_NODES) { truncated = true; return; }
      if (depth > MAX_DEPTH) return;
      totalElements++;
      const tag = el.tagName?.toLowerCase() || '';
      tags[tag] = (tags[tag] || 0) + 1;
      if (el.id) ids.add(el.id);
      if (el.className && typeof el.className === 'string') {
        for (const cls of el.className.split(/\\s+/).filter(Boolean)) classes.add(cls);
      }
      if (el.shadowRoot) openShadowRoots++;
      nodes.push({
        tag, depth,
        childCount: el.children?.length || 0,
        hasShadow: !!el.shadowRoot,
        ...(el.id ? { id: el.id } : {}),
      });
      if (el.children) {
        for (const child of el.children) walk(child, depth + 1);
      }
    }

    walk(document.documentElement, 0);

    return {
      summary: {
        totalElements,
        recordedNodes: nodes.length,
        truncated,
        openShadowRoots,
        uniqueTags: Object.keys(tags).length,
        uniqueClasses: classes.size,
        uniqueIds: ids.size,
      },
      tags,
      sampleNodes: nodes.slice(0, 80),
      topClasses: Array.from(classes).slice(0, 120),
      topIds: Array.from(ids).slice(0, 60),
    };
  })()`;
}

export function buildComputedStyleSampleProbe(selectors) {
  const selectorArr = JSON.stringify(selectors);
  return `(() => {
    const SELECTORS = ${selectorArr};
    const PROPS = [
      'color', 'background-color', 'border-color',
      'background-image', 'font-family', 'font-size', 'font-weight',
      'line-height', 'border-radius', 'box-shadow',
      'display', 'position'
    ];
    const samples = {};
    for (const sel of SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (!el) { samples[sel] = { found: false }; continue; }
        const cs = getComputedStyle(el);
        const props = {};
        for (const p of PROPS) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'normal' && v !== '0px') props[p] = v;
        }
        samples[sel] = { found: true, props, tag: el.tagName?.toLowerCase() };
      } catch (e) {
        samples[sel] = { found: false, error: e.message };
      }
    }
    return samples;
  })()`;
}
