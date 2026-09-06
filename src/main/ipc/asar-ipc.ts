// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR IPC
 *
 * IPC handlers for ASAR extraction — used by the Skills page engine update
 * workflow to discover, extract, and scan Electron app ASAR files.
 *
 * Bridges the renderer to the `scripts/extract-asar-summary.mjs` logic
 * (re-implemented inline for main-process use without spawning a child).
 *
 * Channels:
 *   - `ASAR_DISCOVER` — find ASAR files in an app directory
 *   - `ASAR_EXTRACT` — extract an ASAR to a temp directory
 *   - `ASAR_SCAN` — scan extracted ASAR for topology/strings/tokens/security/surfaces
 *   - `ASAR_READ_FILE` — read a text file from extracted ASAR
 */

import {
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import asar from '@electron/asar';
import { ipcMain } from 'electron';
import {
  extractCspFromHtml,
  type ScanFamily,
  scanFamilyForAgent,
} from '../../shared/asar-architecture';
import { IpcChannel } from '../../shared/ipc-channels';
import type { AgentId } from '../../shared/types/agent';
import {
  type ArchitectureProfile,
  collectSourceFiles,
  profileArchitecture,
} from './asar-architecture';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Agent architecture family — determines scanner behavior.
 *
 * The table lives in `shared/asar-architecture.ts`, not here. Three modules
 * (`asar-ipc`, `asar-joint-analysis`) used to carry
 * their own copy and disagreed — TRAE SOLO CN was `vscode` in one and `react`
 * in another. Import `scanFamilyForAgent` from shared rather than re-deriving
 * the answer a fourth time.
 *
 *   react  = bundled SPA (WorkBuddy WebView, QoderWork, ZCode, Codex, Doubao pages)
 *   vscode = VS Code OSS layout (TRAE SOLO CN only)
 */

/**
 * Platform-aware candidate install paths per agent.
 * Each entry is a thunk so env vars are read at call time (testable + fresh).
 *
 * Deep-verified paths (2026-08-30):
 *
 * ASAR打包型:
 *   WorkBuddy   → C:\Program Files\WorkBuddy\resources\app.asar (287 MB)
 *                 入口: cli/dist/web-ui/index.html (React+Vite, PWA)
 *   QoderWork   → C:\Program Files\QoderWork CN\QoderWork CN\resources\app.asar (165 MB)
 *                 入口: out/renderer/index.html (多页面: voice/mcp/artifact/quickpick)
 *   ZCode       → C:\Program Files\ZCode\resources\app.asar (308 MB)
 *                 入口: out/renderer/index.html (PDF.js+KaTeX, cua-permission-panel)
 *   Codex       → C:\Program Files\WindowsApps\OpenAI.Codex_*\app\resources\app.asar (287 MB)
 *                 MSIX安装, ACL保护, 入口: webview/index.html (极致CSP, 60+语言包)
 *
 * 非ASAR型:
 *   TRAE SOLO   → %LOCALAPPDATA%\Programs\TRAE SOLO CN\ (散文件, no app.asar)
 *                 入口: resources/app/out/vs/code/electron-browser/solo/solo-lite.html
 *                 node_modules.asar 是空壳 ({"files":{}}), 真实代码在 out/
 *   Doubao      → C:\MyAppPrograms\com.tencent.pcgame.doubao\Doubao\app\ (纯 Chromium)
 *                 Doubao.dll (306 MB C++), local_webcontents/extensions/ai-views/
 *                 无ASAR, 无Electron, 需CDP注入 (--remote-debugging-port)
 */
const AGENT_INSTALL_PATHS: Record<string, Array<() => string>> = {
  codex: [
    // MSIX install: WindowsApps (ACL protected, needs admin to extract)
    () => join('C:\\Program Files\\WindowsApps'),
    () => join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'WindowsApps'),
    () => join(process.env.APPDATA ?? '', 'Codex'),
    () => join(homedir(), '.codex'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Codex'),
  ],
  traework: [
    // Verified: %LOCALAPPDATA%\Programs\TRAE SOLO CN\ (散文件结构, no app.asar)
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'TRAE SOLO CN'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'traework'),
    () => join(process.env.LOCALAPPDATA ?? '', 'traework'),
    () => join(process.env.USERPROFILE ?? '', 'AppData', 'Local', 'traework'),
  ],
  workbuddy: [
    // Verified: C:\Program Files\WorkBuddy\resources\app.asar
    () => join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'WorkBuddy'),
    () => join('C:\\Program Files\\WorkBuddy'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'workbuddy'),
    () => join(process.env.LOCALAPPDATA ?? '', 'workbuddy'),
  ],
  qoderwork: [
    // Verified: C:\Program Files\QoderWork CN\QoderWork CN\resources\app.asar
    () => join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'QoderWork CN', 'QoderWork CN'),
    () => join('C:\\Program Files\\QoderWork CN', 'QoderWork CN'),
    () => join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'QoderWork CN'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'qoderwork'),
    () => join(process.env.LOCALAPPDATA ?? '', 'qoderwork'),
  ],
  zcode: [
    // Verified: C:\Program Files\ZCode\resources\app.asar
    () => join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'ZCode'),
    () => join('C:\\Program Files\\ZCode'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'zcode'),
    () => join(process.env.LOCALAPPDATA ?? '', 'zcode'),
  ],
  doubao: [
    // Verified: 纯 Chromium 封装, 无 asar
    // New install: C:\MyAppPrograms\com.tencent.pcgame.doubao\Doubao\app\
    () => join('C:\\MyAppPrograms', 'com.tencent.pcgame.doubao', 'Doubao', 'app'),
    // Old install: %LOCALAPPDATA%\Doubao\Application\app\
    () => join(process.env.LOCALAPPDATA ?? '', 'Doubao', 'Application', 'app'),
    () => join(process.env.LOCALAPPDATA ?? '', 'Programs', 'doubao'),
    () => join(process.env.LOCALAPPDATA ?? '', 'doubao'),
  ],
};

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'make',
  'win-unpacked',
  'mac',
  'locales',
  // Note: 'out' and 'dist' are NOT skipped globally — TRAE SOLO CN and
  // QoderWork keep their source in out/ directories. The family-specific
  // scanner (getReadableFiles) handles skip logic per-family.
]);

