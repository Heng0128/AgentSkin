// Read-only probe: after resetting to a fresh 对话, dump the "对话" / "工作"
// mode buttons + their ancestor chain: which of our injected selectors match
// (topic / quick-action / welcome / recommend / suggest), computed border-radius,
// background, background-image. No blind clicking — one targeted 新对话 reset.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';

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
      c.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { r } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? r(new Error(m.error.message)) : r(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { r: res });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
        }
      }, 15000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

const JS = `(async () => {
  const out = { url: location.href };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height<4) return false; const cs=getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };

  // fresh-home (leave any existing conversation)
  for (const el of Array.from(document.querySelectorAll('div,li,a,span,button,[role="button"]')))
    if (vis(el) && el.childElementCount===0 && (el.textContent||'').trim()==='新对话') { (el.closest('button,[role="button"],a')||el).click(); break; }
  await sleep(700);
  out.afterUrl = location.href;

  const hit = (cls) => /topic|quick-action|welcome|recommend|suggest|guide|shortcut/i.test(cls);

  // find leaf "对话" / "工作"
  const found = [];
  for (const el of Array.from(document.querySelectorAll('div,span,button,li,a')).filter(vis)) {
    if (el.childElementCount) continue;
    const t = (el.textContent||'').trim();
    if (t === '对话' || t === '工作') {
      const btn = el.closest('button,[role="button"]') || el.closest('[class*="button"],[class*="card"]') || el.parentElement;
      found.push(btn);
      if (found.length >= 2) break;
    }
  }
  out.found = found.length;

  const chain = [];
  for (const root of found.slice(0,2)) {
    const arr = [];
    for (let el = root, d = 0; el && d < 6; el = el.parentElement, d++) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const cls = (typeof el.className === 'string' ? el.className : '');
      arr.push({
        tag: el.tagName, depth: d,
        cls: cls.split(/\\s+/).slice(0,12).join(' '),
        hit: hit(cls),
        radius: cs.borderRadius, bg: cs.backgroundColor, bgImg: cs.backgroundImage && cs.backgroundImage.slice(0,20),
        border: cs.borderTopColor === 'transparent' ? 'transparent' : cs.borderTopColor,
        rect: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],
      });
    }
    chain.push(arr);
  }
  out.chain = chain;
  return out;
})()`;

async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
    .filter(
      (x) =>
        x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
    )
    .find((p) => /豆包|doubao|chat/i.test(p.title || p.url || ''));
  if (!t) {
    console.log('no doubao page');
    return;
  }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', {
    expression: JS,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
