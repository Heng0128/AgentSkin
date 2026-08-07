// SPDX-License-Identifier: MPL-2.0

import path from 'node:path';
import { app, type BrowserWindow, type Tray } from 'electron';
import { toMessage } from '../shared/errors';
import { type AppLocale, DEFAULT_LOCALE } from '../shared/i18n';
import { IpcChannel } from '../shared/ipc-channels';
import { AGENT_IDS, type AgentId } from '../shared/types';
import type { AgentCatalog } from './catalog/agent-catalog';
import type { ThemeCatalog } from './catalog/theme-catalog';
import { BUNDLE_EXTENSION, FileOpenQueue } from './file-open';
import { installBundleFromPath } from './ipc/bundle-ipc';
import type {
  AgentEngineServiceApi,
  SettingsServiceApi,
  ThemeLibraryApi,
  WallpaperServiceApi,
} from './services/contracts';

/**
 * # Main Context
 *
 * Shared mutable runtime state for the main process. Extracted from the
 * module-level `let` declarations that used to live at the top of `main.ts`.
 *
 * Fields marked as definite-assigned (`!` semantically — enforced here via
 * the `MainContext` type) are populated during the boot sequence
 * (see `boot-sequence.ts`) before any IPC handler or tray action can fire.
 * Electron guarantees `app.whenReady()` resolves before `ipcMain.handle`
 * invocations arrive from the renderer, so late initialization is safe.
 */
export interface MainContext {
  mainWindow: BrowserWindow | null;
  /** Lightweight splash window shown during boot. Closed when the main
   *  window's `ready-to-show` fires. Null after splash is dismissed. */
  splashWindow: BrowserWindow | null;
  /** Dedicated, independently-closable Theme Studio window (opened on demand
   *  from the main window's sidebar). Null until first opened; reset to null
   *  on the window's `closed` event. */
  studioWindow: BrowserWindow | null;
  tray: Tray | null;
  isQuitting: boolean;
  /** True after `runBootSequence` completes successfully. IPC handlers and
   *  tray actions should check this before accessing late-bound services
   *  to avoid race conditions during shutdown or early access. */
  bootComplete: boolean;
  library: ThemeLibraryApi;
  core: AgentEngineServiceApi;
  settings: SettingsServiceApi;
  agentCatalog: AgentCatalog;
  themeCatalog: ThemeCatalog;
  /** Wallpaper service — optional because its initialization is degradable
   *  (wrapped in try-catch in boot-sequence). Null when wallpaper init failed;
   *  callers must null-check before using. */
  wallpapers: WallpaperServiceApi | null;
  fileOpens: FileOpenQueue;
  locale: AppLocale;
  userDataRoot: string;
}

/**
 * Singleton runtime context. The `as MainContext` cast bypasses the
 * missing initializers for late-bound fields (`library`, `core`, etc.) —
 * these are assigned in `runBootSequence` before any consumer reads them,
 * mirroring the original `let library: ThemeLibrary;` pattern.
 */
export const ctx: MainContext = {
  mainWindow: null,
  splashWindow: null,
  studioWindow: null,
  tray: null,
  isQuitting: false,
  bootComplete: false,
  wallpapers: null,
  fileOpens: new FileOpenQueue(),
  locale: DEFAULT_LOCALE,
  userDataRoot: '',
} as MainContext;

// ---------------------------------------------------------------------------
// Helpers that operate on ctx (kept here so all main-process modules share
// the same definitions of brandingRoot / sendLog / settingsDto / etc.)
// ---------------------------------------------------------------------------

/** Resolve the runtime/branding assets directory (packaged vs dev). */
export function brandingRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'runtime')
    : path.resolve(app.getAppPath(), 'assets', 'runtime');
}

/** Forward a log line to the renderer's runtime-log panel (if attached). */
export function sendLog(line: string): void {
  // Check both reference presence and isDestroyed(): after close-to-tray the
  // window reference may linger but webContents.send on a destroyed window
  // throws "Object has been destroyed".
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(IpcChannel.RUNTIME_LOG, line);
  }
}

/**
 * Notify the renderer that SystemStatus changed outside the 3s poll cadence
 * (after apply/restore/delete, tray actions, or boot-restore). The renderer
 * subscribes via `onStatusChanged` and triggers an immediate `refreshStatus()`
 * so the UI reflects the new state without waiting for the next poll tick.
 */
export function notifyStatusChanged(): void {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.webContents.send(IpcChannel.STATUS_CHANGED);
  }
}

/**
 * Wrap catalog items with a version + timestamp envelope. The renderer uses
 * `updatedAt` to bust its in-memory cache when the catalog changes.
 */
export function wrapCatalog<T>(items: T[]): { version: number; updatedAt: string; items: T[] } {
  return { version: 1, updatedAt: new Date().toISOString(), items };
}

/**
 * Build the settings DTO exposed to the renderer. All agents default to
 * port 0 (auto-detect) — the legacy hardcoded default ports (9336/9337/9338)
 * were removed because they misled users into setting dead-port overrides.
 * The port field is reserved for an explicit user override only.
 */
export function settingsDto(context: MainContext) {
  const defaultPorts = Object.fromEntries(AGENT_IDS.map((appId) => [appId, 0])) as Record<
    AgentId,
    number
  >;
  return context.settings.toDto(defaultPorts);
}

/**
 * Auto-import a theme package opened from the OS (double-click, "Open with",
 * drag-drop). New theme ids install silently; when the id is already taken
 * the renderer asks the user before replacing (imports never overwrite
 * silently). Used as the `fileOpens` sink and by `theme:open-file`.
 *
 * `.agentskin-bundle` combo packages take a different path: they are
 * directory-package archives (theme + wallpaper video) that must be unpacked
 * and installed via the bundle installer, not `library.importPackage` (which
 * only accepts single-file engine bundles).
 */
export async function handleThemeFileOpen(
  context: MainContext,
  filePath: string,
  updateTrayMenu: () => Promise<void>,
): Promise<void> {
  context.mainWindow?.show();
  context.mainWindow?.focus();
  try {
    if (filePath.endsWith(BUNDLE_EXTENSION)) {
      const theme = await installBundleFromPath(context, filePath);
      void updateTrayMenu();
      context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORTED, {
        theme,
        themes: await context.library.summaries(),
      });
      return;
    }
    const inspection = await context.library.inspectPackage(filePath);
    if (inspection.existing) {
      context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORT_CONFIRM, {
        path: filePath,
        incoming: inspection.incoming,
        existing: inspection.existing,
      });
      return;
    }
    const theme = await context.library.importPackage(filePath);
    void updateTrayMenu();
    context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORTED, {
      theme,
      themes: await context.library.summaries(),
    });
  } catch (error) {
    context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORT_FAILED, toMessage(error));
  }
}
