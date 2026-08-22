// SPDX-License-Identifier: MPL-2.0

/**
 * diag-bridge-scope.mjs — 诊断 bridge 变量真实作用域（只读，无副作用）
 *
 * 对 qoderwork/workbuddy 运行时，检查若干 bridge 原生变量在
 * documentElement / body / 语义 landmark 组件元素 / 实际匹配元素 的计算值，
 * 判断是否 Tailwind @theme-inline 硬编码（变量值不随 :root 走），还是
 * shadow/组件作用域遮蔽。用于决定「:root 桥接 vs 组件级注入」的正确落地。
 *
 * 用法: node tests/probe-suite/diag-bridge-scope.mjs
 */

import { AGENT_CONFIG } from './probe-config.mjs';

class CdpClient {
  constructor(wsUrl, timeout = 8000) {
    this.wsUrl = wsUrl;
    this.timeout = timeout;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`WS error: ${e.message || 'conn failed'}`));
      this.ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve: ok, reject: bad } = this.pending.get(data.id);
          this.pending.delete(data.id);
          data.error ? bad(new Error(JSON.stringify(data.error))) : ok(data.result);
        }
      };
      setTimeout(() => reject(new Error('WS connect timeout')), this.timeout);
    });
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => this.pending.delete(id), this.timeout);
    });
  }
  close() {
    if (this.ws) this.ws.close();
  }
}

async function getWsUrl(port) {
  const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
  const page = list.find((t) => t.type === 'page' || t.type === 'webview');
  return page?.webSocketDebuggerUrl ?? list[0]?.webSocketDebuggerUrl;
}

const JOBS = {
  qoderwork: {
    vars: ['--color-primary', '--color-text', '--color-border', '--color-bg-elevated'],
    landmark: '.agents-layout-root',
  },
  workbuddy: {
    vars: ['--cb-bg-primary', '--cb-text-primary', '--cb-vscode-editor-background', '--cb-sidebar-bg'],
    landmark: '.teams-container',
  },
};

async function probe(agentId) {
  const cfg = AGENT_CONFIG[agentId];
  const wsUrl = await getWsUrl(cfg.port);
  if (!wsUrl) {
    console.log(`[${agentId}] 无 CDP target @${cfg.port}`);
    return;
  }
  const c = new CdpClient(wsUrl);
  try {
    await c.connect();
    await c.send('Runtime.enable');

    // 探测脚本：镜像 analyze 的 buildVarsExpression（枚举 documentElement 计算样式）
    // + body/landmark，定位「analyze 报 :root 变量 0 但 getPropertyValue 能读到」的矛盾。
    const expr = `(() => {
      const vars = ${JSON.stringify(JOBS[agentId].vars)};
      const landmark = ${JSON.stringify(JOBS[agentId].landmark)};
      const cs = (el) => getComputedStyle(el);
      const read = (el) => {
        const o = {};
        for (const v of vars) o[v] = cs(el).getPropertyValue(v).trim() || null;
        return o;
      };
      // 镜像 analyze: 枚举指定元素计算样式上的全部自定义属性（却排除 --agentskin-*）
      const enumerate = (el) => {
        const s = cs(el);
        const names = [];
        for (let i = 0; i < s.length; i++) {
          const n = s[i];
          if (n.startsWith('--') && !n.startsWith('--agentskin-')) names.push(n);
        }
        return { unique: names.length, first: names.slice(0, 40) };
      };
      const root = document.documentElement;
      const body = document.body;
      let landmarkEl = null;
      try { landmarkEl = document.querySelector(landmark); } catch (e) {}
      const out = {
        root: read(root),
        body: read(body),
        landmark: landmarkEl ? read(landmarkEl) : null,
        hasLandmark: !!landmarkEl,
        // enumerate 与 analyze 完全一致
        enumRoot: enumerate(root),
        enumBody: enumerate(body),
        enumLandmark: landmarkEl ? enumerate(landmarkEl) : null,
        hostClass: root.className.split(/\\s+/).filter(c => c.startsWith('agentskin-host')).join(',') || null,
        // 这些变量是否在根规则/body 规则里被声明（document.styleSheets 扫描，镜像 styleAst）
        declaredInSheets: (() => {
          const found = {};
          for (const v of vars) found[v] = null;
          try {
            for (const sheet of document.styleSheets) {
              const walk = (rules) => {
                for (const rule of rules) {
                  if (rule.selectorText && rule.selectorText.includes(':root')) {
                    for (const v of vars) if (rule.style.getPropertyValue(v)) found[v] = rule.selectorText;
                  }
                  if (rule.cssRules) walk(rule.cssRules);
                }
              };
              walk(sheet.cssRules || []);
            }
          } catch (e) {}
          return found;
        })(),
      };
      return out;
    })()`;

    const r = await c.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    const val = r?.result?.value;
    console.log(`\n=== ${agentId} (@${cfg.port}) ${cfg.description} ===`);
    console.log(JSON.stringify(val, null, 2));
  } catch (err) {
    console.log(`[${agentId}] 错误: ${err.message}`);
  } finally {
    c.close();
  }
}

async function main() {
  for (const id of ['qoderwork', 'workbuddy']) {
    await probe(id);
  }
}

main();