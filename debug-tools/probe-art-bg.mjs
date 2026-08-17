const PORT = process.argv[2];
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
  const root = document.documentElement;
  const artVar = getComputedStyle(root).getPropertyValue('--agentskin-art').trim();
  const styles = Array.from(document.querySelectorAll('style')).filter(s=>/^agentskin-theme-style/i.test(s.id||'')).map(s=>{
    const css = s.textContent||'';
    const i = css.indexOf('#root::before');
    const nav = css.match(/(?:nav|aside)\\s*\\{[\\s\\S]*?\\}/);
    return { id: s.id, len: css.length, hasRootBefore: i>=0, hasArt: css.includes('agentskin-art'), navRule: nav ? nav[0].slice(0,160) : null };
  });
  const rootEl = document.querySelector('#root');
  return { hostClass: root.className, artVar: artVar.slice(0,50), styles, hasRoot: !!rootEl, rootRect: rootEl ? (()=>{const r=rootEl.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)})() : null, vw: innerWidth+'x'+innerHeight };
})()`;
async function run() {
  const url = `http://127.0.0.1:${PORT}/json`;
  let list;
  try {
    list = (await (await fetch(url)).json()).filter(
      (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
    );
  } catch (e) {
    console.log('cannot-list', PORT, e.message);
    return;
  }
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  if (!main) {
    console.log('no-page', PORT);
    return;
  }
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  console.log('PORT', PORT, JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', PORT, e.message);
});
