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
const JS = `(async () => {
  const artVar = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').trim();
  const url = (artVar.match(/url\\("([^"]+)"\\)/)||[])[1] || null;
  if (!url) return { artVar, noUrl: true };
  const out = { artVar: artVar.slice(0,60), url: url.slice(0,50) };
  // 1) probe: can an <img> load this blob?
  const tryImg = (src) => new Promise((res) => {
    const img = document.createElement('img');
    img.onload = () => res({ ok:true, w:img.naturalWidth, h:img.naturalHeight });
    img.onerror = () => res({ ok:false });
    img.src = src;
  });
  out.blobLoadable = await tryImg(url);
  // 2) fringe check: BackgroundImage computed
  const rootEl = document.querySelector('#root');
  const before = getComputedStyle(rootEl||document.body,'::before');
  out.rootBeforeBgImg = before.backgroundImage.slice(0,80);
  // 3) is there a matching CSSStyleSheet still referencing --agentskin-art?
  const st = document.getElementById('agentskin-theme-style-codex');
  out.hasThemeStyle = !!st;
  out.accentVar = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim().slice(0,20);
  return out;
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', {
    expression: JS,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
