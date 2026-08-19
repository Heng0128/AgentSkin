// Probe: deep-scope + rule-level check for traework selection tokens (58510).
// Follows debug-tools/INDEX.md convention (reusable probe asset).
const PORT = process.argv[2] || '58510';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = String.raw`(() => {
  const T = ['--vscode-selection-background', '--vscode-editor-selectionBackground', '--vscode-editor-selectionHighlightBackground'];
  const res = {};
  // 1) stylesheet rule-level declarations (alive = any rule declares it)
  const ruleHits = {}; T.forEach(t => ruleHits[t] = []);
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        if (!r.style) continue;
        for (let i = 0; i < r.style.length; i++) {
          const p = r.style[i];
          if (ruleHits[p]) ruleHits[p].push(String(r.selectorText || '').slice(0, 70));
        }
      }
    } catch {}
  }
  res.rules = ruleHits;
  // 2) deep-scope computed values
  const scopes = ['.solo-theme', 'body', 'html[data-theme]', '#root', '#solo-lite-root', '.monaco-editor', '.solo-lite'];
  res.scopes = {};
  for (const sel of scopes) {
    let el = null; try { el = document.querySelector(sel); } catch {}
    if (!el) continue;
    const cs = getComputedStyle(el);
    const vals = {};
    for (const t of T) { const v = cs.getPropertyValue(t).trim(); if (v) vals[t] = v.slice(0, 40); }
    res.scopes[sel] = vals;
  }
  return res;
})()`;
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
