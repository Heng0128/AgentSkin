// Probe: scan the whole live traework CN page for ANY element with a computed
// box-shadow or a visible "bubble-ring" shadow, to find what the fixed adapter
// rules are NOT covering. Focus on box-shadow that is not 'none'.
const PORT = process.argv[2] || '65222';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = [
  "(() => {",
  "  const out = [];",
  "  const all = document.querySelectorAll('*');",
  "  for (const el of all) {",
  "    const cs = getComputedStyle(el);",
  "    const sh = cs.boxShadow;",
  "    if (!sh || sh === 'none') continue;",
  "    const r = el.getBoundingClientRect();",
  "    out.push({ cls: String(el.className).slice(0,70), tag: el.tagName, boxShadow: sh.slice(0,90), w: Math.round(r.width), h: Math.round(r.height) });",
  "  }",
  "  return out;",
  "})()",
].join('\n');
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  console.log('PAGE:', page?.title);
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  if (r.exceptionDetails) console.log('EXC:', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  const v=r.result?.value||[];
  console.log('COUNT:', v.length);
  console.log(JSON.stringify(v.slice(0,40),null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});