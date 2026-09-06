// SPDX-License-Identifier: MPL-2.0

/**
 * # validate-theme-metadata
 *
 * P2 署名链合规校验脚本。构建期/CI 门禁，校验 themes/ 下所有 manifest.json
 * 的元数据是否符合署名链合规模型（对齐 dsh-deep-whale skin.json）。
 *
 * 校验字段：
 *   - author.name: 必填，非空
 *   - license: 必填，建议使用知名 SPDX 标识
 *   - version: 必填，合法 semver
 *   - colors.accent: 必填，合法 CSS 颜色
 *   - wiring.id: 必填，小写字母数字 + 连字符/下划线
 *
 * 用法：
 *   node scripts/validate-theme-metadata.mjs           # 严格模式校验
 *   node scripts/validate-theme-metadata.mjs --lenient # 宽松模式（仅警告）
 *
 * 退出码：非零表示有阻断性错误。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const THEMES_DIR = path.resolve(process.cwd(), 'themes');
const LENIENT = process.argv.includes('--lenient');

// --- 常量 ---

const KNOWN_LICENSES = new Set([
  'MPL-2.0',
  'MIT',
  'Apache-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'LGPL-2.1',
  'LGPL-3.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-NC-4.0',
  'CC-BY-NC-SA-4.0',
  'CC-BY-ND-4.0',
  'CC-BY-NC-ND-4.0',
  'CC0-1.0',
  'Unlicense',
  'Proprietary',
]);

const WIRING_ID_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const COLOR_REGEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * 校验单个 manifest 的元数据。
 * @returns {{ errors: string[], warnings: string[] }}
 */
function validateMetadata(manifest, themeName) {
  const errors = [];
  const warnings = [];
  const addIssue = (msg) => (LENIENT ? warnings.push(msg) : errors.push(msg));

  // author
  if (!manifest.author) {
    addIssue(`${themeName}: missing required author field (署名链必填)`);
  } else if (
    !manifest.author.name ||
    typeof manifest.author.name !== 'string' ||
    manifest.author.name.trim().length === 0
  ) {
    addIssue(`${themeName}: author.name is required and must be a non-empty string`);
  } else if (manifest.author.url !== undefined) {
    if (typeof manifest.author.url !== 'string') {
      addIssue(`${themeName}: author.url must be a string`);
    } else if (!isValidUrl(manifest.author.url)) {
      addIssue(`${themeName}: author.url is not a valid URL: "${manifest.author.url}"`);
    }
  }

  // license
  if (!manifest.license) {
    addIssue(`${themeName}: missing required license field (署名链必填)`);
  } else if (typeof manifest.license !== 'string') {
    addIssue(`${themeName}: license must be a string`);
  } else if (!KNOWN_LICENSES.has(manifest.license)) {
    warnings.push(`${themeName}: license "${manifest.license}" is not a known SPDX identifier`);
  }

  // version
  if (!manifest.version) {
    addIssue(`${themeName}: missing required version field`);
  } else if (!SEMVER_REGEX.test(manifest.version)) {
    addIssue(`${themeName}: version "${manifest.version}" is not valid semver`);
  }

  // accent
  const accent = manifest.colors?.accent ?? manifest.colors?.primary;
  if (!accent) {
    addIssue(`${themeName}: missing required accent color (colors.accent)`);
  } else if (!COLOR_REGEX.test(accent)) {
    addIssue(`${themeName}: accent color "${accent}" is not a valid CSS color`);
  }

  // wiring.id
  const wiringId = manifest.wiring?.id;
  if (!wiringId) {
    addIssue(`${themeName}: missing required wiring.id (署名链必填)`);
  } else if (!WIRING_ID_REGEX.test(wiringId)) {
    addIssue(`${themeName}: wiring.id "${wiringId}" must match ${WIRING_ID_REGEX.source}`);
  }

  return { errors, warnings };
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(THEMES_DIR, { withFileTypes: true });
  } catch (e) {
    console.error(`validate-theme-metadata: cannot read themes dir: ${e.message}`);
    process.exit(1);
  }

  const allErrors = [];
  const allWarnings = [];
  let checked = 0;

  for (const entry of dirs) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '_shared') continue;

    const manifestPath = path.join(THEMES_DIR, entry.name, 'manifest.json');
    let manifestRaw;
    try {
      manifestRaw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a theme package
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      allErrors.push(`${entry.name}: manifest.json is not valid JSON`);
      continue;
    }

    checked++;
    const { errors, warnings } = validateMetadata(manifest, entry.name);
    allErrors.push(...errors);
    allWarnings.push(...warnings);
  }

  // Output
  if (allWarnings.length > 0) {
    console.warn(`validate-theme-metadata: ${allWarnings.length} warning(s):`);
    for (const w of allWarnings) console.warn(`  ⚠ ${w}`);
  }

  if (allErrors.length > 0) {
    console.error(`validate-theme-metadata: ${allErrors.length} issue(s) in ${checked} theme(s):`);
    for (const e of allErrors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }

  console.log(
    `validate-theme-metadata: OK — ${checked} theme(s) pass (author+license+version+accent+wiring)`,
  );
}

main().catch((e) => {
  console.error(`validate-theme-metadata: unexpected error: ${e.stack ?? e}`);
  process.exit(1);
});
