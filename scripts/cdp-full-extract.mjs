/**
 * CDP Full Extract - 完整 Agent 样式探针
 * 
 * 功能：
 * 1. 通过 CDP CSS Domain 获取所有样式表文本
 * 2. 解析亮/暗主题下的 CSS 变量原始定义
 * 3. 提取完整 DOM 结构（类名、标签、层级）
 * 4. 采样计算样式（颜色、字体、间距、阴影、圆角）
 * 5. 切换 prefers-color-scheme 捕获双主题数据
 * 6. 输出结构化 JSON 供 Theme Studio 使用
 * 
 * 用法：
 *   node scripts/cdp-full-extract.mjs --port 58360 --name codex --out agents-raw-data
 *   node scripts/cdp-full-extract.mjs --all  --out agents-raw-data
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ============== 配置 ==============
const AGENT_PORTS = {
  codex: 58360,
  doubao: 61607,
  qoderwork: 61996,
  traework: 54676,
  workbuddy: 52743,
  zcode: 65142,
};

const DEFAULT_MAX_DOM_NODES = 2000;
const DEFAULT_MAX_DEPTH = 12;
const THEME_SWITCH_WAIT = 600; // ms to wait after theme switch
const ORDERED_STYLE_PROPS = [
  // 颜色类
  'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color',
  'column-rule-color', 'fill', 'stroke',
  // 背景类
  'background-image', 'background-position', 'background-size', 'background-repeat',
  // 字体类
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-indent',
  // 间距类
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // 边框/圆角
  'border-width', 'border-style', 'border-radius', 'border-top-left-radius',
  'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  // 阴影
  'box-shadow', 'text-shadow',
  // 尺寸
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // 布局
  'display', 'position', 'flex-direction', 'justify-content', 'align-items',
  'gap', 'grid-template-columns', 'grid-template-rows',
  // 透明度/混合
  'opacity', 'mix-blend-mode', 'isolation',
  // 滤镜
  'filter', 'backdrop-filter',
  // 变换/动效
  'transform', 'transition', 'transition-duration', 'transition-timing-function',
  'animation', 'animation-duration',
  // 溢出/滚动
  'overflow', 'overflow-x', 'overflow-y',
  // 光标/指针
  'cursor', 'pointer-events', 'user-select',
  // 裁剪
  'clip-path', 'mask', 'mask-image',
  // 表格
  'border-collapse', 'border-spacing',
  // 列表
  'list-style', 'list-style-type',
];

// ============== CSS 解析器 ==============

/**
 * 从 CSS 文本中提取变量定义，按作用域分组
 * @param {string} cssText 
 * @returns {Object} { selector: [{ name, value, important }] }
 */
