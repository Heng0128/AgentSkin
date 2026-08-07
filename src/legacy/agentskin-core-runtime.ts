// SPDX-License-Identifier: MPL-2.0

/**
 * # Legacy Core Runtime
 *
 * This file is the SINGLE place where `@agentskin/engine` is imported. Every
 * other module in AgentSkin talks to the engine through this runtime — never
 * directly. That keeps the control layer (AgentSkin) decoupled from the
 * execution engine (@agentskin/engine) and makes a future engine swap a
 * one-file change.
 *
 * ## Why "legacy"
 *
 * The name is intentionally honest about the current migration state:
 * @agentskin/engine already owns the real theme execution logic (CDP injection,
 * host-settings transactions, app discovery). AgentSkin V3 is rebuilding the
 * *control* layer on top of it. The label "legacy" is retained for import-path
 * stability; this file is a permanent Windows compatibility + Doubao adapter
 * layer, not a throwaway.
 *
 * ## Call chain
 *
 *   UI → agent-engine-service → registry → ApplicationAdapter → (this runtime) → @agentskin/engine
 *
 * The runtime exposes:
 *   - Primary:    applyTheme, restoreTheme, discoverApplication, readTheme, convertLegacyTheme
 *   - Support:    findDebugTargets, findRunningProcesses, resolveDebugPortsFor,
 *                 resolveThemeTargetFor, validateTheme, getCoreAdapter, listCoreAdapters
 *   - Constants:  themeExtension, legacyThemeExtension
 *   - Types:      ThemeBundle, CoreAppAdapter, DiscoveredApp, CdpTarget,
 *                 ResolvedThemeTarget, ApplyThemeResult, RestoreThemeResult
 */

import {
  applySkin,
  convertLegacyThemeFile,
  discoverApp,
  findRunningPids,
  findTargets,
  getAdapter,
  listAdapters,
  listCdpTargets,
  readThemePackage,
  resolveDebugPorts,
  resolveThemeTarget,
  restoreSkin,
  validateThemePackage,
  verifyTheme as coreVerifyTheme,
  LEGACY_THEME_EXTENSION,
  THEME_EXTENSION,
} from '@agentskin/engine';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileAsync } from '../shared/exec-async';
import type {
  AppAdapter,
  AppInstallation,
  ApplySkinResult,
  CdpTarget,
  ConvertLegacyThemeFileResult,
  RestoreSkinResult,
  ThemePackage,
} from '@agentskin/engine';
import type {
  ThemeBundle as ThemeBundleContract,
  ResolvedThemeTarget as ResolvedThemeTargetContract,
} from '../main/services/theme-bundle';

// ---------------------------------------------------------------------------
// Type re-exports (type-only — no runtime dependency on core for consumers)
// ---------------------------------------------------------------------------

/**
 * A parsed theme package.
 *
 * The canonical contract now lives in `main/services/theme-bundle.ts`. We
 * re-export it under the legacy name so existing imports keep compiling,
 * and assert structural compatibility with `@agentskin/engine`'s
 * `ThemePackage` via the conditional below (erased at compile time).
 */
export type ThemeBundle = ThemeBundleContract;
/**
 * Compile-time assertion that the engine's `ThemePackage` is structurally
 * assignable to our `ThemeBundle` contract. If the engine ever drifts, this
 * line fails to type-check and surfaces the mismatch immediately.
 */
export const _themeBundleAssert: ThemeBundle = null as unknown as ThemePackage;

/** The core's adapter descriptor (defaultPort, displayName, platforms, ...). */
export type CoreAppAdapter = AppAdapter;
/** Result of app installation discovery. Alias for AppInstallation. */
export type DiscoveredApp = AppInstallation;
export type {
  CdpTarget,
};
/**
 * Resolved theme target ready for CDP injection. Re-exported from the
 * `main/services/theme-bundle.ts` contract; structurally compatible with
 * `@agentskin/engine`'s `ResolvedThemeTarget`.
 */
export type ResolvedThemeTarget = ResolvedThemeTargetContract;
/**
 * Compile-time assertion that the engine's `ResolvedThemeTarget` is
 * structurally assignable to our contract type.
 */
