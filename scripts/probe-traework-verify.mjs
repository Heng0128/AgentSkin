// Probe #6: verify the tokens.css + adapter.mjs fixes by injecting the exact new
// CSS into the live page and reading computed styles for the 3 problem zones.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const CSS = `
html.agentskin-host-traework,
html.agentskin-host-traework .solo-theme{
  --bg-bg-base-default: transparent !important;
  --bg-bg-base-secondary: color-mix(in srgb, var(--agentskin-surface) 45%, transparent) !important;
  --bg-bg-input: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 55%, transparent) !important;
  --bg-bg-overlay-l1: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
  --bg-bg-overlay-l2: color-mix(in srgb, var(--agentskin-accent) 14%, transparent) !important;
  --bg-bg-white: color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 55%, transparent) !important;
  --vscode-icube--bg-bg-overlay-l1: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
}
html.agentskin-host-traework [class*="messageInputPluginToolbarIconWrapper"]{
  background: color-mix(in srgb, var(--agentskin-accent) 10%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--agentskin-accent) 22%, transparent) !important;
  color: var(--agentskin-text) !important;
}
html.agentskin-host-traework [class*="messageInputPluginToolbarIconWrapper"]:hover{
  background: color-mix(in srgb, var(--agentskin-accent) 20%, transparent) !important;
}
html.agentskin-host-traework [class*="messageInputPluginToolbar"]{
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
html.agentskin-host-traework .solo-mobile-compact-btn,
html.agentskin-host-traework .task-list-group-new-btn{
  background: color-mix(in srgb, var(--agentskin-accent) 12%, transparent) !important;
  color: var(--agentskin-text) !important;
}
`;
const JS = `
(() => {
  const style = document.createElement('style');
  style.id = 'agentskin-verify-css';
  style.textContent = ${JSON.stringify(CSS)};
  document.head.appendChild(style);
  const read = (sel) => { const el = document.querySelector(sel); if(!el) return 'NODESEL:'+sel; const cs = getComputedStyle(el); return { sel, bg: cs.backgroundColor, bgImg: cs.backgroundImage, shadow: cs.boxShadow, radius: cs.borderRadius }; };
  return [
    read('.task-list-shadow-bottom'),
    read('.solo-mobile-compact-btn'),
    read('.messageInputPluginToolbarIconWrapper'),
    read('.chat-input-v2-editor-part'),
    read('.chat-input-v2-input-box-editable'),
  ];
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true,awaitPromise:true});
  console.log(JSON.stringify(r.result?.value,null,2));
  if(r.exceptionDetails) console.log('ERR',JSON.stringify(r.exceptionDetails,null,2).slice(0,400));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});