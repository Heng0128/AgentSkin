// Probe #8: live audit of the 3 unresolved zones (sidebar shadow, round thumbs, composer dialog).
// Dumps: agentskin host class present?, real computed styles + matched token chain, list of candidate elements.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const ESC = JSON.stringify;
const JS = `(() => {
  const read = (sel) => {
    const el = document.querySelector(sel);
    if(!el) return { sel, miss: true };
    const cs = getComputedStyle(el);
    return {
      sel,
      cls: (el.className&&typeof el.className==='string')?el.className:'',
      bg: cs.backgroundColor,
      bgImg: cs.backgroundImage,
      shadow: cs.boxShadow,
      border: cs.borderColor + ' w:' + cs.borderWidth,
      radius: cs.borderRadius,
      h: Math.round(el.getBoundingClientRect().height),
      w: Math.round(el.getBoundingClientRect().width),
    };
  };
  // Collect round-thumb / avatar-like small circle elements under the sidebar
  const rounds = [];
  const walkList = (root) => {
    if(!root) return;
    root.querySelectorAll('*').forEach(el=>{
      const r = el.getBoundingClientRect();
      if(r.width<4||r.height<4) return;
      const cs = getComputedStyle(el);
      const rad = parseFloat(cs.borderRadius);
      const isRound = (rad>0 && Math.abs(rad*2 - Math.min(r.width,r.height)) < 3);
      if(!isRound) return;
      const bg = cs.backgroundColor;
      const onlyAlpha = (bg.includes('0, 0, 0, 0') || bg==='rgba(0, 0, 0, 0)');
      if(onlyAlpha) return;
      const cls = (el.className&&typeof el.className==='string')?el.className.trim():'';
      if(!cls) return;
      rounds.push({ cls: cls.slice(0,120), size: Math.round(Math.min(r.width,r.height)), bg, border: cs.borderColor, shadow: cs.boxShadow.slice(0,80) });
    });
  };
  const sidebar = document.querySelector('.task-list') || document.querySelector('[class*="task-list"]') || document.body;
  walkList(sidebar);
  return {
    hostClass: document.documentElement.classList.contains('agentskin-host-traework'),
    hasAgentskinVars: !!getComputedStyle(document.documentElement).getPropertyValue('--agentskin-accent'),
    themeRoot: document.documentElement.getAttribute('data-theme'),
    sidebarShadow: read('.task-list-shadow-bottom'),
    sidePanel: read('.task-list-panel'),
    sideBase: read('.task-list-base'),
    editorPart: read('.chat-input-v2-editor-part'),
    inputBox: read('.chat-input-v2-input-box-editable'),
    chatInputCont: read('.chat-input-v2-container'),
    msgInput: read('.messageInputChatInput'),
    msgInputContainer: read('[class*="messageInputContainer"]'),
    // matched token chain for the composer editor part
    composerChain: (()=>{
      const el=document.querySelector('.chat-input-v2-editor-part'); if(!el) return null;
      const chain=[]; let n=el, g=0;
      while(n&&g++<20){const c=getComputedStyle(n); chain.push({t:n.tagName.toLowerCase(),cls:(typeof n.className==='string'?n.className.slice(0,90):(n.id?'#'+n.id:'')),bgInput:c.getPropertyValue('--bg-bg-input').trim().slice(0,60),dtheme:n.getAttribute&&n.getAttribute('data-theme')});n=n.parentElement;}
      return chain;
    })(),
    // matched token chain for the sidebar shadow
    shadowChain: (()=>{
      const el=document.querySelector('.task-list-shadow-bottom'); if(!el) return null;
      const chain=[]; let n=el, g=0;
      while(n&&g++<20){const c=getComputedStyle(n); chain.push({t:n.tagName.toLowerCase(),cls:(typeof n.className==='string'?n.className.slice(0,90):(n.id?'#'+n.id:'')),sec:c.getPropertyValue('--bg-bg-base-secondary').trim().slice(0,60)});n=n.parentElement;}
      return chain;
    })(),
    rounds: rounds.slice(0, 25),
  };
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  if(!pages.length){console.error('NO PAGES');process.exit(1);}
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});