export const _resolvedTargetAssert: ResolvedThemeTarget = null as unknown as import('@agentskin/engine').ResolvedThemeTarget;
export type {
  ApplySkinResult as ApplyThemeResult,
  RestoreSkinResult as RestoreThemeResult,
  ConvertLegacyThemeFileResult as ConvertLegacyThemeResult,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export { THEME_EXTENSION as themeExtension, LEGACY_THEME_EXTENSION as legacyThemeExtension };

/**
 * Product-level canonical theme package extension for AgentSkin.
 *
 * The engine (@agentskin/engine) still owns `.agentskin-theme` (and the legacy
 * `.codex-theme`) as its on-disk package format, but the AgentSkin product
 * presents `.agenttheme` as the user-facing format for import / export /
 * file-association / drag-and-drop. Internal storage stays engine-compatible.
 */
export const agentThemeExtension = '.agenttheme';

/**
 * Compatibility alias for the engine's `.agentskin-theme` extension.
 * The engine internally uses `THEME_EXTENSION` (".agentskin-theme"); AgentSkin
 * code uses `engineThemeExtension` to avoid leaking the legacy name while
 * still matching the real on-disk format. Both names refer to the same value.
 */
export const engineThemeExtension = THEME_EXTENSION;

/**
 * AgentSkin error codes — the engine's AGENTSKIN_* error codes.
 *
 * @agentskin/engine throws errors with `code: 'AGENTSKIN_*'` (the engine's
 * internal product name). These are the engine's stable error identifiers,
 * not a transitional naming — AgentSkin checks against these exact values.
 */
export const ERROR_CODES = {
  RESTART_REQUIRED: 'AGENTSKIN_RESTART_REQUIRED',
  PORT_OCCUPIED: 'AGENTSKIN_PORT_OCCUPIED',
  TARGET_TIMEOUT: 'AGENTSKIN_TARGET_TIMEOUT',
  DOM_INCOMPATIBLE: 'AGENTSKIN_DOM_INCOMPATIBLE',
} as const;

// ---------------------------------------------------------------------------
// Primary runtime functions
// ---------------------------------------------------------------------------

export interface ApplyThemeParams {
  /** The @agentskin/engine adapter id (e.g. "traework"). */
  coreId: string;
  targetTheme: ResolvedThemeTarget;
  port?: number;
  /** Launch the app when no CDP target is reachable. Defaults to false. */
  launch?: boolean;
  /** Manual install location override (mainly Windows). */
  appPath?: string | null;
  restartExisting?: boolean;
  timeoutMs?: number;
}

/**
 * Apply a resolved theme target to a running app. Wraps @agentskin/engine's
 * `applySkin`, resolving the core adapter from `coreId` internally so callers
 * never touch core directly. Errors (AGENTSKIN_RESTART_REQUIRED,
 * AGENTSKIN_PORT_OCCUPIED, ...) propagate unchanged.
 */
export function applyTheme(params: ApplyThemeParams): Promise<ApplySkinResult> {
  const adapter = getAdapter(params.coreId);
  return applySkin({
    adapter,
    targetTheme: params.targetTheme,
    port: params.port,
    launch: params.launch,
    appPath: params.appPath,
    restartExisting: params.restartExisting,
    timeoutMs: params.timeoutMs,
  });
}

export interface RestoreThemeParams {
  coreId: string;
  port?: number;
  timeoutMs?: number;
}

/** Restore an app to its default appearance. Wraps @agentskin/engine's restoreSkin. */
export function restoreTheme(params: RestoreThemeParams): Promise<RestoreSkinResult> {
  const adapter = getAdapter(params.coreId);
  return restoreSkin({ adapter, port: params.port, timeoutMs: params.timeoutMs });
}

export interface VerifyThemeParams {
  coreId: string;
  targetTheme: ResolvedThemeTarget;
  port: number;
  timeoutMs?: number;
}

/**
 * Verify whether a theme is currently applied to a running app. Wraps
 * @agentskin/engine's verifyTheme. Returns per-target results with `pass`,
 * `installed`, `stylePresent`, etc. — used by reapplyActiveTheme to skip
 * unnecessary re-injection when the theme survived a flaky debugReady
 * transition (false → true) without an actual app restart.
 */
export function verifyTheme(params: VerifyThemeParams): Promise<unknown[]> {
  const adapter = getAdapter(params.coreId);
  return coreVerifyTheme({
    adapter,
    targetTheme: params.targetTheme,
    port: params.port,
    timeoutMs: params.timeoutMs,
  });
}

/**
 * Discover whether an app is installed on the current platform. Wraps
 * @agentskin/engine's discoverApp, resolving the adapter from coreId.
 */
export function discoverApplication(
  coreId: string,
  platform?: string,
  appPath?: string | null,
): Promise<DiscoveredApp | null> {
  return discoverApp(getAdapter(coreId), platform, appPath);
}

/** Read and validate a .agentskin-theme package from disk. Wraps readThemePackage. */
export function readTheme(filePath: string): Promise<ThemeBundle> {
  return readThemePackage(filePath);
}

/** Validate an in-memory theme bundle. Wraps validateThemePackage. */
export function validateTheme(bundle: unknown): ThemeBundle {
  return validateThemePackage(bundle);
}

/**
 * Convert a legacy .codex-theme file to the current .agentskin-theme format.
 * Wraps @agentskin/engine's convertLegacyThemeFile.
 */
export function convertLegacyTheme(
  inputFilename: string,
  outputFilename: string,
  options?: { force?: boolean },
): Promise<ConvertLegacyThemeFileResult> {
  return convertLegacyThemeFile(inputFilename, outputFilename, options);
}

// ---------------------------------------------------------------------------
// Support functions (used by agent-engine-service for status / port resolution)
// ---------------------------------------------------------------------------

/** Find live CDP targets on a debug port. Wraps findTargets. */
export function findDebugTargets(
  coreId: string,
  port: number,
  timeoutMs?: number,
): Promise<CdpTarget[]> {
  return findTargets(getAdapter(coreId), port, timeoutMs);
}

/** Find running process ids for an app. Wraps findRunningPids. */
export function findRunningProcesses(
  coreId: string,
  platform?: string,
  executablePath?: string | null,
): Promise<number[]> {
  return findRunningPids(getAdapter(coreId), platform, executablePath);
}

/** Resolve DevToolsActivePort file candidates. Wraps resolveDebugPorts. */
export function resolveDebugPortsFor(coreId: string, platform?: string): Promise<number[]> {
  return resolveDebugPorts(getAdapter(coreId), platform);
}

/** Pick the theme target for a specific app from a theme bundle. Wraps resolveThemeTarget. */
export function resolveThemeTargetFor(bundle: ThemeBundle, coreId: string): ResolvedThemeTarget {
  return resolveThemeTarget(bundle, coreId);
}

/** Look up the core adapter descriptor (defaultPort, displayName, ...). */
export function getCoreAdapter(coreId: string): CoreAppAdapter {
  return getAdapter(coreId);
}

/** List all adapters known to @agentskin/engine. */
export function listCoreAdapters(): CoreAppAdapter[] {
  return listAdapters();
}

// ---------------------------------------------------------------------------
// Formal API surface (ThemeRuntime)
//
// This interface documents the COMPLETE contract the runtime exposes to the
// control layer (AgentEngineService, ApplicationAdapter). Consumers should
// depend on this interface rather than importing individual functions — it
// makes the boundary explicit and testable.
//
// Call chain:
//   UI → IPC → AgentEngineService → ApplicationAdapter → ThemeRuntime → @agentskin/engine
// ---------------------------------------------------------------------------

/**
 * The runtime's public API surface for theme-package operations.
 *
 * Grouped into three concerns:
 *   - Lifecycle: read / validate / convert (package I/O)
 *   - Execution: applyTheme / restoreTheme (CDP injection)
 *   - Discovery: discoverApplication / findDebugTargets / findRunningProcesses /
 *                resolveDebugPortsFor / resolveThemeTargetFor / getCoreAdapter /
 *                listCoreAdapters
 */
export interface ThemeRuntime {
  // --- Lifecycle ---
  readTheme(filePath: string): Promise<ThemeBundle>;
  validateTheme(bundle: unknown): ThemeBundle;
  convertLegacyTheme(
    inputFilename: string,
    outputFilename: string,
    options?: { force?: boolean },
  ): Promise<ConvertLegacyThemeFileResult>;

  // --- Execution ---
  applyTheme(params: ApplyThemeParams): Promise<ApplySkinResult>;
  restoreTheme(params: RestoreThemeParams): Promise<RestoreSkinResult>;

  // --- Discovery ---
  discoverApplication(coreId: string, platform?: string, appPath?: string | null): Promise<DiscoveredApp | null>;
  findDebugTargets(coreId: string, port: number, timeoutMs?: number): Promise<CdpTarget[]>;
  findRunningProcesses(coreId: string, platform?: string, executablePath?: string | null): Promise<number[]>;
  resolveDebugPortsFor(coreId: string, platform?: string): Promise<number[]>;
  resolveThemeTargetFor(bundle: ThemeBundle, coreId: string): ResolvedThemeTarget;
  getCoreAdapter(coreId: string): CoreAppAdapter;
  listCoreAdapters(): CoreAppAdapter[];
}

/**
 * Singleton runtime instance. All exported functions above are the
 * implementation; this object groups them for dependency injection and
 * testing. Consumers that need the full surface can depend on `ThemeRuntime`
 * instead of importing 10+ individual functions.
 */
export const themeRuntime: ThemeRuntime = {
  readTheme,
  validateTheme,
  convertLegacyTheme,
  applyTheme,
  restoreTheme,
  discoverApplication,
  findDebugTargets,
  findRunningProcesses,
  resolveDebugPortsFor,
  resolveThemeTargetFor,
  getCoreAdapter,
  listCoreAdapters,
};

// ---------------------------------------------------------------------------
// Windows CDP compatibility layer
//
// As of @agentskin/engine 0.6.0 the `qoderwork` and `traework` adapters are
// `lastVerified` on darwin only; their win32 config was never real-machine
// validated. Two concrete gaps break CDP on Windows:
//   1. traework declares NO `devToolsActivePortFile` at all, so when the app
//      forces an ephemeral `--remote-debugging-port=0` the live port is never
//      discovered → AGENTSKIN_TARGET_TIMEOUT.
//   2. traework's `matchTarget` only matches `/electron-browser/solo/solo-lite.html`,
//      which is fragile across Windows path casing / layout changes.
//
// This shim does NOT fork the engine: it mutates the live adapter objects that
// core already registered (the objects returned by getAdapter are the same
// references core uses), so the change survives every subsequent apply/discover
// call within the same process. It runs once at module load on win32 only.
//
// The port-file discovery scans %APPDATA% / %LOCALAPPDATA% for any
// DevToolsActivePort so we never have to guess the exact user-data folder name;
// matchTarget stays app-scoped via title/url so a wrong-app port is simply
// ignored by findTargets. Replace with a proper core release when available.
// ---------------------------------------------------------------------------

// CDP port discovery primitives live in src/shared/cdp-discovery.ts so both
// this runtime and agent-engine-service can share one implementation.
// Re-exported here to preserve the existing import surface for consumers
// that historically imported them from this module.
import { probePortLive, explicitDebugPortsFromPids, listeningPortsForPids } from '../shared/cdp-discovery';
import { AGENT_IDS } from '../shared/types';
export { probePortLive, explicitDebugPortsFromPids };

// Re-export `listCdpTargets` from the engine so main-process consumers
// (cdp-targets.ts) go through this single bridge instead of importing
// @agentskin/engine directly. Preserves the "SINGLE place where @agentskin/engine
// is imported" contract declared at the top of this file.
export { listCdpTargets };

// ---------------------------------------------------------------------------
// WebSocket CDP fallback for apps that disable HTTP /json/list (WorkBuddy 5.3+)
//
// WorkBuddy 5.3.x hardened security by no longer serving the HTTP discovery
// endpoint (/json/list). The WebSocket CDP protocol still works — the browser
// endpoint path is published in DevToolsActivePort (line 2). This interceptor
// transparently patches globalThis.fetch so that when @agentskin/engine's
// listCdpTargets() fails over HTTP, we fall back to WebSocket Target.getTargets
// and return a synthetic Response in the identical JSON format.
// ---------------------------------------------------------------------------

interface CdpTargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
}

