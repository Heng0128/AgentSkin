// SPDX-License-Identifier: MPL-2.0

/**
 * # launchd-manager — macOS LaunchAgent 生命周期管理
 *
 * 为 AgentSkin 提供 macOS 系统级守护能力，通过 LaunchAgent plist 实现：
 * - 登录时自动启动 AgentSkin
 * - 崩溃后自动重启（与进程内 watchdog 互补）
 * - 系统重启后自动恢复运行
 *
 * ## 与现有 watchdog 的关系
 *
 * | 层级 | 机制 | 覆盖场景 |
 * |------|------|----------|
 * | 进程内 | `watchdog.ts` / `hard-watchdog.ts` | 应用运行中的 CPU 滞缓、孤儿超时、busy-loop |
 * | 系统级 (本模块) | `launchd` LaunchAgent | 应用崩溃、系统重启、登录自启 |
 *
 * ## plist 模板
 *
 * 生成的 plist 文件写入 `~/Library/LaunchAgents/com.agentskin.launchd.plist`，
 * 包含 KeepAlive=true（崩溃自动重启）、RunAtLoad=true（登录自启）。
 *
 * ## 安全边界
 *
 * - 仅 macOS 平台可用（`process.platform === 'darwin'`）
 * - plist 中的 ProgramArguments 使用 `execFile` 直接执行（非 shell），避免注入
 * - 日志路径限定在 `~/Library/Logs/agentskin-launchd.log`
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** LaunchAgent plist 文件名 */
const PLIST_FILE_NAME = 'com.agentskin.launchd.plist';

/** plist 中 Label 标识 */
const PLIST_LABEL = 'com.agentskin.launchd';

/** 日志文件名 */
const LOG_FILE_NAME = 'agentskin-launchd.log';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** launchd 管理器依赖注入接口 */
export interface LaunchdDeps {
  /** 获取 AgentSkin 可执行文件路径（由调用方注入） */
  readonly getExecutablePath: () => string;
  /** 获取 AgentSkin 工作目录（默认 `process.cwd()`） */
  readonly getWorkingDirectory?: () => string;
  /** 日志输出函数 */
  readonly log?: (line: string) => void;
}

/** launchd 服务状态 */
export interface LaunchdStatus {
  /** 是否已安装 plist 文件 */
  readonly installed: boolean;
  /** 服务是否正在运行（launchd 已加载） */
  readonly loaded: boolean;
  /** plist 文件路径 */
  readonly plistPath: string;
  /** 日志文件路径 */
  readonly logPath: string;
  /** 退出码（仅 loaded=false 时有意义） */
  readonly exitCode: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 获取 plist 文件完整路径 */
function getPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', PLIST_FILE_NAME);
}

/** 获取日志文件完整路径 */
function getLogPath(): string {
  return path.join(os.homedir(), 'Library', 'Logs', LOG_FILE_NAME);
}

/** 当前平台是否为 macOS */
function isMacOS(): boolean {
  return process.platform === 'darwin';
}

// ---------------------------------------------------------------------------
// plist 生成
// ---------------------------------------------------------------------------

