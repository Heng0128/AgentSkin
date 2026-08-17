// Probe Doubao "first composer button → 4 options but only bottom visible".
// 1) reset to a fresh conversation (click 新对话 nav if present)
// 2) find the FIRST function pill in the composer bar (small icon buttons, x-sorted)
// 3) click it, then dump the popover + each option + ancestry overflow chain + punch status
// Usage: node scripts/probe-doubao-4options.mjs <port> [--shot out.png]
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
const shotArg = argv.find(a => a.startsWith('--shot'));
const SHOT = shotArg ? shotArg.split('=')[1] ?? shotArg.split(' ')[1] : 'doubao-4options.png';

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
    return {
      cls: (typeof el.className === 'string' ? el.className : '').split(/\\s+/).filter(Boolean).slice(0, 8),
      id: el.id || '',
      label: (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('data-testid'))) || '',
      txt: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 12),
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor,
    };
  };

  // ---- reset to a fresh conversation ----
  const newChat = Array.from(document.querySelectorAll('button,[role="button"],[class*="button"]')).filter(vis)
    .find(b => /新对话|新开对话|new chat|创建对话/i.test((b.getAttribute('aria-label')||'') + ' ' + (b.textContent||'')));
  if (newChat) { await (async () => { try { newChat.click(); } catch {} })(); await sleep(700); }
  out.afterResetUrl = location.href;
  out.hasComposer = !!document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');

  // ---- composer function pills: small buttons near the bottom, x-sorted ----
  const pills = Array.from(document.querySelectorAll('button, [role="button"]')).filter(vis)
    .map((b, idx) => Object.assign({ idx }, fmt(b)))
    .filter(b => {
      if (b.rect[1] + b.rect[3] < innerHeight * 0.7) return false;   // bottom strip only
      if (b.rect[0] < 200) return false;                              // skip sidebar
      if (b.rect[3] < 16 || b.rect[3] > 90) return false;             // horizontal pill height
      return true;
    });
  // drop suggestion rows (they are tall text rows, not pills)
  pills.sort((a, b) => a.rect[0] - b.rect[0]);
  out.pills = pills.slice(0, 20);

  const target = pills[0];
  out.firstPill = target;
  if (target) {
    const el = Array.from(document.querySelectorAll('button, [role="button"]')).filter(vis)[target.idx];
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window })); el.click(); } catch (e) { out.clickErr = String(e); }
    await sleep(750);
  } else { out.noPill = true; return out; }

  // ---- punch-thru + floating layers ----
  out.punched = Array.from(document.querySelectorAll('[data-agentskin-punched]')).filter(vis).map(fmt).slice(0, 30);
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
    if (iso && (z >= 10 || optLike || (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)'))) {
      const key = (el.className || '').toString();
      if (seen.has(key)) continue;
      seen.add(key);
      if (pops.length >= 30) break;
      pops.push(Object.assign({ z, overflow: cs.overflow, overflowY: cs.overflowY }, fmt(el)));
    }
  }
  out.popovers = pops;

  // ---- pick the largest newly-visible floating panel as THE popover ----
  const big = pops.filter(p => p.rect[2] >= 100 && p.rect[3] >= 80).sort((a,b) => (b.rect[2]*b.rect[3]) - (a.rect[2]*a.rect[3]))[0];
  out.mainPopover = big;

  // ---- ancestry overflow chain of that panel ----
  if (big) {
    const needle = Array.from(document.querySelectorAll('body *')).filter(vis);
    let rootEl = null;
    for (const el of needle) { const cs = getComputedStyle(el); if ((cs.position === 'fixed' || cs.position === 'absolute') && Math.min(el.getBoundingClientRect().width, el.getBoundingClientRect().height) > 80 && (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseInt(cs.zIndex||0) >= 10)) { rootEl = el; break; } }
    out.rootEl = rootEl ? fmt(rootEl) : null;
    const chain = [];
    for (let el = rootEl ? rootEl.parentElement : null, d = 0; el && d < 8; el = el.parentElement, d++) {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      chain.push({ depth: d, tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').split(/\\s+/)[0] || '', pos: cs.position, z: cs.zIndex, overflow: cs.overflow, overflowY: cs.overflowY, transform: cs.transform.slice(0, 40), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], punched: el.hasAttribute('data-agentskin-punched') });
    }
    out.ancestry = chain;
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