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
 *   - EXPORT_THEME: build an installable `.agentskin-theme` package from a
 *           visual-analysis palette (via scripts/build-theme-package.mjs).
 *
 * Stub / not yet wired (P2, requires live CDP):
 *   - DETECT / CDP_EXTRACT return graceful placeholders (no renderer consumer
 *     yet; CDP live extraction is not implemented).
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
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import { type AgentId, isAgentId, type VisualAnalysisSummary } from '../../shared/types';
import { withTimeout } from '../../shared/withTimeout';

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

/** Process-lifetime cache for the computed summaries (built once on first use). */
let summariesCache: VisualAnalysisSummary[] | null = null;

/**
 * Build a compact per-agent summary digest from the bundled asset:
 *   - `_profiles-summary.json` → token counts / categories / stats
 *   - `<id>-profile.json` → brand accent (`tokens.core.*.accent`)
 *
 * Reading the multi-MB raw profiles is the only expensive part; it happens
 * once, here, in the main process, and the result is cached.
 */
function buildVisualAnalysisSummaries(): VisualAnalysisSummary[] {
  if (summariesCache) return summariesCache;
  const dir = getProfilesDir();

  let summaryMap: Record<string, Record<string, unknown>> = {};
  try {
    const raw = fs.readFileSync(path.join(dir, '_profiles-summary.json'), 'utf8');
    const parsed = JSON.parse(raw) as { profiles?: Record<string, Record<string, unknown>> };
    summaryMap = parsed.profiles ?? {};
  } catch {
    summaryMap = {};
  }

  const out: VisualAnalysisSummary[] = [];
  for (const [id, s] of Object.entries(summaryMap)) {
    if (!isAgentId(id)) continue;
    const agentId = id as AgentId;

    // Extract brand accent colors from the raw profile (best-effort).
    let brandDark: string | undefined;
    let brandLight: string | undefined;
    try {
      const prof = JSON.parse(
        fs.readFileSync(path.join(dir, `${agentId}${PROFILE_FILE_SUFFIX}`), 'utf8'),
      ) as { tokens?: { core?: { dark?: { accent?: string }; light?: { accent?: string } } } };
      brandDark = prof.tokens?.core?.dark?.accent;
      brandLight = prof.tokens?.core?.light?.accent;
    } catch {
      // Profile missing/unparseable — fall back to stats-only card.
    }

    const stats = (s.stats ?? {}) as Record<string, Record<string, unknown>>;
    const num = (obj: Record<string, unknown> | undefined, key: string): number => {
      const v = obj?.[key];
      return typeof v === 'number' ? v : 0;
    };

    out.push({
      id: agentId,
      tokensLight: Number(s.tokensLight ?? 0),
      tokensDark: Number(s.tokensDark ?? 0),
      categories: Array.isArray(s.categories) ? (s.categories as string[]) : [],
      stats: {
        rootVars: {
          default: num(stats.rootVars, 'default'),
          dark: num(stats.rootVars, 'dark'),
          light: num(stats.rootVars, 'light'),
        },
        domNodes: {
          default: num(stats.domNodes, 'default'),
          dark: num(stats.domNodes, 'dark'),
          light: num(stats.domNodes, 'light'),
        },
        styleVars: {
          dark: num(stats.styleVars, 'dark'),
          light: num(stats.styleVars, 'light'),
          neutral: num(stats.styleVars, 'neutral'),
        },
        computedSamples: {
          default: num(stats.computedSamples, 'default'),
          dark: num(stats.computedSamples, 'dark'),
          light: num(stats.computedSamples, 'light'),
        },
      },
      brandDark,
      brandLight,
    });
  }

  out.sort((a, b) => a.id.localeCompare(b.id));
  summariesCache = out;
  return out;
}

export function registerVisualAnalyzerIpc(): void {
  // List agent ids that have a bundled profile on disk (known AgentIds only).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_LIST, async () => {
    return withTimeout(
      IpcChannel.VISUAL_ANALYSIS_LIST,
      10000,
      (async () => {
        let entries: string[] = [];
        try {
          entries = await fsPromises.readdir(getProfilesDir());
        } catch {
          return [] as string[];
        }
        const ids = entries.map(agentIdFromProfileFile).filter((id): id is AgentId => id !== null);
        return [...new Set(ids)].sort();
      })(),
    );
  });

  // Compact per-agent summary for the Studio profile browser. The renderer
  // must not load the multi-MB raw profiles just to render a card, so we
  // serve a trimmed digest: lightweight stats from `_profiles-summary.json`
  // plus the brand accent extracted lazily from each `<id>-profile.json`.
  // Built once and cached for the process lifetime.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY, (): VisualAnalysisSummary[] => {
    return buildVisualAnalysisSummaries();
  });

  // Get a single agent profile by id. Input is validated as a known AgentId
  // before it is used in any path (no traversal surface).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_GET, async (_event, agentName: unknown) => {
    return withTimeout(
      IpcChannel.VISUAL_ANALYSIS_GET,
      10000,
      (async () => {
        if (typeof agentName !== 'string' || !isAgentId(agentName)) return null;
        return readProfile(agentName);
      })(),
    );
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
  //
  // The renderer (FitGeneratorPanel) sends a `ThemeStudioExportRequest`-shaped
  // payload ({ agentId, meta?, root?, signature? }). We reuse the same
  // directory-based package builder as the Theme Studio export
  // (scripts/build-theme-package.mjs) so the resulting package is byte-for-byte
  // compatible and installable through the normal theme pipeline.
  ipcMain.handle(
    IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME,
    async (
      _event,
      agentName: unknown,
      themeData: unknown,
    ): Promise<{ ok: boolean; path?: string }> => {
      return withTimeout(
        IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME,
        30000,
        (async () => {
          if (typeof agentName !== 'string' || !isAgentId(agentName)) {
            return { ok: false };
          }
          if (!themeData || typeof themeData !== 'object' || Array.isArray(themeData)) {
            return { ok: false };
          }
          const request = themeData as Record<string, unknown>;
          // Normalize the payload so the shared builder can consume it.
          const normalized = {
            agentId: agentName,
            meta:
              request.meta && typeof request.meta === 'object' && !Array.isArray(request.meta)
                ? (request.meta as Record<string, unknown>)
                : undefined,
            root:
              request.root && typeof request.root === 'object' && !Array.isArray(request.root)
                ? (request.root as Record<string, string>)
                : undefined,
            signature:
              request.signature &&
              typeof request.signature === 'object' &&
              !Array.isArray(request.signature)
                ? (request.signature as Record<string, unknown>)
                : undefined,
          };
          // Refuse to export when no palette is supplied — an empty export would
          // silently fall back to the builder's default tokens and confuse users.
          if (
            !normalized.root ||
            Object.keys(normalized.root).filter((k) => k.startsWith('--agentskin-')).length === 0
          ) {
            return { ok: false };
          }

          const root = app.getAppPath();
          const scriptUrl = pathToFileURL(
            path.join(root, 'scripts', 'build-theme-package.mjs'),
          ).href;
          let mod: { buildThemePackage(req: unknown, outDir: string): Promise<string> };
          try {
            mod = await import(scriptUrl);
          } catch {
            return { ok: false };
          }
          // Write to a writable per-user dir (appPath is read-only inside asar).
          const outDir = path.join(app.getPath('userData'), 'theme-workbench', 'out');
          try {
            const pkgDir = await mod.buildThemePackage(normalized, outDir);
            return { ok: true, path: pkgDir };
          } catch {
            return { ok: false };
          }
        })(),
      );
    },
  );
}
