// SPDX-License-Identifier: MPL-2.0

import { app, type BrowserWindow, type Tray } from 'electron';
import path from 'node:path';
import type { AgentCatalog } from './catalog/agent-catalog';
import type { ThemeCatalog } from './catalog/theme-catalog';
import type { AgentEngineService } from './agent-engine-service';
import { FileOpenQueue } from './file-open';
import type { SettingsServiceApi, ThemeLibraryApi, WallpaperServiceApi } from './services/contracts';
import { DEFAULT_LOCALE, type AppLocale } from '../shared/i18n';
import { IpcChannel } from '../shared/ipc-channels';
import { AGENT_IDS, type AgentId } from '../shared/types';
import { toMessage } from '../shared/errors';

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
  tray: Tray | null;
  isQuitting: boolean;
  library: ThemeLibraryApi;
  core: AgentEngineService;
  settings: SettingsServiceApi;
  agentCatalog: AgentCatalog;
  themeCatalog: ThemeCatalog;
  wallpapers: WallpaperServiceApi;
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
  tray: null,
  isQuitting: false,
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
  ctx.mainWindow?.webContents.send(IpcChannel.RUNTIME_LOG, line);
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
  const defaultPorts = Object.fromEntries(
    AGENT_IDS.map((appId) => [appId, 0]),
  ) as Record<AgentId, number>;
  return context.settings.toDto(defaultPorts);
}

/**
 * Auto-import a theme package opened from the OS (double-click, "Open with",
 * drag-drop). New theme ids install silently; when the id is already taken
 * the renderer asks the user before replacing (imports never overwrite
 * silently). Used as the `fileOpens` sink and by `theme:open-file`.
 */
export async function handleThemeFileOpen(
  context: MainContext,
  filePath: string,
  updateTrayMenu: () => Promise<void>,
): Promise<void> {
  context.mainWindow?.show();
  context.mainWindow?.focus();
  try {
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
    context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORTED, { theme, themes: await context.library.summaries() });
  } catch (error) {
    context.mainWindow?.webContents.send(IpcChannel.FILE_IMPORT_FAILED, toMessage(error));
  }
}
