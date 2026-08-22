// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — CDP 运行时探测 × 安装包静态解包
 *
 * 一键对比 6 个 Agent 的「运行时结构」与「打包声明结构」：
 *   - CDP（运行时）：DOM 类名清单、:root CSS 变量、适配器 landmark 命中、bridge 变量可达性
 *   - 静态（解包 app.asar）：renderer bundle 中的类名字面量、CSS 文件中的自定义属性声明
 *   - 对拍：shared / onlyStatic（运行时已消失）/ onlyRuntime（动态生成或 CSS Modules 哈希），
 *     并据此给每个 Agent 输出结构漂移结论（适配器 verification 选择器、bridge entries 是否仍成立）。
 *
 * 用途：新版本升级后快速判断适配器是否需要修订（landmark 失效 / bridge 变量被移除），
 * 以及发现 JS 运行时动态生成的类名（这些是 CDP-only 结构，静态抓不到）。
 *
 * 用法：
 *   node scripts/analyze-structure-compare.mjs                       # 全部 6 个 Agent
 *   node scripts/analyze-structure-compare.mjs --agent codex         # 只对比单个
 *   node scripts/analyze-structure-compare.mjs --out agents-raw-data # 指定报告输出目录
 *   node scripts/analyze-structure-compare.mjs --debug               # 调试日志（扫描文件/过滤命中/解析过程）
 *   node scripts/analyze-structure-compare.mjs --markdown            # 额外输出 Markdown 修订清单
 *   node scripts/analyze-structure-compare.mjs --ci                  # CI 极简输出 + 语义化退出码
 *   node scripts/analyze-structure-compare.mjs --skip-cef-subapp     # CEF 布局跳过 local_webcontents/apps 子应用
 *   node scripts/analyze-structure-compare.mjs --ignore FILE.json     # 黑白名单：过滤固定噪声类名/变量（{classTokens:[],cssVars:[]}）
 *   node scripts/analyze-structure-compare.mjs --suggest-ignore       # 自动提取跨 Agent 稳定的噪声候选，输出可喂给 --ignore 的 JSON
 *   node scripts/analyze-structure-compare.mjs --baseline [FILE]      # 基线对拍：与历史报告对比，只把「新增漂移」当告警（默认对比上一次 _structure-compare.json）
 *   node scripts/analyze-structure-compare.mjs --rules               # 额外输出 agent-rules/*.theme.rule.json 规则库初始模板
 *   node scripts/analyze-structure-compare.mjs --meta                # 额外输出 meta/*.theme.meta.json + meta-validation.json（推理+自校验）
 *   node scripts/analyze-structure-compare.mjs --write-patches       # 把「确定性删除」补丁自动写回适配器源码（死 landmark / 失效 bridge entry）
 *   node scripts/analyze-structure-compare.mjs --write-patches --dry-run  # 仅预览待写回的补丁，不写文件
 *   node scripts/analyze-structure-compare.mjs --shadow-seed FILE.json   # 注入 closed-shadow 种子增量（{common:[...], agentId:[...]}），并入规则库候选
 *
 * 说明：
 *   - closed shadow root 无法被 JS 枚举，脚本内置 COMMON 原生宿主种子 + 各 Agent 分桶种子，
 *     用 --shadow-seed 可追加已验证选择器；命中即写入运行时 closedShadowRisk，并回填 --rules 模板的 shadowDomRiskSelectors。
 *   - Target 枚举含 OOPIF 跨 target 汇总：对全部 page/iframe target 拉取 Page.getFrameTree 合并，输出 frameCount / oopifCount（跨进程边界）。
 *
 * 退出码（CI 模式对接流水线）：
 *   0  全部 Agent 探测正常，无结构漂移
 *   1  存在业务漂移（landmark 失效 / bridge 异常 / 疑似 @theme-inline），需人工修订适配器；
 *      --baseline 时仅由「新增漂移」触发（已恢复 / 持续漂移不阻断，避免告警疲劳）
 *   2  存在 Agent 探测失败（CDP 连接失败 / 静态解析异常 / 环境异常）
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import asar from '@electron/asar';
import { listAdapters } from '../src/engine/src/adapters/index.mjs';
import { listCdpTargets } from '../src/engine/src/cdp/session.mjs';
import { findTargets } from '../src/engine/src/runtime/injector.mjs';
import { discoverApp, resolveDebugPorts } from '../src/engine/src/runtime/launcher.mjs';
import { inferCurrentMode, inferMeta } from '../src/engine/src/runtime/meta-inference.mjs';
import { validateMeta } from '../src/engine/src/runtime/meta-validator.mjs';

const execFileAsync = promisify(execFile);

const RUNTIME_CLASS_CAP = 1000; // 运行时类名按出现频次保留的数量
const RUNTIME_VAR_CAP = 2000; // 运行时 :root 变量保留数量
const STATIC_JS_FILE_CAP = 40; // 最多扫描的 renderer JS 文件数
const STATIC_BYTES_PER_FILE = 1_500_000; // 单个 JS 文件最多读取的字节
const STATIC_CSS_BYTES_TOTAL = 8_000_000; // 全部 CSS 最多读取的字节
const DIFF_LIST_CAP = 25; // 每个 diff 类别在报告里展示的数量

const execFileSafe = async (cmd, args) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 8000 });
    return stdout;
  } catch {
    return '';
  }
};

// ---- 全局运行选项（由 main 解析 CLI 参数写入）----
const OPTIONS = {
  debug: false,
  markdown: false,
  ci: false,
  skipCefSubapp: false,
  ignorePath: null,
  suggestIgnore: false,
  rules: false,
  meta: false,
  writePatches: false,
  dryRun: false,
  shadowSeed: { common: [], byAgent: {} },
};

function debugLog(...parts) {
  if (OPTIONS.debug) console.log('[debug]', ...parts);
}

/**
 * 黑白名单配置加载：--ignore 指向的 JSON 文件（{ classTokens: [], cssVars: [] }）。
 * 用于过滤固定 CSS Modules 噪声类名 / 变量，减少无效 diff。文件缺失或解析失败时静默降级为空名单。
 */
function loadIgnoreList(path) {
  const empty = { classTokens: new Set(), cssVars: new Set() };
  if (!path) return empty;
  if (!existsSync(path)) {
    debugLog(`ignore 配置文件不存在，忽略: ${path}`);
    return empty;
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    return {
      classTokens: new Set(Array.isArray(raw.classTokens) ? raw.classTokens : []),
      cssVars: new Set(Array.isArray(raw.cssVars) ? raw.cssVars : []),
    };
  } catch (e) {
    debugLog(`ignore 配置解析失败（已忽略）: ${e.message}`);
    return empty;
  }
}

/** 二进制嗅探：读取内容含 NUL 或不可打印控制字符占比过高时判定为非文本资源，跳过。 */
function looksBinary(chunk) {
  const sample = chunk.subarray ? chunk.subarray(0, 2048) : String(chunk).slice(0, 2048);
  let nul = 0;
  for (const byte of sample) if (byte === 0 || byte === '\0') nul++;
  if (nul > 0) return true;
  const text = typeof sample === 'string' ? sample : sample.toString('latin1');
  let ctrl = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) ctrl++;
  }
  return text.length > 0 && ctrl / text.length > 0.02;
}

// ===========================================================================
// 1. 端口解析（复用引擎 launcher 的 DevToolsActivePort 发现，失败时回退 netstat）
// ===========================================================================

async function portsFromNetstat(adapter) {
  // 拿到 agent 进程 PID，再在监听端口里反查
  const stdout = await execFileSafe('netstat.exe', ['-ano']);
  if (!stdout) return [];
  const listening = new Map(); // pid -> [ports]
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
  // 多开场景：遍历全部匹配 PID（而非仅首个），逐个反查监听端口，保证无实例遗漏
  const ports = [];
  for (const pid of pids) {
    for (const port of listening.get(pid) ?? []) if (!ports.includes(port)) ports.push(port);
  }
  debugLog(`${adapter.id}: netstat 命中 PID=[${[...pids].join(',')}] 端口=[${ports.join(',')}]`);
  return ports;
}

async function resolveLivePort(adapter) {
  // 1) DevToolsActivePort 文件（引擎同一套逻辑）
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
  // 2) netstat 回退：进程在跑但端口文件失效（新版改了 user-data 目录等）。
  //    逐个尝试全部候选端口，任一端口返回 CDP target 即采用（兼容多实例多端口）。
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

/**
 * 将 CDP Page.getFrameTree 的嵌套 tree 拍平为有序数组（DFS）。纯函数，便于单测。
 * @param {object|undefined} tree 形如 { frame, childFrames: [] }
 * @returns {Array<{frameId: string, parentId: string|null, url: string, securityOrigin: string}>}
 */
function flattenFrameTree(tree) {
  const out = [];
  if (!tree?.frame) return out;
  (function walk(node, parentId) {
    const f = node.frame || {};
    out.push({
      frameId: f.id ?? f.frameId ?? '',
      parentId: parentId ?? null,
      url: f.url ?? '',
      securityOrigin: f.securityOrigin ?? '',
    });
    for (const child of node.childFrames || []) walk(child, f.id ?? f.frameId);
  })(tree, null);
  return out;
}

/**
 * OOPIF 跨 target 汇总：对同一端口下全部 page/iframe target 逐个拉取 Page.getFrameTree，
 * 拍平后按 frameId 合并成统一 frame 树；凡 child frame 的 parentId 指向**另一 target** 的 frame
 * （或 parentId 存在但在合并集中找不到父 frame）即判定为 OOPIF / 跨进程边界。
 * 逐 target 独立降级，任一 target 失败仅跳过，不阻断整体汇总。
 */
async function collectFrameAggregation(list) {
  const frameTargets = list.filter(
    (t) => (t.type === 'page' || t.type === 'iframe') && t.webSocketDebuggerUrl,
  );
  const framesById = new Map();
  const perTarget = [];
  for (const t of frameTargets) {
    let tree = null;
    let error = null;
    const client = new CdpClient(t.webSocketDebuggerUrl);
    try {
      await client.connect();
      await client.send('Page.enable').catch(() => {});
      const res = await client.send('Page.getFrameTree');
      tree = res.tree ?? res?.result?.tree ?? null;
      const flat = flattenFrameTree(tree);
      for (const f of flat)
        framesById.set(f.frameId, {
          ...f,
          targetId: t.id ?? null,
          targetType: t.type ?? null,
          targetUrl: t.url ?? null,
          targetTitle: t.title ?? null,
        });
    } catch (e) {
      error = e.message;
    } finally {
      client.close();
    }
    perTarget.push({
      targetId: t.id ?? null,
      type: t.type ?? null,
      url: t.url ?? null,
      ok: !error,
      error,
      frames: tree && !error ? flattenFrameTree(tree).map((f) => f.frameId) : [],
    });
  }
  // OOPIF 判定：子 frame 的 parentId 指向不同 target 的 frame，或 parentId 存在却找不到父 frame（孤立/跨 target）。
  const oopifFrames = [];
  for (const f of framesById.values()) {
    if (!f.parentId) continue;
    const parent = framesById.get(f.parentId);
    const crossTarget = parent ? parent.targetId !== f.targetId : true;
    if (crossTarget) {
      oopifFrames.push({
        frameId: f.frameId,
        parentId: f.parentId,
        url: f.url,
        targetId: f.targetId,
        targetType: f.targetType,
      });
    }
  }
  return {
    targetCount: frameTargets.length,
    frameCount: framesById.size,
    oopifCount: oopifFrames.length,
    oopifFrames,
    perTarget,
  };
}

/** 枚举全部 CDP target（主 frame + iframe + worker），不按 adapter 过滤——补 Layer2-1 Target 全发现。 */
async function enumerateTargets(port) {
  try {
    const list = await listCdpTargets(port, 1500);
    const byType = {};
    const pages = [];
    const iframes = [];
    const workers = [];
    for (const t of list) {
      const type = t.type ?? 'other';
      byType[type] = (byType[type] ?? 0) + 1;
      const brief = { id: t.id ?? null, url: t.url ?? null, title: t.title ?? null };
      if (type === 'page') pages.push(brief);
      else if (type === 'iframe') iframes.push(brief);
      else if (type === 'worker' || type === 'service_worker' || type === 'shared_worker')
        workers.push({ ...brief, type });
    }
    // OOPIF 跨 target frame 汇总（含 iframe/跨进程），失败降级不影响 target 清单主链路。
    const frames = await collectFrameAggregation(list).catch((e) => ({
      error: e.message,
      targetCount: 0,
      frameCount: 0,
      oopifCount: 0,
      oopifFrames: [],
    }));
    return { total: list.length, byType, pages, iframes, workers, frames };
  } catch (e) {
    return { error: e.message };
  }
}

// ===========================================================================
// 2. 最小 CDP 客户端（Node 22 全局 WebSocket）
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
        const msg = JSON.parse(String(event.data));
        if (msg.id != null && this.pending.has(msg.id)) {
          const { resolve: r, reject: j } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? j(new Error(msg.error.message || JSON.stringify(msg.error))) : r(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolvePromise, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 12000);
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }
}

// ===========================================================================
// 3. CDP 运行时探测
// ===========================================================================

