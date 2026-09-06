// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package — Theme Studio export builder (main entry)
 *
 * Receives a ThemeStudioExportRequest-shaped payload from the renderer
 * (via `studio:export`) and writes a directory-based `.agentskin-theme` package
 * under `theme-workbench/out/<id>.agentskin-theme/`.
 *
 * This file is the main entry point. It orchestrates the build process by
 * delegating to focused sub-modules:
 *   - {@link ./constants}          — configuration & token rules
 *   - {@link ./css-assembly}       — CSS generation
 *   - {@link ./image-processing}   — image validation & packaging
 *   - {@link ./manifest}           — manifest.json generation
 *   - {@link ./png-encoder}        — PNG encoding
 *   - {@link ./preview-icon}       — preview & icon raster
 */

import fs from 'node:fs';
import path from 'node:path';
import { AGENT_SPECIFICITY_PROFILES, validateSpecificity } from '../../src/compiler/specificity.js';
import { getAdapter } from '../../src/engine/src/adapters/index.mjs';
import { hexToRgb, luminance } from '../../src/shared/theme/utils/color-utils.mjs';
import {
  FINGERPRINT_FILENAME,
  generateBuildFingerprint,
} from '../../src/shared/theme-build-fingerprint.js';
import { SHA256SUMS_FILENAME, writeSha256Sums } from '../lib/theme-sha256sums.mjs';
import { DEFAULT_TOKENS } from './constants.mjs';
import { buildAgentCss } from './css-assembly.mjs';
import { processThemeImages } from './image-processing.mjs';
import { buildManifest, manifestColors, slugify } from './manifest.mjs';
import { buildIcon, buildPreview } from './preview-icon.mjs';

// ---------------------------------------------------------------------------
// Palette assembly
// ---------------------------------------------------------------------------

/**
 * Derive the final palette (tokens + mode) from a root token map.
 * A-08 / Q18：拒绝"残缺提取"——调用方传入非空 root 却无任何 --agentskin-* token，
 * 静默回退 DEFAULT_TOKENS 会让产物被默认紫色污染而不报错。
 */
