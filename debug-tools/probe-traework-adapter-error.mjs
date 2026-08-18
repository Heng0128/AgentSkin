// Re-run engines/traework/adapter.mjs in the live page to surface the exact
// error that makes Step 5 (adapter evaluate) return false — leaving No adapter
// layer builtStyleSheet so the sidebar/bubble shadow rules never apply.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const PORT = process.argv[2] || '65222';
// Load our engine adapter source from the repo.
const adapterPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'engines', 'traework', 'adapter.mjs');
const adapterSrc = fs.readFileSync(adapterPath, 'utf8');
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')));});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
// Wrap: evaluate the adapter as an expression. If it throws, cd because this
// is the SAME code path the engine uses.
// Embed via string concat so the adapter's own backticks do not break the frame.
const JS = '(function(){ try {\n' + adapterSrc + '\n } catch(e){ return JSON.stringify({threw:true, name:e.name, message:String(e.message), stack:e.stack}); } })()';
async function run(){
  const targets=await(await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages=targets.filter(t=>t.type==='page'&&t.webSocketDebuggerUrl&&!/devtools|chrome|about:/i.test(t.url||''));
  const page=pages.find(p=>/solo|trae/i.test(p.url||'')||p.title)||pages[0];
  console.log('PAGE:', page?.url, '|', page?.title);
  const c=await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r=await c.send('Runtime.evaluate',{expression:adapterSrc,returnByValue:true, awaitPromise:true});
  console.log('VALUE:', r.result?.value);
  if (r.exceptionDetails) console.log('EXC:', r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  // Also check marker after manual run
  const m=await c.send('Runtime.evaluate',{expression:"JSON.stringify({marker:!!window.__agentskin_traework_adapter__, layer:Array.from(document.adoptedStyleSheets).map(s=>s.__agentskin_layer||'nat')})",returnByValue:true});
  console.log('AFTER:', m.result?.value);
  c.close();
}
run().catch(e=>{console.error('FAIL:',e.message);process.exit(1);});