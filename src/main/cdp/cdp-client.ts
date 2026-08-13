// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-client
 *
 * Chrome DevTools Protocol session used by the desktop main process for
 * post-apply agent adjustments (color-scheme switching, DOM probes, theme
 * hardening, health checks, secondary-target injection).
 *
 * ## Semantics (aligned with @agentskin/engine)
 *
 * The engine's `CdpSession` (node_modules/@agentskin/engine/src/cdp/session.mjs)
 * treats failures as errors: `send` rejects on timeout, `evaluate` rejects on
 * renderer exception. This module mirrors that semantics so the two clients
 * are behaviorally interchangeable — callers use the same try/catch pattern
 * regardless of which session they hold, and a future migration to the
 * engine's CdpSession (once it ships as TS) requires no caller changes.
 *
 * Callers that need best-effort behavior (scheme sync, secondary inject)
 * wrap the call in try/catch; callers that need strict verification
 * (hardening, health check) let errors propagate.
 *
 * ## Two entry points (one socket core)
 *
 *   - `connectCdp` — request/response only (the original contract; all
 *     existing callers keep working unchanged).
 *   - `connectEventCdp` — adds `on(method, handler)` / `off(method, handler)`
 *     for CDP events (e.g. `Overlay.inspectNodeRequested`,
 *     `Target.targetCreated`). Replaces the duplicated event-aware client
 *     that used to live inside `inspect-session.ts`; the cdp-watcher
 *     (auto-inject new windows) consumes the same entry point.
 *
 * Both are thin views over {@link openCdpSocket}, the single
 * message-dispatch core. Event messages (no `id`, has `method`) are routed
 * to subscribed handlers; responses (has `id`) resolve/reject pending
 * commands. Unknown events with no subscribers are ignored.
 *
 * Relies on the global WebSocket client shipped with Node 22+ / Electron 37+.
 */

export interface CdpSession {
  /** Send a CDP command; rejects on timeout or socket error. */
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Evaluate JS in the page and return the result value as a string.
   *  Rejects on renderer exception or timeout. */
  evaluate(expression: string): Promise<string>;
  close(): void;
}

/**
 * A {@link CdpSession} that also exposes CDP event subscription. This is the
 * interface used by live-inspect (`Overlay.inspectNodeRequested`) and the
 * future cdp-watcher (`Target.targetCreated` etc.).
 */
export interface EventCdpSession extends CdpSession {
  /** Subscribe to a CDP event (e.g. 'Overlay.inspectNodeRequested'). */
  on(method: string, handler: (params: unknown) => void): void;
  /** Unsubscribe a handler previously registered with `on`. */
  off(method: string, handler: (params: unknown) => void): void;
}

interface CdpResponse {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string; code: number };
}

/** Per-socket dispatcher shared by both session views. */
interface CdpSocketCore {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  close(): void;
  on(method: string, handler: (params: unknown) => void): void;
  off(method: string, handler: (params: unknown) => void): void;
}

/**
 * Type guard for JSON.parse output from CDP WebSocket messages.
 * CDP JSON-RPC messages have a very small surface (id / method / result /
 * error), so a structural check prevents malformed JSON (or stray protocol
 * events without the expected shape) from corrupting the pending-request map.
 */
function isCdpResponse(x: unknown): x is CdpResponse {
  if (!x || typeof x !== 'object') return false;
  const rec = x as Record<string, unknown>;
  if (rec.id !== undefined && typeof rec.id !== 'number') return false;
  if (rec.method !== undefined && typeof rec.method !== 'string') return false;
  if (
    rec.result !== undefined &&
    typeof rec.result !== 'object' &&
    typeof rec.result !== 'string' &&
    typeof rec.result !== 'boolean' &&
    rec.result !== null
  ) {
    // CDP result can be any JSON value (primitives, objects, arrays, null) —
    // don't narrow further; just ensure error shape is valid below.
  }
  if (rec.error !== undefined) {
    const err = rec.error as Record<string, unknown>;
    if (!err || typeof err !== 'object') return false;
    if (typeof err.message !== 'string') return false;
    if (typeof err.code !== 'number') return false;
  }
  return true;
}

/**
 * Open a WebSocket to a target's `webSocketDebuggerUrl` and return the shared
 * dispatcher core (pending commands + event listeners). Rejects if the socket
 * does not open within `openTimeoutMs`. Individual commands reject after
 * `commandTimeoutMs` (default 8000ms) so callers can decide whether to
 * retry, skip, or surface the failure.
 */
