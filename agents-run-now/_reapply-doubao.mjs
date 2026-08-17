// SPDX-License-Identifier: MPL-2.0
// 临时：重新注入 doubao 的 tokens.css 并验证补丁
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findTargets } from '../src/engine/src/runtime/injector.mjs';
import { listAdapters } from '../src/engine/src/adapters/index.mjs';
import { resolveDebugPorts } from '../src/engine/src/runtime/launcher.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

const adapter = listAdapters().find(a => a.id === 'doubao');
const execFileSafe = async (cmd, args) => {
  try { return (await execFileAsync(cmd, args, { timeout: 8000 })).stdout; } catch { return ''; }
};
async function portsFromNetstat(adapter) {
  const stdout = await execFileSafe('netstat.exe', ['-ano']);
  if (!stdout) return [];
  const listening = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i.exec(line);
    if (m) {
      const port = Number(m[1]); const pid = Number(m[2]);
      if (port >= 1024 && port <= 65535) {
        if (!listening.has(pid)) listening.set(pid, []);
        listening.get(pid).push(port);
      }
    }
  }
  const tasklist = await execFileSafe('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const names = new Set([...(adapter.platforms.win32?.processNames ?? [])].map((n) =>
    n.toLowerCase().endsWith('.exe') ? n.toLowerCase() : `${n.toLowerCase()}.exe`));
  const pids = new Set();
  for (const line of tasklist.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && names.has(m[1].toLowerCase())) pids.add(Number(m[2]));
  }
  const ports = [];
  for (const pid of pids) for (const port of listening.get(pid) ?? []) if (!ports.includes(port)) ports.push(port);
  return ports;
}
let port, target;
for (const p of [...(await resolveDebugPorts(adapter, process.platform)), ...(await portsFromNetstat(adapter))]) {
  if (port) break;
  try {
    const targets = await findTargets(adapter, p);
    if (targets.length) { port = p; target = targets[0]; break; }
  } catch { /* not a live CDP port */ }
}
if (!target) { console.error('no doubao target'); process.exit(1); }
console.log('target port:', port, target.url);

const { default: WebSocket } = await import('ws').catch(() => ({ default: globalThis.WebSocket }));
class CdpClient {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.ws = null; this.msgId = 0; this.pending = new Map(); }
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error(`WS connect failed: ${this.wsUrl}`));
      this.ws.onmessage = (event) => {
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.id == null) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message));
        else p.resolve(msg.result ?? {});
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.ws?.close(); }
}

const client = new CdpClient(target.webSocketDebuggerUrl);
await client.connect();
await client.send('Runtime.enable').catch(() => {});

// 读取 tokens.css 全文
const tokensCss = readFileSync(resolve('engines/doubao/tokens.css'), 'utf-8');

// 构建注入表达式：替换现有 <style> 内容
const expression = `
(() => {
  const CSS = ${JSON.stringify(tokensCss)};
  // 查找或创建注入的 <style>
  let el = document.getElementById('agentskin-theme-doubao');
  if (!el) {
    el = document.createElement('style');
    el.id = 'agentskin-theme-doubao';
    document.documentElement.appendChild(el);
  }
  el.textContent = CSS;
  return 'OK: ' + CSS.length + ' chars injected';
})()
`;

const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
  expression,
  returnByValue: true,
  timeout: 5000,
});
if (exceptionDetails) {
  console.error('Inject failed:', exceptionDetails.text);
} else {
  console.log('Inject result:', result.value);
}

// 验证 body 上 --semi-color-primary 计算值
const { result: v1 } = await client.send('Runtime.evaluate', {
  expression: `getComputedStyle(document.body).getPropertyValue('--semi-color-primary').trim()`,
  returnByValue: true,
});
console.log('body --semi-color-primary after reapply:', v1?.value);

// 验证 scrollbar 容器
const { result: v2 } = await client.send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.querySelector('[class*="show-scrollbar-thumb"]');
    if (!el) return 'no scrollbar element';
    return getComputedStyle(el).getPropertyValue('--scrollbar-color-hover').trim();
  })()`,
  returnByValue: true,
});
console.log('scrollbar --scrollbar-color-hover after reapply:', v2?.value);

// 验证 --input-guidance 值
const { result: v3 } = await client.send('Runtime.evaluate', {
  expression: `(() => {
    const el = document.querySelector('.input-content-container-bMefgL');
    if (!el) return 'no input element';
    return getComputedStyle(el).getPropertyValue('--input-guidance-input-container-border').trim();
  })()`,
  returnByValue: true,
});
console.log('input --input-guidance-input-container-border after reapply:', v3?.value);

client.close();
console.log('done');