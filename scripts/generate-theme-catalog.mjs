// SPDX-License-Identifier: MPL-2.0

/**
 * # generate-theme-catalog
 *
 * 扫描 themes/ 目录下的所有主题，读取 manifest.json，检测适配的 Agent CSS
 * 文件与图片资源，输出 themes/catalog.json 作为主题目录的唯一事实源。
 *
 * 用法：
 *   node scripts/generate-theme-catalog.mjs            # 生成 catalog.json
 *   node scripts/generate-theme-catalog.mjs --dry-run  # 仅打印，不写入
 *
 * 退出码：零表示成功，非零表示失败。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');
const CATALOG_PATH = path.join(THEMES_DIR, 'catalog.json');
const DRY_RUN = process.argv.includes('--dry-run');

// --- 常量 ---

const ADAPTER_IDS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

/**
 * 检测主题的适配等级。
 * - deep: 6 个适配器 CSS 全部存在
 * - medium: 3-5 个适配器 CSS 存在
 * - shallow: 1-2 个适配器 CSS 存在
 * - none: 无适配器 CSS
 * @param {string} themeDir 主题目录路径
 * @returns {'deep' | 'medium' | 'shallow' | 'none'}
 */
async function detectAdaptationLevel(themeDir) {
  let cssCount = 0;
  const cssDir = path.join(themeDir, 'assets', 'css');

  try {
    const files = await fs.readdir(cssDir);
    for (const file of files) {
      if (file.endsWith('.css')) {
        cssCount++;
      }
    }
  } catch {
    // assets/css 目录不存在
  }

  if (cssCount >= 6) return 'deep';
  if (cssCount >= 3) return 'medium';
  if (cssCount >= 1) return 'shallow';
  return 'none';
}

/**
 * 检测主题适配的 Agent 列表。
 * 基于 assets/css/ 目录下实际存在的 CSS 文件。
 * @param {string} themeDir 主题目录路径
 * @returns {string[]}
 */
async function detectAdapters(themeDir) {
  const adapters = [];
  const cssDir = path.join(themeDir, 'assets', 'css');

  for (const adapter of ADAPTER_IDS) {
    const cssFile = path.join(cssDir, `${adapter}.css`);
    try {
      await fs.access(cssFile);
      adapters.push(adapter);
    } catch {
      // 文件不存在，跳过
    }
  }

  return adapters;
}

/**
 * 检测主题的图片资源。
 * @param {string} themeDir 主题目录路径
 * @returns {{ hasHero: boolean, hasImages: boolean, imageCount: number }}
 */
async function detectImages(themeDir) {
  let hasHero = false;
  let imageCount = 0;

  // 检查根目录图片
  try {
    const rootFiles = await fs.readdir(themeDir);
    for (const file of rootFiles) {
      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageCount++;
        if (file.startsWith('hero')) {
          hasHero = true;
        }
      }
    }
  } catch {
    // 忽略
  }

  // 检查 assets/images/ 目录
  const imagesDir = path.join(themeDir, 'assets', 'images');
  try {
    const imageFiles = await fs.readdir(imagesDir);
    for (const file of imageFiles) {
      const ext = path.extname(file).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageCount++;
        if (file.startsWith('hero')) {
          hasHero = true;
        }
      }
    }
  } catch {
    // assets/images 目录不存在
  }

  return { hasHero, hasImages: imageCount > 0, imageCount };
}

/**
 * 判断主题是否 WCAG 合规。
 * 当前基于 manifest 中是否存在 wcagCompliant 标记或 category 推断。
 * 未来可集成 wcag-apca-check.mjs 做实际对比度验证。
 * @param {object} manifest 主题 manifest 对象
 * @returns {boolean}
 */
function detectWcagCompliance(manifest) {
  // 如果 manifest 显式声明，优先使用
  if (typeof manifest.wcagCompliant === 'boolean') {
    return manifest.wcagCompliant;
  }
  // 默认标记为待验证
  return false;
}

/**
 * 判断主题状态。
 * @param {object} manifest 主题 manifest 对象
 * @returns {'active' | 'deprecated' | 'experimental'}
 */
function detectStatus(manifest) {
  if (manifest.status) {
    return manifest.status;
  }
  if (manifest.tags && manifest.tags.includes('deprecated')) {
    return 'deprecated';
  }
  if (manifest.version && manifest.version.startsWith('0.')) {
    return 'experimental';
  }
  return 'active';
}

