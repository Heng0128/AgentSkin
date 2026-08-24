// SPDX-License-Identifier: MPL-2.0

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const THEMES_DIR = join(process.cwd(), 'themes');

/**
 * 14 个必需颜色令牌（对应 THEME_SPEC.md colors 规范）
 */
const REQUIRED_COLOR_TOKENS = [
  'accent',
  'secondary',
  'background',
  'foreground',
  'muted',
  'surface',
  'surfaceElevated',
  'border',
  'codeBackground',
  'codeForeground',
  'inputBackground',
  'buttonBackground',
  'buttonForeground',
  'focusRing',
];

/**
 * targets 中引用的全部 Agent
 */
const EXPECTED_AGENTS = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];

/**
 * @typedef {Object} Manifest
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} displayName
 * @property {string} version
 * @property {Record<string, string>} colors
 * @property {Record<string, {css: string}>} targets
 * @property {string[]} [supportedAgents]
 * @property {string} [mode]
 */

/**
 * 安全读取并解析 manifest.json
 */
function readManifest(themeId) {
  const path = join(THEMES_DIR, themeId, 'manifest.json');
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw);
}

/**
 * 递归获取所有子目录中的主题 ID（目录含 manifest.json）
 */
function getAllThemeIds() {
  if (!existsSync(THEMES_DIR)) return [];
  const ids = [];
  for (const entry of readdirSync(THEMES_DIR)) {
    const full = join(THEMES_DIR, entry);
    if (statSync(full).isDirectory()) {
      if (existsSync(join(full, 'manifest.json'))) {
        ids.push(entry);
      }
    }
  }
  return ids;
}

