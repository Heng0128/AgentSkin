/**
 * Probe: 检查 .semi-popupview-dark 块是否也重定义 --semi-color-* / --dbx-* / --ffc-*
 * 决定弹层遮蔽的严重度：若仅 --s-color-* 被遮蔽，semi 组件仍可被 root 级 --semi-color-* 覆盖。
 */
import http from 'node:http';

const PORT = 61055;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PORT, path: '/json/list', method: 'GET' },
      (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
    req.on('error', reject); req.end();
  });
}

class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.msgId = 0; this.pending = new Map(); this.listeners = new Map(); this.commandTimeout = 15000; }
  connect() { return new Promise((res, rej) => { this.ws = new WebSocket(this.wsUrl); this.ws.onopen = () => res(); this.ws.onerror = () => rej(new Error('WS')); this.ws.onmessage = (m) => { let msg; try { msg = JSON.parse(m.data); } catch { return; } if (msg.id && this.pending.has(msg.id)) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); } else if (msg.method) { const ls = this.listeners.get(msg.method); if (ls) ls.forEach((cb) => cb(msg.params)); } }; setTimeout(() => rej(new Error('timeout')), 12000); }); }
  send(method, params = {}) { return new Promise((res, rej) => { const id = ++this.msgId; this.pending.set(id, { resolve: res, reject: rej }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('t:' + method)); } }, this.commandTimeout); }); }
  on(method, cb) { if (!this.listeners.has(method)) this.listeners.set(method, []); this.listeners.get(method).push(cb); }
  close() { if (this.ws) this.ws.close(); }
}

async function getSheetTextByKeyword(client, keyword) {
  await client.send('DOM.enable');
  const headers = [];
  client.on('CSS.styleSheetAdded', (p) => headers.push(p.header));
  await client.send('CSS.enable');
  await new Promise((r) => setTimeout(r, 1200));
  for (const h of headers) {
    if (h.sourceURL && h.sourceURL.includes(keyword)) {
      try { const { text } = await client.send('CSS.getStyleSheetText', { styleSheetId: h.styleSheetId }); return text; } catch { return null; }
    }
  }
  return null;
}

function analyzeBlock(text, selectorKey) {
  // 找到 selector 块的完整内容（含嵌套？用简单括号配平）
  const idx = text.indexOf(selectorKey);
  if (idx < 0) return null;
  const braceStart = text.indexOf('{', idx);
  if (braceStart < 0) return null;
  let depth = 0, end = braceStart;
  for (let i = braceStart; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const block = text.slice(braceStart + 1, end);
  const count = (re) => (block.match(re) || []).length;
  return {
    len: block.length,
    sColor: count(/--s-color-[a-z0-9_-]+/g),
    semi: count(/--semi-color-[a-z0-9_-]+/g),
    dbx: count(/--dbx-[a-z0-9_-]+/g),
    ffc: count(/--ffc-[a-z0-9_-]+/g),
    gray: count(/--gray\d+/g),
    sample: block.slice(0, 400)
  };
}

async function main() {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl && !t.url.includes('doubao-background'));
  if (!page) { console.error('no page'); return; }
  const c = new CdpClient(page.webSocketDebuggerUrl);
  await c.connect();
  console.log('Connected: %s', page.title);
  const text = await getSheetTextByKeyword(c, '29699.dbdc4429.css');
  c.close();
  if (!text) { console.error('sheet not found'); return; }
  console.log('sheet length: %d', text.length);

  for (const key of ['.semi-popupview-dark', '.semi-popupview-light', '.cici-ext-container', ':root[data-theme'] ) {
    const a = analyzeBlock(text, key);
    if (!a) { console.log('\n[%s] 未找到', key); continue; }
    console.log('\n[%s] 块长=%d', key, a.len);
    console.log('  --s-color-*   : %d', a.sColor);
    console.log('  --semi-color-*: %d', a.semi);
    console.log('  --dbx-*       : %d', a.dbx);
    console.log('  --ffc-*       : %d', a.ffc);
    console.log('  --gray*       : %d', a.gray);
  }
}

main().catch((e) => { console.error('ERR', e); process.exit(1); });