function openCdpSocket(
  webSocketDebuggerUrl: string,
  openTimeoutMs = 5000,
  commandTimeoutMs = 8000,
): Promise<CdpSocketCore> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map<
    number,
    {
      timer?: ReturnType<typeof setTimeout>;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  // Guard flag: once the session is closing/closed, ignore further onerror /
  // onclose events. Without this, ws.onerror → session.close() → ws.close()
  // → ws.onclose can re-enter and cause a RangeError: Maximum call stack
  // size exceeded in the Promise rejection callbacks. This is especially
  // likely when multiple CDP targets are injected in parallel (each with its
  // own WebSocket) and several fail simultaneously.
  let closed = false;

  ws.onmessage = (event: MessageEvent) => {
    // Guard against non-string data in production
    if (typeof event.data !== 'string') return;

    let message: CdpResponse;
    try {
      const raw: unknown = JSON.parse(event.data);
      if (!isCdpResponse(raw)) return; // Malformed — ignore, don't corrupt pending map
      message = raw;
    } catch {
      // Don't crash the session on malformed JSON from the target
      return;
    }
    // Response (has an id) → resolve/reject a pending command.
    if (message.id != null && pending.has(message.id)) {
      const waiter = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    // Event (no id, has method) → dispatch to subscribed handlers. This is
    // the CDP-4 gap the old client had: events with no pending waiter were
    // silently dropped, which blocked Target.setDiscoverTargets auto-inject.
    if (message.method) {
      const set = listeners.get(message.method);
      if (set) {
        for (const h of set) {
          try {
            h(message.params);
          } catch {
            /* a bad listener must not break the socket */
          }
        }
      }
    }
  };

  // Reject all pending commands immediately when the socket closes
  // unexpectedly (agent crash, network issue). Without this, callers'
  // awaits hang until their individual command timeouts fire.
  const rejectAllPending = (error: Error): void => {
    // Clear every command-timeout timer so it cannot dangle in the event
    // loop after the session is gone (RC1: timer leak on close).
    for (const waiter of pending.values()) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };

  ws.onclose = () => {
    if (closed) return; // Already handled — prevent re-entrant stack overflow
    closed = true;
    rejectAllPending(new Error('CDP WebSocket closed unexpectedly'));
  };

  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      // Guard against sending on a closed/closing socket
      if (closed) {
        return reject(new Error('CDP session is closed'));
      }

      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP request timed out: ${method}`));
        }
      }, commandTimeoutMs);
      pending.set(id, {
        timer,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const close = (): void => {
    if (closed) return; // Already closed — prevent re-entrant stack overflow
    closed = true;
    // Reject all pending commands so callers' await throws instead of hanging,
    // and clear every command-timeout timer to avoid dangling handles (RC1).
    rejectAllPending(new Error('CDP session closed.'));
    // Drop all event subscriptions so handlers (and the closures they
    // capture) can be reclaimed as soon as the socket is gone (RC1).
    listeners.clear();
    try {
      ws.close();
    } catch {
      // Already closed.
    }
  };

  const core: CdpSocketCore = {
    send,
    close,
    on(method, handler) {
      let set = listeners.get(method);
      if (!set) {
        set = new Set();
        listeners.set(method, set);
      }
      set.add(handler);
    },
    off(method, handler) {
      listeners.get(method)?.delete(handler);
    },
  };

  return new Promise<CdpSocketCore>((resolve, reject) => {
    const timer = setTimeout(() => {
      close();
      reject(new Error('CDP connect timeout'));
    }, openTimeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(core);
    };
    ws.onerror = (_event: Event) => {
      if (closed) return; // Already handled — prevent re-entrant stack overflow
      // Don't set closed=true here; close() will set it and call ws.close().
      // If we set it first, close() would skip ws.close().
      clearTimeout(timer);
      try {
        close();
        reject(new Error('CDP connection failed'));
      } catch (err) {
        // close() can throw if already closing; reject with a wrapped error
        reject(
          new Error(`CDP connection failed: ${err instanceof Error ? err.message : String(err)}`),
        );
      }
    };
  });
}

/** Build the `evaluate` helper shared by both session views. */
function makeEvaluate(send: CdpSocketCore['send']): CdpSession['evaluate'] {
  return async function evaluate(expression: string): Promise<string> {
    const result = await send<{
      result?: {
        value?: unknown;
      };
      exceptionDetails?: { exception?: { description?: string }; text?: string };
    }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const details = result?.exceptionDetails;
    if (details) {
      const detail = details.exception?.description ?? details.text ?? 'unknown renderer error';
      throw new Error(`Renderer evaluation failed: ${detail}`);
    }
    return String(result?.result?.value ?? 'null');
  };
}

/**
 * Connect to a target's `webSocketDebuggerUrl` with a request/response-only
 * session. Rejects if the socket does not open within `openTimeoutMs`.
 * Individual commands reject after `commandTimeoutMs` (default 8000ms).
 */
export function connectCdp(
  webSocketDebuggerUrl: string,
  openTimeoutMs = 5000,
  commandTimeoutMs = 8000,
): Promise<CdpSession> {
  return openCdpSocket(webSocketDebuggerUrl, openTimeoutMs, commandTimeoutMs).then((core) => ({
    send: core.send,
    evaluate: makeEvaluate(core.send),
    close: core.close,
  }));
}

/**
 * Connect to a target's `webSocketDebuggerUrl` with an event-aware session
 * (`on`/`off` for CDP events in addition to send/evaluate/close). Used by
 * the live inspector (`Overlay.inspectNodeRequested`) and the cdp-watcher
 * (`Target.targetCreated` etc.). Same connection/timeout semantics as
 * {@link connectCdp}.
 */
export function connectEventCdp(
  webSocketDebuggerUrl: string,
  openTimeoutMs = 5000,
  commandTimeoutMs = 8000,
): Promise<EventCdpSession> {
  return openCdpSocket(webSocketDebuggerUrl, openTimeoutMs, commandTimeoutMs).then((core) => ({
    send: core.send,
    evaluate: makeEvaluate(core.send),
    close: core.close,
    on: core.on,
    off: core.off,
  }));
}
