// Probe: enumerate every CDP target and scan each for message-bubble / avatar
// ring style elements that still carry a box-shadow. Finds the "bubble ring"
// the user reports is not removed, across sub-windows / iframes / webviews.
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
  "  const all = document.querySelectorAll('*');",
  "  for (const el of all) {",
  "    const cs = getComputedStyle(el);",
  "    const sh = cs.boxShadow;",
  "    const r = Math.round(el.getBoundingClientRect().width), s = Math.round(el.getBoundingClientRect().height);",
  "    const cls = String(el.className || '');",
  "    const bubbleLike = /message|msg|bubble|chat|avatar|assistant|user-message|reply|card/i.test(cls);",
  "    if ((sh && sh !== 'none') && bubbleLike) {",
  "      if (seen.has(cls)) continue; seen.add(cls);",
  "      out.push({ tag: el.tagName, cls: cls.slice(0,80), boxShadow: sh.slice(0,120), w:r, h:s });",
  "    }",
  "  }",
  "  return out;",
  "})()",
].join('\n');
async function scanOne(wsUrl){
  const c=await CDP.connect(wsUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  c.close();
  return r.result?.value || [];
}
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.webSocketDebuggerUrl && !/devtools|chrome|about:/i.test(t.url||''));
  for (const t of pages){
    let res;
    try { res = await scanOne(t.webSocketDebuggerUrl); } catch(e){ console.log('skip', t.type, (t.title||'').slice(0,30), e.message); continue; }
    if (res && res.length){
      console.log('== '+t.type+' | '+(t.title||'').slice(0,40));
      console.log(JSON.stringify(res,null,2));
    }
  }
  console.log('done');
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});