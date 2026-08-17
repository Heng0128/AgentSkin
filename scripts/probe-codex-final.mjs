// Final combined diagnostic:
// 1) does the host-scoped descendant selector actually match the row?
// 2) does --agentskin-accent resolve?
// 3) raw (unscoped) attribute selector red — does it paint the row?
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
  const hostMatched = el ? el.matches('html.agentskin-host-codex [data-app-action-sidebar-thread-selected]') : null;
  const cnt = document.querySelectorAll('html.agentskin-host-codex [data-app-action-sidebar-thread-selected]').length;
  const css = { accent: getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim(), bgActive: getComputedStyle(document.documentElement).getPropertyValue('--bg-active').trim() };
  // raw unscoped red injection
  const id = 'agsk-tmp';
  document.getElementById(id)?.remove();
  const s = document.createElement('style'); s.id = id;
  s.textContent = '[data-app-action-sidebar-thread-selected]{ background: #ff0000 !important; }';
  document.head.appendChild(s);
  const redRow = el ? getComputedStyle(el).backgroundColor : null;
  document.getElementById(id)?.remove();
  const bgMix = el ? getComputedStyle(el).getPropertyValue('background-color') : null;
  return { el: el ? el.tagName + '.' + (el.className ? String(el.className).split(' ')[0] : '') : null, hostSelectorMatches: hostMatched, hostSelectorCount: cnt, tokens: css, bgAfterRawRed: redRow, elBgComputedNow: bgMix };
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
