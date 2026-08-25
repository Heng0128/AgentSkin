// SPDX-License-Identifier: MPL-2.0

/**
 * App Discovery Enhanced — multi-platform install-path registry + scanner.
 * Quick: primary paths only. Deep: all roots + system commands (which / mdfind).
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentId } from '../shared/types';

export interface AppRegistryEntry {
  readonly id: AgentId;
  readonly name: string;
  readonly exeNames: readonly string[];
  readonly installPaths: readonly string[];
  readonly darwinBundles: readonly string[];
  readonly linuxExecutables: readonly string[];
}

export interface DiscoveredApp {
  readonly id: AgentId;
  readonly name: string;
  readonly path: string;
  readonly version: string | null;
  readonly platform: NodeJS.Platform;
}

export type ScanStrategy = 'quick' | 'deep';

export interface ScanOptions {
  strategy?: ScanStrategy;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
}

const DEFAULT_TIMEOUT_MS = 5000;

// Compact registry builder: each entry = { id, name, exe[], win[], mac[], lin[] }
function reg(
  id: AgentId,
  name: string,
  exe: string[],
  win: string[],
  mac: string[],
  lin: string[],
): AppRegistryEntry {
  return { id, name, exeNames: exe, installPaths: win, darwinBundles: mac, linuxExecutables: lin };
}

export const APP_REGISTRY: readonly AppRegistryEntry[] = [
  reg(
    'traework',
    'TRAE SOLO',
    ['TRAE SOLO.exe', 'TRAE SOLO CN.exe'],
    [
      '{ProgramFiles}\\TRAE SOLO',
      '{ProgramFiles}\\TRAE SOLO CN',
      '{LOCALAPPDATA}\\Programs\\TRAE SOLO',
    ],
    ['TRAE SOLO', 'TRAE SOLO CN'],
    ['trae-solo'],
  ),
  reg(
    'qoderwork',
    'QoderWork CN',
    ['QoderWork CN.exe'],
    ['{ProgramFiles}\\QoderWork CN', '{LOCALAPPDATA}\\Programs\\QoderWork CN'],
    ['QoderWork CN'],
    ['qoderwork'],
  ),
  reg(
    'workbuddy',
    'WorkBuddy',
    ['WorkBuddy.exe'],
    ['{ProgramFiles}\\WorkBuddy', '{LOCALAPPDATA}\\WorkBuddy'],
    ['WorkBuddy'],
    ['workbuddy'],
  ),
  reg(
    'doubao',
    'Doubao',
    ['Doubao.exe'],
    ['{ProgramFiles}\\Doubao', '{LOCALAPPDATA}\\Programs\\Doubao'],
    ['Doubao'],
    ['doubao'],
  ),
  reg(
    'codex',
    'ChatGPT Desktop',
    ['ChatGPT.exe'],
    ['{LOCALAPPDATA}\\Programs\\ChatGPT', '{ProgramFiles}\\ChatGPT'],
    ['ChatGPT'],
    ['chatgpt'],
  ),
  reg(
    'zcode',
    'ZCode',
    ['ZCode.exe'],
    ['{ProgramFiles}\\ZCode', '{LOCALAPPDATA}\\Programs\\ZCode'],
    ['ZCode'],
    ['zcode'],
  ),
];

function expand(template: string): string {
  return template.replace(/\{([^}]+)\}/g, (_m, v: string) => process.env[v] ?? '');
}

function expandPaths(templates: readonly string[]): string[] {
  return templates.map(expand).filter((p) => p.length > 0 && !p.includes('{'));
}

function windowsRoots(): string[] {
  const home = process.env.USERPROFILE ?? os.homedir();
  const vars = [
    process.env.ProgramFiles,
    process.env.ProgramW6432,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined,
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    home,
  ];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const p of vars) {
    const t = p?.trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}

/** Promisified execFile with timeout. */
function exec(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : stdout.trim());
    });
  });
}

