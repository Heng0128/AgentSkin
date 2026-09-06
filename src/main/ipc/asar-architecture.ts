// SPDX-License-Identifier: MPL-2.0

/**
 * # ASAR architecture profiler
 *
 * Turns an extracted ASAR (or a loose-file source tree) into the structural
 * facts the CDP side needs before it can inject anything:
 *
 *   - **entry points** — every HTML file, its UI role, its scripts/styles,
 *     whether it loads as an ES module, and the CSP it declares;
 *   - **dependency graph** — script/link edges plus ESM `import`, dynamic
 *     `import()`, CJS `require`, and AMD `define([...])` edges;
 *   - **CDP surfaces** — which entries open their own BrowserWindow and thus
 *     appear as a separate CDP target (QoderWork ships 5 HTML entries, ZCode 3);
 *   - **inject strategy** — `adoptedStyleSheets` vs inline `<style>`, derived
 *     from the CSP grade and the architecture family.
 *
 * Without this, the CDP layer probes the first target it finds and hopes; with
 * it, an apply can address every surface and pick a mechanism the page's CSP
 * will actually accept.
 *
 * ## Ownership
 *
 * This module owns the source walk for ASAR scans — `asar-ipc.ts` imports
 * {@link collectSourceFiles} from here rather than keeping a private copy, so
 * the string/token scan and the architecture profile are always computed over
 * the same file set. Never import `asar-ipc` from this file (circular).
 */

import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, resolve as resolvePath } from 'node:path';
import {
  type ArchitectureProfile,
  architectureFamilyFor,
  type CdpSurface,
  type CspStrength,
  classifyCspStrength,
  classifyEntryRole,
  compareEntries,
  type DependencyEdge,
  type DependencyKind,
  type EntryPoint,
  extractCspFromHtml,
  recommendInjectStrategy,
  requiresSeparateTarget,
  type ScanFamily,
  scanFamilyForAgent,
} from '../../shared/asar-architecture';
import type { AgentId } from '../../shared/types/agent';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Max bytes of a single HTML file to parse for entry extraction. */
const ENTRY_READ_LIMIT = 20 * 1024 * 1024;
/** Max bytes of a single JS file to parse for dependency edges. */
const DEP_READ_LIMIT = 8 * 1024 * 1024;
/** Max HTML entries profiled — beyond this the extra pages are noise. */
const MAX_ENTRIES = 40;
/** Max JS files parsed for dependency edges (bundles repeat the same graph). */
const MAX_DEP_FILES = 300;
/** Max dependency edges retained — the graph is for orientation, not completeness. */
const MAX_EDGES = 800;
/** Max CSS files parsed for token namespaces. */
const MAX_TOKEN_FILES = 60;
/** Max bytes of a CSS file to parse for token namespaces. */
const TOKEN_READ_LIMIT = 8 * 1024 * 1024;
/** Max distinct token namespaces retained. */
const MAX_NAMESPACES = 64;

// ---------------------------------------------------------------------------
// Types (declared in shared so the IPC contract can describe them — see
// `shared/asar-architecture.ts`; re-exported here for main-layer callers)
// ---------------------------------------------------------------------------

export type { ArchitectureProfile, CdpSurface, DependencyEdge, DependencyKind, EntryPoint };

// ---------------------------------------------------------------------------
// Source walk
// ---------------------------------------------------------------------------

/** Directories that never contain app source, for either family. */
const SHARED_SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'make',
  'win-unpacked',
  'mac',
  'locales',
]);

/**
 * Extra skips for the VS Code family.
 *
 * TRAE SOLO CN's `resources/app/extensions/` holds hundreds of bundled
 * extensions and `pdfjs/cmaps/` holds 30+ binary CJK maps — neither is part of
 * the workbench surface we theme, and both are large enough to dominate the
 * walk. `out/` is deliberately **not** skipped: that is where the workbench
 * actually lives.
 */
const VSCODE_EXTRA_SKIP_DIRS = new Set(['extensions', 'cmaps', 'typings']);

const SOURCE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.html', '.css']);

/**
 * Collect JS/HTML/CSS files under `dir`.
 *
 * This is the walk the whole ASAR pipeline shares — `asar-ipc.ts` uses it for
 * the string/token scan and this module reuses the same list, so both phases
 * agree on what "the source" is.
 */
export function collectSourceFiles(dir: string, family: ScanFamily): string[] {
  const files: string[] = [];
  const skip =
    family === 'vscode'
      ? new Set([...SHARED_SKIP_DIRS, ...VSCODE_EXTRA_SKIP_DIRS])
      : SHARED_SKIP_DIRS;

  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const dot = entry.name.lastIndexOf('.');
      if (dot < 0) continue;
      if (SOURCE_EXTENSIONS.has(entry.name.slice(dot).toLowerCase())) files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, '/');
}

