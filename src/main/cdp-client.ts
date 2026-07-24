// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-client
 *
 * Chrome DevTools Protocol session used by the desktop main process for
 * post-apply agent adjustments (color-scheme switching, DOM probes, theme
 * hardening, health checks, secondary-target injection).
 *
 * ## Semantics (aligned with @agentskin/core)
 *
 * The engine's `CdpSession` (node_modules/@codedrobe/core/src/cdp/session.mjs)
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

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: { message: string; code: number };
}

/**
 * Connect to a target's `webSocketDebuggerUrl`. Rejects if the socket does
 * not open within `openTimeoutMs`. Individual commands reject after
 * `commandTimeoutMs` (default 8000ms) so callers can decide whether to
 * retry, skip, or surface the failure.
 */
export function connectCdp(
  webSocketDebuggerUrl: string,
  openTimeoutMs = 5000,
  commandTimeoutMs = 8000,
): Promise<CdpSession> {
  const ws = new WebSocket(webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();

  ws.onmessage = (event: MessageEvent) => {
    let message: CdpResponse;
    try {
      message = JSON.parse(String(event.data)) as CdpResponse;
    } catch {
      return;
    }
    if (message.id != null && pending.has(message.id)) {
      const waiter = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new Error(`${message.error.message} (${message.error.code})`));
      } else {
        waiter.resolve(message.result);
      }
    }
  };

  const send = <T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP request timed out: ${method}`));
        }
      }, commandTimeoutMs);
      pending.set(id, {
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

  const session: CdpSession = {
    send,
    async evaluate(expression: string): Promise<string> {
      const result = await send<{
        result?: {
          value?: unknown;
          exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
      }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      const details = result?.result?.exceptionDetails;
      if (details) {
        const detail = details.exception?.description ?? details.text ?? 'unknown renderer error';
        throw new Error(`Renderer evaluation failed: ${detail}`);
      }
      return String(result?.result?.value ?? 'null');
    },
    close(): void {
      // Reject all pending commands so callers' await throws instead of hanging.
      const error = new Error('CDP session closed.');
      for (const waiter of pending.values()) waiter.reject(error);
      pending.clear();
      try {
        ws.close();
      } catch {
        // Already closed.
      }
    },
  };

  return new Promise<CdpSession>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.close();
      reject(new Error('CDP connect timeout'));
    }, openTimeoutMs);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(session);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      session.close();
      reject(new Error('CDP connection failed'));
    };
  });
}
