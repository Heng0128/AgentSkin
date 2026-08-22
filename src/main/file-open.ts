// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import path from 'node:path';
import {
  agentThemeExtension,
  legacyThemeExtension,
  themeExtension,
} from '../legacy/agentskin-core-runtime';

/** `.agentskin-bundle` — Theme + Wallpaper combo package container. */
export const BUNDLE_EXTENSION = '.agentskin-bundle';

export function isThemePackagePath(value: string): boolean {
  // Only absolute paths are accepted — a bare relative name (or a path built
  // from attacker-controlled separators) must not reach the file reader.
  if (!path.isAbsolute(value)) return false;
  return (
    value.endsWith(agentThemeExtension) ||
    value.endsWith('.agentskin-theme') ||
    value.endsWith(themeExtension) ||
    value.endsWith(legacyThemeExtension) ||
    value.endsWith(BUNDLE_EXTENSION)
  );
}

/**
 * Theme packages passed on the command line (Windows double-click / "Open
 * with" routes the file path through argv on cold start and second-instance).
 */
export function extractThemeFilesFromArgv(
  argv: string[],
  exists: (candidate: string) => boolean = fs.existsSync,
): string[] {
  return argv.filter((argument) => isThemePackagePath(argument) && exists(argument));
}

/**
 * Queues file-open requests until the renderer can receive them (same
 * queue-until-sink pattern as DeepLinkManager). macOS "open-file" can fire
 * before app ready, and cold-start argv files arrive before the window loads.
 */
export class FileOpenQueue {
  // R6-6: pending 队列大小上限，防止大量文件同时 open 且 setSink 未注册时
  // 队列无限增长导致极低概率内存耗尽（恶意场景）。
  private static readonly MAX_PENDING = 50;

  private pending: string[] = [];
  private sink: ((filePath: string) => void) | null = null;

  handlePath(filePath: string): boolean {
    if (!isThemePackagePath(filePath)) return false;
    if (this.sink) {
      this.sink(filePath);
    } else {
      // R6-6: 队列超过上限时丢弃最旧的请求并警告。
      if (this.pending.length >= FileOpenQueue.MAX_PENDING) {
        const dropped = this.pending.shift();
        console.warn(
          `[FileOpenQueue] pending queue full (${FileOpenQueue.MAX_PENDING}), dropping oldest: ${dropped}`,
        );
      }
      this.pending.push(filePath);
    }
    return true;
  }

  setSink(sink: (filePath: string) => void): void {
    // Idempotent: re-registering a sink simply replaces the previous handler.
    // This happens normally on every `app:bootstrap` (dev-mode React StrictMode
    // double-invokes effects, and hot reload re-runs the bootstrap) — not an
    // error, so we don't warn. Any pending paths are flushed on every attach
    // (the queue is empty after the first attach, so this is a no-op later).
    this.sink = sink;
    for (const filePath of this.pending.splice(0)) sink(filePath);
  }

  // R6-7: 提供给 app before-quit 使用的排空方法。
  // 在应用退出时调用，将队列中未处理的路径返回给调用方处理
  // （如写入临时位置供下次启动处理）。
  drain(): string[] {
    const remaining = this.pending.splice(0);
    this.sink = null;
    return remaining;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}
