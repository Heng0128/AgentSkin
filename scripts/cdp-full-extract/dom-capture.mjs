// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — DOM 捕获
 *
 * 通过 CDP 捕获 DOM 树、采样计算样式、遍历帧树。
 */

import { ORDERED_STYLE_PROPS } from './constants.mjs';

// ============== DOM 树捕获 ==============

/**
 * 使用 Runtime.evaluate 在页面内执行 DOM 遍历 - 比 CDP DOM API 更可靠
 */
export async function captureDomTree(client, maxNodes = 2000, maxDepth = 12) {
  const extractExpr = `
    (() => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'BASE', 'HEAD', 'TITLE', 'SVG', 'PATH', 'DEFS', 'CLIPPATH', 'USE', 'SYMBOL', 'G']);
      const maxNodes = ${maxNodes};
      const maxDepth = ${maxDepth};
      let count = 0;
      
      function walk(el, depth) {
        if (count >= maxNodes || depth > maxDepth) return null;
        if (!el || !el.tagName) return null;
        if (SKIP.has(el.tagName)) return null;
        count++;
        
        const node = {
          t: el.tagName.toLowerCase(),
          d: depth,
        };
        
        // 收集关键属性
        if (el.className && typeof el.className === 'string' && el.className.trim()) {
          node.c = el.className.trim().slice(0, 120);
        }
        if (el.id) node.i = el.id;
        if (el.getAttribute) {
          const role = el.getAttribute('role');
          if (role) node.r = role;
          const theme = el.getAttribute('data-theme') || el.getAttribute('data-mode');
          if (theme) node.m = theme;
        }
        
        // 文本节点
        if (el.children && el.children.length === 0 && el.textContent) {
          const txt = el.textContent.trim();
          if (txt && txt.length <= 60) node.x = txt;
        }
        
        // 计算样式
        try {
          const cs = getComputedStyle(el);
          const s = {};
          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') s.bg = cs.backgroundColor;
          if (cs.color) s.fg = cs.color;
          if (cs.borderColor && cs.borderColor !== cs.color) s.bc = cs.borderColor;
          if (cs.borderRadius && cs.borderRadius !== '0px') s.br = cs.borderRadius;
          if (cs.boxShadow && cs.boxShadow !== 'none') s.bs = cs.boxShadow.slice(0, 100);
          if (cs.fontFamily) s.ff = cs.fontFamily.slice(0, 60);
          if (cs.fontSize) s.fs = cs.fontSize;
          if (cs.fontWeight && cs.fontWeight !== '400' && cs.fontWeight !== 'normal') s.fw = cs.fontWeight;
          if (cs.padding && cs.padding !== '0px') s.p = cs.padding;
          if (cs.margin && cs.margin !== '0px') s.mg = cs.margin;
          if (cs.gap && cs.gap !== '0px') s.gap = cs.gap;
          if (cs.display && cs.display !== 'block') s.dp = cs.display;
          if (cs.position && cs.position !== 'static') s.pos = cs.position;
          if (cs.opacity && cs.opacity !== '1') s.op = cs.opacity;
          if (cs.filter && cs.filter !== 'none') s.flt = cs.filter.slice(0, 80);
          if (cs.backdropFilter && cs.backdropFilter !== 'none') s.bdf = cs.backdropFilter.slice(0, 80);
          if (cs.transition && cs.transition !== 'all 0s ease 0s') s.tr = cs.transition.slice(0, 80);
          if (Object.keys(s).length > 0) node.s = s;
        } catch {}
        
        // 遍历子节点（含 open shadow DOM）
        if (el.children) {
          const kids = [];
          for (let i = 0; i < el.children.length && count < maxNodes; i++) {
            const child = walk(el.children[i], depth + 1);
            if (child) kids.push(child);
          }
          if (kids.length > 0) node.ch = kids;
        }
        
        // 穿透 open shadow root
        if (el.shadowRoot && el.shadowRoot.mode === 'open') {
          const kids = node.ch || [];
          for (let i = 0; i < el.shadowRoot.children.length && count < maxNodes; i++) {
            const child = walk(el.shadowRoot.children[i], depth + 1);
            if (child) kids.push(child);
          }
          if (kids.length > 0) node.ch = kids;
        }
        
        return node;
      }
      
      const root = walk(document.documentElement, 0);
      return JSON.stringify({ root, total: count, truncated: count >= maxNodes });
    })()
  `;

  try {
    const { result } = await client.send('Runtime.evaluate', {
      expression: extractExpr,
      returnByValue: true,
      timeout: 15000,
    });

    if (result.value) {
      const parsed = JSON.parse(result.value);
      return {
        root: parsed.root,
        totalNodes: parsed.total || 0,
        truncated: parsed.truncated === true,
      };
    }

    return { root: { t: 'html', d: 0 }, totalNodes: 1, truncated: false };
  } catch (e) {
    console.warn(`  ⚠ DOM 捕获失败: ${e.message}`);
    return { root: { t: 'html', d: 0 }, totalNodes: 1, truncated: false };
  }
}

