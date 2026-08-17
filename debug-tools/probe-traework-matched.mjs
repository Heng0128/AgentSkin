// Probe #4: use CDP CSS domain to dump matched CSS rules (incl origin/important)
// for the unresolved host-grey elements. Decisive for why overrides lose.
import { fileURLToPath } from 'node:url';
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const TARGETS = {
  '.solo-mobile-compact-btn': ['background-color'],
  '.messageInputPluginToolbarIconWrapper': ['background-color'],
  '.chat-input-v2-editor-part': ['background-color'],
  '.task-list-shadow-bottom': ['background-image'],
  '.chat-input-v2-input-box-editable': ['background'],
};
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('DOM.enable');
  await c.send('CSS.enable');
  await c.send('Runtime.enable');

  // get one backend nodeId for each selector
  const { root } = await c.send('DOM.getDocument', { depth: 0 });
  for (const [sel, props] of Object.entries(TARGETS)) {
    let nodeId = null;
    try { nodeId = (await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel })).nodeId; } catch {}
    if (!nodeId || nodeId === 0) { console.log(`\n=== ${sel} : NOT FOUND`); continue; }
    console.log(`\n=== ${sel}`);
    const matched = await c.send('CSS.getMatchedStylesForNode', { nodeId });
    for (const rule of matched.matchedCSSRules || []) {
      const style = rule.rule?.style || rule.match;
      const important = [];
      const propsOut = [];
      for (const p of props) {
        const decls = (style ? (style.cssProperties || [style]) : []).map?.(d => d) || [];
        const list = Array.isArray(style) ? style : (style?.cssProperties || []);
        for (const prop of list) {
          if (prop.name === p || p === 'background' && /^background/.test(prop.name)) {
            propsOut.push({ name: prop.name, value: prop.value, important: prop.important === true });
          }
        }
      }
      const selTxt = rule.rule?.selectorList?.text || rule.selectorText || '';
      const cssText = rule.rule?.style?.cssText || '';
      const origin = rule.origin || rule.match?.origin || '';
      console.log(`  [${origin}] ${selTxt} ${important.length ? 'IMPORTANT' : ''} :: ${cssText.slice(0, 200)}`);
    }
  }
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});