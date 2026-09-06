// SPDX-License-Identifier: MPL-2.0

/**
 * # IPC Registration Aggregator
 *
 * Entry point for IPC handler registration. Replaces the monolithic
 * `registerIpc()` function in `main.ts` (H3). Each domain module owns its
 * own handlers; this file just calls them in order.
 *
 * `ctx` is forwarded to every module so handlers receive their dependencies
 * via parameter injection (no implicit singleton import), enabling unit
 * testing with mock contexts.
 *
 * `updateTrayMenu` is forwarded only to modules whose handlers mutate
 * tray-visible state (core: locale; theme: apply/restore/import/delete).
 */

import { ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { MainContext } from '../main-context';
import { notifyStatusChanged } from '../main-context';
import { getThemeUsageTracker } from '../services/theme-usage-tracker';
import { createStudioWindow } from '../window-manager';
import { createDefaultCdpBridge } from './asar-cdp-bridge';
import { registerAsarIpc } from './asar-ipc';
import { registerJointAnalysisIpc } from './asar-joint-analysis';
import { registerBundleIpc } from './bundle-ipc';
import { registerCommunityThemeIpc } from './community-theme-ipc';
import { registerConcurrencyMetricsIpc } from './concurrency-metrics-ipc';
import { configureStudioCoordinatorIpc, registerCoordinatorIpc } from './coordinator-ipc';
import { registerCoreIpc } from './core-ipc';
import { registerDecorationIpc } from './decoration-ipc';
import { registerElectronIpc } from './electron-ipc';
import { registerEnvironmentIpc } from './environment-ipc';
import { registerUnifiedIpcRouter } from './ipc-router';
import { registerMcpIpc } from './mcp-ipc';
import { registerNativeProfileIpc } from './native-profile-ipc';
import { registerPerformanceIpc } from './performance-ipc';
import { disposePetWindow, registerPetIpc } from './pet-ipc';
import { registerQuickApplyIpc } from './quick-apply-ipc';
import { registerSettingsIpc } from './settings-ipc';
import { registerStudioIpc } from './studio-ipc';
import { registerStudioProjectIpc } from './studio-project-ipc';
import { registerStudioTemplatesIpc } from './studio-templates-ipc';
import { registerStudioWorkspaceIpc } from './studio-workspace-ipc';
import { registerThemeAssetIpc } from './theme-asset-ipc';
import { registerThemeIpc } from './theme-ipc';
import { registerTransformLedgerIpc } from './transform-ledger-ipc';
import { registerTreatmentClassifierIpc } from './treatment-classifier-ipc';
import { registerVisualAnalyzerIpc } from './visual-analyzer-ipc';
import { registerWallpaperIpc } from './wallpaper-ipc';
import { registerWindowIpc } from './window-ipc';
import { withMonitoredTimeout } from './with-monitored-timeout';

/**
 * Feature flag: when `true`, the unified IPC router handles `status:query`
 * actions (system, agent-list, theme-list, theme-get, theme-search,
 * theme-filter, wallpaper-list) instead of the per-action legacy handlers.
 *
 * Controlled via:
 *   - `process.env.USE_UNIFIED_IPC=true` (runtime, set by main.ts from a
 *     future Settings toggle during rollout)
 *   - compile-time default `false` (legacy path active by default)
 *
 * Once the flag is permanently `true`, the legacy handlers for the merged
 * channels can be removed. During rollout both paths are registered so we
 * can A/B via runtime toggle.
 */
export function isUnifiedIpcEnabled(): boolean {
  return process.env.USE_UNIFIED_IPC === 'true';
}

export function registerIpc(ctx: MainContext, updateTrayMenu: () => Promise<void>): void {
  // Unified IPC router — registers the `status:query` domain channel.
  // Always registered (cheap: one ipcMain.handle) so toggling the flag needs
  // no re-registration. The renderer's `useUnifiedIPC` flag determines which
  // side actually *calls* the unified channels.
  registerUnifiedIpcRouter({ ctx });

  registerCoreIpc(ctx, updateTrayMenu);
  registerThemeIpc(ctx, updateTrayMenu, getThemeUsageTracker());
  // Decoration Generator — self-contained, no MainContext dependency
  registerDecorationIpc();
  // Theme Asset Engine — self-contained, no MainContext dependency
  registerThemeAssetIpc();
  // ASAR extraction — self-contained, no MainContext dependency
  registerAsarIpc();
  // ASAR joint analysis — needs the CDP session pool plus a live bridge so the
  // dynamic phase can actually reach the app (the bridge is what turns
  // "agent not running" into a real port/target/session lookup).
  registerJointAnalysisIpc(() => ctx.core.getCdpSessionPool(), createDefaultCdpBridge());
  registerBundleIpc(ctx, updateTrayMenu);
  registerSettingsIpc(ctx);
  registerWallpaperIpc(ctx);
  // RC4 fix: registerPerformanceIpc now returns a dispose fn. Wire it to
  // ctx.disposables so repeated registrations (HMR, window rebuild) don't
  // accumulate trace listeners.
  const performanceIpcApi = registerPerformanceIpc(ctx);
  ctx.disposables.push(performanceIpcApi.dispose);
  // Concurrency-metrics push (main → renderer via webContents.send every 5s)
  // + the renderer→main update path for renderer-side primitive sizes.
  // RC2 fix: wire up dispose to prevent listener stacking on repeated calls.
  const concurrencyMetricsIpcApi = registerConcurrencyMetricsIpc(ctx);
  ctx.disposables.push(concurrencyMetricsIpcApi.dispose);
  registerWindowIpc();
  registerVisualAnalyzerIpc({
    getStatus: () => ctx.core.status(),
    emitStatus: (payload) => {
      // Push progress events to the main window. Both get and emit paths are
      // optional — `setImmediate`-driven initial pulse fires after the window
      // is fully initialized; if the window is not yet ready, the webContents
      // call simply no-ops.
      ctx.mainWindow?.webContents.send(IpcChannel.VISUAL_ANALYSIS_STATUS, payload);
    },
  });
  registerEnvironmentIpc(ctx);
  registerElectronIpc(ctx);
  registerCoordinatorIpc(ctx.mainWindow);

  // Open (or focus) the dedicated Theme Studio window on demand. The renderer
  // env exposes ELECTRON_RENDERER_URL in dev so we can point the studio window
  // at the vite dev server's `studio.html`; in prod we load the built file.
  //
  // The handler is async so that any exception from createStudioWindow propagates
  // back to the renderer via IPC rejection (instead of becoming an unhandled
  // rejection that silently swallows the error — the renderer would see "no
  // response" after a 30s timeout).
  ipcMain.handle(IpcChannel.STUDIO_OPEN, async () => {
    await withMonitoredTimeout(
      IpcChannel.STUDIO_OPEN,
      30000,
      createStudioWindow({ rendererUrl: process.env.ELECTRON_RENDERER_URL }),
    );
    // REQ-I-005: Wire studioWindow into coordinator status fan-out so the
    // Studio window receives app run-state changes (the same events the main
    // window gets via onCoordinatorStatus).
    configureStudioCoordinatorIpc(ctx.studioWindow);
    return { ok: true };
  });

  const { stopAllInspects } = registerStudioIpc({
    applyTheme: (request) => ctx.core.apply(request),
    restoreApp: (appId) => ctx.core.restore(appId),
    getActiveThemeId: async (appId) => {
      const status = await ctx.core.status();
      const app = status.apps.find((a) => a.appId === appId);
      return app?.activeThemeId ?? null;
    },
    resolveLivePort: async (appId) => {
      const status = await ctx.core.status();
      const app = status.apps.find((a) => a.appId === appId);
      return app?.port ?? null;
    },
    getThemeName: async (themeId) => {
      const theme = await ctx.themeCatalog.getTheme(themeId);
      return theme?.name ?? null;
    },
    log: (line: string) => console.log(line),
    // Studio snapshot/inspect events are pushed back to whichever window
    // requested them. The studio now lives in its own window, so prefer
    // `studioWindow`; fall back to the main window for safety.
    push: (channel: string, payload: unknown) => {
      const target = ctx.studioWindow ?? ctx.mainWindow;
      target?.webContents.send(channel, payload);
    },
    // Share the agent CDP session pool so Studio live-inspect reuses existing
    // target connections instead of handshaking a fresh socket per session.
    pool: ctx.core.getCdpSessionPool(),
  });

  // Tear down any live CDP inspect session when the studio window closes —
  // otherwise the WebSocket stays open and the agent is left in
  // Overlay.inspectMode until the next start/stop cycle.
  ctx.onStudioWindowClosed = () => {
    void stopAllInspects();
    // REQ-003: Push STATUS_CHANGED to the main window so it refreshes its
    // theme list after Studio closes (Studio may have imported/created/deleted
    // themes that the main window's cached list doesn't reflect).
    notifyStatusChanged();
  };

  // Studio "工程" (projects) — self-contained, file-backed, no installed themes.
  registerStudioProjectIpc();

  // Studio Workspace — image→theme extraction, wallpaper picker, bundle management.
  registerStudioWorkspaceIpc(ctx);

  // Studio Theme Templates — curated starter palettes for new projects.
  registerStudioTemplatesIpc();

  // MCP (Model Context Protocol) — runtime start/stop from Settings UI.
  registerMcpIpc(ctx);

  // Native Profile — build AgentNativeProfile from DomTreeNode (renderer→main).
  registerNativeProfileIpc();

  // Community Theme (DreamSkin) — list / get / download / cancel.
  registerCommunityThemeIpc(ctx);

  // Transform Ledger + Human-in-the-loop Overrides — self-contained, no MainContext dependency.
  registerTransformLedgerIpc();

  // Treatment classifier — component classification + CSS generation.
  registerTreatmentClassifierIpc();

  // Pet — self-contained floating desktop companion window.
  registerPetIpc();
  ctx.disposables.push(disposePetWindow);

  // Quick Apply — image → theme pipeline (needs library + core).
  registerQuickApplyIpc(ctx);
}
