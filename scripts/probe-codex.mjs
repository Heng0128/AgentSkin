// Probe running Codex (58554): screenshot + token/computed diagnostics.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
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
      }, 20000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
const JS = `(() => {
  const root = getComputedStyle(document.documentElement);
  const axes = ['--text-primary','--text-secondary','--text-tertiary','--bg-primary','--bg-secondary','--bg-tertiary','--bg-quaternary','--border-subtle','--border-medium','--brand-gradient','--brand-text'];
  const vars = {};
  for (const v of axes) vars[v] = root.getPropertyValue(v).trim();
  const capture = (el, label) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { label, tag: el.tagName, cls: (typeof el.className==='string'?el.className:(el.getAttribute&&el.getAttribute('class'))||'').slice(0,120), bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, w: Math.round(r.width), h: Math.round(r.height) };
  };
  const out = {
    agentHosted: document.documentElement.classList.contains('agentskin-host-codex'),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    vars,
    nodes: [
      capture(document.querySelector('aside.app-shell-left-panel'), 'sidebar'),
      capture(document.querySelector('main[class*="MainContentSurface"]') || document.querySelector('main'), 'main-surface'),
    ]
  };
  // count agentskin injected styles
  out.agentskinStyles = Array.from(document.querySelectorAll('style')).filter(s=>/agentskin/i.test(s.textContent||'')).length;
  return out;
})()`;
const JS2 = `(() => {
  // detect host marker + constructable stylesheets in addition to <style> tags
  const hits = (text) => /agentskin/i.test(text || '');
  const styleTags = Array.from(document.querySelectorAll('style')).filter(s => hits(s.textContent)).map(s => s.id || '(no-id)');
  let adopted = 0;
  try { if (document.adoptedStyleSheets) adopted = document.adoptedStyleSheets.filter(s => { try { return hits(s.cssRules[0]?.cssText); } catch { return false; } }).length; } catch {}
  const html = document.documentElement;
  return {
    url: location.href,
    hostOnHtml: html.classList.contains('agentskin-host-codex'),
    hostOnBody: document.body && document.body.classList.contains('agentskin-host-codex'),
    anyHostClass: Array.from(html.classList).filter(c=>/agentskin/i.test(c)),
    styleTags, adopted, totalHtmlClassLen: html.className.length
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
    const r2 = await c.send('Runtime.evaluate', { expression: JS2, returnByValue: true });
    console.log('\n===== TARGET', i, 'URL=', t.url, 'TITLE=', t.title);
    console.log('DIAG=', JSON.stringify(r2.result?.value));
    if (t === list[0]) console.log('MAIN=', JSON.stringify(r.result?.value));
    if (t === list[0] && process.argv[3] === 'shot') {
      const shot = await c.send('Page.captureScreenshot', { format: 'png' });
      const p = join(ROOT, 'codex-probe.png');
      writeFileSync(p, Buffer.from(shot.data, 'base64'));
      console.log('screenshot=', p);
    }
    c.close();
  }
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
