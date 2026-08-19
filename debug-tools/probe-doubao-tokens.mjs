// Probe: verify which theme-layer tokens actually exist in the RUNNING Doubao.
// Lightweight: queries the generated theme's --dbx-*/--semi-*/--s-*/--ffc-*
// tokens via getComputedStyle on a few scopes — far smaller than the full
// extract that times out on Doubao's webview renderer. Reusable debug asset.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '63551';
const THEME_CSS_PATH = join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'doubao.css');

const css = readFileSync(THEME_CSS_PATH, 'utf8');
const gen = [...new Set([...css.matchAll(/(--(?:dbx|semi|s|ffc|agentskin|color)-[a-zA-Z0-9-]*):/g)].map(m => m[1]))];

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
  const T = JSON.stringify(gen);
  const js = `(() => {
    const T = ${T};
    const scopes = ['html', 'body', '#root', 'html[data-theme]'];
    const found = {}; for (const t of T) found[t] = { count: 0, samples: [] };
    for (const sel of scopes) {
      let el = null; try { el = document.querySelector(sel); } catch {}
      if (!el) continue;
      const cs = getComputedStyle(el);
      for (const t of T) {
        const v = cs.getPropertyValue(t).trim();
        if (v) { found[t].count++; if (found[t].samples.length < 2) found[t].samples.push(sel + '=' + v.slice(0, 30)); }
      }
    }
    const missing = T.filter(t => found[t].count === 0);
    const present = T.filter(t => found[t].count > 0);
    return { total: T.length, present: present.length, missing: missing.length, missingList: missing.slice(0, 40), sample: Object.fromEntries(present.slice(0, 12).map(t => [t, found[t].samples[0]])) };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
