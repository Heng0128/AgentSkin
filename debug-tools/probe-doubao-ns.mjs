// Probe: is Doubao's dbx namespace still alive, or migrated to semi-color?
// Checks rule-level declarations + deep-scope computed for representative dbx
// tokens (the first pass only checked body computed style; dbx tokens may be
// declared on deeper scopes like #root or html[data-theme]).
const PORT = process.argv[2] || '63551';
const DBX = ['--dbx-bg-base-web','--dbx-bg-base-2','--dbx-bg-float','--dbx-text-primary','--dbx-text-secondary','--dbx-border-color','--dbx-bg-body-web'];
const SEMI = ['--semi-color-bg-0','--semi-color-text-0','--semi-color-primary','--semi-color-border'];
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = `(() => {
    const DBX = ${JSON.stringify(DBX)};
    const SEMI = ${JSON.stringify(SEMI)};
    // 1) rule-level declarations across all readable stylesheets
    const decl = {}; for (const t of [...DBX, ...SEMI]) decl[t] = { rules: 0, selectors: [] };
    for (const sheet of document.styleSheets) {
      try { for (const r of sheet.cssRules) { if (!r.style) continue; for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (decl[p]) { decl[p].rules++; if (decl[p].selectors.length < 3) decl[p].selectors.push(String(r.selectorText || '').slice(0, 60)); } } } } catch {}
    }
    // 2) deep-scope computed
    const scopes = ['html', 'html[data-theme]', 'body', '#root'];
    const comp = {};
    for (const t of [...DBX, ...SEMI]) comp[t] = {};
    for (const sel of scopes) {
      let el = null; try { el = document.querySelector(sel); } catch {}
      if (!el) continue;
      const cs = getComputedStyle(el);
      for (const t of [...DBX, ...SEMI]) { const v = cs.getPropertyValue(t).trim(); if (v) comp[t][sel] = v.slice(0, 30); }
    }
    // 3) count dbx-namespace tokens declared anywhere in all cssText
    let dbxCount = 0, semiCount = 0;
    for (const sheet of document.styleSheets) {
      try { const txt = Array.from(sheet.cssRules).map(r => r.cssText || '').join(' '); dbxCount += (txt.match(/--dbx-[a-zA-Z0-9-]+/g) || []).length; semiCount += (txt.match(/--semi-color-[a-zA-Z0-9-]+/g) || []).length; } catch {}
    }
    return { decl, comp, dbxDeclCount: dbxCount, semiDeclCount: semiCount };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
