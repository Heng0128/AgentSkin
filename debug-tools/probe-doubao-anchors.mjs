// Probe: check whether the stable data-testid/data-container-name anchors used
// by styoha/doubao-theme-engine exist in OUR running Doubao (63551). If they
// do, our doubao adapter should prefer them over hash/tailwind class anchors.
const PORT = process.argv[2] || '63551';
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
    const ids = ['chat_route_layout_leftside_nav', 'flow_chat_sidebar', 'create_conversation_button', 'create_office_task_button', 'ai_space_nav_button', 'sidebar-skills', 'app-open-website'];
    const out = {};
    for (const id of ids) {
      const el = document.querySelector('[data-testid="' + id + '"]');
      if (el) { const r = el.getBoundingClientRect(); out['testid:' + id] = 'EXISTS ' + Math.round(r.width) + 'x' + Math.round(r.height); }
      else out['testid:' + id] = 'missing';
    }
    const cns = ['main', 'sidebar', 'composer', 'header'];
    for (const n of cns) {
      const el = document.querySelector('[data-container-name="' + n + '"]');
      if (el) { const r = el.getBoundingClientRect(); out['container:' + n] = 'EXISTS ' + Math.round(r.width) + 'x' + Math.round(r.height); }
      else out['container:' + n] = 'missing';
    }
    // all distinct data-testid values present (bounded)
    const seen = {};
    for (const el of document.querySelectorAll('[data-testid]')) {
      const v = el.getAttribute('data-testid');
      if (v && !seen[v]) seen[v] = true;
    }
    out.distinctTestIds = Object.keys(seen).length;
    out.testIdSamples = Object.keys(seen).slice(0, 30);
    return out;
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