/** 收集 DOM 类名清单（按出现频次），排除 AgentSkin 自身注入的类。 */
function buildClassInventoryExpression(cap) {
  return `(() => {
    const counts = new Map();
    const isOurClass = (t) => t.startsWith('agentskin-');
    const all = document.querySelectorAll('[class]');
    for (const el of all) {
      if (typeof el.className !== 'string' || !el.className) continue;
      for (const token of el.className.split(/\\s+/)) {
        if (!token || isOurClass(token)) continue;
        counts.set(token, (counts.get(token) ?? 0) + 1);
      }
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, ${cap});
    return JSON.stringify({ unique: counts.size, top });
  })()`;
}

/** 收集 :root 计算样式上的 CSS 自定义属性名（排除 --agentskin-*）。 */
function buildVarsExpression(cap) {
  return `(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = [];
    for (let i = 0; i < cs.length && names.length < ${cap}; i++) {
      const name = cs[i];
      if (name.startsWith('--') && !name.startsWith('--agentskin-')) names.push(name);
    }
    return JSON.stringify({ unique: names.length, names });
  })()`;
}

/**
 * bridge 可达性探测（修正诊断口径）：
 * getComputedStyle 的对象索引枚举（cs[i]）不覆盖 adoptedStyleSheets / 动态注入的
 * 自定义属性，导致 analyze 把「实际生效的 bridge 变量」误判为「组件作用域不可达」。
 * 改为对每个 bridge 变量在 document.documentElement 和 document.body 上显式
 * getPropertyValue(name) 寻址——实测对 adopted 注入仍能返回计算值（主题色）。
 * 返回 { root: {var: value}, body: {var: value} }，空串值视为不可达（不入结果）。
 */
function buildBridgeReachExpression(vars) {
  const arr = JSON.stringify(vars);
  return `(() => {
    const vars = ${arr};
    const read = (el) => {
      const s = getComputedStyle(el);
      const o = {};
      for (const v of vars) {
        const val = s.getPropertyValue(v).trim();
        if (val) o[v] = val;
      }
      return o;
    };
    return JSON.stringify({ root: read(document.documentElement), body: read(document.body) });
  })()`;
}

/**
 * closed shadow root 无法被 JS 枚举（`el.shadowRoot` 恒为 `null`），只能靠规则库的
 * `shadowDomRiskSelectors` 已知风险选择器做启发式检测。这里的「种子」是规则库的初始候选：
 *   - 命中元素且该元素无 open shadowRoot → 判定为 closed shadow 盲区（主题注入无法穿透）。
 *   - 仅当对应组件在目标应用里**实际挂载**时才产生命中，不会凭空误报；种子本身不代表已确认。
 *
 * `COMMON` 为跨 Agent 固定种子：Chromium 原生 closed-shadow 宿主（UA shadow / 内置绘制控件），
 * 主题 CSS 无法穿透其内部，是稳定的注入盲区提示。
 * `BY_AGENT` 为各 Agent 的种子候选（待观测确认），与 COMMON 合并后作为该 Agent 的探测选择器；
 * 结合 buildRuleTemplate 从 openShadow 观测回填的 `shadowDomRiskSelectors`，形成「种子→观测→回填」闭环。
 */
const SHADOW_RISK_SELECTORS_COMMON = [
  // Chromium 原生 closed shadow 宿主：UA shadow 内置绘制，注入无法穿透。
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
  'input[type="date"]',
  'input[type="time"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="week"]',
  'video',
  'audio',
  'select',
];

/** 各 Agent closed shadow 规则库种子候选。无实据的异常分支留空，避免无依据的猜测误报。 */
const SHADOW_RISK_SELECTORS_BY_AGENT = {
  codex: [], // 渲染为 open DOM；已知编辑器/预览面并入 COMMON 原生宿主即可覆盖
  doubao: [], // 文档/视频等复杂内容走 OOPIF iframe，由 frame 聚合（enumerateTargets）覆盖，不在主 frame 内探测
  qoderwork: [],
  traework: [],
  workbuddy: [],
  zcode: [],
};

/** 解析某 Agent 实际使用的 closed shadow 风险选择器 = COMMON ∪ 种子 ∪ --shadow-seed 增量（common + 分桶）。 */
function resolveShadowRiskSelectors(adapterId) {
  const seed = OPTIONS.shadowSeed ?? { common: [], byAgent: {} };
  return [
    ...SHADOW_RISK_SELECTORS_COMMON,
    ...(seed.common ?? []),
    ...(SHADOW_RISK_SELECTORS_BY_AGENT[adapterId] ?? []),
    ...(seed.byAgent[adapterId] ?? []),
  ];
}

/**
 * 加载 --shadow-seed 指向的种子增量文件（{ "agentId": ["selector", ...], "common": [...] }），
 * 用于注入已人工验证的 closed shadow 选择器。文件缺失/解析失败时静默降级为空。
 */
function loadShadowSeed(path) {
  const empty = { common: [], byAgent: {} };
  if (!path || !existsSync(path)) return empty;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const byAgent = {};
    for (const k of Object.keys(raw)) {
      if (k === 'common') {
        (Array.isArray(raw.common) ? raw.common : []).forEach((s) => {
          if (typeof s === 'string' && !empty.common.includes(s)) empty.common.push(s);
        });
      } else if (typeof raw[k] === 'string') {
        byAgent[k] = [raw[k]];
      } else if (Array.isArray(raw[k])) {
        byAgent[k] = raw[k].filter((s) => typeof s === 'string');
      }
    }
    return { common: empty.common, byAgent };
  } catch (e) {
    debugLog(`shadow-seed 解析失败（已忽略）: ${e.message}`);
    return empty;
  }
}

/**
 * 采集样式表 AST：遍历 `document.styleSheets` + `document.adoptedStyleSheets` 的 cssRules，
 * 提取 `:root`/`:host` 变量**声明原文**与主题相关选择器。补 `getComputedStyle` 看不到的盲区——
 * 大量 React-Radix / shadcn / Tailwind 应用把变量声明在构造样式表（adoptedStyleSheets）里，
 * `document.styleSheets` 根本列不到它们，`getComputedStyle` 又只能拿到最终生效值、拿不到声明结构。
 */
function buildStyleAstExpression() {
  return `(() => {
    const out = { styleSheets: 0, adoptedSheets: 0, cssRules: 0, adoptedCssRules: 0, rootVars: [], adoptedRootVars: [], themeSelectors: [], errors: [] };
    const selSeen = new Set();
    const THEME_RE = /(dark|light|theme|scheme|contrast|color-mode)/i;
    const collect = (rule, into, seen) => {
      let cssText = '';
      let selectorText = '';
      try { cssText = rule.cssText || ''; selectorText = rule.selectorText || ''; } catch (e) { return; }
      if (!cssText) return;
      const isRootRule = rule.type === 1 && (selectorText === ':root' || selectorText === ':host' || selectorText.startsWith(':root') || selectorText.startsWith(':host'));
      if (isRootRule) {
        const decls = cssText.match(/--[A-Za-z0-9_-]+\\s*:[^;}]+/g);
        if (decls) for (const decl of decls) {
          const name = (decl.match(/^(--[A-Za-z0-9_-]+)/) || [])[1];
          if (name && !name.startsWith('--agentskin-') && !seen.has(name)) {
            seen.add(name);
            into.push({ name, value: decl.slice(decl.indexOf(':') + 1).trim().slice(0, 80) });
          }
        }
      }
      if (selectorText && THEME_RE.test(selectorText) && !selSeen.has(selectorText) && out.themeSelectors.length < 200) {
        selSeen.add(selectorText);
        out.themeSelectors.push(selectorText);
      }
    };
    const rootSeen = new Set();
    const adoptedSeen = new Set();
    for (let i = 0; i < document.styleSheets.length; i++) {
      let rules;
      try { rules = document.styleSheets[i].cssRules; } catch (e) { out.errors.push('cssRules:' + (e.name || '')); continue; }
      if (!rules) continue;
      out.styleSheets += 1;
      for (let j = 0; j < rules.length; j++) { out.cssRules += 1; collect(rules[j], out.rootVars, rootSeen); }
    }
    if (document.adoptedStyleSheets && document.adoptedStyleSheets.length) {
      for (const ss of document.adoptedStyleSheets) {
        let rules;
        try { rules = ss.cssRules; } catch (e) { continue; }
        if (!rules) continue;
        out.adoptedSheets += 1;
        for (let j = 0; j < rules.length; j++) { out.adoptedCssRules += 1; collect(rules[j], out.adoptedRootVars, adoptedSeen); }
      }
    }
    return JSON.stringify(out);
  })()`;
}

/** 遍历 Shadow DOM：open shadow root 完整采集（内部 styleSheets/adoptedStyleSheets/元素数），
 *  closed shadow 通过 rule 已知风险选择器启发式标记。全只读，零副作用。 */
function buildShadowDomExpression(riskSelectors = []) {
  const riskList = JSON.stringify(riskSelectors);
  return `(() => {
    const out = { openHosts: [], openHostCount: 0, totalShadowEls: 0, adoptedInShadow: 0, closedShadowRisk: [] };
    const MAX_HOSTS = 100;
    const MAX_SCAN = 20000;
    let scanned = 0;
    const walk = (root, depth) => {
      if (depth > 3 || out.openHostCount >= MAX_HOSTS) return;
      let nodes;
      try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
      for (const el of nodes) {
        if (++scanned > MAX_SCAN) return;
        const sr = el.shadowRoot;
        if (!sr) continue;
        out.openHostCount += 1;
        const innerEls = sr.querySelectorAll('*').length;
        out.totalShadowEls += innerEls;
        if (sr.adoptedStyleSheets?.length) out.adoptedInShadow += sr.adoptedStyleSheets.length;
        if (out.openHosts.length < MAX_HOSTS) {
          out.openHosts.push({
            tag: el.tagName?.toLowerCase() ?? '',
            cls: (typeof el.className === 'string' && el.className) ? el.className.split(/\\s+/).slice(0, 3) : [],
            depth,
            innerEls,
            styleSheets: sr.styleSheets?.length ?? 0,
            adopted: sr.adoptedStyleSheets?.length ?? 0,
          });
        }
        walk(sr, depth + 1);
      }
    };
    walk(document, 0);
    const risks = ${riskList};
    for (const sel of risks) {
      try {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (!el.shadowRoot) {
            out.closedShadowRisk.push({ selector: sel, host: el.tagName?.toLowerCase() ?? '', matches: els.length });
            break;
          }
        }
      } catch (e) { /* 非法选择器跳过 */ }
    }
    return JSON.stringify(out);
  })()`;
}

/**
 * 采集 DOM 上下文：documentElement.dataset、localStorage/sessionStorage 键名、
 * meta color-scheme、prefers-color-scheme。只读，零副作用。
 * 隐私约束：storage 仅采集**键名**；仅 theme 相关键（theme/dark/light/scheme/mode/color/appearance）
 * 才读取其值（值通常为 'dark'/'light' 等短字符串，且截断 200 字符），避免泄露 token 等敏感值。
 */
function buildDomContextExpression() {
  return `(() => {
    const out = { dataset: {}, localStorageKeys: [], sessionStorageKeys: [], themeStorage: [], metaColorScheme: null, prefersDark: null, prefersLight: null };
    const de = document.documentElement;
    if (de && de.dataset) for (const k in de.dataset) out.dataset[k] = de.dataset[k];
    const THEME_KEY_RE = /theme|dark|light|scheme|appearance|color-mode/i;
    const dump = (storage, intoKeys) => {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (!k) continue;
          intoKeys.push(k);
          if (THEME_KEY_RE.test(k)) {
            let v = null;
            try { v = storage.getItem(k); } catch (e) {}
            if (v != null && String(v).length < 200) out.themeStorage.push({ key: k, value: String(v) });
          }
        }
      } catch (e) { /* storage 被禁用/跨域 */ }
    };
    const ls = (typeof localStorage !== 'undefined') ? localStorage : null;
    const ss = (typeof sessionStorage !== 'undefined') ? sessionStorage : null;
    if (ls) dump(ls, out.localStorageKeys);
    if (ss) dump(ss, out.sessionStorageKeys);
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) out.metaColorScheme = meta.getAttribute('content') ?? null;
    try {
      out.prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      out.prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    } catch (e) {}
    return JSON.stringify(out);
  })()`;
}

/** 抽样 landmark 节点的 computed 背景/文字色（只读），供 Layer4 元模型自校验判断 dark/light 特征。 */
function buildLandmarkColorExpression(selectors) {
  return `(() => {
    const sels = ${JSON.stringify(selectors)};
    const samples = [];
    for (const sel of sels) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const cs = getComputedStyle(el);
        samples.push({ selector: sel, backgroundColor: cs.backgroundColor, color: cs.color });
      } catch (e) {}
    }
    return JSON.stringify(samples);
  })()`;
}

/** 逐条求值 verification 选择器：是否命中（含是否可见）。 */
function buildLandmarkExpression(selectors) {
  const list = JSON.stringify(selectors);
  return `(() => {
    const selectors = ${list};
    const visible = (node) => {
      if (!node) return false;
      const box = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      return box.width > 0 && box.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    const out = [];
    for (const sel of selectors) {
      let nodes = [];
      let error = null;
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch (e) { error = String(e?.message ?? e); }
      const matched = nodes.filter(visible);
      out.push({ selector: sel, matches: nodes.length, visible: matched.length, error });
    }
    return JSON.stringify(out);
  })()`;
}

async function evaluateJson(client, expression) {
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    timeout: 12000,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text ?? 'Runtime.evaluate exception');
  return result.value;
}

