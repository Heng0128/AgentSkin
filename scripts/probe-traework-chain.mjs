// Probe #7: dump consumer ancestor chains (classes + whether each is a declaration
// point for the driving token) for the two unresolved zones.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  const walk = (sel) => {
    const el = document.querySelector(sel);
    if(!el) return null;
    const chain = [];
    let n = el;
    let guard = 0;
    while (n && guard++ < 24) {
      const cs = getComputedStyle(n);
      chain.push({
        tag: n.tagName.toLowerCase(),
        cls: (n.className && typeof n.className === 'string') ? n.className : (n.id ? ('#'+n.id) : ''),
        hasDataTheme: n.getAttribute ? n.getAttribute('data-theme') : null,
        ingress: cs.getPropertyValue('--bg-bg-input').trim(),
        secondary: cs.getPropertyValue('--bg-bg-base-secondary').trim(),
        overlay1: cs.getPropertyValue('--bg-bg-overlay-l1').trim(),
      });
      n = n.parentElement;
    }
    return chain;
  };
  return {
    editorPart: walk('.chat-input-v2-editor-part'),
    shadowBottom: walk('.task-list-shadow-bottom'),
  };
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});