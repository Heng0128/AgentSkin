// SPDX-License-Identifier: MPL-2.0

/**
 * # Visual Analyzer IPC
 *
 * Registers handlers for the VISUAL_ANALYSIS_* channel family.
 *
 * Wired (reads the bundled `agents-profiles/` data asset):
 *   - LIST: enumerate agent ids that have a profile on disk.
 *   - GET:  read + parse `<id>-profile.json` for the UI.
 *   - EXPORT_THEME: build an installable `.agentskin-theme` package from a
 *           visual-analysis palette (via scripts/build-theme-package.mjs).
 *
 * Stub / not yet wired (P2, requires live CDP):
 *   - DETECT: now wired to ctx.core.status() when `deps` is supplied;
 *     falls back to a graceful no-running placeholder when running
 *     without deps (e.g. unit tests).
 *   - CDP_EXTRACT returns a graceful placeholder (no renderer consumer
 *     yet; CDP live extraction is not implemented).
 *
 * The remaining stubs:
 *   1. Prevent renderer-side `ipcRenderer.invoke` calls from hanging
 *      indefinitely (Electron rejects with "No handler registered" after ~30s).
 *   2. Return empty/placeholder data so the UI degrades gracefully
 *      (shows empty states, no crash).
 */

import fs from 'node:fs';
import fsPromises, { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, ipcMain } from 'electron';
import { AGENT_TOKEN_COUNTS } from '../../shared/agent-token-counts';
import { IpcChannel } from '../../shared/ipc-channels';
import type { SystemStatus } from '../../shared/types';
import { type AgentId, isAgentId, type VisualAnalysisSummary } from '../../shared/types';
import { withMonitoredTimeout } from './with-monitored-timeout';

const PROFILE_FILE_SUFFIX = '-profile.json';

/** 运行时校验 _profiles-summary.json 结构 */
function isValidProfileSummary(
  value: unknown,
): value is { profiles?: Record<string, Record<string, unknown>> } {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (obj.profiles === undefined) return true; // profiles 是可选的
  if (typeof obj.profiles !== 'object' || obj.profiles === null) return false;
  return true;
}

/** 运行时校验 stats 结构 */
function isValidStats(value: unknown): value is Record<string, Record<string, unknown>> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return Object.values(obj).every((v) => typeof v === 'object' && v !== null);
}

/** IPC channel timeout configuration (milliseconds). */
const IPC_TIMEOUT_LIST = 10_000;
const IPC_TIMEOUT_GET = 10_000;
const IPC_TIMEOUT_DETECT = 15_000;
const IPC_TIMEOUT_EXPORT_THEME = 30_000;
const IPC_TIMEOUT_LIST_SUMMARY = 15_000;

/**
 * Resolve the agents-profiles directory. Mirrors the `getThemesDir()`
 * candidate pattern from theme-seeder:
 *   - dev:      <projectRoot>/agents-profiles
 *   - packaged: <resources>/agents-profiles (extraResources)
 */
export function getProfilesDir(): string {
  const candidates = getProfileDirCandidates();
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // Try next candidate
    }
  }
  return candidates[0];
}

/**
 * List candidate directories for agents-profiles in priority order.
 * Exported for reuse by async self-healing helpers.
 */
export function getProfileDirCandidates(): string[] {
  const candidates = [path.join(app.getAppPath(), 'agents-profiles')];
  // `process.resourcesPath` is defined in packaged/dev Electron but absent in
  // plain-Node contexts (e.g. unit tests) — guard before joining.
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'agents-profiles'));
  }
  return candidates;
}

/**
 * Generate a default `_profiles-summary.json` from the static
 * AGENT_TOKEN_COUNTS and AGENT_BRAND_COLORS data.
 *
 * This allows the app to boot gracefully when the bundled agents-profiles
 * asset is missing (e.g. fresh install, dev mode without running
 * build-agent-profiles.mjs first).
 */