const MAX_TEXT_BYTES = 20 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AsarInfo {
  path: string;
  size: number;
  role: 'root' | 'webview';
  /**
   * 'asar' = standard asar file, needs extraction before scan.
   * 'loose' = loose files directory (e.g. TRAE SOLO CN, Doubao),
   *           can be scanned directly without extraction.
   */
  layout: 'asar' | 'loose';
}

export interface ScanResult {
  topology: {
    entries: Array<{ file: string; scripts: string[] }>;
    preloadScripts: string[];
    chunks: string[];
  };
  strings: {
    dataAttrs: Array<{ value: string; count: number }>;
    dataTestids: Array<{ value: string; count: number }>;
    ids: Array<{ value: string; count: number }>;
    ipcTypes: Array<{ value: string; count: number }>;
    i18nKeys: Array<{ value: string; count: number }>;
  };
  tokens: {
    namespaces: Record<string, { varCount: number; vars: Array<{ value: string; count: number }> }>;
    varCount: number;
    cssBytes: number;
    sheets: number;
  };
  fragilitySeeds: Array<{ anchor: string; kind: string; stability: string }>;
  security: {
    contextIsolation: boolean | null;
    webSecurity: boolean | null;
    sandbox: boolean | null;
    csp: { from: string; directives: Record<string, string[]> };
  };
  surfaces: {
    preloadExposed: Array<{ value: string; count: number }>;
    ipc: {
      handle: Array<{ value: string; count: number }>;
      invoke: Array<{ value: string; count: number }>;
      send: Array<{ value: string; count: number }>;
      on: Array<{ value: string; count: number }>;
    };
  };
  /**
   * Structural profile (entries, dependency graph, CDP surfaces, CSP grade,
   * recommended inject mechanism). Present only when the caller supplies an
   * `agentId` — optional so cached scan results from older sessions still
   * type-check.
   */
  architecture?: ArchitectureProfile;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function walkAsars(root: string): string[] {
  const found: string[] = [];
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  const MAX_DEPTH = 8;
  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    if (depth > MAX_DEPTH) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) stack.push({ dir: full, depth: depth + 1 });
      } else if (entry.isFile() && entry.name.endsWith('.asar')) {
        // Skip node_modules.asar — it's a bundled dependency archive, not app source.
        // TRAE SOLO CN has a 28-byte empty shell ("{\"files\":{}}") that we must skip.
        if (entry.name === 'node_modules.asar') continue;
        found.push(full);
      }
    }
  }
  return found;
}