/** 生成 LaunchAgent plist XML 内容 */
function generatePlist(executablePath: string, workingDir: string): string {
  // 转义 XML 特殊字符
  const escapeXml = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${PLIST_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escapeXml(executablePath)}</string>
	</array>
	<key>WorkingDirectory</key>
	<string>${escapeXml(workingDir)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>${escapeXml(getLogPath())}</string>
	<key>StandardErrorPath</key>
	<string>${escapeXml(getLogPath())}</string>
	<key>ProcessType</key>
	<string>Interactive</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
	</dict>
</dict>
</plist>`;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** 模块级依赖（通过 configureLaunchd() 注入） */
let deps: LaunchdDeps | null = null;

/** 默认日志输出（无操作） */
const noopLog = (_line: string): void => {};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * 配置 launchd 管理器依赖。必须在调用其他函数前执行。
 */
export function configureLaunchd(newDeps: LaunchdDeps): void {
  deps = newDeps;
}

/**
 * 获取当前依赖（用于测试）。
 */
export function getLaunchdDeps(): LaunchdDeps | null {
  return deps;
}

/**
 * 检查当前平台是否支持 launchd。
 * 非 macOS 平台始终返回 false。
 */
export function isLaunchdSupported(): boolean {
  return isMacOS();
}

/**
 * 安装 LaunchAgent plist 文件。
 *
 * 仅写入 plist 文件，不自动加载。调用方需显式调用 `loadService()`。
 * 如果 plist 已存在，会被覆盖更新。
 *
 * @throws 非 macOS 平台抛出 Error
 * @throws 文件写入失败抛出 Error
 */
export async function installService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;

  const executablePath = deps!.getExecutablePath();
  const workingDir = deps?.getWorkingDirectory?.() ?? process.cwd();
  const plistPath = getPlistPath();

  log(`[launchd] Installing plist: ${plistPath}`);

  // 确保 LaunchAgents 目录存在
  const launchAgentsDir = path.dirname(plistPath);
  if (!existsSync(launchAgentsDir)) {
    await mkdir(launchAgentsDir, { recursive: true });
  }

  // 写入 plist
  const plistContent = generatePlist(executablePath, workingDir);
  await writeFile(plistPath, plistContent, 'utf-8');

  // 确保日志目录存在
  const logDir = path.dirname(getLogPath());
  if (!existsSync(logDir)) {
    await mkdir(logDir, { recursive: true });
  }

  log(`[launchd] Plist installed successfully`);
}

/**
 * 卸载 LaunchAgent（先停止服务，再删除 plist 文件）。
 *
 * @throws 非 macOS 平台抛出 Error
 */
export async function uninstallService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;

  log(`[launchd] Uninstalling service...`);

  // 先尝试卸载（如果已加载）
  try {
    await unloadService();
  } catch {
    // 忽略卸载错误（可能未加载）
  }

  // 删除 plist 文件
  const plistPath = getPlistPath();
  if (existsSync(plistPath)) {
    const { unlink } = await import('node:fs/promises');
    await unlink(plistPath);
    log(`[launchd] Plist removed: ${plistPath}`);
  } else {
    log(`[launchd] Plist not found (already removed)`);
  }
}

/**
 * 加载 LaunchAgent 服务（launchctl load）。
 *
 * 加载后 launchd 会根据 RunAtLoad=true 立即启动 AgentSkin，
 * 并在崩溃时根据 KeepAlive=true 自动重启。
 *
 * @throws 非 macOS 平台抛出 Error
 * @throws launchctl 命令失败抛出 Error
 */
export async function loadService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;
  const plistPath = getPlistPath();

  if (!existsSync(plistPath)) {
    throw new Error(`Plist not found: ${plistPath}. Call installService() first.`);
  }

  log(`[launchd] Loading service: ${plistPath}`);
  await execFileAsync('launchctl', ['load', plistPath]);
  log(`[launchd] Service loaded`);
}

/**
 * 卸载 LaunchAgent 服务（launchctl unload）。
 *
 * 卸载后 launchd 不再管理 AgentSkin 进程。
 *
 * @throws 非 macOS 平台抛出 Error
 * @throws launchctl 命令失败抛出 Error
 */
export async function unloadService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;
  const plistPath = getPlistPath();

  if (!existsSync(plistPath)) {
    log(`[launchd] Plist not found, skip unload`);
    return;
  }

  log(`[launchd] Unloading service: ${plistPath}`);
  await execFileAsync('launchctl', ['unload', plistPath]);
  log(`[launchd] Service unloaded`);
}

/**
 * 启动服务（仅当未加载时）。
 * 等价于 `launchctl start com.agentskin.launchd`。
 */
export async function startService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;

  log(`[launchd] Starting service: ${PLIST_LABEL}`);
  await execFileAsync('launchctl', ['start', PLIST_LABEL]);
  log(`[launchd] Service started`);
}

/**
 * 停止服务（仅当已加载时）。
 * 等价于 `launchctl stop com.agentskin.launchd`。
 */
export async function stopService(): Promise<void> {
  assertSupported();
  const log = deps?.log ?? noopLog;

  log(`[launchd] Stopping service: ${PLIST_LABEL}`);
  await execFileAsync('launchctl', ['stop', PLIST_LABEL]);
  log(`[launchd] Service stopped`);
}

/**
 * 获取 launchd 服务状态。
 *
 * 通过 `launchctl list com.agentskin.launchd` 查询服务状态。
 * 如果服务未返回（未加载），则 loaded=false。
 */
export async function getStatus(): Promise<LaunchdStatus> {
  assertSupported();

  const plistPath = getPlistPath();
  const installed = existsSync(plistPath);
  const logPath = getLogPath();

  let loaded = false;
  let exitCode: number | null = null;

  try {
    const { stdout } = await execFileAsync('launchctl', ['list', PLIST_LABEL]);
    // 解析输出：最后一行包含 "ExitCode" 字段
    // 格式: "{\n\tExitCode = 0;\n\t...}"
    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const match = line.match(/ExitCode\s*=\s*(-?\d+)/);
      if (match) {
        exitCode = Number.parseInt(match[1], 10);
        break;
      }
    }
    loaded = true;
  } catch {
    // launchctl list 返回非零退出码表示服务未加载
    loaded = false;
  }

  return { installed, loaded, plistPath, logPath, exitCode };
}

/**
 * 一次性引导安装并加载服务。
 *
 * 便捷函数，等价于 `await installService(); await loadService();`。
 */
export async function setupService(): Promise<void> {
  await installService();
  await loadService();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** 断言当前平台支持 launchd，否则抛出 Error。 */
function assertSupported(): void {
  if (!isMacOS()) {
    throw new Error('launchd is only supported on macOS (darwin)');
  }
}
