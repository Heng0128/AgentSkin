// Probe #12: decisive — does the (0,5,1) transparent rule beat host's editor-part grey?
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  const rule = \`html.agentskin-host-traework .solo-lite .messageInputContainer .messageInputChatInput .chat-input-v2-editor-part{ background: rgba(0,255,0,0.4) !important; }\`;
  const st=document.createElement('style'); st.textContent=rule; document.head.appendChild(st);
  void document.documentElement.offsetHeight;
  const el=document.querySelector('.chat-input-v2-editor-part');
  const res={ before: null, after: getComputedStyle(el).backgroundColor };
  // also test without .solo-lite prefix (old rule) for comparison
  st.remove();
  const st2=document.createElement('style'); st2.textContent=\`html.agentskin-host-traework .chat-input-v2-editor-part{ background: rgba(255,0,0,0.4) !important; }\`; document.head.appendChild(st2);
  void document.documentElement.offsetHeight;
  res.oldRuleOnly=getComputedStyle(el).backgroundColor;
  st2.remove();
  return res;
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});