// 诊断: 抓取 CDP 端口主 page 的真实渲染状态，判断 Core UI 是否已加载/变量藏身处。
// 用法: node debug-tools/probe-page-state.mjs <port>
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

const expr = `(() => {
  const root = document.documentElement;
  const body = document.body;
  const count = (el) => { if(!el) return -1; const es=getComputedStyle(el); let n=0; for(let i=0;i<es.length;i++){ if(es[i].startsWith('--')) n++; } return n; };
  const rootChildren = root ? Array.from(root.children).map(c => c.tagName.toLowerCase()) : [];
  return JSON.stringify({
    readyState: document.readyState,
    bodyInnerHTMLHead: body ? body.innerHTML.slice(0, 300) : null,
    bodyChildren: body ? body.children.length : -1,
    rootVarCount: count(root),
    bodyVarCount: count(body),
    adoptedSheets: document.adoptedStyleSheets ? document.adoptedStyleSheets.length : null,
    styleTags: document.querySelectorAll('style').length,
    // 是否暗藏 webview / iframe / 需要 JS 装载的占位
    webviews: document.querySelectorAll('webview, iframe').length,
    html: root.outerHTML.slice(0, 200),
  });
})()`;

const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(JSON.stringify(JSON.parse(r.result.value)));
ws.close();