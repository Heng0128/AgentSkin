// SPDX-License-Identifier: MPL-2.0

/**
 * # Main Entry Point
 *
 * Slim bootstrap for the AgentSkin main process. Owns only:
 *   - privileged-protocol scheme registration (must run before app ready)
 *   - single-instance lock + second-instance / open-file routing
 *   - top-level app event handlers (activate / before-quit / window-all-closed)
 *   - splash screen lifecycle (shown immediately, closed when boot completes)
 *
 * All initialization logic lives in `main/boot-sequence.ts`; IPC handlers in
 * `main/ipc/*`; tray in `main/tray-manager.ts`; window lifecycle in
 * `main/window-manager.ts`; shared state in `main/main-context.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog } from 'electron';
import { runBootSequence } from './main/boot-sequence';
import { extractThemeFilesFromArgv } from './main/file-open';
import { flushLocalePreference } from './main/locale-preferences';
import { ctx, drainDisposables } from './main/main-context';
import { disposeAudioBroadcast } from './main/wallpaper-injector';
import { createMainWindow } from './main/window-manager';
import { toMessage } from './shared/errors';
import { getMainMessages } from './shared/i18n';
import { IpcChannel } from './shared/ipc-channels';
import type { AgentId } from './shared/types';

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

app.on('second-instance', (_event, argv) => {
  // P2-2: Guard against a destroyed mainWindow (GPU/renderer crash leaves
  // the BrowserWindow JS wrapper non-null but isDestroyed()===true). Without
  // this, calling show() throws "Object has been destroyed" and the second
  // instance's file-open payload is dropped on the floor.
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.show();
    ctx.mainWindow.focus();
  }
  for (const filePath of extractThemeFilesFromArgv(argv)) ctx.fileOpens.handlePath(filePath);
});

// macOS file associations arrive via open-file (may fire before ready).
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  ctx.fileOpens.handlePath(filePath);
});

/**
 * Create and show a lightweight splash window (no React, no preload).
 * Used to give the user immediate visual feedback while the boot
 * sequence runs in the background.
 */
function createSplashWindow(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 400,
    height: 320,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    transparent: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      // Electron security defaults — splash content is local-only, and the
      // only renderer→main bridge is the small `splashApi` surface exposed
      // via contextBridge in preload.ts.
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      disableBlinkFeatures: 'Auxclick',
    },
  });

  // Load splash.html from project root (dev) or resources (packaged).
  if (app.isPackaged) {
    void splash.loadFile(path.join(process.resourcesPath, 'splash.html'));
  } else {
    void splash.loadFile(path.join(__dirname, '../..', 'splash.html'));
  }

  return splash;
}

/**
 * Smoothly transition from the splash screen to the main window.
 *
 * Instead of abruptly closing the splash and showing the main window,
 * we cross-fade: the splash fades out (opacity 1→0) while the main
 * window fades in (opacity 0→1) over a 150ms window.
 *
 * @param splash - The splash BrowserWindow to fade out.
 * @param mainWindow - The main BrowserWindow to fade in.
 * @param durationMs - Duration of the fade transition (default 150ms).
 * @returns Promise that resolves when the transition is complete.
 */
async function fadeOutSplash(
  splash: BrowserWindow,
  mainWindow: BrowserWindow,
  durationMs = 150,
): Promise<void> {
  // Step 1: Send fade-out command to splash renderer
  if (!splash.isDestroyed()) {
    splash.webContents.send(IpcChannel.SPLASH_PROGRESS, {
      label: '就绪',
      pct: 100,
      fadeOut: true,
    });
  }

  // Step 2: Start showing the main window with 0 opacity
  if (!mainWindow.isDestroyed()) {
    mainWindow.setOpacity(0);
    mainWindow.show();
  }

  // Step 3: Animate main window opacity from 0 → 1
  // Using setOpacity with requestAnimationFrame-style stepping
  const steps = 10;
  const intervalMs = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (mainWindow.isDestroyed()) break;
    mainWindow.setOpacity(i / steps);
  }

  // Step 4: Close splash after a brief delay to let its CSS animation finish
  await new Promise((resolve) => setTimeout(resolve, 50));
  if (!splash.isDestroyed()) {
    splash.close();
  }
}

/**
 * Single transition handler for the boot path. Invoked (via
 * `createMainWindow`'s `onReadyToShow`) exactly once when the main window has
 * its first paint ready. It clears the splash safety timeout and runs the
 * cross-fade from splash → main window, then surfaces any degraded-boot
 * warnings as toasts once the main window is on screen.
 *
 * Ownership of the main window's first display lives here (not in
 * `createMainWindow`) so the window is shown exactly once, and only after the
 * splash has begun fading out — preventing the splash from lingering on top
 * of an already-visible main window.
 */
