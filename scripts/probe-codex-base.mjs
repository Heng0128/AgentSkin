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
  if (!our) return { present: false };
  const isAdopted = !!document.adoptedStyleSheets.find(s => s && Array.from(s.cssRules||[]).some(r => r.cssText && our.textContent && our.textContent.includes(r.cssText.slice(0,40))));
  const fr = our.sheet ? Array.from(our.sheet.cssRules).slice(0,2) : [];
  const out = {
    ruleCount: our.sheet ? our.sheet.cssRules.length : -1,
    firstRuleShort: fr[0] ? fr[0].cssText.slice(0, 220) : null,
    cssTextHasToken: our.textContent.includes('--agentskin-accent'),
    isAdopted,
    baseStyleSheetCount: document.querySelectorAll('style').length,
  };
  // search all cssRules for accent anywhere (declaration OR usage)
  out.accentAnywhere = our.sheet ? Array.from(our.sheet.cssRules).filter(r => /agentskin-accent/.test(r.cssText||'')).length : -1;
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
