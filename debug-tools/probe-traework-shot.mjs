// Screenshot the current traework CN page so we can SEE the "bubble ring"
// the user reports. Saves to debug-tools/_shot-bubbles.png.
import fs from 'node:fs';
const PORT = process.argv[2] || '65222';
const OUT = process.argv[3] || new URL('./_shot-bubbles.png', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1');
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},12000);});}
  close(){try{this.ws.close();}catch{}}
}
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  // reveal scrollbar overlay-free full body by capturing viewport
  const shot=await c.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(OUT, Buffer.from(shot.data,'base64'));
  console.log('saved', OUT);
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});