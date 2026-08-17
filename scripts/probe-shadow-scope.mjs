// SPDX-License-Identifier: MPL-2.0

/**
 * # 遮蔽作用域探针（跨 Agent）
 *
 * 目标：对每个 Agent，找出「应用自身 CSS 在哪些选择器作用域声明了主题 token 家族」，
 * 并与本引擎 `engines/<id>/tokens.css` 的覆盖选择器对拍，判定「作用域遮蔽」。
 *
 * 遮蔽原理（CSS 自定义属性继承陷阱）：
 *   自定义属性是继承属性。我们在 html/:root/body 上 `!important` 覆盖，只有当
 *   后代元素「自身没有同名字符串声明」时，才会继承到我们的值。若应用在某后代作用域
 *   （如 .dark、.app-root、.semi-popupview-*）直接声明了同族 token，则该作用域及
 *   其子元素全部使用应用值——我们的 :root 覆盖在那一层被"跳过"，且与 !important 无关
 *   （html 上的声明不参与该作用域元素的级联）。只有当我们也用更高特异性的选择器
 *   直接命中该作用域时（如 doubao 的 .semi-popupview 补丁），才能赢回。
 *
 * 输出：agents-run-now/_shadow-scope-<agent>.json（每 Agent 一份）+ 汇总 markdown。
 *
 * 用法：
 *   node scripts/probe-shadow-scope.mjs                     # 全部 6 个 Agent
 *   node scripts/probe-shadow-scope.mjs --agent codex       # 只探测单个
 *   node scripts/probe-shadow-scope.mjs --debug             # 调试日志
 *   node scripts/probe-shadow-scope.mjs --out <dir>         # 指定输出目录
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { listAdapters } from '../src/engine/src/adapters/index.mjs';
import { findTargets } from '../src/engine/src/runtime/injector.mjs';
import { resolveDebugPorts } from '../src/engine/src/runtime/launcher.mjs';

const execFileAsync = promisify(execFile);
const execFileSafe = async (cmd, args) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 });
    return stdout;
  } catch {
    return '';
  }
};

const OPTIONS = { debug: false, verify: false };

function debugLog(...parts) {
  if (OPTIONS.debug) console.log('[debug]', ...parts);
}

// ===========================================================================
// 1. 每 Agent 配置：token 家族（探测口径） + tokens.css 覆盖选择器（对拍口径）
// ===========================================================================

const AGENT_FAMILIES = {
  codex: ['--text-', '--bg-', '--background-', '--border-', '--color-'],
  doubao: ['--s-', '--semi-', '--dbx-', '--ffc-', '--color-'],
  workbuddy: ['--cb-', '--wb-', '--vscode-', '--color-'],
  qoderwork: ['--color-', '--text-', '--bg-'],
  traework: ['--vscode-', '--color-'],
  zcode: ['--color-', '--text-', '--bg-', '--border-'],
};

/**
 * tokens.css 覆盖选择器（静态口径，与 engines/<id>/tokens.css 保持一致）。
 * 命中判定用「末段复合选择器相等 + 特异性更高」启发式。
 */
