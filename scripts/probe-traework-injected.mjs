// Probe #13 rev: is the LIVE sheet carrying my rules? Read computed state of both zones + dump injected sheets.
const PORT = process.argv[2] || '56211';
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
const JS = String.raw`(() => {
  const txtOf = function(list){
    var out = '';
    try { for (var i=0;i<list.length;i++){ out += list[i].cssText + '\\n'; } } catch(e){ out = '<unreadable>'; }
    return out;
  };
  var shadowInjected = '', editorInjected = '', anyHost = false;
  for (var s of document.adoptedStyleSheets) {
    var t = txtOf(Array.from(s.cssRules||[]));
    if (t.indexOf('agentskin-host-traework') >= 0) anyHost = true;
    if (t.indexOf('task-list-shadow-bottom') >= 0 && shadowInjected === '') { shadowInjected = t.slice(0, 160); }
    if (t.indexOf('.chat-input-v2-editor-part') >= 0 && editorInjected === '') { editorInjected = t.slice(0, 200); }
  }
  for (var st of document.querySelectorAll('style')) {
    var tt = st.textContent || '';
    if (tt.indexOf('agentskin-host-traework') >= 0) anyHost = true;
    if (tt.indexOf('task-list-shadow-bottom') >= 0 && shadowInjected === '') { shadowInjected = tt.slice(0, 160); }
    if (tt.indexOf('.chat-input-v2-editor-part') >= 0 && editorInjected === '') { editorInjected = tt.slice(0, 200); }
  }
  var rd = function(sel){
    var e = document.querySelector(sel);
    if (!e) return { sel: sel, miss: true };
    var c = getComputedStyle(e);
    return { sel: sel, cls: (typeof e.className==='string'?e.className.slice(0,60):''), bg: c.backgroundColor, bgImg: (c.backgroundImage!=='none'?c.backgroundImage.slice(0,80):'none') };
  };
  return {
    anyHost,
    shadowInjected,
    editorInjected,
    state: {
      sidebarShadow: rd('.task-list-shadow-bottom'),
      editorPart: rd('.chat-input-v2-editor-part'),
      inputEditable: rd('.chat-input-v2-input-box-editable')
    }
  };
})()`;
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:JS,returnByValue:true});
  if(r.exceptionDetails){ console.error('EXC:', JSON.stringify(r.exceptionDetails.exception?.description||r.exceptionDetails.text)); }
  console.log(JSON.stringify(r.result?.value,null,2));
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});