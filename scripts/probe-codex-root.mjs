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
  const our = document.getElementById('agentskin-codex-base');
  const out = {};
  if (!our) return { present: false };
  out.present = true;
  out.ruleCount = our.sheet.cssRules.length;
  out.selectors = Array.from(our.sheet.cssRules).map(r => (r.selectorText || r.cssText || '').split(',')[0].slice(0, 60));
  out.firstRules = Array.from(our.sheet.cssRules).slice(0, 4).map(r => ({ sel: r.selectorText || '(non-cssstyle)', css: (r.cssText || '').slice(0, 160) }));
  out.baseTextFirst3072 = our.textContent.slice(0, 3072);
  // find the :root token rule
  const rootRules = [];
  for (const r of our.sheet.cssRules) { if (/^:root$/i.test(r.selectorText || '')) rootRules.push(r.cssText); }
  out.rootRulesCount = rootRules.length;
  out.rootRulesSample = rootRules.map(x => x.slice(0, 120));
  // Does the rule actually contain the accent declaration?
  const declared = rootRules.filter(x => /--agentskin-accent/.test(x));
  out.accentDeclaredInStyle = declared.length > 0;
  out.rootTextAccent = rootRules.map(x => { const m = x.match(/--agentskin-accent[^;]*/); return m ? m[0] : null; }).filter(Boolean);
  // computed value read three ways
  const cs = getComputedStyle(document.documentElement);
  out.viaGetProperty = cs.getPropertyValue('--agentskin-accent').trim();
  out.viaStyle = '' + (getComputedStyle(document.documentElement).__proto__ ? '' : '');
  // read from the stylesheet declaration directly via CSSOM: priority list
  out.ruleStyleAccent = (() => { for (const r of our.sheet.cssRules) { if (r.selectorText === ':root') return r.style.getPropertyValue('--agentskin-accent'); } return 'NO :root RULE'; })();
  out.hostClassOnHtml = document.documentElement.classList.contains('agentskin-host-codex');
  return out;
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
