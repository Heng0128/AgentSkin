// Second probe: lock the exact structure of the native-grey elements that
// still follow the app's own theme (sidebar shadow, conversation row circle
// thumbnails, backdrop shadow, composer toolbar).
const PORT = 56211;
async function getTarget() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page" && /solo-lite|solo/i.test(t.url));
  return page.webSocketDebuggerUrl;
}
const EXPRESSION = `(() => {
  const out = {};

  // ---- real sidebar container: biggest fixed panel containing task-list ----
  const tl = document.querySelector('[class*="task-list"], [class*="taskList"]');
  function line(el){ if(!el) return null; const s=getComputedStyle(el); return { cls:String(el.className||'').slice(0,140), pos:s.position, bg:s.backgroundColor, bsh:s.boxShadow=== 'none'?'none':s.boxShadow.slice(0,120), br:s.borderRight, w:Math.round(el.getBoundingClientRect().width), h:Math.round(el.getBoundingClientRect().height) }; }
  out.sidebarContainer = line(tl);

  // look a few ancestors up for a large sidebar scaffold with a shadow
  if (tl){ let n=tl; const chain=[]; for(let i=0;i<5&&n;i++){ chain.push(line(n)); n=n.parentElement; } out.sidebarAncestors = chain; }

  // ---- conversation list rows + circular thumbs ----
  out.rows = [];
  const items = document.querySelectorAll('[class*="task-list"] [class*="item"], .task-list-new-task-item, [class*="conversation-"], [class*="session-"]');
  for (const it of document.querySelectorAll('body *')) {
    const cls=String(it.className||'');
    if(!/item/.test(cls)) continue;
    const r=it.getBoundingClientRect();
    if(r.width<40||r.height<20) continue;
    const kids=[...it.children].slice(0,8).map(c=>({t:(c.tagName||'').toLowerCase(),cls:String(c.className||c.getAttribute('class')||'').slice(0,110),rw:Math.round(c.getBoundingClientRect().width)}));
    out.rows.push({cls:cls.slice(0,130), h:Math.round(r.height), kids});
    if(out.rows.length>=6) break;
  }

  // ---- composer wrapper chain (find the primary-glow / toolbar parent) ----
  const ce=document.querySelector('.chat-input-v2-input-box-editable');
  if(ce){ let n=ce; const chain=[]; for(let i=0;i<6&&n;i++){ chain.push({cls:String(n.className||'').slice(0,130), bg:getComputedStyle(n).backgroundColor, bsh:getComputedStyle(n).boxShadow.slice(0,80)}); n=n.parentElement; } out.composerAncestors=chain; }
  out.pluginToolbar = null;
  for (const el of document.querySelectorAll('body *')) {
    if(/messageInputPluginToolbarIconWrapper/.test(String(el.className||''))){ let n=el; const chain=[]; for(let i=0;i<4&&n;i++){ chain.push({cls:String(n.className||'').slice(0,110),bg:getComputedStyle(n).backgroundColor}); n=n.parentElement;} out.pluginToolbar = chain; break; }
  }

  // ---- hottest native-grey offenders ----
  const count={};
  for (const el of document.querySelectorAll('body *')) {
    const bg=getComputedStyle(el).backgroundColor;
    if(!bg||bg==='rgba(0, 0, 0, 0)') continue;
    const key = bg==='rgb(212, 212, 212)'||bg.includes('212, 212, 212')||bg==='rgb(41, 41, 41)'||bg==='rgb(229, 229, 229)' ? bg : null;
    if(key){ count[key]=count[key]||{n:0,ex:new Set()}; count[key].n++; if(count[key].ex.size<4) count[key].ex.add(String(el.className||el.tagName).slice(0,80)); }
  }
  out.greyOffenders = Object.fromEntries(Object.entries(count).map(([k,v])=>({k, n:v.n, ex:[...v.ex]})));

  return out;
})()`;
let idSeq = 0;
function evaluate(ws, expression) {
  return new Promise((resolve, reject) => {
    const id = ++idSeq;
    const onMsg = (ev) => { const m=JSON.parse(ev.data); if(m.id!==id) return; ws.removeEventListener("message",onMsg); m.error?reject(new Error(JSON.stringify(m.error))):resolve(m.result?.result?.value); };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method:"Runtime.evaluate", params:{ expression, returnByValue:true, awaitPromise:true } }));
  });
}
(async () => {
  const ws = new WebSocket(await getTarget()); ws.binaryType="arraybuffer";
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  console.log(JSON.stringify(await evaluate(ws, EXPRESSION), null, 2));
  ws.close();
})().catch(e=>{console.error("ERR",e.message);process.exit(1);});