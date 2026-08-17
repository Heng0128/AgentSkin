// Apply the standard tokyo-night theme to the RUNNING codex (58554) via the
// same path the engine uses: theme asset CSS (agentskin palette + host token
// overrides) + engines/codex/adapter.mjs (host class + structural CSS).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '58554';
const ADAPTER_PATH = join(ROOT, 'engines', 'codex', 'adapter.mjs');
const THEME_CSS_PATH = join(ROOT, 'themes', 'tokyo-night', 'assets', 'css', 'codex.css');
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
      }, 20000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
async function run() {
  const list = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(
    (x) =>
      x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  if (!main) {
    console.log('no codex page');
    return;
  }
  const themeCss = readFileSync(THEME_CSS_PATH, 'utf8');
  const adapterSrc = readFileSync(ADAPTER_PATH, 'utf8');
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  // 1) inject theme CSS
  const injectCss = `(() => { const id='agentskin-codex-base'; const old=document.getElementById(id); if(old) old.remove(); const s=document.createElement('style'); s.id=id; s.textContent=${JSON.stringify(themeCss)}; document.head.appendChild(s); document.documentElement.classList.add('agentskin-host-codex'); return document.getElementById(id)!=null; })()`;
  const r1 = await c.send('Runtime.evaluate', { expression: injectCss, returnByValue: true });
  console.log('themeCss=', r1.result?.value);
  // 2) run adapter (self-heals, adds adopted structural sheet). Wrapped in a
  // function scope so the top-level `class AdaptiveMutationObserver` never
  // collides with a prior global declaration.
  const expr = `(() => {\n${adapterSrc}\n})()`;
  const r2 = await c.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r2.exceptionDetails) console.log('ERR', JSON.stringify(r2.exceptionDetails));
  console.log('adapter=', r2.result?.value);
  // 3) verify state (no screenshot)
  const ver = `(() => { const st=getComputedStyle(document.documentElement); const mainEl=document.querySelector('main[class*="MainContentSurface"]')||document.querySelector('main'); return { h: document.documentElement.classList.contains('agentskin-host-codex'), marker: !!window.__agentskin_codex_adapter__, textPrimary: st.getPropertyValue('--text-primary').trim(), adoptedAgentSkinSheets: document.adoptedStyleSheets.filter(s=>{try{return /agentskin-host-codex/i.test(s.cssRules[0]?.cssText||'')}catch{return false}}).length, mainBg: mainEl?getComputedStyle(mainEl).backgroundColor:null }; })()`;
  const r3 = await c.send('Runtime.evaluate', { expression: ver, returnByValue: true });
  console.log('verify=', JSON.stringify(r3.result?.value));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
