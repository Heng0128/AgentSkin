// SPDX-License-Identifier: MPL-2.0
// 临时探针：复现 cdp-full-extract.mjs 的 captureDomTree，定位为何只抓 106 节点。
const WebSocket = globalThis.WebSocket;

const WS_URL = 'ws://127.0.0.1:56901/devtools/page/7F29A362C247B92D2CBB55BA004B2889';
const ws = new WebSocket(WS_URL);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error(e.message));
});
let id = 0;
const pend = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(typeof m.data === 'string' ? m.data : m.data.toString());
  if (d.id && pend.has(d.id)) {
    pend.get(d.id)(d.result);
    pend.delete(d.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

// 统计：documentElement 下的元素总数（按 tag 分类），判断脚本 SKIP 漏选了多少。
const expr = `(() => {
  const el = document.documentElement;
  const all = el.querySelectorAll('*');
  const byTag = {};
  for (const n of all) byTag[n.tagName] = (byTag[n.tagName] || 0) + 1;
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','META','LINK','HEAD','TITLE','SVG','PATH','DEFS','CLIPPATH','USE','SYMBOL','G']);
  let kept = 0;
  function walk(el, depth) {
    if (depth > 12) return 0;
    if (!el || !el.tagName) return 0;
    if (SKIP.has(el.tagName)) return 0;
    kept++;
    let n = 0;
    for (const c of el.children) n += walk(c, depth + 1);
    if (el.shadowRoot && el.shadowRoot.mode === 'open') for (const c of el.shadowRoot.children) n += walk(c, depth + 1);
    return n;
  }
  walk(el, 0);
  return JSON.stringify({ allCount: all.length, kept, deepestTag: Object.entries(byTag).sort((a,b)=>b[1]-a[1]).slice(0,12) });
})()`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(res.result?.value ?? JSON.stringify(res));
ws.close();