function extractVariablesFromCss(cssText) {
  const result = {};
  // 匹配 :root 规则块和其他包含 --var 的规则
  const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
  let match;
  
  while ((match = ruleRegex.exec(cssText)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    
    // 提取变量声明
    const varDeclRegex = /(--[a-zA-Z_][\w-]*)\s*:\s*([^;]+);/g;
    let varMatch;
    while ((varMatch = varDeclRegex.exec(body)) !== null) {
      const name = varMatch[1];
      const value = varMatch[2].trim();
      if (!result[selector]) result[selector] = [];
      result[selector].push({ name, value });
    }
  }
  
  return result;
}

/**
 * 判断选择器属于哪个主题 scheme
 */
function classifyScheme(selector, parentMedia = '') {
  const combined = (parentMedia + ' ' + selector).toLowerCase();
  
  // 暗色判断
  if (combined.includes('prefers-color-scheme: dark') || 
      combined.includes('[data-theme="dark"]') ||
      combined.includes('.dark') ||
      combined.includes('[data-mode="dark"]') ||
      combined.includes('.theme-dark')) {
    return 'dark';
  }
  
  // 亮色判断
  if (combined.includes('prefers-color-scheme: light') ||
      combined.includes('[data-theme="light"]') ||
      combined.includes('.light') ||
      combined.includes('[data-mode="light"]') ||
      combined.includes('.theme-light')) {
    return 'light';
  }
  
  return 'neutral'; // 不区分主题的默认变量
}

/**
 * 从 CSS 文本中提取所有 @media 块内的变量
 */
function extractVariablesWithMedia(cssText) {
  const result = { light: {}, dark: {}, neutral: {} };
  
  // 处理 @media 块
  const mediaRegex = /@media\s+([^{]+)\s*\{([\s\S]*?)(?=\n@media|\n\.[a-z]|\n:[a-z]|\n\}|$)/gi;
  let mediaMatch;
  let lastIndex = 0;
  const nonMediaParts = [];
  
  while ((mediaMatch = mediaRegex.exec(cssText)) !== null) {
    nonMediaParts.push(cssText.slice(lastIndex, mediaMatch.index));
    const mediaQuery = mediaMatch[1].trim();
    const mediaBody = mediaMatch[2];
    const scheme = classifyScheme('', mediaQuery);
    
    // 递归处理媒体块内部
    const innerVars = extractVariablesFromCss(mediaBody);
    for (const [sel, vars] of Object.entries(innerVars)) {
      const key = `@media ${mediaQuery} ${sel}`;
      if (!result[scheme][key]) result[scheme][key] = [];
      result[scheme][key].push(...vars);
    }
    lastIndex = mediaRegex.lastIndex;
  }
  
  // 处理非媒体部分的 CSS
  nonMediaParts.push(cssText.slice(lastIndex));
  const plainCss = nonMediaParts.join('\n');
  const plainVars = extractVariablesFromCss(plainCss);
  
  for (const [sel, vars] of Object.entries(plainVars)) {
    const scheme = classifyScheme(sel);
    if (!result[scheme][sel]) result[scheme][sel] = [];
    result[scheme][sel].push(...vars);
  }
  
  return result;
}

/**
 * 颜色值解析：提取所有颜色到一个展平列表
 */
function extractAllColors(value) {
  const colors = [];
  const hexRegex = /#([0-9a-fA-F]{3,8})\b/g;
  const rgbRegex = /rgba?\([^)]+\)/g;
  const hslRegex = /hsla?\([^)]+\)/g;
  const namedColors = [
    'transparent', 'inherit', 'initial', 'unset', 'currentColor',
    'white', 'black', 'red', 'green', 'blue', 'yellow', 'cyan', 'magenta',
    'grey', 'gray', 'orange', 'purple', 'pink', 'brown',
  ];
  
  let m;
  while ((m = hexRegex.exec(value)) !== null) {
    colors.push(m[0]);
  }
  while ((m = rgbRegex.exec(value)) !== null) {
    colors.push(m[0]);
  }
  while ((m = hslRegex.exec(value)) !== null) {
    colors.push(m[0]);
  }
  
  return colors;
}

// ============== CDP 客户端 ==============

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
  }
  
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WS error: ${e.message || 'connection failed'}`));
      this.ws.onmessage = (msg) => this._handleMessage(msg.data);
      setTimeout(() => reject(new Error('WS connect timeout')), 8000);
    });
  }
  
  _handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch { return; }
    
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method) || [];
      for (const h of handlers) h(msg.params);
    }
  }
  
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 10000);
    });
  }
  
  on(event, handler) {
    if (!this.eventHandlers.has(event)) this.eventHandlers.set(event, []);
    this.eventHandlers.get(event).push(handler);
  }
  
  close() {
    if (this.ws) this.ws.close();
  }
}

// ============== DOM 捕获 ==============

// Note: skip logic is now inline in Runtime.evaluate scripts

/**
 * 使用 Runtime.evaluate 在页面内执行 DOM 遍历 - 比 CDP DOM API 更可靠
 */
async function captureDomTree(client, maxNodes = 2000, maxDepth = 12) {
  const extractExpr = `
    (() => {
      const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD', 'TITLE', 'SVG', 'PATH', 'DEFS', 'CLIPPATH', 'USE', 'SYMBOL', 'G']);
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
          // 仅提取关键设计属性以控制体积
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
      return JSON.stringify({ root, total: count });
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
      // Normalize: ensure totalNodes property exists
      return { root: parsed.root, totalNodes: parsed.total || 0 };
    }
    
    // Fallback
    return { root: { t: 'html', d: 0 }, totalNodes: 1 };
  } catch (e) {
    console.warn(`  ⚠ DOM 捕获失败: ${e.message}`);
    return { root: { t: 'html', d: 0 }, totalNodes: 1 };
  }
}

