// SPDX-License-Identifier: MPL-2.0

/**
 * # Boot Sequence
 *
 * Extracted from the `app.whenReady().then(...)` block in `main.ts` (H3).
 *
 * Owns the deterministic initialization order that brings the main process
 * from "app ready" to "fully operational": locale → library → settings →
 * wallpaper service → CDP core → catalogs → theme seeding → IPC → window →
 * tray.
 *
 * `createWindow` is injected because it owns window lifecycle hooks that
 * are tied to the main module (renderer URL resolution, event broadcasting).
 * `onQuit` and `onApplyRequest` are injected so this module stays free of
 * `app.quit()` and renderer-forwarding concerns.
 *
 * Progress updates are sent to the splash window via `sendSplashProgress`
 * so the user sees step-by-step loading status.
 */

import path from 'node:path';
import { app, nativeImage } from 'electron';
import { listAdapters, registerBuiltinAdapters } from '../adapters/registry';
import { toMessage } from '../shared/errors';
import { setMainLocale } from '../shared/i18n';
import { IpcChannel } from '../shared/ipc-channels';
import type { AgentId } from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import { AgentCatalog } from './catalog/agent-catalog';
import { ThemeCatalog } from './catalog/theme-catalog';
import { getThemesDir, pruneRemovedBuiltInThemes, seedBuiltInThemes } from './catalog/theme-seeder';
import { extractThemeFilesFromArgv } from './file-open';
import { registerIpc } from './ipc';
import { loadLocalePreference } from './locale-preferences';
import { setMainLogListener } from './logger';
import { brandingRoot, ctx, sendLog } from './main-context';
import { SettingsService } from './settings-service';
import { ThemeLibrary } from './theme-library';
import { createTrayManager, type TrayManager } from './tray-manager';
import { registerThemeWallpaperForInstalled } from './wallpaper/theme-wallpaper';
import { registerWallpaperLifecycle } from './wallpaper-lifecycle';
import { WallpaperService } from './wallpaper-service';

export interface BootDeps {
  /** Create and show the main browser window. Injected from `main.ts`. */
  createWindow: () => Promise<void>;
  /** Called when the tray "Quit" item is clicked. */
  onQuit: () => void;
  /** Forward a tray-initiated apply request to the renderer. */
  onApplyRequest: (themeId: string, themeName: string, appId: AgentId) => void;
}

export interface BootResult {
  trayManager: TrayManager;
}

