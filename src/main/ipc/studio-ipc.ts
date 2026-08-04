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
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId, StudioSnapshotOptions, ThemeVisualSnapshot } from '../../shared/types';
import { findDomTargets } from '../cdp/cdp-targets';
import { type InspectController, startInspect } from '../cdp/inspect-session';
import { snapshotThemeVisuals } from '../cdp/snapshot-theme';
import { assertAgentId } from './ipc-validators';

export function registerStudioIpc(deps: {
  applyTheme: (request: { themeId: string; appId: AgentId }) => Promise<unknown>;
  restoreApp: (appId: AgentId) => Promise<unknown>;
  /** Resolve the currently-applied theme id for an agent (or null). */
  getActiveThemeId: (appId: AgentId) => Promise<string | null>;
  resolveLivePort: (appId: AgentId) => Promise<number | null>;
  log: (line: string) => void;
  /** Push a main→renderer event. Wired to the main window's webContents. */
  push: (channel: string, payload: unknown) => void;
}): void {
  // Single active live-inspect session (one agent at a time).
  let activeInspect: InspectController | null = null;

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_SNAPSHOT,
    async (
      _event,
      request: { agentId: unknown; themeId: unknown; options?: unknown },
    ): Promise<ThemeVisualSnapshot> => {
      const agentId = request.agentId as AgentId;
      const themeId = (request.themeId as string | undefined) || undefined;
      assertAgentId(agentId);

      return snapshotThemeVisuals(
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
    },
  );

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_EXPORT,
    async (_event, request: unknown): Promise<{ packageDir: string }> => {
      const root = app.getAppPath();
      const scriptUrl = pathToFileURL(path.join(root, 'scripts', 'build-theme-package.mjs')).href;
      const mod = await import(scriptUrl);
      const outDir = path.join(root, 'theme-workbench', 'out');
      const pkgDir = await mod.buildThemePackage(request, outDir);
      return { packageDir: pkgDir };
    },
  );

  ipcMain.handle(
    IpcChannel.THEME_STUDIO_INSPECT_START,
    async (_event, request: { agentId: unknown }): Promise<{ ok: boolean }> => {
      const agentId = request.agentId as AgentId;
      assertAgentId(agentId);

      // Stop any previous session first.
      if (activeInspect) {
        try {
          await activeInspect.stop();
        } catch {
          /* ignore */
        }
        activeInspect = null;
      }

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
        onError: (message) => deps.push(IpcChannel.THEME_STUDIO_INSPECT_RESULT, { error: message }),
      });
      return { ok: true };
    },
  );

  ipcMain.handle(IpcChannel.THEME_STUDIO_INSPECT_STOP, async (): Promise<{ ok: boolean }> => {
    if (activeInspect) {
      try {
        await activeInspect.stop();
      } catch {
        /* ignore */
      }
      activeInspect = null;
    }
    return { ok: true };
  });

  /**
   * `studio:snapshot:baseline` -- capture the agent's NATIVE (un-themed)
   * appearance for side-by-side comparison. Orchestration:
   *   1. read the currently-applied theme id
   *   2. restore (remove theme) so the DOM reflects the default look
   *   3. capture the live DOM with no theme re-applied (`themeId: undefined`)
   *   4. re-apply the previously active theme so the agent is left unchanged
   */
  ipcMain.handle(
    IpcChannel.THEME_STUDIO_SNAPSHOT_BASELINE,
    async (
      _event,
      request: { agentId: unknown; options?: unknown },
    ): Promise<ThemeVisualSnapshot> => {
      const agentId = request.agentId as AgentId;
      assertAgentId(agentId);

      const prevThemeId = await deps.getActiveThemeId(agentId);
      if (prevThemeId) {
        deps.log(`[studio] restoring ${agentId} to native look for baseline capture`);
        try {
          await deps.restoreApp(agentId);
        } catch (error) {
          deps.log(`[studio] restore failed (continuing): ${String(error)}`);
        }
      }

      const snap = await snapshotThemeVisuals(
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

      if (prevThemeId) {
        try {
          await deps.applyTheme({ themeId: prevThemeId, appId: agentId });
          deps.log(`[studio] re-applied theme ${prevThemeId} to ${agentId}`);
        } catch (error) {
          deps.log(`[studio] re-apply failed: ${String(error)}`);
        }
      }
      return snap;
    },
  );
}
