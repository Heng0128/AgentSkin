// SPDX-License-Identifier: MPL-2.0

/**
 * # Deep Link Manager
 *
 * Routes `agentskin://` OS-level deep links into the running AgentSkin
 * instance. Follows the queue-until-sink pattern established by
 * `FileOpenQueue`: URLs that arrive before the renderer is ready (most
 * commonly the macOS `open-url` event firing before `app.whenReady()`)
 * are buffered and replayed the moment a handler is registered.
 *
 * ## Lifecycle
 *
 * 1. `DeepLinkManager` is instantiated early (during `whenReady`) so it
 *    can buffer `open-url` events that may arrive before boot completes.
 * 2. The renderer bootstraps and registers a handler via IPC (eventually),
 *    or the boot sequence registers a handler that routes through IPC.
 * 3. Pending URLs are flushed in arrival order.
 *
 * ## Security
 *
 * All URLs are parsed and validated by the pure functions in
 * `shared/deep-link-commands.ts` BEFORE they reach this module, so the
 * manager operates only on well-formed, command-level inputs. Path
 * traversal, malformed URLs, and unknown commands are rejected at parse
 * time.
 */

import { type DeepLinkCommand, parseDeepLink } from '../shared/deep-link-commands';

/** A parsed deep link waiting for a handler to be registered. */
interface PendingCommand {
  /** Original URL string (for logging). */
  raw: string;
  /** Parsed command. */
  command: DeepLinkCommand;
}

/**
 * Handler function type. Called for each deep link command once the
 * renderer is ready to receive it. Returns a promise so handlers can
 * perform async IPC operations.
 */
export type DeepLinkHandler = (command: DeepLinkCommand, rawUrl: string) => void | Promise<void>;

// ---------------------------------------------------------------------------
// DeepLinkManager
// ---------------------------------------------------------------------------

export class DeepLinkHandlerUnsetError extends Error {
  constructor() {
    super('DeepLinkHandler is not registered yet');
    this.name = 'DeepLinkHandlerUnsetError';
  }
}

export class DeepLinkManager {
  /** Max pending commands to buffer (prevents unbounded growth). */
  private static readonly MAX_PENDING = 20;

  private pending: PendingCommand[] = [];
  private handler: DeepLinkHandler | null = null;

  /**
   * Handle a raw `agentskin://` URL. Parses and validates, then either
   * dispatches immediately (if a handler is set) or buffers for later.
   *
   * @returns true if the URL was accepted (parsed + dispatched/queued),
   *          false if it was not an agentskin:// URL or failed to parse.
   */
  handleUrl(rawUrl: string): boolean {
    // Fast path: not our protocol — skip without allocating.
    if (!rawUrl.startsWith('agentskin://')) return false;

    let command: DeepLinkCommand;
    try {
      command = parseDeepLink(rawUrl);
    } catch (error) {
      console.warn(`[deep-link] parse failed for "${rawUrl}": ${(error as Error).message}`);
      return false;
    }

    if (this.handler) {
      try {
        void this.handler(command, rawUrl);
      } catch (error) {
        console.error(`[deep-link] handler threw for "${rawUrl}": ${(error as Error).message}`);
      }
    } else {
      // Buffer: no handler registered yet (pre-boot or handler churn).
      if (this.pending.length >= DeepLinkManager.MAX_PENDING) {
        const dropped = this.pending.shift();
        console.warn(
          `[deep-link] pending queue full (${DeepLinkManager.MAX_PENDING}), dropping oldest: ${dropped?.raw}`,
        );
      }
      this.pending.push({ raw: rawUrl, command });
      console.log(
        `[deep-link] buffered command "${command.command}" (queue: ${this.pending.length})`,
      );
    }
    return true;
  }

  /**
   * Register a handler for deep link commands. Immediately flushes any
   * buffered commands in FIFO order.
   *
   * Idempotent: re-registering replaces the previous handler (same
   * semantics as FileOpenQueue.setSink — supports React StrictMode and
   * hot reload).
   */
  setHandler(handler: DeepLinkHandler): void {
    this.handler = handler;
    // Flush buffered commands in arrival order.
    for (const { raw, command } of this.pending.splice(0)) {
      try {
        void handler(command, raw);
      } catch (error) {
        console.error(
          `[deep-link] handler threw for buffered "${raw}": ${(error as Error).message}`,
        );
      }
    }
  }

  /** Number of commands waiting for a handler. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /** True if a handler is currently registered. */
  get hasHandler(): boolean {
    return this.handler !== null;
  }

  /** Drain pending commands without dispatching (for shutdown). */
  drain(): PendingCommand[] {
    return this.pending.splice(0);
  }
}

/** Singleton instance — one per process. */
export const deepLinkManager = new DeepLinkManager();
