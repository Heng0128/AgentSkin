// SPDX-License-Identifier: MPL-2.0

/**
 * # Boot Sequence
 *
 * Extracted from the `app.whenReady().then(...)` block in `main.ts` (H3).
 *
 * Owns the deterministic initialization order that brings the main process
 * from "app ready" to "fully operational": locale -> library -> settings ->
 * wallpaper service -> CDP core -> catalogs -> theme seeding -> IPC -> window ->
 * tray.
 *
 * `createWindow` is injected because it owns window lifecycle hooks that
 * are tied to the main module (renderer URL resolution, event broadcasting).
 * `onQuit` and `onApplyRequest` are injected so this module stays free of
 * `app.quit()` and renderer-forwarding concerns.
 *
 * Progress updates are sent to the splash window via a smooth interpolation
 * engine (`BootProgressReporter`) so the user sees continuous, real-looking
 * progress rather than jump-cut percentages.
 *
 * After the critical path (~45% mark), background warm-up tasks run in the
 * 60%-90% range to pre-compile theme CSS, build thumbnail cache indices,
 * and preload adapter modules - making first interactions snappier.
 *
 * Every step is individually try-catched so a single failure degrades
 * gracefully rather than crashing the entire boot sequence.
 */

import path from 'node:path';
import { app, nativeImage } from 'electron';
import { listAdapters, registerBuiltinAdapters } from '../adapters/registry';
import { toMessage } from '../shared/errors';
import { setMainLocale } from '../shared/i18n';
import { IpcChannel } from '../shared/ipc-channels';
import type { AgentId } from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import { BootProfiler } from './boot-profiler';
import { BootProgressReporter, type ProgressSender } from './boot-reporter';
import { AgentCatalog } from './catalog/agent-catalog';
import { ThemeCatalog } from './catalog/theme-catalog';
import { getThemesDir, pruneRemovedBuiltInThemes, seedBuiltInThemes } from './catalog/theme-seeder';
import { extractThemeFilesFromArgv } from './file-open';
import { registerIpc } from './ipc';
import { loadLocalePreference } from './locale-preferences';
import { brandingRoot, ctx, sendLog } from './main-context';
import { SettingsService } from './settings-service';
import { ThemeLibrary } from './theme-library';
import { createTrayManager, type TrayManager } from './tray-manager';
import { registerThemeWallpaperForInstalled } from './wallpaper/theme-wallpaper';
import { registerWallpaperLifecycle } from './wallpaper-lifecycle';
import { WallpaperService } from './wallpaper-service';
import { runWarmUp } from './warm-up/index';

export interface BootDeps {
  createWindow: () => Promise<void>;
  onQuit: () => void;
  onApplyRequest: (themeId: string, themeName: string, appId: AgentId) => void;
}

export interface BootResult {
  trayManager: TrayManager;
  warnings: string[];
}

async function runStep<T>(
  reporter: BootProgressReporter,
  profiler: BootProfiler,
  label: string,
  weight: number,
  fn: () => Promise<T>,
  warnMsg: string,
): Promise<{ ok: true; value: T } | { ok: false; warning: string }> {
  reporter.addStep(label, weight);
  reporter.advance(label, 0);
  profiler.begin(label);
  try {
    const value = await fn();
    profiler.end();
    reporter.completeStep(label);
    return { ok: true, value };
  } catch (error) {
    profiler.end();
    const warning = `${warnMsg}: ${toMessage(error)}`;
    sendLog(`[boot] ${warning}`);
    reporter.completeStep(label);
    // Surface the degraded step on the splash ("… (跳过)") so the user sees
    // the failure instead of a silently skipped step.
    reporter.skipped(label);
    return { ok: false, warning };
  }
}

