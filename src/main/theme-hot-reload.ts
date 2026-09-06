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

import path from 'node:path';
import chokidar from 'chokidar';
import type { BrowserWindow } from 'electron';
import { toMessage } from '../shared/errors';
import { IpcChannel } from '../shared/ipc-channels';
import type { AgentId } from '../shared/types';
import type { ThemeHotReloadPayload } from '../shared/types/theme';
import { IpcEventBus } from './ipc/ipc-event-bus';

// ---------------------------------------------------------------------------
// WatchTheme — file watcher lifecycle management (V3 Phase 2)
// ---------------------------------------------------------------------------

/**
 * Channel used to broadcast theme file-change events to the renderer and any
 * other IPC consumers in the main process. The orchestration layer subscribes
 * to this channel to trigger {@link applyThemeFlow} for re-injection.
 */
const THEME_FILE_CHANGED_CHANNEL = 'theme:file-changed';

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
// Theme file watcher (V3 Phase 2 infrastructure)
// ---------------------------------------------------------------------------

/** Debounce via chokidar's awaitWriteFinish (cross-platform stable). */
const WATCH_STABILITY_THRESHOLD_MS = 300;
const WATCH_POLL_INTERVAL_MS = 100;

/**
 * Watch a theme directory for file changes (CSS / manifest.json / assets).
 *
 * - Uses chokidar for cross-platform, stable file watching — handles editor
 *   atomic writes (rename tempfile -> target) that break fs.watch handles
 *   on Windows.
 * - awaitWriteFinish coalesces rapid writes (300ms stability threshold).
 * - Glob filtering: only watches .css / .json / .agentskin-theme files.
 * - Ignores __pycache__, .DS_Store, editor temp files (regex ignored option).
 * - Returns a cleanup function that closes the watcher.
 *
 * This is purely infrastructure — the caller decides what to do when a
 * file changes (e.g. re-inject, broadcast, etc.). No apply/reload logic
 * is invoked from here.
 *
 * @param appId - The agent/application ID (for logging/context only).
 * @param targetPath - Absolute path to the theme directory or file to watch.
 * @param onFileChange - Callback invoked with the changed file's absolute path.
 * @returns Cleanup function that closes the watcher.
 */
export function createThemeFileWatcher(
  appId: string,
  targetPath: string,
  onFileChange: (changedPath: string) => void,
): () => void {
  // 过滤函数：仅接受 .css / .json / .agentskin-theme
  const watchablePath = path.join(targetPath, '**/*.{css,json,agentskin-theme}');

  const watcher = chokidar.watch(watchablePath, {
    ignored: /(__pycache__|\.DS_Store|~|\.tmp|\.bak|\.swp)/i,
    persistent: true,
    ignoreInitial: true, // 忽略初始扫描事件
    awaitWriteFinish: {
      stabilityThreshold: WATCH_STABILITY_THRESHOLD_MS,
      pollInterval: WATCH_POLL_INTERVAL_MS,
    },
    // Windows 兼容：启用原子写入检测
    atomic: true,
  });

  watcher
    .on('change', (filePath: string) => {
      console.log(`[theme-file-watcher] ${appId}: changed ${filePath}`);
      onFileChange(filePath);
    })
    .on('add', (filePath: string) => {
      console.log(`[theme-file-watcher] ${appId}: added ${filePath}`);
      onFileChange(filePath);
    })
    .on('error', (error: unknown) => {
      console.warn(`[theme-file-watcher] ${appId}: watcher error: ${String(error)}`);
    });

  return (): void => {
    watcher.close().catch(() => {});
  };
}

// ---------------------------------------------------------------------------
// Watcher lifecycle — active watcher registry
// ---------------------------------------------------------------------------

/** Running watcher cleanup functions keyed by appId. */
const activeWatchers = new Map<string, () => void>();

/**
 * Start watching a theme directory for file changes and trigger re-injection on change.
 *
 * - Listens for .css / .json / .agentskin-theme file changes within the theme directory
 * - 300ms debounce coalesces rapid successive writes (handled by createThemeFileWatcher)
 * - On change, broadcasts a {@link THEME_FILE_CHANGED_CHANNEL} IPC event so the
 *   orchestration layer can call {@link applyThemeFlow} for re-injection
 * - Idempotent: calling again for an same appId while already watching is a no-op
 *
 * @param appId - Agent id to watch.
 * @param themeDir - Absolute path to the `.agentskin-theme` directory to monitor.
 * @param bundle - Current theme package (passed through to the IPC event so the
 *   orchestration layer has full context for re-injection without re-reading disk).
 */
export function startAppThemeWatch(appId: string, themeDir: string, bundle: unknown): void {
  if (activeWatchers.has(appId)) {
    return; // already running — idempotent
  }

  const cleanup = createThemeFileWatcher(appId, themeDir, (changedPath) => {
    try {
      // Broadcast file-change event via IPC; the orchestration layer (e.g.
      // agent-engine-service / main-context) listens on this channel and calls
      // applyThemeFlow to re-inject the updated theme.
      IpcEventBus.broadcast(THEME_FILE_CHANGED_CHANNEL, { appId, changedPath, bundle });
      console.log(`[watchTheme] ${appId}: ${changedPath} changed, re-inject triggered`);
    } catch (err) {
      console.warn(`[watchTheme] ${appId}: re-inject broadcast failed: ${toMessage(err)}`);
    }
  });

  activeWatchers.set(appId, cleanup);
}

/**
 * Stop watching file changes for a specific agent.
 *
 * No-op when no active watcher exists for the appId.
 */
export function stopAppThemeWatch(appId: string): void {
  const cleanup = activeWatchers.get(appId);
  if (cleanup) {
    cleanup();
    activeWatchers.delete(appId);
  }
}

/**
 * Stop all active theme file watchers.
 *
 * Called during shutdown to prevent file watchers from keeping the event loop
 * alive after all windows are destroyed.
 */
export function stopAllThemeWatches(): void {
  for (const cleanup of activeWatchers.values()) {
    cleanup();
  }
  activeWatchers.clear();
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/**
 * Fan-out a hot-reload payload to all registered windows via IpcEventBus.
 *
 * The bus handles window presence checks and destroyed-window filtering
 * automatically, so this function no longer needs to iterate windows directly.
 */
function pushToRenderers(_deps: HotReloadNotifierDeps, payload: ThemeHotReloadPayload): void {
  try {
    IpcEventBus.broadcast(IpcChannel.THEME_HOT_RELOAD, payload);
  } catch (error) {
    // Extremely unlikely — the bus swallows per-window errors — but defensively
    // log so we don't silently lose the notification.
    console.error(`[theme-hot-reload] broadcast failed: ${toMessage(error)}`);
  }
}
