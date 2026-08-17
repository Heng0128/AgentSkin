// Probe #3: inspect INLINE styles + matching selectors for the unresolved host-grey elements.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const PORT = process.argv[2] || '56211';
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  const sel = [
    '.solo-mobile-compact-btn',
    '.solo-mobile-compact-btn[disabled]',
    '.messageInputPluginToolbarIconWrapper',
    '.messageInputPluginToolbar',
    '.task-list-shadow-bottom',
    '.task-list-shadow-top',
    '.user-message-navigator__dot--active',
    '.user-message-navigator__dot',
    '.task-list-base-footer',
    '.task-list-group-new-btn',
    '.chat-input-v2-editor-part',
    '.chat-input-v2-container',
    '[class*="chat-input"]'
  ];
  const res = {};
  for (const s of sel) {
    let el = null;
    try { el = document.querySelector(s); } catch {}
    if (!el) { res[s] = { found: false }; continue; }
    const cs = getComputedStyle(el);
    res[s] = {
      found: true,
      inline: (el.getAttribute && el.getAttribute('style')) || '',
      // the winning background as authored source
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage,
      radius: cs.borderRadius,
      classList: Array.from(el.classList),
      parentCls: el.parentElement ? Array.from(el.parentElement.classList) : [],
    };
  }
  // Find rule sources for the round button background via CDP is hard; list all adopted sheets names
  res._adoptedSheets = Array.from(document.adoptedStyleSheets).map(sr => ({ count: sr.cssRules ? sr.cssRules.length : -1, agent: sr.__agentskin || undefined }));
  return res;
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  if(r.exceptionDetails) console.log('ERR:',JSON.stringify(r.exceptionDetails,null,2).slice(0,500));
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});