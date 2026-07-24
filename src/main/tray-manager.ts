// SPDX-License-Identifier: MPL-2.0

/**
 * # Tray Manager
 *
 * Extracted from `main.ts` (H3 of the god-file teardown).
 *
 * Owns the system tray lifecycle: icon selection, context-menu construction,
 * and the bridge between tray-initiated actions (apply / restore / quit) and
 * the rest of the app. The tray reads live state from {@link MainContext}
 * (`core.status()`, `library.summaries()`) on every menu refresh, so it
 * always reflects the current apply/installed-theme situation.
 *
 * Dependencies are injected via {@link TrayDeps} so this module stays free
 * of `app.quit()` and renderer-forwarding concerns — the caller (boot
 * sequence) wires those in.
 */

import path from 'node:path';
import {
  Menu,
  type MenuItemConstructorOptions,
  type NativeImage,
  nativeImage,
  Tray,
} from 'electron';
import { toMessage } from '../shared/errors';
import { getMainMessages } from '../shared/i18n';
import type { AgentId, InstalledTheme, SystemStatus } from '../shared/types';
import type { MainContext } from './main-context';
import { brandingRoot, sendLog } from './main-context';

export interface TrayDeps {
  /** Called when the user picks "Quit" from the tray menu. */
  onQuit: () => void;
  /**
   * Forward a tray-initiated apply to the renderer, which runs its normal
   * apply flow (including the restart-confirmation dialog when the app is
   * running). The window is surfaced so the resulting toast / dialog is
   * visible.
   */
  onApplyRequest: (themeId: string, themeName: string, appId: AgentId) => void;
}

export interface TrayManager {
  /** Create the tray icon and attach the double-click handler. */
  createTray(): void;
  /**
   * Rebuild the tray menu from live state. Every supported agent gets a
   * submenu showing its run state and active theme, with a per-app restore
   * action and a quick "apply theme" list (active theme checked). The
   * tooltip and icon reflect how many apps currently have a theme applied.
   */
  updateTrayMenu(): Promise<void>;
}

/** Load the tray icon, optionally the "active" variant carrying a status dot. */
function trayIconImage(active: boolean): NativeImage {
  const base = process.platform === 'darwin' ? 'trayTemplate' : 'tray-icon';
  const filename = active ? `${base}-active.png` : `${base}.png`;
  const source = nativeImage.createFromPath(path.join(brandingRoot(), filename));
  const icon = source.isEmpty() ? nativeImage.createEmpty() : source;
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

export function createTrayManager(ctx: MainContext, deps: TrayDeps): TrayManager {
  async function updateTrayMenu(): Promise<void> {
    if (!ctx.tray) return;
    const copy = getMainMessages();
    let status: SystemStatus;
    let themes: InstalledTheme[];
    try {
      [status, themes] = await Promise.all([ctx.core.status(), ctx.library.summaries()]);
    } catch (error) {
      sendLog(`[tray] menu refresh failed: ${toMessage(error)}`);
      return;
    }

    const themeNameById = new Map(themes.map((t) => [t.id, t.displayName] as const));
    const themedCount = status.apps.filter((a) => a.activeThemeId).length;
    ctx.tray.setToolTip(themedCount > 0 ? copy.trayTooltipActive(themedCount) : copy.trayTooltip);
    ctx.tray.setImage(trayIconImage(themedCount > 0));

    const appItems: MenuItemConstructorOptions[] = status.apps.map((appStatus) => {
      const activeName = appStatus.activeThemeId
        ? (themeNameById.get(appStatus.activeThemeId) ?? appStatus.activeThemeId)
        : null;
      const stateLabel = !appStatus.installed
        ? copy.trayAppNotInstalled
        : appStatus.running
          ? copy.trayAppRunning
          : copy.trayAppNotRunning;
      const themeLabel = activeName ? copy.trayAppThemed(activeName) : copy.trayAppNoTheme;

      const applyable = themes.filter((t) => t.supportedAgents.includes(appStatus.appId));
      const applySubmenu: MenuItemConstructorOptions[] =
        applyable.length > 0
          ? applyable.map((t) => ({
              label: t.displayName,
              type: 'checkbox' as const,
              checked: t.id === appStatus.activeThemeId,
              click: () => deps.onApplyRequest(t.id, t.displayName, appStatus.appId),
            }))
          : [{ label: copy.trayNoThemes, enabled: false }];

      return {
        label: appStatus.displayName,
        submenu: [
          { label: `${stateLabel} · ${themeLabel}`, enabled: false },
          {
            label: copy.trayRestoreApp(appStatus.displayName),
            enabled: Boolean(appStatus.activeThemeId),
            click: () =>
              void ctx.core
                .restore(appStatus.appId)
                .then(() => updateTrayMenu())
                .catch((error) => sendLog(toMessage(error))),
          },
          { label: copy.trayApplyTheme, submenu: applySubmenu },
        ],
      };
    });

    ctx.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: copy.trayOpen,
          click: () => {
            ctx.mainWindow?.show();
            ctx.mainWindow?.focus();
          },
        },
        { type: 'separator' },
        ...appItems,
        { type: 'separator' },
        {
          label: copy.trayRestore,
          click: () =>
            void ctx.core
              .restoreAll()
              .then(() => updateTrayMenu())
              .catch((error) => sendLog(toMessage(error))),
        },
        { type: 'separator' },
        { label: copy.trayQuit, click: () => deps.onQuit() },
      ]),
    );
  }

  function createTray(): void {
    ctx.tray = new Tray(trayIconImage(false));
    void updateTrayMenu();
    ctx.tray.on('double-click', () => ctx.mainWindow?.show());
  }

  return { createTray, updateTrayMenu };
}
