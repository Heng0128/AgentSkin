// SPDX-License-Identifier: MPL-2.0
// CDP Probe — Doubao (豆包) comprehensive data extraction
// Usage: node scripts/cdp-probe-doubao.mjs

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'test-output');
const REPORT_PATH = join(ROOT, 'docs', 'reverse-engineering', 'batch1-cdp', 'doubao-cdp.md');

const DOUBAO_EXE = 'C:\\Users\\snowb\\AppData\\Local\\Doubao\\Application\\Doubao.exe';
const CDP_PORTS = [9222, 61607, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230];

function log(...args) {
  console.log('[doubao-probe]', ...args);
}

// ═══════════════════════════════════════════════════════
// CDP Client
// ═══════════════════════════════════════════════════════

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
      setTimeout(() => rej(new Error('WS timeout')), 10000);
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    try {
      const m = JSON.parse(raw);
      if (m.id != null && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
      }
    } catch {}
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error(`timeout:${method}`));
        }
      }, 25000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

// ═══════════════════════════════════════════════════════
// Port scanning & connection
// ═══════════════════════════════════════════════════════

async function tryConnect(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json`, {
      signal: AbortSignal.timeout(3000),
    });
    const targets = await resp.json();
    return { port, ok: true, targets };
  } catch (e) {
    return { port, ok: false, error: e.message };
  }
}

async function tryVersion(port) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(3000),
    });
    const ver = await resp.json();
    return { port, ok: true, version: ver };
  } catch (e) {
    return { port, ok: false, error: e.message };
  }
}

function isDoubaoProcessRunning() {
  try {
    const out = execSync('tasklist /FI "IMAGENAME eq Doubao.exe" /NH /FO CSV', {
      encoding: 'utf8',
      timeout: 5000,
    });
    return out.toLowerCase().includes('doubao.exe');
  } catch {
    return false;
  }
}

function startDoubaoWithCDP() {
  try {
    execSync(
      `powershell -Command "Start-Process '${DOUBAO_EXE}' -ArgumentList '--remote-debugging-port=9222'"`,
      {
        timeout: 10000,
      },
    );
    return true;
  } catch (e) {
    log(`Failed to start Doubao: ${e.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════
// Page probing
// ═══════════════════════════════════════════════════════

async function probePage(page) {
  const result = {
    targetInfo: { title: page.title, url: page.url, id: page.id, type: page.type },
    htmlPreview: null,
    bodyClass: null,
    cssText: null,
    cssVariables: null,
    dataTestIds: null,
    ids: null,
    styleSheets: null,
    csp: null,
    dom: null,
    matchTarget: null,
    neotix: null,
    errors: [],
  };

  let client;
  try {
    client = await CDP.connect(page.webSocketDebuggerUrl);
  } catch (e) {
    result.errors.push(`WS connect failed: ${e.message}`);
    return result;
  }

  try {
    await client.send('Runtime.enable');
    await client.send('Page.enable');
    await client.send('DOM.enable');
  } catch (e) {
    result.errors.push(`Enable domains failed: ${e.message}`);
  }

  // 1. HTML preview (first 2000 chars)
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'document.documentElement.outerHTML.slice(0, 2000)',
      returnByValue: true,
    });
    result.htmlPreview = r.result?.value || null;
  } catch (e) {
    result.errors.push(`HTML preview: ${e.message}`);
  }

  // 2. Body class
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'document.body.className',
      returnByValue: true,
    });
    result.bodyClass = r.result?.value || null;
  } catch (e) {
    result.errors.push(`Body class: ${e.message}`);
  }

  // 3. CSS text (computed style on documentElement)
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: 'getComputedStyle(document.documentElement).cssText.slice(0, 3000)',
      returnByValue: true,
    });
    result.cssText = r.result?.value || null;
  } catch (e) {
    result.errors.push(`CSS text: ${e.message}`);
  }

  // 4. CSS variables on :root (comprehensive)
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const cs = getComputedStyle(document.documentElement);
        const all = [];
        const agentskin = [];
        const semi = [];
        const sPrefix = [];
        const other = [];
        for (let i = 0; i < cs.length; i++) {
          const name = cs[i];
          if (!name.startsWith('--')) continue;
          const val = cs.getPropertyValue(name).trim();
          const entry = { name, value: val.length > 200 ? val.slice(0, 200) + '...' : val };
          all.push(entry);
          if (name.startsWith('--agentskin-')) agentskin.push(entry);
          else if (name.startsWith('--semi-')) semi.push(entry);
          else if (name.startsWith('--s-')) sPrefix.push(entry);
          else other.push(entry);
        }
        return JSON.stringify({
          total: all.length,
          agentskin,
          semi: semi.slice(0, 80),
          sPrefix: sPrefix.slice(0, 80),
          other: other.slice(0, 50),
          semiCount: semi.length,
          sPrefixCount: sPrefix.length,
          otherCount: other.length,
        });
      })()`,
      returnByValue: true,
    });
    result.cssVariables = JSON.parse(r.result?.value || '{}');
  } catch (e) {
    result.errors.push(`cssVariables: ${e.message}`);
  }

  // 5. data-testid list
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `Array.from(new Set(Array.from(document.querySelectorAll('[data-testid]')).map(el => el.getAttribute('data-testid'))))`,
      returnByValue: true,
    });
    result.dataTestIds = r.result?.value || [];
  } catch (e) {
    result.errors.push(`data-testid: ${e.message}`);
  }

  // 6. id list
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('[id]')).map(el => el.id).filter(Boolean).slice(0, 150)`,
      returnByValue: true,
    });
    result.ids = r.result?.value || [];
  } catch (e) {
    result.errors.push(`ids: ${e.message}`);
  }

  // 7. StyleSheets
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `JSON.stringify(Array.from(document.styleSheets).map(s => ({
        href: s.href || null,
        ownerNode: s.ownerNode ? (s.ownerNode.tagName + (s.ownerNode.id ? '#'+s.ownerNode.id : '') + (s.ownerNode.className ? '.'+s.ownerNode.className.split(' ').join('.') : '')) : null,
        ruleCount: s.cssRules ? s.cssRules.length : -1,
        disabled: s.disabled,
        media: s.media ? s.media.mediaText : null
      })).slice(0, 80))`,
      returnByValue: true,
    });
    result.styleSheets = JSON.parse(r.result?.value || '[]');
  } catch (e) {
    result.errors.push(`styleSheets: ${e.message}`);
  }

  // 8. CSP meta
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') || 'NO_CSP_META'`,
      returnByValue: true,
    });
    result.csp = r.result?.value || null;
  } catch (e) {
    result.errors.push(`CSP: ${e.message}`);
  }

  // 9. DOM structure snapshot
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const result = [];
        function walk(el, depth) {
          if (depth > 5 || result.length > 60) return;
          const cls = typeof el.className === 'string' ? el.className : '';
          const id = el.id || null;
          const tag = el.tagName?.toLowerCase();
          const role = el.getAttribute('role') || null;
          const testid = el.getAttribute('data-testid') || null;
          result.push({ tag, id, cls: cls.slice(0, 120), role, testid, depth });
          for (const child of el.children) walk(child, depth + 1);
        }
        walk(document.documentElement, 0);
        return JSON.stringify(result);
      })()`,
      returnByValue: true,
    });
    result.dom = JSON.parse(r.result?.value || '[]');
  } catch (e) {
    result.errors.push(`DOM walk: ${e.message}`);
  }

  // 10. matchTarget pattern verification
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        const url = window.location.href;
        const bodyCls = document.body.className || '';
        const title = document.title || '';
        const patterns = ['doubao-chat/chat', 'doubao', '豆包'];
        return JSON.stringify({
          url,
          bodyCls,
          title,
          matches: patterns.filter(p => {
            const lower = p.toLowerCase();
            return url.toLowerCase().includes(lower) || bodyCls.toLowerCase().includes(lower) || title.toLowerCase().includes(lower);
          })
        });
      })()`,
      returnByValue: true,
    });
    result.matchTarget = JSON.parse(r.result?.value || '{}');
  } catch (e) {
    result.errors.push(`matchTarget: ${e.message}`);
  }

  // 11. neotix API detection
  try {
    const r = await client.send('Runtime.evaluate', {
      expression: `(() => {
        if (window.neotix) {
          return JSON.stringify({
            exists: true,
            keys: Object.keys(window.neotix).slice(0, 30),
          });
        }
        return JSON.stringify({ exists: false });
      })()`,
      returnByValue: true,
    });
    result.neotix = JSON.parse(r.result?.value || '{}');
  } catch (e) {
    result.errors.push(`neotix: ${e.message}`);
  }

  client.close();
  return result;
}