/** Read the WebSocket browser path from a DevToolsActivePort file. */
function readWsPathFromPortFile(filePath: string): { port: number; wsPath: string } | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const port = Number(lines[0]);
    const wsPath = lines[1] ?? '';
    if (!Number.isInteger(port) || port < 1024 || !wsPath.startsWith('/devtools/')) return null;
    return { port, wsPath };
  } catch {
    return null;
  }
}

/** Known DevToolsActivePort locations for WorkBuddy (5.3.x uses session/ subdir). */
function workbuddyPortFiles(): string[] {
  const home = process.env.USERPROFILE ?? os.homedir();
  return [
    path.join(home, '.workbuddy', 'app', 'session', 'DevToolsActivePort'),
    path.join(home, '.workbuddy', 'app', 'DevToolsActivePort'),
  ];
}

/**
 * Discover CDP targets via WebSocket when HTTP /json/list is unavailable.
 * Connects to the browser-level WebSocket endpoint and calls Target.getTargets.
 */
async function listTargetsViaWebSocket(port: number): Promise<unknown[] | null> {
  // Find the WebSocket path for this port from DevToolsActivePort files
  let wsPath: string | null = null;
  for (const file of workbuddyPortFiles()) {
    const info = readWsPathFromPortFile(file);
    if (info && info.port === port) { wsPath = info.wsPath; break; }
  }
  // Also check the temp file written by discoverLiveCdpPortViaPid / recoverCdpPort
  if (!wsPath) {
    const tmp = path.join(os.tmpdir(), 'agentskin-workbuddy-cdp-port');
    const info = readWsPathFromPortFile(tmp);
    if (info && info.port === port) wsPath = info.wsPath;
  }
  if (!wsPath) return null;

  const wsUrl = `ws://127.0.0.1:${port}${wsPath}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => { try { ws.close(); } catch {} resolve(null); }, 4000);
    let ws: InstanceType<typeof WebSocket>;
    try {
      ws = new WebSocket(wsUrl);
    } catch { clearTimeout(timer); resolve(null); return; }

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Target.getTargets' }));
    };
    ws.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.id === 1 && msg.result?.targetInfos) {
          // Return all DOM-bearing target types (page, webview, iframe).
          // The HTTP /json/list endpoint already returns these; the WebSocket
          // fallback previously filtered to page-only, which hid MCP app
          // webviews and ardot.tencent.com iframes from CDP discovery — so the
          // secondary-target injection pass in AgentEngineService never saw
          // them. Workers have no DOM and are correctly excluded.
          const targets = (msg.result.targetInfos as CdpTargetInfo[])
            .filter((t) => t.type === 'page' || t.type === 'webview' || t.type === 'iframe')
            .map((t) => ({
              id: t.targetId,
              type: t.type,
              title: t.title,
              url: t.url,
              webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/${t.targetId}`,
            }));
          ws.close();
          resolve(targets);
        } else {
          ws.close();
          resolve(null);
        }
      } catch { resolve(null); }
    };
    ws.onerror = () => { clearTimeout(timer); resolve(null); };
  });
}