/** Get product version: Windows PowerShell, macOS mdls, Linux --version. */
export async function getAppVersion(
  appPath: string,
  platform: NodeJS.Platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<string | null> {
  if (platform === 'win32') {
    const lit = appPath.replace(/'/g, "''");
    const script = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n$v = (Get-Item -LiteralPath '${lit}' -ErrorAction SilentlyContinue).VersionInfo\nif ($v) { "$($v.ProductVersion)" }`;
    const v = await exec(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      timeoutMs,
    );
    return v || null;
  }
  if (platform === 'darwin') {
    const v = await exec('mdls', ['-name', 'kMDItemVersion', '-raw', appPath], timeoutMs);
    return v && v !== '(null)' ? v : null;
  }
  const out = await exec(appPath, ['--version'], timeoutMs);
  const line = out.split('\n')[0] ?? '';
  const m = line.match(/(\d+\.\d+\.\d+([-.][\w.]+)?)/);
  return m ? m[1] : line || null;
}

async function findExe(
  dir: string,
  exeNames: readonly string[],
  timeoutMs: number,
): Promise<{ exePath: string; version: string | null } | null> {
  let entries: string[];
  try {
    if (!fs.statSync(dir).isDirectory()) return null;
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of exeNames) {
    const candidate = path.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile())
        return { exePath: candidate, version: await getAppVersion(candidate, 'win32', timeoutMs) };
    } catch {
      // continue
    }
  }
  let probed = 0;
  for (const file of entries) {
    if (probed >= 5 || !file.toLowerCase().endsWith('.exe')) continue;
    const candidate = path.join(dir, file);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
    } catch {
      continue;
    }
    probed++;
    const version = await getAppVersion(candidate, 'win32', timeoutMs);
    if (version) return { exePath: candidate, version };
  }
  return null;
}

async function winQuick(entry: AppRegistryEntry, timeoutMs: number): Promise<DiscoveredApp | null> {
  for (const dir of expandPaths(entry.installPaths)) {
    const found = await findExe(dir, entry.exeNames, timeoutMs);
    if (found)
      return {
        id: entry.id,
        name: entry.name,
        path: found.exePath,
        version: found.version,
        platform: 'win32',
      };
  }
  return null;
}

async function winDeep(entry: AppRegistryEntry, timeoutMs: number): Promise<DiscoveredApp | null> {
  const quick = await winQuick(entry, timeoutMs);
  if (quick) return quick;
  const dirNames = [
    ...new Set(
      entry.installPaths.map((p) => path.basename(p)).filter((b) => b && !b.includes('{')),
    ),
  ];
  for (const root of windowsRoots()) {
    for (const dirName of dirNames) {
      const found = await findExe(path.join(root, dirName), entry.exeNames, timeoutMs);
      if (found)
        return {
          id: entry.id,
          name: entry.name,
          path: found.exePath,
          version: found.version,
          platform: 'win32',
        };
    }
  }
  return null;
}

async function macQuick(entry: AppRegistryEntry, timeoutMs: number): Promise<DiscoveredApp | null> {
  const home = process.env.HOME ?? '';
  for (const searchDir of ['/Applications', home ? `${home}/Applications` : ''].filter(Boolean)) {
    for (const bundle of entry.darwinBundles) {
      const bundlePath = path.join(searchDir, `${bundle}.app`);
      try {
        if (fs.statSync(bundlePath).isDirectory())
          return {
            id: entry.id,
            name: entry.name,
            path: bundlePath,
            version: await getAppVersion(bundlePath, 'darwin', timeoutMs),
            platform: 'darwin',
          };
      } catch {
        // continue
      }
    }
  }
  return null;
}

async function linQuick(entry: AppRegistryEntry, timeoutMs: number): Promise<DiscoveredApp | null> {
  for (const exeName of entry.linuxExecutables) {
    const resolved = await exec('which', [exeName], timeoutMs);
    if (resolved)
      return {
        id: entry.id,
        name: entry.name,
        path: resolved,
        version: await getAppVersion(resolved, 'linux', timeoutMs),
        platform: 'linux',
      };
  }
  return null;
}

export async function scanApps(
  adapterId?: AgentId,
  options: ScanOptions = {},
): Promise<DiscoveredApp[]> {
  const {
    strategy = 'quick',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    platform = process.platform,
  } = options;
  const entries = adapterId ? APP_REGISTRY.filter((e) => e.id === adapterId) : [...APP_REGISTRY];
  const results: DiscoveredApp[] = [];
  for (const entry of entries) {
    let discovered: DiscoveredApp | null = null;
    if (platform === 'win32')
      discovered =
        strategy === 'deep' ? await winDeep(entry, timeoutMs) : await winQuick(entry, timeoutMs);
    else if (platform === 'darwin') discovered = await macQuick(entry, timeoutMs);
    else if (platform === 'linux') discovered = await linQuick(entry, timeoutMs);
    if (discovered) results.push(discovered);
  }
  return results;
}
