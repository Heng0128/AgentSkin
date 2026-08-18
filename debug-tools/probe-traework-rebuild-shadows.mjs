// Probe: after theme rebuild, WHY do task-list-shadow-bottom/top and message
// bubble box-shadows reappear? Diagnose whether the ENGINE adapter (which owns
// both rules) is actually injected in the live traework CN page.
const PORT = process.argv[2] || '65222';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
// Keep the page-side script a single expression with no backslash escapes.
const JS = [
  "(() => {",
  "  const res = {};",
  "  const html = document.documentElement;",
  "  res.hostClass = html.classList.contains('agentskin-host-traework');",
  "  res.adapterMarker = !!window.__agentskin_traework_adapter__;",
  "  res.agentskinConfig = !!window.__AGENTSKIN_CONFIG__;",
  "  res.sheets = Array.from(document.adoptedStyleSheets || []).map(function(s){",
  "    var t=''; try { t = Array.from(s.cssRules||[]).map(function(r){return r.cssText||'';}).join('|'); } catch(e){}",
  "    return { layer: s.__agentskin_layer || (s.__agentskin ? 'agentskin' : 'native'), hasList: t.indexOf('task-list-shadow-bottom')>=0, hasBubble: t.indexOf('box-shadow: none')>=0, len: t.length };",
  "  });",
  "  function rd(sel){ var el=document.querySelector(sel); if(!el) return {found:false}; var cs=getComputedStyle(el); return {found:true, cls:String(el.className).slice(0,50), bg:cs.backgroundImage, sh:cs.boxShadow}; }",
  "  res.shadowBottom = rd('.task-list-shadow-bottom');",
  "  res.shadowTop = rd('.task-list-shadow-top');",
  "  var bub=document.querySelector('[class*=\"message-content\"],[class*=\"msg-content\"],[class*=\"chat-bubble\"],[class*=\"message-bubble\"]');",
  "  res.bubble = bub ? rdFrom(bub) : {found:false};",
  "  function rdFrom(el){ var cs=getComputedStyle(el); return {found:true, cls:String(el.className).slice(0,50), bg:cs.backgroundImage, sh:cs.boxShadow}; }",
  "  return res;",
  "})()",
].join('\n');
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  console.log('PAGE:', page?.url, '|', page?.title);
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  if (r.exceptionDetails) console.log('EXCEPTION:', r.exceptionDetails.text, r.exceptionDetails.exception?.description || '');
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});