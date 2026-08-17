// Remove my manual tokyo-night pollution, keep the app's own theme intact.
import { fileURLToPath } from 'node:url';

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
const CLEAN = `(() => {
  const removed = [];
  document.getElementById('agentskin-codex-base')?.remove() && removed.push('agentskin-codex-base');
  const st = window.__agentskin_codex_adapter__;
  try { st?.observer?.disconnect?.(); } catch {}
  try { if (st?.interval) clearInterval(st.interval); } catch {}
  const before = document.adoptedStyleSheets.length;
  document.adoptedStyleSheets = Array.from(document.adoptedStyleSheets).filter(s => !(s.__agentskin_layer === 'adapter'));
  const remaining = document.adoptedStyleSheets.length;
  if (window.__agentskin_codex_adapter__) { delete window.__agentskin_codex_adapter__; removed.push('marker'); }
  const css = document.getElementById('agentskin-theme-style-codex');
  const themeText = css ? (css.textContent.match(/--agentskin-text:s*([^;]+);/)?.[1]||'?').trim() : '(none)';
  const root = getComputedStyle(document.documentElement);
  return { removed, adoptedBefore: before, adoptedAfter: remaining, appThemeTag: !!css, appAgentSkinText: themeText, computedText: root.getPropertyValue('--agentskin-text').trim(), htmlClass: document.documentElement.className };
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) =>
      x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: CLEAN, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  else console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
