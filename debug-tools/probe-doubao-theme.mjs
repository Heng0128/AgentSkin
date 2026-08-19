// Verify: inject aurora-glass doubao.css into the RUNNING Doubao (63551) and
// confirm the Semi Design layer (--semi-color-*, the live primary visual) gets
// themed. The dbx namespace is mostly deprecated in the current build (rule
// decls: dbx≈49 vs semi≈1498), so we verify semi theming actually applies.
// Mirrors engine Layer-3 path. Reusable debug asset.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '63551';
const THEME_CSS_PATH = join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'doubao.css');
const HOST_CLASS = 'agentskin-host-doubao';

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
  const css = readFileSync(THEME_CSS_PATH, 'utf8');
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = `(() => {
    const css = ${JSON.stringify(css)};
    const id = 'agentskin-doubao-verify';
    const old = document.getElementById(id); if (old) old.remove();
    const s = document.createElement('style'); s.id = id; s.textContent = css;
    document.head.appendChild(s);
    document.documentElement.classList.add('${HOST_CLASS}');
    const cs = getComputedStyle(document.body);
    const rd = (t) => cs.getPropertyValue(t).trim().slice(0, 50) || null;
    return {
      hostClass: document.documentElement.classList.contains('${HOST_CLASS}'),
      semi: {
        bg0: rd('--semi-color-bg-0'), bg1: rd('--semi-color-bg-1'), bg2: rd('--semi-color-bg-2'),
        text0: rd('--semi-color-text-0'), text1: rd('--semi-color-text-1'), text2: rd('--semi-color-text-2'),
        primary: rd('--semi-color-primary'), primaryHover: rd('--semi-color-primary-hover'),
        border: rd('--semi-color-border'), fill0: rd('--semi-color-fill-0'),
        link: rd('--semi-color-link'), focusBorder: rd('--semi-color-focus-border'),
        navBg: rd('--semi-color-nav-bg'),
      },
      dbx: {
        bodyWeb: rd('--dbx-bg-body-web'), base2: rd('--dbx-bg-base-2'), float: rd('--dbx-bg-float'),
      },
    };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
