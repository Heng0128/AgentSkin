// SPDX-License-Identifier: MPL-2.0

/**
 * # Tray Manager
 *
 * Extracted from `main.ts` (H3 of the god-file teardown).
 *
 * Owns the system tray lifecycle: icon selection, context-menu construction,
 * and the bridge between tray-initiated actions (apply / restore / quit / pause
 * / reapply / quick-switch) and the rest of the app. The tray reads live state
 * from {@link MainContext} (`core.status()`, `library.summaries()`) on every
 * menu refresh, so it always reflects the current apply/installed-theme
 * situation.
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

// ---------------------------------------------------------------------------
// Hardcoded labels for new tray actions.
//
// TODO: externalise to src/shared/i18n/modules/main.ts when that module is
// next updated. They live here because the i18n module is managed separately
// and these labels were introduced alongside the quick-action feature.
// ---------------------------------------------------------------------------

const LABELS = {
  pauseAll: '暂停全部皮肤',
  resumeAll: '继续全部皮肤',
  reapplyAll: '重新应用全部',
  quickSwitch: '快速切换',
} as const;

// ---------------------------------------------------------------------------
// Dependency interface
// ---------------------------------------------------------------------------

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
  // -- New optional callbacks (backward compatible) --
  /** Pause all skin injection across every agent. */
  onPauseAll?: () => Promise<void>;
  /** Resume skin injection after a pause. */
  onResumeAll?: () => Promise<void>;
  /** Re-apply every agent's current theme (re-inject). */
  onReapplyAll?: () => Promise<void>;
  /**
   * Quick-switch the target agent to `themeId`. Called when the user picks
   * a theme from the "快速切换" submenu.
   */
  onQuickSwitchTheme?: (themeId: string, appId: AgentId) => Promise<void>;
  /** Returns whether skin injection is currently globally paused. */
  isPaused?: () => boolean;
  /** Returns the most-recently-used themes (most recent first). */
  getRecentThemes?: () => InstalledTheme[];
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

// ---------------------------------------------------------------------------
// Menu-section builders
// ---------------------------------------------------------------------------

/** Build the "暂停/继续" + "重新应用" quick-action items. */
function buildQuickActions(deps: TrayDeps): MenuItemConstructorOptions[] {
  const paused = deps.isPaused?.() ?? false;

  const items: MenuItemConstructorOptions[] = [];

  // Pause / Resume toggle — single item that flips label + handler.
  if (paused) {
    items.push({
      label: LABELS.resumeAll,
      enabled: typeof deps.onResumeAll === 'function',
      click: () => void deps.onResumeAll?.(),
    });
  } else {
    items.push({
      label: LABELS.pauseAll,
      enabled: typeof deps.onPauseAll === 'function',
      click: () => void deps.onPauseAll?.(),
    });
  }

  // Reapply all — only meaningful when a handler is wired up.
  items.push({
    label: LABELS.reapplyAll,
    enabled: typeof deps.onReapplyAll === 'function',
    click: () => void deps.onReapplyAll?.(),
  });

  return items;
}

/**
 * Build the "快速切换 [应用名]" submenu showing up to 3 recently-used
 * themes for the target agent. Returns null when there is nothing to show
 * (no recent themes, no installed agent, or no matching themes).
 */
function buildQuickSwitchSection(
  deps: TrayDeps,
  _themes: InstalledTheme[],
  status: SystemStatus,
): MenuItemConstructorOptions | null {
  const recentThemes = deps.getRecentThemes?.() ?? [];
  if (recentThemes.length === 0) return null;

  // Target agent: first installed agent in status order.
  const targetAgent = status.apps.find((a) => a.installed);
  if (!targetAgent) return null;

  // Filter to themes that support the target agent, cap at 3.
  const agentThemes = recentThemes
    .filter((t) => t.supportedAgents.includes(targetAgent.appId))
    .slice(0, 3);

  if (agentThemes.length === 0) return null;

  return {
    label: `${LABELS.quickSwitch} [${targetAgent.displayName}]`,
    submenu: agentThemes.map((t) => ({
      label: t.displayName,
      type: 'checkbox' as const,
      checked: t.id === targetAgent.activeThemeId,
      click: () => void deps.onQuickSwitchTheme?.(t.id, targetAgent.appId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tray manager factory
// ---------------------------------------------------------------------------

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

    // Assemble the full menu template.
    const template: MenuItemConstructorOptions[] = [
      {
        label: copy.trayOpen,
        click: () => {
          // P2-2: Guard against destroyed window — optional chaining only
          // checks null/undefined, but a destroyed window reference is
          // non-null and calling .show() on it throws.
          if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
            ctx.mainWindow.show();
            ctx.mainWindow.focus();
          }
        },
      },
      { type: 'separator' },
      ...buildQuickActions(deps),
    ];

    // Quick-switch section (only when there are recent themes to show).
    const quickSwitch = buildQuickSwitchSection(deps, themes, status);
    if (quickSwitch) {
      template.push({ type: 'separator' });
      template.push(quickSwitch);
    }

    template.push(
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
    );

    ctx.tray.setContextMenu(Menu.buildFromTemplate(template));
  }

  function createTray(): void {
    ctx.tray = new Tray(trayIconImage(false));
    void updateTrayMenu();
    ctx.tray.on('double-click', () => {
      // P2-2: Same isDestroyed guard as the tray menu open handler.
      if (ctx.mainWindow && !ctx.mainWindow.isDestroyed()) {
        ctx.mainWindow.show();
      }
    });
  }

  return { createTray, updateTrayMenu };
}
