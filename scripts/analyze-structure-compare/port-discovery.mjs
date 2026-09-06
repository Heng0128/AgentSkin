// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 端口解析
 *
 * 复用引擎 launcher 的 DevToolsActivePort 发现，失败时回退 netstat。
 */

import { findTargets } from '../../src/engine/src/runtime/injector.mjs';
import { resolveDebugPorts } from '../../src/engine/src/runtime/launcher.mjs';
import { debugLog, execFileSafe } from './utils.mjs';

/**
 * 通过 netstat 反查 Agent 进程的监听端口。
 * 多开场景：遍历全部匹配 PID（而非仅首个），逐个反查监听端口，保证无实例遗漏。
 */
export async function portsFromNetstat(adapter) {
  const stdout = await execFileSafe('netstat.exe', ['-ano']);
  if (!stdout) return [];
  const listening = new Map(); // pid -> [ports]
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/i.exec(line);
    if (m) {
      const port = Number(m[1]);
      const pid = Number(m[2]);
      if (port >= 1024 && port <= 65535) {
        if (!listening.has(pid)) listening.set(pid, []);
        listening.get(pid).push(port);
      }
    }
  }
  const tasklist = await execFileSafe('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const names = new Set(
    [...(adapter.platforms.win32?.processNames ?? [])].map((n) =>
      n.toLowerCase().endsWith('.exe') ? n.toLowerCase() : `${n.toLowerCase()}.exe`,
    ),
  );
  const pids = new Set();
  for (const line of tasklist.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && names.has(m[1].toLowerCase())) pids.add(Number(m[2]));
  }
  const ports = [];
  for (const pid of pids) {
    for (const port of listening.get(pid) ?? []) if (!ports.includes(port)) ports.push(port);
  }
  debugLog(`${adapter.id}: netstat 命中 PID=[${[...pids].join(',')}] 端口=[${ports.join(',')}]`);
  return ports;
}

/**
 * 解析 Agent 的活跃 CDP 端口。
 * 1) DevToolsActivePort 文件（引擎同一套逻辑）
 * 2) netstat 回退：进程在跑但端口文件失效（新版改了 user-data 目录等）。
 */
export async function resolveLivePort(adapter) {
  const filePorts = await resolveDebugPorts(adapter, process.platform);
  debugLog(`${adapter.id}: DevToolsActivePort → [${filePorts.join(',')}]`);
  for (const port of filePorts) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) {
        debugLog(`${adapter.id}: 端口 ${port} 命中 ${targets.length} 个 renderer target`);
        return { port, targets };
      }
    } catch {
      /* 文件可能残留，端口未活 */
    }
  }
  for (const port of await portsFromNetstat(adapter)) {
    try {
      const targets = await findTargets(adapter, port);
      if (targets.length) {
        debugLog(`${adapter.id}: netstat 端口 ${port} 命中 ${targets.length} 个 renderer target`);
        return { port, targets };
      }
    } catch {
      /* 端口不是 CDP 端点 */
    }
  }
  return null;
}
