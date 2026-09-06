// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — 端口发现
 *
 * 复用项目 CDP 端口发现策略（DevToolsActivePort → PID argv → netstat）。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  findRunningPids,
  findTargets,
  getAdapter,
  resolveDebugPorts,
} from '../../src/engine/src/index.mjs';

const execFileAsync = promisify(execFile);

export async function probeTargetsOnPort(adapter, port) {
  try {
    const targets = await findTargets(adapter, port, 1200);
    return targets.length ? targets : null;
  } catch {
    return null;
  }
}

export async function explicitPortsFromPids(pids) {
  if (process.platform !== 'win32' || !pids.length) return [];
  let out = '';
  try {
    out = String(
      (await execFileAsync('wmic', ['process', 'get', 'processid,commandline', '/format:list']))
        .stdout ?? '',
    );
  } catch {
    return [];
  }
  const wanted = new Set(pids);
  const ports = [];
  for (const block of out.split(/\r?\n\s*\r?\n/)) {
    const pidMatch = /ProcessId=(\d+)/.exec(block);
    if (!pidMatch || !wanted.has(Number(pidMatch[1]))) continue;
    const cli = /CommandLine=(.*)/s.exec(block)?.[1];
    if (!cli) continue;
    const port = /--remote-debugging-port=(\d+)/.exec(cli)?.[1];
    if (port && Number(port) >= 1024 && Number(port) <= 65535) ports.push(Number(port));
  }
  return [...new Set(ports)].sort((a, b) => a - b);
}

export async function listeningPortsForPids(pids) {
  if (process.platform !== 'win32' || !pids.length) return [];
  let out = '';
  try {
    out = String((await execFileAsync('netstat', ['-ano'])).stdout ?? '');
  } catch {
    return [];
  }
  const wanted = new Set(pids.map(String));
  const ports = new Set();
  for (const raw of out.split('\n')) {
    const line = raw.trim();
    if (!line.includes('LISTENING')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) continue;
    if (!wanted.has(parts[parts.length - 1])) continue;
    const local = parts[1];
    if (!local.startsWith('127.0.0.1:') && !local.startsWith('[::1]:')) continue;
    const colon = local.lastIndexOf(':');
    if (colon < 0) continue;
    const port = Number(local.slice(colon + 1));
    if (port >= 1024 && port <= 65535) ports.add(port);
  }
  return [...ports];
}

/**
 * 复用项目 CDP 端口发现策略，返回 { port, adapter, targets }。
 * 显式 --port 时仅验证并返回；否则走三层自动发现。
 */
export async function discoverLivePort(agentName, explicitPort = null) {
  const adapter = getAdapter(agentName);
  if (explicitPort) {
    const tagets = await probeTargetsOnPort(adapter, explicitPort);
    if (tagets) return { port: explicitPort, adapter, targets: tagets };
    throw new Error(`[${agentName}] 显式端口 ${explicitPort} 无匹配 CDP target`);
  }

  // Layer 1: DevToolsActivePort 文件
  const filePorts = await resolveDebugPorts(adapter, process.platform);
  for (const port of filePorts) {
    const targets = await probeTargetsOnPort(adapter, port);
    if (targets) {
      console.log(`  ${agentName}: layer 1 (DevToolsActivePort 文件) — CDP on ${port}`);
      return { port, adapter, targets };
    }
  }

  // Layer 2: PID argv + netstat
  try {
    const pids = await findRunningPids(adapter, process.platform, null);
    const explicitPorts = await explicitPortsFromPids(pids);
    for (const port of explicitPorts) {
      const targets = await probeTargetsOnPort(adapter, port);
      if (targets) {
        console.log(`  ${agentName}: layer 2 (argv) — CDP on ${port}`);
        return { port, adapter, targets };
      }
    }
    const netstatPorts = await listeningPortsForPids(pids);
    for (const port of netstatPorts) {
      if (explicitPorts.includes(port)) continue;
      const targets = await probeTargetsOnPort(adapter, port);
      if (targets) {
        console.log(`  ${agentName}: layer 2 (netstat) — CDP on ${port}`);
        return { port, adapter, targets };
      }
    }
  } catch {
    // 进程探测尽力而为
  }

  throw new Error(
    `[${agentName}] 未发现存活 CDP 端口。请确认应用已以 --remote-debugging-port 启动，或用 --port 显式指定。`,
  );
}

/**
 * 从引擎适配器 rendererHints 中取主渲染器。
 */
export function pickPrimaryTarget(adapter, targets) {
  const hints = adapter?.rendererHints;
  const secondary = hints?.secondaryPatterns ?? [];
  const preferred = hints?.preferredUrlPatterns ?? [];
  const primaryPool = targets.filter((t) => !secondary.some((p) => String(t.url).includes(p)));
  const preferredHit = preferred.length
    ? targets.find((t) => preferred.some((p) => String(t.url).includes(p)))
    : null;
  const chosen = preferredHit ?? primaryPool[0] ?? targets[0];
  const skipped = targets.length - primaryPool.length;
  if (skipped) console.log(`  ✓ 跳过 ${skipped} 个次渲染器（rendererHints）`);
  if (preferredHit) console.log(`  ✓ 命中 preferredUrlPatterns 主渲染器（rendererHints）`);
  return chosen;
}
