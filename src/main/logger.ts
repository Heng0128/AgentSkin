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
import type { AppLocale } from '../shared/i18n';

type LogListener = (line: string) => void;

let listener: LogListener | null = null;
// K-10: tracks the application locale so timestamps match the UI language.
// Defaults to 'zh-CN' until setLoggerLocale is called during boot.
let currentLocale: AppLocale = 'zh-CN';

/** Set the locale used for log-line timestamps. Called on boot + locale change. */
export function setLoggerLocale(locale: AppLocale): void {
  currentLocale = locale;
}

/** Build a locale-aware HH:mm:ss timestamp for log lines. */
function timestamp(): string {
  return new Date().toLocaleTimeString(currentLocale, { hour12: false });
}
// P3-11: Raised the buffered-early-log ceiling from 200 → 1000 entries.
// Cold boot now performs more work up-front (legacy migration for every
// theme dir, WallpaperEngine scan of ~hundreds of workshop folders, Steam
// registry probe, locale lookup) so the first 200 INFO entries would be
// consumed by "migrated legacy-dir" noise and the one WARN / ERROR the user
// actually needed (e.g. "theme X failed to parse") was dropped before the
// runtime-log panel even opened. We keep the cap so a runaway boot can't
// OOM the renderer, but widen it to cover the expanded boot surface.
const BUFFER_MAX = 1000;
// Keep the earliest WARN/ERROR entries when the buffer overflows — INFO
// lines are cheap and recoverable but a failure to parse or install
// during boot is exactly what users paste into bug reports.
const buffer: string[] = [];
const MAX_DROPPED_INFO = 50;

function emit(level: 'WARN' | 'ERROR' | 'INFO', scope: string, message: string): void {
  const ts = timestamp();
  const line = `[${ts}] [Main] [${level}] [${scope}] ${message}`;
  // Always mirror to the dev console so `electron --inspect` still works.
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.info(line);

  if (listener) {
    listener(line);
    return;
  }
  if (buffer.length < BUFFER_MAX) {
    buffer.push(line);
    return;
  }
  // Buffer is full. Prefer keeping the newest WARN/ERROR by evicting the
  // oldest INFO entry, up to MAX_DROPPED_INFO times. After that we fall
  // back to the traditional ring buffer (drop oldest regardless), so a
  // boot that produces 1000 WARN lines is still bounded.
  if (level === 'INFO') {
    // Newest entry is INFO and buffer is at cap → drop immediately. No
    // point evicting an older WARN/ERROR just to fit a fresh INFO line.
    return;
  }
  const oldestInfoIndex = buffer.findIndex((l) => l.includes('] [INFO]'));
  if (oldestInfoIndex >= 0 && MAX_DROPPED_INFO > 0) {
    // This check is purely static — MAX_DROPPED_INFO is a compile-time cap
    // so we don't need a mutable counter. If we ever need dynamic tuning
    // (e.g. per-platform) it can become a let.
    buffer.splice(oldestInfoIndex, 1);
    buffer.push(line);
    return;
  }
  // Last resort: classic ring buffer.
  buffer.shift();
  buffer.push(line);
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
 * Debug-level log, gated behind `DEBUG_CDP=1` (or any truthy value). This is
 * intentionally NOT sent to the renderer log buffer — it's purely for terminal
 * debugging via `console.debug`. The gate prevents chatty debug output from
 * accidentally flooding production logs or the renderer's log buffer, while
 * still being available on-demand via `DEBUG_CDP=1 npm start`.
 *
 * Usage:
 * ```
 * DEBUG_CDP=1 npm start
 * ```
 */
export function mainDebug(scope: string, message: string): void {
  if (process.env.DEBUG_CDP) {
    const ts = timestamp();
    console.debug(`[${ts}] [Main] [DEBUG] [${scope}] ${message}`);
  }
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
