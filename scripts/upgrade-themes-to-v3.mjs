// SPDX-License-Identifier: MPL-2.0
/**
 * # upgrade-themes-to-v3.mjs — V3 一次性切换（RFC 2026-09-03）
 *
 * 把 themes/<id>/ 下的 V2 目录主题机械升级为 V3 包结构：
 *   1. assets/css/<app>.css  →  overrides/<app>.css（文件搬移，内容不动）
 *   2. 新建空基座 theme.css（占位；语义 CSS 由 overrides 承载）
 *   3. manifest.json 改写为 v3 形状：
 *        schemaVersion: 3, semanticVersion: 1, apps: string[], overrides: {app: path},
 *        themeCss: "theme.css"；删除 targets/supportedAgents（v2 专属）
 *
 * 渲染 1:1：CSS 内容一个字节不动，仅换存放位置与 manifest 形态。
 *
 * 用法：node scripts/upgrade-themes-to-v3.mjs [--dry-run] [--id <themeId>]
 * 前置门禁：scripts/audit-engine-coverage.mjs（人工确认 Gate 报告后再执行）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const THEMES_DIR = path.join(ROOT, 'themes');
const DRY = process.argv.includes('--dry-run');
const onlyId = (() => {
  const i = process.argv.indexOf('--id');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

/** v3 schema 允许的 manifest 顶层键（与 manifest-v3.schema.json 同步）。 */
const V3_ALLOWED_KEYS = new Set([
  '$schema', 'schemaVersion', 'semanticVersion', 'id', 'name', 'displayName', 'version',
  'description', 'themeCss', 'apps', 'overrides', 'mode', 'colors', 'hero', 'icon',
  'preview', 'art', 'author', 'category', 'tags', 'license', 'unofficial',
]);

/** 剪掉不在 v3 schema 白名单的 v2 时代残留字段。 */
function pruneToV3(manifest) {
  for (const key of Object.keys(manifest)) {
    if (!V3_ALLOWED_KEYS.has(key)) delete manifest[key];
  }
  return manifest;
}

function themeIds() {
  return fs
    .readdirSync(THEMES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => fs.existsSync(path.join(THEMES_DIR, n, 'manifest.json')))
    .filter((n) => !onlyId || n === onlyId);
}

const report = [];
for (const id of themeIds()) {
  const pkgDir = path.join(THEMES_DIR, id);
  const manifestPath = path.join(pkgDir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 已是 v3 → 仅归一化剪枝（幂等）
  if (manifest.schemaVersion === 3 || manifest.semanticVersion >= 1) {
    const pruned = pruneToV3({ ...manifest });
    const changed = JSON.stringify(pruned) !== JSON.stringify(manifest);
    if (changed && !DRY) {
      fs.writeFileSync(manifestPath, `${JSON.stringify(pruned, null, 2)}\n`, 'utf8');
      console.log(`${id}: pruned ${Object.keys(manifest).length - Object.keys(pruned).length} v2-era key(s) to v3 whitelist`);
    } else if (changed && DRY) {
      console.log(`${id}: [dry] would prune ${Object.keys(manifest).length - Object.keys(pruned).length} key(s)`);
    } else {
      console.log(`${id}: already clean v3`);
    }
    continue;
  }
  // v2 判定：schemaVersion 2 或有 targets/assets/css
  const cssDir = path.join(pkgDir, 'assets', 'css');
  const hasFrozen = fs.existsSync(cssDir);
  if (!hasFrozen && !manifest.targets) {
    console.log(`${id}: not a v2 directory theme (no assets/css, no targets) — skip`);
    continue;
  }

  const existing = hasFrozen ? fs.readdirSync(cssDir).filter((f) => f.endsWith('.css')) : [];
  // apps = 冻结 css 存在的 agent（css 文件名 = agentId.css）
  const apps = AGENTS.filter((a) => existing.includes(`${a}.css`));
  if (apps.length === 0) {
    console.log(`${id}: ✗ no per-agent css found — skip`);
    continue;
  }

  const overrides = {};
  for (const app of apps) overrides[app] = `overrides/${app}.css`;

  const nextManifest = pruneToV3({ ...manifest });
  // 删除 v2 专属 / 不在 v3 schema 的字段（pruneToV3 已处理）;再强制 v3 形态字段
  delete nextManifest.$schema;
  nextManifest.schemaVersion = 3;
  nextManifest.semanticVersion = 1;
  nextManifest.themeCss = 'theme.css';
  nextManifest.apps = apps;
  nextManifest.overrides = overrides;

  const reportLine = { id, apps, cssFiles: existing.length, actions: [] };

  if (!DRY) {
    // 1. 搬移 overrides/
    fs.mkdirSync(path.join(pkgDir, 'overrides'), { recursive: true });
    for (const app of apps) {
      const src = path.join(cssDir, `${app}.css`);
      const dst = path.join(pkgDir, 'overrides', `${app}.css`);
      fs.copyFileSync(src, dst);
      reportLine.actions.push(`moved assets/css/${app}.css → overrides/${app}.css`);
    }
    // 2. 删除 assets/css（空 assets 目录也清掉）
    if (fs.existsSync(cssDir)) {
      fs.rmSync(cssDir, { recursive: true, force: true });
      reportLine.actions.push('removed assets/css/');
    }
    if (fs.existsSync(path.join(pkgDir, 'assets')) && fs.readdirSync(path.join(pkgDir, 'assets')).length === 0) {
      fs.rmdirSync(path.join(pkgDir, 'assets'));
      reportLine.actions.push('removed empty assets/');
    }
    // 3. 基座 theme.css（仅占位；语义 CSS 全在 overrides）
    const basePath = path.join(pkgDir, 'theme.css');
    if (!fs.existsSync(basePath)) {
      fs.writeFileSync(
        basePath,
        `/* ${id} — v3 single-file base (upgraded 2026-09-03).\n   Per-app CSS lives in overrides/; add shared semantic rules here. */\n`,
        'utf8',
      );
      reportLine.actions.push('created theme.css placeholder');
    }
    // 4. 写回 manifest
    fs.writeFileSync(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    reportLine.actions.push(`manifest → schemaVersion 3, apps=${apps.length}, overrides=${apps.length}`);
  } else {
    reportLine.actions.push('(dry-run) manifest → v3', '(dry-run) move css → overrides/', '(dry-run) create theme.css');
  }

  report.push(reportLine);
  console.log(
    `${id}: ${DRY ? '[dry] ' : ''}✓ ${apps.join(',')} (${existing.length} css)` +
      (DRY ? '' : ` — ${reportLine.actions.join('; ')}`),
  );
}

// 汇总
const outDir = path.join(ROOT, 'docs', 'reports');
fs.mkdirSync(outDir, { recursive: true });
const date = new Date().toISOString().slice(0, 10);
const summaryPath = path.join(outDir, `${date}-v3-theme-upgrade${DRY ? '-dryrun' : ''}.md`);
fs.writeFileSync(
  summaryPath,
  [
    `# V3 主题升级${DRY ? '（dry-run 预览）' : ''}报告`,
    '',
    `- 日期: ${date}`,
    `- 主题数: ${report.length}`,
    '',
    '| 主题 | apps | css 文件数 | 动作 |',
    '|---|---|---|---|',
    ...report.map((r) => `| ${r.id} | ${r.apps.join(', ')} | ${r.cssFiles} | ${r.actions.join('<br>')} |`),
    '',
  ].join('\n'),
  'utf8',
);
console.log(`\nreport → ${path.relative(ROOT, summaryPath)}`);