export async function runBootSequence(deps: BootDeps): Promise<BootResult> {
  app.setName('AgentSkin');
  registerBuiltinAdapters();

  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIcon = nativeImage.createFromPath(path.join(brandingRoot(), 'icon.png'));
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }

  // --- Step 1: Locale (CRITICAL — i18n needed by all error messages) ---
  sendSplashProgress('初始化语言...', 5);
  ctx.userDataRoot = app.getPath('userData');
  ctx.locale = await loadLocalePreference(ctx.userDataRoot, app.getLocale());
  setMainLocale(ctx.locale);

  // --- Step 2: Theme library (CRITICAL — core depends on it) ---
  sendSplashProgress('加载主题库...', 15);
  ctx.library = new ThemeLibrary(path.join(ctx.userDataRoot, 'themes'));
  await ctx.library.initialize();

  // --- Step 3: Settings (CRITICAL — core depends on it) ---
  sendSplashProgress('加载设置...', 25);
  ctx.settings = new SettingsService(path.join(ctx.userDataRoot, 'settings.json'));
  await ctx.settings.initialize();

  // --- Step 4: Wallpaper service (DEGRADABLE — wallpaper is a nice-to-have) ---
  sendSplashProgress('初始化壁纸引擎...', 35);
  try {
    // P1-6: Use a temp variable so we only publish to `ctx` after both the
    // constructor and setCustomDir succeed. Previously if setCustomDir threw
    // (e.g. userData permissions error), `ctx.wallpapers` was set to a
    // half-initialized instance (no custom dir) and core.setWallpaperService
    // would consume the broken object.
    const wallpaperSvc = new WallpaperService();
    wallpaperSvc.setCustomDir(path.join(ctx.userDataRoot, 'wallpapers'));
    ctx.wallpapers = wallpaperSvc;
  } catch (error) {
    sendLog(`[boot] wallpaper service init failed, degrading: ${toMessage(error)}`);
  }

  // --- Step 5: CDP core engine (CRITICAL — the app's primary function) ---
  sendSplashProgress('启动 CDP 引擎...', 45);
  ctx.core = new AgentEngineService(
    ctx.library,
    path.join(ctx.userDataRoot, 'manager-state.json'),
    ctx.settings,
  );
  if (ctx.wallpapers) ctx.core.setWallpaperService(ctx.wallpapers);
  ctx.core.setLogListener(sendLog);
  await ctx.core.initialize();

  // --- Step 6: Catalogs + theme seeding (MIXED — catalog is critical,
  //     seeding/pruning is best-effort) ---
  sendSplashProgress('加载主题目录...', 60);
  ctx.agentCatalog = new AgentCatalog(listAdapters());

  const themesDir = getThemesDir();
  const bootThemes = await ctx.library.summaries();
  const installedIds = new Set(bootThemes.map((t) => t.id));
  const installedSnapshots = new Map(
    bootThemes.map((t) => [t.id, { version: t.version, contentHash: t.contentHash }]),
  );
  // Theme seeding is best-effort: a corrupted seed theme shouldn't block startup.
  try {
    await seedBuiltInThemes(ctx.library, themesDir, installedSnapshots);
    await pruneRemovedBuiltInThemes(ctx.library, installedIds);
  } catch (error) {
    sendLog(`[boot] theme seeding partial failure, continuing: ${toMessage(error)}`);
  }
  // Single summaries() call after seeding — the result is reused for both
  // reconcileActiveThemes and wallpaper registration. The entries cache
  // was invalidated by seed/prune mutations, so this re-reads from disk.
  const finalThemes = await ctx.library.summaries();
  const finalThemeIds = new Set(finalThemes.map((t) => t.id));
  await ctx.core.reconcileActiveThemes(finalThemeIds);

  // Register video wallpapers bundled with installed themes (best-effort).
  // Shared with runtime theme installs via registerThemeWallpaperForInstalled:
  // directory-package themes record their package root in `theme.packageRoot`
  // (pywal wallpaper-themes, bundle installs); built-in themes fall back to
  // the app's themes dir (unchanged behavior).
  for (const theme of finalThemes) {
    const packageRoot = theme.packageRoot ?? themesDir;
    await registerThemeWallpaperForInstalled(ctx, theme, packageRoot, (line) => sendLog(line));
  }

  ctx.themeCatalog = new ThemeCatalog(ctx.library);

  // --- Step 7: IPC + tray (CRITICAL — without IPC the UI can't communicate) ---
  sendSplashProgress('注册 IPC 处理器...', 75);
  const trayManager = createTrayManager(ctx, {
    onQuit: deps.onQuit,
    onApplyRequest: deps.onApplyRequest,
  });
  registerIpc(ctx, trayManager.updateTrayMenu);
  registerWallpaperLifecycle();

  // Windows cold-start theme files arrive in argv.
  for (const filePath of extractThemeFilesFromArgv(process.argv))
    ctx.fileOpens.handlePath(filePath);

  // --- Step 8: Create main window (CRITICAL — UI must appear) ---
  sendSplashProgress('打开主窗口...', 90);
  await deps.createWindow();

  // Flush catalog-layer warnings to the renderer's runtime-log panel.
  setMainLogListener(sendLog);
  trayManager.createTray();

  ctx.bootComplete = true;
  sendSplashProgress('就绪', 100);
  return { trayManager };
}

/**
 * Send a progress update to the splash window.
 * Imported lazily to avoid a circular dependency with main.ts.
 */
function sendSplashProgress(label: string, pct: number): void {
  if (ctx.splashWindow && !ctx.splashWindow.isDestroyed()) {
    ctx.splashWindow.webContents.send(IpcChannel.SPLASH_PROGRESS, { label, pct });
  }
}
