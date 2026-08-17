// Probe Codex sidebar art/background positioning geometry via CDP.
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
  const out = {};
  const b = getComputedStyle(document.body);
  const before = getComputedStyle(document.body, '::before');
  out.bodyArt = {
    backgroundImage: b.backgroundImage.slice(0, 60),
    backgroundSize: b.backgroundSize,
    backgroundPosition: b.backgroundPosition,
    backgroundRepeat: b.backgroundRepeat,
  };
  out.bodyBeforeArt = {
    content: before.content,
    position: before.position,
    inset: [before.top, before.right, before.bottom, before.left].join(' '),
    zIndex: before.zIndex,
    backgroundImage: before.backgroundImage.slice(0, 60),
    backgroundSize: before.backgroundSize,
    backgroundPosition: before.backgroundPosition,
    backgroundRepeat: before.backgroundRepeat,
    width: before.width,
    height: before.height,
  };
  // find the sidebar
  const nav = document.querySelector('nav') || document.querySelector('aside');
  if (nav) {
    const r = nav.getBoundingClientRect();
    out.sidebar = {
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      cls: nav.className.slice(0, 80),
      bg: getComputedStyle(nav).backgroundColor,
      bgImage: getComputedStyle(nav).backgroundImage.slice(0, 60),
      art: getComputedStyle(nav).getPropertyValue('--agentskin-art').slice(0, 60),
    };
  }
  out.vw = { w: innerWidth, h: innerHeight };
  out.artVar = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-art').slice(0, 60);
  return out;
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
