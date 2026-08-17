// Direct answer to "does the selected row show accent emphasis?"
// In the current CLEAN state: verify the actual side-panel row structure,
// then apply a HARD-CODED accent emphasis (inline style, no vars, no CSSOM),
// and report the computed color before/after on the row AND its visual ancestors.
const PORT = process.argv[2] || '58554';
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
const JS = `(() => {
  const el = document.querySelector('[data-app-action-sidebar-thread-selected]');
  if (!el) return { found: false };
  const read = (e) => { const c = e ? getComputedStyle(e) : null; return c ? { bg: c.backgroundColor, color: c.color, boxB: c.boxShadow.slice(0,40) } : null; };
  const before = read(el);
  // walk up to 6 ancestors to see which one carries a visible background
  let chain = [];
  let n = el; let i = 0;
  while (n && i < 8) { const c = getComputedStyle(n); chain.push({ tag: n.tagName.toLowerCase(), cls: (n.className||'').toString().split(' ').filter(Boolean).slice(0,3).join('.'), bg: c.backgroundColor, rect: (()=>{const r=n.getBoundingClientRect(); return {w:Math.round(r.width), h:Math.round(r.height)};})() }); n = n.parentElement; i++; }
  // apply hard-coded accent emphasis to the row
  el.style.setProperty('background-color', 'rgba(122,162,247,0.4)', 'important');
  el.style.setProperty('box-shadow', 'inset 3px 0 0 0 #7aa2f7', 'important');
  const after = read(el);
  el.style.removeProperty('background-color');
  el.style.removeProperty('box-shadow');
  return { found: true, tag: el.tagName, cls: (el.className||'').toString().slice(0,80), before, after, chain };
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  else console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
