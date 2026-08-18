// SPDX-License-Identifier: MPL-2.0

/**
 * Extract ASAR Summary - 静态逆向理解（P0）
 *
 * 只读地解析任意 Electron Agent 的打包产物，产出结构化架构理解 JSON + 人读 Markdown，
 * 作为 architecture.md / fragility.md 的静态源。绝不写回原应用文件，解包只进临时工作目录。
 *
 * 用法：
 *   # 只打印将解包哪些 asar（不实际解包）
 *   node scripts/extract-asar-summary.mjs --app codex --dry-run
 *
 *   # 显式给路径：app 根目录 / 单个 app.asar / 已解包目录 三者皆可
 *   node scripts/extract-asar-summary.mjs --app-path "C:/.../Codex/resources" --out docs/apps/codex/raw
 *
 *   # 限定只抠 VS Code 族某些嵌套 webview asar
 *   node scripts/extract-asar-summary.mjs --app workbuddy --asar-include "webview|workbench" --family vscode
 *
 * 参数：
 *   --app <id>            按内置候选表定位（best-effort；找不到需补 --app-path）
 *   --app-path <path>     显式覆盖：app 根目录 / app.asar / 已解包目录
 *   --family <react|vscode> 覆盖族判定（默认按 app id 查表）
 *   --out <dir>           报告输出目录（默认 docs/apps/<id>/raw）
 *   --workdir <dir>       解包临时区（默认 <os.tmpdir>/agentskin-extract/<id>）
 *   --asar-include <regex> 只提取路径匹配该正则的嵌套 webview asar（root 恒提取）
 *   --max-asar-bytes <n>  单 asar 解包体积守卫（默认 400MB，超限跳过并记录 missing）
 *   --dry-run             只打印将解包哪些 asar + 体积，不解包
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import asar from '@electron/asar';

// ============== 常量配置 ==============
const AGENT_FAMILY = {
  codex: 'react',
  doubao: 'react',
  traework: 'react',
  workbuddy: 'vscode',
  qoderwork: 'vscode',
  zcode: 'vscode',
};

// 单 asar 解包体积守卫（字节），超限跳过并写入 quality.missing。
const DEFAULT_MAX_ASAR_BYTES = 400 * 1024 * 1024;
// 单文本文件读取上限，避免超大 sourcemap 拖垮扫描。
const MAX_TEXT_BYTES = 20 * 1024 * 1024;
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  'out',
  'dist',
  'make',
  'win-unpacked',
  'mac',
  'locales',
]);

// ============== CLI 解析 ==============
function parseArgs(argv) {
  const args = {
    asarInclude: null,
    family: null,
    app: null,
    appPath: null,
    out: null,
    workdir: null,
    dryRun: false,
    maxAsarBytes: DEFAULT_MAX_ASAR_BYTES,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case '--app':
        args.app = next();
        break;
      case '--app-path':
        args.appPath = resolve(next());
        break;
      case '--family':
        args.family = next();
        break;
      case '--out':
        args.out = resolve(next());
        break;
      case '--workdir':
        args.workdir = resolve(next());
        break;
      case '--asar-include':
        args.asarInclude = next();
        break;
      case '--max-asar-bytes':
        args.maxAsarBytes = Number(next());
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}`);
    }
  }
  if (args.app === null && args.appPath === null) {
    throw new Error('必须提供 --app <id> 或 --app-path <path>');
  }
  if (args.family === null && args.app !== null && AGENT_FAMILY[args.app]) {
    args.family = AGENT_FAMILY[args.app];
  }
  if (args.family !== null && !['react', 'vscode'].includes(args.family)) {
    throw new Error(`--family 仅支持 react|vscode，收到: ${args.family}`);
  }
  return args;
}

function resolveAppId(args) {
  if (args.app !== null) return args.app;
  if (args.appPath !== null) {
    return basename(args.appPath).replace(/\.asar$/, '') || 'app';
  }
  return 'app';
}

// ============== 发现：定位 asar 集合 ==============
function walkAsars(root) {
  const found = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIR_NAMES.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.asar')) {
        found.push(full);
      }
    }
  }
  return found;
}

function assignRoles(asars) {
  return asars.map((p) => {
    const norm = p.replace(/\\/g, '/');
    const isRoot = /(?:^|\/)resources\/app\.asar$/.test(norm) || asars.length === 1;
    return { path: p, role: isRoot ? 'root' : 'webview' };
  });
}

function lookUpAppPath(app) {
  // best-effort 候选表；找不到返回 null（提示补 --app-path）。
  const home = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] ?? '';
  const candidates = [];
  const devtoolsBase = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  if (app === 'codex') {
    candidates.push(join(devtoolsBase, 'Codex'), join(home, '.codex'));
  } else if (app === 'workbuddy') {
    candidates.push(
      join(
        process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'),
        'Programs',
        app.toLowerCase(),
      ),
    );
  } else if (app === 'traework') {
    candidates.push(join(process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'traework'));
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'resources'))) return candidate;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// ============== 解包 ==============
function extractAsar(asarPath, destDir, dryRun) {
  if (dryRun) return [];
  if (existsSync(destDir)) {
    // 已存在则认为可复用；调用侧会校验产物存在性。
    return [];
  }
  mkdirSync(destDir, { recursive: true });
  try {
    asar.extractAll(asarPath, destDir);
  } catch (_err) {
    // 跨平台 Electron 打包会把与当前 OS 无关的二进制（如 arm64-linux / arm64-darwin 的
    // ripgrep）登记为 unpacked，但 Windows 安装包只带 win32/x64 的物理文件。
    // extractAll 走到这些缺失项即抛 ENOENT 中断。回退为逐文件容错解包，
    // 缺失的 unpacked 项跳过并返回，由调用侧记入 quality.missing。
    const skipped = [];
    for (const entry of asar.listPackage(asarPath)) {
      const target = join(destDir, entry);
      if (existsSync(target)) continue;
      let buf;
      try {
        buf = asar.extractFile(asarPath, entry);
      } catch {
        skipped.push(entry);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, buf);
    }
    return skipped;
  }
  return [];
}

// ============== 文本扫描工具 ==============
// skipDirNames 可被调用方注入：VS Code 架构的标准布局把前端运行时代码放在 out/ 下，
// 对 vscode 族需移除 'out' 跳过，否则根 asar 扫描全空（workbuddy 代码在顶层目录，
// 而 zcode/qoderwork/traework 的标准布局在 out/）。
function readableFiles(dir, skipDirNames = SKIP_DIR_NAMES) {
  const files = [];
  const stack = [dir];
  while (stack.length > 0) {
    const d = stack.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
      if (entry.isDirectory()) {
        if (!skipDirNames.has(entry.name)) stack.push(full);
      } else if (entry.isFile() && ['.js', '.cjs', '.mjs', '.html', '.css'].includes(ext)) {
        files.push(full);
      }
    }
  }
  return files;
}

function readTextSafe(file) {
  try {
    const stat = statSync(file);
    if (stat.size > MAX_TEXT_BYTES) return null;
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function countMatches(accum, matches) {
  for (const m of matches) {
    const key = m;
    accum.set(key, (accum.get(key) ?? 0) + 1);
  }
}

// ============== 扫描模块 ==============
function collectTopology(extractDir, skipDirNames) {
  const topology = { entries: [], chunks: [], preloadScripts: [], processArches: [] };
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    const text = readTextSafe(file);
    if (text === null) continue;
    const rel = relative(extractDir, file).replace(/\\/g, '/');
    if (/\.html$/.test(file)) {
      const scripts = [...text.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/gi)].map((m) => m[1]);
      if (scripts.length) topology.entries.push({ file: rel, scripts });
    }
    if (
      /(^|\/)(preload|sandbox|comment-updater|.*preload).*\.(cjs|js|mjs)$/i.test(rel) ||
      /preload/i.test(rel)
    ) {
      topology.preloadScripts.push(rel);
    }
  }
  topology.chunks = files
    .filter((f) => /\.(js|mjs|cjs)$/.test(f))
    .map((f) => relative(extractDir, f).replace(/\\/g, '/'));
  return topology;
}

function collectStrings(extractDir, skipDirNames) {
  const dataAttrs = new Map();
  const dataTestids = new Map();
  const ipcTypes = new Map();
  const i18nKeys = new Map();
  const ids = new Map();
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    const text = readTextSafe(file);
    if (text === null) continue;
    // data-* 字面量（引号包裹）与括号选择器（[data-*]）都可能是稳定锚点。
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
    countMatches(
      ipcTypes,
      [...text.matchAll(/["']([a-zA-Z][\w]*:[a-zA-Z][\w:.-]*)["']/g)].map((m) => m[1]),
    );
    countMatches(
      i18nKeys,
      [...text.matchAll(/(?:t|translate|i18n)\s*\(\s*["']([^"']+)["']/g)].map((m) => m[1]),
    );
    if (/\.html$/.test(file)) {
      countMatches(
        ids,
        [...text.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]),
      );
    }
  }
  const toCounted = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
  return {
    dataAttrs: toCounted(dataAttrs),
    dataTestids: toCounted(dataTestids),
    ipcTypes: toCounted(ipcTypes),
    i18nKeys: toCounted(i18nKeys),
    ids: toCounted(ids),
  };
}

function collectSurfaces(extractDir, skipDirNames) {
  const preloadExposed = new Map();
  const ipc = { handle: new Map(), invoke: new Map(), send: new Map(), on: new Map() };
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    if (!/\.(js|cjs|mjs)$/.test(file)) continue;
    const text = readTextSafe(file);
    if (text === null) continue;
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
  const toCounted = (map) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count);
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

function collectSecurity(extractDir, skipDirNames) {
  const security = {
    contextIsolation: null,
    webSecurity: null,
    sandbox: null,
    csp: { from: 'none', directives: {} },
  };
  const htmlFiles = [];
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    const text = readTextSafe(file);
    if (text === null) continue;
    const rel = relative(extractDir, file).replace(/\\/g, '/');
    // CSP 优先取 index.html 的 meta（未压缩、可读）。
    if (/\.html$/.test(file)) htmlFiles.push({ rel, text });
    if (/\.(js|cjs|mjs)$/.test(file)) {
      const pick = (re) => {
        const m = re.exec(text);
        if (!m) return null;
        const raw = m[1];
        if (/!0|true|1/.test(raw)) return true;
        if (/!1|false|0/.test(raw)) return false;
        return raw;
      };
      if (security.contextIsolation === null)
        security.contextIsolation = pick(/contextIsolation\s*:\s*(\[?[^,\]}]+)/);
      if (security.webSecurity === null)
        security.webSecurity = pick(/webSecurity\s*:\s*(\[?[^,\]}]+)/);
      if (security.sandbox === null) security.sandbox = pick(/sandbox\s*:\s*(\[?[^,\]}]+)/);
    }
  }
  for (const { rel, text } of htmlFiles) {
    // 属性值用反引号捕获，允许 CSP 值内层含单/双引号（如 'unsafe-inline'）。
    const m =
      /<meta\b[^>]*\bhttp-equiv=["']content-security-policy["'][^>]*\bcontent=([""'])([\s\S]*?)\1/i.exec(
        text,
      );
    if (m) {
      security.csp = {
        from: `meta:${rel}`,
        directives: parseCspDirectives(decodeHtmlEntities(m[2])),
      };
      break;
    }
  }
  return security;
}

function parseCspDirectives(content) {
  const directives = {};
  for (const part of content.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const [srcName, ...rest] = seg.split(/\s+/);
    if (srcName) directives[srcName] = rest;
  }
  return directives;
}

// HTML 属性值里单/双引号常被编码为实体（&#39; &quot; &amp;），解码后才能还原真实的
// CSP 指令值（如 &#39;none&#39; → 'none'）。真实 Codex 的 meta CSP 即用 &#39; 转义。
function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const named = {
      amp: '&',
      lt: '<',
      gt: '>',
      quot: '"',
      apos: "'",
    };
    if (entity[0] === '#') {
      const hex = entity[1] === 'x' || entity[1] === 'X';
      const code = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isNaN(code) ? match : String.fromCodePoint(code);
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function collectTokens(extractDir, _family, skipDirNames) {
  const buckets = new Map();
  let cssBytes = 0;
  let sheets = 0;
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    if (!/\.css$/.test(file)) continue;
    const text = readTextSafe(file);
    if (text === null) continue;
    sheets++;
    cssBytes += Buffer.byteLength(text);
    for (const m of text.matchAll(/--([a-zA-Z][a-zA-Z0-9-]*)\s*:/gm)) {
      const key = m[1];
      const prefix = namespaceOf(key);
      if (!buckets.has(prefix)) buckets.set(prefix, new Map());
      buckets.get(prefix).set(key, (buckets.get(prefix).get(key) ?? 0) + 1);
    }
  }
  const namespaces = {};
  for (const [prefix, vars] of buckets) {
    namespaces[prefix] = {
      varCount: vars.size,
      vars: [...vars.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count),
    };
  }
  return {
    namespaces,
    varCount: buckets.size > 0 ? [...buckets.values()].reduce((s, v) => s + v.size, 0) : 0,
    cssBytes,
    sheets,
  };
}

function namespaceOf(varName) {
  // 按 `--` 后的第一个连字符段归桶：--text-foreground→text，--bg-background→bg，
  // --cb-accent→cb，--vscode-editor-bg→vscode。React 家（--text-/--bg-）与 VS Code 家（--cb-/--vscode-）皆适用。
  const m = /^([a-z][a-z0-9]*)-/.exec(varName);
  return m ? m[1] : varName;
}

function collectSourcemaps(extractDir, skipDirNames) {
  const seen = new Map();
  const files = readableFiles(extractDir, skipDirNames);
  for (const file of files) {
    if (!/\.(js|cjs|mjs)$/.test(file)) continue;
    const text = readTextSafe(file);
    if (text === null) continue;
    const rel = relative(extractDir, file).replace(/\\/g, '/');
    for (const m of text.matchAll(/\/\/#\s*sourceMappingURL=([^\s"']+)/g)) {
      countMatches(seen, [`${m[1]} @ ${rel}`]);
    }
  }
  return [...seen.entries()].map(([value, count]) => ({ value, count }));
}

function buildFragilitySeeds(strings) {
  const seeds = [];
  const push = (anchor, kind, stability) => seeds.push({ anchor, kind, stability });
  for (const { value } of strings.dataTestids) push(value, 'data-testid', 'high');
  for (const { value } of strings.ids) push(value, 'id', 'high');
  for (const { value } of strings.dataAttrs) {
    if (/-(portal|app-|agentskin)/.test(value)) push(value, 'data-attr', 'high');
    else push(value, 'data-attr', 'medium');
  }
  for (const { value } of strings.ipcTypes) push(value, 'ipc-type', 'medium');
  for (const { value } of strings.i18nKeys) push(value, 'i18n-key', 'medium');
  return seeds;
}

// ============== 汇聚 ==============
function runPipeline(args) {
  const appId = resolveAppId(args);

  // 1. 定位 appPath
  let appPath = args.appPath;
  if (appPath === null && args.app !== null) {
    appPath = lookUpAppPath(args.app);
    if (appPath === null) {
      throw new Error(`无法为 --app ${args.app} 定位安装目录，请补 --app-path <path>`);
    }
  }

  const quality = { extractDepth: 'claims-not-verified', missing: [] };

  // 2. 是否已是解包目录（根含 package.json 且无 asar）→ 跳过解包。
  const outDir = args.out ?? join('docs', 'apps', appId, 'raw');
  const workDir = args.workdir ?? join(tmpdir(), 'agentskin-extract', appId);

  if (isExtractedDir(appPath)) {
    quality.extractDepth = 'none';
    quality.extractedDirs = [{ from: appPath, to: appPath }];
    // 已解包目录同样需要全量扫描（此前直接 return 导致产出为空，如 traework）。
    const skipDirs =
      args.family === 'vscode'
        ? new Set([...SKIP_DIR_NAMES].filter((n) => n !== 'out'))
        : SKIP_DIR_NAMES;
    const topology = collectTopology(appPath, skipDirs);
    const strings = collectStrings(appPath, skipDirs);
    const surfaces = collectSurfaces(appPath, skipDirs);
    const security = collectSecurity(appPath, skipDirs);
    const tokens = collectTokens(appPath, args.family, skipDirs);
    const sourcemaps = collectSourcemaps(appPath, skipDirs);
    const fragilitySeeds = buildFragilitySeeds(strings);
    return finalize({
      appPath,
      appId,
      args,
      asars: [],
      extractedDirs: [{ from: appPath, to: appPath }],
      workDir,
      outDir,
      quality,
      rootDir: appPath,
      topology,
      strings,
      surfaces,
      security,
      tokens,
      sourcemaps,
      fragilitySeeds,
    });
  }

  // 3. 发现 asar（appPath 为目录→递归；为单 asar 文件→直接收编）。
  const asarPaths = appPath.endsWith('.asar') ? [appPath] : walkAsars(appPath);
  if (asarPaths.length === 0) {
    throw new Error(`目录下未找到 *.asar: ${appPath}`);
  }
  const asars = assignRoles(asarPaths).filter((a) => {
    if (args.asarInclude && a.role !== 'root') {
      return new RegExp(args.asarInclude, 'i').test(a.path);
    }
    return true;
  });
  const asarSet = asars.map((a) => {
    let size = -1;
    try {
      size = statSync(a.path).size;
    } catch {
      /* 忽略 */
    }
    return { path: a.path, size, role: a.role };
  });

  if (args.dryRun) {
    // dry-run：只打印计划，不解包，不产出报告。
    return { dryRun: true, appId, asarSet, workDir, outDir };
  }

  // 4. 解包 + 扫描
  const extractedDirs = [];
  const scanResults = [];
  for (const a of asars) {
    const destName = a.role === 'root' ? 'root' : `webview-${basename(a.path, '.asar')}`;
    const dest = join(workDir, destName);
    if (existsSync(dest)) {
      extractedDirs.push({ from: a.path, to: dest });
    } else if (a.size >= 0 && a.size > args.maxAsarBytes) {
      quality.missing.push({ path: a.path, reason: `exceeds --max-asar-bytes (${a.size}B)` });
      continue;
    } else {
      const skipped = extractAsar(a.path, dest, args.dryRun);
      for (const f of skipped)
        quality.missing.push({ path: f, reason: 'unpacked-binary-missing (non-host OS)' });
      extractedDirs.push({ from: a.path, to: dest });
    }
    scanResults.push({ role: a.role, dir: dest });
  }
  if (extractedDirs.length === 0) {
    throw new Error('没有可扫描的解包目录');
  }

  // 5. 全量扫描（合并所有已解包目录）。
  // VS Code 架构的标准布局把前端运行时代码放在 out/ 下（区别于构建产物语义），
  // 因此对该族保留 out/ 扫描，否则根 asar 扫不到任何 token/锚点。
  const skipDirs =
    args.family === 'vscode'
      ? new Set([...SKIP_DIR_NAMES].filter((n) => n !== 'out'))
      : SKIP_DIR_NAMES;
  const rootDir = scanResults.find((s) => s.role === 'root')?.dir ?? scanResults[0].dir;
  const topology = collectTopology(rootDir, skipDirs);
  const strings = collectStrings(rootDir, skipDirs);
  const surfaces = collectSurfaces(rootDir, skipDirs);
  const security = collectSecurity(rootDir, skipDirs);
  const tokens = collectTokens(rootDir, args.family, skipDirs);
  const sourcemaps = collectSourcemaps(rootDir, skipDirs);
  const fragilitySeeds = buildFragilitySeeds(strings);

  const report = finalize({
    appPath,
    appId,
    args,
    asars: asarSet,
    extractedDirs,
    scanResults,
    rootDir,
    workDir,
    outDir,
    quality,
    topology,
    strings,
    surfaces,
    security,
    tokens,
    sourcemaps,
    fragilitySeeds,
  });
  return report;
}