function assignRoles(paths: string[]): AsarInfo[] {
  return paths.map((p) => {
    const norm = p.replace(/\\/g, '/');
    // Extended layout detection: standard React, minimal, and VS Code variants
    const isRoot =
      /(?:^|\/)resources\/app\.asar$/.test(norm) ||
      /(?:^|\/)app\.asar$/.test(norm) ||
      /(?:^|\/)(?:out|dist|build)\/app\.asar$/.test(norm) ||
      paths.length === 1;
    let size = -1;
    try {
      size = statSync(p).size;
    } catch {
      /* ignore */
    }
    return { path: p, size, role: isRoot ? 'root' : 'webview', layout: 'asar' as const };
  });
}

/**
 * Check if the app has a real app.asar in resources/ directory.
 * Some apps (like TRAE SOLO CN) may only expose node_modules.asar at the top level,
 * while the real app code lives in resources/app.asar.
 *
 * Codex MSIX layout: app/resources/app.asar (not standard resources/app.asar)
 * WorkBuddy layout: resources/app.asar (standard, entry: cli/dist/web-ui/)
 * QoderWork layout: resources/app.asar (entry: out/renderer/)
 * ZCode layout: resources/app.asar (entry: out/renderer/)
 */
function findRealAppAsar(rootDir: string): string[] {
  const found: string[] = [];
  // Standard Electron layout: resources/app.asar
  const candidates = [
    join(rootDir, 'resources', 'app.asar'),
    join(rootDir, 'app.asar'),
    // Some apps put asar in resources/app/ subfolder
    join(rootDir, 'resources', 'app', 'app.asar'),
    // VS Code-style: out/app.asar
    join(rootDir, 'resources', 'app', 'out', 'app.asar'),
    // Codex MSIX: app/resources/app.asar (extra nesting level)
    join(rootDir, 'app', 'resources', 'app.asar'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && !found.includes(c)) found.push(c);
  }
  return found.length > 0 ? found : [];
}

/**
 * Walk up from a given path to find the nearest directory containing a
 * `resources/` subfolder (standard Electron layout).
 * Stops after 5 levels to avoid walking to drive root.
 */
