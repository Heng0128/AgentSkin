// Verify (fixed scope): inject aurora-glass workbuddy.css into the RUNNING
// WorkBuddy. The host selector is body[data-application-name="workbuddy"] —
// NOT an html class. Read computed vars from BODY after injection.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '50489';
const THEME_CSS_PATH = join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'workbuddy.css');

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
    const id = 'agentskin-workbuddy-verify';
    const old = document.getElementById(id); if (old) old.remove();
    const s = document.createElement('style'); s.id = id; s.textContent = css;
    document.head.appendChild(s);
    // WorkBuddy host selector lives on BODY[data-application-name="workbuddy"]
    const b = document.body;
    const attrs = {}; for (const a of b.attributes) attrs[a.name] = a.value;
    const cs = getComputedStyle(b);
    const rd = (t) => cs.getPropertyValue(t).trim().slice(0, 44) || null;
    return {
      bodyAttrs: attrs,
      wbBase: { accent: rd('--wb-accent'), surface: rd('--wb-surface'), text: rd('--wb-text') },
      cbNative: {
        bgPrimary: rd('--cb-bg-primary'),
        textPrimary: rd('--cb-text-primary'),
        textLink: rd('--cb-text-link'),
        vscodeBg: rd('--cb-vscode-editor-background'),
      },
    };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
