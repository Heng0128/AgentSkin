// Probe #8: dump the exact CSS rules declaring the bg-bg tokens on the html root.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const TARGET_TOKENS = ['--bg-bg-input','--bg-bg-base-secondary','--bg-bg-overlay-l2','--bg-bg-white','--bg-bg-overlay-l1'];
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('DOM.enable');
  await c.send('CSS.enable');
  const { root } = await c.send('DOM.getDocument', { depth: 0 });
  const nodeId = (await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'html' })).nodeId;
  const matched = await c.send('CSS.getMatchedStylesForNode', { nodeId });
  console.log('=== rules declaring bg-bg tokens on html ===');
  for (const m of matched.matchedCSSRules || []) {
    const style = m.rule?.style;
    const props = style?.cssProperties || [];
    const rel = props.filter(p => TARGET_TOKENS.includes(p.name));
    if (!rel.length) continue;
    const sel = m.rule?.selectorList?.text || '';
    console.log(`SELECTOR: ${sel}`);
    for (const p of rel) console.log(`   ${p.name}: ${p.value} ${p.important ? 'IMPORTANT' : ''}`);
  }
  // also inline style rules
  console.log('=== attribute/inline ===');
  for (const b of matched.inlineStyle?.cssProperties || []) {
    if (TARGET_TOKENS.includes(b.name)) console.log(`   ATR ${b.name}: ${b.value} ${b.important?'IMPORTANT':''}`);
  }
  // CSS.getStyleSheetText for sheets if needed
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});