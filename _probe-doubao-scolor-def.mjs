/**
 * Probe: Doubao --s-color-* DEFINITION chain via CDP CSS domain
 * 目标：找出所有声明 --s-color-* 的选择器作用域，判断覆盖链路是否存在漏洞：
 * 1. Doubao 在 root/theme 上声明 --s-color-*
 * 2. 我们在 body 上覆盖 --s-color-*（依赖继承）
 * 3. Doubao 是否在中间容器上重新声明 --s-color-*（会遮蔽 body 继承）
 * 同时做真实元素校验：找一个消费 --s-color-* 的元素，验证 computed 值是否=主题色
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 61055;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/json/list', method: 'GET' },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
      });
    req.on('error', reject);
    req.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl; this.ws = null; this.msgId = 0;
    this.pending = new Map(); this.listeners = new Map(); this.commandTimeout = 15000;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WS error'));
      this.ws.onmessage = (m) => {
        let msg; try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id); this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
        } else if (msg.method) {
          const ls = this.listeners.get(msg.method); if (ls) ls.forEach((cb) => cb(msg.params));
        }
      };
      setTimeout(() => reject(new Error('WS timeout')), 12000);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId; this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, this.commandTimeout);
    });
  }
  on(method, cb) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(cb); }
  close() { if (this.ws) this.ws.close(); }
}

async function getAllSheets(client) {
  await client.send('DOM.enable');
  const headers = [];
  client.on('CSS.styleSheetAdded', (p) => headers.push(p.header));
  await client.send('CSS.enable');
  await new Promise((r) => setTimeout(r, 1500));

  const sheets = [];
  for (const h of headers) {
    try {
      const { text } = await client.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId });
      sheets.push({ href: h.sourceURL || `inline-${h.styleSheetId}`, text: text || '' });
    } catch { /* skip */ }
  }
  return sheets;
}

function classifyScope(selector, sheetName) {
  const s = selector.toLowerCase();
  // 我们的注入规则
  if (s.includes('agentskin-host-doubao')) return 'agentskin';
  // 顶级作用域
  if (s === ':root' || s.startsWith(':root,') || s.includes(':root[')) return 'root';
  if (/^body\b/.test(selector.trim()) || s.includes('> body') || s === 'body' || s === 'html, body' || s === 'html body') return 'body';
  if (/^html\b/.test(selector.trim())) return 'html';
  // 带 . 的组件作用域（可能遮蔽继承）
  if (s.includes('.') || s.includes('[') || s.includes(':')) return 'component';
  return 'other';
}

function analyzeDefinitions(sheets) {
  const defs = { root: [], body: [], html: [], component: [], agentskin: [], other: [] };
  const totalTokens = {};

  for (const sheet of sheets) {
    if (!sheet.text) continue;
    // 规则块：selector { declarations }
    const ruleRegex = /([^{}]+)\{([^{}]+)\}/g;
    let m;
    while ((m = ruleRegex.exec(sheet.text)) !== null) {
      const selector = m[1].trim().replace(/\s+/g, ' ');
      const body = m[2];
      // 只找声明（token 名 + :），排除 var(--s-color-...) 引用
      const declRegex = /(--s-color-[a-zA-Z0-9_-]+)\s*:/g;
      let d;
      const names = [];
      while ((d = declRegex.exec(body)) !== null) names.push(d[1]);
      if (names.length === 0) continue;

      const scope = classifyScope(selector, sheet.href);
      // 排除 agentskin 自身的注入（我们要对比的是 Doubao 原生的定义层级）
      if (scope === 'agentskin') continue;

      // 记录每个作用域下的定义（去重 token）
      for (const n of names) {
        if (!totalTokens[n]) totalTokens[n] = { count: 0, scopes: {} };
        totalTokens[n].count++;
        if (!totalTokens[n].scopes[scope]) totalTokens[n].scopes[scope] = { count: 0, samples: [] };
        totalTokens[n].scopes[scope].count++;
        if (totalTokens[n].scopes[scope].samples.length < 3) {
          totalTokens[n].scopes[scope].samples.push(`${selector}  [${sheet.href.split('/').pop()}]`);
        }
      }

      defs[scope].push({ selector: selector.slice(0, 150), sheet: sheet.href.split('/').pop(), tokens: names.slice(0, 5), tokenCount: names.length });
    }
  }

  return { defs, totalTokens };
}

