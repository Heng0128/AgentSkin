// Probe Doubao composer function-bar buttons: click left->right, capture
// any multi-option popover that appears, dump geometry/ancestry/punch status.
// Usage: node scripts/probe-doubao-popover.mjs <port> [--shot out.png] [--max N]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
const shotArg = argv.find(a => a.startsWith('--shot'));
const SHOT = shotArg ? shotArg.split('=')[1] ?? shotArg.split(' ')[1] : 'doubao-popover.png';
const maxArg = argv.find(a => a.startsWith('--max'));
const MAX = maxArg ? parseInt(maxArg.split('=')[1], 10) : 6;

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('WS open failed')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#onMsg(e.data));
    return c;
  }
  #onMsg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? rej(new Error(m.error.message || JSON.stringify(m.error))) : res(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout:' + method)); } }, 20000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const JS = `(async () => {
  const MAX = ${MAX};
  const out = { url: location.href, W: innerWidth, H: innerHeight };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4) return false;
    const cs = getComputedStyle(el);
    return !(cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0);
  };
  const fmt = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const ari = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('data-testid') || '');
    return {
      cls: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 8),
      id: el.id || '',
      label: ari,
      txt: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 20),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
    };
  };

  // Enter a conversation first if the composer is missing
  if (!document.querySelector('[contenteditable="true"], textarea, [role="textbox"]')) {
    out.wasOnList = true;
    const t = Array.from(document.querySelectorAll('[class*="thread"],[class*="session"],[class*="conversation"],[class*="chat-item"],[role="listitem"]')).filter(vis)[0];
    if (t) { t.click(); await sleep(900); }
  }
  out.probeUrl = location.href;

  // Bottom function bar buttons (below input): icon buttons, left->right
  let bar = Array.from(document.querySelectorAll('button, [role="button"]')).filter(vis)
    .map((b, idx) => Object.assign({ idx }, fmt(b)))
    .filter(b => (b.rect[1] + b.rect[3] > innerHeight * 0.78) && b.rect[0] > 200); // bottom strip, skip sidebar
  bar.sort((a, b) => a.rect[0] - b.rect[0]);
  out.barButtons = bar.slice(0, MAX);

  // Scan current option-like floating layers (pre-click baseline)
  const scanPops = () => {
    const pops = [];
    const seen = new Set();
    for (const el of Array.from(document.querySelectorAll('body *')).filter(vis)) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (Math.min(r.width, r.height) < 18) continue;
      if (Math.abs(r.y) > 100000 || Math.abs(r.x) > innerWidth * 2) continue;
      const iso = cs.position === 'fixed' || cs.position === 'absolute';
      const optLike = /popover|dropdown|menu|select|option|Item|item|float|Float|list|List|panel|Panel|Option/i.test(el.className || '');
      const z = parseInt(cs.zIndex || '0', 10);
      if (iso && (z >= 10 || optLike)) {
        const key = (el.className || '').toString();
        if (seen.has(key)) continue;
        seen.add(key);
        if (pops.length >= 30) break;
        pops.push(Object.assign({ z, overflow: cs.overflow, clip: cs.clipPath, el: el }, fmt(el)));
      }
    }
    return pops;
  };

  out.results = [];
  for (const btn of bar.slice(0, MAX)) {
    const all = Array.from(document.querySelectorAll('button, [role="button"]')).filter(vis);
    const el = all[btn.idx];
    if (!el) continue;
    let fired = null;
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); el.click(); fired = true; } catch (e) { fired = 'ERR:' + e.message; }
    await sleep(650);
    const pops = scanPops().map(p => { const { el: _e, ...rest } = p; return rest; });
    // punch-through inventory after click
    const punched = Array.from(document.querySelectorAll('[data-agentskin-punched]')).filter(vis).map(fmt).slice(0, 20);
    out.results.push({ fired, btn: fmt(el), popovers: pops, punched });
    // close by clicking elsewhere (ESC not reliable)
    try { document.activeElement && document.activeElement.blur(); el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true })); } catch {}
    await sleep(300);
  }
  return out;
})()`;

async function run() {
  const vResp = await fetch(`http://127.0.0.1:${PORT}/json`);
  const targets = await vResp.json();
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''));
  const page = pages.find(p => /豆包|doubao|chat/i.test(p.title || p.url || '')) || pages[0];
  if (!page) { console.log('No page target'); return; }
  console.log('Using page:', page.title);
  const client = await CDP.connect(page.webSocketDebuggerUrl);
  await client.send('Runtime.enable');
  const res = await client.send('Runtime.evaluate', { expression: JS, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) console.log('JS error:', JSON.stringify(res.exceptionDetails, null, 2));
  console.log(JSON.stringify(res.result?.value, null, 2));
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
    console.log('\n[screenshot saved]', SHOT);
  } catch (e) { console.log('\n[screenshot failed]', e.message); }
  client.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });