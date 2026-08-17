// Force doubao back to a fresh-home composer, then dump the composer function
// bar buttons (labels + geometry) so we can identify the "first button".
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
const shotArg = argv.find(a => a.startsWith('--shot'));
const SHOT = shotArg ? shotArg.split('=')[1] ?? shotArg.split(' ')[1] : 'doubao-home.png';

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => { c.ws.addEventListener('open', res, { once: true }); c.ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) { const m = JSON.parse(raw); if (m.id != null && this.pending.has(m.id)) { const { r } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? r(new Error(m.error.message)) : r(m.result); } }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { r: res }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 15000); }); }
  close() { try { this.ws.close(); } catch {} }
}

const JS = `(async () => {
  const out = { url: location.href };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height < 4) return false; const cs = getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };

  // Robust: find any element whose text is exactly "新对话" and click its topmost interactive ancestor
  let clicked = null;
  const all = Array.from(document.querySelectorAll('div,li,a,span,button,[role="button"]'));
  for (const el of all) {
    if (!vis(el)) continue;
    const t = (el.childElementCount === 0 ? (el.textContent||'') : '').trim();
    if (t === '新对话') { (el.closest('button,[role="button"],a') || el).click(); clicked = t; break; }
  }
  out.clicked = clicked;
  await sleep(800);
  out.after = location.href;
  out.hasComposer = !!document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');

  // Dump bottom function-bar buttons
  const bars = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis)
    .map((b, idx) => {
      const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      return { idx, label: (b.getAttribute&&(b.getAttribute('aria-label')||b.getAttribute('data-testid')))||'', txt:(b.textContent||'').trim().replace(/\\s+/g,' ').slice(0,10), x:Math.round(r.x), y:Math.round(r.y), w:Math.round(r.width), h:Math.round(r.height), z:cs.zIndex };
    })
    .filter(b => b.y + b.h > innerHeight * 0.68 && b.x > 200 && b.h >= 18 && b.h <= 80)
    .sort((a,b) => a.x - b.x);
  out.bar = bars;
  return out;
})()`;

async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(x => x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url||'')).find(p => /豆包|doubao|chat/i.test(p.title||p.url||''));
  if (!t) { console.log('no page'); return; }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const res = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails));
  console.log(JSON.stringify(res.result?.value, null, 2));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('\n[shot]', SHOT);
  c.close();
}
run().catch(e => { console.error('FAIL', e.message); process.exit(1); });