const AGENT_OVERRIDES = {
  codex: [{ sel: 'html.agentskin-host-codex:root', spec: [0, 2, 1], important: true }],
  doubao: [
    { sel: 'html.agentskin-host-doubao:root', spec: [0, 2, 1], important: true },
    { sel: 'html.agentskin-host-doubao:root body', spec: [0, 2, 2], important: true },
    { sel: 'html.agentskin-host-doubao:root .semi-popupview-dark', spec: [0, 2, 2], important: true },
    { sel: 'html.agentskin-host-doubao:root .semi-popupview-light', spec: [0, 2, 2], important: true },
    { sel: 'html.agentskin-host-doubao:root [class*="show-scrollbar-thumb"]', spec: [0, 2, 1], important: true },
  ],
  workbuddy: [
    { sel: 'html.agentskin-host-workbuddy body', spec: [0, 1, 2], important: true },
    { sel: 'html.agentskin-host-workbuddy .sidebar-next', spec: [0, 2, 1], important: true },
    { sel: 'html.agentskin-host-workbuddy .sidebar-next-main-header', spec: [0, 2, 1], important: true },
    { sel: 'html.agentskin-host-workbuddy .sidebar-next-body > .detail-panel', spec: [0, 2, 1], important: true },
    { sel: 'html.agentskin-host-workbuddy .sidebar-next-body > .detail-panel .detail-sidebar', spec: [0, 2, 1], important: true },
  ],
  qoderwork: [{ sel: 'html.agentskin-host-qoderwork:root', spec: [0, 2, 1], important: true }],
  traework: [
    { sel: 'html.agentskin-host-traework body', spec: [0, 1, 2], important: true },
    { sel: 'html.agentskin-host-traework .monaco-workbench', spec: [0, 1, 2], important: true },
    { sel: 'html.agentskin-host-traework .solo-theme', spec: [0, 2, 1], important: true },
  ],
  zcode: [{ sel: 'html.agentskin-host-zcode:root', spec: [0, 1, 1], important: true }],
};

// ===========================================================================
// 2. 端口解析（复用引擎 launcher 的 DevToolsActivePort 发现，失败时回退 netstat）
// ===========================================================================

async function portsFromNetstat(adapter) {
  const stdout = await execFileSafe('netstat.exe', ['-ano']);
  if (!stdout) return [];
  const listening = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i.exec(line);
    if (m) {
      const port = Number(m[1]);
      const pid = Number(m[2]);
      if (port >= 1024 && port <= 65535) {
        if (!listening.has(pid)) listening.set(pid, []);
        listening.get(pid).push(port);
      }
    }
  }
  const tasklist = await execFileSafe('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const names = new Set(
    [...(adapter.platforms.win32?.processNames ?? [])].map((n) =>
      n.toLowerCase().endsWith('.exe') ? n.toLowerCase() : `${n.toLowerCase()}.exe`,
    ),
  );
  const pids = new Set();
  for (const line of tasklist.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && names.has(m[1].toLowerCase())) pids.add(Number(m[2]));
  }
  const ports = [];
  for (const pid of pids) {
    for (const port of listening.get(pid) ?? []) if (!ports.includes(port)) ports.push(port);
  }
  debugLog(`${adapter.id}: netstat 命中 PID=[${[...pids].join(',')}] 端口=[${ports.join(',')}]`);
  return ports;
}

async function resolveLivePort(adapter) {
  const filePorts = await resolveDebugPorts(adapter, process.platform);
  debugLog(`${adapter.id}: DevToolsActivePort → [${filePorts.join(',')}]`);
  for (const port of filePorts) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) {
        debugLog(`${adapter.id}: 端口 ${port} 命中 ${targets.length} 个 renderer target`);
        return { port, targets };
      }
    } catch {
      /* 文件可能残留，端口未活 */
    }
  }
  for (const port of await portsFromNetstat(adapter)) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) {
        debugLog(`${adapter.id}: netstat 端口 ${port} 命中 ${targets.length} 个 renderer target`);
        return { port, targets };
      }
    } catch {
      /* 端口不是 CDP 端点 */
    }
  }
  return null;
}

// ===========================================================================
// 3. 最小 CDP 客户端（Node 22 全局 WebSocket）
// ===========================================================================

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolvePromise, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolvePromise();
      this.ws.onerror = () => reject(new Error(`WS connect failed: ${this.wsUrl}`));
      this.ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.id == null) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      };
    });
  }

  send(method, params = {}) {
    if (!this.ws) throw new Error('CDP client not connected');
    const id = ++this.msgId;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* 忽略关闭错误 */
    }
  }
}

async function evaluateJson(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    timeout: 15000,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Runtime.evaluate exception');
  return result.value;
}

// ===========================================================================
// 4. 浏览器侧表达式：遍历全部样式表，收集「声明了 token 家族的作用域规则」
// ===========================================================================

