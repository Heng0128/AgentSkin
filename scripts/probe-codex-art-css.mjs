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
  const st = document.getElementById('agentskin-theme-style-codex');
  const css = (st ? st.textContent : '') + '\\n' + Array.from(document.adoptedStyleSheets||[]).map(s=>{try{return Array.from(s.cssRules).map(r=>r.cssText).join('\\n')}catch{return ''}}).join('\\n');
  const artSel = css.indexOf('#root::before');
  let artBlock = null;
  if (artSel >= 0) {
    let i = css.indexOf('{', artSel) + 1, depth = 1;
    while (i < css.length && depth > 0) { if (css[i]==='{') depth++; else if (css[i]==='}') depth--; i++; }
    artBlock = css.slice(css.indexOf('{', artSel)+1, i-1);
  }
  // root/body current state
  const root = document.documentElement;
  const artVar = getComputedStyle(root).getPropertyValue('--agentskin-art').trim();
  // #root element geometry & whether it exists
  const rootEl = document.querySelector('#root');
  const rRect = rootEl ? rootEl.getBoundingClientRect() : null;
  const nav = document.querySelector('nav') || document.querySelector('aside');
  const nRect = nav ? nav.getBoundingClientRect() : null;
  const nz = nav ? getComputedStyle(nav).zIndex : null;
  const rootBefore = getComputedStyle(rootEl || document.body).zIndex;
  return {
    artBackgroundBlock: artBlock,
    artVar: artVar.slice(0, 60),
    artVarPresent: !!artVar,
    rootExists: !!rootEl,
    rootRect: rRect ? {x:Math.round(rRect.x),y:Math.round(rRect.y),w:Math.round(rRect.width),h:Math.round(rRect.height)} : null,
    navRect: nRect ? {x:Math.round(nRect.x),w:Math.round(nRect.width),h:Math.round(nRect.height)} : null,
    navZ: nz,
    vw: innerWidth+'x'+innerHeight,
  };
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
