// Diagnose why the selected row did NOT get accent emphasis after clean replay.
// Inspect the DIV[data-app-action-sidebar-thread-selected]:
//  - does our injected rule match it (scoped + unscoped)? which selectors?
//  - does --agentskin-accent resolve on it / on :root?
//  - what background pull from getComputedStyle, and what cascade wins.
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
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const accentRoot = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent').trim();
  const accentEl = cs.getPropertyValue('--agentskin-accent').trim();
  // selectors to test
  const sels = {
    scopedDiv: 'html.agentskin-host-codex [data-app-action-sidebar-thread-selected]',
    scopedA: 'html.agentskin-host-codex button.sidebar-item[data-app-action-sidebar-thread-selected]',
  };
  const matches = {};
  for (const [k, sel] of Object.entries(sels)) { try { matches[k] = el.matches(sel); } catch { matches[k] = 'ERR'; } }
  // walk up to find nearest <ul>/<nav>/<aside>/<main> ancestry for context
  const chain = [];
  let n = el; let depth = 0;
  while (n && depth < 5) { chain.push((n.tagName||'').toLowerCase() + '.' + (n.className ? String(n.className).split(' ').slice(0,2).join('.') : '')); n = n.parentElement; depth++; }
  // which cssRules in our style match and their order
  const our = document.getElementById('agentskin-codex-base');
  let matchedRules = [];
  if (our) { for (const r of our.sheet ? our.sheet.cssRules : []) { let hit = false; try { hit = r.selectorText && el.matches(r.selectorText); } catch {} if (hit) matchedRules.push(r.selectorText + ' :: ' + r.style.background); } }
  return {
    found: true,
    el: el.tagName + '.' + (el.className ? String(el.className).split(' ').slice(0,4).join('.') : ''),
    chain,
    accentRoot, accentEl,
    bgComputed: cs.backgroundColor,
    bgProperty: cs.getPropertyValue('background-color').trim(),
    boxShadow: cs.boxShadow.slice(0, 50),
    inlineStyleBg: el.style.getPropertyValue('background-color'),
    matches,
    matchedRules,
    profile: el.getAttribute('data-app-action-sidebar-thread-selected'),
    hasAria: el.hasAttribute('aria-current'),
  };
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