/**
 * 解析 engines/<id>/tokens.css 里我们显式覆盖的 token 精确清单。
 * 遮蔽判定的金标准：只关心「应用在非 root 作用域声明了『我们也在覆盖』的 token」。
 */
function readOurTokens(agentId) {
  const p = resolve('engines', agentId, 'tokens.css');
  if (!existsSync(p)) return new Set();
  const src = readFileSync(p, 'utf-8');
  const set = new Set();
  const re = /(--[A-Za-z0-9_-]+)\s*:/g;
  let m;
  while ((m = re.exec(src))) set.add(m[1]);
  return set;
}

function buildShadowScopeExpression(ourTokens) {
  const OUR = [...ourTokens];
  return `(() => {
    const OUT = new Set(${JSON.stringify(OUR)});
    const out = {
      html: {
        className: document.documentElement.className || '',
        dataTheme: document.documentElement.getAttribute('data-theme') || '',
        dataMode: document.documentElement.getAttribute('data-mode') || '',
        colorScheme: document.documentElement.style.colorScheme || '',
      },
      sheets: 0, adoptedSheets: 0, nestedRules: 0,
      declRules: [],           // 声明了「我们覆盖的 token」的规则
      rootFam: {},             // root 作用域按家族（--X-）统计
      errors: [],
    };
    const ROOTISH_RE = /^(?:html\\b|:root|body\\b|\\*)/;
    const FAM_RE = /^(--[a-z0-9]+-)/i;
    const famKey = (name) => {
      const m = name.match(FAM_RE);
      return m ? m[1] : name.split('-')[0] ? '--' + name.split('-')[0] + '-' : name;
    };
    const walk = (rule, depth) => {
      if (depth > 5) return;
      let type = 0, cssText = '', sel = '';
      try { type = rule.type || 0; cssText = rule.cssText || ''; } catch (e) { return; }
      let children = null;
      try { children = rule.cssRules; } catch (e) { children = null; }
      if (children && (type === 4 || type === 12 || type === 14 || type === 1)) {
        out.nestedRules += 1;
        for (const r of children) walk(r, depth + 1);
      }
      if (type !== 1) return;
      try { sel = rule.selectorText || ''; } catch (e) { return; }
      if (!cssText || !sel) return;
      // 跳过我们自己注入的规则（包含 agentskin-host-）
      if (sel.includes('agentskin-host-')) return;
      const decls = cssText.match(/--[A-Za-z0-9_-]+\\s*:[^;{}]+/g) || [];
      if (!decls.length) return;
      const props = [];
      const hits = [];
      const fam = {};
      let important = false;
      for (const d of decls) {
        const m = d.match(/^(--[A-Za-z0-9_-]+)\\s*:/);
        if (!m) continue;
        const prop = m[1];
        props.push(prop);
        if (OUT.has(prop)) hits.push(prop);
        const k = famKey(prop);
        fam[k] = (fam[k] || 0) + 1;
        if (/!important/i.test(d)) important = true;
      }
      const rootish = ROOTISH_RE.test(sel);
      if (rootish) for (const p of props) {
        const k = famKey(p);
        out.rootFam[k] = (out.rootFam[k] || 0) + 1;
      }
      // 只保留声明了我们覆盖的 token 的规则（命中即候选遮蔽）
      if (!hits.length) return;
      let entry = null;
      for (const r of out.declRules) if (r.sel === sel) { entry = r; break; }
      if (!entry) {
        let inDom = null;
        let rootMatch = false;
        let rootMatchSegs = null;
        if (!/::/.test(sel)) {
          try { inDom = !!document.querySelector(sel); } catch (e) { inDom = null; }
          try { rootMatch = document.documentElement.matches(sel); } catch (e) { rootMatch = false; }
          try {
            rootMatchSegs = sel.split(/\s*,\s*/).map((seg) => document.documentElement.matches(seg));
          } catch { rootMatchSegs = null; }
        }
        entry = { sel, hits: [], props: [], fam, important: false, inDom, rootMatch, rootMatchSegs };
        out.declRules.push(entry);
      }
      for (const p of hits) if (!entry.hits.includes(p)) entry.hits.push(p);
      for (const p of props) if (!entry.props.includes(p)) entry.props.push(p);
      if (important) entry.important = true;
    };
    for (let i = 0; i < document.styleSheets.length; i++) {
      let rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { out.errors.push('cssRules:' + (e.name || '')); continue; }
      if (!rules) continue;
      out.sheets += 1;
      for (const r of rules) walk(r, 0);
    }
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
      for (const ss of document.adoptedStyleSheets) {
        let rules;
        try { rules = ss.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        out.adoptedSheets += 1;
        for (const r of rules) walk(r, 0);
      }
    }
    return JSON.stringify(out);
  })()`;
}

