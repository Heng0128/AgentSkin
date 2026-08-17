// Identify which theme(s) are currently affecting the codex page.
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
const JS = `(() => {
  const getText = (text) => { const m = text.match(/--agentskin-text:s*([^;]+);/); return m ? m[1].trim() : '(none)'; };
  const styles = Array.from(document.querySelectorAll('style')).filter(s=>/agentskin/i.test(s.textContent||'')).map(s => ({ id: s.id||'(no-id)', text: getText(s.textContent||'').slice(0,40), len: (s.textContent||'').length }));
  const adopted = [];
  try { document.adoptedStyleSheets.forEach((sh,i)=>{ try{ let t=''; try{ t=sh.cssRules[0]?.cssText||''; }catch{} if(/agentskin/i.test(t)) adopted.push({i, text: t.match(/--agentskin-text:[^;]+/)?.[0]||'', first: t.slice(0,50)}); }catch{} }); } catch{}
  const st = getComputedStyle(document.documentElement);
  return {
    htmlClass: document.documentElement.className,
    styleTags: styles,
    adoptedAgentSkin: adopted,
    currentVars: { text: st.getPropertyValue('--agentskin-text').trim(), primary: st.getPropertyValue('--text-primary').trim(), skinTheme: document.documentElement.dataset.codexSkinTheme },
    marker: !!window.__agentskin_codex_adapter__,
  };
})()`;
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) =>
      x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
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
