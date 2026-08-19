// Reverse blind-spot scan v2: only report custom properties whose DECLARED
// VALUE looks like a color (#hex / rgb / hsl / color-mix / var(--agentskin)).
// Filters out layout/size tokens (padding/size/radius/elevation/z-index).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '58510';
const AGENT = process.argv[3] || 'traework';
const TOPN = parseInt(process.argv[4] || '40', 10);

const eng = readFileSync(join(ROOT, 'engines', AGENT, 'tokens.css'), 'utf8');
const gen = readFileSync(join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', AGENT + '.css'), 'utf8');
const our = new Set();
for (const m of eng.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;!]+)/g)) our.add(m[1]);
for (const m of gen.matchAll(/(--[a-zA-Z0-9-]+)\s*:\s*([^;!]+)/g)) our.add(m[1]);

class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},20000);});}
  close(){try{this.ws.close();}catch{}}
}

async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = String.raw`(() => {
    const declared = {}; // name -> { value, selectors: Set }
    let sheetsRead = 0, sheetsFailed = 0;
    for (const sheet of document.styleSheets) {
      sheetsRead++;
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.style) continue;
          for (let i = 0; i < rule.style.length; i++) {
            const p = rule.style[i];
            if (!p.startsWith('--')) continue;
            const val = rule.style.getPropertyValue(p).trim();
            if (!declared[p]) declared[p] = { value: val, count: 0 };
            declared[p].count++;
          }
        }
      } catch { sheetsFailed++; }
    }
    return { declared, sheetsRead, sheetsFailed };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  const v = r.result?.value;
  if (!v) { console.log('NO_RESULT'); return; }
  // color-like value filter
  const COLOR_RE = /^(#|rgb|hsl|oklch|color-mix|var\(--agentskin|transparent|none$)/i;
  const candidates = [];
  for (const [name, info] of Object.entries(v.declared)) {
    if (our.has(name)) continue;
    if (!COLOR_RE.test(info.value)) continue; // skip size/layout tokens
    // skip pure-alpha / rgba-with-low-alpha? keep all, report
    candidates.push({ name, value: info.value.slice(0, 40), count: info.count });
  }
  candidates.sort((a, b) => b.count - a.count);
  console.log(`=== ${AGENT} 反向盲区 v2 (颜色值, port ${PORT}) ===`);
  console.log(`原生颜色声明但未覆盖: ${candidates.length} 个 (sheets ${v.sheetsRead}, failed ${v.sheetsFailed})`);
  console.log(`--- top ${TOPN} (按声明次数) ---`);
  candidates.slice(0, TOPN).forEach(c => console.log(`  [${c.count}] ${c.name} = ${c.value}`));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