function readCapped(file: string, limit: number): string | null {
  try {
    if (statSync(file).size > limit) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

/** `<script src="…">` and `<link rel="stylesheet">` extraction. */
function parseHtmlEntry(html: string): {
  scripts: Array<{ src: string; module: boolean }>;
  styles: string[];
} {
  const scripts: Array<{ src: string; module: boolean }> = [];
  for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (!src) continue;
    const type = /\stype\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    scripts.push({ src: src[1], module: type?.[1]?.toLowerCase() === 'module' });
  }
  const styles: string[] = [];
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag[0])) continue;
    const href = /\shref\s*=\s*["']([^"']+)["']/i.exec(tag[0]);
    if (href) styles.push(href[1]);
  }
  return { scripts, styles };
}

// ---------------------------------------------------------------------------
// Dependency parsing
// ---------------------------------------------------------------------------

const RE_ESM_FROM = /\bfrom\s*["']([^"']+)["']/g;
const RE_ESM_BARE = /\bimport\s*["']([^"']+)["']/g;
const RE_DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
const RE_REQUIRE = /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
/** AMD dependency arrays: `define(["a","b"], …)` / `require([…], …)`. */
const RE_AMD_ARRAY = /\b(?:define|require)\s*\(\s*\[([^\]]{0,4000})\]/g;
const RE_QUOTED = /["']([^"']+)["']/g;
/** CSS custom-property declarations. */
const RE_CSS_VAR = /--([a-zA-Z][a-zA-Z0-9-]*)\s*:/gm;

/**
 * Extract module edges from one JS file.
 *
 * Minified bundles legitimately contain all three module systems (the bundler
 * output, a CJS shim, and a VS Code AMD wrapper), so every pattern runs and the
 * results are de-duplicated by `kind|specifier`.
 */
