// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package — manifest generation
 */

import { VERIFICATION } from './constants.mjs';

/** Slugify a name for use as a theme id. */
export function slugify(name) {
  return (
    (name || 'studio-theme')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'studio-theme'
  );
}

/** Build the manifest colors section from palette tokens. */
export function manifestColors(tokens) {
  const accent = tokens['--agentskin-accent'];
  const buttonBg = tokens['--agentskin-button-bg'] || accent;
  // buttonForeground: 基于按钮背景亮度决定文字色（暗色背景 -> 白字，亮色背景 -> 近黑）。
  const buttonFg = luminance(buttonBg) < 0.5 ? '#ffffff' : '#1a1a2e';
  return {
    accent,
    secondary: tokens['--agentskin-secondary'],
    background: tokens['--agentskin-bg'],
    foreground: tokens['--agentskin-text'],
    muted: tokens['--agentskin-muted'],
    surface: tokens['--agentskin-surface'],
    surfaceElevated: tokens['--agentskin-surface-elevated'],
    border: tokens['--agentskin-border'],
    codeBackground: tokens['--agentskin-code-bg'],
    codeForeground: tokens['--agentskin-code-fg'],
    inputBackground: tokens['--agentskin-input-bg'],
    buttonBackground: tokens['--agentskin-button-bg'],
    buttonForeground: buttonFg,
    focusRing: tokens['--agentskin-focus-ring'],
    selection: tokens['--agentskin-selection'],
  };
}

/**
 * Build the full manifest.json content.
 * @param request The Studio export request
 * @param agentId Target agent id
 * @param palette Derived palette (tokens + mode)
 * @param images Normalized images object (or null)
 */
export function buildManifest(request, agentId, palette, images) {
  const id =
    (request.meta?.id && slugify(request.meta.id)) ||
    slugify(request.meta?.name) ||
    `${agentId}-studio-${new Date().toISOString().slice(0, 10)}`;
  const name = request.meta?.name || 'Studio Theme';
  const author = request.meta?.author || 'AgentSkin Studio';
  const mode = palette.mode;
  const verify = VERIFICATION[agentId];
  // 2a multi-asset: `hero` (backdrop special case of `images.hero`) +
  // `assets.images` (id → relative file path) mirror the B-line
  // `bundle.assets.images` contract so the installer can embed them.
  const imageEntries = images ? Object.entries(images) : [];
  const heroFile = images?.hero ? `assets/images/${images.hero.filename}` : undefined;
  const assets = imageEntries.length
    ? {
        images: Object.fromEntries(
          imageEntries.map(([imgId, img]) => [imgId, `assets/images/${img.filename}`]),
        ),
      }
    : undefined;
  return {
    $schema: 'https://agentskin.dev/schema/manifest-v2.json',
    schemaVersion: 2,
    format: 'agentskin-theme',
    semanticVersion: 1,
    id,
    name,
    displayName: name,
    version: '1.0.0',
    description: `由 AgentSkin 工作室导出（${agentId}）`,
    author: { name: author },
    mode,
    targets: {
      [agentId]: {
        css: `assets/css/${agentId}.css`,
        verification: verify ? { required: [{ name: verify.name, any: verify.any }] } : undefined,
      },
    },
    colors: manifestColors(palette.tokens),
    preview: 'preview.png',
    icon: 'icon.png',
    ...(heroFile ? { hero: heroFile } : {}),
    ...(assets ? { assets } : {}),
    category: 'studio',
    tags: ['studio', 'custom', mode],
    unofficial: true,
    supportedAgents: [agentId],
    probe: {
      tokenNamespaces: [
        '--agentskin-',
        '--cb-',
        '--vscode-',
        '--color-',
        '--dbx-',
        '--wb-',
        '--text-',
      ],
      styleContract: 'THEME_SPEC.md#探针样式契约',
    },
  };
}

// Re-export luminance for use in manifestColors
import { luminance } from '../../src/shared/theme/utils/color-utils.mjs';
