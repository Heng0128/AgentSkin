// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR architecture classification — single source of truth
 *
 * Encodes the deep architecture analysis of the six supported Agents so the
 * main-process scanner, the CDP joint analysis, and the Studio UI all agree
 * on what an app *is* instead of each carrying a private copy of the answer.
 *
 * Before this module the same question — "which scan strategy applies to this
 * agent?" — was answered three times in three places with three different
 * results (`asar-ipc.ts`, `asar-joint-analysis.ts`),
 * and TRAE SOLO CN got a different answer in each. Anything importing this
 * module gets one answer.
 *
 * ## Architecture families (verified 2026-08-30)
 *
 * ASAR-packaged (4):
 *   workbuddy — Electron + WebView sandbox, React+Vite, PWA.
 *               Entry: `cli/dist/web-ui/index.html`
 *   qoderwork — Electron multi-page renderer, React+Vite, 5 HTML entries.
 *               Entry: `out/renderer/index.html`
 *   zcode     — Electron renderer, React+Vite, PDF.js + KaTeX.
 *               Entry: `out/renderer/index.html`
 *   codex     — Electron webview, React+Rolldown, strict CSP, 60+ locales.
 *               Entry: `webview/index.html`
 *
 * Non-ASAR (2):
 *   traework  — VS Code OSS loose-file layout (no app.asar at all;
 *               `node_modules.asar` is a 28-byte `{"files":{}}` shell).
 *               Entry: `resources/app/out/vs/code/electron-browser/solo/solo-lite.html`
 *   doubao    — Pure Chromium shell (Doubao.exe + Doubao.dll ~306 MB, no
 *               Electron). Pages live in `local_webcontents/extensions/ai-views/`.
 *               Requires `--remote-debugging-port` for CDP.
 *
 * ## Layer safety
 *
 * This module is pure — no `node:` imports, no `electron`, no fs. It is safe
 * to import from `src/main/` and `src/ui/` alike (C4 boundary).
 */

import type { AgentId } from './types/agent';

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

/**
 * Scanner strategy for the source walk.
 *
 * `react`   — bundled SPA: hashed asset filenames, code-split chunks, ESM.
 * `vscode`  — VS Code OSS tree: huge `out/**` modules, AMD `require([])`,
 *             workbench CSS custom properties (`--vscode-*`).
 */
export type ScanFamily = 'react' | 'vscode';

/** The architectural shape of the target app. */
export type ArchitectureFamily =
  /** Electron + isolated WebView sandbox (WorkBuddy, Codex). */
  | 'react-webview'
  /** Electron + multi-page BrowserWindow renderers (QoderWork, ZCode). */
  | 'react-renderer'
  /** VS Code OSS loose-file layout (TRAE SOLO CN). */
  | 'vscode-loose'
  /** Non-Electron Chromium shell (Doubao). */
  | 'chromium-native';

/**
 * Scan strategy per agent.
 *
 * TRAE SOLO CN is the only genuine VS Code layout — everything else ships a
 * bundled SPA even when its directory happens to be named `out/`.
 */
export const AGENT_SCAN_FAMILY: Readonly<Record<AgentId, ScanFamily>> = Object.freeze({
  workbuddy: 'react',
  qoderwork: 'react',
  zcode: 'react',
  codex: 'react',
  traework: 'vscode',
  // No ASAR at all; scan the loose `local_webcontents` pages like a SPA.
  doubao: 'react',
});

/** Architectural family per agent — drives the inject-strategy recommendation. */
export const AGENT_ARCH_FAMILY: Readonly<Record<AgentId, ArchitectureFamily>> = Object.freeze({
  workbuddy: 'react-webview',
  codex: 'react-webview',
  qoderwork: 'react-renderer',
  zcode: 'react-renderer',
  traework: 'vscode-loose',
  doubao: 'chromium-native',
});

/** Scan strategy for an agent. Unknown ids fall back to the bundled-SPA walk. */
export function scanFamilyForAgent(agentId: AgentId | string | undefined): ScanFamily {
  if (!agentId) return 'react';
  return AGENT_SCAN_FAMILY[agentId as AgentId] ?? 'react';
}

