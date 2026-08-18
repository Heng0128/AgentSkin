// Probe: dump message-bubble / message block elements currently in the page,
// including box-shadow, border, border-radius and background, so we can see
// which rule the adapter/theme generator misses for the "bubble ring".
const PORT = process.argv[2] || '65222';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},12000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = [
  "(() => {",
  "  const out = [];",
  "  const seen = new Set();",
  "  const SELECTORS = ['[class*=\"message\"]','[class*=\"Message\"]','[class*=\"bubble\"]','[class*=\"Bubble\"]','[class*=\"chat\"]','[class*=\"user-message\"]','[class*=\"assistant\"]','[class*=\"msg\"]', '[class*=\"content\"]'];",
  "  const all = document.querySelectorAll('*');",
  "  for (const el of all) {",
  "    const cls = String(el.className || '');",
  "    if (!/message|msg|bubble|user-message|assistant|chat-bubble/i.test(cls)) continue;",
  "    if (seen.has(cls)) continue; seen.add(cls);",
  "    const cs = getComputedStyle(el);",
  "    out.push({ cls: cls.slice(0,80), boxShadow: cs.boxShadow.slice(0,120), border: cs.border.slice(0,60), radius: cs.borderRadius.slice(0,40), bg: cs.backgroundImage !== 'none' ? 'img' : (cs.backgroundColor.slice(0,40)) });",
  "  }",
  "  return out;",
  "})()",
].join('\n');
async function scan(wsUrl){
  const c=await CDP.connect(wsUrl); await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  c.close(); return r.result?.value||[];
}
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  for (const t of pages){
    let res; try{res=await scan(t.webSocketDebuggerUrl);}catch(e){continue;}
    if(res.length){ console.log('== '+(t.title||'').slice(0,40)); console.log(JSON.stringify(res,null,2)); }
  }
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});