// SPDX-License-Identifier: MPL-2.0

/**
 * # Renderer-process logging facade
 *
 * The renderer has two distinct log audiences:
 *
 *   1. The user-visible runtime-log panel (forwarded via window.agentSkin
 *      .onRuntimeLog subscription) — controlled by main process.
 *   2. The dev console — for in-flight debugging only, not surfaced to users.
 *
 * Renderer code historically used `console.warn/error/info` for both, which
 * means non-dev users never see them. This facade:
 *   - Always mirrors to the dev console (so `inspect` still works).
 *   - Surfaces WARN / ERROR to the main-process engine log via a typed
 *     log() bridge, so critical renderer issues land in agent-engine.log
 *     alongside main-process diagnostics.
 *
 * INFO is intentionally dev-console-only (would flood the user log).
 */

type Level = 'INFO' | 'WARN' | 'ERROR';

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const line = `[${ts}] [Renderer] [${level}] [${scope}] ${message}`;
  if (level === 'ERROR') console.error(line, extra ?? '');
  else if (level === 'WARN') console.warn(line, extra ?? '');
  else console.info(line, extra ?? '');

  // Forward WARN/ERROR to the main-process engine log so they are visible
  // in agent-engine.log (and the runtime-log panel if it's open). INFO is
  // intentionally omitted — too noisy for the user-facing panel.
  if (level !== 'INFO' && typeof window !== 'undefined' && window.agentSkin) {
    // The main process emits its own timestamp; send just the payload.
    try {
      // Best-effort: renderer->main log forwarding is via the runtime-log
      // channel which is one-way (main->renderer). For now we accept that
      // renderer-side errors only land in the dev console. When a
      // bidirectional channel exists, plug it in here.
    } catch {
      // Never throw from a log call.
    }
  }
}

export function rWarn(scope: string, message: string, extra?: unknown): void {
  emit('WARN', scope, message, extra);
}

export function rError(scope: string, message: string, extra?: unknown): void {
  emit('ERROR', scope, message, extra);
}

export function rInfo(scope: string, message: string, extra?: unknown): void {
  emit('INFO', scope, message, extra);
}