/** Architectural family for an agent. Unknown ids are treated as a bundled SPA. */
export function architectureFamilyFor(agentId: AgentId | string | undefined): ArchitectureFamily {
  if (!agentId) return 'react-renderer';
  return AGENT_ARCH_FAMILY[agentId as AgentId] ?? 'react-renderer';
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** The UI role an HTML entry plays inside the host app. */
export type EntryRole =
  /** Primary workbench / chat surface. */
  | 'main'
  /** Floating voice-input layer (QoderWork `voice-overlay.html`). */
  | 'voice-overlay'
  /** Model Context Protocol app preview (QoderWork `mcp-app-preview.html`). */
  | 'mcp-preview'
  /** Artifact viewer (QoderWork `artifact-preview.html`). */
  | 'artifact-preview'
  /** Command palette / quick pick (QoderWork `quickpick.html`). */
  | 'quickpick'
  /** Permission prompt (ZCode `cua-permission-panel.html`). */
  | 'permission-panel'
  /** Process explorer (ZCode `process-monitor.html`). */
  | 'process-monitor'
  /** Chromium extension page (Doubao `side_panel.html` / `popup.html`). */
  | 'extension-page'
  /** Recognized as an entry but with no known role. */
  | 'unknown';

/**
 * Ordered role matchers — first hit wins.
 *
 * Ordered most-specific first: `voice-overlay.html` contains "overlay" and is
 * not the main surface, so the specific patterns must precede the generic
 * `main` patterns at the bottom.
 */
const ENTRY_ROLE_PATTERNS: ReadonlyArray<readonly [RegExp, EntryRole]> = Object.freeze([
  [/voice[-_]?overlay/i, 'voice-overlay'],
  [/mcp[-_]?app[-_]?preview|mcp[-_]?preview/i, 'mcp-preview'],
  [/artifact[-_]?preview/i, 'artifact-preview'],
  [/quick[-_]?pick|command[-_]?palette/i, 'quickpick'],
  [/(?:cua[-_]?)?permission[-_]?panel/i, 'permission-panel'],
  [/process[-_]?monitor|process[-_]?explorer/i, 'process-monitor'],
  [/side[-_]?panel|popup|options/i, 'extension-page'],
  // VS Code workbench hosts and generic SPA shells.
  [/(?:^|\/)(?:index|main|solo[-_]?lite|workbench)\.html$/i, 'main'],
]);

/**
 * Classify an HTML entry by its path.
 *
 * @param file — path relative to the extracted root (either separator).
 */
export function classifyEntryRole(file: string): EntryRole {
  const normalized = file.replace(/\\/g, '/');
  for (const [pattern, role] of ENTRY_ROLE_PATTERNS) {
    if (pattern.test(normalized)) return role;
  }
  return 'unknown';
}

/** Roles that live in their own BrowserWindow and therefore own CDP target. */
const SEPARATE_TARGET_ROLES: ReadonlySet<EntryRole> = new Set<EntryRole>([
  'voice-overlay',
  'mcp-preview',
  'artifact-preview',
  'quickpick',
  'permission-panel',
  'process-monitor',
  'extension-page',
]);

/**
 * Whether a role is served from an independent window.
 *
 * Multi-page Agents (QoderWork: 5 entries, ZCode: 3) open overlays and panels
 * as separate BrowserWindows, so the CDP target list contains one target per
 * page. A theme injected only into the primary target misses them entirely —
 * which is why the joint analysis must enumerate and report them.
 */
export function requiresSeparateTarget(role: EntryRole): boolean {
  return SEPARATE_TARGET_ROLES.has(role);
}

/** Stable ordering used to pick the primary entry when several match `main`. */
const ROLE_PRIORITY: Readonly<Record<EntryRole, number>> = Object.freeze({
  main: 0,
  unknown: 1,
  'voice-overlay': 2,
  'mcp-preview': 2,
  'artifact-preview': 2,
  quickpick: 2,
  'permission-panel': 2,
  'process-monitor': 2,
  'extension-page': 2,
});

/** Compare two entries so `main` sorts first, then shorter (shallower) paths. */
export function compareEntries(
  a: { file: string; role: EntryRole },
  b: { file: string; role: EntryRole },
): number {
  const pa = ROLE_PRIORITY[a.role] ?? 99;
  const pb = ROLE_PRIORITY[b.role] ?? 99;
  if (pa !== pb) return pa - pb;
  const da = a.file.split('/').length;
  const db = b.file.split('/').length;
  if (da !== db) return da - db;
  return a.file.length - b.file.length;
}

// ---------------------------------------------------------------------------
// CSP
// ---------------------------------------------------------------------------

/** Decode the HTML entities that appear inside attribute values. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isNaN(code) ? _match : String.fromCodePoint(code);
    }
    return named[entity.toLowerCase()] ?? _match;
  });
}

/** Split a CSP header/meta `content` value into a directive → sources map. */
export function parseCspDirectives(content: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of content.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const [name, ...rest] = seg.split(/\s+/);
    if (name) directives[name] = rest;
  }
  return directives;
}