async function probeRuntime(adapter, target) {
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  try {
    await client.send('Runtime.enable').catch(() => {});
    const classInventory = JSON.parse(
      await evaluateJson(client, buildClassInventoryExpression(RUNTIME_CLASS_CAP)),
    );
    const rootVars = JSON.parse(await evaluateJson(client, buildVarsExpression(RUNTIME_VAR_CAP)));
    // bridge 可达性探测（修正口径）：对每个 bridge 变量在 root/body 显式 getPropertyValue 寻址，
    // 规避 cs[] 枚举对 adopted 注入变量的漏采（该漏采曾误判 workbuddy/qoderwork 为「组件作用域不可达」）。
    const bridgeReach = await evaluateJson(
      client,
      buildBridgeReachExpression((adapter.bridge ?? []).map((e) => e.var)),
    )
      .then((v) => JSON.parse(v))
      .catch(() => ({ root: {}, body: {} }));

    // 样式 AST（document.styleSheets + adoptedStyleSheets）与 Shadow DOM 遍历——只读、独立降级，
    // 任一失败仅置 error 字段，不阻断 classInventory/rootVars 主链路。
    const styleAst = await evaluateJson(client, buildStyleAstExpression())
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));
    // closed shadow 种子随 Agent 解析（COMMON ∪ 分桶 ∪ --shadow-seed），写入结果便于消费方回看探测依据
    const shadowSeeds = resolveShadowRiskSelectors(adapter.id);
    const shadowDom = await evaluateJson(client, buildShadowDomExpression(shadowSeeds))
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));
    const domContext = await evaluateJson(client, buildDomContextExpression())
      .then((v) => JSON.parse(v))
      .catch((e) => ({ error: e.message }));

    const landmarkChecks = [];
    const verification = adapter.verification ?? { rootAny: ['body'], recommended: [] };
    const landmarkSelectors = [];
    for (const sel of verification.rootAny ?? []) landmarkSelectors.push({ name: 'root', sel });
    for (const item of verification.recommended ?? []) {
      for (const sel of item.any ?? []) landmarkSelectors.push({ name: item.name, sel });
    }
    for (const { name, sel } of landmarkSelectors) {
      const results = JSON.parse(await evaluateJson(client, buildLandmarkExpression([sel])));
      const hit = results[0];
      landmarkChecks.push({
        scope: name,
        selector: sel,
        matches: hit.matches,
        visible: hit.visible,
        error: hit.error ?? null,
      });
    }
    // landmark computed 颜色采样（供 Layer4 自校验），失败降级为空数组不阻断
    const landmarkColors = await evaluateJson(
      client,
      buildLandmarkColorExpression(landmarkSelectors.map(({ sel }) => sel)),
    )
      .then((v) => JSON.parse(v))
      .catch(() => []);
    // target 全枚举（多 frame / iframe / worker），失败降级不阻断主链路
    const targetEnumeration = await enumerateTargets(target.port);
    return {
      ok: true,
      port: target.port,
      title: target.title ?? null,
      classInventory,
      rootVars,
      bridgeReach,
      styleAst,
      shadowDom,
      shadowSeeds,
      domContext,
      landmarkColors,
      targetEnumeration,
      landmarkChecks,
    };
  } finally {
    client.close();
  }
}

// ===========================================================================
// 4. 静态解包探测（@electron/asar 只读，不解压到磁盘）
// ===========================================================================

function locateAsar(appPath, executable) {
  const dirs = [appPath, executable ? dirname(executable) : null].filter(Boolean);
  const candidates = [
    join(appPath, 'resources', 'app.asar'),
    join(appPath, 'app.asar'),
    join(appPath, 'resources', 'app.asar.unpacked'), // 无 asar 的 unpacked 布局
  ];
  for (const dir of dirs) {
    candidates.push(join(dir, 'resources', 'app.asar'));
    candidates.push(join(dir, 'app.asar'));
  }
  for (const candidate of [...new Set(candidates)]) if (existsSync(candidate)) return candidate;
  return null;
}

const CLASS_LITERAL_RE = /(?:className|class)\s*[:=]\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;

function extractClassTokens(source) {
  const tokens = new Set();
  let match = CLASS_LITERAL_RE.exec(source);
  while (match) {
    const literal = match[1] ?? match[2] ?? match[3] ?? '';
    for (const token of literal.split(/\s+/)) {
      if (/^[A-Za-z0-9_-]+$/.test(token) && token !== 'className') tokens.add(token);
    }
    match = CLASS_LITERAL_RE.exec(source);
  }
  return tokens;
}

const CSS_VAR_RE = /(--[A-Za-z0-9_-]+)\s*:/g;

function extractCssVars(source) {
  const vars = new Set();
  let match = CSS_VAR_RE.exec(source);
  while (match) {
    vars.add(match[1]);
    match = CSS_VAR_RE.exec(source);
  }
  return vars;
}

// ---- 解包布局（traework 等 VS Code 系无 app.asar，app 直接解包在 resources\app）----

import { statSync } from 'node:fs';
import { readdir as fsReaddir } from 'node:fs/promises';

async function collectFiles(root, extensions, byteCap, opts = {}) {
  const results = [];
  let bytes = 0;
  const walk = async (dir, depth) => {
    if (depth > 8 || bytes >= byteCap) return;
    let entries;
    try {
      entries = await fsReaddir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (bytes >= byteCap) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        // 跳过体积巨大且与 UI 无关的目录
        if (/node_modules|\.git|locales|bin|extensions|licenses/i.test(entry.name)) continue;
        // CEF 子应用过滤：--skip-cef-subapp 时跳过 local_webcontents/apps 等无关子应用目录
        if (opts.skipDirs && opts.skipDirs.test(entry.name)) {
          debugLog(`跳过子应用目录: ${full}`);
          continue;
        }
        await walk(full, depth + 1);
      } else if (entry.isFile() && extensions.test(entry.name)) {
        try {
          const size = statSync(full).size;
          bytes += size;
          results.push({ path: full, size });
        } catch {
          /* ignore */
        }
      }
    }
  };
  await walk(root, 0);
  return { files: results, bytes };
}