let fetchInterceptorInstalled = false;
// P3-12: Previously the fetch interceptor held a reference to `originalFetch`
// in a closure with no dispose path — if the host runtime ever re-ran setup
// or if tests ran twice, originalFetch would point to the already-patched
// fetch, producing a layered tower of interceptors. We keep a stable ref and
// expose a module-level `uninstall` function so the caller can tear the
// wrapper down (wired into disposeWallpaperInjectionState for the normal
// production path). The flag is also reset on uninstall so re-install uses
// the *current* globalThis.fetch rather than a stale closure from the last
// bootstrap.
let originalFetch: typeof globalThis.fetch | null = null;

/**
 * Install a globalThis.fetch interceptor that provides a WebSocket fallback for
 * /json/list requests. Only active on win32; idempotent.
 */
function installCdpFetchInterceptor(): void {
  if (fetchInterceptorInstalled || process.platform !== 'win32') return;
  fetchInterceptorInstalled = true;

  originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(typeof input === 'object' && 'url' in input ? input.url : input);
    const isJsonList = /http:\/\/127\.0\.0\.1:(\d+)\/json\/list/.test(url);

    if (!isJsonList) {
      // Safe because originalFetch is assigned before globalThis.fetch is
      // overwritten — TypeScript wants the explicit null check.
      return (originalFetch as typeof globalThis.fetch)(input, init);
    }

    // Try the normal HTTP path first
    try {
      const response = await (originalFetch as typeof globalThis.fetch)(input, init);
      if (response.ok) {
        const text = await response.text();
        if (text.trim().startsWith('[')) {
          // Valid JSON array — return as-is
          return new Response(text, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
      // Non-ok or empty response — fall through to WebSocket
    } catch {
      // HTTP request failed entirely — fall through to WebSocket
    }

    // WebSocket fallback
    const portMatch = /http:\/\/127\.0\.0\.1:(\d+)\/json\/list/.exec(url);
    if (portMatch) {
      const port = Number(portMatch[1]);
      const targets = await listTargetsViaWebSocket(port);
      if (targets && targets.length) {
        return new Response(JSON.stringify(targets), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Both paths failed — return a 502 so callers get a clean error
    return new Response('CDP discovery unavailable (HTTP and WebSocket both failed)', {
      status: 502,
      headers: { 'Content-Type': 'text/plain' },
    });
  };

  console.log('[agentskin:cdp-patch] fetch interceptor installed (WebSocket /json/list fallback)');
}

/**
 * Tear down the fetch interceptor installed by {@link installCdpFetchInterceptor}.
 * Safe to call even if the interceptor was never installed. Restores the
 * captured `originalFetch` and resets the install flag so a subsequent
 * install picks up whatever globalThis.fetch is live at that time.
 *
 * Wired into disposeWallpaperInjectionState so the main process can clean
 * the hook when tearing down legacy runtime state (avoids double-patching
 * if a hot-reload or test re-invokes the boot sequence).
 */
export function uninstallCdpFetchInterceptor(): void {
  if (!fetchInterceptorInstalled) return;
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    originalFetch = null;
  }
  fetchInterceptorInstalled = false;
  console.log('[agentskin:cdp-patch] fetch interceptor uninstalled');
}

async function patchWindowsAdapters(): Promise<void> {
  if (process.platform !== 'win32') return;
  installCdpFetchInterceptor();
  try {
    const roots = [process.env.APPDATA, process.env.LOCALAPPDATA].filter(Boolean) as string[];
    const candidates: { file: string; port: number }[] = [];
    for (const root of roots) {
      let entries: import('node:fs').Dirent[] = [];
      try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        const file = path.join(root, e.name, 'DevToolsActivePort');
        if (!fs.existsSync(file)) continue;
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const port = Number(raw.split(/\r?\n/, 1)[0].trim());
          if (Number.isInteger(port) && port >= 1024 && port <= 65535) candidates.push({ file, port });
        } catch { /* Ignore unreadable port files. */ }
      }
    }

    // WorkBuddy 5.3.x moved DevToolsActivePort into a "session" subdirectory
    // under its user-data-dir (%USERPROFILE%\.workbuddy\app\session\).
    // Also check the app root for older versions. These paths are NOT under
    // APPDATA/LOCALAPPDATA so the generic scan above misses them.
    const userProfile = process.env.USERPROFILE;
    if (userProfile) {
      const wbCandidates = [
        path.join(userProfile, '.workbuddy', 'app', 'session', 'DevToolsActivePort'),
        path.join(userProfile, '.workbuddy', 'app', 'DevToolsActivePort'),
      ];
      for (const file of wbCandidates) {
        if (!fs.existsSync(file)) continue;
        try {
          const raw = fs.readFileSync(file, 'utf8');
          const port = Number(raw.split(/\r?\n/, 1)[0].trim());
          if (Number.isInteger(port) && port >= 1024 && port <= 65535) candidates.push({ file, port });
        } catch { /* Ignore unreadable port files. */ }
      }
    }

    // DevToolsActivePort files survive the process that wrote them, so a stale
    // file points at a dead port. Only inject ports that currently answer.
    // Map each live file to the adapter(s) it belongs to by directory name so
    // WorkBuddy never inherits TRAE's port file (and vice versa).
    const liveFilesByDir: { dir: string; file: string }[] = [];
    await Promise.all(
      candidates.map(async ({ file, port }) => {
        if (await probePortLive(port)) {
          liveFilesByDir.push({ dir: path.basename(path.dirname(file)), file });
        }
      }),
    );

    const ids = AGENT_IDS as readonly string[];
    for (const id of ids) {
      const adapter = getAdapter(id);
      const plat = adapter?.platforms?.win32;
      if (!adapter || !plat) continue;

      // Never trust a hardcoded defaultPort (9336/9337/9338 are stale
      // assumptions — WorkBuddy 5.3.x binds a random port, QoderWork forces
      // port=0, TRAE SOLO only opens CDP when explicitly launched). core's
      // applySkin/restoreSkin fall back to adapter.defaultPort when no port
      // is passed, which can resolve to a zombie socket. Zero it out so the
      // only path to a live port is dynamic discovery (DevToolsActivePort
      // file + PID/netstat probing in resolveLivePort).
      adapter.defaultPort = 0;

      // --- Reliable discovery (PID -> listening ports -> /json/list) ---
      // DevToolsActivePort files go stale after a restart (the new port is never
      // written, or written to a user-data dir the config does not list). The
      // user-data-port file also may simply be absent. This fallback enumerates
      // the app's PIDs, maps them to their listening ports via netstat, and
      // probes each for a CDP /json/list endpoint whose target matches the app.
      // The discovered port is written to a temp DevToolsActivePort-style file
      // so @agentskin/engine's resolveDebugPorts picks it up unchanged.
      const appLiveFiles: string[] = [];
      const pidPort = await discoverLiveCdpPortViaPid(adapter);
      if (pidPort != null) {
        try {
          const tmp = path.join(os.tmpdir(), `agentskin-${id}-cdp-port`);
          fs.writeFileSync(tmp, String(pidPort));
          appLiveFiles.push(tmp);
        } catch { /* Ignore unwriteable temp file. */ }
      }

      // Only inherit DevToolsActivePort files whose directory name matches
      // this app's known user-data dirs. Injecting ALL live files into ALL
      // adapters causes WorkBuddy to hijack TRAE's port 53879 (TRAE's target
      // has title "TRAE Work CN" but core's matchTarget matches vscode-file:
      // URLs, which WorkBuddy's original matchTarget also accepts).
      const appDirPatterns: Record<string, RegExp[]> = {
        traework: [/^trae\b/i, /^trae\s+solo/i],
        qoderwork: [/^qoder/i],
        workbuddy: [/^workbuddy\b/i, /^\.workbuddy$/i],
        doubao: [/^doubao/i],
        zcode: [/^zcode/i],
      };
      const patterns = appDirPatterns[id] ?? [];
      for (const { dir, file } of liveFilesByDir) {
        if (patterns.some((p) => p.test(dir))) appLiveFiles.push(file);
      }

      const declared = Array.isArray(plat.devToolsActivePortFile)
        ? plat.devToolsActivePortFile
        : plat.devToolsActivePortFile
          ? [plat.devToolsActivePortFile]
          : [];
      plat.devToolsActivePortFile = [...new Set([...declared, ...appLiveFiles])];

      // matchTarget is no longer monkey-patched at runtime. The fallback
      // logic (reject vscode-file for workbuddy, broaden title/url matching
      // for traework/qoderwork/workbuddy/doubao) has been merged into the
      // engine's static matchTarget in src/engine/src/adapters/*.mjs, so
      // engine truth and runtime behaviour agree by construction.
      //
      // The blocks below remain platform-only patches: defaultPort zeroing,
      // DevToolsActivePort file injection, and (for doubao) the Tencent
      // installer registry probing that augments executableCandidates.
      if (id === 'doubao') {
        // Tencent's Doubao installer registers an UninstallString pointing at
        // ..\Doubao\uninstall.exe, but the real executable is at
        // ..\Doubao\app\Doubao.exe. core's discoverWindowsRegistry only checks
        // InstallLocation (empty for Tencent installs) and DisplayIcon (an
        // .ico file, not .exe), so it never finds the exe. Probe the registry
        // ourselves and inject the discovered path as an executableCandidate.
        const regOut = await execFileAsync(
          'reg',
          ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Doubao', '/v', 'UninstallString'],
          3000,
        );
        const m = regOut.match(/UninstallString\s+REG_SZ\s+"?([^"\r\n]+)/i);
        if (m) {
          const uninstPath = m[1].trim().replace(/"$/, '');
          const doubaoRoot = path.dirname(uninstPath); // ..\Doubao
          const exePath = path.join(doubaoRoot, 'app', 'Doubao.exe');
          if (fs.existsSync(exePath)) {
            const existing = Array.isArray(plat.executableCandidates) ? plat.executableCandidates : [];
            if (!existing.includes(exePath)) {
              plat.executableCandidates = [...existing, exePath];
            }
          }
        }
      }
    }

    console.log(
      `[agentskin:cdp-patch] win32: ${liveFilesByDir.length} live DevToolsActivePort file(s) found, distributed per-app by dir name: ${liveFilesByDir.map((f) => `${f.dir}:${f.file}`).join(', ') || '(none)'}`,
    );
  } catch (err) {
    console.warn('[agentskin:cdp-patch] failed to patch windows adapters:', err);
  }
}

/**
 * Windows-only. Given an @agentskin/engine adapter, find its live CDP debugging
 * port without trusting the (often stale) DevToolsActivePort file.
 *
 * Steps:
 *   1. Resolve the adapter's win32 process names and enumerate their PIDs.
 *   2. Read each PID's command line for an explicit --remote-debugging-port
 *      (fast path — hits WorkBuddy's per-launch random port directly).
 *   3. Fall back to netstat PID→listening-ports mapping for port=0 apps.
 *   4. Probe each candidate's `http://127.0.0.1:<port>/json/list`; the first
 *      port that serves a CDP target accepted by `adapter.matchTarget` wins.
 *
 * Returns the port number, or null if no CDP endpoint is reachable.
 *
 * ALL process I/O is async. The previous implementation used synchronous
 * `execSync('tasklist')` + `execSync('netstat')` — measured at ~600ms +
 * ~80ms per call on a dev machine. `patchWindowsAdapters()` ran this once
 * per agent (6 agents) at module load, and the first `status()` poll ran it
 * again — freezing the Electron main-process event loop for ~3.6s, which
 * the user saw as "app frozen / not responding" during a plain boot with no
 * wallpaper or theme applied.
 */
async function discoverLiveCdpPortViaPid(adapter: unknown): Promise<number | null> {
  const a = adapter as { platforms?: { win32?: { processNames?: string[] } }; matchTarget?: (t: unknown) => boolean };
  const config = a?.platforms?.win32;
  if (!config) return null;
  const names = new Set(
    [...(config.processNames ?? [])]
      .map((n) => (/\.exe$/i.test(n) ? n : `${n}.exe`))
      .map((s) => s.toLowerCase()),
  );
  if (!names.size) return null;

  // Async tasklist — the sync form blocked the event loop for ~600ms per
  // call (measured). Never block the main process for process enumeration.
  const procs = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH']);
  const pids = new Set<number>();
  procs.split(/\r?\n/).forEach((line) => {
    const m = /^"([^"]+)","(\d+)"/.exec(line);
    if (m && names.has(m[1].toLowerCase())) pids.add(Number(m[2]));
  });
  if (!pids.size) return null;

  const match = a?.matchTarget;

  // Fast path: explicit --remote-debugging-port from the command line.
  // WorkBuddy's launcher writes a random port into argv per start, so this
  // hits on the first probe without scanning every listening socket.
  const explicitPorts = await explicitDebugPortsFromPids([...pids]);
  for (const port of explicitPorts) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const targets = (await res.json()) as unknown[];
      if (Array.isArray(targets) && match && targets.some((t) => match(t))) return port;
    } catch {
      /* explicit port not live yet (app still booting) — try netstat */
    }
  }

  // Fallback: async netstat PID→listening-ports (loopback-only, shared TTL
  // snapshot). Catches apps that use --remote-debugging-port=0 (Chromium
  // picks a free port itself, argv has no usable value) and any case where
  // the explicit port probe failed.
  const ports = await listeningPortsForPids([...pids]);

  for (const port of ports.sort((x, y) => x - y)) {
    // Already tried via the explicit path above — skip the re-probe.
    if (explicitPorts.includes(port)) continue;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 1500);
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const targets = (await res.json()) as unknown[];
      if (Array.isArray(targets) && match && targets.some((t) => match(t))) return port;
    } catch {
      /* not a CDP port (closed, proxy, or non-JSON) — try the next */
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Doubao (豆包) adapter registration
//
// The static adapter descriptor now lives in `src/engine/src/adapters/doubao.mjs`
// (registered via the engine's `adapters/index.mjs`). This block previously
// registered a minimal descriptor at module load as a stopgap until the
// engine shipped its own — that stopgap is no longer needed.
//
// What REMAINS here is `patchWindowsAdapters()`, which augments the engine's
// descriptor at runtime with Windows-specific state that can only be resolved
// at process start:
//   - Tencent installer registry probing → executableCandidates augmentation
//   - DevToolsActivePort file discovery (per-app dir-name matching)
//   - matchTarget wrapping (reject vscode-file://, broaden fallback matching)
//   - defaultPort zeroing (force dynamic port discovery)
// ---------------------------------------------------------------------------

void patchWindowsAdapters();
