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
 */

import { app, nativeImage, net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { listAdapters, registerBuiltinAdapters } from '../adapters/registry';
import { AgentCatalog } from './catalog/agent-catalog';
import { ThemeCatalog } from './catalog/theme-catalog';
import { getThemesDir, pruneRemovedBuiltInThemes, seedBuiltInThemes } from './catalog/theme-seeder';
import { AgentEngineService } from './agent-engine-service';
import { extractThemeFilesFromArgv } from './file-open';
import { loadLocalePreference } from './locale-preferences';
import { SettingsService } from './settings-service';
import { ThemeLibrary } from './theme-library';
import { WALLPAPER_SCHEME, WallpaperService } from './wallpaper-service';
import { setMainLogListener } from './logger';
import { setMainLocale } from '../shared/i18n';
import type { AgentId } from '../shared/types';
import { brandingRoot, ctx, sendLog } from './main-context';
import { createTrayManager, type TrayManager } from './tray-manager';
import { registerIpc } from './ipc';

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

  ctx.userDataRoot = app.getPath('userData');
  ctx.locale = await loadLocalePreference(ctx.userDataRoot, app.getLocale());
  setMainLocale(ctx.locale);

  ctx.library = new ThemeLibrary(path.join(ctx.userDataRoot, 'themes'));
  await ctx.library.initialize();

  ctx.settings = new SettingsService(path.join(ctx.userDataRoot, 'settings.json'));
  await ctx.settings.initialize();

  ctx.wallpapers = new WallpaperService();
  ctx.wallpapers.setCustomDir(path.join(ctx.userDataRoot, 'wallpapers'));

  // Register the wallpaper streaming protocol handler so the sandboxed
  // renderer can load <video> sources via agentskin-wallpaper://.
  protocol.handle(WALLPAPER_SCHEME, async (request) => {
    const id = new URL(request.url).pathname.replace(/^\/+/, '');
    const videoPath = await ctx.wallpapers.videoPathFor(id);
    if (!videoPath) return new Response('wallpaper not found', { status: 404 });
    return net.fetch(pathToFileURL(videoPath).toString());
  });

  ctx.core = new AgentEngineService(ctx.library, path.join(ctx.userDataRoot, 'manager-state.json'), ctx.settings);
  ctx.core.setWallpaperService(ctx.wallpapers);
  ctx.core.setLogListener(sendLog);
  await ctx.core.initialize();

  ctx.agentCatalog = new AgentCatalog(listAdapters());

  // Seed built-in themes from themes/ directory into the library.
  const themesDir = getThemesDir();
  const bootThemes = await ctx.library.summaries();
  const installedIds = new Set(bootThemes.map((t) => t.id));
  const installedSnapshots = new Map(
    bootThemes.map((t) => [t.id, { version: t.version, contentHash: t.contentHash }]),
  );
  await seedBuiltInThemes(ctx.library, themesDir, installedSnapshots);
  // Remove built-in themes that were dropped from the bundle (upgrade path).
  await pruneRemovedBuiltInThemes(ctx.library, installedIds);
  // Clear active-theme references to themes that no longer exist (upgrade path).
  const finalThemeIds = new Set((await ctx.library.summaries()).map((t) => t.id));
  await ctx.core.reconcileActiveThemes(finalThemeIds);

  // Register video wallpapers bundled with installed themes so they appear
  // in the wallpaper list and can be activated when the theme is applied.
  // Themes that reference a Wallpaper Engine workshop item (workshopId) are
  // NOT registered here — those items are discovered by WallpaperService.scan()
  // from the Steam workshop directory. Only themes that bundle a local video
  // file (wallpaper.video) need registration here.
  const finalThemes = await ctx.library.summaries();
  for (const theme of finalThemes) {
    const wp = theme.wallpaper;
    if (!wp?.video) continue; // workshopId-only themes skip registration
    const videoPath = path.join(themesDir, theme.id, wp.video);
    await ctx.wallpapers.registerThemeWallpaper(theme.id, videoPath, theme.displayName);
  }

  ctx.themeCatalog = new ThemeCatalog(ctx.library);

  // Wire up tray + IPC. The tray manager owns updateTrayMenu; IPC handlers
  // receive it as a callback so they can refresh the menu after state mutations.
  const trayManager = createTrayManager(ctx, {
    onQuit: deps.onQuit,
    onApplyRequest: deps.onApplyRequest,
  });
  registerIpc(ctx, trayManager.updateTrayMenu);

  // Windows cold-start theme files arrive in argv.
  for (const filePath of extractThemeFilesFromArgv(process.argv)) ctx.fileOpens.handlePath(filePath);

  await deps.createWindow();

  // Flush catalog-layer warnings (buffered since library.initialize()) to
  // the renderer's runtime-log panel now that the window exists.
  setMainLogListener(sendLog);
  trayManager.createTray();

  return { trayManager };
}