// 生成器允许两种合法的宿主选择器格式：
//   - `:root {` / `:root.agentskin-host-<agent> {`（如 codex 用 :root 前缀挂载）
//   - `html.agentskin-host-<agent> {`（如 traework / doubao 等用 html 前缀挂载）
const HOST_SELECTOR = /(?::root(?:\.agentskin-host-\w+)?|html\.agentskin-host-\w+)\s*\{/;

// --- Validation Result Types ---

/**
 * @typedef {Object} CheckError
 * @property {string} check
 * @property {string} message
 */

/**
 * @typedef {Object} CheckResult
 * @property {string} name
 * @property {boolean} passed
 * @property {CheckError[]} errors
 */

// --- Main ---

function main() {
  const availableThemes = existsSync(THEMES_DIR) ? getAllThemeIds() : [];
  const results = [];

  if (availableThemes.length === 0) {
    console.warn(`themes/ directory not found at ${THEMES_DIR}, skipping all assertions`);
    console.log('\nTotal: 0 checks, 0 passed, 0 failed (themes/ not found)');
    return;
  }

  // Check 1: 每个主题 manifest 包含 14 个必需 token
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const token of REQUIRED_COLOR_TOKENS) {
        if (manifest.colors[token] === undefined) {
          errors.push({ check: '14 required tokens', message: `${themeId} missing token ${token}` });
        } else if (typeof manifest.colors[token] !== 'string') {
          errors.push({ check: '14 required tokens', message: `${themeId} token ${token} is not a string` });
        } else if (manifest.colors[token].length === 0) {
          errors.push({ check: '14 required tokens', message: `${themeId} token ${token} is empty` });
        }
      }
    }
    results.push({ name: '14 required tokens', passed: errors.length === 0, errors });
  }

  // Check 2: 每个主题的 CSS 文件存在（6 agent）
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const agent of EXPECTED_AGENTS) {
        const relPath = manifest.targets[agent]?.css;
        if (relPath === undefined) {
          errors.push({ check: '6 agent CSS files', message: `${themeId}: targets.${agent}.css missing` });
        } else {
          const cssPath = join(THEMES_DIR, themeId, relPath);
          if (!existsSync(cssPath)) {
            errors.push({ check: '6 agent CSS files', message: `${themeId}: CSS file missing: ${cssPath}` });
          }
        }
      }
    }
    results.push({ name: '6 agent CSS files', passed: errors.length === 0, errors });
  }

  // Check 3: CSS 文件包含 --agentskin-accent 变量
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, themeId, relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        if (!css.includes('--agentskin-accent:')) {
          errors.push({ check: '--agentskin-accent variable', message: `${themeId}/${agent} missing --agentskin-accent` });
        }
      }
    }
    results.push({ name: '--agentskin-accent variable', passed: errors.length === 0, errors });
  }

  // Check 4: CSS 文件包含 --agentskin-bg 变量
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, themeId, relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        if (!css.includes('--agentskin-bg:')) {
          errors.push({ check: '--agentskin-bg variable', message: `${themeId}/${agent} missing --agentskin-bg` });
        }
      }
    }
    results.push({ name: '--agentskin-bg variable', passed: errors.length === 0, errors });
  }

  // Check 5: CSS 文件包含 color-scheme 声明
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, themeId, relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        if (!/color-scheme:\s*(dark|light)\s*(!important)?;/.test(css)) {
          errors.push({ check: 'color-scheme declaration', message: `${themeId}/${agent} missing color-scheme` });
        }
      }
    }
    results.push({ name: 'color-scheme declaration', passed: errors.length === 0, errors });
  }

  // Check 6: 所有主题目录都有 manifest.json
  {
    const errors = [];
    for (const dir of readdirSync(THEMES_DIR)) {
      const full = join(THEMES_DIR, dir);
      if (!statSync(full).isDirectory()) continue;
      if (!existsSync(join(full, 'manifest.json'))) {
        errors.push({ check: 'manifest.json exists', message: `Theme "${dir}" missing manifest.json` });
      }
    }
    results.push({ name: 'manifest.json exists', passed: errors.length === 0, errors });
  }

  // Check 7: manifest.json 符合 v2 schema
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      if (manifest.schemaVersion !== 2) {
        errors.push({ check: 'v2 schema (schemaVersion)', message: `"${themeId}" schemaVersion mismatch (got ${manifest.schemaVersion})` });
      }
      if (!manifest.$schema || !manifest.$schema.includes('manifest-v2')) {
        errors.push({ check: 'v2 schema ($schema)', message: `"${themeId}" $schema missing or incorrect` });
      }
    }
    results.push({ name: 'v2 schema', passed: errors.length === 0, errors });
  }

  // Check 8: CSS 文件非空且格式正确
  {
    const errors = [];
    for (const themeId of availableThemes) {
      const manifest = readManifest(themeId);
      for (const agent of Object.keys(manifest.targets)) {
        const relPath = manifest.targets[agent].css;
        const cssPath = join(THEMES_DIR, themeId, relPath);
        if (!existsSync(cssPath)) continue;
        const css = readFileSync(cssPath, 'utf-8');
        if (css.length === 0) {
          errors.push({ check: 'CSS non-empty with host/:root block', message: `${themeId}/${agent} CSS is empty` });
        } else if (!HOST_SELECTOR.test(css)) {
          errors.push({ check: 'CSS non-empty with host/:root block', message: `${themeId}/${agent} CSS missing :root or host selector` });
        }
      }
    }
    results.push({ name: 'CSS non-empty with host/:root block', passed: errors.length === 0, errors });
  }

  // --- Output ---

  let passedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const checkNum = i + 1;
    if (result.passed) {
      console.log(`✓ Check ${checkNum}: ${result.name} — ${availableThemes.length}/${availableThemes.length} themes passed`);
      passedCount++;
    } else {
      const uniqueThemes = new Set(result.errors.map((e) => e.message.split(/[:\s]/)[0]));
      console.log(`✗ Check ${checkNum}: ${result.name} — ${uniqueThemes.size} theme(s) failed`);
      for (const err of result.errors) {
        console.log(`  - ${err.message}`);
      }
      failedCount++;
    }
  }

  console.log(`\nTotal: ${results.length} checks, ${passedCount} passed, ${failedCount} failed`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main();
