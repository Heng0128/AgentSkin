// SPDX-License-Identifier: MPL-2.0
// Manual probe: dump codex injection state on every page target for the given port.
// Usage: node debug-tools/probe-codex.mjs <port>
const port = Number(process.argv[2] ?? 56005);

async function listTargets() {
  const http = await import('node:http');
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/json/list`, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}

async function evalIn(wsUrl, expr) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pend = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pend.has(msg.id)) {
      const { resolve, reject } = pend.get(msg.id);
      pend.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pend.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const exprId = ++id;
  const ret = await new Promise((resolve, reject) => {
    pend.set(exprId, { resolve, reject });
    ws.send(
      JSON.stringify({
        id: exprId,
        method: 'Runtime.evaluate',
        params: { expression: expr, returnByValue: true },
      }),
    );
  });
  ws.close();
  return ret?.result?.value ?? ret;
}

const targets = await listTargets();
console.log(
  'targets:',
  targets
    .map((t) => `${t.type} "${t.title}" ${t.url} ${t.webSocketDebuggerUrl ? 'ws' : 'no-ws'}`)
    .join('\n  '),
);
for (const t of targets) {
  if (!t.webSocketDebuggerUrl) continue;
  try {
    const expr = `(() => {
      const el = document.getElementById('agentskin-theme-style-codex');
      const state = window.__AGENTSKIN__?.hosts?.codex;
      return JSON.stringify({
        url: location.href,
        stylePresent: !!el,
        styleLen: (el?.textContent ?? '').length,
        statePresent: !!state,
        adopted: (document.adoptedStyleSheets||[]).filter(s=>!!s.__agentskin).length,
      });
    })()`;
    const raw = await evalIn(t.webSocketDebuggerUrl, expr);
    console.log(`  "${t.title}": ${raw}`);
  } catch (e) {
    console.log(`  "${t.title}": EVAL ERR ${e.message}`);
  }
}