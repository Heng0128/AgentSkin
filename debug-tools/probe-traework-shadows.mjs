// Probe #9: find ALL "shadow-like" visuals inside the sidebar (box-shadow + gradient bg) to catch per-conversation bottom shadows.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  const out = [];
  const root = document.querySelector('.task-list-base') || document.querySelector('[class*="task-list"]') || document.body;
  root.querySelectorAll('*').forEach(el=>{
    const cs = getComputedStyle(el);
    const sh = cs.boxShadow;
    const bg = cs.backgroundImage;
    const hasShadowBox = sh && sh !== 'none';
    const hasGrad = bg && bg.includes('gradient');
    if(!hasShadowBox && !hasGrad) return;
    const r = el.getBoundingClientRect();
    if(r.width<3||r.height<3) return;
    const cls = (el.className&&typeof el.className==='string')?el.className.trim():'';
    const viz = el.offsetParent !== null || cs.position === 'fixed';
    out.push({
      cls: cls.slice(0,110)||(el.id?'#'+el.id:'<none>'),
      pos: cs.position, h: Math.round(r.height), w: Math.round(r.width),
      boxShadow: (hasShadowBox?sh.slice(0,90):''),
      bgImg: (hasGrad?bg.slice(0,120):''),
      visible: viz,
      borderRadius: cs.borderRadius,
    });
  });
  return out;
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