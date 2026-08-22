// SPDX-License-Identifier: MPL-2.0

/**
 * # Core IPC
 *
 * Cross-cutting IPC handlers that don't belong to a single domain:
 * app bootstrap, locale, system status, agent list, and shell integration.
 * Extracted from the monolithic `registerIpc` in `main.ts` (H3).
 *
 * `updateTrayMenu` is injected because `locale:set` and `app:bootstrap`
 * can change menu-visible state (locale labels, file-open sink wiring).
 *
 * Dependencies are injected via `deps` (a {@link MainContext}) so handlers
 * are unit-testable — no implicit singleton import.
 */

import fs from 'node:fs';
import { app, ipcMain, shell } from 'electron';
import { toMessage } from '../../shared/errors';
import { getMainMessages, isAppLocale, setMainLocale } from '../../shared/i18n';
import { IpcChannel } from '../../shared/ipc-channels';
import { sanitizeCSS } from '../../shared/safe-css';
import type { ToolOverride } from '../../shared/types/override';
import { getStyleSheetText, listStyleSheets } from '../cdp/css-service';
import { injectCssLayer } from '../cdp/injection/shared';
import { probeSelector, validateSelectors } from '../cdp/selector-validator';
import { saveLocalePreference } from '../locale-preferences';
import { mainWarn } from '../logger';
import { handleThemeFileOpen, type MainContext, wrapCatalog } from '../main-context';
import {
  pushTweak,
  resetTweak,
  resolveSessionForPort,
  saveTweakAsCustomCss,
  type TweakSession,
} from '../services/tweak-injector';
import { assertNonEmptyString } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerCoreIpc(deps: MainContext, updateTrayMenu: () => Promise<void>): void {
  ipcMain.handle(IpcChannel.APP_BOOTSTRAP, async () => {
    deps.fileOpens.setSink((filePath) => void handleThemeFileOpen(deps, filePath, updateTrayMenu));
    // Bootstrap returns ONLY fast data (locale + version). Status and themes
    // are fetched separately via refreshStatus()/catalog — including them here
    // blocked the UI on agent detection (CDP probing for all 4 agents), which
    // takes seconds and left the environment list blank until detection finished.
    return {
      themes: [],
      status: {
        apps: [],
        platform:
          process.platform === 'win32'
            ? 'win32'
            : process.platform === 'darwin'
              ? 'darwin'
              : 'unsupported',
      },
      locale: deps.locale,
      appVersion: app.getVersion(),
    };
  });

  ipcMain.handle(IpcChannel.LOCALE_SET, async (_event, nextLocale: unknown) => {
    if (!isAppLocale(nextLocale)) throw new Error(getMainMessages().invalidLocale);
    deps.locale = nextLocale;
    setMainLocale(deps.locale);
    await saveLocalePreference(deps.userDataRoot, deps.locale);
    void updateTrayMenu();
  });

  ipcMain.handle(IpcChannel.SYSTEM_STATUS, async () => {
    // core.status() triggers CDP probing for all agents; under heavy load or
    // with unresponsive agents this can block indefinitely. The timeout ensures
    // the renderer gets a timely error instead of hanging until Electron's
    // built-in ~30s IPC timeout.
    return withMonitoredTimeout(IpcChannel.SYSTEM_STATUS, 15000, deps.core.status());
  });

  ipcMain.handle(IpcChannel.AGENT_LIST, async () => {
    const items = deps.agentCatalog.listAgents();
    const sysStatus = await withMonitoredTimeout(IpcChannel.AGENT_LIST, 15000, deps.core.status());
    const merged = items.map((item) => {
      if (!item.supported) return item;
      const appStatus = sysStatus.apps.find((a) => a.appId === item.id);
      return {
        ...item,
        status: {
          installed: appStatus?.installed ?? false,
          running: appStatus?.running ?? false,
          debugReady: appStatus?.debugReady ?? false,
        },
      };
    });
    return wrapCatalog(merged);
  });

  ipcMain.handle(IpcChannel.SHELL_SHOW_ITEM, (_event, itemPath: unknown) => {
    assertNonEmptyString(itemPath, getMainMessages().invalidPath);
    // Reject paths that don't exist on disk — avoids popping Explorer errors
    // for attacker-constructed paths and prevents revealing directories for
    // fabricated paths (O2).
    if (!fs.existsSync(itemPath)) {
      throw new Error(getMainMessages().invalidPath);
    }
    return shell.showItemInFolder(itemPath);
  });

  // --- Workspace live tweak (delegates to tweak-injector.ts) ---
  ipcMain.handle(
    IpcChannel.WORKSPACE_TWEAK_PUSH,
    async (_event, session: TweakSession, overrides: ToolOverride) => {
      try {
        return await pushTweak(session, overrides);
      } catch (error) {
        mainWarn('Tweak.Push', toMessage(error));
        return false;
      }
    },
  );

  ipcMain.handle(
    IpcChannel.WORKSPACE_TWEAK_SAVE,
    async (_event, session: TweakSession, overrides: ToolOverride) => {
      try {
        // `settings` is resolved from MainContext (deps) — never passed across
        // IPC, because SettingsService is a class that cannot be serialized
        // through the contextBridge. The renderer only sends (session, overrides).
        return await saveTweakAsCustomCss(session, deps.settings, overrides);
      } catch (error) {
        mainWarn('Tweak.Save', toMessage(error));
        return false;
      }
    },
  );

  ipcMain.handle(IpcChannel.WORKSPACE_TWEAK_RESET, async (_event, session: TweakSession) => {
    try {
      return await resetTweak(session.agentId, session.port);
    } catch (error) {
      mainWarn('Tweak.Reset', toMessage(error));
      return false;
    }
  });

  // --- CSS source editor (delegates to css-service.ts) ---
  ipcMain.handle(IpcChannel.CSS_LIST, async (_event, port: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.CSS_LIST,
      10000,
      (async () => {
        if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`invalid port: ${String(port)}`);
        }
        const session = await resolveSessionForPort(port);
        if (!session) {
          mainWarn('CssEditor.List', `no CDP session on port ${port}`);
          return [];
        }
        try {
          return await listStyleSheets(session);
        } finally {
          session.close();
        }
      })(),
    );
  });

  ipcMain.handle(IpcChannel.CSS_GET_TEXT, async (_event, port: unknown, styleSheetId: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.CSS_GET_TEXT,
      10000,
      (async () => {
        if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`invalid port: ${String(port)}`);
        }
        if (typeof styleSheetId !== 'string' || !styleSheetId.startsWith('sheet-index-')) {
          throw new Error(`invalid styleSheetId: ${String(styleSheetId)}`);
        }
        const session = await resolveSessionForPort(port);
        if (!session) {
          mainWarn('CssEditor.Text', `no CDP session on port ${port}`);
          return '';
        }
        try {
          return await getStyleSheetText(session, styleSheetId);
        } finally {
          session.close();
        }
      })(),
    );
  });

  ipcMain.handle(
    IpcChannel.CSS_APPLY_EDIT,
    async (_event, port: unknown, agentId: unknown, css: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.CSS_APPLY_EDIT,
        10000,
        (async () => {
          if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error(`invalid port: ${String(port)}`);
          }
          if (typeof agentId !== 'string') {
            throw new Error(`invalid agentId: ${String(agentId)}`);
          }
          if (typeof css !== 'string') {
            throw new Error('css must be a string');
          }
          // Sanitize before injection — same guard as other tweak paths.
          const sanitized = sanitizeCSS(css);
          if (sanitized.blocked && !sanitized.clean.trim()) {
            return { ok: false, error: `CSS blocked: ${sanitized.reasons.join(', ')}` };
          }
          const session = await resolveSessionForPort(port);
          if (!session) {
            mainWarn('CssEditor.Apply', `no CDP session on port ${port} for ${agentId}`);
            return { ok: false, error: 'no_cdp_session' };
          }
          try {
            const ok = await injectCssLayer(session, 'workspace-tweak', sanitized.clean);
            return ok ? { ok: true } : { ok: false, error: 'inject_failed' };
          } catch (error) {
            mainWarn('CssEditor.Apply', `apply failed for ${agentId}: ${toMessage(error)}`);
            return { ok: false, error: toMessage(error) };
          } finally {
            session.close();
          }
        })(),
      );
    },
  );

  // --- Selector probe (delegates to selector-validator.ts) ---
  ipcMain.handle(IpcChannel.SELECTOR_PROBE, async (_event, port: unknown, selector: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.SELECTOR_PROBE,
      10000,
      (async () => {
        if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`invalid port: ${String(port)}`);
        }
        if (typeof selector !== 'string' || selector.length === 0) {
          throw new Error('selector must be a non-empty string');
        }
        const session = await resolveSessionForPort(port);
        if (!session) {
          mainWarn('Selector.Probe', `no CDP session on port ${port}`);
          return { selector: String(selector), kind: 'timeout', count: 0 };
        }
        try {
          return await probeSelector(session, selector);
        } finally {
          session.close();
        }
      })(),
    );
  });

  ipcMain.handle(
    IpcChannel.SELECTOR_VALIDATE,
    async (_event, port: unknown, agentId: unknown, selectors: unknown) => {
      return withMonitoredTimeout(
        IpcChannel.SELECTOR_VALIDATE,
        15000,
        (async () => {
          if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0 || port > 65535) {
            throw new Error(`invalid port: ${String(port)}`);
          }
          if (typeof agentId !== 'string') {
            throw new Error(`invalid agentId: ${String(agentId)}`);
          }
          if (!Array.isArray(selectors) || !selectors.every((s) => typeof s === 'string')) {
            throw new Error('selectors must be an array of strings');
          }
          const session = await resolveSessionForPort(port);
          if (!session) {
            mainWarn('Selector.Validate', `no CDP session on port ${port}`);
            return {
              agentId: String(agentId),
              results: selectors.map((s: string) => ({
                selector: s,
                kind: 'timeout',
                count: 0,
              })),
              summary: {
                total: selectors.length,
                hit: 0,
                miss: 0,
                invalid: 0,
                timeout: selectors.length,
              },
              timestamp: Date.now(),
            };
          }
          try {
            return await validateSelectors(session, agentId, selectors);
          } finally {
            session.close();
          }
        })(),
      );
    },
  );
}
