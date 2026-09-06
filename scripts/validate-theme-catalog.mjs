// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme-catalog
 *
 * 校验 themes/catalog.json 与实际 themes 目录的一致性。
 *
 * 检测三类问题：
 *   1. 孤立条目（orphan）：catalog 中有但目录中无
 *   2. 缺失条目（missing）：目录中有但 catalog 中无
 *   3. 元数据漂移（drift）：catalog 记录的字段与实际 manifest 不一致
 *
 * 用法：
 *   node scripts/validate-theme-catalog.mjs            # 校验 catalog
 *   node scripts/validate-theme-catalog.mjs --fix      # 自动修复（重新生成）
 *   node scripts/validate-theme-catalog.mjs --lenient  # 仅警告，不阻断
 *
 * 退出码：零表示一致，非零表示存在不一致。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');
const CATALOG_PATH = path.join(THEMES_DIR, 'catalog.json');
const LENIENT = process.argv.includes('--lenient');
const FIX_MODE = process.argv.includes('--fix');

// --- 常量 ---

const ADAPTER_IDS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * 扫描目录获取实际主题列表。
 * @returns {Promise<Map<string, object>>} 主题 id -> 元数据 映射
 */
async function scanActualThemes() {
  const themes = new Map();

  let dirEntries;
  try {
    dirEntries = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`无法读取 themes/ 目录: ${err.message}`);
    process.exit(1);
  }

  for (const entry of dirEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const name = entry.name;

    if (name === 'catalog.json' || name.startsWith('.')) {
      continue;
    }
    if (name.endsWith('.codedrobe-theme')) {
      continue;
    }

    const fullPath = path.join(THEMES_DIR, name);

    // 读取 manifest
    let manifest;
    try {
      const raw = await fs.readFile(path.join(fullPath, 'manifest.json'), 'utf-8');
      manifest = JSON.parse(raw);
    } catch {
      continue;
    }

    // 检测适配器
    const adapters = [];
    const cssDir = path.join(fullPath, 'assets', 'css');
    for (const adapter of ADAPTER_IDS) {
      try {
        await fs.access(path.join(cssDir, `${adapter}.css`));
        adapters.push(adapter);
      } catch {
        // 不存在
      }
    }

    // 检测图片
    let hasHero = false;
    let hasImages = false;
    let imageCount = 0;

    try {
      const rootFiles = await fs.readdir(fullPath);
      for (const file of rootFiles) {
        if (IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
          imageCount++;
          if (file.startsWith('hero')) hasHero = true;
        }
      }
    } catch {
      /* ignore */
    }

    try {
      const imgDir = path.join(fullPath, 'assets', 'images');
      const imgFiles = await fs.readdir(imgDir);
      for (const file of imgFiles) {
        if (IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) {
          imageCount++;
          if (file.startsWith('hero')) hasHero = true;
        }
      }
    } catch {
      /* ignore */
    }

    if (imageCount > 0) hasImages = true;

    // 适配等级
    let adaptationLevel;
    if (adapters.length >= 6) adaptationLevel = 'deep';
    else if (adapters.length >= 3) adaptationLevel = 'medium';
    else if (adapters.length >= 1) adaptationLevel = 'shallow';
    else adaptationLevel = 'none';

    const themeId = manifest.id || name;
    themes.set(themeId, {
      id: themeId,
      name: manifest.displayName || manifest.name || name,
      version: manifest.version || '0.0.0',
      adapters,
      adaptationLevel,
      hasHero,
      hasImages,
      wcagCompliant: typeof manifest.wcagCompliant === 'boolean' ? manifest.wcagCompliant : false,
      status:
        manifest.status ||
        (manifest.tags?.includes('deprecated')
          ? 'deprecated'
          : manifest.version?.startsWith('0.')
            ? 'experimental'
            : 'active'),
    });
  }

  return themes;
}

/**
 * 读取 catalog.json。
 * @returns {Promise<{ version: number, lastUpdated: string, themes: object[] } | null>}
 */
