// SPDX-License-Identifier: MPL-2.0

/**
 * # Studio IPC -- Theme Visual Snapshot + Export + Live Inspect
 *
 * - `studio:snapshot` applies a theme to an agent, connects CDP, captures
 *   landmark computed styles + box models + full cascade, and returns a
 *   `ThemeVisualSnapshot` for the frontend's mock replica renderer.
 * - `studio:export` receives a Theme Studio export payload (snapshot signature
 *   + craft overrides + canvas-rendered preview/icon) and builds a
 *   directory-based `.agentskin-theme` package under `theme-workbench/out/`.
 * - `studio:inspect:start` / `studio:inspect:stop` drive the DevTools-style
 *   live element picker (Tier B). Picked nodes are pushed back via
 *   `studio:inspect:result`.
 * - PROBE tab is now rendered entirely by the renderer (static mock
 *   skeletons); this module no longer exposes any probe IPC channels.
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId, StudioSnapshotOptions, ThemeVisualSnapshot } from '../../shared/types';
import { isIpcTimeoutError, withTimeout } from '../../shared/withTimeout';
import { findDomTargets } from '../cdp/cdp-targets';
import { type InspectController, startInspect } from '../cdp/inspect-session';
import { snapshotThemeVisuals } from '../cdp/snapshot-theme';
import { assertAgentId, assertSafeThemeId } from './ipc-validators';
import { withMonitoredTimeout } from './with-monitored-timeout';

export function registerStudioIpc(deps: {
  applyTheme: (request: { themeId: string; appId: AgentId }) => Promise<unknown>;
  restoreApp: (appId: AgentId) => Promise<unknown>;
  /** Resolve the currently-applied theme id for an agent (or null). */
  getActiveThemeId: (appId: AgentId) => Promise<string | null>;
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  /** Resolve a theme id to its display name (or null when unknown). */
  getThemeName: (themeId: string) => Promise<string | null>;
  log: (line: string) => void;
  /** Push a main→renderer event. Wired to the main window's webContents. */
  push: (channel: string, payload: unknown) => void;
}): { stopAllInspects: () => Promise<void> } {
  // Single active live-inspect session (one agent at a time).
  let activeInspect: InspectController | null = null;

  /** Idempotently stop the active inspect session, if any. */
  async function stopAllInspects(): Promise<void> {
    if (!activeInspect) return;
    const session = activeInspect;
    activeInspect = null;
    try {
      await session.stop();
    } catch (error) {
      deps.log(`[studio] inspect stop during cleanup failed: ${String(error)}`);
    }
  }

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_SNAPSHOT,
    async (
      _event,
      request: { agentId: unknown; themeId: unknown; options?: unknown },
    ): Promise<ThemeVisualSnapshot> => {
      return withMonitoredTimeout(
        IpcChannel.THEME_STUDIO_SNAPSHOT,
        45000,
        (async () => {
          const agentId = request.agentId as AgentId;
          const themeId = (request.themeId as string | undefined) || undefined;
          assertAgentId(agentId);
          if (themeId !== undefined) assertSafeThemeId(themeId);

          const snapshot = await snapshotThemeVisuals(
            agentId,
            themeId,
            {
              applyTheme: deps.applyTheme,
              findPortForAgent: deps.resolveLivePort,
              adapter: () => null, // not used in this minimal path
              log: deps.log,
            },
            (request.options as StudioSnapshotOptions | undefined) ?? undefined,
          );

          // `snapshotThemeVisuals` cannot resolve names (it has no catalog access);
          // fill the display name here so the payload is complete for any consumer.
          if (themeId) {
            snapshot.themeName = (await deps.getThemeName(themeId)) ?? '';
          }
          return snapshot;
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_EXPORT,
    async (_event, request: unknown): Promise<{ packageDir: string }> => {
      return withMonitoredTimeout(
        IpcChannel.THEME_STUDIO_EXPORT,
        30000,
        (async () => {
          const root = app.getAppPath();
          const scriptUrl = pathToFileURL(
            path.join(root, 'scripts', 'build-theme-package.mjs'),
          ).href;
          let mod: { buildThemePackage(req: unknown, outDir: string): Promise<string> };
          try {
            mod = await import(scriptUrl);
          } catch (e) {
            deps.log(`[studio] export script load failed: ${String(e)}`);
            throw new Error('Theme package builder unavailable — rebuild the app');
          }
          // Write the exported package to a writable per-user dir. `root` (appPath)
          // is read-only inside the asar bundle when packaged, so outDir must live
          // under userData or the export would fail in production builds.
          const outDir = path.join(app.getPath('userData'), 'theme-workbench', 'out');
          const pkgDir = await mod.buildThemePackage(request, outDir);
          return { packageDir: pkgDir };
        })(),
      );
    },
  );

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_INSPECT_START,
    async (_event, request: { agentId: unknown }): Promise<{ ok: boolean }> => {
      return withMonitoredTimeout(
        IpcChannel.THEME_STUDIO_INSPECT_START,
        30000,
        (async () => {
          const agentId = request.agentId as AgentId;
          assertAgentId(agentId);

          // Stop any previous session first (idempotent).
          await stopAllInspects();

          const port = await deps.resolveLivePort(agentId);
          if (!port) throw new Error(`No debug port found for ${agentId}`);

          const targets = await findDomTargets(port);
          const url = targets.find((t: { webSocketDebuggerUrl?: string }) =>
            Boolean(t.webSocketDebuggerUrl),
          )?.webSocketDebuggerUrl;
          if (!url) throw new Error(`No DOM-bearing CDP target on port ${port}`);

          activeInspect = await startInspect({
            agentId,
            webSocketDebuggerUrl: url,
            onPick: (node) => deps.push(IpcChannel.THEME_STUDIO_INSPECT_RESULT, node),
            onError: (message) =>
              deps.push(IpcChannel.THEME_STUDIO_INSPECT_RESULT, { error: message }),
          });
          return { ok: true };
        })(),
      );
    },
  );

  ipcMain.handle(IpcChannel.THEME_STUDIO_INSPECT_STOP, async (_event): Promise<{ ok: boolean }> => {
    return withMonitoredTimeout(
      IpcChannel.THEME_STUDIO_INSPECT_STOP,
      15000,
      (async () => {
        await stopAllInspects();
        return { ok: true };
      })(),
    );
  });

  /**
   * `studio:snapshot:baseline` -- capture the agent's NATIVE (un-themed)
   * appearance for side-by-side comparison. Orchestration:
   *   1. read the currently-applied theme id
   *   2. restore (remove theme) so the DOM reflects the default look
   *   3. capture the live DOM with no theme re-applied (`themeId: undefined`)
   *   4. re-apply the previously active theme so the agent is left unchanged
   *
   * Step 2 is performed BEFORE the timeout clock starts so that the 60s budget
   * is spent purely on CDP capture. Steps 1 + 2 are also outside the
   * `withMonitoredTimeout` wrapper so that a timeout during step 3 does not
   * leave the agent in a theme-less state: the outer watchdog (`catch` below)
   * fires the compensation re-apply immediately without waiting for the inner
   * function to settle (JS promises are not cancellable — the inner `finally`
   * is paper protection for the non-timeout error path only).
   */
  ipcMain.handle(
    IpcChannel.THEME_STUDIO_SNAPSHOT_BASELINE,
    async (
      _event,
      request: { agentId: unknown; options?: unknown },
    ): Promise<ThemeVisualSnapshot> => {
      const agentId = request.agentId as AgentId;
      assertAgentId(agentId);

      // Step 1: capture the currently-applied theme id (before timeout clock).
      const capturedPrevThemeId = await deps.getActiveThemeId(agentId);
      let needsReapply = false;

      // Step 2: restore to native look (before timeout clock).
      if (capturedPrevThemeId) {
        deps.log(`[studio] restoring ${agentId} to native look for baseline capture`);
        try {
          await deps.restoreApp(agentId);
          needsReapply = true;
        } catch (error) {
          deps.log(`[studio] restore failed (continuing): ${String(error)}`);
        }
      }

      try {
        // Step 3: capture with a 60s timeout. The inner `finally` handles the
        // non-timeout error path (snapshotThemeVisuals rejects but settles).
        return await withMonitoredTimeout(
          IpcChannel.THEME_STUDIO_SNAPSHOT_BASELINE,
          60000,
          (async () => {
            try {
              return await snapshotThemeVisuals(
                agentId,
                undefined,
                {
                  applyTheme: deps.applyTheme,
                  findPortForAgent: deps.resolveLivePort,
                  adapter: () => null, // not used in this minimal path
                  log: deps.log,
                },
                (request.options as StudioSnapshotOptions | undefined) ?? undefined,
              );
            } finally {
              // Paper protection: only runs if the inner async function settles.
              // On timeout the inner function is still pending → finally is unreachable.
              if (capturedPrevThemeId) {
                try {
                  await deps.applyTheme({ themeId: capturedPrevThemeId, appId: agentId });
                  deps.log(`[studio] re-applied theme ${capturedPrevThemeId} to ${agentId}`);
                } catch (error) {
                  deps.log(`[studio] CRITICAL: re-apply failed: ${String(error)}`);
                }
              }
            }
          })(),
        );
      } catch (error) {
        // WATCHDOG: if the capture timed out, the inner `finally` is unreachable
        // (the inner async function is still pending). We cannot wait for it —
        // immediately compensate so the agent is never left in a theme-less state.
        if (isIpcTimeoutError(error) && needsReapply && capturedPrevThemeId) {
          deps.log(
            `[studio] SNAPSHOT_BASELINE timed out — forcing re-apply of ${capturedPrevThemeId}`,
          );
          await withTimeout(
            'compensatory applyTheme',
            5000,
            deps.applyTheme({ themeId: capturedPrevThemeId, appId: agentId }),
          ).catch((e) => {
            deps.log(`[studio] CRITICAL: forced re-apply failed/timed out: ${String(e)}`);
          });
        }
        throw error; // continue propagating the timeout error to the renderer
      }
    },
  );

  // Exposed so the studio window's `closed` event can tear down any live
  // CDP inspect session — without this, closing the window mid-inspect leaks
  // the WebSocket and leaves the agent in Overlay.inspectMode.
  return { stopAllInspects };
}
