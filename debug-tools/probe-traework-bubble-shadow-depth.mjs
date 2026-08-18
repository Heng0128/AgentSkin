// Deep-inspect the user-message area for the "shadow behind the bubble ring":
// checks box-shadow, filter/drop-shadow, background gradients, and ::before/::after
// pseudo-element shadows across the message subtree.
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
  "    const cls = String(el.className || '');",
  "    if (!/message|bubble|msg|turn|user-message|agent-message|turn__/i.test(cls)) continue;",
  "    if (seen.has(cls)) continue; seen.add(cls);",
  "    const cs = getComputedStyle(el);",
  "    const rec = { cls: cls.slice(0,60) };",
  "    rec.boxShadow = cs.boxShadow !== 'none' ? cs.boxShadow.slice(0,80) : 'none';",
  "    rec.filter = cs.filter !== 'none' ? cs.filter.slice(0,80) : 'none';",
  "    rec.bgImg = cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0,80) : 'none';",
  "    rec.radius = cs.borderRadius.slice(0,30);",
  "    const before = getComputedStyle(el, '::before');",
  "    const after = getComputedStyle(el, '::after');",
  "    rec.before = { content: before.content!=='none'?'yes':'no', sh: before.boxShadow!=='none'?before.boxShadow.slice(0,60):'none', fil: before.filter!=='none'?before.filter.slice(0,40):'none', bg: before.backgroundImage!=='none'?'img':'none', radius: before.borderRadius.slice(0,20) };",
  "    rec.after = { content: after.content!=='none'?'yes':'no', sh: after.boxShadow!=='none'?after.boxShadow.slice(0,60):'none', fil: after.filter!=='none'?after.filter.slice(0,40):'none', bg: after.backgroundImage!=='none'?'img':'none', radius: after.borderRadius.slice(0,20) };",
  "    const interesting = rec.boxShadow!=='none'||rec.filter!=='none'||rec.bgImg!=='none'||rec.before.sh!=='none'||rec.before.fil!=='none'||rec.before.bg!=='none'||rec.after.sh!=='none'||rec.after.fil!=='none'||rec.after.bg!=='none';",
  "    if (interesting) out.push(rec);",
  "  }",
  "  return out;",
  "})()",
].join('\n');
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  console.log('COUNT:', (r.result?.value||[]).length);
  console.log(JSON.stringify(r.result?.value||r.result, null, 2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});