export function deriveTokens(root) {
  if (root && typeof root === 'object' && Object.keys(root).length > 0) {
    const themed = Object.keys(root).filter((k) => k.startsWith('--agentskin-'));
    if (themed.length === 0) {
      throw new Error(
        `[build-theme-package] deriveTokens: root 含 ${Object.keys(root).length} 个键但无任何 ` +
          '`--agentskin-*` 主题 token —— 疑似残缺提取，拒绝回退到 DEFAULT_TOKENS 掩蔽。',
      );
    }
  }
  const tokens = { ...DEFAULT_TOKENS };
  if (root && typeof root === 'object') {
    for (const [k, val] of Object.entries(root)) {
      if (typeof k === 'string' && k.startsWith('--agentskin-') && typeof val === 'string') {
        tokens[k] = val;
      }
    }
  }
  // --- P1 fix: selection / focus-ring 从 accent 派生，避免 DEFAULT 紫色泄漏 ---
  const rootSelection =
    root && typeof root === 'object' ? root['--agentskin-selection'] : undefined;
  const rootFocusRing =
    root && typeof root === 'object' ? root['--agentskin-focus-ring'] : undefined;
  if (rootSelection === undefined || rootSelection === DEFAULT_TOKENS['--agentskin-selection']) {
    tokens['--agentskin-selection'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 32%, transparent)`;
  }
  if (rootFocusRing === undefined || rootFocusRing === DEFAULT_TOKENS['--agentskin-focus-ring']) {
    tokens['--agentskin-focus-ring'] =
      `color-mix(in srgb, ${tokens['--agentskin-accent']} 40%, transparent)`;
  }
  // --- P2 fix: input-bg / button-bg post-override 派生，与 tokenBlock() 一致 ---
  const rootInputBg = root && typeof root === 'object' ? root['--agentskin-input-bg'] : undefined;
  const rootButtonBg = root && typeof root === 'object' ? root['--agentskin-button-bg'] : undefined;
  if (rootInputBg === undefined || rootInputBg === DEFAULT_TOKENS['--agentskin-input-bg']) {
    tokens['--agentskin-input-bg'] =
      `color-mix(in srgb, color-mix(in srgb, ${tokens['--agentskin-surface']} 82%, ${tokens['--agentskin-accent']} 18%) 45%, transparent)`;
  }
  if (rootButtonBg === undefined || rootButtonBg === DEFAULT_TOKENS['--agentskin-button-bg']) {
    tokens['--agentskin-button-bg'] = tokens['--agentskin-accent'];
  }
  // --- button-fg / text-shadow 派生，与 tokenBlock() 一致 ---
  // button-fg 基于 accent 亮度推导（WCAG 对比色），与 theme-utils.mjs tokenBlock() 统一
  if (!('--agentskin-button-fg' in tokens)) {
    tokens['--agentskin-button-fg'] =
      luminance(tokens['--agentskin-accent']) < 0.5 ? '#ffffff' : '#000000';
  }
  if (!('--agentskin-text-shadow' in tokens)) {
    tokens['--agentskin-text-shadow'] =
      luminance(tokens['--agentskin-bg']) < 0.5 ? '0 1px 2px rgba(0,0,0,0.3)' : '';
  }
  const mode = luminance(tokens['--agentskin-bg']) < 0.5 ? 'dark' : 'light';
  return { tokens, mode };
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Build a complete .agentskin-theme package directory.
 * @param request The Studio export request
 * @param outDir Output directory (package written to `${outDir}/${id}.agentskin-theme/`)
 * @returns Absolute path to the created package directory
 */
export async function buildThemePackage(request, outDir) {
  // A-10 / Q13：非法或缺失 agentId 直接拒绝，避免静默生成"空白主题包"。
  if (!request?.agentId || typeof request.agentId !== 'string') {
    throw new Error(
      '[build-theme-package] Missing request.agentId — must be one of: ' +
        ['codex', 'doubao', 'workbuddy', 'qoderwork', 'traework', 'zcode'].join(', '),
    );
  }
  getAdapter(request.agentId); // 抛错即拒绝非法 agentId
  const agentId = request.agentId;
  const palette = deriveTokens(request?.root);
  // 2a multi-asset: normalize + gate the declared image set (null when absent).
  const images = processThemeImages(request);
  const manifest = buildManifest(request, agentId, palette, images);
  const bridge =
    request?.variableBridge && typeof request.variableBridge === 'object'
      ? request.variableBridge
      : null;
  const css = buildAgentCss(
    agentId,
    palette,
    request?.signature,
    bridge,
    request?.declarations?.keyframes,
  );

  // λ P0-1: specificity guard — detect + warn only (backward compatible).
  const agentProfile = AGENT_SPECIFICITY_PROFILES[agentId];
  if (agentProfile) {
    const report = validateSpecificity(css, agentProfile);
    if (report.violated) {
      console.warn(
        `[build-theme-package] ⚠ specificity budget exceeded for ${agentId}: ` +
          `${report.actualBudget}/${agentProfile.importantBudget}`,
      );
      console.warn(`  Recommendations: ${report.recommendations.join('; ')}`);
    }
  }

  const pkgDir = path.join(outDir, `${manifest.id}.agentskin-theme`);
  fs.mkdirSync(path.join(pkgDir, 'assets', 'css'), { recursive: true });
  if (images) fs.mkdirSync(path.join(pkgDir, 'assets', 'images'), { recursive: true });

  fs.writeFileSync(
    path.join(pkgDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(pkgDir, 'assets', 'css', `${agentId}.css`), css, 'utf8');
  fs.writeFileSync(path.join(pkgDir, 'preview.png'), buildPreview(palette));
  fs.writeFileSync(path.join(pkgDir, 'icon.png'), buildIcon(palette));

  // 2a multi-asset: write each image into assets/images/<id>.<ext>
  if (images) {
    for (const img of Object.values(images)) {
      const destPath = path.join(pkgDir, 'assets', 'images', img.filename);
      if (img.filePath) {
        fs.copyFileSync(img.filePath, destPath);
      } else {
        fs.writeFileSync(destPath, Buffer.from(img.base64, 'base64'));
      }
    }
  }

  // Build fingerprint: SHA-256 integrity manifest covering
  // manifest.json + per-agent CSS files.
  const fingerprint = await generateBuildFingerprint(pkgDir);
  fs.writeFileSync(
    path.join(pkgDir, FINGERPRINT_FILENAME),
    `${JSON.stringify(fingerprint, null, 2)}\n`,
    'utf8',
  );

  // SHA256SUMS.txt: standard sha256sum-compatible file covering ALL files
  // in the theme directory.
  const sumsPath = writeSha256Sums(pkgDir);
  console.log(`[build-theme-package] wrote ${SHA256SUMS_FILENAME} → ${sumsPath}`);

  return pkgDir;
}

// Allow direct CLI invocation for local testing (not used by the app).
if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2] || path.join(process.cwd(), 'theme-workbench', 'out');
  const dir = await buildThemePackage(
    {
      agentId: 'workbuddy',
      meta: { name: 'CLI Test', author: 'tester' },
      root: {},
      signature: { radius: '14px', shadowLevel: 'md' },
    },
    out,
  );
  console.log('wrote', dir);
}
