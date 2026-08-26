// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Hot-Reload Service (P1)
 *
 * Coordinates theme hot-reload notifications to the renderer. After a theme
 * apply completes (via the fast-path cached port or the full-init path), the
 * apply flow calls {@link notifyThemeHotReload} which builds a
 * {@link ThemeHotReloadPayload} and pushes it to all renderer windows.
 *
 * ## Why a separate module?
 *
 * The hot-reload notification touches multiple concerns:
 *   1. Resolving the post-apply state (active theme, scheme, mode, wallpaper).
 *   2. Building the 14-token palette snapshot for UI preview.
 *   3. Fan-out to mainWindow + studioWindow (mirrors STATUS_CHANGED pattern).
 *   4. Coalescing rapid scheme-switches (e.g. user toggling light/dark
 *      quickly) into a single push to avoid UI thrash.
 *
 * Isolating these concerns keeps the apply flow focused on CDP injection and
 * gives the notification logic a single unit-testable home.
 *
 * ## Coalescing model
 *
 * A 50ms debounce window (mirrors `notifyStatusChanged` in main-context)
 * coalesces rapid successive hot-reload notifications for the SAME agent into
 * a single push carrying the latest payload. Cross-agent notifications are
 * independent — switching themes on traework and qoderwork simultaneously
 * produces two pushes (one per agent), not one.
 *
 * ## Direction
 *
 * Main → renderer only. The renderer never calls into this module. The
 * apply flow (theme-apply-flow.ts) is the sole producer.
 */

import type { BrowserWindow } from 'electron';
import { toMessage } from '../shared/errors';
import { IpcChannel } from '../shared/ipc-channels';
import type { AgentId } from '../shared/types';
import type { ThemeHotReloadPayload } from '../shared/types/theme';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Dependencies injected by the caller (boot-sequence / main-context).
 * Keeps the module free of direct singleton imports so it is unit-testable.
 */
export interface HotReloadNotifierDeps {
  /** Get the main application window (null when not yet created / destroyed). */
  mainWindow: BrowserWindow | null;
  /** Get the Theme Studio window (null when not open). */
  studioWindow: BrowserWindow | null;
}

// ---------------------------------------------------------------------------
// Coalescing state
// ---------------------------------------------------------------------------

/** Per-agent debounce timer. Keyed by agentId so cross-agent pushes are independent. */
const debounceTimers = new Map<AgentId, ReturnType<typeof setTimeout>>();

/** Per-agent pending payload (the most-recent state to push when the timer fires). */
const pendingPayloads = new Map<AgentId, ThemeHotReloadPayload>();

/** Coalescing window — mirrors STATUS_NOTIFY_DEBOUNCE_MS in main-context. */
const HOT_RELOAD_DEBOUNCE_MS = 50;

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Push a hot-reload notification to all renderer windows.
 *
 * Coalesces rapid successive calls for the same agent into a single push
 * carrying the latest payload. Cross-agent calls are independent.
 *
 * Safe to call from any context — window presence and `isDestroyed()` are
 * checked before every `webContents.send`. Failures are logged but swallowed
 * so a renderer crash never stalls the apply flow.
 */
export function notifyThemeHotReload(
  deps: HotReloadNotifierDeps,
  payload: ThemeHotReloadPayload,
): void {
  const { agentId } = payload;

  // Coalesce: replace any pending payload for this agent and reset the timer.
  pendingPayloads.set(agentId, payload);
  const existing = debounceTimers.get(agentId);
  if (existing !== undefined) clearTimeout(existing);

  const timer = setTimeout(() => {
    debounceTimers.delete(agentId);
    const finalPayload = pendingPayloads.get(agentId);
    pendingPayloads.delete(agentId);
    if (finalPayload) pushToRenderers(deps, finalPayload);
  }, HOT_RELOAD_DEBOUNCE_MS);

  debounceTimers.set(agentId, timer);
}

/**
 * Immediately flush any pending hot-reload notification for an agent,
 * bypassing the debounce window. Used on shutdown / window close so the
 * renderer always receives the final state.
 *
 * No-op when no pending payload exists for the agent.
 */
export function flushThemeHotReload(deps: HotReloadNotifierDeps, agentId: AgentId): void {
  const timer = debounceTimers.get(agentId);
  if (timer !== undefined) {
    clearTimeout(timer);
    debounceTimers.delete(agentId);
  }
  const payload = pendingPayloads.get(agentId);
  pendingPayloads.delete(agentId);
  if (payload) pushToRenderers(deps, payload);
}

/**
 * Clear all pending hot-reload notifications without pushing them.
 * Called during shutdown to prevent timers from keeping the event loop
 * alive after all windows are destroyed.
 */
export function clearPendingHotReloads(): void {
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer);
  }
  debounceTimers.clear();
  pendingPayloads.clear();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Fan-out a hot-reload payload to mainWindow + studioWindow.
 *
 * Mirrors the STATUS_CHANGED fan-out pattern in main-context.ts: both
 * windows receive the event so the Studio's token preview stays in sync
 * with the main window's theme indicator.
 */
function pushToRenderers(deps: HotReloadNotifierDeps, payload: ThemeHotReloadPayload): void {
  const windows: Array<BrowserWindow | null> = [deps.mainWindow, deps.studioWindow];
  for (const win of windows) {
    if (!win || win.isDestroyed()) continue;
    try {
      win.webContents.send(IpcChannel.THEME_HOT_RELOAD, payload);
    } catch (error) {
      // Renderer may have crashed mid-apply — log and continue so other
      // windows still receive the push.
      console.error(`[theme-hot-reload] webContents.send failed: ${toMessage(error)}`);
    }
  }
}
