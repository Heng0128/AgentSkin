// Probe: verify which of the 50 Trae-Skin icube/vscode tokens (blind spots in
// OUR traework engine) actually exist in the RUNNING TraeWork (58510).
// If they exist natively, we should add them; if not, Trae-Skin injected them
// as its own vars (no-op for us).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '58510';
const REF_PATH = join(ROOT, 'agents-run-now', 'trae-skin-ref.css');

const css = readFileSync(REF_PATH, 'utf8');
const eng = readFileSync(join(ROOT, 'engines', 'traework', 'tokens.css'), 'utf8');
const gen = readFileSync(join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'traework.css'), 'utf8');
const tsSet = new Set([...css.matchAll(/(--vscode[a-zA-Z0-9-]*):/g)].map(m => m[1]));
const ourSet = new Set([...eng.matchAll(/(--vscode[a-zA-Z0-9-]*):/g)].map(m => m[1]));
for (const m of gen.matchAll(/(--vscode[a-zA-Z0-9-]*):/g)) ourSet.add(m[1]);
const missing = [...tsSet].filter(t => !ourSet.has(t));

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
  const T = JSON.stringify(missing);
  const js = `(() => {
    const T = ${T};
    const scopes = ['html[data-theme]', 'body', '.solo-theme', '#root', '.monaco-workbench'];
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
    const exists = T.filter(t => found[t].count > 0);
    const absent = T.filter(t => found[t].count === 0);
    return { total: T.length, exists: exists.length, absent: absent.length, existsList: exists, sample: Object.fromEntries(exists.slice(0, 10).map(t => [t, found[t].samples[0]])) };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  const v = r.result?.value;
  console.log('盲区总数:', v.total, '| 原生存在(值得补):', v.exists, '| 原生不存在(no-op):', v.absent);
  console.log('--- 存在的盲区 ---');
  v.existsList.forEach(t => console.log('  ', t));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
