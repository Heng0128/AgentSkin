/**
 * Probe: 验证 --s-color-* 覆盖链路的遮蔽风险点
 * 检查 .semi-popupview-* / .code-canvas-theme-* / .cici-ext-container 是否真实存在于 DOM，
 * 若存在，读取其自身计算的 --s-color-* 值，对比 body 的 agentskin 值，判断链路是否有洞。
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';

const PORT = 61055;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/json/list', method: 'GET' },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end();
  });
}

class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.msgId = 0; this.pending = new Map(); this.commandTimeout = 15000; }
  connect() { return new Promise((res, rej) => { this.ws = new WebSocket(this.wsUrl); this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WS')); this.ws.onmessage = (m) => { let msg; try { msg = JSON.parse(m.data); } catch { return; } if (msg.id && this.pending.has(msg.id)) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } }; setTimeout(() => rej(new Error('timeout')), 12000); }); }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.msgId; this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('t:' + method)); } }, this.commandTimeout); }); }
  close() { if (this.ws) this.ws.close(); }
}

const EXPR = `(() => {
  const out = { found: [], notFound: [] };
  const getV = (el, n) => getComputedStyle(el).getPropertyValue(n).trim();
  const bodyText = getV(document.body, '--s-color-text-primary');
  const bodyBg = getV(document.body, '--s-color-bg-primary');

  const targets = [
    { sel: '.semi-popupview-dark', note: 'semi 弹层(dark)' },
    { sel: '.semi-popupview-light', note: 'semi 弹层(light)' },
    { sel: '[class*="code-canvas-theme"]', note: 'code-canvas 作用域' },
    { sel: '.cici-ext-container', note: 'cici ext 容器' },
    { sel: '.semi-portal', note: 'semi portal' },
    { sel: '[class*="popupview"]', note: '任意 popupview' },
  ];

  for (const t of targets) {
    const els = document.querySelectorAll(t.sel);
    if (els.length === 0) { out.notFound.push(t); continue; }
    const samples = [];
    for (let i = 0; i < Math.min(els.length, 3); i++) {
      const el = els[i];
      samples.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 80),
        sColorText: getV(el, '--s-color-text-primary'),
        sColorBg: getV(el, '--s-color-bg-primary'),
        semiText: getV(el, '--semi-color-text-0'),
        semiBg: getV(el, '--semi-color-bg-0'),
        dbxText: getV(el, '--dbx-text-primary'),
        // 实际渲染
        actualColor: getComputedStyle(el).color,
        actualBg: getComputedStyle(el).backgroundColor,
      });
    }
    out.found.push({ sel: t.sel, note: t.note, count: els.length, samples });
  }

  out.bodyBaseline = { text: bodyText, bg: bodyBg };
  return JSON.stringify(out);
})()`;

async function main() {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('doubao-background'));
  if (!page) { console.error('no page'); return; }
  const c = new CdpClient(page.webSocketDebuggerUrl);
  await c.connect();
  const r = await c.send('Runtime.evaluate', { expression: EXPR, returnByValue: true });
  c.close();
  if (r.exceptionDetails) { console.error('EXC', JSON.stringify(r.exceptionDetails).slice(0, 500)); return; }
  const v = JSON.parse(r.result.value);

  console.log('body 基准: text=%s bg=%s', v.bodyBaseline.text, v.bodyBaseline.bg);
  console.log('\n=== 遮蔽风险选择器 ===');
  for (const f of v.found) {
    console.log('\n[%s] %s  → %d 个元素', f.sel, f.note, f.count);
    for (const s of f.samples) {
      const textDiff = s.sColorText !== v.bodyBaseline.text;
      const bgDiff = s.sColorBg !== v.bodyBaseline.bg;
      console.log('  <%s> %s', s.tag, s.cls);
      console.log('    s-color text=%s bg=%s  %s%s', s.sColorText, s.sColorBg, textDiff ? '←不同于body!' : '=body', bgDiff ? ' | bg不同于body!' : '');
      console.log('    semi   text=%s bg=%s   dbx text=%s', s.semiText, s.semiBg, s.dbxText);
      console.log('    actual color=%s bg=%s', s.actualColor, s.actualBg);
    }
  }
  console.log('\n未找到:', v.notFound.map((n) => n.sel).join(', ') || '(无)');

  const outPath = path.resolve(process.cwd(), 'agents-run-now/doubao-scolor-shadow-check.json');
  fs.writeFileSync(outPath, JSON.stringify(v, null, 2), 'utf-8');
  console.log('\nSaved: agents-run-now/doubao-scolor-shadow-check.json');
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
