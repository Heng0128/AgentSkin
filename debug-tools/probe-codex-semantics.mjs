// Component-level semantic probe for codex: capture representative elements'
// computed bg / alpha / backdrop-filter / border, and whether the adapter CSS
// matches them. Grouped by semantic role.
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
  const style = (el, label) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      label, tag: el.tagName,
      cls: (typeof el.className==='string'?el.className:(el.getAttribute&&el.getAttribute('class'))||'').replace(/\\s+/g,' ').trim().slice(0,110),
      bg: cs.backgroundColor, color: cs.color,
      back: cs.backdropFilter !== 'none' ? cs.backdropFilter.slice(0,40) : null,
      border: cs.borderStyle!=='none' ? cs.borderColor+' '+cs.borderWidth : 'none',
      radius: cs.borderRadius, w: Math.round(r.width), h: Math.round(r.height)
    };
  };
  const main = document.querySelector('main[class*="MainContentSurface"]') || document.querySelector('main');
  const sidebar = document.querySelector('aside.app-shell-left-panel') || document.querySelector('aside');
  const navSel = document.querySelector('aside a[aria-current="true"], aside [aria-current="true"], aside [class*="selected"]');
  const btn = document.querySelector('button[class*="primary"]');
  const ce = document.querySelector('[contenteditable="true"]') || document.querySelector('textarea');
  const card = document.querySelector('aside a, main [class*="card"], [role="button"], main button[class*="secondary"]');
  const res = {
    mainSurface: style(main, 'main'),
    sidebarRoot: style(sidebar, 'sidebar-aside'),
    sidebarSelected: style(navSel, 'sidebar-selected'),
    primaryBtn: style(btn, 'primary-button'),
    composerSurface: style(ce ? ce.closest('[class*="surface"],[class*="composer"],form,div') : null, 'composer'),
    someCard: style(document.querySelector('main a, main section, main div[class*="panel"], main div[class*="container"]'), 'sample-card'),
  };
  // adapter selector reach
  res.adapterReach = {
    asideNavMatches: !!sidebar && /agentskin/.test(getComputedStyle(sidebar).getPropertyValue('--sidebar-bg') ? 'x':'')
  };
  return res;
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