// ═══════════════════════════════════════════════════════
// Report generation
// ═══════════════════════════════════════════════════════

function generateReport(report) {
  const lines = [];
  const push = (s = '') => lines.push(s);

  push('# CDP 动态探测报告 — 豆包 Doubao (doubao Agent)');
  push();
  push(`> 生成日期: ${report.timestamp}`);
  push(`> 目标应用: 豆包 Doubao Desktop`);
  push(`> Agent ID: doubao`);
  push(`> 安装路径: \`C:\\Users\\snowb\\AppData\\Local\\Doubao\``);
  push(`> 架构类型: Chromium 封装（非 Electron，无 ASAR）`);
  push(`> 探测方式: WebSocket CDP 实时连接 + Runtime.evaluate 动态执行`);
  push();
  push('---');
  push();

  // Section 1: Connection
  push('## 1. CDP 连接状态');
  push();
  if (report.connection.status === 'connected') {
    push('| 项目 | 值 |');
    push('|------|-----|');
    push(`| 连接状态 | ✅ 成功 |`);
    push(`| 端口 | ${report.connection.port} |`);
    push(`| WebSocket URL | \`${report.connection.wsUrl || 'N/A'}\` |`);
    if (report.version) {
      push(`| Browser | \`${report.version.Browser || 'N/A'}\` |`);
      push(`| User-Agent | \`${report.version['User-Agent']?.slice(0, 120) || 'N/A'}\` |`);
    }
  } else {
    push('| 项目 | 值 |');
    push('|------|-----|');
    push(`| 连接状态 | ❌ 失败 |`);
    push(`| 错误 | ${report.connection.error} |`);
    push(`| 已扫描端口 | ${report.connection.scannedPorts?.join(', ') || 'N/A'} |`);
    push(`| 进程运行状态 | ${report.connection.processRunning ? '是' : '否'} |`);
  }
  push();
  push('---');
  push();

  // Section 2: Targets
  push('## 2. Target 列表');
  push();
  if (report.allTargets && report.allTargets.length > 0) {
    push('| # | Type | Title | URL (截断) | ID |');
    push('|---|------|-------|-----------|-----|');
    report.allTargets.forEach((t, i) => {
      push(
        `| ${i + 1} | ${t.type} | ${t.title?.slice(0, 40) || '(empty)'} | \`${t.url?.slice(0, 100) || 'N/A'}\` | ${t.id?.slice(0, 20)}... |`,
      );
    });
  } else {
    push('**无可用 Target**');
  }
  push();
  push('---');
  push();

  // Section 3: DOM Snapshot
  push('## 3. DOM 快照摘要');
  push();
  if (report.pageProbe) {
    push('### 3.1 HTML 结构（前 2000 字符摘要）');
    push();
    push('```html');
    push(report.pageProbe.htmlPreview || '(empty)');
    push('```');
    push();
    push('### 3.2 Body 类名');
    push();
    push('```');
    push(report.pageProbe.bodyClass || '(empty)');
    push('```');
    push();
    push('### 3.3 DOM 层级树');
    push();
    if (report.pageProbe.dom && report.pageProbe.dom.length > 0) {
      push('```');
      report.pageProbe.dom.forEach((node) => {
        const indent = '  '.repeat(node.depth);
        const idStr = node.id ? `#${node.id}` : '';
        const clsStr = node.cls ? `.${node.cls.split(' ').join('.')}` : '';
        const roleStr = node.role ? `[role=${node.role}]` : '';
        const testidStr = node.testid ? `[data-testid=${node.testid}]` : '';
        push(`${indent}${node.tag}${idStr}${clsStr}${roleStr}${testidStr}`);
      });
      push('```');
    }
  } else {
    push('**未执行页面探测**');
  }
  push();
  push('---');
  push();

  // Section 4: CSS Variables
  push('## 4. CSS 变量清单');
  push();
  if (report.pageProbe?.cssVariables) {
    const cv = report.pageProbe.cssVariables;
    push('### 4.1 运行时统计');
    push();
    push('| 命名空间 | 数量 | 说明 |');
    push('|----------|------|------|');
    push(`| \`--agentskin-*\` | ${cv.agentskin?.length || 0} | AgentSkin 注入变量 |`);
    push(`| \`--semi-*\` | ${cv.semiCount || 0} | Semi Design 组件库变量 |`);
    push(`| \`--s-*\` | ${cv.sPrefixCount || 0} | 豆包自定义 s- 前缀变量 |`);
    push(`| 其他 | ${cv.otherCount || 0} | 其他 CSS 变量 |`);
    push(`| **总计** | **${cv.total || 0}** | 全量 CSS 自定义属性 |`);
    push();

    if (cv.semi && cv.semi.length > 0) {
      push('### 4.2 Semi Design 变量（关键子集）');
      push();
      push('| 变量 | 值 |');
      push('|------|-----|');
      cv.semi.slice(0, 40).forEach((v) => {
        push(`| \`${v.name}\` | \`${v.value.slice(0, 80)}\` |`);
      });
      push();
    }

    if (cv.sPrefix && cv.sPrefix.length > 0) {
      push('### 4.3 豆包 s- 前缀变量（关键子集）');
      push();
      push('| 变量 | 值 |');
      push('|------|-----|');
      cv.sPrefix.slice(0, 40).forEach((v) => {
        push(`| \`${v.name}\` | \`${v.value.slice(0, 80)}\` |`);
      });
      push();
    }

    if (cv.other && cv.other.length > 0) {
      push('### 4.4 其他变量（关键子集）');
      push();
      push('| 变量 | 值 |');
      push('|------|-----|');
      cv.other.slice(0, 30).forEach((v) => {
        push(`| \`${v.name}\` | \`${v.value.slice(0, 80)}\` |`);
      });
      push();
    }
  } else {
    push('**未获取 CSS 变量**');
  }
  push();
  push('---');
  push();

  // Section 5: Anchors
  push('## 5. 锚点清单');
  push();
  if (report.pageProbe) {
    push('### 5.1 data-testid');
    push();
    if (report.pageProbe.dataTestIds && report.pageProbe.dataTestIds.length > 0) {
      push('| data-testid | 元素标签 |');
      push('|------------|---------|');
      report.pageProbe.dataTestIds.forEach((t) => {
        push(`| \`${t}\` | — |`);
      });
    } else {
      push('**未发现任何 `[data-testid]` 属性**');
    }
    push();

    push('### 5.2 ID 列表');
    push();
    if (report.pageProbe.ids && report.pageProbe.ids.length > 0) {
      push('| ID |');
      push('|-----|');
      report.pageProbe.ids.forEach((id) => {
        push(`| \`${id}\` |`);
      });
    } else {
      push('**未发现任何 `[id]` 属性**');
    }
  }
  push();
  push('---');
  push();

  // Section 6: StyleSheets
  push('## 6. 样式表清单');
  push();
  if (report.pageProbe?.styleSheets) {
    const sheets = report.pageProbe.styleSheets;
    push('### 6.1 统计');
    push();
    const accessible = sheets.filter((s) => s.ruleCount >= 0).length;
    const blocked = sheets.filter((s) => s.ruleCount < 0).length;
    push('| 类型 | 数量 |');
    push('|------|------|');
    push(`| 可访问样式表 | ${accessible} |`);
    push(`| CORS 阻塞 | ${blocked} |`);
    push(`| **总计** | **${sheets.length}** |`);
    push();

    push('### 6.2 样式表来源');
    push();
    push('| # | 来源 | 规则数 | 媒体 | 禁用 |');
    push('|---|------|--------|------|------|');
    sheets.slice(0, 40).forEach((s, i) => {
      const src = s.href ? `\`${s.href.slice(0, 80)}\`` : `(inline: ${s.ownerNode || 'unknown'})`;
      push(
        `| ${i + 1} | ${src} | ${s.ruleCount} | ${s.media || 'all'} | ${s.disabled ? '是' : '否'} |`,
      );
    });
  }
  push();
  push('---');
  push();

  // Section 7: CSP
  push('## 7. CSP 策略');
  push();
  if (report.pageProbe?.csp) {
    push('```');
    push(report.pageProbe.csp);
    push('```');
  } else {
    push('**未发现 CSP meta 标签**');
  }
  push();
  push('---');
  push();

  // Section 8: Chromium version
  push('## 8. Chromium 版本信息');
  push();
  if (report.version) {
    push('| 项目 | 值 |');
    push('|------|-----|');
    Object.entries(report.version).forEach(([k, v]) => {
      push(`| ${k} | \`${String(v).slice(0, 120)}\` |`);
    });
  } else {
    push('**未获取版本信息**');
  }
  push();
  push('---');
  push();

  // Section 9: matchTarget
  push('## 9. 现有引擎匹配度评估');
  push();
  if (report.pageProbe?.matchTarget) {
    const mt = report.pageProbe.matchTarget;
    push('### 9.1 matchTarget 模式验证');
    push();
    push("适配器声明: `['doubao-chat/chat', 'doubao', '豆包']`");
    push();
    push('| 模式 | 匹配 |');
    push('|------|------|');
    const patterns = ['doubao-chat/chat', 'doubao', '豆包'];
    patterns.forEach((p) => {
      const matched = mt.matches?.includes(p) || false;
      push(`| \`${p}\` | ${matched ? '✅' : '❌'} |`);
    });
    push();
    push('### 9.2 运行时上下文');
    push();
    push('```json');
    push(JSON.stringify(mt, null, 2));
    push('```');
  }
  push();

  // neotix
  if (report.pageProbe?.neotix) {
    push('### 9.3 neotix API 检测');
    push();
    push('```json');
    push(JSON.stringify(report.pageProbe.neotix, null, 2));
    push('```');
  }
  push();
  push('---');
  push();

  // Section 10: Errors
  if (report.pageProbe?.errors?.length > 0) {
    push('## 10. 探测错误');
    push();
    report.pageProbe.errors.forEach((e) => {
      push(`- ${e}`);
    });
    push();
    push('---');
    push();
  }

  // Section 11: Static comparison
  push('## 11. 与静态分析的差异对比');
  push();
  push('| 维度 | 静态分析 | CDP 运行时 | 差异 |');
  push('|------|---------|-----------|------|');
  push('| 架构 | Chromium 封装 | 待验证 | — |');
  push('| CSS 变量系统 | Semi Design + s- 前缀 | 待验证 | — |');
  push('| 主窗口 URL | 假设 chrome://doubao-chat/chat | 待验证 | — |');
  push('| CSP nonce | argus-csp-token | 待验证 | — |');
  push('| neotix API | 静态确认存在 | 待验证 | — |');
  push();
  push('---');
  push();

  // Section 12: Conclusion
  push('## 12. 结论');
  push();
  push('### 12.1 注入可行性判定');
  push();
  push('| 维度 | 评估 | 信心度 |');
  push('|------|------|--------|');
  push('| CDP 连接 | 待验证 | — |');
  push('| CSP 兼容性 | 待验证 | — |');
  push('| DOM 锚点 | 待验证 | — |');
  push('| CSS 变量体系 | 待验证 | — |');
  push('| 样式表注入 | 待验证 | — |');
  push();
  push('### 12.2 建议');
  push();
  push('1. 根据运行时结果更新此节');
  push('2. 验证 Semi Design 变量与 14-token 系统的映射');
  push('3. 确认注入点稳定性');
  push();

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════

log('Doubao (豆包) CDP Dynamic Probe');
log('='.repeat(60));

const report = {
  timestamp: new Date().toISOString(),
  agent: 'doubao',
  agentName: '豆包 Doubao',
  connection: null,
  version: null,
  allTargets: null,
  pageProbe: null,
};

// Step 1: Check if Doubao is running
const processRunning = isDoubaoProcessRunning();
log(`Process running: ${processRunning}`);

// Step 2: Try connecting to known ports
let connected = null;
for (const port of CDP_PORTS) {
  log(`Trying port ${port}...`);
  const r = await tryConnect(port);
  if (r.ok) {
    // Verify it's actually Doubao
    const isDoubao = r.targets.some(
      (t) =>
        (t.url || '').toLowerCase().includes('doubao') ||
        (t.title || '').includes('豆包') ||
        (t.url || '').includes('chrome://doubao') ||
        port === 61607, // known Doubao port from screenshot script
    );
    if (isDoubao || port === 61607) {
      log(`  → Connected! Found ${r.targets.length} targets (Doubao confirmed)`);
      connected = r;
      break;
    } else {
      log(`  → Port open but not Doubao (${r.targets.length} targets)`);
    }
  } else {
    log(`  → ${r.error}`);
  }
}

// Step 3: If not connected, try starting Doubao with CDP
if (!connected && !processRunning) {
  log('\nDoubao not running. Attempting to start with --remote-debugging-port=9222...');
  const started = startDoubaoWithCDP();
  if (started) {
    log('Waiting for Doubao to start (8s)...');
    await new Promise((r) => setTimeout(r, 8000));
    // Retry connection
    const r = await tryConnect(9222);
    if (r.ok) {
      connected = r;
      log(`  → Connected after startup! Found ${r.targets.length} targets`);
    }
  }
} else if (!connected && processRunning) {
  log('\nDoubao is running but no CDP port found. Attempting to restart with debugging...');
  // Kill and restart with CDP
  try {
    execSync('taskkill /F /IM Doubao.exe', { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 2000));
    startDoubaoWithCDP();
    log('Waiting for Doubao to restart (10s)...');
    await new Promise((r) => setTimeout(r, 10000));
    const r = await tryConnect(9222);
    if (r.ok) {
      connected = r;
      log(`  → Connected after restart! Found ${r.targets.length} targets`);
    }
  } catch (e) {
    log(`Restart failed: ${e.message}`);
  }
}

// Step 4: Build report
if (!connected) {
  report.connection = {
    status: 'offline',
    error: 'No CDP endpoint found on any scanned port',
    scannedPorts: CDP_PORTS,
    processRunning,
  };
  log('\n✗ Doubao is not reachable via CDP.');
} else {
  report.connection = { status: 'connected', port: connected.port };
  report.allTargets = connected.targets.map((t) => ({
    type: t.type,
    title: t.title,
    url: t.url?.slice(0, 200),
    id: t.id,
  }));

  // Get version
  const ver = await tryVersion(connected.port);
  if (ver.ok) report.version = ver.version;

  // Find main chat page
  const chatPage = connected.targets.find(
    (t) =>
      t.type === 'page' &&
      (t.url.includes('doubao-chat') ||
        t.url.includes('doubao') ||
        t.title?.includes('豆包') ||
        t.url.includes('chat')),
  );

  const anyPage =
    chatPage || connected.targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);

  if (anyPage) {
    log(`\nProbing page: ${anyPage.title} (${anyPage.url?.slice(0, 100)})`);
    report.pageProbe = await probePage(anyPage);
    log(`  DOM elements: ${report.pageProbe.dom?.length || 0}`);
    log(`  data-testids: ${report.pageProbe.dataTestIds?.length || 0}`);
    log(`  ids: ${report.pageProbe.ids?.length || 0}`);
    log(`  styleSheets: ${report.pageProbe.styleSheets?.length || 0}`);
    log(`  CSS variables total: ${report.pageProbe.cssVariables?.total || 0}`);
    log(`  matchTarget: ${JSON.stringify(report.pageProbe.matchTarget?.matches || [])}`);
    log(`  neotix: ${report.pageProbe.neotix?.exists ? 'detected' : 'not found'}`);
  } else {
    log('No suitable page target found');
  }
}

// Step 5: Write report
if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });
const reportDir = join(ROOT, 'docs', 'reverse-engineering', 'batch1-cdp');
if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

const reportMd = generateReport(report);
writeFileSync(REPORT_PATH, reportMd);
log(`\n✓ Report written to: ${REPORT_PATH}`);

// Also write raw JSON
const jsonPath = join(OUTPUT_DIR, 'doubao-cdp-raw.json');
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
log(`✓ Raw data written to: ${jsonPath}`);
