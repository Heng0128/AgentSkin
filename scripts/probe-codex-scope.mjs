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
  // Probe A: :root scoped variable (previously proven to work)
  const pa = document.createElement('style'); pa.id='agsk-pa';
  pa.textContent = ':root { --agsk-pa: #ff0000; }';
  document.head.appendChild(pa);
  out.paRoot = getComputedStyle(document.documentElement).getPropertyValue('--agsk-pa').trim();
  pa.remove();
  // Probe B: host-scoped variable (html.agentskin-host-codex, host class IS on <html>)
  const pb = document.createElement('style'); pb.id='agsk-pb';
  pb.textContent = 'html.agentskin-host-codex { --agsk-pb: #00ff00; }';
  document.head.appendChild(pb);
  out.pbHost = getComputedStyle(document.documentElement).getPropertyValue('--agsk-pb').trim();
  const cssPb = pb.sheet ? Array.from(pb.sheet.cssRules).map(r=>r.cssText) : [];
  out.pbHostRules = cssPb;
  pb.remove();
  // Probe C: durable in-place on the theme style — what does getComputedValue show for accent right now?
  out.accentNow = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim();
  out.hostClass = document.documentElement.classList.contains('agentskin-host-codex');
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
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  else console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
