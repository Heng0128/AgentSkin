// Probe #10: find which ancestor scope actually (re-)declares the driving token
// by setting it inline !important on each candidate and reading the consumer.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  const CASE = ${JSON.stringify([
    { token:'--bg-bg-input', consumer:'.chat-input-v2-editor-part', scopes:['.messageInputChatInput','.chat-input-v2-container','.messageInputContainer','.solo-lite-chat-panel','.solo-lite-chat-panel-main','.solo-lite-chat-panel-container','.solo-lite-layout','#solo-lite-root'] },
    { token:'--bg-bg-base-secondary', consumer:'.task-list-shadow-bottom', scopes:['.task-list-base','.task-list-scroller','.task-list-body','.task-list','.task-list-wrapper','#solo-lite-root'] },
  ])};
  const read = (sel) => { const el = document.querySelector(sel); if(!el) return null; const cs = getComputedStyle(el); return cs.backgroundColor + ' | ' + cs.backgroundImage; };
  const out = [];
  for (const cse of CASE) {
    const baseline = read(cse.consumer);
    const row = { token: cse.token, consumer: cse.consumer, baseline: baseline.slice(0,60), results: [] };
    for (const scope of cse.scopes) {
      const el = document.querySelector(scope);
      if(!el) { row.results.push({ scope, miss: true }); continue; }
      el.style.setProperty(cse.token, 'rgba(255,0,0,0.9)', 'important');
      void el.offsetHeight;
      const v = read(cse.consumer);
      el.style.removeProperty(cse.token);
      const flipped = v && !v.startsWith(cse.consumer) && (v.includes('255') || v.includes('rgb(255, 0, 0)') || v!==baseline);
      row.results.push({ scope, changed: v !== baseline, val: v ? v.slice(0,60) : null });
    }
    out.push(row);
  }
  return out;
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