// ============== 计算样式采样 ==============

async function sampleComputedStyles(client, maxNodes = 200) {
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

// ============== CSS 样式表捕获 ==============

async function captureAllStylesheets(client) {
  // 通过 Runtime.evaluate 从页面内获取所有样式表 + inline <style>
  const expr = `
    (() => {
      const sheets = [];
      // 1. document.styleSheets (受 CORS 限制)
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
      
      // 2. inline <style> 标签
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

/**
 * 获取 :root 元素上所有 CSS 自定义属性的计算值
 */
async function getRootComputedVariables(client) {
  const expr = `
    (() => {
      const cs = getComputedStyle(document.documentElement);
      const vars = {};
      // 遍历所有属性找到 CSS 变量
      for (let i = 0; i < cs.length; i++) {
        const prop = cs[i];
        if (prop.startsWith('--')) {
          const val = cs.getPropertyValue(prop);
          if (val && val.trim()) {
            vars[prop.trim()] = val.trim().slice(0, 200);
          }
        }
      }
      return JSON.stringify(vars);
    })()
  `;
  
  const { result } = await client.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  });
  
  try {
    return JSON.parse(result.value);
  } catch {
    return {};
  }
}

/**
 * 获取指定主题下 :root 的 CSS 变量值（先切换，再读，再恢复）
 */
async function getRootVariablesForTheme(client, scheme) {
  // 先记录当前 prefers-color-scheme
  const resetExpr = `
    (() => {
      // 移除临时类
      document.documentElement.classList.remove('__as_temp_light__', '__as_temp_dark__');
      return 'ok';
    })()
  `;
  
  // 注入临时样式来模拟 prefers-color-scheme
  // 安全转义：scheme 通过 JSON.stringify 注入，避免引号/特殊字符导致 JS 注入
  const safeScheme = JSON.stringify(scheme);
  const injectExpr = `
    (() => {
      const id = '__as_temp_scheme__';
      let style = document.getElementById(id);
      if (!style) {
        style = document.createElement('style');
        style.id = id;
        document.head.appendChild(style);
      }
      // 用 override 方式强制设置 data-theme 或类
      const html = document.documentElement;
      if (${safeScheme} === 'dark') {
        html.setAttribute('data-agentskin-scheme', 'dark');
        html.classList.add('__as_temp_dark__');
        html.classList.remove('__as_temp_light__');
      } else {
        html.setAttribute('data-agentskin-scheme', 'light');
        html.classList.add('__as_temp_light__');
        html.classList.remove('__as_temp_dark__');
      }
      return 'injected';
    })()
  `;
  
  try {
    await client.send('Runtime.evaluate', { expression: injectExpr, returnByValue: true });
    await sleep(50);
    const vars = await getRootComputedVariables(client);
    return vars;
  } catch {
    return {};
  } finally {
    try {
      await client.send('Runtime.evaluate', { expression: resetExpr, returnByValue: true });
    } catch {}
  }
}

// ============== 主题切换 ==============

async function setColorScheme(client, scheme) {
  try {
    await client.send('Emulation.enable');
  } catch {}
  
  try {
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    await sleep(THEME_SWITCH_WAIT);
    return true;
  } catch {
    return false;
  }
}

async function resetEmulatedMedia(client) {
  try {
    await client.send('Emulation.setEmulatedMedia', { features: [] });
  } catch {}
}

// ============== 工具函数 ==============

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function flattenVars(varGroups) {
  const flat = {};
  for (const [selector, vars] of Object.entries(varGroups)) {
    for (const { name, value } of vars) {
      if (!flat[name]) flat[name] = { value, selectors: [] };
      flat[name].selectors.push(selector);
    }
  }
  return flat;
}

function categorizeVars(flatVars) {
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
  
  const colorPattern = /color|bg|background|fill|stroke|surface|elevated|card|panel|modal|popover|tooltip|overlay|backdrop/i;
  const textPattern = /text|foreground|fg|label|muted|placeholder/i;
  const borderPattern = /border|separator|divider/i;
  const accentPattern = /accent|primary|brand|theme|focus|selection/i;
  const spacingPattern = /spacing|gap|margin|padding|size|width|height|radius|space/i;
  const shadowPattern = /shadow/i;
  const fontPattern = /font|family/i;
  const buttonPattern = /button|btn/i;
  const inputPattern = /input|editor|field/i;
  
  for (const [name, data] of Object.entries(flatVars)) {
    const entry = { name, value: data.value, selectors: data.selectors };
    
    if (colorPattern.test(name)) {
      if (textPattern.test(name)) categories.text.push(entry);
      else if (borderPattern.test(name)) categories.border.push(entry);
      else if (accentPattern.test(name) || (/#|rgb|hsl/.test(data.value) && accentPattern.test(name))) {
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
  
  return categories;
}

function analyzeColorPalette(flatVars) {
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
  
  // 排序
  const sorted = Object.entries(colorFreq)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 60)
    .map(([color, data]) => ({ color, ...data }));
  
  return sorted;
}

// ============== 主爬取流程 ==============

async function extractAgent(port, agentName, outputDir) {
  const wsUrl = `ws://127.0.0.1:${port}/json`;
  let wsDebugUrl = null;
  
  console.log(`\n--- 提取 ${agentName} (port: ${port}) ---`);
  
  // 先获取 websocket URL
  try {
    const http = await fetch(`http://127.0.0.1:${port}/json`);
    const targets = await http.json();
    // 找 page 类型 target
    const pageTarget = targets.find(t => t.type === 'page');
    if (pageTarget && pageTarget.webSocketDebuggerUrl) {
      wsDebugUrl = pageTarget.webSocketDebuggerUrl;
      console.log(`  找到 target: ${pageTarget.title || 'untitled'}`);
    }
  } catch (e) {
    console.error(`  ✗ 无法获取 target 列表: ${e.message}`);
    return null;
  }
  
  if (!wsDebugUrl) {
    console.error(`  ✗ 没有可用的 page target`);
    return null;
  }
  
  const client = new CdpClient(wsDebugUrl);
  
  try {
    await client.connect();
    console.log(`  ✓ CDP 连接成功`);
    
    // 启用必要域
    await client.send('Runtime.enable').catch(() => {});
    
    // ====== 1. 捕获所有样式表 ======
    console.log(`  → 提取样式表...`);
    const stylesheets = await captureAllStylesheets(client);
    console.log(`  ✓ 获取 ${stylesheets.length} 个样式表`);
    
    // 解析每个样式表的变量
    const allVarsByScheme = { dark: {}, light: {}, neutral: {} };
    const allCssTexts = [];
    
    for (const sheet of stylesheets) {
      if (sheet.cssText && !sheet.error) {
        allCssTexts.push(sheet.cssText);
        const parsed = extractVariablesWithMedia(sheet.cssText);
        for (const scheme of ['dark', 'light', 'neutral']) {
          for (const [sel, vars] of Object.entries(parsed[scheme])) {
            if (!allVarsByScheme[scheme][sel]) allVarsByScheme[scheme][sel] = [];
            allVarsByScheme[scheme][sel].push(...vars);
          }
        }
      }
    }
    
    // ====== 2. 根元素变量提取（当前主题） ======
    console.log(`  → 提取根元素 CSS 变量（当前主题）...`);
    const rootVarsDefault = await getRootComputedVariables(client);
    console.log(`  ✓ 当前主题根变量: ${Object.keys(rootVarsDefault).length} 个`);
    
    // ====== 3. 当前主题（默认态）的 DOM 和计算样式 ======
    console.log(`  → 捕获 DOM 树（默认态）...`);
    const domDefault = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
    console.log(`  ✓ 默认态 DOM: ${domDefault.totalNodes} 节点`);
    
    console.log(`  → 采样计算样式（默认态）...`);
    const computedDefault = await sampleComputedStyles(client, 300);
    console.log(`  ✓ 默认态采样: ${computedDefault.length} 节点`);
    
    // ====== 4. 切换暗色主题 ======
    console.log(`  → 切换到暗色主题...`);
    const darkOk = await setColorScheme(client, 'dark');
    let domDark = null, computedDark = null, rootVarsDark = {};
    
    if (darkOk) {
      console.log(`  ✓ 切换到暗色成功`);
      rootVarsDark = await getRootComputedVariables(client);
      console.log(`  ✓ 暗色根变量: ${Object.keys(rootVarsDark).length} 个`);
      domDark = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
      console.log(`  ✓ 暗色 DOM: ${domDark.totalNodes} 节点`);
      computedDark = await sampleComputedStyles(client, 300);
      console.log(`  ✓ 暗色采样: ${computedDark.length} 节点`);
    } else {
      console.log(`  ⚠ 暗色切换失败（可能 Agent 不响应 prefers-color-scheme）`);
    }
    
    // ====== 5. 切换亮色主题 ======
    console.log(`  → 切换到亮色主题...`);
    const lightOk = await setColorScheme(client, 'light');
    let domLight = null, computedLight = null, rootVarsLight = {};
    
    if (lightOk) {
      console.log(`  ✓ 切换到亮色成功`);
      rootVarsLight = await getRootComputedVariables(client);
      console.log(`  ✓ 亮色根变量: ${Object.keys(rootVarsLight).length} 个`);
      domLight = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
      console.log(`  ✓ 亮色 DOM: ${domLight.totalNodes} 节点`);
      computedLight = await sampleComputedStyles(client, 300);
      console.log(`  ✓ 亮色采样: ${computedLight.length} 节点`);
    } else {
      console.log(`  ⚠ 亮色切换失败（可能 Agent 不响应 prefers-color-scheme）`);
    }
    
    // 重置
    await resetEmulatedMedia(client);
    
    // ====== 5. 构建输出 ======
    // 合并根变量（root computed）到变量集合中，作为 "runtime" 数据
    const allVarsDark = { ...allVarsByScheme.dark };
    const allVarsLight = { ...allVarsByScheme.light };
    const allVarsNeutral = { ...allVarsByScheme.neutral };
    
    // 根变量用 ":root@runtime" 作为选择器
    if (Object.keys(rootVarsDefault).length > 0) {
      allVarsNeutral[':root@runtime'] = Object.entries(rootVarsDefault).map(([name, value]) => ({ name, value }));
    }
    if (Object.keys(rootVarsDark).length > 0) {
      allVarsDark[':root@runtime:dark'] = Object.entries(rootVarsDark).map(([name, value]) => ({ name, value }));
    }
    if (Object.keys(rootVarsLight).length > 0) {
      allVarsLight[':root@runtime:light'] = Object.entries(rootVarsLight).map(([name, value]) => ({ name, value }));
    }
    
    const result = {
      meta: {
        agent: agentName,
        port: port,
        extractedAt: new Date().toISOString(),
        wsDebugUrl,
      },
      rootVariables: {
        default: rootVarsDefault,
        dark: rootVarsDark,
        light: rootVarsLight,
      },
      variables: {
        dark: {
          grouped: allVarsDark,
          flat: flattenVars(allVarsDark),
        },
        light: {
          grouped: allVarsLight,
          flat: flattenVars(allVarsLight),
        },
        neutral: {
          grouped: allVarsNeutral,
          flat: flattenVars(allVarsNeutral),
        },
      },
      categories: {
        dark: categorizeVars(flattenVars(allVarsDark)),
        light: categorizeVars(flattenVars(allVarsLight)),
        neutral: categorizeVars(flattenVars(allVarsNeutral)),
      },
      colorPalette: {
        dark: analyzeColorPalette(flattenVars(allVarsDark)),
        light: analyzeColorPalette(flattenVars(allVarsLight)),
        neutral: analyzeColorPalette(flattenVars(allVarsNeutral)),
      },
      stylesheets: {
        count: stylesheets.length,
        sheets: stylesheets.map(s => ({
          href: s.href,
          type: s.type,
          ruleCount: s.ruleCount,
          hasError: !!s.error,
          textLength: s.cssText?.length || 0,
        })),
        // Preserve ALL CSS text (inline <style> + same-origin stylesheets) for Raw Preview reconstruction.
        // Electron apps often use document.adoptedStyleSheets (CSSStyleSheet API) rather than <style> tags.
        styleBlocks: stylesheets
          .filter(s => s.cssText && s.cssText.length > 50 && !s.error)
          .map(s => s.cssText)
          // De-duplicate by first 200 chars (some apps duplicate critical rules across sheets)
          .filter((txt, i, arr) => arr.findIndex(x => x.slice(0, 200) === txt.slice(0, 200)) === i)
          .slice(0, 50), // cap at 50 blocks per theme
      },
      dom: {
        default: domDefault.root,
        dark: domDark?.root || null,
        light: domLight?.root || null,
      },
      computedSample: {
        default: computedDefault,
        dark: computedDark,
        light: computedLight,
      },
      stats: {
        rootVars: {
          default: Object.keys(rootVarsDefault).length,
          dark: Object.keys(rootVarsDark).length,
          light: Object.keys(rootVarsLight).length,
        },
        domNodes: {
          default: domDefault.totalNodes,
          dark: domDark?.totalNodes || 0,
          light: domLight?.totalNodes || 0,
        },
        styleVars: {
          dark: Object.keys(flattenVars(allVarsDark)).length,
          light: Object.keys(flattenVars(allVarsLight)).length,
          neutral: Object.keys(flattenVars(allVarsNeutral)).length,
        },
        computedSamples: {
          default: computedDefault.length,
          dark: computedDark?.length || 0,
          light: computedLight?.length || 0,
        },
      },
    };
    
    // 保存
    const outPath = join(outputDir, `${agentName}-full-extract.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(`  💾 已保存到 ${outPath}`);
    console.log(`  📊 统计: vars(dark=${result.stats.styleVars.dark}, light=${result.stats.styleVars.light}, neutral=${result.stats.styleVars.neutral}) | rootVars(default=${result.stats.rootVars.default}, dark=${result.stats.rootVars.dark}, light=${result.stats.rootVars.light})`);
    
    return result;
    
  } catch (e) {
    console.error(`  ✗ 提取失败: ${e.message}`);
    return null;
  } finally {
    client.close();
  }
}

// ============== 入口 ==============

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outputDir = outIdx >= 0 ? args[outIdx + 1] : 'agents-raw-data';
  const useAll = args.includes('--all');
  
  const resolvedOut = resolve(outputDir);
  if (!existsSync(resolvedOut)) {
    mkdirSync(resolvedOut, { recursive: true });
  }
  
  let agentsToExtract = {};
  
  if (useAll) {
    agentsToExtract = AGENT_PORTS;
  } else {
    const portArg = args.indexOf('--port');
    const nameArg = args.indexOf('--name');
    if (portArg >= 0 && nameArg >= 0) {
      agentsToExtract[args[nameArg + 1]] = parseInt(args[portArg + 1]);
    } else {
      console.log('用法:');
      console.log('  node scripts/cdp-full-extract.mjs --all --out agents-raw-data');
      console.log('  node scripts/cdp-full-extract.mjs --port 58360 --name codex --out agents-raw-data');
      process.exit(1);
    }
  }
  
  console.log('=== CDP Full Extract ===');
  console.log(`目标: ${Object.keys(agentsToExtract).join(', ')}`);
  console.log(`输出: ${resolvedOut}`);
  console.log('');
  
  const results = {};
  for (const [name, port] of Object.entries(agentsToExtract)) {
    results[name] = await extractAgent(port, name, resolvedOut);
  }
  
  // 生成汇总
  const summary = {
    extractedAt: new Date().toISOString(),
    agents: {},
  };
  for (const [name, data] of Object.entries(results)) {
    if (data) {
      summary.agents[name] = {
        status: 'ok',
        styleVars: data.stats.styleVars,
        rootVars: data.stats.rootVars,
        domNodes: data.stats.domNodes,
        colorPaletteDark: data.colorPalette.dark?.length || 0,
        colorPaletteLight: data.colorPalette.light?.length || 0,
        colorPaletteNeutral: data.colorPalette.neutral?.length || 0,
      };
    } else {
      summary.agents[name] = { status: 'failed' };
    }
  }
  
  writeFileSync(join(resolvedOut, '_extract-summary.json'), JSON.stringify(summary, null, 2));
  console.log('\n=== 提取完成 ===');
  console.log(`汇总: ${join(resolvedOut, '_extract-summary.json')}`);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