async function readCatalog() {
  try {
    const raw = await fs.readFile(CATALOG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * 比较 catalog 与实际目录，输出差异。
 * @returns {{ orphans: string[], missing: string[], drifted: object[] }}
 */
function findDifferences(catalogThemes, actualThemes) {
  const catalogIds = new Set(catalogThemes.map((t) => t.id));
  const actualIds = new Set(actualThemes.keys());

  // 孤立条目：catalog 中有但目录中无
  const orphans = [...catalogIds].filter((id) => !actualIds.has(id));

  // 缺失条目：目录中有但 catalog 中无
  const missing = [...actualIds].filter((id) => !catalogIds.has(id));

  // 元数据漂移：两边都有但字段不一致
  const drifted = [];
  for (const catalogEntry of catalogThemes) {
    const actual = actualThemes.get(catalogEntry.id);
    if (!actual) continue;

    const diffs = [];

    if (catalogEntry.name !== actual.name) {
      diffs.push({ field: 'name', catalog: catalogEntry.name, actual: actual.name });
    }
    if (catalogEntry.version !== actual.version) {
      diffs.push({ field: 'version', catalog: catalogEntry.version, actual: actual.version });
    }
    if (catalogEntry.adaptationLevel !== actual.adaptationLevel) {
      diffs.push({
        field: 'adaptationLevel',
        catalog: catalogEntry.adaptationLevel,
        actual: actual.adaptationLevel,
      });
    }
    if (catalogEntry.hasHero !== actual.hasHero) {
      diffs.push({ field: 'hasHero', catalog: catalogEntry.hasHero, actual: actual.hasHero });
    }
    if (catalogEntry.hasImages !== actual.hasImages) {
      diffs.push({ field: 'hasImages', catalog: catalogEntry.hasImages, actual: actual.hasImages });
    }
    if (catalogEntry.wcagCompliant !== actual.wcagCompliant) {
      diffs.push({
        field: 'wcagCompliant',
        catalog: catalogEntry.wcagCompliant,
        actual: actual.wcagCompliant,
      });
    }
    if (catalogEntry.status !== actual.status) {
      diffs.push({ field: 'status', catalog: catalogEntry.status, actual: actual.status });
    }

    // 比较 adapters 数组（排序后比较）
    const catalogAdapters = [...catalogEntry.adapters].sort();
    const actualAdapters = [...actual.adapters].sort();
    if (JSON.stringify(catalogAdapters) !== JSON.stringify(actualAdapters)) {
      diffs.push({ field: 'adapters', catalog: catalogAdapters, actual: actualAdapters });
    }

    if (diffs.length > 0) {
      drifted.push({ id: catalogEntry.id, diffs });
    }
  }

  return { orphans, missing, drifted };
}

// --- 主流程 ---

async function main() {
  console.log('🔍 校验 themes/catalog.json...\n');

  const catalog = await readCatalog();

  if (!catalog) {
    console.error('❌ catalog.json 不存在，请先运行 generate-theme-catalog.mjs');
    if (FIX_MODE) {
      console.log('--fix 模式：将调用 generate-theme-catalog.mjs 重新生成...');
      // 动态导入生成脚本的主逻辑
      await import('./generate-theme-catalog.mjs');
      return;
    }
    process.exit(1);
  }

  const actualThemes = await scanActualThemes();
  const catalogThemes = catalog.themes || [];

  const { orphans, missing, drifted } = findDifferences(catalogThemes, actualThemes);

  let hasIssues = false;

  // 报告孤立条目
  if (orphans.length > 0) {
    hasIssues = true;
    console.log(`⚠️  孤立条目 (${orphans.length}) — catalog 中有但目录中无:`);
    for (const id of orphans) {
      console.log(`  • ${id}`);
    }
    console.log();
  }

  // 报告缺失条目
  if (missing.length > 0) {
    hasIssues = true;
    console.log(`⚠️  缺失条目 (${missing.length}) — 目录中有但 catalog 中无:`);
    for (const id of missing) {
      console.log(`  • ${id}`);
    }
    console.log();
  }

  // 报告漂移
  if (drifted.length > 0) {
    hasIssues = true;
    console.log(`⚠️  元数据漂移 (${drifted.length}) — catalog 与实际 manifest 不一致:`);
    for (const { id, diffs } of drifted) {
      console.log(`  • ${id}:`);
      for (const diff of diffs) {
        console.log(
          `    - ${diff.field}: catalog="${JSON.stringify(diff.catalog)}" actual="${JSON.stringify(diff.actual)}"`,
        );
      }
    }
    console.log();
  }

  // 报告 catalog 基本信息
  console.log(`📊 Catalog 信息:`);
  console.log(`  版本: ${catalog.version}`);
  console.log(`  最后更新: ${catalog.lastUpdated}`);
  console.log(`  主题总数: ${catalogThemes.length}`);
  console.log(`  实际主题数: ${actualThemes.size}`);
  console.log();

  if (hasIssues) {
    console.log('❌ 校验失败：catalog 与实际目录不一致。');
    if (!LENIENT) {
      console.log('   提示: 运行 generate-theme-catalog.mjs 重新生成，或使用 --lenient 仅警告。');
      process.exit(1);
    } else {
      console.log('   (--lenient 模式，仅警告不阻断)');
    }
  } else {
    console.log('✅ 校验通过：catalog 与实际目录完全一致。');
  }
}

main().catch((err) => {
  console.error('❌ 校验失败:', err);
  process.exit(1);
});
