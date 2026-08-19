// Rigorous re-check: is QoderWork's aicoding* surface REALLY absent from the
// DOM CSS layer? The first probe only checked --vscode-aicoding-* on 4 scopes.
// This probe:
//   1) searches ALL cssText (document.styleSheets + adoptedStyleSheets) for
//      ANY 'aicoding' occurrence (any prefix: --vscode-aicoding-, --aicoding-,
//      aicoding.bgContainer JSON keys in rule text)
//   2) checks ALL page targets of the port (AI panel may live in another target)
//   3) checks deeper scopes + shadow DOM
//   4) checks whether workbench.colorTheme / theme JSON keys leak into DOM
const PORT = process.argv[2] || '50494';

class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}

const JS = String.raw`(() => {
  const out = {};
  // 1) full cssText search across styleSheets + adoptedStyleSheets
  let styleSheetHits = 0;
  const styleSheetSamples = [];
  for (const sheet of document.styleSheets) {
    try {
      const txt = Array.from(sheet.cssRules).map(r => r.cssText || '').join('\n');
      const hits = txt.match(/[a-zA-Z-]*aicoding[a-zA-Z0-9.-]*/g) || [];
      styleSheetHits += hits.length;
      if (styleSheetSamples.length < 8) for (const h of hits) { styleSheetSamples.push(h); if (styleSheetSamples.length >= 8) break; }
    } catch {}
  }
  let adoptedHits = 0;
  const adoptedSamples = [];
  for (const sheet of document.adoptedStyleSheets) {
    try {
      const txt = Array.from(sheet.cssRules).map(r => r.cssText || '').join('\n');
      const hits = txt.match(/[a-zA-Z-]*aicoding[a-zA-Z0-9.-]*/g) || [];
      adoptedHits += hits.length;
      if (adoptedSamples.length < 8) for (const h of hits) { adoptedSamples.push(h); if (adoptedSamples.length >= 8) break; }
    } catch {}
  }
  out.styleSheets = { hits: styleSheetHits, samples: styleSheetSamples };
  out.adoptedStyleSheets = { hits: adoptedHits, samples: adoptedSamples };
  // 2) computed on ALL elements for the aicoding prefix variants (bounded 3000)
  const PREFIXES = ['--vscode-aicoding-', '--aicoding-', '--qoder-aicoding-', '--qoder-ai-'];
  const els = document.querySelectorAll('*');
  const max = Math.min(els.length, 3000);
  let computedHits = 0;
  const computedSamples = {};
  for (let i = 0; i < max; i++) {
    const cs = getComputedStyle(els[i]);
    for (const p of PREFIXES) {
      try {
        for (const name of cs) {
          if (name.startsWith(p)) {
            computedHits++;
            if (!computedSamples[name]) computedSamples[name] = cs.getPropertyValue(name).trim().slice(0, 30);
          }
        }
      } catch {}
    }
  }
  out.computed = { scanned: max, hits: computedHits, samples: computedSamples };
  // 3) theme JSON keys (aicoding.xxx) anywhere in style/attr text
  let jsonKeyHits = 0;
  const jsonSamples = [];
  for (const el of document.querySelectorAll('style, link[rel="stylesheet"]')) {
    try {
      const t = el.textContent || '';
      const hits = t.match(/aicoding\.[a-zA-Z]+/g) || [];
      jsonKeyHits += hits.length;
      if (jsonSamples.length < 8) for (const h of hits) { jsonSamples.push(h); if (jsonSamples.length >= 8) break; }
    } catch {}
  }
  out.jsonKeys = { hits: jsonKeyHits, samples: jsonSamples };
  // 4) shadow DOM penetration: query adopted sheets inside shadow roots
  let shadowHits = 0;
  try {
    for (const el of document.querySelectorAll('*')) {
      if (el.shadowRoot) {
        for (const sheet of el.shadowRoot.adoptedStyleSheets || []) {
          try { shadowHits += (Array.from(sheet.cssRules).map(r => r.cssText || '').join('\n').match(/aicoding/g) || []).length; } catch {}
        }
      }
    }
  } catch {}
  out.shadowDom = { hits: shadowHits };
  return out;
})()`;

async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const pages = targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''));
  console.log('=== QoderWork targets:', pages.length, '===');
  for (const p of pages) console.log('  target:', (p.title || p.url).slice(0, 60));
  console.log('');
  for (const page of pages) {
    console.log(`=== target: ${(page.title || page.url).slice(0, 50)} ===`);
    const c = await CDP.connect(page.webSocketDebuggerUrl);
    await c.send('Runtime.enable');
    const r = await c.send('Runtime.evaluate', { expression: JS, returnByValue: true });
    if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 200));
    const v = r.result?.value;
    if (v) {
      console.log('styleSheets:', JSON.stringify(v.styleSheets));
      console.log('adoptedStyleSheets:', JSON.stringify(v.adoptedStyleSheets));
      console.log('computed hits:', v.computed.hits, 'scanned:', v.computed.scanned, 'samples:', JSON.stringify(v.computed.samples));
      console.log('jsonKeys:', JSON.stringify(v.jsonKeys));
      console.log('shadowDom hits:', v.shadowDom.hits);
    }
    c.close();
    console.log('');
  }
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
