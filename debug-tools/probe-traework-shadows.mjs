// Probe: shadow + gradient-mask + known-defect-region sweep for TraeWork (58510).
// box-shadow is rare in the current viewport (1 hit), so also scan:
//   - background-image gradients (fade masks / shadow bands)
//   - known native-defect selector regions (bubbles, navigator mask, task list)
//   - which app regions are actually rendered right now
const PORT = process.argv[2] || '58510';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = String.raw`(() => {
  const out = { gradientMasks: [], shadowHits: [], defectRegions: {}, rendered: [] };
  // 1) gradients that look like masks/shadow-bands (linear-gradient on backgrounds)
  const els = document.querySelectorAll('*');
  const max = Math.min(els.length, 4000);
  for (let i = 0; i < max; i++) {
    const el = els[i];
    const cs = getComputedStyle(el);
    const bg = cs.backgroundImage;
    if (bg && bg.indexOf('gradient') >= 0) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 10 && rect.height > 4 && rect.bottom > 0 && rect.top < innerHeight && out.gradientMasks.length < 25) {
        out.gradientMasks.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), bg: bg.slice(0, 100), w: Math.round(rect.width), h: Math.round(rect.height), pos: Math.round(rect.top) + ',' + Math.round(rect.left) });
      }
    }
    const sh = cs.boxShadow;
    if (sh && sh !== 'none' && out.shadowHits.length < 15) {
      out.shadowHits.push({ tag: el.tagName.toLowerCase(), cls: String(el.className || '').slice(0, 80), sh: sh.slice(0, 100) });
    }
  }
  // 2) known native-defect selectors — do they exist now?
  const defSel = {
    'bubble': '[class*="message-bubble"], [class*="messageBubble"], [class*="msg-bubble"], [class*="bubble"]',
    'navigator-mask': '[class*="user-message-navigator__mask"], [class*="navigator-mask"]',
    'task-list': '[class*="task-list"]',
    'composer': '[class*="chat-input-v2"], [class*="composer"]',
    'message-content': '[class*="message-content"], [class*="msg-content"]',
  };
  for (const k in defSel) {
    let n = 0; try { n = document.querySelectorAll(defSel[k]).length; } catch {}
    out.defectRegions[k] = n;
  }
  // 3) what app regions are visible (top-level landmarks)
  const landmarks = ['main', 'aside', 'nav', '#root > div', '.solo-lite', '[class*="sidebar"]', '[class*="activitybar"]', '[class*="chat"]'];
  for (const s of landmarks) {
    let el = null; try { el = document.querySelector(s); } catch {}
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.width > 50 && r.height > 50) out.rendered.push(s + ' (' + Math.round(r.width) + 'x' + Math.round(r.height) + ')');
    }
  }
  out.scanned = max;
  return out;
})()`;
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  const v = r.result?.value;
  if (!v) { console.log('NO_RESULT'); return; }
  console.log('scanned:', v.scanned);
  console.log('--- 渲染区域 ---'); v.rendered.forEach(x => console.log('  ', x));
  console.log('--- 缺陷选择器命中 ---'); console.log(JSON.stringify(v.defectRegions));
  console.log('--- 渐变遮罩样本 ---'); for (const g of v.gradientMasks) console.log(`[${g.tag}] ${g.pos} ${g.w}x${g.h} cls="${g.cls}" bg=${g.bg}`);
  console.log('--- box-shadow 命中 ---'); for (const s of v.shadowHits) console.log(`[${s.tag}] cls="${s.cls}" sh=${s.sh}`);
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
