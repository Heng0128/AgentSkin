// Probe #5: confirm which scope declares the --bg-bg-* tokens driving the 3 zones.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const TOKENS = ['--bg-bg-input','--bg-bg-base-secondary','--bg-bg-overlay-l1','--bg-bg-white','--bg-bg-overlay-l2','--bg-bg-base-default','--vscode-icube--bg-bg-overlay-l1'];
const JS = `(() => {
  const scopes = ['.solo-theme', '.monaco-workbench', 'body', 'html[data-theme]', 'html.agentskin-host-traework', '#root'];
  const res = { tok: {}, scopes: {} };
  const T = ${JSON.stringify(TOKENS)};
  for (const sel of scopes) {
    let el=null; try { el=document.querySelector(sel); } catch {}
    if(!el) { res.scopes[sel]={present:false}; continue; }
    const cs=getComputedStyle(el);
    const vals={};
    for (const t of T) vals[t]=cs.getPropertyValue(t).trim() || null;
    res.scopes[sel]={present:true, cls:(el.className&&typeof el.className==='string')?el.className:'', dataTheme: el.getAttribute('data-theme'), vals};
  }
  // For each token, find an element that CSS-declares it as own (not inherited): scan .solo-theme subtree heads
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