/** Extract the CSP directive map from an HTML document, if it declares one. */
export function extractCspFromHtml(html: string): Record<string, string[]> | undefined {
  const match =
    /<meta\b[^>]*\bhttp-equiv=["']content-security-policy["'][^>]*\bcontent=(["'])([\s\S]*?)\1/i.exec(
      html,
    );
  if (!match) return undefined;
  return parseCspDirectives(decodeHtmlEntities(match[2]));
}

/**
 * How restrictive an app's Content-Security-Policy is, from the injector's
 * point of view — i.e. how hard it is to get our CSS into the page.
 */
export type CspStrength =
  /** No CSP declared at all. */
  | 'none'
  /** Wildcards or `unsafe-inline` present — anything goes. */
  | 'low'
  /** Allow-listed sources, no wildcards. */
  | 'medium'
  /** `default-src 'none'` — everything must be explicitly granted. */
  | 'high'
  /** `default-src 'none'` **and** script/style gated behind hashes/nonces. */
  | 'extreme';

/**
 * Grade a parsed CSP directive map.
 *
 * Codex ships `default-src 'none'; script-src 'self' 'sha256-…' 'wasm-unsafe-eval'`
 * which is the harshest policy in the field — inline `<style>` and inline
 * `style` attributes are both rejected, so only `adoptedStyleSheets`
 * (constructed stylesheets are not subject to CSP style-src) can carry a theme.
 */
export function classifyCspStrength(
  directives: Readonly<Record<string, string[]>> | undefined,
): CspStrength {
  if (!directives) return 'none';

  const defaultSrc = directives['default-src'] ?? [];
  // CSP inheritance: a directive that is absent falls back to `default-src`.
  // Getting this wrong is not academic — `default-src 'self'` with no
  // `style-src` still blocks an inline <style>, and grading it 'low' would
  // recommend a mechanism the page rejects.
  const scriptSrc = directives['script-src'] ?? defaultSrc;
  const styleSrc = directives['style-src'] ?? defaultSrc;

  if (defaultSrc.length === 0 && scriptSrc.length === 0 && styleSrc.length === 0) {
    return 'none';
  }

  const sources = [...scriptSrc, ...styleSrc];
  const lockedDown = defaultSrc.includes("'none'");
  const hashGated = sources.some((v) => v.startsWith("'sha") || v.startsWith("'nonce-"));
  const wildcard = sources.includes('*') || defaultSrc.includes('*');
  const unsafe = sources.some((v) => v === "'unsafe-inline'" || v === "'unsafe-eval'");

  if (wildcard || unsafe) return 'low';
  if (lockedDown && hashGated) return 'extreme';
  if (lockedDown) return 'high';
  // Anything left is an allow-list ('self' or named hosts): inline style is
  // not granted, but the page is not locked down either.
  return 'medium';
}

// ---------------------------------------------------------------------------
// Inject strategy
// ---------------------------------------------------------------------------

/**
 * How AgentSkin should deliver CSS into the page.
 *
 * `adoptedStyleSheets` — constructed stylesheets, not subject to CSP style-src.
 * `inline-style`       — a `<style>` element; simplest, blocked under strict CSP.
 */
export type InjectMechanism = 'adoptedStyleSheets' | 'inline-style';

/** A mechanism recommendation plus the evidence behind it. */
export interface InjectStrategy {
  mechanism: InjectMechanism;
  reasons: string[];
}

/**
 * Recommend a delivery mechanism from the CSP grade and the architecture family.
 *
 * The recommendation is advisory: the injection engines make the final call,
 * but a wrong guess here means a silently ineffective theme, so every reason
 * is surfaced to the operator in the joint-analysis report.
 */
