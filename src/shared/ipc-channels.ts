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

  // --- Wallpaper (wallpaper-ipc.ts) ---
  WALLPAPER_LIST: 'wallpaper:list',
  WALLPAPER_SET: 'wallpaper:set',
  WALLPAPER_IMPORT: 'wallpaper:import',
  WALLPAPER_DELETE: 'wallpaper:delete',
  WALLPAPER_SET_AGENT: 'wallpaper:set-agent',
  WALLPAPER_APPLY_AGENT: 'wallpaper:apply-agent',
  WALLPAPER_APPLY_TO_AGENT: 'wallpaper:apply-to-agent',
  WALLPAPER_REMOVE_FROM_AGENT: 'wallpaper:remove-from-agent',
  WE_DETECT: 'we:detect',

  // --- Window (window-ipc.ts) — renderer→main ---
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_TOGGLE_MAXIMIZE: 'window:toggle-maximize',
  WINDOW_CLOSE: 'window:close',
  WINDOW_IS_MAXIMIZED: 'window:is-maximized',

  // --- Main→renderer events ---
  RUNTIME_LOG: 'runtime:log',
  FILE_IMPORTED: 'file:imported',
  FILE_IMPORT_CONFIRM: 'file:import-confirm',
  FILE_IMPORT_FAILED: 'file:import-failed',
  TRAY_APPLY: 'tray:apply',
  WINDOW_MAXIMIZE_CHANGE: 'window:maximize-change',
} as const;

/** Union of all IPC channel names (for type-level validation in callers). */
export type IpcChannelName = (typeof IpcChannel)[keyof typeof IpcChannel];
