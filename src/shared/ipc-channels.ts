// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Channel Contract
 *
 * Single source of truth for every IPC channel name used between the main
 * process, preload bridge, and renderer. Extracted from the scattered string
 * literals that used to live inline in `preload.ts`, `main/ipc/*-ipc.ts`,
 * `main.ts`, and `main-context.ts`.
 *
 * ## Why centralize?
 *
 * Before this module, a channel name like `'theme:apply'` was duplicated as
 * a raw string in 3 places (preload invoke, main handle, type comments).
 * A typo in any one location caused a silent runtime mismatch with no
 * compile-time error. Centralizing here gives us:
 *   1. IDE autocomplete on channel names
 *   2. Find-all-references refactoring support
 *   3. Compile-time typo detection
 *   4. A single grep target when auditing the IPC surface
 *
 * ## Convention
 *
 * Channel names follow `{domain}:{action}` kebab-case. The const groups below
 * mirror the domain split in `main/ipc/*-ipc.ts` so it's obvious which IPC
 * module handles which channel.
 *
 * ## Direction
 *
 * - `INVOKE` (renderer → main, request/response) — registered with
 *   `ipcMain.handle`, called with `ipcRenderer.invoke`.
 * - `SEND_RENDERER` (renderer → main, fire-and-forget) — registered with
 *   `ipcMain.on`, called with `ipcRenderer.send`.
 * - `SEND_MAIN` (main → renderer, events) — sent with
 *   `webContents.send`, subscribed via `ipcRenderer.on`.
 */

export const IpcChannel = {
  // --- Core (core-ipc.ts) ---
  APP_BOOTSTRAP: 'app:bootstrap',
  LOCALE_SET: 'locale:set',
  SYSTEM_STATUS: 'system:status',
  AGENT_LIST: 'agent:list',
  SHELL_SHOW_ITEM: 'shell:show-item',

  // --- Theme (theme-ipc.ts) ---
  THEME_LIST: 'theme:list',
  THEME_GET: 'theme:get',
  THEME_SEARCH: 'theme:search',
  THEME_FILTER: 'theme:filter',
  THEME_APPLY: 'theme:apply',
  THEME_RESTORE: 'theme:restore',
  THEME_IMPORT: 'theme:import',
  THEME_IMPORT_BYTES: 'theme:import-bytes',
  THEME_IMPORT_PATH: 'theme:import-path',
  THEME_OPEN_FILE: 'theme:open-file',
  THEME_EXPORT: 'theme:export',
  THEME_DELETE: 'theme:delete',

  // --- Settings (settings-ipc.ts) ---
  SETTINGS_GET: 'settings:get',
  SETTINGS_PICK_APP_PATH: 'settings:pick-app-path',
  SETTINGS_CLEAR_APP_PATH: 'settings:clear-app-path',
  SETTINGS_SET_APP_PORT: 'settings:set-app-port',
  SETTINGS_GET_CUSTOM_CSS: 'settings:get-custom-css',
  SETTINGS_SET_CUSTOM_CSS: 'settings:set-custom-css',

  // --- Wallpaper (wallpaper-ipc.ts) ---
  WALLPAPER_LIST: 'wallpaper:list',
  WALLPAPER_SET: 'wallpaper:set',
  WALLPAPER_IMPORT: 'wallpaper:import',
  WALLPAPER_DELETE: 'wallpaper:delete',
  WALLPAPER_SET_AGENT: 'wallpaper:set-agent',
  WALLPAPER_APPLY_AGENT: 'wallpaper:apply-agent',
  WALLPAPER_APPLY_TO_AGENT: 'wallpaper:apply-to-agent',
  WALLPAPER_REMOVE_FROM_AGENT: 'wallpaper:remove-from-agent',
  /** Resolve a wallpaper's media as a streamable loopback HTTP URL so the
   *  renderer can play video wallpapers without buffering the whole file. */
  WALLPAPER_VIDEO_URL: 'wallpaper:video-url',
  /** Resolve a scene/web wallpaper's loopback renderer URL (the same iframe
   *  renderer injected into agent windows) so the desktop UI background can
   *  render the wallpaper identically. */
  WALLPAPER_WEB_URL: 'wallpaper:web-url',
  WE_DETECT: 'we:detect',

  // --- Theme Studio (studio-ipc.ts) ---
  THEME_STUDIO_SNAPSHOT: 'studio:snapshot',
  /** Capture the agent's NATIVE (un-themed) appearance, then automatically
   *  re-apply the previously active theme. Returns the native snapshot. */
  THEME_STUDIO_SNAPSHOT_BASELINE: 'studio:snapshot:baseline',
  THEME_STUDIO_EXPORT: 'studio:export',
  /** Live-inspect: renderer asks main to enter DevTools-style pick mode. */
  THEME_STUDIO_INSPECT_START: 'studio:inspect:start',
  /** Live-inspect: renderer asks main to exit pick mode. */
  THEME_STUDIO_INSPECT_STOP: 'studio:inspect:stop',
  /** Main→renderer: a node was picked in live-inspect mode (InspectedNode). */
  THEME_STUDIO_INSPECT_RESULT: 'studio:inspect:result',
  /** Renderer (main window sidebar) asks the main process to open/focus the
   *  dedicated Theme Studio BrowserWindow. */
  STUDIO_OPEN: 'studio:open',
  /** Theme Studio projects (studio-project-ipc.ts) — file-backed, no installed themes. */
  STUDIO_PROJECT_LIST: 'studio:project:list',
  STUDIO_PROJECT_CREATE: 'studio:project:create',
  STUDIO_PROJECT_SAVE: 'studio:project:save',
  STUDIO_PROJECT_DELETE: 'studio:project:delete',
  STUDIO_PROJECT_IMPORT: 'studio:project:import',
  /** Theme Studio snapshot (heavy real-DOM capture) — persisted per project
   *  in `projects/<id>/snapshot.json` so the crafted preview survives reload. */
  STUDIO_SNAPSHOT_SAVE: 'studio:snapshot:save',
  STUDIO_SNAPSHOT_LOAD: 'studio:snapshot:load',

  // --- Window (window-ipc.ts) — renderer→main ---
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // --- Main→splash events ---
  SPLASH_PROGRESS: 'splash:progress',

  // --- Main→renderer events ---
  RUNTIME_LOG: 'runtime:log',
  FILE_IMPORTED: 'file:imported',
  FILE_IMPORT_CONFIRM: 'file:import-confirm',
  FILE_IMPORT_FAILED: 'file:import-failed',
  TRAY_APPLY: 'tray:apply',
  WINDOW_MAXIMIZE_CHANGE: 'window:maximize-change',
  /** Pushed by the main process whenever SystemStatus changes outside the
   *  3s poll cadence — e.g. after apply/restore completes, or when an
   *  agent process launch/exit is detected. The renderer subscribes to
   *  refresh its status cache immediately instead of waiting for the next
   *  poll tick. */
  STATUS_CHANGED: 'status:changed',
} as const;

/** Union of all IPC channel names (for type-level validation in callers). */
export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
