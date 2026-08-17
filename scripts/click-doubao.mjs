// Real-mouse click a doubao element by aria-label OR CSS selector, then
// screenshot + dump floating layers + punched inventory.
// Usage: node scripts/click-doubao.mjs <port> --label skill_bar_button_more --shot x.png
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
const label = argv.find(a => a.startsWith('--label'))?.split('=')[1];
const shotArg = argv.find(a => a.startsWith('--shot'));
const SHOT = shotArg ? shotArg.split('=')[1] ?? shotArg.split(' ')[1] : 'doubao-click.png';

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
  const out = { url: location.href, W: innerWidth, H: innerHeight, label: ${JSON.stringify(label || '')} };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height < 4) return false; const cs = getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };
  const fmt = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { cls:(typeof el.className==='string'?el.className:'').split(/\\s+/).filter(Boolean).slice(0,8), id:el.id||'', label:(el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('data-testid')))||'', txt:(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,14), rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], pos:cs.position, z:cs.zIndex, bg:cs.backgroundColor }; };

  // find target by aria-label/data-testid (prefer), else text
  const all = Array.from(document.querySelectorAll('button,[role="button"]')).filter(vis)
    .map((b, idx) => Object.assign({ idx, el: b }, fmt(b)));
  let tgt = null;
  if (label) tgt = all.find(b => (b.label||'').includes(label)) || all.find(b => b.txt === label);
  if (!tgt) { out.noneFound = true; tgt = all[0]; }
  out.found = tgt ? fmt(tgt.el) : null;
  if (tgt) {
    const r = tgt.el.getBoundingClientRect();
    out.clickAt = { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    return Object.assign(out, { __coord: out.clickAt });
  }
  return out;
})()`;

async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter(x => x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url||'')).find(p => /豆包|doubao|chat/i.test(p.title||p.url||''));
  if (!t) { console.log('no page'); return; }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('Page.enable');
  const res = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true, awaitPromise: true });
  if (res.exceptionDetails) console.log('EVAL ERR', JSON.stringify(res.exceptionDetails));
  const v = res.result?.value || {};
  if (!v.__coord) { console.log(JSON.stringify(v, null, 2)); c.close(); return; }
  const { x, y } = v.__coord;
  console.log('Real clicking at', x, y, '| label:', label, found = v.found);
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await new Promise(r => setTimeout(r, 800));

  const JS2 = `(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height<4) return false; const cs=getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };
    const fmt = (el) => { const r=el.getBoundingClientRect(); const cs=getComputedStyle(el); return { cls:(typeof el.className==='string'?el.className:'').split(/\\s+/).filter(Boolean).slice(0,8), id:el.id||'', label:(el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('data-testid')))||'', txt:(el.textContent||'').trim().replace(/\\s+/g,' ').slice(0,14), rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], pos:cs.position, z:cs.zIndex, bg:cs.backgroundColor }; };
    const punched = Array.from(document.querySelectorAll('[data-agentskin-punched]')).filter(vis).map(fmt).slice(0,30);
    const pops=[]; const seen=new Set();
    for (const el of Array.from(document.querySelectorAll('body *')).filter(vis)) {
      const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
      if (Math.min(r.width,r.height)<18) continue; if (Math.abs(r.y)>100000||Math.abs(r.x)>innerWidth*2) continue;
      const iso=cs.position==='fixed'||cs.position==='absolute'; const z=parseInt(cs.zIndex||'0',10);
      const optLike=/popover|dropdown|menu|select|option|Item|item|float|Float|list|List|panel|Panel|Option/i.test(el.className||'');
      if (iso && (z>=10||optLike||(cs.backgroundColor&&cs.backgroundColor!=='rgba(0, 0, 0, 0)'))) {
        const k=(el.className||'').toString(); if (seen.has(k)) continue; seen.add(k);
        if (pops.length>=40) break;
        pops.push(Object.assign({ z, overflow: cs.overflow }, fmt(el)));
      }
    }
    return { punched, popovers: pops };
  })()`;
  const r2 = await c.send('Runtime.evaluate', { expression: JS2, returnByValue: true });
  console.log(JSON.stringify({ punched: r2.result?.value?.punched, popovers: r2.result?.value?.popovers }, null, 2));
  const shot = await c.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(shot.data, 'base64'));
  console.log('\n[shot]', SHOT);
  c.close();
}
run().catch(e => { console.error('FAIL', e.message); process.exit(1); });