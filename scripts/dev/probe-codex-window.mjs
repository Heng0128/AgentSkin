// SPDX-License-Identifier: MPL-2.0
// 临时探针：检测 Codex 主 renderer 的真实窗口尺寸 / 可见性 / 惰性渲染状态。
// 用 Node 22 全局 WebSocket（与 scripts/cdp-full-extract.mjs 的 CdpClient 一致）。
const WebSocket = globalThis.WebSocket;

const WS_URL = 'ws://127.0.0.1:56901/devtools/page/7F29A362C247B92D2CBB55BA004B2889';

const ws = new WebSocket(WS_URL);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = (e) => reject(new Error(`ws err: ${e.message}`));
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

const expr = `(() => {
  const r = document.documentElement.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const main = document.querySelector("main[class*='MainContentSurface']");
  const mc = main ? getComputedStyle(main) : null;
  const aside = document.querySelector("aside.app-shell-left-panel");
  const ac = aside ? getComputedStyle(aside) : null;
  return JSON.stringify({
    innerW: window.innerWidth,
    innerH: window.innerHeight,
    docW: r.width,
    docH: r.height,
    visibility: document.visibilityState,
    rootCV: cs.contentVisibility,
    allCount: document.querySelectorAll('*').length,
    mainExist: !!main,
    mainCV: mc ? mc.contentVisibility : null,
    mainContain: mc ? mc.contain : null,
    mainDisplay: mc ? mc.display : null,
    asideExist: !!aside,
    asideWidth: ac ? (ac.width || null) : null,
    rootBg: cs.backgroundColor,
    rootLayer: cs.backgroundImage,
  });
})()`;

const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
console.log(res.result?.value ?? JSON.stringify(res));
ws.close();
