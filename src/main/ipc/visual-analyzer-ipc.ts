// SPDX-License-Identifier: MPL-2.0

/**
 * # Visual Analyzer IPC
 *
 * Registers handlers for the VISUAL_ANALYSIS_* channel family.
 *
 * Wired (reads the bundled `agents-profiles/` data asset):
 *   - LIST: enumerate agent ids that have a profile on disk.
 *   - GET:  read + parse `<id>-profile.json` for the UI (Studio's
 *           FitGeneratorPanel consumes `tokens.*` and `stats.*`).
 *
 * Stub — no renderer consumer exists yet (P2, requires live CDP):
 *   - DETECT / CDP_EXTRACT / EXPORT_THEME return graceful placeholders.
 *   - STATUS: intentionally no handle (push-only channel, see note below).
 *
 * The stubs:
 *   1. Prevent renderer-side `ipcRenderer.invoke` calls from hanging
 *      indefinitely (Electron rejects with "No handler registered" after ~30s).
 *   2. Return empty/placeholder data so the UI degrades gracefully
 *      (shows empty states, no crash).
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { app, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { type AgentId, isAgentId } from '../../shared/types';

const PROFILE_FILE_SUFFIX = '-profile.json';

/**
 * Resolve the agents-profiles directory. Mirrors the `getThemesDir()`
 * candidate pattern from theme-seeder:
 *   - dev:      <projectRoot>/agents-profiles
 *   - packaged: <resources>/agents-profiles (extraResources)
 */
export function getProfilesDir(): string {
  const candidates = [path.join(app.getAppPath(), 'agents-profiles')];
  // `process.resourcesPath` is defined in packaged/dev Electron but absent in
  // plain-Node contexts (e.g. unit tests) — guard before joining.
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'agents-profiles'));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Try next candidate
    }
  }
  return candidates[0];
}

/** Parse a profile file name like `zcode-profile.json` → agent id. */
function agentIdFromProfileFile(fileName: string): AgentId | null {
  if (!fileName.endsWith(PROFILE_FILE_SUFFIX)) return null;
  const id = fileName.slice(0, -PROFILE_FILE_SUFFIX.length);
  return isAgentId(id) ? id : null;
}

/** Read + parse one profile. Returns null when missing or unparseable. */
async function readProfile(agentId: AgentId): Promise<Record<string, unknown> | null> {
  const filePath = path.join(getProfilesDir(), `${agentId}${PROFILE_FILE_SUFFIX}`);
  try {
    const raw = await fsPromises.readFile(filePath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function registerVisualAnalyzerIpc(): void {
  // List agent ids that have a bundled profile on disk (known AgentIds only).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_LIST, async () => {
    let entries: string[] = [];
    try {
      entries = await fsPromises.readdir(getProfilesDir());
    } catch {
      return [] as string[];
    }
    const ids = entries.map(agentIdFromProfileFile).filter((id): id is AgentId => id !== null);
    return [...new Set(ids)].sort();
  });

  // Get a single agent profile by id. Input is validated as a known AgentId
  // before it is used in any path (no traversal surface).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_GET, async (_event, agentName: unknown) => {
    if (typeof agentName !== 'string' || !isAgentId(agentName)) return null;
    return readProfile(agentName);
  });

  // Detect whether an agent process is currently running.
  // Stub (P2): a real implementation needs the orchestrator's DiscoveryDeps.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_DETECT, (_event, _agentName: unknown) => {
    return { running: false, port: undefined, title: undefined };
  });

  // Trigger a live CDP-based extraction from a running agent.
  // Stub (P2): no renderer consumer yet.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_CDP_EXTRACT, (_event, _agentName: unknown) => {
    return { ok: false, message: 'Live CDP extraction is not yet implemented' };
  });

  // Subscribe to extraction progress events. Stub: no-op registration.
  //
  // NOTE: The preload API subscribes via `ipcRenderer.on(IpcChannel.VISUAL_ANALYSIS_STATUS, ...)`
  // which expects main-process PUSH events (webContents.send), not invoke/handle request/response.
  // Registering `ipcMain.handle` here creates a channel direction mismatch — the renderer's
  // subscription will never fire. The full implementation should emit progress via:
  //   webContents.send(IpcChannel.VISUAL_ANALYSIS_STATUS, { agent, step, progress })
  // Intentionally NO handle registered for this channel. The subscription stub lives in
  // the preload layer (returns a no-op unsubscribe) so renderer code does not crash.

  // Export a visual analysis theme as an .agentskin-theme package.
  // Stub (P2): no renderer consumer yet.
  ipcMain.handle(
    IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME,
    (_event, _agentName: unknown, _themeData: unknown) => {
      return { ok: false, path: undefined };
    },
  );
}