function isExtractedDir(dir) {
  if (!existsSync(join(dir, 'package.json'))) return false;
  // 忽略超小的 asar stub：VS Code 新版 linear 布局在已解包目录中仍留一个 ~28B 的
  // node_modules.asar 占位（traework），它并非可解包的有效 asar。
  const asars = walkAsars(dir);
  return asars.every((p) => statSync(p).size < 1 * 1024 * 1024);
}

function finalize(ctx) {
  const report = {
    meta: {
      app: ctx.appId,
      family: ctx.args.family ?? null,
      appPath: ctx.appPath,
      sources: ctx.appPath.endsWith('.asar') ? [ctx.appPath] : undefined,
    },
    topology: ctx.topology ?? {},
    strings: ctx.strings ?? {},
    surfaces: ctx.surfaces ?? {},
    security: ctx.security ?? {},
    tokens: ctx.tokens ?? {},
    sourcemaps: ctx.sourcemaps ?? [],
    fragilitySeeds: ctx.fragilitySeeds ?? [],
    extraction: {
      asarSet: ctx.asars ?? [],
      extractedDirs: ctx.extractedDirs ?? [],
    },
    quality: ctx.quality ?? { extractDepth: 'unknown', missing: [] },
  };
  if (ctx.rootDir) {
    report.meta.extractedRoot = ctx.rootDir;
    report.meta.extractedAt = new Date().toISOString();
  }
  report.meta.appVersion = readPackageVersion(ctx.rootDir);
  return { report, outDir: ctx.outDir, workDir: ctx.workDir };
}