export async function runBootSequence(deps: BootDeps): Promise<BootResult> {
  app.setName('AgentSkin');
  registerBuiltinAdapters();

  if (process.platform === 'darwin' && !app.isPackaged) {
    const dockIcon = nativeImage.createFromPath(path.join(brandingRoot(), 'icon.png'));
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
  }

  const sendProgress: ProgressSender = (label, pct) => {
    if (ctx.splashWindow && !ctx.splashWindow.isDestroyed()) {
      ctx.splashWindow.webContents.send(IpcChannel.SPLASH_PROGRESS, { label, pct });
    }
  };
  const reporter = new BootProgressReporter(sendProgress);
  const profiler = new BootProfiler();
  const warnings: string[] = [];

  // --- Step 1: Locale (CRITICAL) ---
  const localeResult = await runStep(
    reporter,
    profiler,
    '初始化语言...',
    5,
    async () => {
      ctx.userDataRoot = app.getPath('userData');
      ctx.locale = await loadLocalePreference(ctx.userDataRoot, app.getLocale());
      setMainLocale(ctx.locale);
    },
    'locale init failed',
  );
  if (!localeResult.ok) warnings.push(localeResult.warning);

  // --- Step 2: Theme library (CRITICAL) ---
  const libraryResult = await runStep(
    reporter,
    profiler,
    '加载主题库...',
    15,
    async () => {
      ctx.library = new ThemeLibrary(path.join(ctx.userDataRoot, 'themes'));
      await ctx.library.initialize();
    },
    'theme library init failed',
  );
  if (!libraryResult.ok) {
    warnings.push(libraryResult.warning);
    throw new Error(libraryResult.warning);
  }

  // --- Step 3: Settings (CRITICAL) ---
  const settingsResult = await runStep(
    reporter,
    profiler,
    '加载设置...',
    10,
    async () => {
      ctx.settings = new SettingsService(path.join(ctx.userDataRoot, 'settings.json'));
      await ctx.settings.initialize();
    },
    'settings init failed',
  );
  if (!settingsResult.ok) {
    warnings.push(settingsResult.warning);
    throw new Error(settingsResult.warning);
  }

  // --- Step 4: Wallpaper service (DEGRADABLE) ---
  const wallpaperResult = await runStep(
    reporter,
    profiler,
    '初始化壁纸引擎...',
    10,
    async () => {
      const wallpaperSvc = new WallpaperService();
      wallpaperSvc.setCustomDir(path.join(ctx.userDataRoot, 'wallpapers'));
      ctx.wallpapers = wallpaperSvc;
    },
    '壁纸引擎初始化失败',
  );
  if (!wallpaperResult.ok) warnings.push(wallpaperResult.warning);

  // --- Step 5: CDP core engine (CRITICAL) ---
  const coreResult = await runStep(
    reporter,
    profiler,
    '启动 CDP 引擎...',
    10,
    async () => {
      ctx.core = new AgentEngineService(
        ctx.library,
        path.join(ctx.userDataRoot, 'manager-state.json'),
        ctx.settings,
      );
      if (ctx.wallpapers) ctx.core.setWallpaperService(ctx.wallpapers);
      ctx.core.setLogListener(sendLog);
      await ctx.core.initialize();
    },
    'CDP引擎启动失败',
  );
  if (!coreResult.ok) {
    warnings.push(coreResult.warning);
    throw new Error(coreResult.warning);
  }

  // --- Step 6: Catalogs + theme seeding (MIXED) ---
  const catalogResult = await runStep(
    reporter,
    profiler,
    '加载主题目录...',
    15,
    async () => {
      ctx.agentCatalog = new AgentCatalog(listAdapters());

      const themesDir = getThemesDir();
      const bootThemes = await ctx.library.summaries();
      const installedIds = new Set(bootThemes.map((t) => t.id));
      const installedSnapshots = new Map(
        bootThemes.map((t) => [t.id, { version: t.version, contentHash: t.contentHash }]),
      );
      try {
        await seedBuiltInThemes(ctx.library, themesDir, installedSnapshots);
        await pruneRemovedBuiltInThemes(ctx.library, installedIds);
      } catch (error) {
        sendLog(`[boot] theme seeding partial failure, continuing: ${toMessage(error)}`);
      }
      const finalThemes = await ctx.library.summaries();
      const finalThemeIds = new Set(finalThemes.map((t) => t.id));
      await ctx.core.reconcileActiveThemes(finalThemeIds);

      for (const theme of finalThemes) {
        const packageRoot = theme.packageRoot ?? themesDir;
        await registerThemeWallpaperForInstalled(ctx, theme, packageRoot, (line) => sendLog(line));
      }

      ctx.themeCatalog = new ThemeCatalog(ctx.library);
    },
    '主题录加载失败',
  );
  if (!catalogResult.ok) warnings.push(catalogResult.warning);

  // --- Warm-up: run backgound tasks (60%->90%) ---
  const warmUpWarnings = await runWarmUp(ctx, reporter);
  for (const w of warmUpWarnings.warnings) warnings.push(`预热: ${w}`);

  // --- Step 7: IPC + tray (CRITICAL) ---
  const ipcResult = await runStep(
    reporter,
    profiler,
    '注册 IPC 处理器...',
    10,
    async () => {
      const mgr = createTrayManager(ctx, {
        onQuit: deps.onQuit,
        onApplyRequest: deps.onApplyRequest,
      });
      registerIpc(ctx, mgr.updateTrayMenu);
      registerWallpaperLifecycle();

      for (const filePath of extractThemeFilesFromArgv(process.argv))
        ctx.fileOpens.handlePath(filePath);

      return mgr;
    },
    'IPC注册失败',
  );
  if (!ipcResult.ok) {
    warnings.push(ipcResult.warning);
    throw new Error(ipcResult.warning);
  }
  const trayManager = ipcResult.value;

  // --- Step 8: Create main window (CRITICAL) ---
  const windowResult = await runStep(
    reporter,
    profiler,
    '打开主窗口...',
    10,
    async () => {
      await deps.createWindow();
    },
    '创建主窗口失败',
  );
  if (!windowResult.ok) {
    warnings.push(windowResult.warning);
    throw new Error(windowResult.warning);
  }

  // --- Finalize ---
  trayManager.createTray();

  ctx.bootComplete = true;
  reporter.completeBoot('就绪');

  // P0: boot performance report — total + slowest steps, for diagnosing slow
  // starts from the runtime log without DevTools.
  sendLog(profiler.report());

  return { trayManager, warnings };
}
