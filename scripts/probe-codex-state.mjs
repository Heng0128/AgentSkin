// Check current codex injection state (no screenshot).
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
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
  const adopted = [];
  try { for (const sh of document.adoptedStyleSheets) { let t=''; try{ t=sh.cssRules[0]?.cssText||''; }catch{} adopted.push({ any: (sh.cssRules?.length??0), firstAgentSkin: /agentskin-host-codex/i.test(t), first: t.slice(0,90) }); } } catch {}
  const tags = Array.from(document.querySelectorAll('style')).filter(s=>{ const t=s.textContent||''; return /agentskin/i.test(t); }).map(s=>s.id||'(no-id)');
  const st = getComputedStyle(document.documentElement);
  return {
    marker: !!window.__agentskin_codex_adapter__,
    hostClass: document.documentElement.classList.contains('agentskin-host-codex'),
    styleTagIds: tags,
    adopted,
    textPrimary: st.getPropertyValue('--text-primary').trim(),
    bgSurface: st.getPropertyValue('--bg-surface').trim(),
  };
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) =>
      x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
  );
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    const c = await CDP.connect(t.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
    console.log('TARGET', i, t.url);
    if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
    else console.log(JSON.stringify(r.result?.value, null, 2));
    c.close();
  }
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
