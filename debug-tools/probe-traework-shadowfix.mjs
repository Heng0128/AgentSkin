// Verify the 3 native gradient shadow-bands in TraeWork are cleared after
// injecting the generated theme CSS (which now includes the task-list-shadow
// rule from native-defect-fixes.mjs single source):
//   1) .task-list-shadow-bottom (sidebar task list bottom band, rgb(38,38,38))
//   2) .user-message-navigator__mask--top
//   3) .user-message-navigator__mask--bottom
// Inject full aurora-glass traework.css via adoptedStyleSheets (mirrors engine
// Layer-3 path) then re-read computed backgroundImage of each shadow element.
// Reusable debug asset per debug-tools/INDEX.md.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = process.argv[2] || '58510';
const THEME_CSS_PATH = join(ROOT, 'themes', 'aurora-glass', 'assets', 'css', 'traework.css');
const HOST_CLASS = 'agentskin-host-traework';

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
  // inject theme CSS via adoptedStyleSheets (Layer-3 path) + host class
  const js = `(() => {
    const css = ${JSON.stringify(css)};
    const id = 'agentskin-traework-verify';
    const old = document.getElementById(id); if (old) old.remove();
    const s = document.createElement('style'); s.id = id; s.textContent = css;
    document.head.appendChild(s);
    document.documentElement.classList.add('${HOST_CLASS}');
    const rd = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { found: false, sel };
      const cs = getComputedStyle(el);
      return { found: true, sel, bgImage: cs.backgroundImage.slice(0, 80), bg: cs.backgroundColor.slice(0, 40) };
    };
    return {
      hostClass: document.documentElement.classList.contains('${HOST_CLASS}'),
      hasTaskListRule: css.indexOf('task-list-shadow-bottom') >= 0,
      shadows: {
        taskListBottom: rd('.task-list-shadow-bottom'),
        navMaskTop: rd('[class*="user-message-navigator__mask--top"]'),
        navMaskBottom: rd('[class*="user-message-navigator__mask--bottom"]'),
      },
    };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