function generateDefaultProfileSummary(): {
  generatedAt: string;
  profiles: Record<string, Record<string, unknown>>;
} {
  const profiles: Record<string, Record<string, unknown>> = {};
  for (const [agentId, counts] of Object.entries(AGENT_TOKEN_COUNTS)) {
    profiles[agentId] = {
      tokensLight: counts.light,
      tokensDark: counts.dark,
      categories: [
        'backgrounds',
        'text',
        'borders',
        'accent',
        'semantic',
        'shadows',
        'typography',
        'spacing',
        'radius',
        'buttons',
        'inputs',
        'scrollbar',
        'code',
        'icon',
        'gradient',
        'other',
      ].slice(0, counts.categories),
      stats: {
        rootVars: { default: 0, dark: 0, light: 0 },
        domNodes: { default: 0, dark: 0, light: 0 },
        styleVars: { dark: 0, light: 0, neutral: 0 },
        computedSamples: { default: 0, dark: 0, light: 0 },
      },
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    profiles,
  };
}

/**
 * Build fallback summaries from the static AGENT_TOKEN_COUNTS data.
 * Used when _profiles-summary.json is missing or structurally invalid.
 */
function buildFallbackSummaries(): VisualAnalysisSummary[] {
  const out: VisualAnalysisSummary[] = [];
  for (const [agentId, counts] of Object.entries(AGENT_TOKEN_COUNTS)) {
    if (!isAgentId(agentId)) continue;
    out.push({
      id: agentId as AgentId,
      tokensLight: counts.light,
      tokensDark: counts.dark,
      categories: [],
      stats: {
        rootVars: { default: 0, dark: 0, light: 0 },
        domNodes: { default: 0, dark: 0, light: 0 },
        styleVars: { dark: 0, light: 0, neutral: 0 },
        computedSamples: { default: 0, dark: 0, light: 0 },
      },
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Ensure the agents-profiles directory exists, creating it (and a default
 * `_profiles-summary.json`) when missing.
 *
 * Self-healing: on a fresh install or dev environment without the bundled
 * agents-profiles asset, this boots the app gracefully instead of throwing
 * ENOENT on every VISUAL_ANALYSIS_* IPC call.
 */
async function ensureProfilesDirAsync(): Promise<string> {
  const candidates = getProfileDirCandidates();
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  // Self-healing: create the first candidate directory.
  const targetDir = candidates[0];
  await mkdir(targetDir, { recursive: true });
  // Generate a default _profiles-summary.json from static data.
  const defaultSummary = generateDefaultProfileSummary();
  await writeFile(
    path.join(targetDir, '_profiles-summary.json'),
    JSON.stringify(defaultSummary, null, 2),
    'utf-8',
  );
  return targetDir;
}

/** Parse a profile file name like `zcode-profile.json` → agent id. */
function agentIdFromProfileFile(fileName: string): AgentId | null {
  if (!fileName.endsWith(PROFILE_FILE_SUFFIX)) return null;
  const id = fileName.slice(0, -PROFILE_FILE_SUFFIX.length);
  return isAgentId(id) ? id : null;
}

/**
 * Validate CSS color value format (hex/rgb/rgba/oklch).
 * Used by EXPORT_THEME to reject non-color values before they reach
 * the theme builder (which would otherwise silently accept garbage).
 */
function isValidColorValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return (
    /^#([0-9A-Fa-f]{3,8})$/.test(value) ||
    /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+/.test(value) ||
    /^oklch\(\s*[\d.]+/.test(value)
  );
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
 * Invalidate the summaries cache so the next LIST_SUMMARY call rebuilds it.
 * Exposed for callers that mutate the agents-profiles directory (e.g. after
 * installing or removing a profile) so they can force a refresh without
 * waiting for the process to restart.
 */
export function invalidateSummaryCache(): void {
  summariesCache = null;
}

/**
 * Build a compact per-agent summary digest from the bundled asset:
 *   - `_profiles-summary.json` → token counts / categories / stats
 *   - `<id>-profile.json` → brand accent (`tokens.core.*.accent`)
 *
 * Reading the multi-MB raw profiles is the only expensive part; it happens
 * once, here, in the main process, and the result is cached.
 *
 * Uses async I/O to avoid blocking the main process event loop during
 * cold start (previously used synchronous fs.readFileSync).
 */
async function buildVisualAnalysisSummaries(): Promise<VisualAnalysisSummary[]> {
  if (summariesCache) return summariesCache;
  const dir = await ensureProfilesDirAsync();

  let summaryMap: Record<string, Record<string, unknown>> = {};
  try {
    const raw = await fsPromises.readFile(path.join(dir, '_profiles-summary.json'), 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidProfileSummary(parsed)) {
      console.warn('[VisualAnalyzer] Invalid _profiles-summary.json structure, using fallback');
      return buildFallbackSummaries();
    }
    summaryMap = parsed.profiles ?? {};
  } catch {
    return buildFallbackSummaries();
  }

  const out: VisualAnalysisSummary[] = [];
  for (const [id, s] of Object.entries(summaryMap)) {
    if (!isAgentId(id)) continue;
    const agentId = id as AgentId;

    // Extract brand accent colors from the raw profile (best-effort).
    let brandDark: string | undefined;
    let brandLight: string | undefined;
    try {
      const raw = await fsPromises.readFile(
        path.join(dir, `${agentId}${PROFILE_FILE_SUFFIX}`),
        'utf8',
      );
      const prof = JSON.parse(raw) as {
        tokens?: { core?: { dark?: { accent?: string }; light?: { accent?: string } } };
      };
      brandDark = prof.tokens?.core?.dark?.accent;
      brandLight = prof.tokens?.core?.light?.accent;
    } catch {
      // Profile missing/unparseable — fall back to stats-only card.
    }

    const stats = isValidStats(s.stats) ? (s.stats as Record<string, Record<string, unknown>>) : {};
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

export interface VisualAnalyzerDeps {
  getStatus: () => Promise<SystemStatus>;
  /**
   * Emit a visual analysis status event to any renderer subscribers.
   * The implementation should forward to `webContents.send(IpcChannel.VISUAL_ANALYSIS_STATUS, payload)`.
   * Optional — when absent, `emitVisualAnalysisStatus` is a safe no-op.
   */
  emitStatus?: (payload: { agent: string; step: string; progress: number }) => void;
}

/**
 * Emit a visual analysis status event to renderer subscribers.
 * Overwritten each time `registerVisualAnalyzerIpc` is called (single-window app).
 * Safe no-op when no emitter is wired.
 */
let _emitVisualAnalysisStatus: (payload: {
  agent: string;
  step: string;
  progress: number;
}) => void = () => {};

export function emitVisualAnalysisStatus(payload: {
  agent: string;
  step: string;
  progress: number;
}): void {
  _emitVisualAnalysisStatus(payload);
}

export function registerVisualAnalyzerIpc(deps?: VisualAnalyzerDeps): void {
  // List agent ids that have a bundled profile on disk (known AgentIds only).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_LIST, async () => {
    return withMonitoredTimeout(
      IpcChannel.VISUAL_ANALYSIS_LIST,
      IPC_TIMEOUT_LIST,
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
  ipcMain.handle(
    IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY,
    async (): Promise<VisualAnalysisSummary[]> => {
      return withMonitoredTimeout(
        IpcChannel.VISUAL_ANALYSIS_LIST_SUMMARY,
        IPC_TIMEOUT_LIST_SUMMARY,
        buildVisualAnalysisSummaries(),
      );
    },
  );

  // Get a single agent profile by id. Input is validated as a known AgentId
  // before it is used in any path (no traversal surface).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_GET, async (_event, agentName: unknown) => {
    return withMonitoredTimeout(
      IpcChannel.VISUAL_ANALYSIS_GET,
      IPC_TIMEOUT_GET,
      (async () => {
        if (typeof agentName !== 'string' || !isAgentId(agentName)) return null;
        return readProfile(agentName);
      })(),
    );
  });

  // Detect whether an agent process is currently running.
  // Wired: queries ctx.core.status() for live running/port/displayName.
  // Fallback (deps unavailable, e.g. tests): graceful not-running placeholder.
  // The entire handler body is wrapped in withMonitoredTimeout (consistent with
  // LIST, GET, LIST_SUMMARY, EXPORT_THEME) so every IPC channel has uniform
  // timeout protection — wraps the entire handler body. On timeout,
  // withMonitoredTimeout rejects with IpcTimeoutError, which we catch
  // and degrade to a not-running placeholder (consistent with other
  // transient failures).
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_DETECT, async (_event, agentName: unknown) => {
    try {
      return await withMonitoredTimeout(
        IpcChannel.VISUAL_ANALYSIS_DETECT,
        IPC_TIMEOUT_DETECT,
        (async () => {
          if (typeof agentName !== 'string' || !isAgentId(agentName)) {
            return { running: false, port: undefined, title: undefined };
          }
          if (!deps?.getStatus) {
            return { running: false, port: undefined, title: undefined };
          }
          const status = await deps.getStatus();
          const app = status.apps.find((a) => a.appId === agentName);
          if (!app) {
            return { running: false, port: undefined, title: undefined };
          }
          return { running: app.running, port: app.port ?? undefined, title: app.displayName };
        })(),
      );
    } catch {
      /* timeout or transient — degrade to not-running */
      return { running: false, port: undefined, title: undefined };
    }
  });

  // ⟪SEND_ONLY⟫ — see the centralized annotation on IpcChannel.VISUAL_ANALYSIS_STATUS
  // in src/shared/ipc-channels.ts. The preload API subscribes via
  // `ipcRenderer.on(IpcChannel.VISUAL_ANALYSIS_STATUS, ...)`,
  // which expects main-process PUSH events (webContents.send), not invoke/handle request/response.
  // Registering `ipcMain.handle` here creates a channel direction mismatch — the renderer's
  // subscription will never fire and any invoke() call hangs until timeout.
  //
  // An emit callback is captured from deps so callers (e.g. the live analysis
  // pipeline) can push progress without importing BrowserWindow. Tests inject
  // no emitter — emitVisualAnalysisStatus becomes a safe no-op.
  let _emitStatus: ((payload: { agent: string; step: string; progress: number }) => void) | null =
    null;
  if (deps?.emitStatus) {
    const cur = deps.emitStatus;
    _emitStatus = (p) => {
      try {
        cur(p);
      } catch {
        /* emitter failure must not break analysis — degrade to no-op */
      }
    };
  }

  // Emit a "ready" initial pulse once registration is complete. This confirms the
  // SEND_ONLY channel is live and bridgeable before the full live analysis
  // pipeline is wired. Subsequent calls emit as the pipeline advances.
  setImmediate(() => _emitStatus?.({ agent: '*', step: 'ready', progress: 0 }));

  // Module-level emit handle for the current registration. Safe no-op when no
  // emitter was supplied. The next registration overwrites (single-window app).
  _emitVisualAnalysisStatus = (payload) => _emitStatus?.(payload);

  // Graceful no-op for CDP_EXTRACT — prevents renderer `invoke` from hanging
  // 30s (Electron "No handler registered" timeout). Live CDP extraction is not
  // yet implemented; callers receive a structured "unavailable" response so the
  // UI can surface an empty state instead of triggering the IPC timeout path.
  ipcMain.handle(IpcChannel.VISUAL_ANALYSIS_CDP_EXTRACT, (_event, agentName: string) => ({
    status: 'unavailable' as const,
    reason: 'live CDP extraction not implemented — use image-based theme analysis instead',
    profile: null,
    agent: agentName,
  }));

  // Export a visual analysis theme as an .agentskin-theme package.
  //
  // The renderer sends a `ThemeStudioExportRequest`-shaped
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
      return withMonitoredTimeout(
        IpcChannel.VISUAL_ANALYSIS_EXPORT_THEME,
        IPC_TIMEOUT_EXPORT_THEME,
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
          // Validate that every --agentskin-* value is a well-formed color.
          // Without this check, non-color strings (e.g. "not-avail", "inherit")
          // would silently pass through to the builder and produce a broken theme.
          const invalidColors = Object.entries(normalized.root)
            .filter(([k]) => k.startsWith('--agentskin-'))
            .filter(([, v]) => !isValidColorValue(v));
          if (invalidColors.length > 0) {
            return { ok: false };
          }

          // build-theme-package.mjs is an ESM module (uses import.meta.url),
          // so the dynamic import is required — a static import would fail under
          // CommonJS-style resolution. The pathToFileURL + dynamic import pattern
          // is the canonical ESM-interop approach.
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