function parseDependencies(text: string): Array<{ to: string; kind: DependencyKind }> {
  const seen = new Set<string>();
  const out: Array<{ to: string; kind: DependencyKind }> = [];
  const push = (to: string, kind: DependencyKind): void => {
    const key = `${kind}|${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to, kind });
  };

  for (const m of text.matchAll(RE_DYNAMIC_IMPORT)) push(m[1], 'dynamic-import');
  for (const m of text.matchAll(RE_ESM_FROM)) push(m[1], 'import');
  for (const m of text.matchAll(RE_ESM_BARE)) push(m[1], 'import');
  for (const m of text.matchAll(RE_REQUIRE)) push(m[1], 'require');
  for (const m of text.matchAll(RE_AMD_ARRAY)) {
    for (const dep of m[1].matchAll(RE_QUOTED)) push(dep[1], 'amd');
  }
  return out;
}

/** Case-insensitive lookup index for packages authored on Windows. */
interface FileIndex {
  exact: ReadonlySet<string>;
  lower: Map<string, string>;
}

function buildFileIndex(root: string, files: readonly string[]): FileIndex {
  const exact = new Set<string>();
  const lower = new Map<string, string>();
  for (const file of files) {
    const rel = toRel(root, file);
    exact.add(rel);
    const key = rel.toLowerCase();
    if (!lower.has(key)) lower.set(key, rel);
  }
  return { exact, lower };
}

/**
 * Resolve a relative specifier against the importing file.
 *
 * Only `./` and `../` specifiers are resolved — bare specifiers (`react`,
 * `vs/code/...`) resolve against node_modules or an AMD loader map, and
 * guessing those produces more noise than signal.
 */
function resolveSpecifier(
  fromFile: string,
  specifier: string,
  index: FileIndex,
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined;
  // `join`, not `resolve`: profile paths are root-relative (no leading '/'),
  // and `posix.resolve` would prepend process.cwd() to every single one.
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  for (const candidate of [
    base,
    `${base}.js`,
    `${base}.mjs`,
    `${base}.cjs`,
    posix.join(base, 'index.js'),
  ]) {
    if (index.exact.has(candidate)) return candidate;
  }
  return index.lower.get(base.toLowerCase());
}

// ---------------------------------------------------------------------------
// Profiling
// ---------------------------------------------------------------------------

/** Ordering used to keep the strongest CSP across all entries. */
const CSP_RANK: Readonly<Record<CspStrength, number>> = Object.freeze({
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  extreme: 4,
});

/**
 * Profile an extracted Agent package.
 *
 * @param extractDir — extracted ASAR root, or the loose source directory for
 *   non-ASAR apps (TRAE SOLO CN, Doubao).
 * @param agentId — drives the family tables.
 * @param files — pre-collected file list; pass it to avoid walking the tree a
 *   second time when the caller already scanned (see `asar-ipc.scanExtractedAsar`).
 */
export function profileArchitecture(
  extractDir: string,
  agentId: AgentId,
  files?: readonly string[],
): ArchitectureProfile {
  const root = resolvePath(extractDir);
  const scanFamily = scanFamilyForAgent(agentId);
  const family = architectureFamilyFor(agentId);
  const allFiles = files ?? collectSourceFiles(root, scanFamily);

  const htmlFiles: string[] = [];
  const jsFiles: string[] = [];
  const cssFiles: string[] = [];
  let bytes = 0;

  for (const file of allFiles) {
    const lower = file.toLowerCase();
    if (lower.endsWith('.html')) htmlFiles.push(file);
    else if (lower.endsWith('.css')) cssFiles.push(file);
    else jsFiles.push(file);
    try {
      bytes += statSync(file).size;
    } catch {
      /* unreadable file — the byte total is informational only */
    }
  }

  // --- Entry points -------------------------------------------------------
  const entryPoints: EntryPoint[] = [];
  let csp: CspStrength = 'none';
  let cspFrom: string | undefined;

  for (const file of htmlFiles.slice(0, MAX_ENTRIES)) {
    const html = readCapped(file, ENTRY_READ_LIMIT);
    if (html === null) continue;
    const rel = toRel(root, file);
    const { scripts, styles } = parseHtmlEntry(html);
    const entryCsp = classifyCspStrength(extractCspFromHtml(html));

    if (CSP_RANK[entryCsp] > CSP_RANK[csp]) {
      csp = entryCsp;
      cspFrom = rel;
    }

    entryPoints.push({
      file: rel,
      role: classifyEntryRole(rel),
      scripts: scripts.map((s) => s.src),
      styles,
      moduleType: scripts.some((s) => s.module)
        ? 'module'
        : scripts.length > 0
          ? 'classic'
          : 'unknown',
      csp: entryCsp,
      bytes: Buffer.byteLength(html),
    });
  }
  entryPoints.sort(compareEntries);

  const primaryEntry = entryPoints.find((e) => e.role === 'main')?.file ?? entryPoints[0]?.file;

  // --- package.json main --------------------------------------------------
  let packageMain: string | undefined;
  const manifest = readCapped(join(root, 'package.json'), 1024 * 1024);
  if (manifest) {
    try {
      const parsed = JSON.parse(manifest) as { main?: unknown };
      if (typeof parsed.main === 'string') packageMain = parsed.main.replace(/\\/g, '/');
    } catch {
      /* malformed package.json — the field is informational only */
    }
  }

  // --- Dependency graph ---------------------------------------------------
  const index = buildFileIndex(root, allFiles);
  const dependencies: DependencyEdge[] = [];

  // Entry-level edges: every HTML pulls its scripts/styles directly.
  for (const entry of entryPoints) {
    for (const src of entry.scripts) {
      dependencies.push({
        from: entry.file,
        to: src,
        resolved: resolveSpecifier(entry.file, src, index),
        kind: 'script',
      });
    }
    for (const href of entry.styles) {
      dependencies.push({
        from: entry.file,
        to: href,
        resolved: resolveSpecifier(entry.file, href, index),
        kind: 'style',
      });
    }
  }

  for (const file of jsFiles.slice(0, MAX_DEP_FILES)) {
    if (dependencies.length >= MAX_EDGES) break;
    const text = readCapped(file, DEP_READ_LIMIT);
    if (text === null) continue;
    const rel = toRel(root, file);
    for (const { to, kind } of parseDependencies(text)) {
      if (dependencies.length >= MAX_EDGES) break;
      dependencies.push({ from: rel, to, resolved: resolveSpecifier(rel, to, index), kind });
    }
  }

  // --- CDP surfaces -------------------------------------------------------
  const surfaces: CdpSurface[] = entryPoints.map((entry) => ({
    role: entry.role,
    entry: entry.file,
    requiresSeparateTarget: requiresSeparateTarget(entry.role),
  }));

  // --- Token namespaces ---------------------------------------------------
  const tokenNamespaces = new Set<string>();
  for (const file of cssFiles.slice(0, MAX_TOKEN_FILES)) {
    if (tokenNamespaces.size >= MAX_NAMESPACES) break;
    const css = readCapped(file, TOKEN_READ_LIMIT);
    if (!css) continue;
    for (const m of css.matchAll(RE_CSS_VAR)) {
      const dash = m[1].indexOf('-');
      tokenNamespaces.add(dash > 0 ? m[1].slice(0, dash) : m[1]);
      if (tokenNamespaces.size >= MAX_NAMESPACES) break;
    }
  }

  return {
    agentId,
    family,
    scanFamily,
    entryPoints,
    primaryEntry,
    packageMain,
    dependencies,
    csp,
    cspFrom,
    surfaces,
    inject: recommendInjectStrategy(csp, family),
    tokenNamespaces: [...tokenNamespaces].sort(),
    stats: { html: htmlFiles.length, js: jsFiles.length, css: cssFiles.length, bytes },
  };
}