async function probeUnpacked(unpackedRoot, displayName, layout = 'unpacked', opts = {}) {
  // CEF 专属：--skip-cef-subapp 时跳过 apps 等无关子应用目录，避免 office 套件污染对拍结果
  const collectOpts = layout === 'cef' && opts.skipCefSubapp ? { skipDirs: /^apps$/i } : {};
  const { files: jsFiles, bytes: jsBytes } = await collectFiles(
    unpackedRoot,
    /\.js$/i,
    STATIC_BYTES_PER_FILE * STATIC_JS_FILE_CAP,
    collectOpts,
  );
  const { files: cssFiles, bytes: cssBytes } = await collectFiles(
    unpackedRoot,
    /\.css$/i,
    STATIC_CSS_BYTES_TOTAL,
    collectOpts,
  );

  const jsPriority = (p) => {
    const n = p.replace(/\\/g, '/');
    if (/\/webview\//i.test(n)) return 0;
    if (/\/renderer\//i.test(n)) return 1;
    if (/\/vite\//i.test(n)) return 2;
    if (/\/assets\//i.test(n)) return 3;
    if (/\/dist\//i.test(n)) return 4;
    if (/\/out\//i.test(n)) return 5;
    return 9;
  };
  const sortByPriority = (a, b) => jsPriority(a.path) - jsPriority(b.path);

  const classTokens = new Set();
  const { readFileSync } = await import('node:fs');
  let jsScanned = 0;
  for (const file of jsFiles.sort(sortByPriority)) {
    if (jsScanned >= STATIC_JS_FILE_CAP) break;
    try {
      const buffer = readFileSync(file.path);
      if (looksBinary(buffer)) {
        debugLog(`跳过非文本 JS: ${file.path}`);
        continue;
      }
      jsScanned += 1;
      debugLog(`扫描 JS: ${file.path}`);
      const source = buffer.subarray(0, STATIC_BYTES_PER_FILE).toString('utf8');
      for (const token of extractClassTokens(source)) classTokens.add(token);
    } catch {
      /* ignore */
    }
  }

  const cssVars = new Set();
  for (const file of cssFiles.sort(sortByPriority)) {
    try {
      const buffer = readFileSync(file.path);
      if (looksBinary(buffer)) {
        debugLog(`跳过非文本 CSS: ${file.path}`);
        continue;
      }
      debugLog(`扫描 CSS: ${file.path}`);
      const source = buffer.subarray(0, STATIC_CSS_BYTES_TOTAL).toString('utf8');
      for (const name of extractCssVars(source)) cssVars.add(name);
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    appPath: unpackedRoot,
    asarPath: null,
    layout,
    scanned: { jsFiles: jsScanned, jsBytes, cssFiles: cssFiles.length, cssBytes },
    classTokens: { unique: classTokens.size, tokens: [...classTokens] },
    cssVars: { unique: cssVars.size, names: [...cssVars] },
  };
}

async function probeStatic(adapter) {
  let discovered = await discoverApp(adapter, process.platform);
  if (!discovered) discovered = await discoverByProcess(adapter);
  if (!discovered) return { ok: false, error: '安装路径未发现（也未找到运行中的进程）' };
  const asarPath = locateAsar(discovered.appPath, discovered.executable);
  if (asarPath && asarPath.endsWith('.asar')) {
    return probeAsar(adapter, discovered, asarPath);
  }

  // 无 app.asar：解包布局（resources\app）或 CEF 布局（doubao local_webcontents）
  const unpackedRoots = [
    join(discovered.appPath, 'resources', 'app'),
    discovered.executable ? join(dirname(discovered.executable), 'resources', 'app') : null,
  ].filter(Boolean);
  for (const root of unpackedRoots) {
    if (existsSync(join(root, 'out')) || existsSync(join(root, 'package.json'))) {
      return probeUnpacked(root, adapter.displayName, 'unpacked', OPTIONS);
    }
  }

  // CEF 布局（doubao）：renderer 资源在 local_webcontents 下
  const cefRoots = [
    join(discovered.appPath, 'local_webcontents'),
    discovered.executable ? join(dirname(discovered.executable), 'local_webcontents') : null,
  ].filter(Boolean);
  for (const root of cefRoots) {
    if (existsSync(root)) {
      const result = await probeUnpacked(root, adapter.displayName, 'cef', OPTIONS);
      // 显式 --skip-cef-subapp 时，过滤后可能为空（如 doubao 仅 office 子应用有松散 JS），
      // 属预期结果而非探测失败，仍接受为空扫描
      if (result.ok && (result.classTokens.unique > 0 || OPTIONS.skipCefSubapp)) {
        if (result.classTokens.unique === 0) {
          debugLog(`${adapter.id}: CEF 子应用过滤后无剩余 JS/CSS（预期）`);
        }
        return result;
      }
    }
  }
  return {
    ok: false,
    appPath: discovered.appPath,
    error: '未找到 app.asar，且非 Electron 解包/CEF 布局',
  };
}

/** discoverApp 失败时按运行中进程回退定位可执行文件（如 doubao 的 %MyAppPrograms% 字面路径）。 */
async function discoverByProcess(adapter) {
  const names = (adapter.platforms[process.platform]?.processNames ?? []).filter(Boolean);
  if (!names.length) return null;
  try {
    // PowerShell 的 Get-Process -Name 不接受 .exe 后缀（"Doubao.exe" 匹配不到），必须去掉
    const psNames = names.map((n) => (n.toLowerCase().endsWith('.exe') ? n.slice(0, -4) : n));
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-Process -Name ${JSON.stringify(psNames.join(','))} -ErrorAction SilentlyContinue | Where-Object { $_.Path } | Select-Object -First 1 -ExpandProperty Path`,
      ],
      { timeout: 8000 },
    );
    const executable = stdout.trim();
    if (executable && existsSync(executable)) {
      return { appId: adapter.id, appPath: dirname(executable), executable };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

async function probeAsar(adapter, discovered, asarPath) {
  let files = [];
  try {
    files = asar.listPackage(asarPath);
  } catch (e) {
    return {
      ok: false,
      appPath: discovered.appPath,
      asarPath,
      error: `asar 读取失败: ${e.message}`,
    };
  }

  // asar.listPackage 在 Windows 返回带前导反斜杠的路径；extractFile 需要去掉前导
  // 反斜杠但仍保留反斜杠分隔（"webview\\assets\\x.css"）。这里统一归一化用于过滤，
  // 用 rawPath（仅去前导 \）做实际读取。
  const norm = (f) => (f.startsWith('\\') ? f.slice(1) : f).replace(/\\/g, '/');

  const jsPriority = (n) => {
    if (/^\/?webview\//i.test(n)) return 0; // Codex 的 renderer bundle 目录
    if (/\/renderer\//i.test(n)) return 1;
    if (/\/vite\/build\//i.test(n)) return 2; // Codex 的 preload/bundle 目录
    if (/\/assets\//i.test(n)) return 3;
    if (/\/dist\//i.test(n)) return 4;
    if (/\/out\//i.test(n)) return 5;
    return 9;
  };

  // 只挑 renderer 相关的 JS（按目录优先级排序，取前 N 个）与全部 CSS
  const rendererJs = files
    .filter((f) => !/node_modules/.test(norm(f)) && jsPriority(norm(f)) < 9 && /\.js$/i.test(f))
    .sort((a, b) => jsPriority(norm(a)) - jsPriority(norm(b)))
    .slice(0, STATIC_JS_FILE_CAP);
  const cssFiles = files
    .filter((f) => !/node_modules/.test(norm(f)) && /\.css$/i.test(f))
    .sort((a, b) => jsPriority(norm(a)) - jsPriority(norm(b)));

  const readFile = (file) => {
    const raw = file.startsWith('\\') ? file.slice(1) : file;
    return asar.extractFile(asarPath, raw);
  };

  const classTokens = new Set();
  let jsScanned = 0;
  let jsBytes = 0;
  for (const file of rendererJs) {
    try {
      const buffer = readFile(file);
      if (looksBinary(buffer.subarray(0, 2048))) {
        debugLog(`跳过非文本 JS: ${norm(file)}`);
        continue;
      }
      jsScanned += 1;
      jsBytes += Math.min(buffer.length, STATIC_BYTES_PER_FILE);
      debugLog(`扫描 JS: ${norm(file)}`);
      const source = buffer.subarray(0, STATIC_BYTES_PER_FILE).toString('utf8');
      for (const token of extractClassTokens(source)) classTokens.add(token);
    } catch {
      /* 个别文件损坏跳过 */
    }
  }

  const cssVars = new Set();
  let cssBytes = 0;
  for (const file of cssFiles) {
    try {
      const buffer = readFile(file);
      if (looksBinary(buffer.subarray(0, 2048))) {
        debugLog(`跳过非文本 CSS: ${norm(file)}`);
        continue;
      }
      const remaining = STATIC_CSS_BYTES_TOTAL - cssBytes;
      if (remaining <= 0) break;
      debugLog(`扫描 CSS: ${norm(file)}`);
      const source = buffer.subarray(0, remaining).toString('utf8');
      cssBytes += Math.min(buffer.length, remaining);
      for (const name of extractCssVars(source)) cssVars.add(name);
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    appPath: discovered.appPath,
    asarPath,
    scanned: { jsFiles: jsScanned, jsBytes, cssFiles: cssFiles.length, cssBytes },
    classTokens: { unique: classTokens.size, tokens: [...classTokens] },
    cssVars: { unique: cssVars.size, names: [...cssVars] },
  };
}

// ===========================================================================
// 5. 对拍
// ===========================================================================

function setDiff(staticSet, runtimeSet) {
  const shared = [...staticSet].filter((t) => runtimeSet.has(t));
  const onlyStatic = [...staticSet].filter((t) => !runtimeSet.has(t));
  const onlyRuntime = [...runtimeSet].filter((t) => !staticSet.has(t));
  return { shared, onlyStatic, onlyRuntime };
}

function bridgeStatus(adapter, runtimeVarNames, staticVarNames) {
  const runtimeVars = new Set(runtimeVarNames);
  const staticVars = new Set(staticVarNames);
  return (adapter.bridge ?? []).map((entry) => ({
    var: entry.var,
    role: entry.role,
    alpha: entry.alpha ?? 1,
    presentInRuntime: runtimeVars.has(entry.var), // :root 计算样式可达
    declaredInStatic: staticVars.has(entry.var), // 静态 CSS 中有声明（可能只在组件作用域）
  }));
}

function buildCompare(
  adapter,
  runtime,
  statik,
  ignore = { classTokens: new Set(), cssVars: new Set() },
) {
  const runtimeFreq = new Map(runtime.classInventory?.top ?? []); // token -> DOM 出现频次
  const runtimeClassNames = new Set(runtimeFreq.keys());
  const runtimeVarNames = new Set(runtime.rootVars?.names ?? []);
  const staticClassNames = new Set(statik.classTokens?.tokens ?? []);
  const staticVarNames = new Set(statik.cssVars?.names ?? []);

  // 黑白名单（--ignore）：剔除固定噪声类名/变量（CSS Modules 哈希变体、无意义工具类等），减少无效 diff
  for (const t of ignore.classTokens) {
    staticClassNames.delete(t);
    runtimeClassNames.delete(t);
  }
  for (const v of ignore.cssVars) {
    staticVarNames.delete(v);
    runtimeVarNames.delete(v);
  }

  const classes = setDiff(staticClassNames, runtimeClassNames);
  const vars = setDiff(staticVarNames, runtimeVarNames);

  // onlyRuntime 按运行时 DOM 出现频次降序（优先展示高频核心业务差异），
  // 过滤疑似 CSS Modules 哈希噪声；onlyStatic 保留静态扫描顺序（资源变更可追溯）。
  const isCssModuleNoise = (t) => /_[A-Za-z0-9]{6,}/.test(t);
  const onlyRuntimeSorted = classes.onlyRuntime
    .map((t) => ({ t, count: runtimeFreq.get(t) ?? 0 }))
    .sort((a, b) => b.count - a.count)
    .map((x) => x.t);
  const topRuntimeDiffs = onlyRuntimeSorted
    .filter((t) => !isCssModuleNoise(t))
    .map((t) => ({ name: t, count: runtimeFreq.get(t) ?? 0 }))
    .slice(0, DIFF_LIST_CAP);

  // 结构覆盖率：打包声明的类名有多少在运行时真的出现
  const classCoverage = staticClassNames.size
    ? (classes.shared.length / staticClassNames.size).toFixed(3)
    : null;
  const varCoverage = staticVarNames.size
    ? (vars.shared.length / staticVarNames.size).toFixed(3)
    : null;

  // 桥接变量可达性：区分「不可达」与「静态 CSS 也未声明（疑似失效 entry）」
  // presentInRuntime 判定合并两来源：
  //   - rootVars：:root 计算样式枚举，覆盖直接声明在 :root 的变量（codex/traework/zcode 等）
  //   - bridgeReach：显式 getPropertyValue 寻址 root/body，覆盖 adopted 注入 / body 级声明
  //     （cs[] 枚举对 adoptedStyleSheets 注入的变量漏采，曾误判 workbuddy/qoderwork 为不可达）
  const brRootKeys = Object.keys(runtime.bridgeReach?.root ?? {});
  const brBodyKeys = Object.keys(runtime.bridgeReach?.body ?? {});
  const reachableVarNames = new Set([
    ...(runtime.rootVars?.names ?? []),
    ...brRootKeys,
    ...brBodyKeys,
  ]);
  const bridge = bridgeStatus(adapter, reachableVarNames, statik.cssVars?.names ?? []);
  const bridgeMissing = bridge.filter((b) => !b.presentInRuntime);
  const bridgeNeverDeclared = bridgeMissing.filter((b) => !b.declaredInStatic);

  // verification 选择器对应的类 token 在运行时是否可见
  const verificationDrift = (runtime.landmarkChecks ?? [])
    .filter((c) => c.error == null)
    .map((c) => ({ selector: c.selector, scope: c.scope, matches: c.matches, visible: c.visible }));

  // Tailwind @theme-inline 组件级主题模式识别：静态有变量，且 :root 枚举 + 显式寻址均读不到，
  // 才判定为纯组件作用域（避免 adopted/body 注入被误判为不可达而误喊需改组件注入）。
  const themeHint = [];
  const bridgeReachEmpty = brRootKeys.length === 0 && brBodyKeys.length === 0;
  if (statik.cssVars?.unique > 0 && (runtime.rootVars?.unique ?? 0) === 0 && bridgeReachEmpty) {
    themeHint.push(
      `检测疑似 Tailwind @theme-inline 模式：静态声明 ${statik.cssVars.unique} 个 CSS 变量，但运行时 :root 读取不到（变量仅组件作用域），当前 :root 桥接策略会失效，需改为组件级注入`,
    );
  }

  const onlyStaticCssModules = classes.onlyStatic.filter(isCssModuleNoise);
  const verdicts = [];
  if (classes.onlyStatic.length) {
    const cssModules = onlyStaticCssModules.length;
    verdicts.push(
      `静态声明但运行时未出现 ${classes.onlyStatic.length} 个类名${cssModules ? `（其中疑似 CSS Modules 哈希 ${cssModules} 个，属正常）` : ''}`,
    );
  }
  if (classes.onlyRuntime.length) {
    verdicts.push(
      `运行时出现 ${classes.onlyRuntime.length} 个静态抓不到的类名（动态生成 / CSS Modules）`,
    );
  }
  if (bridgeNeverDeclared.length) {
    verdicts.push(
      `bridge 变量 ${bridgeNeverDeclared.length} 个在静态 CSS 与运行时 :root 均未声明（疑似失效 entry）: ${bridgeNeverDeclared.map((b) => b.var).join(', ')}`,
    );
  }
  const componentScoped = bridgeMissing.filter((b) => b.declaredInStatic);
  if (componentScoped.length) {
    verdicts.push(
      `bridge 变量 ${componentScoped.length} 个仅存在于组件作用域（不在 :root），JS getComputedStyle 读不到: ${componentScoped.map((b) => b.var).join(', ')}`,
    );
  }
  const deadLandmarks = verificationDrift.filter((c) => c.visible === 0);
  if (deadLandmarks.length) {
    verdicts.push(
      `适配器 verification 选择器失效 ${deadLandmarks.length} 个: ${deadLandmarks.map((c) => c.selector).join(', ')}`,
    );
  }
  for (const hint of themeHint) verdicts.push(hint);
  if (!verdicts.length) verdicts.push('结构与 bridge entries 均与运行时一致');

  // 只有 bridge 变量不可达 / verification 选择器失效才算可行动漂移；
  // 类名与变量覆盖差异多为 CSS Modules 哈希等常规现象，仅作信息展示。
  const drift = bridgeMissing.length > 0 || deadLandmarks.length > 0;

  return {
    drift,
    classes: {
      sharedCount: classes.shared.length,
      onlyStaticCount: classes.onlyStatic.length,
      onlyRuntimeCount: classes.onlyRuntime.length,
      coverage: classCoverage,
      onlyStaticTop: classes.onlyStatic.slice(0, DIFF_LIST_CAP),
      onlyRuntimeTop: onlyRuntimeSorted.slice(0, DIFF_LIST_CAP),
    },
    vars: {
      sharedCount: vars.shared.length,
      onlyStaticCount: vars.onlyStatic.length,
      onlyRuntimeCount: vars.onlyRuntime.length,
      coverage: varCoverage,
      onlyStaticTop: vars.onlyStatic.slice(0, DIFF_LIST_CAP),
      onlyRuntimeTop: vars.onlyRuntime.slice(0, DIFF_LIST_CAP),
    },
    bridge,
    bridgeMissing,
    verificationDrift,
    themeHint,
    topRuntimeDiffs,
    verdicts,
  };
}

// ===========================================================================
// 6. 主流程
// ===========================================================================

/** 适配器源文件绝对路径（补丁建议的落地目标）。 */
function adapterSourceFile(adapterId) {
  return resolve(`src/engine/src/adapters/${adapterId}.mjs`);
}

/**
 * 自动生成适配器修订建议（源码可落地、机器可读，供 CI / 源码修订消费）。
 * 纯规则匹配，数据来源为对拍结果，不引入模型 / 外部依赖。
 * action.type ∈ { remove_verification_selector, remove_bridge_entry, switch_to_component_injection }。
 * 每条 action 附 sourceFile（适配器源文件）与 patch（{ location, current, change } 精确修订位点），
 * 使建议可直接落到 src/engine/src/adapters/<id>.mjs 的 verification / bridge 配置。
 */
function buildPatchActions(adapterId, compare) {
  const actions = [];
  const sourceFile = adapterSourceFile(adapterId);
  // recommended 域 scope -> 数组下标 映射，让 location 精确到 verification.recommended[<idx>].any
  // （同名 scope 在 recommended 中出现多次时取首个，location 仍可人工定位到数组）
  const adapter = listAdapters().find((a) => a.id === adapterId);
  const recommendedIndex = new Map(
    (adapter?.verification?.recommended ?? []).map((s, i) => [s.name, i]),
  );
  const dead = (compare?.verificationDrift ?? []).filter((c) => c.visible === 0);
  for (const d of dead) {
    // scope 来自 landmarkChecks：'root' 对应 verification.rootAny，其余对应
    // verification.recommended.<scope>.any —— 可直接定位到具体数组。
    const location =
      d.scope === 'root'
        ? 'verification.rootAny'
        : recommendedIndex.has(d.scope)
          ? `verification.recommended[${recommendedIndex.get(d.scope)}].any`
          : `verification.recommended[${d.scope}].any`;
    actions.push({
      type: 'remove_verification_selector',
      target: d.selector,
      scope: d.scope,
      sourceFile,
      patch: { location, current: d.selector, change: 'remove' },
      severity: 'high',
      note: `选择器运行时已无可见命中（matches=${d.matches}），建议从 ${location} 中移除或替换`,
    });
  }
  for (const b of compare?.bridgeMissing ?? []) {
    if (!b.declaredInStatic) {
      actions.push({
        type: 'remove_bridge_entry',
        var: b.var,
        role: b.role,
        sourceFile,
        patch: { location: 'bridge', current: { var: b.var, role: b.role }, change: 'remove' },
        severity: 'high',
        note: '静态 CSS 与运行时 :root 均未声明，疑似失效 entry，建议从 bridge 数组移除',
      });
    } else {
      actions.push({
        type: 'switch_to_component_injection',
        var: b.var,
        role: b.role,
        sourceFile,
        patch: {
          location: 'bridge',
          current: { var: b.var, role: b.role },
          change: 'remove-or-component-inject',
        },
        severity: 'medium',
        note: '变量仅存在于组件作用域（不在 :root），建议改为组件级注入而非 :root 桥接',
      });
    }
  }
  for (const h of compare?.themeHint ?? []) {
    actions.push({
      type: 'switch_to_component_injection',
      target: 'agent-wide',
      sourceFile,
      severity: 'medium',
      note: h,
    });
  }
  return actions;
}

function agentStatus(r) {
  if (!r.runtime?.ok || !r.static?.ok) return 'partial';
  if (r.compare?.drift) return 'DRIFT';
  return 'OK';
}

// ---- 补丁自动写回：将「确定性删除」类建议直接落到适配器源码 ----
// 通过括号平衡扫描 + 顶层逗号切分，把死 landmark 选择器 / 失效 bridge entry
// 从 verification.rootAny / recommended.<scope>.any / bridge 数组中精确移除，
// 保持源码结构合法（不破坏其它元素）。仅支持确定性删除；
// switch_to_component_injection 需设计决策（组件级注入实现），保持人工落地。

/** 括号平衡扫描：从 openIndex（指向 '[' 或 '{'）返回 {start,end}，找不到返回 null。 */
function balancedSpan(src, openIndex, close) {
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = openIndex; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0 && ch === close) return { start: openIndex, end: i + 1 };
    }
  }
  return null;
}

function arraySpan(src, openIndex) {
  return balancedSpan(src, openIndex, ']');
}

function objectSpan(src, openIndex) {
  return balancedSpan(src, openIndex, '}');
}

/** 返回 region（数组内层区间）中所有顶层逗号位置。 */
function topLevelCommas(src, region) {
  const out = [];
  let depth = 0;
  let inStr = false;
  let quote = '';
  let esc = false;
  for (let i = region.start; i < region.end; i++) {
    const ch = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) out.push(i);
  }
  return out;
}

/** 顶层逗号切分：返回 region 内每个直接子元素（不含空元素）的 {start,end}。 */
function splitTopLevelElements(src, region) {
  const commas = topLevelCommas(src, region);
  const els = [];
  let start = region.start;
  for (const c of commas) {
    els.push({ start, end: c });
    start = c + 1;
  }
  els.push({ start, end: region.end });
  return els.filter((el) => src.slice(el.start, el.end).trim().length > 0);
}

/** 从 region 中删除元素 el（连同其尾随分隔逗号），返回新源码。 */
function removeElementAt(src, region, el) {
  const commas = topLevelCommas(src, region);
  // el.end 落在逗号位置 => 元素自带尾随逗号（中段分隔逗号 / 末位 trailing comma 皆然），
  // 连逗号一并删除，既保留与相邻元素的分隔，也不产生悬空逗号。
  const trailing = commas.find((c) => c === el.end);
  if (trailing !== undefined) return src.slice(0, el.start) + src.slice(trailing + 1);
  // 无尾随逗号（源码未用 trailing comma 时的末位元素）：连同前导分隔逗号一并删除。
  const before = [...commas].reverse().find((c) => c < el.start);
  const start = before ?? el.start;
  return src.slice(0, start) + src.slice(el.end);
}

/** 查找 src 的 [from,to) 内 `key:` 后的数组区间，返回绝对 {start,end}。 */
function findKeyedArray(src, key, from = 0, to = src.length) {
  const slice = src.slice(from, to);
  const re = new RegExp(`\\b${key}\\s*:\\s*(\\[)`);
  const m = re.exec(slice);
  if (!m) return null;
  const openRel = m.index + m[0].length - 1; // 指向 '['
  const span = arraySpan(slice, openRel);
  if (!span) return null;
  return { start: from + span.start, end: from + span.end };
}

/** 在 recommended 数组内查找 `name` 等于 name 的直接子对象区间。 */
function findNamedObject(src, rec, name) {
  const inner = { start: rec.start + 1, end: rec.end - 1 };
  for (const el of splitTopLevelElements(src, inner)) {
    if (!src.slice(el.start, el.end).trim().startsWith('{')) continue;
    const obj = objectSpan(src, el.start);
    if (!obj) continue;
    const m = /\bname\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/.exec(
      src.slice(obj.start, obj.end),
    );
    if (!m) continue;
    const quote = m[1][0];
    const val = m[1].slice(1, -1).replace(quote === '"' ? /\\"/g : /\\'/g, quote);
    if (val === name) return obj;
  }
  return null;
}

/** 在数组 arr 内按 test(元素文本) 找到并删除元素；找不到返回 changed:false。 */
function removeElementByTest(src, arr, test, desc) {
  const inner = { start: arr.start + 1, end: arr.end - 1 };
  const el = splitTopLevelElements(src, inner).find((e) => test(src.slice(e.start, e.end)));
  if (!el) return { changed: false, reason: `未找到目标元素（${desc}）` };
  const next = removeElementAt(src, inner, el);
  if (next === src) return { changed: false, reason: `移除无变化（${desc}）` };
  return { changed: true, src: next, element: src.slice(el.start, el.end).trim() };
}

/** 对单个 patch action 执行精确删除，返回 { changed, src?, element?, reason? }。 */
function removePatch(src, action) {
  if (action.type === 'remove_verification_selector') {
    const target = action.patch?.current ?? action.target;
    if (typeof target !== 'string') return { changed: false, reason: '选择器非字符串' };
    const quoted = JSON.stringify(target);
    if (action.scope === 'root') {
      const arr = findKeyedArray(src, 'rootAny');
      if (!arr) return { changed: false, reason: 'verification.rootAny 数组未找到' };
      return removeElementByTest(src, arr, (t) => t.trim() === quoted, `rootAny 移除 ${target}`);
    }
    const rec = findKeyedArray(src, 'recommended');
    if (!rec) return { changed: false, reason: 'verification.recommended 数组未找到' };
    const obj = findNamedObject(src, rec, action.scope);
    if (!obj) return { changed: false, reason: `recommended 内未找到 ${action.scope} 域` };
    const any = findKeyedArray(src, 'any', obj.start, obj.end);
    if (!any) return { changed: false, reason: `${action.scope}.any 数组未找到` };
    return removeElementByTest(
      src,
      any,
      (t) => t.trim() === quoted,
      `${action.scope}.any 移除 ${target}`,
    );
  }
  if (action.type === 'remove_bridge_entry') {
    const arr = findKeyedArray(src, 'bridge');
    if (!arr) return { changed: false, reason: 'bridge 数组未找到' };
    const marker = `var: ${JSON.stringify(action.var)}`;
    return removeElementByTest(src, arr, (t) => t.includes(marker), `bridge 移除 ${action.var}`);
  }
  return { changed: false, reason: '非自动落地类型（需人工决策）' };
}

/**
 * 批量执行补丁写回。仅落地确定性删除类建议；
 * 返回按文件汇总的结果（含未命中原因与 dry-run 标记），不抛出异常。
 */
function applyPatchActions(actions, { dryRun = false } = {}) {
  const byFile = new Map();
  for (const a of actions) {
    if (a.type !== 'remove_verification_selector' && a.type !== 'remove_bridge_entry') continue;
    if (!a.sourceFile) continue;
    if (!byFile.has(a.sourceFile)) byFile.set(a.sourceFile, []);
    byFile.get(a.sourceFile).push(a);
  }
  const results = [];
  for (const [file, list] of byFile) {
    let src;
    try {
      src = readFileSync(file, 'utf-8');
    } catch (e) {
      results.push({
        file,
        error: String(e.message ?? e),
        applied: 0,
        missed: list.length,
        skipped: 0,
      });
      continue;
    }
    const applied = [];
    const missed = [];
    let modified = src;
    for (const a of list) {
      const res = removePatch(modified, a);
      if (res.changed) {
        modified = res.src;
        applied.push({
          type: a.type,
          target: a.target ?? a.var,
          scope: a.scope,
          location: a.patch?.location,
          element: res.element,
        });
      } else {
        missed.push({
          type: a.type,
          target: a.target ?? a.var,
          scope: a.scope,
          location: a.patch?.location,
          reason: res.reason,
        });
      }
    }
    const wrote = modified !== src && !dryRun;
    if (wrote) writeFileSync(file, modified, 'utf-8');
    results.push({
      file,
      dryRun,
      wrote,
      appliedCount: applied.length,
      missedCount: missed.length,
      applied,
      missed,
    });
  }
  return results;
}

function printAgentReport(adapter, report) {
  const name = report.displayName;
  console.log(`\n=== ${name} (${report.id}) ===`);
  if (report.runtime.ok) {
    console.log(`  CDP   : ok @:${report.runtime.port} title=${report.runtime.title ?? ''}`);
    console.log(
      `          类名 ${report.runtime.classInventory.unique} | :root 变量 ${report.runtime.rootVars.unique}`,
    );
    const sa = report.runtime.styleAst;
    if (sa && !sa.error) {
      const adopted =
        sa.adoptedSheets > 0
          ? ` | adopted构造样式表=${sa.adoptedSheets}(${sa.adoptedCssRules}条)`
          : '';
      console.log(
        `          样式AST: styleSheets=${sa.styleSheets}(${sa.cssRules}条)${adopted} | :root声明=${sa.rootVars.length} 主题选择器=${sa.themeSelectors.length}`,
      );
    } else {
      console.log(`          样式AST: 不可用${sa?.error ? ` (${sa.error})` : ''}`);
    }
    const sd = report.runtime.shadowDom;
    if (sd && !sd.error) {
      const closed = sd.closedShadowRisk?.length
        ? ` | closed风险=${sd.closedShadowRisk.length}`
        : '';
      const adopted = sd.adoptedInShadow > 0 ? ` | shadow内构造样式表=${sd.adoptedInShadow}` : '';
      console.log(
        `          ShadowDOM: openHost=${sd.openHostCount} 内部元素=${sd.totalShadowEls}${adopted}${closed}`,
      );
    } else {
      console.log(`          ShadowDOM: 不可用${sd?.error ? ` (${sd.error})` : ''}`);
    }
    const te = report.runtime.targetEnumeration;
    if (te && !te.error) {
      const byType = Object.entries(te.byType)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const fr = te.frames;
      const frameInfo =
        fr && !fr.error
          ? ` | frame=${fr.frameCount} oopif=${fr.oopifCount}${fr.oopifCount ? ' (跨进程边界)' : ''}`
          : '';
      console.log(
        `          Target: total=${te.total}（${byType}）| iframe=${te.iframes.length} worker=${te.workers.length}${frameInfo}`,
      );
    }
    const drift = report.compare?.verificationDrift ?? [];
    const dead = drift.filter((c) => c.visible === 0);
    console.log(
      `          适配器 landmark: 可见 ${drift.filter((c) => c.visible > 0).length}/${drift.length}${dead.length ? `, 失效 ${dead.map((c) => c.selector).join(' | ')}` : ''}`,
    );
  } else {
    console.log(`  CDP   : 不可用 (${report.runtime.error})`);
  }
  if (report.static.ok) {
    const s = report.static.scanned;
    console.log(`  静态  : ok asar=${report.static.asarPath}`);
    console.log(
      `          扫描 JS ${s.jsFiles} 个(${(s.jsBytes / 1024 / 1024).toFixed(1)}MB) / CSS ${s.cssFiles} 个(${(s.cssBytes / 1024 / 1024).toFixed(1)}MB)`,
    );
    console.log(
      `          类名 ${report.static.classTokens.unique} | CSS 变量 ${report.static.cssVars.unique}`,
    );
  } else {
    console.log(`  静态  : 不可用 (${report.static.error})`);
  }
  if (report.compare) {
    const c = report.compare;
    console.log('  对拍  :');
    console.log(
      `          类名 shared=${c.classes.sharedCount} onlyStatic=${c.classes.onlyStaticCount} onlyRuntime=${c.classes.onlyRuntimeCount} 覆盖率=${c.classes.coverage}`,
    );
    console.log(
      `          变量 shared=${c.vars.sharedCount} onlyStatic=${c.vars.onlyStaticCount} onlyRuntime=${c.vars.onlyRuntimeCount} 覆盖率=${c.vars.coverage}`,
    );
    if (c.bridgeMissing.length) {
      console.log(
        `          桥接缺失 ${c.bridgeMissing.map((b) => `${b.var}(${b.role})`).join(', ')}`,
      );
    }
    if (c.themeHint?.length) {
      console.log(`          主题: ${c.themeHint.join('; ')}`);
    }
    for (const v of c.verdicts) console.log(`          - ${v}`);
    const patches = buildPatchActions(adapter.id, report.compare);
    if (patches.length) {
      console.log(`  补丁建议 ${patches.length} 条（--markdown 输出完整修订清单）:`);
      for (const p of patches) {
        const at = p.patch?.location ? ` @${p.patch.location}` : '';
        console.log(`          [${p.severity}] ${p.type}${at} — ${p.note}`);
      }
    }
  }
}

function printSummaryTable(reports, baselineDiff) {
  console.log('\n\n=== 汇总 ===');
  // 基线对拍可用时才追加「基线」列（新增/恢复/持续/无基线/OK）
  const bd = baselineDiff ? new Map(baselineDiff.agents.map((a) => [a.id, a])) : null;
  const header = bd
    ? ['agent', 'cdp', 'static', 'clsCov', 'varCov', 'bridge缺', '主题', '基线', '结论']
    : ['agent', 'cdp', 'static', 'clsCov', 'varCov', 'bridge缺', '主题', '结论'];
  const rows = reports.map((r) => {
    const c = r.compare;
    const b = bd?.get(r.id);
    const baselineMark = !b
      ? '—'
      : b.isNewDrift
        ? '新增'
        : b.isRecovered
          ? '恢复'
          : b.baselineStatus === 'DRIFT'
            ? '持续'
            : b.baselineStatus === 'absent'
              ? '无基线'
              : 'OK';
    const row = [
      r.id,
      r.runtime.ok ? 'ok' : '—',
      r.static.ok ? 'ok' : '—',
      c ? c.classes.coverage : '—',
      c ? c.vars.coverage : '—',
      c ? String(c.bridgeMissing.length) : '—',
      c?.themeHint?.length ? '!' : '—',
    ];
    if (bd) row.push(baselineMark);
    row.push(agentStatus(r));
    return row;
  });
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => String(row[i] ?? '').length)),
  );
  const fmt = (cells) => cells.map((cell, i) => String(cell).padEnd(widths[i])).join('  ');
  console.log(fmt(header));
  for (const row of rows) console.log(fmt(row));
}

/** Markdown 修订清单：直接面向适配器源码修订的可读报告。 */
function renderMarkdown(reports, baselineDiff) {
  const lines = [];
  lines.push('# AgentSkin 适配器结构漂移修订清单');
  lines.push('');
  lines.push(`> 生成时间：${new Date().toISOString()} ｜ 共 ${reports.length} 个 Agent`);
  if (baselineDiff) {
    lines.push('');
    lines.push('## 基线对拍摘要');
    lines.push('');
    lines.push(`- 新增漂移：**${baselineDiff.newDriftCount}**（基线 OK → 当前出现，需修订）`);
    lines.push(`- 已恢复：**${baselineDiff.recoveredCount}**（基线漂移 → 当前 OK）`);
    lines.push(
      `- 持续漂移：**${baselineDiff.persistentCount}**（基线、当前均有，已知问题不重复告警）`,
    );
  }
  lines.push('');
  for (const r of reports) {
    const status = agentStatus(r);
    lines.push(`## ${r.displayName}（${r.id}）`);
    lines.push('');
    lines.push(`- 运行状态：**${status}**`);
    if (baselineDiff) {
      const b = baselineDiff.agents.find((a) => a.id === r.id);
      if (b) {
        const marks = [];
        if (b.isNewDrift) marks.push('**新增漂移**（基线 OK → 当前漂移）');
        if (b.isRecovered) marks.push('**已恢复**（基线漂移 → 当前 OK）');
        if (b.baselineStatus === 'DRIFT' && !b.isRecovered)
          marks.push('持续漂移（已知问题，不重复告警）');
        if (b.baselineStatus === 'absent') marks.push('基线中无记录（新增 Agent / 首次建基线）');
        if (marks.length) lines.push(`- 基线对拍：${marks.join('；')}`);
        const news = [
          b.newDeadLandmarks?.length
            ? `新增失效选择器 ${b.newDeadLandmarks.length} 个（${b.newDeadLandmarks.join(', ')}）`
            : null,
          b.newBridgeMissing?.length
            ? `新增 bridge 缺失 ${b.newBridgeMissing.length} 个（${b.newBridgeMissing.join(', ')}）`
            : null,
        ].filter(Boolean);
        if (news.length) lines.push(`  - ⚠️ ${news.join('；')}`);
        const resolved = [
          b.resolvedDeadLandmarks?.length
            ? `恢复失效选择器 ${b.resolvedDeadLandmarks.length} 个（${b.resolvedDeadLandmarks.join(', ')}）`
            : null,
          b.resolvedBridgeMissing?.length
            ? `恢复 bridge 缺失 ${b.resolvedBridgeMissing.length} 个（${b.resolvedBridgeMissing.join(', ')}）`
            : null,
        ].filter(Boolean);
        if (resolved.length) lines.push(`  - ✅ ${resolved.join('；')}`);
      }
    }
    if (r.runtime.ok) {
      lines.push(
        `- CDP：ok @:${r.runtime.port}（类名 ${r.runtime.classInventory.unique} / :root 变量 ${r.runtime.rootVars.unique}）`,
      );
      const sa = r.runtime.styleAst;
      if (sa && !sa.error) {
        lines.push(
          `- 样式 AST：styleSheets=${sa.styleSheets}（${sa.cssRules} 条）｜ adoptedStyleSheets=${sa.adoptedSheets}（${sa.adoptedCssRules} 条）｜ :root 声明 ${sa.rootVars.length}｜主题选择器 ${sa.themeSelectors.length}`,
        );
      }
      const sd = r.runtime.shadowDom;
      if (sd && !sd.error) {
        lines.push(
          `- Shadow DOM：open host ${sd.openHostCount}｜内部元素 ${sd.totalShadowEls}｜shadow 内 adoptedStyleSheets ${sd.adoptedInShadow}`,
        );
        if (sd.closedShadowRisk?.length) {
          for (const c of sd.closedShadowRisk)
            lines.push(
              `  - ⚠️ closed shadow 风险：\`${c.selector}\`（host: ${c.host}，matches=${c.matches}）`,
            );
        }
      }
    } else {
      lines.push(`- CDP：不可用（${r.runtime.error}）`);
    }
    if (r.static.ok) {
      lines.push(
        `- 静态解包：${r.static.layout ?? 'asar'}（类名 ${r.static.classTokens.unique} / CSS 变量 ${r.static.cssVars.unique}）`,
      );
    } else {
      lines.push(`- 静态解包：不可用（${r.static.error}）`);
    }
    const c = r.compare;
    if (c) {
      const dead = (c.verificationDrift ?? []).filter((x) => x.visible === 0);
      if (dead.length) {
        lines.push('');
        lines.push('### 失效 verification 选择器');
        for (const d of dead)
          lines.push(`- \`${d.selector}\`（scope: ${d.scope}，matches=${d.matches}）`);
      }
      const neverDeclared = c.bridgeMissing.filter((b) => !b.declaredInStatic);
      const componentScoped = c.bridgeMissing.filter((b) => b.declaredInStatic);
      if (neverDeclared.length || componentScoped.length) {
        lines.push('');
        lines.push('### bridge 变量问题');
        if (neverDeclared.length) {
          lines.push(
            `- **疑似失效 entry（静态 CSS + 运行时 :root 均未声明）**：${neverDeclared.map((b) => `\`${b.var}\`(${b.role})`).join('、')}`,
          );
        }
        if (componentScoped.length) {
          lines.push(
            `- 组件作用域不可达：${componentScoped.map((b) => `\`${b.var}\`(${b.role})`).join('、')}`,
          );
        }
      }
      if (c.themeHint?.length) {
        lines.push('');
        lines.push('### 主题模式提示');
        for (const h of c.themeHint) lines.push(`- ${h}`);
      }
      const patches = buildPatchActions(r.id, c);
      if (patches.length) {
        lines.push('');
        lines.push('### 修订建议（自动生成）');
        for (const p of patches) {
          lines.push(
            `- **[${p.severity}] ${p.type}**：${p.var || p.target || p.scope || 'agent-wide'} — ${p.note}`,
          );
        }
      }
      lines.push('');
      lines.push('### diff 摘要');
      lines.push(
        `- 类名：shared=${c.classes.sharedCount} onlyStatic=${c.classes.onlyStaticCount} onlyRuntime=${c.classes.onlyRuntimeCount}（覆盖率 ${c.classes.coverage}）`,
      );
      lines.push(
        `- 变量：shared=${c.vars.sharedCount} onlyStatic=${c.vars.onlyStaticCount} onlyRuntime=${c.vars.onlyRuntimeCount}（覆盖率 ${c.vars.coverage}）`,
      );
      if (c.topRuntimeDiffs?.length) {
        lines.push('');
        lines.push('### 高频运行时独有类名（Top-N，静态抓不到）');
        for (const d of c.topRuntimeDiffs) lines.push(`- \`${d.name}\` ×${d.count}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** 轻量摘要：剔除冗余原始数据，仅保留对拍结论，供外部脚本 / CI 快速消费。 */
function buildLightReport(reports, baselineDiff) {
  return {
    generatedAt: new Date().toISOString(),
    agents: reports.length,
    baseline: baselineDiff
      ? {
          generatedAt: baselineDiff.generatedAt,
          newDriftCount: baselineDiff.newDriftCount,
          recoveredCount: baselineDiff.recoveredCount,
          persistentCount: baselineDiff.persistentCount,
          agents: baselineDiff.agents.map((a) => ({
            id: a.id,
            displayName: a.displayName,
            baselineStatus: a.baselineStatus,
            currentStatus: a.currentStatus,
            isNewDrift: a.isNewDrift,
            isRecovered: a.isRecovered,
            newDeadLandmarks: a.newDeadLandmarks ?? [],
            newBridgeMissing: a.newBridgeMissing ?? [],
            resolvedDeadLandmarks: a.resolvedDeadLandmarks ?? [],
            resolvedBridgeMissing: a.resolvedBridgeMissing ?? [],
          })),
        }
      : null,
    summary: reports.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      status: agentStatus(r),
      runtime: r.runtime.ok
        ? {
            port: r.runtime.port,
            classes: r.runtime.classInventory.unique,
            vars: r.runtime.rootVars.unique,
            styleAst: r.runtime.styleAst?.error
              ? { error: r.runtime.styleAst.error }
              : {
                  styleSheets: r.runtime.styleAst?.styleSheets ?? null,
                  adoptedSheets: r.runtime.styleAst?.adoptedSheets ?? null,
                  adoptedCssRules: r.runtime.styleAst?.adoptedCssRules ?? null,
                  rootVarDecls: r.runtime.styleAst?.rootVars?.length ?? null,
                  themeSelectors: r.runtime.styleAst?.themeSelectors?.length ?? null,
                },
            shadowDom: r.runtime.shadowDom?.error
              ? { error: r.runtime.shadowDom.error }
              : {
                  openHostCount: r.runtime.shadowDom?.openHostCount ?? null,
                  totalShadowEls: r.runtime.shadowDom?.totalShadowEls ?? null,
                  adoptedInShadow: r.runtime.shadowDom?.adoptedInShadow ?? null,
                  closedShadowRisk: r.runtime.shadowDom?.closedShadowRisk ?? [],
                  seeds: r.runtime.shadowSeeds ?? [],
                },
            targets: r.runtime.targetEnumeration?.error
              ? { error: r.runtime.targetEnumeration.error }
              : {
                  total: r.runtime.targetEnumeration?.total ?? null,
                  byType: r.runtime.targetEnumeration?.byType ?? {},
                  iframes: r.runtime.targetEnumeration?.iframes?.length ?? null,
                  workers: r.runtime.targetEnumeration?.workers?.length ?? null,
                  frames: r.runtime.targetEnumeration?.frames?.error
                    ? { error: r.runtime.targetEnumeration.frames.error }
                    : {
                        targetCount: r.runtime.targetEnumeration?.frames?.targetCount ?? null,
                        frameCount: r.runtime.targetEnumeration?.frames?.frameCount ?? null,
                        oopifCount: r.runtime.targetEnumeration?.frames?.oopifCount ?? null,
                      },
                },
          }
        : { ok: false, error: r.runtime.error },
      static: r.static.ok
        ? {
            layout: r.static.layout ?? 'asar',
            classes: r.static.classTokens.unique,
            vars: r.static.cssVars.unique,
          }
        : { ok: false, error: r.static.error },
      compare: r.compare
        ? {
            drift: r.compare.drift,
            classCoverage: r.compare.classes.coverage,
            varCoverage: r.compare.vars.coverage,
            bridgeMissing: r.compare.bridgeMissing.map((b) => ({
              var: b.var,
              role: b.role,
              neverDeclared: !b.declaredInStatic,
            })),
            deadLandmarks: (r.compare.verificationDrift ?? [])
              .filter((x) => x.visible === 0)
              .map((x) => x.selector),
            themeHint: r.compare.themeHint,
            topRuntimeDiffs: r.compare.topRuntimeDiffs,
            patchActions: buildPatchActions(r.id, r.compare),
            verdicts: r.compare.verdicts,
          }
        : null,
    })),
  };
}

// ===========================================================================
// 5.6 规则库模板生成（--rules）—— Layer1 静态规则库的初始模板
// ===========================================================================

/** 通用兜底规则：完全未知 Agent 加载；不携带任何指纹，全靠运行时探测驱动。 */
const FALLBACK_RULE = {
  agentId: 'fallback.generic',
  schemaVer: '1.3',
  themePersistCandidates: [
    { type: 'dataset', key: 'data-theme' },
    { type: 'localStorage', key: 'theme' },
    { type: 'localStorage', key: 'theme-mode' },
  ],
  globalApiCandidates: [],
  globalStorePathCandidates: [],
  lazyRiskComponents: ['Modal', 'Dropdown', 'Popover'],
  shadowDomRiskSelectors: [],
  themeImplMode: 'mixed',
  canSilentSwitch: false,
  switchSideEffects: [],
  lightFingerprint: { dataset: null, cssVars: {} },
  darkFingerprint: { dataset: null, cssVars: {} },
};

const RULE_THEME_KEY_RE = /theme|dark|light|scheme|appearance|color-mode/i;
const RULE_FINGERPRINT_VAR_RE =
  /bg|background|surface|canvas|panel|card|text|foreground|primary|accent|brand|link|border|divider|fill/i;
// 指纹只收「颜色语义」变量；值里出现尺寸/间距单位或 --spacing 引用的视为布局变量，跳过
const RULE_DIMENSION_VALUE_RE = /\d+(px|rem|em|vh|vw|%)|var\(--spac/i;

/** 从运行时 dataset + storage 推导 theme 持久化候选（仅 key 名，供人工确认）。 */
function deriveThemePersistCandidates(dom) {
  const candidates = [];
  if (!dom || dom.error) return candidates;
  for (const k of Object.keys(dom.dataset ?? {})) {
    if (RULE_THEME_KEY_RE.test(k))
      candidates.push({ type: 'dataset', key: k, sampleValue: dom.dataset[k] });
  }
  const seen = new Set();
  for (const item of dom.themeStorage ?? []) {
    if (seen.has(item.key)) continue;
    seen.add(item.key);
    const type = (dom.localStorageKeys ?? []).includes(item.key)
      ? 'localStorage'
      : (dom.sessionStorageKeys ?? []).includes(item.key)
        ? 'sessionStorage'
        : 'storage';
    candidates.push({ type, key: item.key, sampleValue: item.value });
  }
  return candidates;
}

/** 从 adoptedStyleSheets 检测 + @theme-inline 诊断推导 themeImplMode。 */
function deriveThemeImplMode(report) {
  const sa = report.runtime?.styleAst;
  const hints = report.compare?.themeHint ?? [];
  const adopted = sa && !sa.error && sa.adoptedSheets > 0;
  const inline = hints.some(
    (h) => typeof h === 'string' && (/@theme-inline/.test(h) || /组件作用域/.test(h)),
  );
  if (adopted && inline) return 'mixed';
  if (inline) return 'inline';
  if (adopted) return 'adopted';
  return 'classic';
}

/**
 * 推导单模式指纹。关键约束：单次探测只能拿到「当前模式」的观测值，
 * 因此仅当前模式 == 目标模式时才填充 cssVars，另一模式留空（需切换后二次探测或人工补）。
 */
function deriveFingerprint(dom, styleAst, mode) {
  const current = inferCurrentMode(dom);
  const cssVars = {};
  if (current === mode || current === 'unknown') {
    const allVars = [...(styleAst?.rootVars ?? []), ...(styleAst?.adoptedRootVars ?? [])];
    for (const v of allVars) {
      if (
        RULE_FINGERPRINT_VAR_RE.test(v.name) &&
        !RULE_DIMENSION_VALUE_RE.test(v.value) &&
        cssVars[v.name] === undefined
      ) {
        cssVars[v.name] = v.value;
        if (Object.keys(cssVars).length >= 24) break;
      }
    }
  }
  const dataset = {};
  if (current === mode || current === 'unknown') {
    for (const k of Object.keys(dom?.dataset ?? {})) {
      if (RULE_THEME_KEY_RE.test(k)) dataset[k] = dom.dataset[k];
    }
  }
  const fp = { dataset: Object.keys(dataset).length ? dataset : null, cssVars };
  if (current === 'unknown') fp._note = '当前模式未确定，指纹为当前观测值';
  return fp;
}

/**
 * 生成单个 Agent 的规则初始模板。asar 静态解包 + CDP 运行时探测自动推导「可推导」部分，
 * 人工字段（globalApi / globalStorePath / canSilentSwitch / switchSideEffects）留空待人工补全。
 */
function buildRuleTemplate(adapter, report) {
  const { runtime, static: statik } = report;
  const dom = runtime?.domContext;
  const styleAst = runtime?.styleAst;
  const shadowDom = runtime?.shadowDom;
  return {
    agentId: adapter.id,
    displayName: adapter.displayName,
    schemaVer: '1.3',
    _generated: {
      at: new Date().toISOString(),
      from: statik?.asarPath ?? null,
      note: 'asar 静态解包 + CDP 运行时探测自动生成的初始模板；globalApiCandidates/globalStorePathCandidates/canSilentSwitch/switchSideEffects 需人工补全后生效',
    },
    themePersistCandidates: deriveThemePersistCandidates(dom),
    globalApiCandidates: [],
    globalStorePathCandidates: [],
    lazyRiskComponents: ['Modal', 'Dropdown', 'Popover', 'Select', 'Tooltip', 'Dialog'],
    shadowDomRiskSelectors: (() => {
      // 规则库种子（COMMON ∪ 各 Agent 分桶 ∪ --shadow-seed）作为固定候选，
      // 与运行时观测到的 openShadow host 选择器合并去重，形成「种子→观测→回填」完整清单。
      const observed =
        shadowDom && !shadowDom.error && shadowDom.openHosts?.length
          ? shadowDom.openHosts
              .slice(0, 10)
              .map((h) => `${h.tag}${h.cls?.length ? `.${h.cls.join('.')}` : ''}`)
          : [];
      const seeds = resolveShadowRiskSelectors(adapter.id);
      const merged = [...observed];
      for (const s of seeds) if (!merged.includes(s)) merged.push(s);
      return merged;
    })(),
    themeImplMode: deriveThemeImplMode(report),
    canSilentSwitch: false,
    switchSideEffects: [],
    lightFingerprint: deriveFingerprint(dom, styleAst, 'light'),
    darkFingerprint: deriveFingerprint(dom, styleAst, 'dark'),
  };
}

// ===========================================================================
// 5.5 基线对比（--baseline）与 ignore 噪声建议（--suggest-ignore）
// ===========================================================================

/** 读取基线报告（兼容 full `{reports}` 与 light `{summary}` 两种格式），返回 agentId → 结构化快照。 */
function loadBaseline(path) {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8'));
    const list = Array.isArray(raw.summary)
      ? raw.summary
      : Array.isArray(raw.reports)
        ? raw.reports
        : null;
    if (!list) {
      debugLog(`baseline 文件缺少 reports/summary 数组，忽略: ${path}`);
      return null;
    }
    const map = new Map();
    for (const item of list) {
      if (!item?.id) continue;
      const cmp = item.compare ?? {};
      const deadLandmarks = Array.isArray(cmp.deadLandmarks)
        ? cmp.deadLandmarks
        : (cmp.verificationDrift ?? []).filter((x) => x.visible === 0).map((x) => x.selector);
      const bridgeMissing = (cmp.bridgeMissing ?? []).map((b) =>
        typeof b === 'string' ? b : b.var,
      );
      const drift = !!cmp.drift || deadLandmarks.length > 0 || (cmp.themeHint ?? []).length > 0;
      map.set(item.id, {
        status: item.status ?? (drift ? 'DRIFT' : 'OK'),
        drift,
        themeHintCount: (cmp.themeHint ?? []).length,
        deadLandmarks: new Set(deadLandmarks),
        bridgeMissing: new Set(bridgeMissing),
      });
    }
    return map;
  } catch (e) {
    debugLog(`baseline 解析失败（已忽略）: ${e.message}`);
    return null;
  }
}

/** 统一漂移信号：bridge 缺失 / verification 失效 / @theme-inline 提示任一存在即视为有漂移。 */
function hasDriftSignal(cmp) {
  return !!cmp?.drift || (cmp?.themeHint ?? []).length > 0;
}

/**
 * 基线对拍：对比当前结果与基线快照，把「新增漂移」与「恢复」独立出来。
 * isNewDrift = 基线 OK 但当前出现漂移（真正需要告警的新问题）；
 * isRecovered = 基线有漂移但当前已恢复（正向信号）；
 * 持续漂移 = 基线、当前均有（已知问题，不重复告警，避免告警疲劳）。
 */
function computeBaselineDiff(reports, baseline) {
  const agents = [];
  let newDriftCount = 0;
  let recoveredCount = 0;
  let persistentCount = 0;
  for (const r of reports) {
    const b = baseline.get(r.id);
    const curDead = new Set(
      (r.compare?.verificationDrift ?? []).filter((x) => x.visible === 0).map((x) => x.selector),
    );
    const curBridge = new Set((r.compare?.bridgeMissing ?? []).map((x) => x.var));
    const curHasDrift = hasDriftSignal(r.compare);
    const entry = {
      id: r.id,
      displayName: r.displayName,
      baselineStatus: b ? (b.status ?? 'unknown') : 'absent',
      currentStatus: agentStatus(r),
    };
    if (!b) {
      // 基线中无该 Agent 记录（新增 Agent / 首次建基线）：当前有漂移即视为新增
      entry.isNewDrift = curHasDrift;
      entry.note = '基线中无该 Agent 记录（新增 Agent 或首次建基线）';
      if (curHasDrift) newDriftCount++;
      agents.push(entry);
      continue;
    }
    entry.newDeadLandmarks = [...curDead].filter((s) => !b.deadLandmarks.has(s));
    entry.resolvedDeadLandmarks = [...b.deadLandmarks].filter((s) => !curDead.has(s));
    entry.newBridgeMissing = [...curBridge].filter((s) => !b.bridgeMissing.has(s));
    entry.resolvedBridgeMissing = [...b.bridgeMissing].filter((s) => !curBridge.has(s));
    entry.isNewDrift = !b.drift && curHasDrift;
    entry.isRecovered = b.drift && !curHasDrift;
    if (entry.isNewDrift) newDriftCount++;
    if (entry.isRecovered) recoveredCount++;
    if (b.drift && curHasDrift) persistentCount++;
    agents.push(entry);
  }
  return {
    generatedAt: new Date().toISOString(),
    agents,
    newDriftCount,
    recoveredCount,
    persistentCount,
  };
}

// 噪声启发式（仅用于「建议」，不自动生效；跨 Agent / 高频阈值兜底降低误报）
const IGNORE_UTILITY_RE = new RegExp(
  '^(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|selected|default|required|invalid|' +
    'visited|link|first|last|only|odd|even|group|group-hover|peer|peer-hover|marker|selection|placeholder|backdrop|' +
    'before|after|data-\\[[^\\]]*\\]|aria-\\[[^\\]]*\\]|\\[[^\\]]*\\]):',
);
const IGNORE_CLASS_RE = new RegExp(
  '^(flex|flex-1|flex-auto|flex-none|flex-initial|flex-col|flex-row|flex-wrap|flex-nowrap|block|inline|inline-block|' +
    'inline-flex|table|table-row|table-cell|items-|justify-|content-|place-|self-|order-|basis-|grow|shrink|' +
    'px-|py-|pt-|pr-|pb-|pl-|ps-|pe-|mx-|my-|mt-|mr-|mb-|ml-|ms-|me-|p-|m-|' +
    'w-|h-|min-w-|max-w-|min-h-|max-h-|size-|gap-|gap-x-|gap-y-|space-x-|space-y-|' +
    'rounded|text-|bg-|border|opacity-|overflow-|whitespace-|select-|cursor-|' +
    'relative|absolute|fixed|sticky|static|top-|bottom-|left-|right-|inset-|z-|' +
    'leading-|font-|shadow|ring-|outline-|divide-|grid|grid-cols-|col-span-|row-span-|row-start-|col-start-|' +
    'truncate|sr-only|pointer-events-|object-|aspect-|break-|list-|' +
    'italic|underline|overline|line-through|uppercase|lowercase|capitalize|normal-case|antialiased|' +
    'visible|invisible|collapse|tracking-|decoration-|caret-|accent-|appearance-|will-change-|resize-|' +
    'transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|backdrop-|' +
    'fill-|stroke-|scroll-|snap-|columns-)',
);
const IGNORE_VAR_RE = new RegExp(
  '^--(tw-|color-|background|border|shadow|ring-|opacity|transition|duration|ease-|delay-|animate-|font|text-|' +
    'spacing|gap-|padding|margin|radius|z-index|transform|scale-|translate-|rotate-|blur|saturate|contrast|' +
    'backdrop|outline|inset-)',
);
const IGNORE_HASH_RE = /_[A-Za-z0-9]{6,}/; // CSS Modules 哈希（类名 / 变量通用）

/**
 * ignore 噪声候选提取：扫描各 Agent 的「运行时独有」结构，识别跨 Agent 稳定的
 * 工具类 / CSS Modules 哈希 / 通用变量，输出可直接喂给 `--ignore` 的候选 JSON。
 * 仅产出建议（含理由），不自动套用。
 */
function buildIgnoreSuggestions(reports, ignore = { classTokens: new Set(), cssVars: new Set() }) {
  const analyzed = reports.filter((r) => r.runtime?.ok && r.compare);
  if (!analyzed.length) return null;

  const runtimeTop = analyzed.map((r) => new Map(r.runtime.classInventory?.top ?? []));
  const staticTokens = analyzed.map((r) => new Set(r.static?.classTokens?.tokens ?? []));
  const staticVars = analyzed.map((r) => new Set(r.static?.cssVars?.names ?? []));

  const isNoiseClass = (t) =>
    IGNORE_UTILITY_RE.test(t) || IGNORE_CLASS_RE.test(t) || IGNORE_HASH_RE.test(t);
  const isNoiseVar = (v) => IGNORE_VAR_RE.test(v) || IGNORE_HASH_RE.test(v);

  const classCandidates = new Map(); // token -> { agents:Set, totalFreq }
  const varCandidates = new Map(); // var -> { agents:Set }
  for (let i = 0; i < analyzed.length; i++) {
    const top = runtimeTop[i];
    const statik = staticTokens[i];
    for (const [token, count] of top) {
      if (statik.has(token) || ignore.classTokens.has(token)) continue; // shared 或已在名单，非噪声
      if (!isNoiseClass(token)) continue;
      let rec = classCandidates.get(token);
      if (!rec) {
        rec = { agents: new Set(), totalFreq: 0 };
        classCandidates.set(token, rec);
      }
      rec.agents.add(i);
      rec.totalFreq += count;
    }
    for (const v of analyzed[i].runtime.rootVars?.names ?? []) {
      if (staticVars[i].has(v) || ignore.cssVars.has(v)) continue; // 静态已声明或在名单
      if (!isNoiseVar(v)) continue;
      let rec = varCandidates.get(v);
      if (!rec) {
        rec = { agents: new Set() };
        varCandidates.set(v, rec);
      }
      rec.agents.add(i);
    }
  }

  const classTokens = [];
  const cssVars = [];
  const reasons = {};
  for (const [token, rec] of classCandidates) {
    if (rec.agents.size < 2 && rec.totalFreq < 15) continue; // 不跨 Agent 且低频 → 不足以判定稳定噪声
    classTokens.push(token);
    reasons[token] =
      `跨 Agent=${rec.agents.size} 累计频次=${rec.totalFreq}，疑似 Tailwind 工具类 / CSS Modules 噪声`;
  }
  for (const [v, rec] of varCandidates) {
    if (rec.agents.size < 2) continue; // 变量语义较强，仅跨 Agent 稳定才建议
    cssVars.push(v);
    reasons[v] = `跨 Agent=${rec.agents.size} 声明，疑似通用变量噪声`;
  }
  classTokens.sort();
  cssVars.sort();

  return {
    generatedAt: new Date().toISOString(),
    note: '由 --suggest-ignore 自动生成。classTokens/cssVars 可直接作为 --ignore 的输入（建议人工复核后使用）。',
    classTokens,
    cssVars,
    reasons,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name) => args.includes(name);
  const value = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };

  OPTIONS.debug = flag('--debug');
  OPTIONS.markdown = flag('--markdown');
  OPTIONS.ci = flag('--ci');
  OPTIONS.skipCefSubapp = flag('--skip-cef-subapp');
  OPTIONS.ignorePath = value('--ignore');
  OPTIONS.suggestIgnore = flag('--suggest-ignore');
  OPTIONS.rules = flag('--rules');
  OPTIONS.meta = flag('--meta');
  OPTIONS.writePatches = flag('--write-patches');
  OPTIONS.dryRun = flag('--dry-run');
  OPTIONS.shadowSeed = loadShadowSeed(value('--shadow-seed'));

  const requested = value('--agent');
  const outputDir = resolve(value('--out') ?? 'agents-raw-data');
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  // 黑白名单：--ignore 指向的 JSON，缺失/解析失败时降级为空名单（不阻断流程）
  const ignore = loadIgnoreList(OPTIONS.ignorePath);

  const adapters = listAdapters().filter((a) => (requested ? a.id === requested : true));
  if (!adapters.length) {
    console.error(
      `未知 agent: ${requested}（可选: ${listAdapters()
        .map((a) => a.id)
        .join(', ')}）`,
    );
    process.exit(2);
  }

  if (!OPTIONS.ci) {
    console.log(`=== 结构对拍（CDP × 静态解包）===`);
    console.log(
      `目标: ${adapters.map((a) => a.id).join(', ')}${OPTIONS.skipCefSubapp ? ' [--skip-cef-subapp]' : ''}`,
    );
  }

  const reports = [];
  for (const adapter of adapters) {
    // 全局异常隔离：单个 Agent 探测/解析失败仅记录自身错误，不中断全局遍历
    let report;
    try {
      const live = await resolveLivePort(adapter);
      let runtime = { ok: false, error: '未检测到运行中的 CDP 端点' };
      if (live) {
        try {
          const target = live.targets.find((t) => t.webSocketDebuggerUrl) ?? live.targets[0];
          runtime = await probeRuntime(adapter, { ...target, port: live.port });
        } catch (e) {
          runtime = { ok: false, error: `CDP 探测异常: ${e.message}` };
        }
      }
      const statik = await probeStatic(adapter);
      report = {
        id: adapter.id,
        displayName: adapter.displayName,
        runtime,
        static: statik,
        compare: runtime.ok && statik.ok ? buildCompare(adapter, runtime, statik, ignore) : null,
      };
    } catch (e) {
      report = {
        id: adapter.id,
        displayName: adapter.displayName,
        runtime: { ok: false, error: `运行时异常: ${e.message}` },
        static: { ok: false, error: '未执行（上游异常）' },
        compare: null,
      };
    }
    reports.push(report);
    if (!OPTIONS.ci) printAgentReport(adapter, report);
  }

  // 补丁自动写回（--write-patches）：把「确定性删除」类建议直接落到适配器源码。
  // 仅落地死 landmark 选择器移除 / 失效 bridge entry 移除；
  // switch_to_component_injection 需设计决策，保持人工。--dry-run 只预览不写盘。
  let patchResults = null;
  if (OPTIONS.writePatches) {
    const actions = [];
    for (const r of reports) if (r.compare) actions.push(...buildPatchActions(r.id, r.compare));
    patchResults = applyPatchActions(actions, { dryRun: OPTIONS.dryRun });
    const appliedTotal = patchResults.reduce((n, p) => n + p.appliedCount, 0);
    const missedTotal = patchResults.reduce((n, p) => n + p.missedCount, 0);
    if (!OPTIONS.ci) {
      console.log(
        `\n补丁写回: ${OPTIONS.dryRun ? 'dry-run（仅预览，不写文件）' : '已写入适配器源码'} ｜ 确定删除 ${appliedTotal} 条 / 未命中 ${missedTotal} 条`,
      );
      for (const p of patchResults) {
        const verb = p.error
          ? `错误 ${p.error}`
          : p.wrote
            ? '已写入'
            : p.dryRun
              ? '将写入'
              : '无改动';
        console.log(
          `          ${verb} ${p.file}（应用 ${p.appliedCount} / 未命中 ${p.missedCount}）`,
        );
        if (p.dryRun) {
          for (const a of p.applied)
            console.log(
              `            - 将移除 ${a.type}「${a.target}」@${a.location} -> ${a.element}`,
            );
        }
        for (const m of p.missed)
          console.log(
            `            ! 未命中 ${m.type}「${m.target ?? ''}」@${m.location ?? '?'}：${m.reason}`,
          );
      }
    }
    const pp = join(outputDir, '_structure-patches-applied.json');
    writeFileSync(
      pp,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), dryRun: OPTIONS.dryRun, results: patchResults },
        null,
        2,
      ),
    );
    if (!OPTIONS.ci) console.log(`补丁明细: ${pp}`);
  }

  // 基线对比（--baseline）：以历史报告为基准，仅把「新增漂移」当作告警项（CI 增量语义）。
  // 必须在覆写 _structure-compare.json 之前读取默认基线，否则基线 == 本次结果，diff 恒为 0。
  let baselineDiff = null;
  // --baseline 为裸 flag 时 value() 会误取下一个以 -- 开头的参数，需显式判别；
  // 无值或值为 flag 时回退到默认基线（上一次 _structure-compare.json）。
  const rawBaseline = value('--baseline');
  const baselinePath =
    rawBaseline && !rawBaseline.startsWith('--')
      ? rawBaseline
      : join(outputDir, '_structure-compare.json');
  if (existsSync(baselinePath)) {
    const baseline = loadBaseline(baselinePath);
    if (baseline) {
      baselineDiff = computeBaselineDiff(reports, baseline);
      const bdPath = join(outputDir, '_structure-baseline-diff.json');
      writeFileSync(bdPath, JSON.stringify(baselineDiff, null, 2));
      if (!OPTIONS.ci) {
        console.log(`\n基线对比: ${bdPath}`);
        console.log(
          `          新增漂移 ${baselineDiff.newDriftCount} / 恢复 ${baselineDiff.recoveredCount} / 持续 ${baselineDiff.persistentCount}`,
        );
        for (const a of baselineDiff.agents) {
          if (a.isNewDrift) {
            const extra = [
              a.newDeadLandmarks?.length ? `失效选择器: ${a.newDeadLandmarks.join(', ')}` : null,
              a.newBridgeMissing?.length ? `bridge 缺失: ${a.newBridgeMissing.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' ');
            console.log(
              `          [新增] ${a.displayName}（${a.id}）${a.note ?? ''}${extra ? ` ${extra}` : ''}`,
            );
          }
          if (a.isRecovered) console.log(`          [恢复] ${a.displayName}（${a.id}）`);
        }
      }
    }
  }

  // 产物 1：全量原始 JSON（保留，用于问题溯源）
  const fullPath = join(outputDir, '_structure-compare.json');
  writeFileSync(
    fullPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2),
  );
  // 产物 2：轻量结构化摘要（外部工具 / CI 消费）
  const lightPath = join(outputDir, '_structure-compare-light.json');
  writeFileSync(lightPath, JSON.stringify(buildLightReport(reports, baselineDiff), null, 2));
  // 产物 3：Markdown 修订清单（人工可读，直接指导适配器源码修订）
  let mdPath = null;
  if (OPTIONS.markdown) {
    mdPath = join(outputDir, '_structure-compare-report.md');
    writeFileSync(mdPath, renderMarkdown(reports, baselineDiff), 'utf-8');
  }

  // 产物 4：ignore 噪声候选（--suggest-ignore）——人工复核后可直接作为 --ignore 输入
  if (OPTIONS.suggestIgnore) {
    const suggest = buildIgnoreSuggestions(reports, ignore);
    if (suggest) {
      const sp = join(outputDir, '_ignore.suggest.json');
      writeFileSync(sp, JSON.stringify(suggest, null, 2));
      if (!OPTIONS.ci)
        console.log(
          `\nignore 建议: ${sp}（类名 ${suggest.classTokens.length} / 变量 ${suggest.cssVars.length}）`,
        );
    }
  }

  // 产物 5：规则库初始模板（--rules）—— Layer1 静态规则库，asar 推导 + 人工补全
  if (OPTIONS.rules) {
    const rulesDir = resolve('agent-rules');
    if (!existsSync(rulesDir)) mkdirSync(rulesDir, { recursive: true });
    for (const adapter of adapters) {
      const report = reports.find((r) => r.id === adapter.id);
      if (!report) continue;
      const rule = buildRuleTemplate(adapter, report);
      const rp = join(rulesDir, `${adapter.id}.theme.rule.json`);
      writeFileSync(rp, JSON.stringify(rule, null, 2));
      if (!OPTIONS.ci)
        console.log(
          `\n规则模板: ${rp}（themeImplMode=${rule.themeImplMode}，persist候选 ${rule.themePersistCandidates.length}）`,
        );
    }
    const fp = join(rulesDir, 'fallback.generic.theme.rule.json');
    writeFileSync(fp, JSON.stringify(FALLBACK_RULE, null, 2));
    if (!OPTIONS.ci) console.log(`规则模板: ${fp}（通用兜底）`);
  }

  // 产物 6：元模型推理 + 自校验（--meta）—— Layer3 加权融合 + Layer4 元模型自校验
  if (OPTIONS.meta) {
    const rulesDir = resolve('agent-rules');
    const metaOutDir = join(outputDir, 'meta');
    if (!existsSync(metaOutDir)) mkdirSync(metaOutDir, { recursive: true });
    for (const adapter of adapters) {
      const report = reports.find((r) => r.id === adapter.id);
      if (!report) continue;
      if (!report.runtime.ok) {
        if (!OPTIONS.ci)
          console.log(`\n元模型: ${adapter.id} 运行时探测失败，跳过（${report.runtime.error}）`);
        continue;
      }
      // 规则不存在 → rule=null（无先验），inferMeta 自然落入 low + 运行时为准语义
      let rule = null;
      const rulePath = join(rulesDir, `${adapter.id}.theme.rule.json`);
      if (existsSync(rulePath)) {
        try {
          rule = JSON.parse(readFileSync(rulePath, 'utf-8'));
        } catch {
          rule = null;
        }
      }
      const meta = inferMeta(rule, report.runtime);
      const validation = validateMeta(meta, report.runtime);
      const mp = join(metaOutDir, `${adapter.id}.theme.meta.json`);
      const vp = join(metaOutDir, `${adapter.id}.meta-validation.json`);
      writeFileSync(mp, JSON.stringify(meta, null, 2));
      writeFileSync(vp, JSON.stringify(validation, null, 2));
      if (!OPTIONS.ci) {
        console.log(
          `\n元模型: ${mp}（confidence=${meta.confidence} mode=${meta.currentNativeMode} match=${meta.fingerprintMatchScore}）`,
        );
        console.log(`自校验: ${vp}（${validation.status}: ${validation.summary}）`);
      }
    }
  }

  printSummaryTable(reports, baselineDiff);
  if (!OPTIONS.ci) {
    console.log(`\n完整报告: ${fullPath}`);
    console.log(`轻量摘要: ${lightPath}`);
    if (mdPath) console.log(`修订清单: ${mdPath}`);
  }

  // 语义化退出码：0 无漂移 / 1 业务漂移 / 2 探测失败（对接 CI/CD 流水线）
  const hasFailure = reports.some((r) => !r.runtime.ok || !r.static.ok);
  let hasDrift = reports.some((r) => r.compare?.drift || (r.compare?.themeHint?.length ?? 0) > 0);
  // --baseline 增量语义：仅「新增漂移」触发失败；已知漂移 / 恢复不阻断（避免告警疲劳）
  if (baselineDiff) hasDrift = baselineDiff.newDriftCount > 0;
  process.exitCode = hasFailure ? 2 : hasDrift ? 1 : 0;
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(2);
});