// ===========================================================================
// 5. 特异性计算与作用域判定
// ===========================================================================

/**
 * 计算选择器特异性 [id, class, type]。只解析最右侧复合选择器即足够
 * （遮蔽判定关心的是「命中元素的选择器」，最右侧复合选择器决定命中元素）。
 * @returns {[number, number, number]}
 */
function selectorSpecificity(selector) {
  const parts = splitCombinators(String(selector).trim());
  let id = 0;
  let cls = 0;
  let type = 0;
  for (let p of parts) {
    // 去掉伪元素（::x）与 :root/:where 等权重为 0 的伪类
    p = p.replace(/::[a-z-]+(\([^)]*\))?/gi, '');
    p = p.replace(/:(?:root|where|is|has|not|nth-child|nth-of-type|first-child|last-child|only-child|hover|focus|active|disabled|checked|enabled|focus-visible|focus-within|target|link|visited|placeholder-shown|required|optional|valid|invalid|read-only|read-write|first-of-type|last-of-type)(\([^)]*\))?/gi, '');
    // id 选择器（不在 [] 内）
    p = p.replace(/#[a-zA-Z_][\w-]*/g, () => { id += 1; return ''; });
    // 属性选择器
    p = p.replace(/\[[^\]]*\]/g, () => { cls += 1; return ''; });
    // 类选择器
    p = p.replace(/\.[a-zA-Z_][\w-]*/g, () => { cls += 1; return ''; });
    // 类型/通用选择器
    p = p.replace(/(?:^|[^.#\[])([a-zA-Z][a-zA-Z0-9-]*)/g, () => { type += 1; return ''; });
  }
  return [id, cls, type];
}

/**
 * 按组合器（空格/子/兄弟）切分选择器，忽略 [] 与 () 内部及引号内的字符。
 * 属性值常含空格（如 [data-vscode-theme-name="IDE Night"]），naive split 会误切。
 */
function splitCombinators(selector) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '[' || ch === '(') {
      depth += 1;
      cur += ch;
      continue;
    }
    if (ch === ']' || ch === ')') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (depth === 0 && (ch === ' ' || ch === '+' || ch === '>' || ch === '~')) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** 取选择器最右侧复合选择器（用于覆盖启发式比对） */
function rightmostCompound(selector) {
  const parts = splitCombinators(String(selector).trim());
  let last = parts[parts.length - 1] || String(selector).trim();
  last = last.replace(/::[a-z-]+(\([^)]*\))?/gi, '').trim();
  return last;
}

/**
 * 判定覆盖选择器最右侧复合选择器命中的元素层级：
 *   'root'  → html / :root / *
 *   'body'  → body
 *   'other' → 组件/后代类选择器
 * 自定义属性继承：元素使用「自身命中声明」优先于「继承自祖先」。
 * 因此应用在 body 上声明同 token 会遮蔽我们 html:root 的覆盖，
 * 而应用在 :root 上声明则会被我们 html:root !important 在同元素上压过。
 */