// Module-level splash safety timeout (15s), armed in `whenReady` and cleared
// by `handleSplashTransition` once the main window is ready. Hoisted out of
// the `.then` callback so the transition handler can reach it.
let splashTimeout: ReturnType<typeof setTimeout> | undefined;

async function handleSplashTransition(warnings: string[]): Promise<void> {
  if (splashTimeout) {
    clearTimeout(splashTimeout);
    splashTimeout = undefined;
  }
  const splash = ctx.splashWindow;
  const mainWin = ctx.mainWindow;
  if (splash && !splash.isDestroyed() && mainWin) {
    await fadeOutSplash(splash, mainWin);
  } else if (mainWin) {
    // Splash already closed (timeout) — just show the main window.
    if (!mainWin.isDestroyed()) {
      mainWin.show();
    }
  }
  ctx.splashWindow = null;

  // Push degraded boot steps to the renderer so they surface as toasts
  // ("启动警告") once the main window is up. Safe to drop when the window
  // died — the warnings are also in the runtime log.
  if (warnings.length > 0 && mainWin && !mainWin.isDestroyed()) {
    try {
      mainWin.webContents.send(IpcChannel.BOOT_WARNINGS, warnings);
    } catch (error) {
      console.warn('[boot] failed to push boot warnings:', error);
    }
  }

  if (warnings.length > 0) {
    console.warn(`[boot] ${warnings.length} warning(s) during boot:`);
    for (const w of warnings) console.warn(`[boot]   ${w}`);
  }
}

app
  .whenReady()
  .then(async () => {
    // Show splash immediately — user sees the app is alive.
    ctx.splashWindow = createSplashWindow();

    // Safety timeout: close splash after 15s even if ready-to-show never fires
    // (e.g. GPU process crash, renderer hang).
    splashTimeout = setTimeout(() => {
      if (ctx.splashWindow && !ctx.splashWindow.isDestroyed()) {
        ctx.splashWindow.close();
        ctx.splashWindow = null;
      }
      splashTimeout = undefined;
    }, 15_000);

    try {
      await runBootSequence({
        // Boot path: hand the main window's ready-to-show to a single
        // transition handler (splash fade-out + main window fade-in) instead
        // of letting createMainWindow auto-show it. This fixes the race where
        // the always-on-top splash lingered on top of an already-visible main
        // window (the window was shown twice — once by createMainWindow and
        // again by fadeOutSplash).
        createWindow: (warnings) =>
          createMainWindow({
            rendererUrl: process.env.ELECTRON_RENDERER_URL,
            onReadyToShow: () => void handleSplashTransition(warnings),
          }),
        onQuit,
        onApplyRequest: requestTrayApply,
      });

      // Splash timeout stays armed until the transition runs; the transition
      // handler clears it the moment the main window is ready.
      if (!ctx.mainWindow) {
        // No main window was created (degraded boot) — close splash after a
        // short delay.
        clearTimeout(splashTimeout);
        setTimeout(() => {
          if (ctx.splashWindow && !ctx.splashWindow.isDestroyed()) {
            ctx.splashWindow.close();
          }
          ctx.splashWindow = null;
        }, 500);
      }
    } catch (error) {
      clearTimeout(splashTimeout);

      // Print the real cause to the terminal — boot failures previously only
      // surfaced in a dialog (sendLog is a no-op before the window exists, and
      // the dialog text is not echoed to stdout), leaving the console with only
      // the unhelpful "[boot] releasing resources after failure" line.
      console.error('[boot] startup failed:', error);
      console.warn('[boot] releasing resources after failure...');
      try {
        if (ctx.core && typeof (ctx.core as { dispose?: () => void }).dispose === 'function') {
          try {
            ctx.core.dispose();
          } catch (e) {
            console.warn('[boot] ctx.core.dispose() failed:', e);
          }
        }
      } catch {
        /* swallow */
      }

      try {
        const wallpapersAny = ctx.wallpapers as unknown as { dispose?: () => void };
        if (ctx.wallpapers && typeof wallpapersAny.dispose === 'function') {
          try {
            wallpapersAny.dispose();
          } catch (e) {
            console.warn('[boot] ctx.wallpapers.dispose() failed:', e);
          }
        }
      } catch {
        /* swallow */
      }

      try {
        if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
          try {
            ctx.mainWindow.destroy();
          } catch (e) {
            console.warn('[boot] ctx.mainWindow.destroy() failed:', e);
          }
        }
      } catch {
        /* swallow */
      }

      try {
        if (ctx.splashWindow && !ctx.splashWindow.isDestroyed()) {
          try {
            ctx.splashWindow.close();
          } catch (e) {
            console.warn('[boot] ctx.splashWindow.close() failed:', e);
          }
        }
      } catch {
        /* swallow */
      }
      ctx.splashWindow = null;

      // Boot failed — the audio sampler may already be running (a wallpaper
      // was applied before the failure). Kill it so the child process doesn't
      // outlive the app.
      try {
        disposeAudioBroadcast();
      } catch {
        /* swallow */
      }

      dialog.showErrorBox(getMainMessages().startupErrorTitle, toMessage(error));
      app.quit();
    }
  })
  .catch((error) => {
    dialog.showErrorBox(getMainMessages().startupErrorTitle, toMessage(error));
    app.quit();
  });

