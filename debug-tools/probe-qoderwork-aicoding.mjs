// Probe: do QoderWork's private `aicoding.*` theme keys (from
// Ailln/qoder-skin-skill references/aicoding-keys.txt) exist as CSS variables
// in the RUNNING QoderWork (50494)? If yes, our qoderwork engine has blind
// spots on the AI-panel/Quest surface.
const PORT = process.argv[2] || '50494';
const AICODING_VARS = [
  '--vscode-aicoding-bgContainer', '--vscode-aicoding-bgElevated',
  '--vscode-aicoding-primaryText', '--vscode-aicoding-primaryBg',
  '--vscode-aicoding-questBrandAccent', '--vscode-aicoding-buttonBackground',
  '--vscode-aicoding-buttonForeground', '--vscode-aicoding-colorTextTertiary',
  '--vscode-aicoding-colorTextQuaternary', '--vscode-aicoding-colorSuccess',
  '--vscode-aicoding-colorWarning', '--vscode-aicoding-fill',
  '--vscode-aicoding-fillSecondary', '--vscode-aicoding-fillTertiary',
  '--vscode-aicoding-fillQuaternary', '--vscode-aicoding-borderTertiary',
  '--vscode-aicoding-skeletonBackground', '--vscode-aicoding-switchCheckedBackground',
  '--vscode-aicoding-sparkError', '--vscode-aicoding-sparkErrorBg',
  '--vscode-aicoding-sparkSuccess', '--vscode-aicoding-sparkInfo',
];
class CDP {
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();}
  static async connect(url){const c=new CDP(new WebSocket(url));await new Promise((r,j)=>{c.ws.addEventListener('open',r,{once:true});c.ws.addEventListener('error',()=>j(new Error('ws')),{once:true});});c.ws.addEventListener('message',(e)=>c.#m(e.data));return c;}
  #m(raw){const m=JSON.parse(raw);if(m.id!=null&&this.pending.has(m.id)){const{res,rej}=this.pending.get(m.id);this.pending.delete(m.id);m.error?rej(new Error(m.error.message)):res(m.result);}}
  send(method,params={}){const id=++this.id;return new Promise((res,rej)=>{this.pending.set(id,{res,rej});this.ws.send(JSON.stringify({id,method,params}));setTimeout(()=>{if(this.pending.has(id)){this.pending.delete(id);rej(new Error('timeout:'+method));}},15000);});}
  close(){try{this.ws.close();}catch{}}
}
async function run() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = (targets.filter(t => t.type === 'page' && t.webSocketDebuggerUrl && !/devtools|chrome|about:/.test(t.url || ''))).find(p => p.title) || targets[0];
  const c = await CDP.connect(page.webSocketDebuggerUrl);
  await c.send('Runtime.enable');
  const js = `(() => {
    const T = ${JSON.stringify(AICODING_VARS)};
    const scopes = ['html', 'body', '#root', '.monaco-workbench'];
    const found = {}; for (const t of T) found[t] = { count: 0, samples: [] };
    for (const sel of scopes) {
      let el = null; try { el = document.querySelector(sel); } catch {}
      if (!el) continue;
      const cs = getComputedStyle(el);
      for (const t of T) {
        const v = cs.getPropertyValue(t).trim();
        if (v) { found[t].count++; if (found[t].samples.length < 2) found[t].samples.push(sel + '=' + v.slice(0, 30)); }
      }
    }
    const exists = T.filter(t => found[t].count > 0);
    const absent = T.filter(t => found[t].count === 0);
    return { total: T.length, exists: exists.length, absent: absent.length, existsList: exists, sample: Object.fromEntries(exists.slice(0, 12).map(t => [t, found[t].samples[0]])) };
  })()`;
  const r = await c.send('Runtime.evaluate', { expression: js, returnByValue: true });
  if (r.exceptionDetails) console.log('ERR:', JSON.stringify(r.exceptionDetails).slice(0, 300));
  const v = r.result?.value;
  console.log('aicoding 变量总数:', v.total, '| 原生存在:', v.exists, '| 不存在:', v.absent);
  console.log('--- 存在的 aicoding 变量 ---');
  v.existsList.forEach(t => console.log('  ', t, '=', v.sample[t]));
  c.close();
}
run().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
