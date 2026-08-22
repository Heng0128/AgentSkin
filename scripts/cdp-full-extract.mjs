// SPDX-License-Identifier: MPL-2.0
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

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  findRunningPids,
  findTargets,
  getAdapter,
  listAdapters,
  resolveDebugPorts,
} from '../src/engine/src/index.mjs';

const execFileAsync = promisify(execFile);

// ============== 配置 ==============
// 端口不再硬编码——复用项目的三层发现策略（DevToolsActivePort 文件 → PID argv → netstat
// → /json/list + matchTarget），与 src/shared/cdp-discovery.ts 的 resolveLivePort
// 同源，避免维护过期端口表。

const DEFAULT_MAX_DOM_NODES = 2000;
const DEFAULT_MAX_DEPTH = 24;
const THEME_SWITCH_WAIT = 600; // ms to wait after theme switch

// ============== per-Agent 时序配置表（审计 A-11 / R-21） ==============
// 各 Agent 可独立配置主题切换等待、连接/命令超时与连接重试；
// 缺省项回退到 DEFAULT_TIMING。resolveAgentTiming(agentId) 为默认 ⊳ 分表三级解析入口。
const DEFAULT_TIMING = {
  themeSwitchWait: 600, // 主题切换后等待重渲染
  connectTimeout: 8000, // WS 连接超时
  commandTimeout: 10000, // 单条 CDP 命令超时
  evalTimeout: 15000, // Runtime.evaluate 超时
  retry: 1, // 连接失败重试次数
};

const AGENT_TIMING = {
  traework: { themeSwitchWait: 700, commandTimeout: 12000 },
  doubao: { themeSwitchWait: 800, evalTimeout: 18000 },
  codex: { retry: 2 },
  qoderwork: {},
  workbuddy: {},
  zcode: {},
};

