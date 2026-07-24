// SPDX-License-Identifier: MPL-2.0

/**
 * Main-process logging facade.
 *
 * The catalog layer (ThemeLibrary, ThemePackageLoader, ThemeInstaller) and
 * other main-process modules historically used `console.warn/error/info`,
 * which only reach the dev terminal — invisible to end users. This facade
 * forwards the same messages to the renderer's runtime-log panel (via a
 * listener wired in main.ts) so users can see why a theme failed to load or
 * why a migration was skipped.
 *
 * Messages emitted before a listener is attached (during early boot, before
 * the window exists) are buffered and flushed when the listener is set.
 *
 * Engine-layer logs (AgentEngineService) already go through its own
 * `log()` / `setLogListener()` path; this module covers the rest of the
 * main process.
 */

import { toMessage } from '../shared/errors';

type LogListener = (line: string) => void;

let listener: LogListener | null = null;
const buffer: string[] = [];
const BUFFER_MAX = 200;

function emit(level: 'WARN' | 'ERROR' | 'INFO', scope: string, message: string): void {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] [Main] [${level}] [${scope}] ${message}`;
  // Always mirror to the dev console so `electron --inspect` still works.
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.info(line);

  if (listener) {
    listener(line);
  } else if (buffer.length < BUFFER_MAX) {
    buffer.push(line);
  }
}

/**
 * Attach the renderer-facing listener. Any messages buffered before this
 * call are flushed immediately. Wired in main.ts to `sendLog`.
 */
export function setMainLogListener(fn: LogListener | null): void {
  listener = fn;
  if (fn && buffer.length) {
    const pending = buffer.splice(0, buffer.length);
    for (const line of pending) fn(line);
  }
}

export function mainWarn(scope: string, message: string): void {
  emit('WARN', scope, message);
}

export function mainError(scope: string, message: string): void {
  emit('ERROR', scope, message);
}

export function mainInfo(scope: string, message: string): void {
  emit('INFO', scope, message);
}

/**
 * Log a caught error at WARN level, extracting its message safely via toMessage.
 * Replaces the `error instanceof Error ? error.message : String(error)`
 * pattern that would otherwise be inlined at every catch site.
 */
export function mainWarnFromCatch(scope: string, error: unknown, prefix = ''): void {
  const msg = toMessage(error);
  emit('WARN', scope, prefix ? `${prefix}: ${msg}` : msg);
}

/**
 * Log a caught error at ERROR level, extracting its message safely via toMessage.
 */
export function mainErrorFromCatch(scope: string, error: unknown, prefix = ''): void {
  const msg = toMessage(error);
  emit('ERROR', scope, prefix ? `${prefix}: ${msg}` : msg);
}
