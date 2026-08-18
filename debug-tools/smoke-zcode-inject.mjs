// Smoke: inject the standard theme into the RUNNING zcode via the engine path
// (theme asset CSS + engines/zcode/adapter.mjs) and verify the CV-06/CV-07
// semantic anchors `data-agentskin-sidebar` / `data-agentskin-composer` actually
// land on the DOM — exercising the applySemanticAnchors() activation fix.
//
// Usage: node debug-tools/smoke-zcode-inject.mjs [port]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '64293';
const ADAPTER_PATH = join(ROOT, 'engines', 'zcode', 'adapter.mjs');
const THEME_CSS_PATH = join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'zcode.css');
const HOST_CLASS = 'agentskin-host-zcode';
const MARKER = '__agentskin_zcode_adapter__';

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
      c.ws.addEventListener('error', () => rej(new Error('ws connect')), { once: true });
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
    try { this.ws.close(); } catch {}
  }
}

async function run() {
  const raw = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const list = raw.filter(
    (x) => x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
  );
  const main = list.find((p) => !/avatar-overlay/.test(p.url || '')) || list[0];
  if (!main) {
    console.log('NO_PAGE');
    return;
  }

  const themeCss = readFileSync(THEME_CSS_PATH, 'utf8');
  const adapterSrc = readFileSync(ADAPTER_PATH, 'utf8');
  const c = await CDP.connect(main.webSocketDebuggerUrl);
  await c.send('Runtime.enable');

  // 1) inject theme CSS
  const injectCss = `(() => { const id='agentskin-zcode-base'; const old=document.getElementById(id); if(old) old.remove(); const s=document.createElement('style'); s.id=id; s.textContent=${JSON.stringify(themeCss)}; document.head.appendChild(s); document.documentElement.classList.add('${HOST_CLASS}'); return document.getElementById(id)!=null; })()`;
  const r1 = await c.send('Runtime.evaluate', { expression: injectCss, returnByValue: true });
  console.log('themeCss_injected =', r1.result?.value);

  // 2) run adapter — the activation fix must set the semantic anchors
  const expr = `(() => {\n${adapterSrc}\n})()`;
  const r2 = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r2.exceptionDetails) console.log('ADAPTER_ERR', JSON.stringify(r2.exceptionDetails).slice(0, 500));
  console.log('adapter_applied =', r2.result?.value);

  // 3) verify: host class, marker, semantic anchors actually present on DOM
  const ver = `(() => {
    const sidebar = document.querySelector('[data-agentskin-sidebar]');
    const composer = document.querySelector('[data-agentskin-composer]');
    const sheets = document.adoptedStyleSheets.filter(s => { try { return /agentskin-host-zcode/i.test(s.cssRules[0]?.cssText || ''); } catch { return false; } }).length;
    const sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundColor : null;
    return {
      hostClass: document.documentElement.classList.contains('${HOST_CLASS}'),
      marker: !!window['${MARKER}'],
      sidebarAttr: !!sidebar,
      composerAttr: !!composer,
      sidebarTag: sidebar ? sidebar.tagName : null,
      composerTag: composer ? composer.tagName : null,
      sidebarBg,
      adoptedEngineSheets: sheets,
    };
  })()`;
  const r3 = await c.send('Runtime.evaluate', { expression: ver, returnByValue: true });
  console.log('verify =', JSON.stringify(r3.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('SMOKE_FAIL', e.message);
  process.exit(1);
});