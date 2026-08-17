// Decisive check: do custom properties from our injected <style> apply at all?
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
  // 1) does our injected style element exist, and how many rules?
  const our = document.getElementById('agentskin-codex-base');
  out.stylePresent = !!our;
  out.styleRules = our?.sheet?.cssRules?.length ?? -1;
  out.accentDeclared = getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent');
  // 2) inject a probe: known color + custom prop on :root, then read both on the row
  const pid = 'agsk-probe'; document.getElementById(pid)?.remove();
  const ps = document.createElement('style'); ps.id = pid;
  ps.textContent = ':root{ --agsk-probe-accent: #ff0000; } html.agentskin-host-codex [data-app-action-sidebar-thread-selected]{ background: var(--agsk-probe-accent) !important; outline: 3px solid #00ff00 !important; }';
  document.head.appendChild(ps);
  const el = document.querySelector('[data-app-action-sidebar-thread-selected]');
  const cs = el ? getComputedStyle(el) : null;
  out.probeRootVar = getComputedStyle(document.documentElement).getPropertyValue('--agsk-probe-accent');
  out.probeElVar = cs ? cs.getPropertyValue('--agsk-probe-accent') : null;
  out.probeBg = cs ? cs.backgroundColor : null;
  out.probeOutline = cs ? (cs.outlineWidth !== '0px' ? cs.outlineColor : 'none') : null;
  document.getElementById(pid)?.remove();
  // 3) does Codex itself override --agentskin-* or reset vars on :root? scan its stylesheets
  const collisions = [];
  for (const s of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    let txt = '';
    if (s.tagName === 'LINK') { txt = ''; } else { txt = s.textContent || ''; }
    if (/--agentskin-accent/.test(txt)) collisions.push('style#' + s.id);
  }
  out.agentskinAccentOtherDecl = collisions;
  // 4) check order: is our <style> before or after the last app stylesheet that sets :root vars?
  const styles = Array.from(document.querySelectorAll('style'));
  out.ourIndex = styles.indexOf(our);
  out.totalStyles = styles.length;
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
