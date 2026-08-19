// Probe: rigorous dead-token check for --vscode-selection-background (58510).
// Closes the 3 blind spots of the first probe:
//   1) adoptedStyleSheets (constructed sheets are NOT in document.styleSheets)
//   2) var(--...) CONSUMERS (a declaration not being read doesn't prove no use)
//   3) inline style attributes + element.style
// Plus a full-DOM computed scan (bounded) as the hardest evidence.
const PORT = process.argv[2] || '58510';
const TARGET = '--vscode-selection-background';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = String.raw`(() => {
  const T = '${TARGET}';
  const V = 'var(' + T + ')';
  const res = {};
  // --- 1) adoptedStyleSheets: declarations + consumers ---
  res.adopted = { sheets: document.adoptedStyleSheets.length, declRules: [], consumerRules: [] };
  for (const sheet of document.adoptedStyleSheets) {
    try {
      for (const r of sheet.cssRules) {
        const txt = r.cssText || '';
        if (txt.indexOf(T + ':') >= 0) res.adopted.declRules.push(String(r.selectorText || r.cssRules ? '(group)' : '').slice(0, 70));
        if (txt.indexOf(V) >= 0) res.adopted.consumerRules.push(String(r.selectorText || r.cssRules ? '(group)' : '').slice(0, 70));
      }
    } catch (e) { res.adopted.unreadable = String(e); }
  }
  // --- 2) document.styleSheets: consumers (declarations were already 0) ---
  res.styleSheets = { count: document.styleSheets.length, consumerRules: [], unreadable: 0 };
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        const txt = r.cssText || '';
        if (txt.indexOf(V) >= 0) res.styleSheets.consumerRules.push(String(r.selectorText || '(group)').slice(0, 70));
      }
    } catch { res.styleSheets.unreadable++; }
  }
  // --- 3) inline style attributes + element.style across the DOM (bounded) ---
  let inlineDecls = 0;
  try {
    for (const el of document.querySelectorAll('*')) {
      if (el.style && el.style.getPropertyValue(T)) inlineDecls++;
    }
  } catch (e) { res.inlineError = String(e); }
  res.inlineStyleDecls = inlineDecls;
  // --- 4) full-DOM computed scan (bounded to 1500 nodes for speed) ---
  let computedHits = 0;
  const samples = [];
  try {
    const els = document.querySelectorAll('*');
    const max = Math.min(els.length, 1500);
    for (let i = 0; i < max; i++) {
      const v = getComputedStyle(els[i]).getPropertyValue(T).trim();
      if (v) { computedHits++; if (samples.length < 5) samples.push(els[i].tagName + '.' + String(els[i].className || '').slice(0, 20) + '=' + v.slice(0, 30)); }
    }
  } catch (e) { res.computedError = String(e); }
  res.computed = { scanned: Math.min(document.querySelectorAll('*').length, 1500), hits: computedHits, samples };
  // --- 5) document root / body inline ---
  res.documentInline = {
    html: document.documentElement.style.getPropertyValue(T) || null,
    body: document.body && document.body.style ? document.body.style.getPropertyValue(T) : null,
  };
  return res;
})()`;
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 400));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