function onQuit(): void {
  ctx.isQuitting = true;
  app.quit();
}

/**
 * Forward a tray-initiated apply to the renderer, which runs its normal apply
 * flow (including the restart-confirmation dialog when the app is running).
 * The window is surfaced so the resulting toast / dialog is visible.
 */
function requestTrayApply(themeId: string, themeName: string, appId: AgentId): void {
  // P2-2: Same isDestroyed guard for tray-initiated actions. If the window
  // died (GPU crash), we can't show the dialog so just surface the apply
  // failure via console + return; attempting webContents.send on a dead
  // renderer would throw and break the tray menu for subsequent clicks.
  if (!ctx.mainWindow || ctx.mainWindow.isDestroyed()) return;
  ctx.mainWindow.show();
  ctx.mainWindow.focus();
  ctx.mainWindow.webContents.send(IpcChannel.TRAY_APPLY, { themeId, themeName, appId });
}

app.on('activate', () => {
  if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
    ctx.mainWindow.show();
  } else {
    void createMainWindow({ rendererUrl: process.env.ELECTRON_RENDERER_URL });
  }
});

app.on('before-quit', () => {
  ctx.isQuitting = true;

  // R6-7: 应用退出时排空 pending 文件打开队列。
  // 用户双击的主题文件如果在队列中未处理，将其写入临时位置供下次启动处理。
  try {
    const pendingFiles = ctx.fileOpens.drain();
    if (pendingFiles.length > 0) {
      console.log(`[before-quit] draining ${pendingFiles.length} pending file-open(s)`);
      // 将未处理的路径写入 pending-files.json，供下次启动处理。
      const pendingFile = path.join(ctx.userDataRoot, 'pending-files.json');
      fs.writeFileSync(pendingFile, JSON.stringify({ files: pendingFiles }, null, 2), 'utf8');
    }
  } catch (error) {
    console.warn('[before-quit] fileOpenQueue.drain() failed:', error);
  }

  // R6-21: 同步 flush locale preference，确保首次启动时异步写入的
  // preferences.json 在进程退出前已落盘。
  if (ctx.locale) {
    try {
      flushLocalePreference(ctx.userDataRoot, ctx.locale);
    } catch (error) {
      console.warn('[before-quit] flushLocalePreference failed:', error);
    }
  }

  // Best-effort: release module-scoped state (media tokens, streaming file
  // handles, cache maps) before the process exits. Swallow any dispose error
  // — shutdown must never hang.
  try {
    if (ctx.bootComplete) ctx.core.dispose();
  } catch (error) {
    console.warn('[before-quit] core.dispose() failed:', error);
  }

  // Release any live CDP inspect session if Theme Studio window is still
  // open at quit time — otherwise the WS outlives the app until next start.
  ctx.onStudioWindowClosed?.();

  // Drain teardown callbacks registered during boot (lifpaper lifecycle,
  // wallpaper media server, tray). Each wrapped in try/catch so quit
  // is never blocked by a throwing cleanup.
  drainDisposables();

  // Kill the long-lived PowerShell audio sampler if it is running (audio-
  // responsive scene/web wallpapers). Without this the child process outlives
  // the app and keeps sampling system audio forever.
  try {
    disposeAudioBroadcast();
  } catch (error) {
    console.warn('[before-quit] disposeAudioBroadcast() failed:', error);
  }
});

app.on('window-all-closed', () => {
  // Keep the manager alive in the tray so route changes can be reinjected.
});