export function recommendInjectStrategy(
  csp: CspStrength,
  family: ArchitectureFamily,
): InjectStrategy {
  const reasons: string[] = [];

  if (family === 'chromium-native') {
    reasons.push(
      '非 Electron 应用（Chromium 封装）— 需以 --remote-debugging-port 启动后才能接入 CDP',
    );
  }
  if (family === 'vscode-loose') {
    reasons.push(
      'VS Code 布局：样式需叠加在 --vscode-* / --vscode-icube-* 之上，避免覆盖 workbench 变量',
    );
  }
  if (family === 'react-webview') {
    reasons.push('WebView 沙箱：主窗口与 webview 是不同 CDP target，需分别注入');
  }

  switch (csp) {
    case 'extreme':
      reasons.push("CSP 为 default-src 'none' 且脚本受哈希/ nonce 保护 — 内联 <style> 会被拒绝");
      return { mechanism: 'adoptedStyleSheets', reasons };
    case 'high':
      reasons.push("CSP 为 default-src 'none' — 内联样式默认不被授权");
      return { mechanism: 'adoptedStyleSheets', reasons };
    case 'medium':
      reasons.push('CSP 为白名单来源 — 内联样式可能被拒绝，优先使用 adoptedStyleSheets');
      return { mechanism: 'adoptedStyleSheets', reasons };
    case 'low':
      reasons.push('CSP 宽松（含 unsafe-inline 或通配源）— 内联 <style> 可用');
      return { mechanism: 'inline-style', reasons };
    // 'none'（未声明 CSP）与任何未识别的等级都按最宽松处理。
    default:
      reasons.push('未检出 CSP 声明 — 内联 <style> 可用');
      return { mechanism: 'inline-style', reasons };
  }
}

// ---------------------------------------------------------------------------
// Architecture profile shapes
// ---------------------------------------------------------------------------

/**
 * The profile types live here, not next to the profiler in `src/main/`, because
 * `shared/types/ipc.ts` has to describe them in the IPC contract and shared
 * must never import main (C4). The profiler itself stays in main — it walks the
 * filesystem.
 */

/** How a script/style resource is attached to an entry. */
export type DependencyKind = 'script' | 'style' | 'import' | 'dynamic-import' | 'require' | 'amd';

/** One HTML entry point and everything it pulls in directly. */
export interface EntryPoint {
  /** Path relative to the extracted root, POSIX separators. */
  file: string;
  role: EntryRole;
  /** `<script src>` values, as written in the HTML. */
  scripts: string[];
  /** `<link rel="stylesheet">` values, as written in the HTML. */
  styles: string[];
  /** `type="module"` → module, otherwise classic, absent → unknown. */
  moduleType: 'module' | 'classic' | 'unknown';
  /** CSP declared by this entry. */
  csp: CspStrength;
  bytes: number;
}

/** A resolved or unresolved module edge. */
export interface DependencyEdge {
  /** Importing file, relative to the extracted root. */
  from: string;
  /** Specifier exactly as written in the source. */
  to: string;
  /** Resolved file when the specifier maps onto a file inside the package. */
  resolved?: string;
  kind: DependencyKind;
}

/**
 * A UI surface that must be reached over CDP.
 *
 * `requiresSeparateTarget` is true for overlays/panels the host opens in their
 * own BrowserWindow — they never appear inside the primary target's DOM, so an
 * apply that only touches the primary renderer leaves them unthemed.
 */
export interface CdpSurface {
  role: EntryRole;
  /** Entry HTML, relative to the extracted root. */
  entry: string;
  requiresSeparateTarget: boolean;
}

/** The structural profile of an extracted Agent package. */
export interface ArchitectureProfile {
  agentId: AgentId;
  /** Architectural shape (webview / multi-page renderer / VS Code / Chromium). */
  family: ArchitectureFamily;
  /** Scan strategy used for the source walk. */
  scanFamily: ScanFamily;
  entryPoints: EntryPoint[];
  /** The entry that represents the app's primary workbench. */
  primaryEntry?: string;
  /** `main` field of the package.json at the extracted root, when present. */
  packageMain?: string;
  dependencies: DependencyEdge[];
  /** Strongest CSP grade across all entries. */
  csp: CspStrength;
  /** Entry file the strongest CSP was read from. */
  cspFrom?: string;
  surfaces: CdpSurface[];
  inject: InjectStrategy;
  /** CSS custom-property namespaces found (`vscode`, `icube`, …). */
  tokenNamespaces: string[];
  stats: {
    html: number;
    js: number;
    css: number;
    bytes: number;
  };
}
