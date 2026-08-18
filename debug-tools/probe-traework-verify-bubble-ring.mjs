// Verify fix for the residual user-message "<bubble ring>":
// live-inject a rule clearing .user-message__text-box surface and re-read
// its computed style. This mirrors the rule added to engines/traework/adapter.mjs.
const PORT = process.argv[2] || '65222';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},12000);});}
  close(){try{this.ws.close();}catch{}}
}
const RULE = `
html.agentskin-host-traework .user-message__text-box,
html.agentskin-host-traework [class*="user-message__text-box"] {
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
}
html.agentskin-host-traework [class*="user-message-navigator__mask"] {
  background-image: none !important;
  background: transparent !important;
}`;
const JS = [
  "(async () => {",
  "  const sheet = new CSSStyleSheet(); sheet.replaceSync(" + JSON.stringify(RULE) + ");",
  "  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];",
  "  const box = document.querySelector('.user-message__text-box');",
  "  const mask = document.querySelector('[class*=\"user-message-navigator__mask\"]');",
  "  const rd = (el)=>{ if(!el) return {found:false}; const cs=getComputedStyle(el); return {found:true, bg:cs.backgroundColor, bgImage:cs.backgroundImage, border:cs.borderColor}; };",
  "  return { textBox: rd(box), navMask: rd(mask) };",
  "})()",
].join('\n');
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,awaitPromise:true,returnByValue:true});
  console.log(JSON.stringify(r.result?.value||r.result, null, 2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});