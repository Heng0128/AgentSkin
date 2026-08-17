// Apply the doubao overflow:visible fix to the RUNNING app via CDP
// so the user can verify immediately. Adds an override style + inline reset
// on the injected input container, then screenshots.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';

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
  // 1) override style so composer containers never clip inline popups
  let st = document.getElementById('agentskin-doubao-overflow-fix');
  if (!st) {
    st = document.createElement('style');
    st.id = 'agentskin-doubao-overflow-fix';
    st.textContent = \`html [class*="input-guidance"], html [class*="input-container"][class*="flex"] { overflow: visible !important; }
html [data-agentskin-input] { overflow: visible !important; }\`;
    document.head.appendChild(st);
  }
  out.styleInjected = true;
  // 2) inline-reset any already-injected container
  const targets = [];
  const injected = document.querySelectorAll('[data-agentskin-input]');
  injected.forEach(el => { el.style.setProperty('overflow', 'visible', 'important'); targets.push(el.className); });
  const generic = Array.from(document.querySelectorAll('[class*="input-guidance"], [class*="input-container"]'))
    .filter(el => el.getBoundingClientRect().width > 100);
  generic.forEach(el => el.style.setProperty('overflow', 'visible', 'important'));
  out.injected = targets.length;
  out.generic = generic.length;
  return out;
})()`;

async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
    .filter(
      (x) =>
        x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
    )
    .find((p) => /豆包|doubao|chat/i.test(p.title || p.url || ''));
  if (!t) {
    console.log('no doubao page target');
    return;
  }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
