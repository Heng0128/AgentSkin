/**
 * Probe: Doubao --dbx-* vs --s-color-* live-usage check v2
 * 定点验证: dbx 工具类是否真实驱动 UI；扫描全部 sheet 读取失败数
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 61055;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path: '/json/list',
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
    this.commandTimeout = 10000;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('WS error'));
      this.ws.onmessage = (m) => {
        let msg;
        try { msg = JSON.parse(m.data); } catch { return; }
        if (msg.id && this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
          else p.resolve(msg.result);
        }
      };
      setTimeout(() => reject(new Error('WS timeout')), 8000);
    });
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
  close() { if (this.ws) this.ws.close(); }
}

const PROBE = `(() => {
  const out = { sheets: [], unreadable: [], liveChecks: [] };

  // 1. 枚举所有样式表及其可读性
  for (let i = 0; i < document.styleSheets.length; i++) {
    const sh = document.styleSheets[i];
    let readable = true, count = 0;
    try {
      count = sh.cssRules.length;
    } catch (e) {
      readable = false;
    }
    out.sheets.push({ i, href: sh.href || '(inline)', rules: readable ? count : -1, readable });
    if (!readable) out.unreadable.push(sh.href || '(inline)');
  }

  // 2. 定点验证 text-dbx-text-primary 元素实际颜色
  const probeEls = [
    '.text-dbx-text-primary',
    '.text-dbx-text-tertiary',
    '.bg-dbx-bg-float',
    '.bg-dbx-bg-base-5',
    '.border-dbx-line-10',
  ];
  for (const sel of probeEls) {
    const el = document.querySelector(sel);
    if (!el) { out.liveChecks.push({ sel, found: false }); continue; }
    const cs = getComputedStyle(el);
    out.liveChecks.push({
      sel,
      found: true,
      color: cs.color,
      bg: cs.backgroundColor,
      borderColor: cs.borderColor,
      font: cs.fontFamily ? cs.fontFamily.slice(0, 40) : null,
      sampleText: el.textContent.trim().slice(0, 40),
    });
  }

  // 3. 统计 document 上是否有 s-color 类元素
  out.sColorClassElements = document.querySelectorAll('[class*="s-color"], [class*="semi-color"]').length;
  out.dbxClassElements = document.querySelectorAll('[class*="dbx"]').length;

  // 4. 看 body 下第一层大容器结构（找主应用容器）
  out.bodyChildren = [];
  for (const el of document.body.children) {
    out.bodyChildren.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 80),
      bg: getComputedStyle(el).backgroundColor,
    });
  }

  return JSON.stringify(out);
})()`;

async function main() {
  console.log('Connecting to Doubao @ 127.0.0.1:%d...', PORT);
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('doubao-background'));
  if (!page) { console.error('No chat page'); return; }
  const client = new CdpClient(page.webSocketDebuggerUrl);
  await client.connect();
  console.log('Connected: %s\n', page.title);

  const r = await client.send('Runtime.evaluate', { expression: PROBE, returnByValue: true });
  client.close();
  if (r.exceptionDetails) { console.error('exception:', JSON.stringify(r.exceptionDetails).slice(0, 600)); return; }
  const v = typeof r.result.value === 'string' ? JSON.parse(r.result.value) : r.result.value;

  console.log('=== StyleSheets (%d) ===', v.sheets.length);
  let readable = 0;
  for (const s of v.sheets) {
    if (s.readable) readable++;
    console.log('  [%d] readable=%s rules=%d %s', s.i, s.readable, s.rules, s.href || '(inline)');
  }
  console.log('readable: %d/%d, unreadable: %d', readable, v.sheets.length, v.unreadable.length);
  for (const u of v.unreadable) console.log('  UNREADABLE: %s', u);

  console.log('\n=== Live element checks ===');
  for (const c of v.liveChecks) {
    if (!c.found) { console.log('  %s -> NOT FOUND', c.sel); continue; }
    console.log('  %s -> color=%s bg=%s bc=%s', c.sel, c.color, c.bg, c.borderColor);
  }

  console.log('\n=== Element counts ===');
  console.log('- [class*="s-color"/semi-color] elements:', v.sColorClassElements);
  console.log('- [class*="dbx"] elements:', v.dbxClassElements);

  console.log('\n=== body children ===');
  for (const c of v.bodyChildren) {
    console.log('  <%s> cls="%s" bg=%s', c.tag, c.cls, c.bg);
  }

  const outPath = path.resolve(process.cwd(), 'agents-run-now/doubao-scolor-chain.json');
  fs.writeFileSync(outPath, JSON.stringify(v, null, 2), 'utf-8');
  console.log('\nSaved to: agents-run-now/doubao-scolor-chain.json');
}

main().catch((e) => { console.error('ERROR:', e); process.exit(1); });
