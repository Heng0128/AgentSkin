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
  const get = (el) => { if(!el) return null; const cs=getComputedStyle(el); return {bg:cs.backgroundColor, bgImg:cs.backgroundImage.slice(0,40), z:cs.zIndex, pos:cs.position, opacity:cs.opacity}; };
  const sel = (s)=>{ try{return document.querySelector(s)}catch{return null} };
  const root = document.documentElement;
  const before = getComputedStyle(document.body,'::before');
  const rootBefore = getComputedStyle(sel('#root')||document.body,'::before');
  const main = sel('main') || sel('main.main-surface') || sel('main[class*="MainContentSurface"]');
  const nav = document.querySelector('nav') || document.querySelector('aside');
  const navBg = nav ? getComputedStyle(nav).backgroundColor : null;
  // art var & image natural size via offscreen loader
  const artVar = getComputedStyle(root).getPropertyValue('--agentskin-art').trim();
  const url = (artVar.match(/url\\("([^"]+)"\\)/)||[])[1] || null;
  return {
    html: get(root),
    body: get(document.body),
    bodyBefore: {content:before.content, bg:before.backgroundColor, bgImg:before.backgroundImage.slice(0,50)},
    root: get(sel('#root')),
    rootBefore: {content:rootBefore.content, bg:rootBefore.backgroundImage.slice(0,50)},
    main: get(main),
    nav: nav ? {bg:navBg, cls:nav.className.slice(0,40)} : null,
    artVar: artVar.slice(0,50),
    artUrl: url ? url.slice(0,40) : null,
    isElectronDark: root.className,
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
