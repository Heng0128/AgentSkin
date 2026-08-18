// 诊断: 直接验证 VS Code 架构下 CSS 变量的真实数量与宿主（用 getPropertyValue 而非 length 枚举）。
// 用法: node debug-tools/probe-var-hosts.mjs <port>
const port = Number(process.argv[2] ?? 9339);
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params) => {
  const i = ++id;
  return new Promise((r, j) => { pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method, params })); });
};
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id).r(m.result); pend.delete(m.id); } };
await new Promise((r) => (ws.onopen = r));

// 1) 枚举 html/body 的 inline style 里的 --var
// 2) 遍历计算样式时同时用定义值 getPropertyValue 探测 --cb-*, --vscode-* 前缀
const expr = `(() => {
  const html = document.documentElement;
  const body = document.body;
  const inline = html.getAttribute('style') || '';
  const inlineVars = (inline.match(/--[\\w-]+\s*:/g) || []).map(s => s.replace(/[\\s:]/g,'')).slice(0,6);
  const countByPrefix = (el, prefix) => {
    const cs = getComputedStyle(el);
    let n = 0; const sample = [];
    for (let i=0;i<cs.length;i++){ const p=cs[i]; if(p.startsWith(prefix)){ n++; if(sample.length<3) sample.push(p); } }
    return { n, sample };
  };
  const htmlVars = countByPrefix(html, '--cb-');
  const vscodeVars = countByPrefix(html, '--vscode-');
  // 深找: 扫描含最多变量计算值的元素（含 inline var 元素）
  let best = { n:0, tag:'', id:'', cls:'' };
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const st = el.getAttribute && el.getAttribute('style');
    if (st && st.includes('--')) {
      const cnt = (st.match(/--[\\w-]+/g)||[]).length;
      if (cnt > best.n) best = { n:cnt, tag:el.tagName, id:el.id||'', cls:(el.className&&String(el.className).slice(0,40))||'' };
    }
  }
  return JSON.stringify({
    inlineVarSample: inlineVars,
    htmlStyleLen: inline.length,
    html_cb: htmlVars,
    html_vscode: vscodeVars,
    body_cb: countByPrefix(body, '--cb-'),
    bestInline: best,
    anyCbInCssRules: !!([...document.styleSheets].some(s => { try { return /--cb-/i.test(s.cssRules?.[0]?.cssText||''); } catch { return false; } })),
  });
})()`;

const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(JSON.stringify(JSON.parse(r.result.value)));
ws.close();