/**
 * 扫描单个主题目录，提取元数据。 * @param {string} themeDir 主题目录路径
 * @param {string} themeName 主题目录名
 * @returns {object | null} 主题条目，失败返回 null
 */
async function scanTheme(themeDir, themeName) {
  const manifestPath = path.join(themeDir, 'manifest.json');

  let manifest;
  try {
    const raw = await fs.readFile(manifestPath, 'utf-8');
    manifest = JSON.parse(raw);
  } catch {
    console.warn(`  [skip] ${themeName}: manifest.json 不存在或解析失败`);
    return null;
  }

  const adaptationLevel = await detectAdaptationLevel(themeDir);
  const adapters = await detectAdapters(themeDir);
  const { hasHero, hasImages, imageCount } = await detectImages(themeDir);
  const wcagCompliant = detectWcagCompliance(manifest);
  const status = detectStatus(manifest);

  return {
    id: manifest.id || themeName,
    name: manifest.displayName || manifest.name || themeName,
    version: manifest.version || '0.0.0',
    adapters,
    adaptationLevel,
    hasHero,
    hasImages,
    wcagCompliant,
    status,
    _imageCount: imageCount,
    _mode: manifest.mode || 'dark',
    _category: manifest.category || 'unknown',
  };
}

/**
 * 扫描 themes/ 目录，收集所有主题。
 * @returns {object[]} 主题条目数组
 */
async function scanAllThemes() {
  const entries = [];
  let dirEntries;

  try {
    dirEntries = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (err) {
    console.error(`无法读取 themes/ 目录: ${err.message}`);
    process.exit(1);
  }

  // 收集所有有效的主题目录
  const themeDirs = [];
  for (const entry of dirEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) {
      continue;
    }
    const name = entry.name;

    // 跳过非主题目录
    if (name === 'catalog.json' || name.startsWith('.')) {
      continue;
    }

    // 跳过 .codedrobe-theme 文件（它们是文件不是目录）
    if (name.endsWith('.codedrobe-theme')) {
      continue;
    }

    const fullPath = path.join(THEMES_DIR, name);

    // 检查是否是有效的主题目录（有 manifest.json）
    try {
      await fs.access(path.join(fullPath, 'manifest.json'));
      themeDirs.push({ name, path: fullPath });
    } catch {
      // 不是有效主题目录，跳过
    }
  }

  // 按目录名排序以保证输出稳定
  themeDirs.sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, path: themePath } of themeDirs) {
    const entry = await scanTheme(themePath, name);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * 生成 catalog.json 内容。
 * @param {object[]} themes 主题条目数组
 * @returns {object} catalog 对象
 */
function buildCatalog(themes) {
  // 清理内部字段
  const cleanedThemes = themes.map(({ _imageCount, _mode, _category, ...rest }) => rest);

  return {
    version: 1,
    lastUpdated: new Date().toISOString(),
    themes: cleanedThemes,
  };
}

// --- 主流程 ---

async function main() {
  console.log('🔍 扫描 themes/ 目录...\n');

  const themes = await scanAllThemes();

  if (themes.length === 0) {
    console.error('❌ 未找到任何有效主题');
    process.exit(1);
  }

  const catalog = buildCatalog(themes);

  console.log(`✅ 发现 ${themes.length} 个主题:\n`);

  for (const theme of themes) {
    const adapterCount = theme.adapters.length;
    const images = theme._imageCount > 0 ? `${theme._imageCount} 张` : '无';
    console.log(
      `  • ${theme.id}  v${theme.version}  [${theme.adaptationLevel}]  ${adapterCount}/6 适配器  图片:${images}  WCAG:${theme.wcagCompliant ? '是' : '否'}  状态:${theme.status}`,
    );
  }

  if (DRY_RUN) {
    console.log('\n📝 Dry-run 模式，不写入文件。');
    console.log(JSON.stringify(catalog, null, 2));
  } else {
    await fs.writeFile(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf-8');
    console.log(`\n📄 已写入 ${path.relative(process.cwd(), CATALOG_PATH)}`);
  }
}

main().catch((err) => {
  console.error('❌ 生成失败:', err);
  process.exit(1);
});