async function liveVerify(client) {
  // 1. 找一个真实消费 --s-color-text-primary 的元素，验证颜色
  // 2. 对比 body 与 html 上的 --s-color-* 值，确认 body 覆盖生效
  const expr = `(() => {
    const out = {};
    const getCS = (el, name) => getComputedStyle(el).getPropertyValue(name).trim();

    // body vs html 上的关键 token（验证 body 覆盖是否生效）
    out.htmlVals = {};
    out.bodyVals = {};
    const tokens = [
      '--s-color-bg-primary', '--s-color-text-primary', '--s-color-brand-primary-default',
      '--s-color-text-secondary', '--s-color-border-tertiary', '--s-color-bg-float'
    ];
    for (const t of tokens) {
      out.htmlVals[t] = getCS(document.documentElement, t);
      out.bodyVals[t] = getCS(document.body, t);
    }

    // 2. 找一个消费 --s-color-text-primary 的真实元素（采样几个典型组件类）
    const probeSelectors = [
      '.samantha-dropdown-sBBDZ9 .semi-dropdown-title',
      '.samantha-dropdown-sBBDZ9 [role="menuitem"]',
      '.voice-call-panel-OVz3Tq',
      '.header-container-miMQVk .title-rHLWOB',
      '.nav-link-IkIer0',
      '.button-name-CQA7Bp',
      '.overlimit-LkP5TY .semi-checkbox-addon'
    ];
    out.liveElements = [];
    for (const sel of probeSelectors) {
      const el = document.querySelector(sel);
      if (!el) { out.liveElements.push({ sel, found: false }); continue; }
      const cs = getComputedStyle(el);
      out.liveElements.push({
        sel,
        found: true,
        color: cs.color,
        bg: cs.backgroundColor,
        text: el.textContent.trim().slice(0, 24),
        matches: el.matches('.semi-dropdown-item') ? 'dropdown-item' : ''
      });
    }

    return JSON.stringify(out);
  })()`;

  const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.exceptionDetails ? null : JSON.parse(r.result.value);
}

async function main() {
  console.log('Connecting to Doubao @ 127.0.0.1:%d...', PORT);
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('doubao-background'));
  if (!page) { console.error('No chat page'); return; }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log('Connected: %s\n', page.title);

  const sheets = await getAllSheets(client);
  const { defs, totalTokens } = analyzeDefinitions(sheets);
  const live = await liveVerify(client);
  client.close();

  // ---- 汇总输出 ----
  const scopeNames = ['root', 'body', 'html', 'component', 'other'];
  console.log('=== --s-color-* 定义作用域分布（Doubao 原生，不含 agentskin 注入）===');
  for (const scope of scopeNames) {
    const list = defs[scope];
    console.log('  [%s] %d 个规则声明', scope, list.length);
    for (const item of list.slice(0, 6)) {
      console.log('      %s  (%d tokens)  [%s]', item.selector, item.tokenCount, item.sheet);
    }
    if (list.length > 6) console.log('      ... 还有 %d 条', list.length - 6);
  }

  // 组件作用域（可能遮蔽继承）重点
  console.log('\n=== 组件作用域定义（潜在遮蔽风险）===');
  for (const item of defs.component.slice(0, 15)) {
    console.log('  %s  [%s]', item.selector, item.sheet);
  }

  // 哪些 token 在多个作用域重复定义（遮蔽候选）
  console.log('\n=== 跨作用域重复定义的 token（潜在遮蔽）===');
  const multiScope = [];
  for (const [token, info] of Object.entries(totalTokens)) {
    const scopes = Object.keys(info.scopes);
    if (scopes.length > 1 && (scopes.includes('component') || scopes.includes('root'))) {
      multiScope.push({ token, scopes });
    }
  }
  // 按重复 token 数排序
  multiScope.sort((a, b) => b.scopes.length - a.scopes.length);
  for (const item of multiScope.slice(0, 15)) {
    const sc = item.scopes.map((s) => `${s}:${totalTokens[item.token].scopes[s].count}`).join(', ');
    console.log('  %s  →  %s', item.token, sc);
  }
  if (multiScope.length > 15) console.log('  ... 共 %d 个 token 跨作用域', multiScope.length);

  console.log('\n=== Live 验证 ===');
  if (live) {
    console.log('-- html(root) vs body 上的 token 值 --');
    for (const t of Object.keys(live.htmlVals)) {
      const mark = live.htmlVals[t] !== live.bodyVals[t] ? '  <-- 差异（body 覆盖生效）' : '';
      console.log('  %s\n    html: %s\n    body: %s%s', t, live.htmlVals[t], live.bodyVals[t], mark);
    }
    console.log('-- 真实消费元素 --');
    for (const e of live.liveElements) {
      if (!e.found) { console.log('  %s -> NOT FOUND', e.sel); continue; }
      console.log('  %s -> color=%s bg=%s text="%s"', e.sel, e.color, e.bg, e.text);
    }
  }

  const outPath = path.resolve(process.cwd(), 'agents-run-now/doubao-scolor-def-chain.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), sheets: sheets.length, defs, totalTokens, live }, null, 2), 'utf-8');
  console.log('\nFull report: agents-run-now/doubao-scolor-def-chain.json');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
