// Live-inject the home mode-toggle fix into the running doubao (61055).
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '61055';
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
const CSS = `
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-primary"],
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-secondary"] {
  background: transparent !important;
  border: none !important;
}
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-primary"] { color: #c0caf5 !important; }
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-secondary"] { color: #565f89 !important; }
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-primary"]:hover,
html.agentskin-host-doubao [class*="rounded-full"] button[class*="text-dbx-text-secondary"]:hover { color: #c0caf5 !important; }
`;
async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
    .filter(
      (x) =>
        x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
    )
    .find((p) => /豆包|doubao|chat/i.test(p.title || p.url || ''));
  if (!t) {
    console.log('no page');
    return;
  }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = `(() => { const s=document.createElement('style'); s.textContent=${JSON.stringify(CSS)}; s.id='agentskin-home-mode-fix'; const old=document.getElementById('agentskin-home-mode-fix'); if(old) old.remove(); document.head.appendChild(s); return document.getElementById('agentskin-home-mode-fix')!=null; })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  console.log('injected=', r.result?.value);
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
