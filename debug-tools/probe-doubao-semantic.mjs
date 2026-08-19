// Extract native values for Doubao semi semantic-color + md-box blind spots.
const PORT = process.argv[2] || '63551';
const T = [
  '--semi-color-info', '--semi-color-info-hover', '--semi-color-info-active', '--semi-color-info-disabled',
  '--semi-color-success', '--semi-color-success-hover', '--semi-color-success-active', '--semi-color-success-disabled',
  '--semi-color-warning', '--semi-color-warning-hover', '--semi-color-warning-active', '--semi-color-warning-disabled',
  '--semi-color-danger', '--semi-color-danger-hover', '--semi-color-danger-active', '--semi-color-danger-disabled',
  '--semi-color-black', '--semi-color-white', '--semi-color-default',
  '--semi-color-default-hover', '--semi-color-default-active',
  '--md-box-samantha-normal-text-color', '--md-box-samantha-deep-text-color',
  '--md-box-samantha-li-maker-color', '--md-box-samantha-split-line-color',
  '--md-box-samantha-blockquote-left-border-color',
  '--color-link-text', '--color-link-text-active',
];
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = `(() => {
    const T = ${JSON.stringify(T)};
    const el = document.body;
    const cs = getComputedStyle(el);
    const out = {};
    for (const t of T) { const v = cs.getPropertyValue(t).trim(); if (v) out[t] = v.slice(0, 45); }
    return out;
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  const v = r.result?.value || {};
  let hit = 0, miss = 0;
  for (const t of T) { if (v[t]) { hit++; console.log('  HIT ', t, '=', v[t]); } else { miss++; console.log('  MISS', t); } }
  console.log('--- hit:', hit, '/', T.length, '| missing:', miss);
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
