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
 * After the critical path, background warm-up tasks run as their own progress
 * steps (between step 6 and step 7, spanning ~65%-80%) to pre-compile theme
 * CSS, build thumbnail cache indices, and preload adapter modules - making
 * first interactions snappier. They share the same normalized progress pool so
 * the bar never regresses.
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
import {
  type BootBaseline,
  estimateStepMs,
  loadBootBaseline,
  saveBootBaseline,
} from './boot-progress';
import { BootProgressReporter, type ProgressSender } from './boot-reporter';
import { AgentCatalog } from './catalog/agent-catalog';
import { ThemeCatalog } from './catalog/theme-catalog';
import { getThemesDir, pruneRemovedBuiltInThemes, seedBuiltInThemes } from './catalog/theme-seeder';
import { extractThemeFilesFromArgv } from './file-open';
import { registerIpc } from './ipc';
import { loadLocalePreference } from './locale-preferences';
import { brandingRoot, ctx, registerDisposable, sendLog } from './main-context';
import { SettingsService } from './settings-service';
import { ThemeLibrary } from './theme-library';
import { createTrayManager, type TrayManager } from './tray-manager';
import { registerThemeWallpaperForInstalled } from './wallpaper/theme-wallpaper';
import { registerWallpaperLifecycle } from './wallpaper-lifecycle';
import { wallpaperMediaServer } from './wallpaper-server';
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

// Per-step duration baseline (loaded once after `userDataRoot` is known).
// Cached at module scope so `runStep` can read it without threading a
// parameter through every call site. Reset on each boot.
let baselineCache: BootBaseline | null = null;

/** Test hook: reset the cached baseline between boot simulations. */
export function __resetBootBaselineCache(): void {
  baselineCache = null;
}

async function runStep<T>(
  reporter: BootProgressReporter,
  profiler: BootProfiler,
  label: string,
  _weight: number,
  fn: () => Promise<T>,
  warnMsg: string,
): Promise<{ ok: true; value: T } | { ok: false; warning: string }> {
  reporter.advance(label, 0);
  profiler.begin(label);

  // Advance the bar *within* the step by elapsed time vs the baseline estimate
  // so the splash tracks real loading time (a slow step creeps forward, a fast
  // step finishes quickly) instead of sitting still then jumping on completion.
  // Capped at 0.95 so completion still shows a small, honest step-up.
  const estimateMs = estimateStepMs(label, baselineCache ?? {});
  const stepStart = Date.now();
  const ticker = setInterval(() => {
    const pct = (Date.now() - stepStart) / estimateMs;
    reporter.advance(label, Math.min(0.95, pct));
  }, 33);

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
  } finally {
    clearInterval(ticker);
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

  // Pre-register every boot step and warm-up phase as one normalized progress
  // pool so the bar is strictly monotonic: boot steps and warm-up share the
  // same 0–100% scale, and warm-up sits between the boot steps that surround
  // it (steps 1–6 → 0–65%, warm-up → 65–80%, steps 7–8 → 80–100%). Registering
  // up front (instead of lazily in `runStep`) keeps `totalWeight` stable so the
  // reported percentage never regresses. The warm-up labels must match the
  // `startWarmUp()` calls in `runWarmUp`.
  reporter
    .addStep('初始化语言...', 5)
    .addStep('加载主题库...', 15)
    .addStep('加载设置...', 10)
    .addStep('初始化壁纸引擎...', 10)
    .addStep('启动 CDP 引擎...', 10)
    .addStep('加载主题目录...', 15)
    .addStep('预编译主题样式...', 5)
    .addStep('建立缩略图索引...', 5)
    .addStep('预加载适配器模块...', 5)
    .addStep('注册 IPC 处理器...', 10)
    .addStep('打开主窗口...', 10);

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
      // Load the per-step duration baseline now that userDataRoot is known, so
      // subsequent steps can size their progress slices by real loading time.
      baselineCache = loadBootBaseline(ctx.userDataRoot);
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

  // --- Warm-up: run background tasks as pre-registered steps (~65%->80%) ---
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
      const cleanupWallpaperLifecycle = registerWallpaperLifecycle();
      registerDisposable(cleanupWallpaperLifecycle);
      registerDisposable(() => {
        try {
          wallpaperMediaServer.stop();
        } catch {
          // swallow — never block quit on cleanup failure
        }
      });
      registerDisposable(() => {
        try {
          ctx.tray?.destroy();
        } catch {
          // swallow — tray may already be destroyed
        }
      });

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

  // Persist this boot's per-step durations so the next launch can size its
  // progress slices by real loading time (moving-average smoothed).
  saveBootBaseline(ctx.userDataRoot, profiler.getTimings());

  // P0: boot performance report — total + slowest steps, for diagnosing slow
  // starts from the runtime log without DevTools.
  sendLog(profiler.report());

  return { trayManager, warnings };
}