/** 解析某 Agent 的时序参数 = DEFAULT_TIMING ⊳ AGENT_TIMING[agentId]。 */
export function resolveAgentTiming(agentId) {
  return { ...DEFAULT_TIMING, ...(AGENT_TIMING[agentId] ?? {}) };
}
const ORDERED_STYLE_PROPS = [
  // 颜色类
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'column-rule-color',
  'fill',
  'stroke',
  // 背景类
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  // 字体类
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  // 间距类
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  // 边框/圆角
  'border-width',
  'border-style',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  // 阴影
  'box-shadow',
  'text-shadow',
  // 尺寸
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // 布局
  'display',
  'position',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  // 透明度/混合
  'opacity',
  'mix-blend-mode',
  'isolation',
  // 滤镜
  'filter',
  'backdrop-filter',
  // 变换/动效
  'transform',
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'animation-duration',
  // 溢出/滚动
  'overflow',
  'overflow-x',
  'overflow-y',
  // 光标/指针
  'cursor',
  'pointer-events',
  'user-select',
  // 裁剪
  'clip-path',
  'mask',
  'mask-image',
  // 表格
  'border-collapse',
  'border-spacing',
  // 列表
  'list-style',
  'list-style-type',
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
  let match = ruleRegex.exec(cssText);

  while (match !== null) {
    const selector = match[1].trim();
    const body = match[2];

    // 提取变量声明
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
 * 判断选择器属于哪个主题 scheme
 */
function classifyScheme(selector, parentMedia = '') {
  const combined = `${parentMedia} ${selector}`.toLowerCase();

  // 暗色判断
  if (
    combined.includes('prefers-color-scheme: dark') ||
    combined.includes('[data-theme="dark"]') ||
    combined.includes('.dark') ||
    combined.includes('[data-mode="dark"]') ||
    combined.includes('.theme-dark')
  ) {
    return 'dark';
  }

  // 亮色判断
  if (
    combined.includes('prefers-color-scheme: light') ||
    combined.includes('[data-theme="light"]') ||
    combined.includes('.light') ||
    combined.includes('[data-mode="light"]') ||
    combined.includes('.theme-light')
  ) {
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

  mediaMatch = mediaRegex.exec(cssText);
  while (mediaMatch !== null) {
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
    mediaMatch = mediaRegex.exec(cssText);
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
  const _namedColors = [
    'transparent',
    'inherit',
    'initial',
    'unset',
    'currentColor',
    'white',
    'black',
    'red',
    'green',
    'blue',
    'yellow',
    'cyan',
    'magenta',
    'grey',
    'gray',
    'orange',
    'purple',
    'pink',
    'brown',
  ];

  let m = hexRegex.exec(value);
  while (m !== null) {
    colors.push(m[0]);
    m = hexRegex.exec(value);
  }
  m = rgbRegex.exec(value);
  while (m !== null) {
    colors.push(m[0]);
    m = rgbRegex.exec(value);
  }
  m = hslRegex.exec(value);
  while (m !== null) {
    colors.push(m[0]);
    m = hslRegex.exec(value);
  }

  return colors;
}

// ============== CDP 客户端 ==============

class CdpClient {
  constructor(wsUrl, opts = {}) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.eventHandlers = new Map();
    // per-Agent 时序（审计 A-11）：连接/命令超时可按 Agent 独立配置，缺省回退 DEFAULT_TIMING。
    this.connectTimeout = opts.connectTimeout ?? DEFAULT_TIMING.connectTimeout;
    this.commandTimeout = opts.commandTimeout ?? DEFAULT_TIMING.commandTimeout;
    this.timing = opts.timing ?? null; // 供 themeSwitchWait 等非连接参数读取
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WS error: ${e.message || 'connection failed'}`));
      this.ws.onmessage = (msg) => this._handleMessage(msg.data);
      setTimeout(() => reject(new Error('WS connect timeout')), this.connectTimeout);
    });
  }

  _handleMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

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
      }, this.commandTimeout);
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
      // A-09/A-21：统一 truncated 语义 —— true 表示命中节点数上限、DOM 输出不完整
      //（与 dom-snapshot.mjs 的 summary.truncated 含义一致，供下游基线比对避开伪漂移）。
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
      // Normalize: ensure totalNodes property exists
      return {
        root: parsed.root,
        totalNodes: parsed.total || 0,
        truncated: parsed.truncated === true,
      };
    }

    // Fallback
    return { root: { t: 'html', d: 0 }, totalNodes: 1, truncated: false };
  } catch (e) {
    console.warn(`  ⚠ DOM 捕获失败: ${e.message}`);
    return { root: { t: 'html', d: 0 }, totalNodes: 1, truncated: false };
  }
}

// ============== 计算样式采样 ==============

async function sampleComputedStyles(client, maxNodes = 200, contextId) {
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
  // A-22：传入 contextId 时在指定 frame 的隔离 world 采样（多 iframe 场景独立采样不交叉）。
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
 *
 * @param {object|undefined} tree 形如 { frame, childFrames: [] }
 * @returns {Array<{frameId: string, parentId: string|null, url: string, securityOrigin: string, unreachableUrl?: string}>}
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
 * 枚举当前 target 的帧树（Page.enable + Page.getFrameTree）。仅主文档时返回 1 帧，
 * 多 iframe（含同 URL 不同状态）时返回全部 child frame。
 * @returns {Promise<Array>} 帧信息数组；失败时回退为单帧占位。
 */
async function enumerateFrames(client) {
  try {
    await client.send('Page.enable').catch(() => {});
    const frameTree = await client.send('Page.getFrameTree');
    return flattenFrameTree(frameTree?.frameTree);
  } catch {
    return []; // 无法枚举时按无帧处理（走主 frame 现有路径）
  }
}

/**
 * 对每个子 frame 创建隔离 world 并独立采样，产出 frameId 标签的样式样本。
 * 仅适用于多帧场景（同窗口多 iframe 同 URL 不同状态 → 隔离不交叉）。
 * 主 frame 不在此重复采样（已由 sampleComputedStyles 主流程覆盖）。
 *
 * @param {Object} client CDP 客户端
 * @param {Array} frames enumerateFrames 的结果
 * @returns {Promise<Array>} [{ frameId, url, securityOrigin, sampled, totalNodes, error? }]
 */
async function sampleChildFrames(client, frames) {
  if (frames.length <= 1) return []; // 单帧：不重复、零行为变化
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
 * 获取根主题变量。策略为「聚合」而非单一宿主：
 *
 * 1. `documentElement` 的计算变量（覆盖 `:root` 规则 / html inline / 继承）。非空即返回 —— 这是
 *    绝大多数 agent（codex/doubao/traework/zcode）的形态。
 * 2. 若为 0（或 `!fallback` 被关闭），聚合三路来源，解决 VS Code 家族（WorkBuddy/QoderWork）
 *    变量按组件分散内联在多个 slot 元素 + stylesheet 规则里的问题：
 *    - 全 DOM（含 open shadowRoot）元素的 inline `style` 里的 `--var`
 *    - `document.styleSheets` 中 `:root` / `body` 选择器下声明的 `--var`
 *    聚合按「首次出现即保留」合并，附 `__host` 元信息标识来源形态，供上层区分
 *    「:root 原生」/「VS Code 聚合」/「真无变量」。
 */
export async function getRootComputedVariables(client, fallback = true) {
  const expr = `
    (() => {
      const cap = (s) => (s && s.trim()) ? s.trim().slice(0, 200) : null;
      const vars = {};
      const put = (k, v) => { if (v != null && vars[k] == null) vars[k] = v; };
      const collectComputed = (el) => { const cs = getComputedStyle(el); for (let i = 0; i < cs.length; i++) { const p = cs[i]; if (p.startsWith('--')) put(p.trim(), cap(cs.getPropertyValue(p))); } };
      // 1) documentElement 计算变量：覆盖 :root 规则 / html inline / var() 继承值。
      //    对 codex/doubao/traework/zcode 等即完整主题变量集，走原生快路径返回。
      collectComputed(document.documentElement);
      const rootCount = Object.keys(vars).length;
      if (rootCount && ${String(fallback)}) return JSON.stringify(vars);
      // 2) documentElement 为空 或 fallback=false → 聚合三路来源。VS Code 家族
      //    （WorkBuddy/QoderWork）的变量按组件分散在 slot 的 inline style 与样式表
      //    规则里，不集中在 :root；仅靠 documentElement 会误判为「无变量」。
      const inlineRe = /(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;]*)/g;
      for (const el of document.querySelectorAll('*')) {
        const st = (el.getAttribute && el.getAttribute('style')) || '';
        if (!st.includes('--')) continue;
        let m; inlineRe.lastIndex = 0;
        while ((m = inlineRe.exec(st)) !== null) { put(m[1].trim(), cap(m[2])); }
      }
      // 3) stylesheet :root/body 规则里的变量声明
      const tryRules = (sheets) => {
        for (const sheet of sheets) {
          let rules; try { rules = sheet.cssRules || sheet.rules; } catch { continue; }
          if (!rules) continue;
          for (const r of rules) {
            if (r.type) { try { const er = r.cssRules || r.rules; if (er) tryRules([{ cssRules: er }]); } catch {} }
            try {
              if (!r.selectorText) continue;
              if (!/:root|^body|^html/i.test(r.selectorText)) continue;
              const hr = /(--[a-zA-Z0-9_-]+)\\s*:\\s*([^;{}]*)/g;
              let m; while ((m = hr.exec(r.style.cssText)) !== null) put(m[1].trim(), cap(m[2]));
            } catch {}
          }
        }
      };
      tryRules(document.styleSheets);
      const totalCount = Object.keys(vars).length;
      const hostKind = totalCount === 0
        ? 'none'
        : (rootCount === 0 ? 'aggregated-inline-or-rules' : 'merged-root-plus-distributed');
      const out = { ...vars };
      out['__host'] = JSON.stringify({ kind: hostKind, n: Object.keys(vars).length });
      return JSON.stringify(out);
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

/** 排除诊断键 `__host` 后的 CSS 变量条目数。 */
function rootVarsCount(vars) {
  let n = 0;
  for (const k of Object.keys(vars)) {
    if (k !== '__host') n++;
  }
  return n;
}

/** 排除诊断键 `__host` 后的 entries（供 allVars 归一化）。 */
function rootVarsEntries(vars) {
  return Object.entries(vars).filter(([k]) => k !== '__host');
}
async function _getRootVariablesForTheme(client, scheme) {
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

// A-14：在 documentElement 上安装 MutationObserver，观测 style/class 变更以驱动主题重采。
// 采用「先安装、后切换」两段式：切换引起的根样式变更一旦被观测到即视为重采信号，
// 比固定 sleep 更准确；安装失败时回退到固定等待（零行为变化）。
const INSTALL_ROOT_OBSERVER = `(() => {
  try {
    window.__agentskinRootDirty = false;
    const root = document.documentElement;
    if (window.__agentskinRootObserver) window.__agentskinRootObserver.disconnect();
    window.__agentskinRootObserver = new MutationObserver(() => {
      window.__agentskinRootDirty = true;
    });
    window.__agentskinRootObserver.observe(root, {
      attributes: true,
      attributeFilter: ['style', 'class', 'data-theme', 'data-mode'],
      subtree: false,
      childList: false,
    });
    return true;
  } catch { return false; }
})()`;

async function installRootObserver(client) {
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: INSTALL_ROOT_OBSERVER,
      returnByValue: true,
    });
    return res?.result?.value === true;
  } catch {
    return false;
  }
}

async function waitRootMutation(client, waitMs) {
  const expr = `(() => {
    const deadline = Date.now() + ${waitMs};
    return new Promise((resolve) => {
      const tick = () => {
        if (window.__agentskinRootDirty === true) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, 40);
      };
      tick();
    });
  })()`;
  try {
    const res = await client.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    return res?.result?.value === true;
  } catch {
    return null;
  }
}

async function setColorScheme(client, scheme, waitMs = THEME_SWITCH_WAIT) {
  try {
    await client.send('Emulation.enable');
  } catch {}

  try {
    // A-14：切换前先装观察器，切换后由根变更信号驱动重采等待。
    await installRootObserver(client);
    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: scheme }],
    });
    const mutated = await waitRootMutation(client, waitMs);
    // 观察器未生效（null）或未触发时回退到固定等待，确保不缩短既有时序。
    if (mutated !== true) await sleep(waitMs);
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
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// ============== per-Agent 变量命名空间白名单（审计 A-17） ==============
// 各 Agent 的 CSS 变量归属其自有设计 token 命名空间（--vscode-* / --text-* / --wb-* /
// --cb-* / --dbx-* …）。categorizeVars 仅对白名单前缀内的变量做角色归类，命名空间外的
// 三方库 / UI 框架变量一律过滤，避免用无关变量污染主题分析（如同一页面里的第三方组件库主题）。
// 前缀以 `--` 开头（不含结尾通配符）；缺省 Agent 未登记时回退到 AGENT_VAR_NAMESPACE_DEFAULT
// （保留全部 --* 变量，等价于既有全量归类行为，零行为变化）。
const AGENT_VAR_NAMESPACES = {
  codex: ['--text-', '--bg-', '--border-'],
  vscode: ['--vscode-'],
  workbuddy: ['--wb-'],
  zcode: ['--cv-', '--zcode-'],
  qoderwork: ['--vs-', '--vscode-'],
  doubao: ['--dbx-', '--db-'],
  traework: ['--tw-'],
};
const AGENT_VAR_NAMESPACE_DEFAULT = ['--'];

function isAgentVar(name, agentName) {
  const prefixes = AGENT_VAR_NAMESPACES[agentName] ?? AGENT_VAR_NAMESPACE_DEFAULT;
  return prefixes.some((p) => name.startsWith(p));
}

function categorizeVars(flatVars, agentName) {
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

  // 把被过滤变量数挂到 categories 上，供审计/调用方知晓过滤强度（不改变归类主结构）。
  if (otherProps.ignored.length > 0) categories._ignoredNamespaceVars = otherProps.ignored;

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

// ============== 运行时 API 指纹（审计 A-16） ==============
// 检测页面是否 monkey-patch 了影响采样的关键 API。被应用污染（非原生实现）意味着
// CDP 采样读取到的可能是被篡改后的结果，需标记供下游与该 Agent 的 baseline 判定交叉印证。
async function probeApiFingerprint(client) {
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

// ============== 端口发现（复用项目策略，见 src/shared/cdp-discovery.ts） ==============
// 三层链路：DevToolsActivePort 文件（resolveDebugPorts）→ PID argv（wmic）→ netstat 回环。
// 每层都以 findTargets（/json/list + adapter.matchTarget）确认为准。

async function probeTargetsOnPort(adapter, port) {
  try {
    const targets = await findTargets(adapter, port, 1200);
    return targets.length ? targets : null;
  } catch {
    return null;
  }
}

async function explicitPortsFromPids(pids) {
  if (process.platform !== 'win32' || !pids.length) return [];
  let out = '';
  try {
    out = String(
      (await execFileAsync('wmic', ['process', 'get', 'processid,commandline', '/format:list']))
        .stdout ?? '',
    );
  } catch {
    return [];
  }
  const wanted = new Set(pids);
  const ports = [];
  for (const block of out.split(/\r?\n\s*\r?\n/)) {
    const pidMatch = /ProcessId=(\d+)/.exec(block);
    if (!pidMatch || !wanted.has(Number(pidMatch[1]))) continue;
    const cli = /CommandLine=(.*)/s.exec(block)?.[1];
    if (!cli) continue;
    const port = /--remote-debugging-port=(\d+)/.exec(cli)?.[1];
    if (port && Number(port) >= 1024 && Number(port) <= 65535) ports.push(Number(port));
  }
  return [...new Set(ports)].sort((a, b) => a - b);
}

async function listeningPortsForPids(pids) {
  if (process.platform !== 'win32' || !pids.length) return [];
  let out = '';
  try {
    out = String((await execFileAsync('netstat', ['-ano'])).stdout ?? '');
  } catch {
    return [];
  }
  const wanted = new Set(pids.map(String));
  const ports = new Set();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line.includes('LISTENING')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    if (!wanted.has(parts[parts.length - 1])) continue;
    const local = parts[1];
    if (!local.startsWith('127.0.0.1:') && !local.startsWith('[::1]:')) continue;
    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    const port = Number(local.slice(colon + 1));
    if (port >= 1024 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

/**
 * 复用项目 CDP 端口发现策略，返回 { port, adapter, targets }。
 * 显式 --port 时仅验证并返回；否则走三层自动发现。
 */
async function discoverLivePort(agentName, explicitPort = null) {
  const adapter = getAdapter(agentName);
  if (explicitPort) {
    const tagets = await probeTargetsOnPort(adapter, explicitPort);
    if (tagets) return { port: explicitPort, adapter, targets: tagets };
    throw new Error(`[${agentName}] 显式端口 ${explicitPort} 无匹配 CDP target`);
  }

  // Layer 1: DevToolsActivePort 文件
  const filePorts = await resolveDebugPorts(adapter, process.platform);
  for (const port of filePorts) {
    const targets = await probeTargetsOnPort(adapter, port);
    if (targets) {
      console.log(`  ${agentName}: layer 1 (DevToolsActivePort 文件) — CDP on ${port}`);
      return { port, adapter, targets };
    }
  }

  // Layer 2: PID argv + netstat
  try {
    const pids = await findRunningPids(adapter, process.platform, null);
    const explicitPorts = await explicitPortsFromPids(pids);
    for (const port of explicitPorts) {
      const targets = await probeTargetsOnPort(adapter, port);
      if (targets) {
        console.log(`  ${agentName}: layer 2 (argv) — CDP on ${port}`);
        return { port, adapter, targets };
      }
    }
    const netstatPorts = await listeningPortsForPids(pids);
    for (const port of netstatPorts) {
      if (explicitPorts.includes(port)) continue;
      const targets = await probeTargetsOnPort(adapter, port);
      if (targets) {
        console.log(`  ${agentName}: layer 2 (netstat) — CDP on ${port}`);
        return { port, adapter, targets };
      }
    }
  } catch {
    // 进程探测尽力而为
  }

  throw new Error(
    `[${agentName}] 未发现存活 CDP 端口。请确认应用已以 --remote-debugging-port 启动，或用 --port 显式指定。`,
  );
}

/**
 * 从引擎适配器 rendererHints 中取主渲染器。判定优先级：
 *   1. preferredUrlPatterns 命中的 target（如 doubao 的 `doubao-chat/chat`）
 *   2. 排除 secondaryPatterns（如 codex 的 avatar-overlay）后的第一个
 *   3. 兜底 targets[0]
 * 此前遗漏 preferredUrlPatterns，导致 doubao 退化成 targets[0]（选中被注入的
 * 第三方页面「GitHub高星主题注入工具」）。
 */
function pickPrimaryTarget(adapter, targets) {
  const hints = adapter?.rendererHints;
  const secondary = hints?.secondaryPatterns ?? [];
  const preferred = hints?.preferredUrlPatterns ?? [];
  const primaryPool = targets.filter((t) => !secondary.some((p) => String(t.url).includes(p)));
  // 1) 优先 preferredUrlPatterns（从全量 targets 中找，不受 secondary 排除影响）
  const preferredHit = preferred.length
    ? targets.find((t) => preferred.some((p) => String(t.url).includes(p)))
    : null;
  const chosen = preferredHit ?? primaryPool[0] ?? targets[0];
  const skipped = targets.length - primaryPool.length;
  if (skipped) console.log(`  ✓ 跳过 ${skipped} 个次渲染器（rendererHints）`);
  if (preferredHit) console.log(`  ✓ 命中 preferredUrlPatterns 主渲染器（rendererHints）`);
  return chosen;
}

// ============== 主爬取流程 ==============

async function extractAgent(port, agentName, outputDir, adapter = null, discoveredTargets = null) {
  let resolved;
  if (adapter && discoveredTargets) {
    resolved = { port, adapter, targets: discoveredTargets };
  } else {
    try {
      resolved = await discoverLivePort(agentName, port);
    } catch (e) {
      console.error(`  ✗ 端口发现失败: ${e.message}`);
      return null;
    }
  }
  const { adapter: activeAdapter, targets } = resolved;
  const primaryTarget = pickPrimaryTarget(activeAdapter, targets);
  if (!primaryTarget?.webSocketDebuggerUrl) {
    console.error(`  ✗ 没有可用的主渲染器 target`);
    return null;
  }
  const wsDebugUrl = primaryTarget.webSocketDebuggerUrl;
  console.log(`\n--- 提取 ${agentName} (port: ${resolved.port}) ---`);
  console.log(`  主渲染器: ${primaryTarget.title || primaryTarget.url || 'untitled'}`);

  // per-Agent 时序（审计 A-11）：解析本 Agent 的连接/命令超时与主题切换等待。
  const timing = resolveAgentTiming(agentName);
  const client = new CdpClient(wsDebugUrl, {
    connectTimeout: timing.connectTimeout,
    commandTimeout: timing.commandTimeout,
    timing,
  });

  try {
    await client.connect();
    console.log(`  ✓ CDP 连接成功`);

    // 启用必要域
    await client.send('Runtime.enable').catch(() => {});

    // A-16：运行时 API 指纹——检测采样关键 API 是否被页面 monkey-patch。
    const apiFingerprint = await probeApiFingerprint(client);
    if (apiFingerprint?.polluted?.length) {
      console.warn(`  ⚠ API 被污染: ${apiFingerprint.polluted.join(', ')}`);
    }

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
    console.log(
      `  ✓ 当前主题根变量: ${rootVarsCount(rootVarsDefault)} 个${rootVarsDefault.__host ? `（回退宿主 ${rootVarsDefault.__host}）` : ''}`,
    );

    // ====== 3. 当前主题（默认态）的 DOM 和计算样式 ======
    console.log(`  → 捕获 DOM 树（默认态）...`);
    const domDefault = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
    console.log(`  ✓ 默认态 DOM: ${domDefault.totalNodes} 节点`);

    console.log(`  → 采样计算样式（默认态）...`);
    const computedDefault = await sampleComputedStyles(client, 300);
    console.log(`  ✓ 默认态采样: ${computedDefault.length} 节点`);

    // ====== 4. 切换暗色主题 ======
    console.log(`  → 切换到暗色主题...`);
    const darkOk = await setColorScheme(client, 'dark', timing.themeSwitchWait);
    let domDark = null,
      computedDark = null,
      rootVarsDark = {};

    if (darkOk) {
      console.log(`  ✓ 切换到暗色成功`);
      rootVarsDark = await getRootComputedVariables(client);
      console.log(
        `  ✓ 暗色根变量: ${rootVarsCount(rootVarsDark)} 个${rootVarsDark.__host ? `（回退宿主 ${rootVarsDark.__host}）` : ''}`,
      );
      domDark = await captureDomTree(client, DEFAULT_MAX_DOM_NODES, DEFAULT_MAX_DEPTH);
      console.log(`  ✓ 暗色 DOM: ${domDark.totalNodes} 节点`);
      computedDark = await sampleComputedStyles(client, 300);
      console.log(`  ✓ 暗色采样: ${computedDark.length} 节点`);
    } else {
      console.log(`  ⚠ 暗色切换失败（可能 Agent 不响应 prefers-color-scheme）`);
    }

    // ====== 5. 切换亮色主题 ======
    console.log(`  → 切换到亮色主题...`);
    const lightOk = await setColorScheme(client, 'light', timing.themeSwitchWait);
    let domLight = null,
      computedLight = null,
      rootVarsLight = {};

    if (lightOk) {
      console.log(`  ✓ 切换到亮色成功`);
      rootVarsLight = await getRootComputedVariables(client);
      console.log(
        `  ✓ 亮色根变量: ${rootVarsCount(rootVarsLight)} 个${rootVarsLight.__host ? `（回退宿主 ${rootVarsLight.__host}）` : ''}`,
      );
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
    // 缓存回退宿主诊断信息，随后从 rootVariables 移除（不污染变量落盘）。
    const rootVarsDetection = {
      default: rootVarsDefault.__host ? JSON.parse(rootVarsDefault.__host) : null,
      dark: rootVarsDark.__host ? JSON.parse(rootVarsDark.__host) : null,
      light: rootVarsLight.__host ? JSON.parse(rootVarsLight.__host) : null,
    };
    delete rootVarsDefault.__host;
    delete rootVarsDark.__host;
    delete rootVarsLight.__host;
    if (Object.keys(rootVarsDefault).length > 0) {
      allVarsNeutral[':root@runtime'] = rootVarsEntries(rootVarsDefault).map(([name, value]) => ({
        name,
        value,
      }));
    }
    if (Object.keys(rootVarsDark).length > 0) {
      allVarsDark[':root@runtime:dark'] = rootVarsEntries(rootVarsDark).map(([name, value]) => ({
        name,
        value,
      }));
    }
    if (Object.keys(rootVarsLight).length > 0) {
      allVarsLight[':root@runtime:light'] = rootVarsEntries(rootVarsLight).map(([name, value]) => ({
        name,
        value,
      }));
    }

    // ====== A-22：帧树遍历 & 帧级隔离采样 ======
    let frameInfos = [];
    let childFrameSamples = [];
    try {
      frameInfos = (await enumerateFrames(client)) || [];
      // 多帧（同 URL 不同状态）才做帧级隔离采样；单帧跳过（零行为变化）。
      if (frameInfos.length > 1) {
        childFrameSamples = await sampleChildFrames(client, frameInfos);
        console.log(
          `  ✓ 帧树: ${frameInfos.length} 帧（${frameInfos.length - 1} 个 iframe），已隔离采样 ${childFrameSamples.length} 个子帧`,
        );
      }
    } catch (e) {
      console.warn(`  ⚠ 帧树采样失败: ${e.message}`);
    }

    const result = {
      meta: {
        agent: agentName,
        port: port,
        extractedAt: new Date().toISOString(),
        wsDebugUrl,
        // A-08 / Q18：残缺数据质量标记，供下游区分"无此变量"与"未拿到变量"。
        dataQuality: {
          totalNodes: {
            default: domDefault.totalNodes,
            dark: domDark?.totalNodes ?? null,
            light: domLight?.totalNodes ?? null,
          },
          corsBlockedSheets: stylesheets.filter((s) => s.error).length,
          failedSchemes: [...(darkOk ? [] : ['dark']), ...(lightOk ? [] : ['light'])],
          domDegraded:
            domDefault.totalNodes <= 1 ||
            (domDark !== null && domDark.totalNodes <= 1) ||
            (domLight !== null && domLight.totalNodes <= 1),
          // A-09/A-21：DOM 是否因节点上限被截断（true=输出不完整，基线比对应避开伪漂移）。
          truncated: {
            default: domDefault.truncated === true,
            dark: domDark?.truncated === true || null,
            light: domLight?.truncated === true || null,
          },
          // A-22：同窗口多 iframe 各自独立采样（frameId 隔离，不同 URL 不同状态不交叉）。
          // 仅多帧场景合成 frames；单帧时 frames=[]、multiFrame=false（零行为变化）。
          multiFrame: frameInfos.length > 1,
          iframeCount: frameInfos.length - 1,
          frames: childFrameSamples,
          // A-16：采样关键 API 是否被页面 monkey-patch（非原生实现 → 采样结果可信度降级）。
          apiPolluted: apiFingerprint?.polluted ?? [],
          apiFingerprint: apiFingerprint?.fingerprint ?? null,
        },
      },
      frameSnapshot: {
        // A-22：帧树全量信息（含主 frame），frameSnapshot.frames.length>1 即多帧。
        frames: frameInfos,
        sampledFrames: childFrameSamples,
      },
      rootVariables: {
        default: rootVarsDefault,
        dark: rootVarsDark,
        light: rootVarsLight,
      },
      rootVarsDetection,
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
        dark: categorizeVars(flattenVars(allVarsDark), agentName),
        light: categorizeVars(flattenVars(allVarsLight), agentName),
        neutral: categorizeVars(flattenVars(allVarsNeutral), agentName),
      },
      colorPalette: {
        dark: analyzeColorPalette(flattenVars(allVarsDark)),
        light: analyzeColorPalette(flattenVars(allVarsLight)),
        neutral: analyzeColorPalette(flattenVars(allVarsNeutral)),
      },
      stylesheets: {
        count: stylesheets.length,
        sheets: stylesheets.map((s) => ({
          href: s.href,
          type: s.type,
          ruleCount: s.ruleCount,
          hasError: !!s.error,
          textLength: s.cssText?.length || 0,
        })),
        // Preserve ALL CSS text (inline <style> + same-origin stylesheets) for Raw Preview reconstruction.
        // Electron apps often use document.adoptedStyleSheets (CSSStyleSheet API) rather than <style> tags.
        styleBlocks: stylesheets
          .filter((s) => s.cssText && s.cssText.length > 50 && !s.error)
          .map((s) => s.cssText)
          // De-duplicate by first 200 chars (some apps duplicate critical rules across sheets)
          .filter(
            (txt, i, arr) => arr.findIndex((x) => x.slice(0, 200) === txt.slice(0, 200)) === i,
          )
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
          default: rootVarsCount(rootVarsDefault),
          dark: rootVarsCount(rootVarsDark),
          light: rootVarsCount(rootVarsLight),
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
    console.log(
      `  📊 统计: vars(dark=${result.stats.styleVars.dark}, light=${result.stats.styleVars.light}, neutral=${result.stats.styleVars.neutral}) | rootVars(default=${result.stats.rootVars.default}, dark=${result.stats.rootVars.dark}, light=${result.stats.rootVars.light})`,
    );

    // A-12：语义基线持久化为独立 JSON（瘦身、可复用、供下游对比直接加载）。
    // A-15：基线内同时保留亮/暗双方案（schemes.dark / schemes.light / schemes.neutral），
    // 供亮-暗差异比对；单帧/单方案失败时对应方案置 null，不臆造。
    const baseline = buildSemanticBaseline(agentName, result);
    const baselinePath = join(outputDir, `${agentName}-baseline.json`);
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2));
    console.log(`  📎 语义基线已保存到 ${baselinePath}`);

    return result;
  } catch (e) {
    console.error(`  ✗ 提取失败: ${e.message}`);
    return null;
  } finally {
    client.close();
  }
}

// ============== 语义基线构建（审计 A-12 / A-15） ==============
// 从 full-extract 结果中抽取「语义基线」：只保留主题语义所需的最小集合
// （root 变量 / 分类变量 / 关键色板 / 数据质量），体积远小于 full-extract 的
// DOM 全量快照，专供 analyze-structure-compare 等下游直接加载与跨版本比对。
// 亮/暗/neutral 三方案各自独立成节（A-15 双基线缓存），任一方案缺失则置 null。
function buildSemanticBaseline(agentName, result) {
  const scheme = (name) => {
    const cat = result.categories[name];
    if (!result.rootVariables[name] && !cat) return null;
    return {
      rootVariables: result.rootVariables[name] ?? {},
      categories: cat ?? {},
      colorPalette: result.colorPalette[name] ?? [],
    };
  };
  return {
    meta: {
      agent: agentName,
      extractedAt: result.meta.extractedAt,
      generatedBy: 'cdp-full-extract.mjs',
      dataQuality: {
        failedSchemes: result.meta.dataQuality.failedSchemes ?? [],
        domDegraded: result.meta.dataQuality.domDegraded ?? false,
        truncated: result.meta.dataQuality.truncated ?? null,
        multiFrame: result.meta.dataQuality.multiFrame ?? false,
        apiPolluted: result.meta.dataQuality.apiPolluted ?? [],
      },
    },
    schemes: {
      neutral: scheme('neutral'),
      dark: scheme('dark'),
      light: scheme('light'),
    },
  };
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

  const agentsToExtract = {};

  if (useAll) {
    // 复用引擎注册的全部适配器 id，端口由 discoverLivePort 动态发现。
    for (const adapter of listAdapters()) agentsToExtract[adapter.id] = null;
  } else {
    const portArg = args.indexOf('--port');
    const nameArg = args.indexOf('--name');
    const portIdx = portArg >= 0 ? args[portArg + 1] : undefined;
    const nameIdx = nameArg >= 0 ? args[nameArg + 1] : undefined;
    if (nameIdx) {
      agentsToExtract[nameIdx] = portIdx ? parseInt(portIdx, 10) : null;
    } else {
      console.log('用法:');
      console.log('  node scripts/cdp-full-extract.mjs --all --out agents-raw-data');
      console.log(
        '  node scripts/cdp-full-extract.mjs --port 58360 --name codex --out agents-raw-data',
      );
      console.log(
        '  node scripts/cdp-full-extract.mjs --name codex --out agents-raw-data   // 自动发现端口',
      );
      process.exit(1);
    }
  }

  console.log('=== CDP Full Extract ===');
  console.log(`目标: ${Object.keys(agentsToExtract).join(', ')}`);
  console.log(`输出: ${resolvedOut}`);
  console.log(
    '提示: 端口经项目三层发现策略（DevToolsActivePort→argv→netstat）自动定位，无需手写端口表',
  );
  console.log('');

  const results = {};
  for (const [name, port] of Object.entries(agentsToExtract)) {
    try {
      results[name] = await extractAgent(port, name, resolvedOut);
    } catch (e) {
      console.error(`  ✗ ${name}: ${e.message}`);
      results[name] = null;
    }
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

// 仅在作为 CLI 直接执行时运行（import 本模块用于单测/复用时不产生副作用）。
if (import.meta.main) {
  main().catch((e) => {
    console.error('Fatal:', e);
    process.exit(1);
  });
}