function findElectronRootDir(startPath: string): string | null {
  let current = startPath;
  for (let i = 0; i < 5; i++) {
    if (existsSync(join(current, 'resources'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // reached root
    current = parent;
  }
  return null;
}

/**
 * Resolve the Agent's install base directory.
 * Priority: providedPath (if exists) → candidate path table → null.
 * Handles .exe paths by walking up to find the Electron root (resources/ dir).
 *
 * Special cases:
 *   - Codex (MSIX): WindowsApps dir name is dynamic (OpenAI.Codex_版本_架构),
 *     so we glob for it.
 *   - TRAE SOLO CN: No app.asar — resources/app/ contains loose files.
 *   - Doubao: No asar at all — pure Chromium, scan app/ directly.
 */
function resolveAppBaseDir(agentId: string, providedPath?: string): string | null {
  // 1. If a path was explicitly provided and exists, use it
  if (providedPath) {
    if (existsSync(providedPath)) {
      // If it's an .exe, walk up to find the Electron root (resources/ dir)
      if (providedPath.endsWith('.exe')) {
        const exeDir = dirname(providedPath);
        const electronRoot = findElectronRootDir(exeDir);
        if (electronRoot) return electronRoot;
        return exeDir;
      }
      const stat = statSync(providedPath);
      if (stat.isDirectory()) {
        if (existsSync(join(providedPath, 'resources'))) {
          return providedPath;
        }
        const electronRoot = findElectronRootDir(providedPath);
        if (electronRoot) return electronRoot;
        return providedPath;
      }
      return dirname(providedPath);
    }
  }

  // 2. Fall back to candidate path table
  const candidates = AGENT_INSTALL_PATHS[agentId];
  if (!candidates) return null;

  for (const candidate of candidates) {
    const resolved = candidate();
    if (!resolved) continue;

    // Special handling for Codex MSIX: WindowsApps dir name is dynamic
    if (agentId === 'codex' && resolved.endsWith('WindowsApps')) {
      const msixDir = findCodexMsixDir(resolved);
      if (msixDir) return msixDir;
      continue;
    }

    // Prefer directories that contain a resources/ subfolder (Electron convention)
    if (existsSync(join(resolved, 'resources'))) {
      return resolved;
    }
    // Otherwise accept any existing directory
    if (existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

/**
 * Find the Codex MSIX install directory in WindowsApps.
 * Directory name pattern: OpenAI.Codex_<version>_<arch>__<rid>
 * e.g. OpenAI.Codex_26.825.5331.0_x64__8wekyb3d8bbwe
 */
function findCodexMsixDir(windowsAppsDir: string): string | null {
  let entries: Dirent[];
  try {
    entries = readdirSync(windowsAppsDir, { withFileTypes: true });
  } catch {
    // WindowsApps is ACL-protected — may need admin
    return null;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && /^OpenAI\.Codex_/i.test(entry.name)) {
      const full = join(windowsAppsDir, entry.name);
      // MSIX layout: app/resources/app.asar
      if (existsSync(join(full, 'app', 'resources'))) {
        return join(full, 'app');
      }
      if (existsSync(join(full, 'resources'))) {
        return full;
      }
      // Accept the directory itself
      return full;
    }
  }
  return null;
}

/**
 * Find the loose-files source directory for apps without an app.asar.
 *
 * TRAE SOLO CN: VS Code OSS散文件布局
 *   source in resources/app/out/vs/code/electron-browser/solo/
 *   → return resources/app/ (scanner will walk out/ for vscode family)
 *
 * Doubao: 纯Chromium封装架构
 *   source in local_webcontents/extensions/ai-views/ (HTML/JS/CSS)
 *   → return app/ or local_webcontents/ directory
 */
function findLooseSourceDir(baseDir: string, agentId: string): string | null {
  // TRAE SOLO CN: resources/app/ contains the VS Code source tree
  // Verified: node_modules.asar is empty shell (28 bytes), real code in out/
  const traeworkPaths = [
    join(baseDir, 'resources', 'app'),
    join(baseDir, 'resources', 'app', 'out'),
  ];
  for (const p of traeworkPaths) {
    if (existsSync(p)) {
      // Verify it has actual source files (not just an empty dir)
      try {
        const entries = readdirSync(p, { withFileTypes: true });
        if (entries.some((e) => e.isDirectory() || /\.(js|html|css)$/.test(e.name))) {
          return p;
        }
      } catch {}
    }
  }

  // Doubao: local_webcontents/extensions/ai-views/ has HTML pages
  // Also check app/ directly for .pak/.dat/.dll Chromium resources
  if (agentId === 'doubao') {
    const doubaoPaths = [
      join(baseDir, 'local_webcontents', 'extensions', 'ai-views'),
      join(baseDir, 'local_webcontents'),
      baseDir,
    ];
    for (const p of doubaoPaths) {
      if (existsSync(p)) {
        try {
          const entries = readdirSync(p, { withFileTypes: true });
          // Doubao has .html, .dll, .pak, .dat files
          if (entries.some((e) => /\.(js|html|css|dll|pak|dat)$/i.test(e.name))) {
            return p;
          }
        } catch {}
      }
    }
  }

  // Generic fallback: look for any directory with JS/HTML files
  const genericCandidates = [join(baseDir, 'resources', 'app'), join(baseDir, 'app'), baseDir];
  for (const p of genericCandidates) {
    if (existsSync(p)) {
      try {
        const entries = readdirSync(p, { withFileTypes: true });
        if (entries.some((e) => e.isDirectory() || /\.(js|html|css)$/.test(e.name))) {
          return p;
        }
      } catch {}
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

function extractAsarFile(asarPath: string, destDir: string): string[] {
  if (existsSync(destDir)) return [];
  mkdirSync(destDir, { recursive: true });
  const skipped: string[] = [];
  try {
    asar.extractAll(asarPath, destDir);
  } catch {
    // Fallback: per-file extraction with ENOENT tolerance
    const files = asar.listPackage(asarPath, { isPack: false });
    for (const entry of files) {
      const target = join(destDir, entry);
      if (existsSync(target)) continue;
      let buf: Buffer;
      try {
        buf = asar.extractFile(asarPath, entry);
      } catch {
        skipped.push(entry);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, buf);
    }
  }
  return skipped;
}

// ---------------------------------------------------------------------------
// Scanning utilities
// ---------------------------------------------------------------------------

/**
 * Collect the JS/HTML/CSS files under `dir`.
 *
 * Delegates to `asar-architecture.collectSourceFiles` — the architecture
 * profiler and this scanner must walk the same file set, otherwise the two
 * halves of a joint analysis disagree about what the package contains.
 *
 * Note: the old local copy branched on `family` to un-skip `out/`, but `out`
 * was never in the skip list, so the branch had no effect. The real
 * per-family difference (VS Code skips `extensions/` and `cmaps/`) now lives
 * in the shared walk.
 */
function getReadableFiles(dir: string, family: ScanFamily): string[] {
  return collectSourceFiles(dir, family);
}

function readTextSafe(file: string): string | null {
  try {
    const stat = statSync(file);
    if (stat.size > MAX_TEXT_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function countMatches(accum: Map<string, number>, matches: string[]): void {
  for (const m of matches) {
    accum.set(m, (accum.get(m) ?? 0) + 1);
  }
}

function toCounted(map: Map<string, number>): Array<{ value: string; count: number }> {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}

function namespaceOf(varName: string): string {
  const m = /^([a-z][a-z0-9]*)-/.exec(varName);
  return m ? m[1] : varName;
}

// ---------------------------------------------------------------------------
// Security & Surfaces collection (ported from extract-asar-summary.mjs)
// ---------------------------------------------------------------------------

function collectSecurity(
  files: Array<{ path: string; text: string; rel: string }>,
): ScanResult['security'] {
  const security: ScanResult['security'] = {
    contextIsolation: null,
    webSecurity: null,
    sandbox: null,
    csp: { from: 'none', directives: {} },
  };
  const htmlFiles: Array<{ rel: string; text: string }> = [];

  for (const { path, text, rel } of files) {
    if (/\.html$/.test(path)) htmlFiles.push({ rel, text });
    if (/\.(js|cjs|mjs)$/.test(path)) {
      const pick = (re: RegExp): boolean | null | string => {
        const m = re.exec(text);
        if (!m) return null;
        const raw = m[1];
        if (/!0|true|1/.test(raw)) return true;
        if (/!1|false|0/.test(raw)) return false;
        return raw;
      };
      if (security.contextIsolation === null)
        security.contextIsolation = pick(/contextIsolation\s*:\s*(\[?[^,\]}]+)/) as boolean | null;
      if (security.webSecurity === null)
        security.webSecurity = pick(/webSecurity\s*:\s*(\[?[^,\]}]+)/) as boolean | null;
      if (security.sandbox === null)
        security.sandbox = pick(/sandbox\s*:\s*(\[?[^,\]}]+)/) as boolean | null;
    }
  }

  // Parse CSP from HTML meta tags. The extraction rule (meta tag → decoded
  // directives) lives in shared/asar-architecture so the architecture profiler
  // grades the exact same directives this scanner reports.
  for (const { rel, text } of htmlFiles) {
    const directives = extractCspFromHtml(text);
    if (directives) {
      security.csp = { from: `meta:${rel}`, directives };
      break;
    }
  }

  return security;
}

function collectSurfaces(
  files: Array<{ path: string; text: string; rel: string }>,
): ScanResult['surfaces'] {
  const preloadExposed = new Map<string, number>();
  const ipc = {
    handle: new Map<string, number>(),
    invoke: new Map<string, number>(),
    send: new Map<string, number>(),
    on: new Map<string, number>(),
  };

  for (const { path, text } of files) {
    if (!/\.(js|cjs|mjs)$/.test(path)) continue;
    countMatches(
      preloadExposed,
      [...text.matchAll(/exposeInMainWorld\s*\(\s*["'`]([^"'`]+)/g)].map((m) => m[1]),
    );
    countMatches(
      ipc.handle,
      [...text.matchAll(/ipcMain\.(?:handle|handleOnce)\s*\(\s*["']([^"']+)/g)].map((m) => m[1]),
    );
    countMatches(
      ipc.on,
      [...text.matchAll(/ipcMain\.(?:on|once)\s*\(\s*["']([^"']+)/g)].map((m) => m[1]),
    );
    countMatches(
      ipc.send,
      [...text.matchAll(/(?:webContents\.)?\.send\s*\(\s*["']([^"']+)/g)].map((m) => m[1]),
    );
  }

  return {
    preloadExposed: toCounted(preloadExposed),
    ipc: {
      handle: toCounted(ipc.handle),
      invoke: toCounted(ipc.invoke),
      send: toCounted(ipc.send),
      on: toCounted(ipc.on),
    },
  };
}

// ---------------------------------------------------------------------------
// Main scan function
// ---------------------------------------------------------------------------

/**
 * Scan an extracted package for anchors, tokens, security posture and surfaces.
 *
 * @param family — scan strategy. Optional: when omitted it is derived from
 *   `agentId`, which is the only way to guarantee the renderer cannot diverge
 *   from the main-process table.
 * @param agentId — when supplied, the structural {@link ArchitectureProfile}
 *   (entries, dependency graph, CDP surfaces, CSP grade, inject mechanism) is
 *   attached to the result. Omit for a strings-only scan.
 */
export function scanExtractedAsar(
  extractDir: string,
  family: ScanFamily | undefined,
  agentId?: AgentId,
): ScanResult {
  const rawFiles = getReadableFiles(extractDir, family ?? scanFamilyForAgent(agentId));

  // Pre-read texts for reuse across collectors
  const files: Array<{ path: string; text: string; rel: string }> = [];
  for (const filePath of rawFiles) {
    const text = readTextSafe(filePath);
    if (text === null) continue;
    files.push({ path: filePath, text, rel: relative(extractDir, filePath).replace(/\\/g, '/') });
  }

  // Topology
  const entries: Array<{ file: string; scripts: string[] }> = [];
  const preloadScripts: string[] = [];
  const chunks: string[] = [];

  // Strings
  const dataAttrs = new Map<string, number>();
  const dataTestids = new Map<string, number>();
  const ids = new Map<string, number>();
  const ipcTypes = new Map<string, number>();
  const i18nKeys = new Map<string, number>();

  // Tokens
  const tokenBuckets = new Map<string, Map<string, number>>();
  let cssBytes = 0;
  let sheets = 0;

  for (const { path, text, rel } of files) {
    // Topology
    if (/\.html$/.test(path)) {
      const scripts = [...text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
      if (scripts.length) entries.push({ file: rel, scripts });
    }
    if (/(^|\/)(preload|sandbox|.*preload).*\.(cjs|js|mjs)$/i.test(rel) || /preload/i.test(rel)) {
      preloadScripts.push(rel);
    }
    if (/\.(js|mjs|cjs)$/.test(path)) {
      chunks.push(rel);
    }

    // Strings
    const dataAttrPairs = [
      ...text.matchAll(/["'](data-[a-z][a-z0-9-]*)["']/g),
      ...text.matchAll(/\[(data-[a-z][a-z0-9-]*)\]/g),
    ];
    countMatches(
      dataAttrs,
      dataAttrPairs.map((m) => m[1]),
    );
    countMatches(
      dataTestids,
      [...text.matchAll(/data-testid\s*[=:]?\s*["']([^"']+)["']/gi)].map((m) => m[1]),
    );
    if (/\.html$/.test(path)) {
      countMatches(
        ids,
        [...text.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]),
      );
    }

    // IPC types & i18n keys (JS files only)
    if (/\.(js|cjs|mjs)$/.test(path)) {
      countMatches(
        ipcTypes,
        [...text.matchAll(/["']([a-zA-Z][\w]*:[a-zA-Z][\w:.-]*)["']/g)].map((m) => m[1]),
      );
      countMatches(
        i18nKeys,
        [...text.matchAll(/(?:t|translate|i18n)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
      );
    }

    // Tokens
    if (/\.css$/.test(path)) {
      sheets++;
      cssBytes += Buffer.byteLength(text);
      for (const m of text.matchAll(/--([a-zA-Z][a-zA-Z0-9-]*)\s*:/gm)) {
        const key = m[1];
        const prefix = namespaceOf(key);
        if (!tokenBuckets.has(prefix)) tokenBuckets.set(prefix, new Map());
        const bucket = tokenBuckets.get(prefix)!;
        bucket.set(key, (bucket.get(key) ?? 0) + 1);
      }
    }
  }

  // Build token namespaces
  const namespaces: ScanResult['tokens']['namespaces'] = {};
  let varCount = 0;
  for (const [prefix, vars] of tokenBuckets) {
    namespaces[prefix] = { varCount: vars.size, vars: toCounted(vars) };
    varCount += vars.size;
  }

  // Build fragility seeds
  const fragilitySeeds: ScanResult['fragilitySeeds'] = [];
  for (const { value } of toCounted(dataTestids))
    fragilitySeeds.push({ anchor: value, kind: 'data-testid', stability: 'high' });
  for (const { value } of toCounted(ids))
    fragilitySeeds.push({ anchor: value, kind: 'id', stability: 'high' });
  for (const { value } of toCounted(dataAttrs)) {
    fragilitySeeds.push({
      anchor: value,
      kind: 'data-attr',
      stability: /-(portal|app-|agentskin)/.test(value) ? 'high' : 'medium',
    });
  }

  // Collect security & surfaces
  const security = collectSecurity(files);
  const surfaces = collectSurfaces(files);

  const result: ScanResult = {
    topology: { entries, preloadScripts, chunks },
    strings: {
      dataAttrs: toCounted(dataAttrs),
      dataTestids: toCounted(dataTestids),
      ids: toCounted(ids),
      ipcTypes: toCounted(ipcTypes),
      i18nKeys: toCounted(i18nKeys),
    },
    tokens: { namespaces, varCount, cssBytes, sheets },
    fragilitySeeds,
    security,
    surfaces,
  };

  // Structural profile — reuses the file list above so the package is walked
  // once, not twice. Without an agentId there is no family to profile against.
  if (agentId) {
    result.architecture = profileArchitecture(extractDir, agentId, rawFiles);
  }

  return result;
}

// ---------------------------------------------------------------------------
// IPC Registration
// ---------------------------------------------------------------------------

export function registerAsarIpc(): void {
  // --- Discover ASAR files ---
  ipcMain.handle(
    IpcChannel.ASAR_DISCOVER,
    async (_evt, request: { appPath?: string; agentId?: string }) => {
      // Resolve base directory: explicit path → auto-discovery via agentId
      let baseDir: string | null = null;

      if (request.appPath || request.agentId) {
        baseDir = resolveAppBaseDir(request.agentId ?? '', request.appPath);
      }

      if (!baseDir) {
        throw new Error(`未找到 ${request.agentId ?? '应用'} 的安装目录。请手动指定路径。`);
      }

      // Direct path check: if the baseDir is an .asar file itself, use it directly
      let asarPaths: string[] = baseDir.endsWith('.asar') ? [baseDir] : walkAsars(baseDir);

      // Fallback: if walk found nothing or only node_modules.asar, try
      // locating the real app.asar in standard Electron locations
      if (asarPaths.length === 0) {
        const realAppAsars = findRealAppAsar(baseDir);
        if (realAppAsars.length > 0) {
          asarPaths = realAppAsars;
        }
      }

      // Last resort: check if baseDir has a resources/ subdir that walk might have missed
      if (asarPaths.length === 0 && existsSync(join(baseDir, 'resources'))) {
        const resourcesDir = join(baseDir, 'resources');
        const realAppAsars = findRealAppAsar(baseDir);
        if (realAppAsars.length > 0) {
          asarPaths = realAppAsars;
        }
        // Also try walking just the resources dir
        const resourcesAsars = walkAsars(resourcesDir);
        if (resourcesAsars.length > 0) {
          asarPaths = resourcesAsars;
        }
      }

      // Special case: TRAE SOLO CN / Doubao — no app.asar exists.
      // Return the loose-files directory as a synthetic 'loose' entry.
      // The frontend can scan this directly without extraction.
      if (asarPaths.length === 0) {
        const looseDir = findLooseSourceDir(baseDir, request.agentId ?? '');
        if (looseDir) {
          let looseSize = -1;
          try {
            looseSize = statSync(looseDir).size;
          } catch {
            /* ignore */
          }
          return [
            {
              path: looseDir,
              size: looseSize,
              role: 'root' as const,
              layout: 'loose' as const,
            },
          ];
        }
      }

      if (asarPaths.length === 0) {
        throw new Error(`在 ${baseDir} 中未找到 .asar 文件（已排除 node_modules.asar）`);
      }

      return assignRoles(asarPaths);
    },
  );

  // --- Extract ASAR ---
  // For 'loose' layout (TRAE SOLO CN, Doubao), skip extraction — the path
  // IS the source directory. Return it directly.
  ipcMain.handle(IpcChannel.ASAR_EXTRACT, async (_evt, asarPath: string, destDir: string) => {
    // If the path is a directory (loose layout), return it as-is
    try {
      const stat = statSync(asarPath);
      if (stat.isDirectory()) {
        return { extractedTo: asarPath, skipped: [] };
      }
    } catch {
      // fall through to normal extraction
    }

    const resolved = isAbsolute(destDir) ? destDir : join(tmpdir(), destDir);
    const skipped = extractAsarFile(asarPath, resolved);
    return { extractedTo: resolved, skipped };
  });

  // --- Scan extracted ASAR ---
  // `agentId` is optional: when present the scan also returns the structural
  // ArchitectureProfile that the CDP joint analysis consumes.
  ipcMain.handle(
    IpcChannel.ASAR_SCAN,
    async (_evt, extractDir: string, family: ScanFamily | undefined, agentId?: AgentId) => {
      return scanExtractedAsar(resolve(extractDir), family, agentId);
    },
  );

  // --- Read file from extracted ASAR ---
  ipcMain.handle(IpcChannel.ASAR_READ_FILE, async (_evt, extractDir: string, filePath: string) => {
    const fullPath = resolve(extractDir, filePath);
    // Security: ensure the resolved path is within extractDir
    if (!fullPath.startsWith(resolve(extractDir))) {
      return null;
    }
    const content = readTextSafe(fullPath);
    if (content === null) return null;
    return { content, size: Buffer.byteLength(content) };
  });
}
