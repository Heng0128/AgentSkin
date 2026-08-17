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
  const out = {};
  // 1) all agent markers on window (who is injecting?)
  out.markers = Object.keys(window).filter(k => /agentskin/i.test(k) && typeof window[k] === 'object').map(k => k + ':' + (Object.keys(window[k]||{}).join(',')));
  // 2) does CSSOM parse :root for base? list rules again but ALSO count token rules via text
  const our = document.getElementById('agentskin-codex-base');
  if (our) {
    out.baseRootRules = Array.from(our.sheet.cssRules).filter(r => /^:root$/i.test(r.selectorText||'')).length;
    out.baseTotal = our.sheet.cssRules.length;
    // is it an authoritative override that references :root in adopted sheets?
  }
  // 3) The mystery style agent-skin-theme-style-codex — which layer/owner?
  const td = document.getElementById('agentskin-theme-style-codex');
  out.themeStyleModal = td ? { len: (td.textContent||'').length, head: (td.textContent||'').slice(0,80) } : null;
  // 4) adopted stylesheets agentskin?
  out.adopted = Array.from(document.adoptedStyleSheets).map(s => ({ agent: !!s.__agentskin, layer: s.__agentskin_layer, rules: s.cssRules ? s.cssRules.length : -1 }));
  // 5) CRITICAL: does ANY agent sheet declare :root accent? scan all adopted + base cssRules for --agentskin-accent decl in a :root rule
  const accentOwners = [];
  const scanSheet = (label, sheet) => { if (!sheet || !sheet.cssRules) return; for (const r of sheet.cssRules) { if (r.cssText && /--agentskin-accent\\s*:/.test(r.cssText)) accentOwners.push(label + ' :: ' + r.cssText.replace(/\\s+/g,' ').slice(0,90)); } };
  scanSheet('base', our ? our.sheet : null);
  document.adoptedStyleSheets.forEach((s,i)=>scanSheet('adopted#'+i, s));
  out.accentOwners = accentOwners;
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