function readPackageVersion(extractDir) {
  if (!extractDir) return null;
  try {
    const pkgPath = join(extractDir, 'package.json');
    if (!existsSync(pkgPath)) return null;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function writeReport(result) {
  const { report, outDir, workDir } = result;
  mkdirSync(outDir, { recursive: true });
  const jsonPath = join(outDir, 'extract-summary.json');
  const mdPath = join(outDir, 'extract-summary.md');
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report, outDir));
  return { jsonPath, mdPath, workDir };
}

function renderMarkdown(report, outDir) {
  const m = report.meta;
  const lines = [];
  lines.push(`# Extract Summary — ${m.app}`);
  lines.push('');
  lines.push(`- **family**: ${m.family ?? '?（未判定）'}`);
  lines.push(`- **appVersion**: ${m.appVersion ?? '?（未捕获）'}`);
  lines.push(`- **source**: \`${m.appPath}\``);
  if (m.extractedAt) lines.push(`- **extractedAt**: ${m.extractedAt}`);
  lines.push('');
  lines.push('## Extraction');
  lines.push('');
  lines.push('| role | path | size(B) |');
  lines.push('|------|------|---------|');
  for (const a of report.extraction.asarSet ?? []) {
    lines.push(`| ${a.role} | \`${a.path}\` | ${a.size} |`);
  }
  if ((report.quality.missing ?? []).length > 0) {
    lines.push('');
    lines.push('### missing');
    for (const miss of report.quality.missing) lines.push(`- \`${miss.path}\` — ${miss.reason}`);
  }
  lines.push('');
  lines.push('## Topology');
  lines.push('');
  lines.push(`- preloadScripts(${(report.topology.preloadScripts ?? []).length}):`);
  for (const p of report.topology.preloadScripts ?? []) lines.push(`  - \`${p}\``);
  lines.push('');
  lines.push('## Strings (top by count)');
  lines.push('');
  for (const group of ['dataAttrs', 'dataTestids', 'ipcTypes', 'i18nKeys', 'ids']) {
    const items = report.strings?.[group] ?? [];
    if (items.length === 0) continue;
    lines.push(`### ${group}`);
    for (const { value, count } of items.slice(0, 20)) {
      lines.push(`- \`${value}\` (${count})`);
    }
    lines.push('');
  }
  lines.push('## Security');
  lines.push('');
  lines.push(`- contextIsolation: \`${JSON.stringify(report.security.contextIsolation)}\``);
  lines.push(`- webSecurity: \`${JSON.stringify(report.security.webSecurity)}\``);
  lines.push(`- sandbox: \`${JSON.stringify(report.security.sandbox)}\``);
  lines.push(`- CSP: from=${report.security.csp.from}`);
  for (const [k, v] of Object.entries(report.security.csp.directives)) {
    lines.push(`  - \`${k}: ${v.join(' ')}\``);
  }
  lines.push('');
  lines.push('## Token namespaces');
  lines.push('');
  for (const [prefix, ns] of Object.entries(report.tokens.namespaces ?? {})) {
    lines.push(`- \`--${prefix}-*\`: ${ns.varCount} vars`);
  }
  lines.push('');
  lines.push('## Fragility seeds');
  lines.push('');
  for (const s of report.fragilitySeeds ?? []) {
    lines.push(`- [${s.stability}] \`${s.anchor}\` (${s.kind})`);
  }
  lines.push('');
  lines.push(`> 报告目录: \`${relative(process.cwd(), outDir)}\``);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = runPipeline(args);
  if (result.dryRun) {
    console.log(
      `[asar-summary] dry-run — ${result.appId} 将解包 ${result.asarSet.length} 个 asar：`,
    );
    for (const a of result.asarSet) {
      console.log(`  [${a.role}] ${a.path} (${a.size}B)`);
    }
    console.log(`  workdir: ${result.workDir}`);
    return;
  }
  const { jsonPath, mdPath, workDir } = writeReport(result);
  console.log(`[asar-summary] extract-summary written`);
  console.log(`  json: ${jsonPath}`);
  console.log(`  md:   ${mdPath}`);
  console.log(`  workdir: ${workDir}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}

export { isExtractedDir, parseArgs, resolveAppId, runPipeline };
