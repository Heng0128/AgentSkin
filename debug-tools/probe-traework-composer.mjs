// Probe #11: matched CSS rules for the composer input box region — WHO wins the background?
// Uses CSS domain to list every rule + specificity/priority hitting the editor-part.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = `(() => {
  // snapshot the full composer chain with real computed background each
  const chain = [];
  const start = document.querySelector('.chat-input-v2-input-box-editable');
  let n = start;
  let g = 0;
  const seen = new Set();
  while (n && g++ < 16) {
    const c = getComputedStyle(n);
    const cls = (typeof n.className==='string'?n.className.trim():'');
    const key = cls || n.tagName;
    chain.push({ cls: (cls||'<anon>').slice(0,110), bg: c.backgroundColor, bgImg: (c.backgroundImage!=='none'?c.backgroundImage.slice(0,80):'none'), border: c.borderColor+'/'+c.borderWidth.slice(0,10), radius: c.borderRadius, shadow: c.boxShadow.slice(0,50) });
    n = n.parentElement;
  }
  return chain;
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  await c.send('DOM.enable');
  await c.send('CSS.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  console.log('=== COMPOSER CHAIN (computed) ===');
  console.log(JSON.stringify(r.result?.value,null,2));

  // now matched rules for editor-part background
  const doc=await c.send('DOM.getDocument',{depth:-1,pierce:true});
  const q=await c.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:'.chat-input-v2-editor-part'});
  if(q.nodeId){
    const ms=await c.send('CSS.getMatchedStylesForNode',{nodeId:q.nodeId});
    const rules=(ms.matchedCSSRules||[]).map(rw=>({
      selector: rw.rule.selectorList.text,
      origin: rw.rule.origin,
      pri: rw.rule.media? 'media':'normal',
    }));
    console.log('=== MATCHED RULES for editor-part ===');
    console.log(JSON.stringify(rules,null,2));
    // find all rules that declare background/background-color anywhere (incl inherited)
    const bgRules=[];
    for(const rw of (ms.matchedCSSRules||[])){
      const has=(rw.rule.style&&typeof rw.rule.style.getPropertyValue==='function');
      let props=null;
      if(has){
        const s=rw.rule.style;
        props={bg:s.getPropertyValue('background')||'', bgColor:s.getPropertyValue('background-color')||''};
      }
      if(rw.rule.origin!=='user-agent'&&(!props||props.bg||props.bgColor)){
        bgRules.push({selector:rw.rule.selectorList.text, important: rw.rule.style?.properties?.filter(p=>p.text&&p.text.includes('!important')).map(p=>p.text)});
      }
    }
    console.log('=== RULES DECLARING BACKGROUND ===');
    console.log(JSON.stringify(bgRules,null,2));
  }
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});