function selectorTargetKind(right) {
  if (/^(?:html(?:\b|[.#:[\]])|:root)/.test(right)) return 'root';
  if (/^body(?:\b|[.#:[\]])/.test(right)) return 'body';
  return 'other';
}

function specGtEq(a, b) {
  return (
    a[0] > b[0] ||
    (a[0] === b[0] && a[1] > b[1]) ||
    (a[0] === b[0] && a[1] === b[1] && a[2] >= b[2])
  );
}

/** 提取复合选择器中的类名（用于子类覆盖判定） */
function compoundClasses(compound) {
  const out = [];
  const re = /\.([A-Za-z0-9_-]+)/g;
  let m;
  while ((m = re.exec(compound))) out.push(m[1]);
  return out;
}

/** 提取 `[class*="PREFIX"]` 子串选择器的前缀（CSS-module hashed 类稳定覆盖） */
function attrClassPrefix(compound) {
  const m = String(compound).match(/\[class\*=[\"']([^\"']+)[\"']\]/);
  return m ? m[1] : null;
}

/** 静态判定单个逗号段是否命中 html/:root（首复合选择器以 html 或 :root 开头） */
function rootMatchSegment(seg) {
  const s = String(seg).trim();
  const first = s.split(/[\s>+~]/)[0] || s;
  if (first.startsWith(':root')) return true;
  if (/^html([.#:\[]|$)/.test(first)) return true;
  return false;
}

/** 应用规则 R 是否被我们的覆盖规则覆盖（遮蔽判定） */
function isCoveredByOverride(agentId, appRule) {
  const overrides = AGENT_OVERRIDES[agentId] ?? [];
  const appSpec = selectorSpecificity(appRule.sel);
  const appRight = rightmostCompound(appRule.sel);
  const appKind = selectorTargetKind(appRight);
  // 规则直接命中 html（主题类/root 属性选择器，含逗号列表中任一段命中 html）：
  // 应用在 html 上声明 token 只会影响 html 自身及其直接渲染；
  // 我们 root !important 在同元素上胜出，body !important 覆盖则通过继承覆盖 body 及后代。
  if (appRule.rootMatch === true) {
    for (const o of overrides) {
      const oKind = selectorTargetKind(rightmostCompound(o.sel));
      if (oKind === 'root' && o.important) {
        if (!appRule.important) return true;
        if (specGtEq(selectorSpecificity(o.sel), appSpec)) return true;
      }
      if (oKind === 'body' && o.important && !appRule.important) return true;
    }
  }
  for (const o of overrides) {
    const oRight = rightmostCompound(o.sel);
    const oKind = selectorTargetKind(oRight);
    const oSpec = selectorSpecificity(o.sel);
    // 同元素级（root↔root / body↔body）：我们 !important 压过（应用也 !important 时需比特异性）
    if (oKind !== 'other' && oKind === appKind) {
      if (o.important && (!appRule.important || specGtEq(oSpec, appSpec))) return true;
    }
    // 我们覆盖 body、应用覆盖 root：body 及后代继承我们的值（应用 root 声明仅影响非 body 元素）
    if (oKind === 'body' && appKind === 'root' && o.important && !appRule.important) return true;
    // 组件级：右侧复合选择器相等 + 级联
    if (oKind === 'other' && appKind === 'other') {
      const oRight = rightmostCompound(o.sel);
      // 1) 完全相等
      const exact = oRight === appRight;
      // 2) 子类覆盖：我们的右端类集合 ⊆ 应用右端类集合（如 .detail-panel 覆盖 .detail-panel--no-header）
      const ours = compoundClasses(oRight);
      const appCls = compoundClasses(appRight);
      const subset = ours.length > 0 && ours.every((c) => appCls.includes(c));
      // 3) 属性子串覆盖：我们的右端为 `[class*="PREFIX"]`，应用右端含 PREFIX 开头类
      //    （如 [class*="show-scrollbar-thumb"] 覆盖 .show-scrollbar-thumb-<hash>）
      const oPrefix = attrClassPrefix(oRight);
      const prefixHit = oPrefix != null && appCls.some((c) => c.startsWith(oPrefix));
      if ((exact || subset || prefixHit) && o.important && (!appRule.important || specGtEq(oSpec, appSpec))) return true;
    }
  }
  return false;
}

/** 作用域分类 */
function classifyScope(sel) {
  const s = String(sel);
  if (/^(?:html|:root)(?:[.#:]|$)/.test(s)) return 'root';
  if (/^(?:body|html\s+body|\*)(?:[.#:]|$)/.test(s) && !/[.#][\w-]/.test(s.replace(/^body/, ''))) return 'body';
  if (/(dark|light|theme|color-mode|scheme)/i.test(s)) return 'theme-class';
  return 'component';
}

// ===========================================================================
// 6. 主流程
// ===========================================================================

async function probeAgent(adapter, target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Runtime.enable').catch(() => {});
    const ourTokens = readOurTokens(adapter.id);
    const raw = await evaluateJson(client, buildShadowScopeExpression(ourTokens));
    return JSON.parse(raw);
  } finally {
    client.close();
  }
}

function buildReport(adapter, data) {
  const families = AGENT_FAMILIES[adapter.id] ?? [];
  const overrides = AGENT_OVERRIDES[adapter.id] ?? [];
  const famRules = {}; // family -> [rules]
  for (const r of data.declRules) {
    for (const f in r.fam) {
      if (!famRules[f]) famRules[f] = [];
      famRules[f].push(r);
    }
  }
  const familiesReport = [];
  for (const f of Object.keys(famRules).sort()) {
    const rules = famRules[f];
    const scopes = [];
    const shadowed = [];
    for (const r of rules) {
      // CSS 规则是逗号分隔多个选择器 → 每一段分别覆盖判定，只要一段被覆盖则整条规则已覆盖
      // 避免 "body, ... .semi-always-light" 因为最后一段不覆盖而误标整条规则
      // DOM 已经预先计算了每段 rootMatch → 优先用真实值，否则 fallback 到静态判定
      const segs = r.sel.split(/\s*,\s*/).filter(x => x);
      let covered = false;
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const segRootMatch = (Array.isArray(r.rootMatchSegs) && i < r.rootMatchSegs.length)
          ? r.rootMatchSegs[i]
          : rootMatchSegment(seg);
        const segRule = { ...r, sel: seg, rootMatch: segRootMatch };
        if (isCoveredByOverride(adapter.id, segRule)) { covered = true; break; }
      }
      const scope = classifyScope(r.sel);
      const spec = selectorSpecificity(r.sel);
      scopes.push({
        sel: r.sel,
        scope,
        spec,
        important: r.important,
        inDom: r.inDom,
        propCount: (r.props || []).length,
        sampleProps: (r.props || []).slice(0, 6),
      });
      if (!covered) {
        shadowed.push({
          sel: r.sel,
          scope,
          spec,
          important: r.important,
          inDom: r.inDom,
          active: r.inDom === true,
          hits: r.hits || [],
        });
      }
    }
    familiesReport.push({ family: f, ruleCount: rules.length, scopes, shadowed });
  }
  // root 家族覆盖对比
  const rootFams = Object.keys(data.rootFam || {}).sort();
  const rootCoverage = rootFams.map((k) => {
    const covered = families.some((p) => k.startsWith(p) || p.startsWith(k));
    return { family: k, count: data.rootFam[k], covered };
  });
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    html: data.html,
    sheets: { styleSheets: data.sheets, adoptedSheets: data.adoptedSheets, nestedRules: data.nestedRules },
    errors: data.errors,
    families: familiesReport,
    rootCoverage,
    overrides: overrides.map((o) => ({ sel: o.sel, spec: o.spec, important: o.important })),
  };
}

function countActiveShadowed(report) {
  let n = 0;
  const list = [];
  for (const f of report.families) {
    for (const s of f.shadowed) {
      if (s.active) {
        n += 1;
        list.push({ family: f.family, sel: s.sel, spec: s.spec, important: s.important });
      }
    }
  }
  return { n, list };
}

/**
 * 真遮蔽验证：对活动遮蔽的组件/主题类作用域，在真实 DOM 上核对
 * 「命中 token 的计算值是否与父级不同」。不同 ⇒ 元素自身声明（真遮蔽）；
 * 相同 ⇒ 从 body 继承了我们的覆盖值（伪阳性）。
 */
function buildScopeVerifyExpression(entries) {
  return `(() => {
    const ENTRIES = ${JSON.stringify(entries)};
    const out = [];
    for (const e of ENTRIES) {
      let els = [];
      try { els = Array.from(document.querySelectorAll(e.sel)); } catch (err) { out.push({ sel: e.sel, error: String(err && err.name || err) }); continue; }
      if (!els.length) { out.push({ sel: e.sel, count: 0 }); continue; }
      const el = els[0];
      const parent = el.parentElement;
      const cs = getComputedStyle(el);
      const ps = parent ? getComputedStyle(parent) : null;
      const diff = [];
      for (const t of (e.tokens || [])) {
        const v = (cs.getPropertyValue(t) || '').trim();
        const pv = ps ? (ps.getPropertyValue(t) || '').trim() : null;
        diff.push({ t, v: v.slice(0, 80), parent: pv == null ? null : pv.slice(0, 80), differs: pv != null && v !== pv });
      }
      out.push({
        sel: e.sel,
        count: els.length,
        tag: el.tagName,
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : String(el.className),
        diff,
      });
    }
    return JSON.stringify(out);
  })()`;
}

async function verifyScopes(client, report) {
  const entries = [];
  for (const f of report.families) {
    for (const s of f.shadowed) {
      if (!s.active) continue;
      if (s.scope !== 'component' && s.scope !== 'theme-class') continue;
      entries.push({ sel: s.sel, tokens: s.hits });
    }
  }
  if (!entries.length) return [];
  const raw = await evaluateJson(client, buildScopeVerifyExpression(entries));
  return JSON.parse(raw);
}

function printAgentReport(adapter, report) {
  console.log(`\n=== ${report.displayName}（${report.id}） ===`);
  console.log(
    `html class="${report.html.className}" data-theme="${report.html.dataTheme}" colorScheme="${report.html.colorScheme}"`,
  );
  console.log(`sheets=${report.sheets.styleSheets} adopted=${report.sheets.adoptedSheets} nested=${report.sheets.nestedRules}`);
  for (const f of report.families) {
    const active = f.shadowed.filter((s) => s.active);
    const latent = f.shadowed.filter((s) => !s.active);
    const tag = [];
    if (active.length) tag.push(`⚠ 活动遮蔽 ${active.length}`);
    if (latent.length) tag.push(`潜伏遮蔽 ${latent.length}`);
    console.log(`  [${f.family}] ${f.ruleCount} 条规则 ${tag.length ? '｜' + tag.join(' ｜') : ''}`);
    for (const s of active)
      console.log(`      ⚠ ${s.sel} (${s.spec.join(',')})${s.important ? ' !important' : ''} [在 DOM]`);
    for (const s of latent)
      console.log(`      ~ ${s.sel} (${s.spec.join(',')})${s.important ? ' !important' : ''} [不在 DOM]`);
  }
  const uncovered = report.rootCoverage.filter((r) => !r.covered);
  if (uncovered.length)
    console.log(`  ! root 声明但未覆盖家族: ${uncovered.map((r) => `${r.family}(${r.count})`).join(', ')}`);
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  OPTIONS.debug = args.includes('--debug');
  OPTIONS.verify = args.includes('--verify');
  const requested = (() => {
    const i = args.indexOf('--agent');
    return i >= 0 ? args[i + 1] : null;
  })();
  const outputDir = resolve(args.indexOf('--out') >= 0 ? args[args.indexOf('--out') + 1] : 'agents-run-now');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const adapters = listAdapters().filter((a) => (requested ? a.id === requested : true));
  if (!adapters.length) {
    console.error(`未知 agent: ${requested}（可选: ${listAdapters().map((a) => a.id).join(', ')}）`);
    process.exit(2);
  }
  console.log(`=== 遮蔽作用域探针（${adapters.map((a) => a.id).join(', ')}） ===`);

  const reports = [];
  for (const adapter of adapters) {
    try {
      const live = await resolveLivePort(adapter);
      if (!live) {
        console.log(`\n[${adapter.id}] 未检测到运行中的 CDP 端点（跳过）`);
        reports.push({ id: adapter.id, displayName: adapter.displayName, ok: false, error: 'no-cdp' });
        continue;
      }
      const target = live.targets.find((t) => t.webSocketDebuggerUrl) ?? live.targets[0];
      const data = await probeAgent(adapter, { ...target, port: live.port });
      const report = buildReport(adapter, data);
      report.ok = true;
      report.port = live.port;
      if (OPTIONS.verify) {
        const vc = new CdpClient(target.webSocketDebuggerUrl);
        await vc.connect();
        try {
          await vc.send('Runtime.enable').catch(() => {});
          report.verify = await verifyScopes(vc, report);
        } finally {
          vc.close();
        }
      }
      reports.push(report);
      printAgentReport(adapter, report);
      const fp = join(outputDir, `_shadow-scope-${adapter.id}.json`);
      writeFileSync(fp, JSON.stringify(report, null, 2));
      debugLog(`写入 ${fp}`);
    } catch (e) {
      console.log(`\n[${adapter.id}] 探测异常: ${e.message}`);
      reports.push({ id: adapter.id, displayName: adapter.displayName, ok: false, error: e.message });
    }
  }

  // 汇总 markdown
  const lines = [
    `# 遮蔽作用域探针报告`,
    ``,
    `> 生成时间：${new Date().toISOString()} ｜ 共 ${reports.length} 个 Agent`,
    ``,
  ];
  for (const r of reports) {
    if (!r.ok) {
      lines.push(`## ${r.displayName}（${r.id}）`, '', `- 状态：**失败**（${r.error}）`, '');
      continue;
    }
    const { n, list } = countActiveShadowed(r);
    lines.push(`## ${r.displayName}（${r.id}）`);
    lines.push('');
    lines.push(`- 状态：**OK**（CDP @:${r.port}）｜ html="${r.html.className}" data-theme="${r.html.dataTheme}"`);
    lines.push(`- 活动遮蔽：**${n}**｜ 家族 ${r.families.length}｜ sheets=${r.sheets.styleSheets} adopted=${r.sheets.adoptedSheets} nested=${r.sheets.nestedRules}`);
    lines.push('');
    for (const f of r.families) {
      const active = f.shadowed.filter((s) => s.active);
      const latent = f.shadowed.filter((s) => !s.active);
      lines.push(`### ${f.family}（${f.ruleCount} 条）`);
      lines.push('');
      if (active.length) {
        lines.push('**⚠ 活动遮蔽（在 DOM，需补覆盖）：**');
        for (const s of active)
          lines.push(`- \`${s.sel}\`（特异性 ${s.spec.join(',')}${s.important ? '，!important' : ''}）`);
      }
      if (latent.length) {
        lines.push('**~ 潜伏遮蔽（不在 DOM，懒加载/未激活主题）：**');
        for (const s of latent)
          lines.push(`- \`${s.sel}\`（特异性 ${s.spec.join(',')}${s.important ? '，!important' : ''}）`);
      }
      if (!active.length && !latent.length) lines.push('- 无遮蔽（已被覆盖或仅 root 作用域）');
      lines.push('');
    }
    const uncovered = r.rootCoverage.filter((x) => !x.covered);
    if (uncovered.length) {
      lines.push(`### root 声明但未覆盖家族`);
      lines.push('');
      for (const u of uncovered) lines.push(`- \`${u.family}\`（${u.count} 处声明）`);
      lines.push('');
    }
  }
  const reportPath = join(outputDir, '_shadow-scope-report.md');
  writeFileSync(reportPath, lines.join('\n'));
  console.log(`\n报告: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
