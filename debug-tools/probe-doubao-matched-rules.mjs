// List which of OUR injected (agentskin-host-doubao) CSS rules actually match
// the 对话/工作 mode buttons + their pill track. Reveals what forces a square.
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

  for (const el of Array.from(document.querySelectorAll('div,li,a,span,button,[role="button"]')))
    if (vis(el) && el.childElementCount===0 && (el.textContent||'').trim()==='新对话') { (el.closest('button,[role="button"],a')||el).click(); break; }
  await sleep(700);

  const targets = [];
  for (const el of Array.from(document.querySelectorAll('div,span,button,li,a')).filter(vis)) {
    if (el.childElementCount) continue;
    const t = (el.textContent||'').trim();
    if (t === '对话' || t === '工作') {
      const btn = el.closest('button,[role="button"]') || el.parentElement;
      if (btn && !targets.includes(btn)) targets.push(btn);
      const track = btn && btn.parentElement;
      if (track && !targets.includes(track)) targets.push(track);
    }
  }
  out.targetCount = targets.length;

  // find stylesheets clearly from AgentSkin injection (host class)
  const ss = Array.from(document.styleSheets);
  out.sheetCount = ss.length;

  const matched = [];
  const trySheet = (sheet, styleName) => {
    let rules;
    try { rules = sheet.cssRules; } catch { return; }
    if (!rules) return;
    const walk = (list) => {
      for (const r of list) {
        if (r.type === 4 && r.cssRules) { walk(r.cssRules); continue; } // media
        if (r.type !== 1 || !r.selectorText) continue;
        const sel = r.selectorText;
        if (!/agentskin-host-doubao/i.test(sel)) continue;
        let whoHit = [];
        for (const el of targets) if (el.matches(sel)) whoHit.push(el.tagName + (el.className && typeof el.className==='string' ? '.'+el.className.split(/\\s+/)[0] : ''));
        if (whoHit.length) matched.push({ style: styleName, sel, hit: whoHit.slice(0,3), decls: r.style.cssText.split(';').filter(Boolean).slice(0,8) });
      }
    };
    walk(rules);
  };
  for (let i = 0; i < ss.length; i++) {
    trySheet(ss[i], '#ss' + i + (ss[i].ownerNode && ss[i].ownerNode.id ? '(' + ss[i].ownerNode.id + ')' : ''));
  }
  out.matchedRules = matched.slice(0, 40);
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