// ============== 计算样式采样 ==============

export async function sampleComputedStyles(client, maxNodes = 200, contextId) {
  const expr = `
    (() => {
      const props = ${JSON.stringify(ORDERED_STYLE_PROPS)};
      const results = [];
      const elements = document.querySelectorAll('*');
      const sampled = Math.min(elements.length, ${maxNodes});
      const step = Math.max(1, Math.floor(elements.length / sampled));
      
      const seen = new Set();
      for (let i = 0; i < elements.length && results.length < sampled; i += step) {
        const el = elements[i];
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'HEAD') continue;
        if (el.offsetParent === null && el.tagName !== 'BODY' && getComputedStyle(el).position !== 'fixed') continue;
        
        const cs = getComputedStyle(el);
        const entry = { tag: el.tagName.toLowerCase(), cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 60) : '' };
        const styles = {};
        
        for (const p of props) {
          const v = cs.getPropertyValue(p);
          if (v && v !== 'none' && v !== 'auto' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') {
            styles[p] = v;
          }
        }
        
        if (Object.keys(styles).length > 0) {
          entry.style = styles;
          results.push(entry);
        }
      }
      
      return JSON.stringify(results);
    })()
  `;

  const evaluateParams = { expression: expr, returnByValue: true };
  if (contextId != null) evaluateParams.contextId = contextId;

  const { result } = await client.send('Runtime.evaluate', evaluateParams);

  try {
    return JSON.parse(result.value);
  } catch {
    return [];
  }
}

// ============== 帧树遍历 & 帧级隔离采样（A-22）==============

/**
 * 将 CDP Page.getFrameTree 的嵌套 tree 拍平为有序数组（DFS）。
 * 纯函数，便于单测。
 */
export function flattenFrameTree(tree) {
  const out = [];
  if (!tree?.frame) return out;
  (function walk(node, parentId) {
    const f = node.frame || {};
    out.push({
      frameId: f.id ?? f.frameId ?? '',
      parentId: parentId ?? null,
      url: f.url ?? '',
      securityOrigin: f.securityOrigin ?? '',
      unreachableUrl: f.unreachableUrl ?? undefined,
    });
    for (const child of node.childFrames || []) walk(child, f.id ?? f.frameId);
  })(tree, null);
  return out;
}

/**
 * 枚举当前 target 的帧树（Page.enable + Page.getFrameTree）。
 */
export async function enumerateFrames(client) {
  try {
    await client.send('Page.enable').catch(() => {});
    const frameTree = await client.send('Page.getFrameTree');
    return flattenFrameTree(frameTree?.frameTree);
  } catch {
    return [];
  }
}

/**
 * 对每个子 frame 创建隔离 world 并独立采样。
 */
export async function sampleChildFrames(client, frames) {
  if (frames.length <= 1) return [];
  const results = [];
  for (const fr of frames.slice(1)) {
    let contextId = null;
    try {
      const world = await client.send('Page.createIsolatedWorld', {
        frameId: fr.frameId,
        worldName: 'agentskin-frame-sample',
        grantUniversalAccess: true,
      });
      contextId = world?.executionContextId;
    } catch {
      contextId = null;
    }
    if (contextId == null) {
      results.push({ ...fr, sampled: 0, totalNodes: 0, error: 'createIsolatedWorld failed' });
      continue;
    }
    try {
      const countExpr = await client.send('Runtime.evaluate', {
        expression: 'document.querySelectorAll("*").length',
        returnByValue: true,
        contextId,
      });
      const totalNodes = Number(countExpr?.value ?? 0);
      const samples = await sampleComputedStyles(client, 60, contextId);
      results.push({ ...fr, sampled: samples.length, totalNodes, samples });
    } catch (e) {
      results.push({ ...fr, sampled: 0, totalNodes: 0, error: String(e?.message ?? e) });
    }
  }
  return results;
}

// ============== 样式表捕获 ==============

export async function captureAllStylesheets(client) {
  const expr = `
    (() => {
      const sheets = [];
      for (const sheet of document.styleSheets) {
        let info = { href: sheet.href || null, type: 'stylesheet', ruleCount: 0, cssText: '', error: null };
        try {
          if (sheet.cssRules) {
            info.ruleCount = sheet.cssRules.length;
            const rules = [];
            for (let i = 0; i < sheet.cssRules.length; i++) {
              rules.push(sheet.cssRules[i].cssText);
            }
            info.cssText = rules.join('\\n');
          }
        } catch (e) {
          info.error = 'CORS: ' + e.message;
        }
        sheets.push(info);
      }
      
      for (const styleEl of document.querySelectorAll('style')) {
        let info = { type: 'inline-style', ruleCount: 0, cssText: (styleEl.textContent || '').slice(0, 20000), error: null };
        if (info.cssText) {
          info.ruleCount = (info.cssText.match(/\\{/g) || []).length;
        }
        sheets.push(info);
      }
      
      return JSON.stringify(sheets);
    })()
  `;

  const { result } = await client.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  });

  try {
    return JSON.parse(result.value);
  } catch {
    return [];
  }
}
