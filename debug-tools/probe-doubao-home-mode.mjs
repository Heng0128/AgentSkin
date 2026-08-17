// Dump ancestor chain of the home 对话/工作 mode buttons + which AgentSkin
// injected CSS rules actually match each ancestor.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const argv = process.argv.slice(2);
const PORT = argv[0] || '61055';
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
  }
  static async connect(url) {
    const c = new CDP(new WebSocket(url));
    await new Promise((res, rej) => {
      c.ws.addEventListener('open', res, { once: true });
      c.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    c.ws.addEventListener('message', (e) => c.#msg(e.data));
    return c;
  }
  #msg(raw) {
    const m = JSON.parse(raw);
    if (m.id != null && this.pending.has(m.id)) {
      const { r } = this.pending.get(m.id);
      this.pending.delete(m.id);
      m.error ? r(new Error(m.error.message)) : r(m.result);
    }
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { r: res });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('timeout ' + method));
        }
      }, 15000);
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}
const JS = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width*r.height<4) return false; const cs=getComputedStyle(el); return !(cs.display==='none'||cs.visibility==='hidden'||+cs.opacity===0); };
  // find the leaf text 工作, then ascend collecting chain
  let leaf=null;
  for (const el of Array.from(document.querySelectorAll('div,span,button,li,a')).filter(vis)) {
    if (el.childElementCount) continue;
    if ((el.textContent||'').trim()==='工作') { leaf=el; break; }
  }
  if(!leaf) return {err:'no working leaf'};
  let chain=[];
  let n=leaf;
  for(let i=0;i<7 && n;i++){
    const cs=getComputedStyle(n);
    const r=n.getBoundingClientRect();
    chain.push({
      depth:i, tag:n.tagName,
      cls:(typeof n.className==='string'?n.className:(n.getAttribute&&n.getAttribute('class'))||'').replace(/\\s+/g,' ').trim().slice(0,140),
      radius:cs.borderRadius, bg:cs.backgroundColor, border:cs.borderWidth+' '+cs.borderStyle,
      w:Math.round(r.width), h:Math.round(r.height)
    });
    n=n.parentElement;
  }
  // Which injected stylesheet rules match the deepest actionable element and its parent?
  const sel = (el)=>{ if(!el) return null; return ['button[class*="secondary"]','button[class*="outlined"]','[class*="outline-btn"]','[class*="btn-secondary"]','[class*="btn-outlined"]'].filter(s=>el.matches(s)); };
  const hitLeaf=leaf.closest('button,[role="button"]')||leaf;
  const hitParent=hitLeaf.parentElement;
  // collect rules from injected agentskin <style>
  let injected=[];
  for (const st of document.querySelectorAll('style')) {
    const txt=(st.textContent||'');
    if(!/agentskin/i.test(txt)) continue;
    for (const sheet of Array.from(st.sheet?st.sheet.cssRules:[])) {
      try {
        if(sheet.selectorText && (hitLeaf.matches(sheet.selectorText)|| (hitParent&&hitParent.matches(sheet.selectorText)))) {
          const cssText=sheet.cssText.split('{')[0].trim().slice(0,120);
          injected.push(cssText);
        }
      } catch(e){}
    }
  }
  return { chain, hitLeafMatch: sel(hitLeaf), hitParentMatch: sel(hitParent), injected };
})()`;
async function run() {
  const t = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json())
    .filter(
      (x) =>
        x.type === 'page' && x.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(x.url || ''),
    )
    .find((p) => /豆包|doubao|chat/i.test(p.title || p.url || ''));
  if (!t) {
    console.log('no page');
    return;
  }
  const c = await CDP.connect(t.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const r = await c.send('Runtime.evaluate', {
    expression: JS,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails));
  console.log(JSON.stringify(r.result?.value, null, 2));
  c.close();
}
run().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
