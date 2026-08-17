// Focused probe #2 for TraeWork CN: confirm host class, capture shadow-top/bottom,
// user-message-navigator (incl pseudo), composer, and any visible box-shadow bearer.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const PORT = process.argv[2] || '56211';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout:' + method)); } }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const JS = `(() => {
  const out = {};
  out.htmlClasses = Array.from(document.documentElement.classList);
  out.agentskinVar_bg = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-bg').trim();
  out.agentskinVar_accent = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim();
  // token css applied?
  out.agentskinTokenApplied = !!document.querySelector('[style*="--agentskin-bg"], style[data-agentskin], link[rel="stylesheet"][data-agentskin]');

  const dump = (sel) => {
    const arr = [];
    try {
      for (const el of Array.from(document.querySelectorAll(sel)).slice(0, 6)) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const pseudo = (p) => { try { return getComputedStyle(el, p); } catch { return null; } };
        const bf = pseudo('::before'), af = pseudo('::after');
        arr.push({
          cls: (el.className && typeof el.className === 'string') ? el.className : '',
          rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          bg: cs.backgroundColor, bgImg: cs.backgroundImage, radius: cs.borderRadius,
          boxShadow: cs.boxShadow, border: cs.borderColor + ' ' + cs.borderWidth, color: cs.color,
          before: bf ? { content: bf.content, bg: bf.backgroundColor, bgImg: bf.backgroundImage, shadow: bf.boxShadow, radius: bf.borderRadius } : null,
          after: af ? { content: af.content, bg: af.backgroundColor, bgImg: af.backgroundImage, shadow: af.boxShadow, radius: af.borderRadius } : null,
        });
      }
    } catch (e) { arr.push({ err: e.message }); }
    return arr;
  };

  out.shadowTop = dump('.task-list-shadow-top');
  out.shadowBottom = dump('.task-list-shadow-bottom');
  out.navigatorWrap = dump('.user-message-navigator');
  out.navigatorDots = dump('.user-message-navigator__dot');
  out.roundBtns = dump('.solo-mobile-compact-btn');
  out.composer = dump('[class*="chat-input-v2-input-box-editable"], [class*="messageInputPluginToolbar"], [class*="chat-input-primary-glow"]');
  out.bubble = dump('[class*="bubble"], [class*="message-content"]');

  // any visible box-shadow bearer in the whole shell (find the "grey shadow" zones)
  out.shadowBearers = (() => {
    const res = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      try {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (r.width * r.height < 500) continue;
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (cs.boxShadow && cs.boxShadow !== 'none') {
          res.push({ cls: (el.className && typeof el.className === 'string') ? el.className : el.tagName, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], shadow: cs.boxShadow });
        }
      } catch {}
      if (res.length >= 20) break;
    }
    return res;
  })();
  return out;
})()`;

async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''));
  const page = pages.find(p => p.title) || pages[0];
  if (!page) { console.log('No page'); return; }
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const res = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (res.exceptionDetails) console.log('JS error:', JSON.stringify(res.exceptionDetails, null, 2).slice(0, 800));
  console.log(JSON.stringify(res.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });