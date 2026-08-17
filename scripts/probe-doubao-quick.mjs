// Reproduce "first composer button → 4 options, only bottom visible".
// Sequence: reset home -> focus input -> click FIRST pill ("快速") -> dump
// popover + each option geometry + ancestry + punched + screenshot.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
const shotArg = argv.find(a => a.startsWith('--shot'));
const SHOT = shotArg ? shotArg.split('=')[1] ?? shotArg.split(' ')[1] : 'doubao-quick.png';
const pillArg = argv.find(a => a.startsWith('--pill'));
const TARGET_TEXT = pillArg ? pillArg.split('=')[1] : '快速';

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => { c.ws.addEventListener('open', res, { once: true }); c.ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) { const m = JSON.parse(raw); if (m.id != null && this.pending.has(m.id)) { const { r } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? r(new Error(m.error.message)) : r(m.result); } }
  send(method, params = {}) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { r: res }); this.ws.send(JSON.stringify({ id, method, params })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 15000); }); }
  close() { try { this.ws.close(); } catch {} }
}

const JS = `(async () => {
  const out = { url: location.href, W: innerWidth, H: innerHeight, TARGET: ${JSON.stringify(TARGET_TEXT)} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height < 4) return false; const cs = getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };
  const fmt = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { cls:(typeof el.className==='string'?el.className:'').split(/\\s+/).filter(Boolean).slice(0,8), id:el.id||'', label:(el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('data-testid')))||'', txt:(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,12), rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], pos:cs.position, z:cs.zIndex, bg:cs.backgroundColor }; };

  // reset to home
  const all = Array.from(document.querySelectorAll('div,li,a,span,button,[role="button"]'));
  for (const el of all) { if (vis(el) && el.childElementCount === 0 && (el.textContent||'').trim() === '新对话') { (el.closest('button,[role="button"],a')||el).click(); break; } }
  await sleep(700);

  // focus composer input
  const input = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
  if (input) { input.focus(); try { input.dispatchEvent(new Event('focus', { bubbles: true })); input.click(); } catch {} await sleep(500); }
  out.hasComposer = !!input;

  // dump pills after focus
  const pills = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis)
    .map((b, idx) => Object.assign({ idx }, fmt(b)))
    .filter(b => b.rect[1] + b.rect[3] > innerHeight * 0.7 && b.rect[0] > 200 && b.rect[3] >= 18 && b.rect[3] <= 80 && b.rect[2] < 180)
    .sort((a,b) => a.rect[0] - b.rect[0]);
  out.pills = pills;

  // click the target pill (by text/label)
  let target = pills.find(p => (p.txt === out.TARGET || (p.label||'').includes(out.TARGET)));
  if (!target) target = pills.find(p => /快速|quick/i.test(p.txt + ' ' + p.label));
  out.targetPill = target;
  if (target) {
    const el = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis)[target.idx];
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, view:window })); el.click(); } catch(e){ out.clickErr=String(e); }
    await sleep(800);
  } else { out.noTarget = true; return out; }

  out.punched = Array.from(document.querySelectorAll('[data-agentskin-punched]')).filter(vis).map(fmt).slice(0, 30);

  // floating layers
  const pops = [];
  const seen = new Set();
  for (const el of Array.from(document.querySelectorAll('body *')).filter(vis)) {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 18) continue;
    if (Math.abs(r.y) > 100000 || Math.abs(r.x) > innerWidth*2) continue;
    const iso = cs.position==='fixed'||cs.position==='absolute';
    const z = parseInt(cs.zIndex||'0',10);
    const optLike = /popover|dropdown|menu|select|option|Item|item|float|Float|list|List|panel|Panel|Option/i.test(el.className||'');
    if (iso && (z>=10 || optLike || (cs.backgroundColor && cs.backgroundColor!=='rgba(0, 0, 0, 0)'))) {
      const key = (el.className||'').toString(); if (seen.has(key)) continue; seen.add(key);
      if (pops.length >= 40) break;
      pops.push(Object.assign({ z, overflow: cs.overflow }, fmt(el)));
    }
  }
  out.popovers = pops;

  // persist a list of option-like ROWS inside the popover for geometry compare
  const rows = Array.from(document.querySelectorAll('body *')).filter(vis).filter(el => {
    const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
    if (r.height < 18 || r.height > 90 || r.width < 60 || r.width > 500) return false;
    if (r.y < innerHeight*0.2) return false;               // real popovers sit in lower half near composer
    const z = parseInt(cs.zIndex||'0',10);
    return cs.position==='fixed'||cs.position==='absolute'||z>=10;
  }).map(fmt).slice(0, 30);
  out.optionRows = rows;
  return out;
})()`;

async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(x => x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url||'')).find(p => /豆包|doubao|chat/i.test(p.title||p.url||''));
  if (!t) { console.log('no page'); return; }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const res = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) console.log('ERR', JSON.stringify(res.exceptionDetails));
  console.log(JSON.stringify(res.result?.value, null, 2));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('\n[shot]', SHOT);
  c.close();
}
run().catch(e => { console.error('FAIL', e.message); process.exit(1); });