// SPDX-License-Identifier: MPL-2.0

/**
 * # build-theme-package — CSS assembly
 *
 * Builds per-agent CSS from palette, signature, and bridge mappings.
 */

import { sanitizeDeclarationBlock, sanitizeKeyframes } from '../../src/compiler/sanitize.js';
import { AGENT_REMAP, HOST_SELECTOR, SHADOWS, TOKEN_RULES } from './constants.mjs';
import { buildGenericElectronCss, isGenericElectron } from './generic-electron-css.mjs';

/** Map a native agent token name to a crafted palette value (CSS expression). */
export function valueForToken(token) {
  const t = token.toLowerCase();
  const v = (name) => `var(${name})`;
  for (const rule of TOKEN_RULES) {
    if (rule.pattern(t)) {
      const out = rule.result(t, v);
      if (out !== null) return out;
    }
  }
  return v('--agentskin-bg');
}

/**
 * Build the full CSS for a single agent.
 *
 * 分支策略:
 *   - generic-electron 应用 (zcode/workbuddy/codex/qoderwork): 语义 CSS 路径
 *     → 使用 semantic-selectors.json + buildGenericElectronCss()
 *     → 不包含任何应用原生 token 名,应用更新不破坏主题
 *   - bespoke 应用 (traework/doubao): 精确 token remap 路径
 *     → 使用现有 AGENT_REMAP + TOKEN_RULES
 *     → 需手写 overrides,但精细度更高
 */
export function buildAgentCss(agentId, palette, signature, bridge, rawKeyframes) {
  // 优先尝试 generic-electron 路径 (无原生 token 名,应用更新免疫)
  if (isGenericElectron(agentId)) {
    return buildGenericElectronCss(agentId, palette, {
      shadow: signature?.shadowLevel,
      glass: signature?.blurPx ? 'medium' : 'none',
    });
  }

  // Bespoke 路径 — 精确 token remap (traework/doubao)
  return buildAgentCssInternal(agentId, palette, signature, bridge, rawKeyframes);
}

/**
 * Internal CSS builder — assembles :root token block, optional keyframes,
 * optional variable bridge, native token remap, and craft overrides.
 */
function buildAgentCssInternal(agentId, palette, signature, bridge, rawKeyframes) {
  const lines = [];
  const mode = palette.mode === 'light' ? 'light' : 'dark';
  const host = HOST_SELECTOR[agentId] || `html.agentskin-host-${agentId}`;
  lines.push(`/* AgentSkin Studio export — ${agentId} */`);
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const [k, val] of Object.entries(palette.tokens)) lines.push(`  ${k}: ${val};`);
  lines.push('}');

  // λ P0-2: sanitize user-declared keyframes before emit (fail-closed).
  if (rawKeyframes) {
    const sanitized = sanitizeKeyframes(rawKeyframes, {
      allowPaletteTokens: true,
      namespacePrefix: 'agentskin-',
    });
    if (sanitized.isBlocked) {
      console.warn(
        `[build-theme-package] ⚠ keyframes blocked for ${agentId}: ${sanitized.violations.join('; ')}`,
      );
    } else {
      if (sanitized.violations.length > 0) {
        console.warn(
          `[build-theme-package] ⚠ keyframes warnings for ${agentId}: ${sanitized.violations.join('; ')}`,
        );
      }
      lines.push(sanitized.clean);
    }
  }

  // Variable bridge: emit client-native variable declarations that resolve through agentskin tokens.
  // SECURITY: sanitize each bridge value to prevent CSS injection.
  if (bridge && typeof bridge === 'object' && Object.keys(bridge).length > 0) {
    lines.push('/* Variable bridge (Studio): client-native → agentskin tokens */');
    lines.push(`${host} {`);
    for (const [k, val] of Object.entries(bridge)) {
      const bridgeSanitized = sanitizeDeclarationBlock(String(val), {
        allowPaletteTokens: true,
      });
      if (bridgeSanitized.isBlocked) {
        console.warn(
          `[build-theme-package] ⚠ bridge value for "${k}" blocked (agent=${agentId}): ${bridgeSanitized.violations.join('; ')}`,
        );
        continue;
      }
      lines.push(`  ${k}: ${bridgeSanitized.clean};`);
    }
    lines.push('}');
  }
  lines.push('');

  const remap = AGENT_REMAP[agentId] || [];
  lines.push(`/* Redirect ${agentId} native design tokens onto the crafted palette */`);
  lines.push(`${host} {`);
  lines.push(`  color-scheme: ${mode} !important;`);
  for (const tk of remap) lines.push(`  ${tk}: ${valueForToken(tk)} !important;`);
  lines.push('}');
  lines.push('');

  const craft = buildCraft(agentId, signature);
  if (craft) {
    lines.push(craft);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Build craft overrides layer from the 8-dimension toolbox signature
 * (radius / spacing / shadow / blur / font / motion / color).
 */
function buildCraft(agentId, signature) {
  if (!signature || typeof signature !== 'object') return '';
  const el = `html.agentskin-host-${agentId}`;
  const out = ['/* Craft overrides — Studio toolbox dimensions */'];
  if (signature.radius) {
    out.push(
      `${el} button, ${el} input, ${el} textarea, ${el} select, ${el} [role="textbox"], ${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"] { border-radius: ${signature.radius} !important; }`,
    );
    out.push(`:root { --as-radius: ${signature.radius}; }`);
  }
  if (signature.spacing != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="sidebar"], ${el} [class*="Panel"], ${el} [class*="Sidebar"] { padding: ${signature.spacing}px !important; }`,
    );
    out.push(`:root { --as-spacing: ${signature.spacing}px; }`);
  }
  if (signature.shadowLevel && signature.shadowLevel !== 'none' && SHADOWS[signature.shadowLevel]) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="card"], ${el} [class*="elevated"], ${el} [class*="surface"] { box-shadow: ${SHADOWS[signature.shadowLevel]} !important; }`,
    );
    out.push(`:root { --as-shadow-level: ${signature.shadowLevel}; }`);
  }
  if (signature.blurPx != null && signature.blurPx > 0) {
    out.push(
      `${el} [class*="sidebar"], ${el} [class*="overlay"], ${el} [class*="modal"], ${el} [class*="navbar"], ${el} [class*="topbar"], ${el} header { backdrop-filter: blur(${signature.blurPx}px) !important; }`,
    );
    out.push(`:root { --as-blur: ${signature.blurPx}px; }`);
  }
  if (signature.fontSize != null) {
    out.push(`${el} body { font-size: ${signature.fontSize}px !important; }`);
    out.push(`:root { --as-font-size: ${signature.fontSize}px; }`);
  }
  if (signature.fontFam) {
    out.push(`${el} body { font-family: ${signature.fontFam} !important; }`);
    out.push(`:root { --as-font-family: ${signature.fontFam}; }`);
  }
  if (signature.duration) {
    out.push(`${el} body, ${el} body * { transition-duration: ${signature.duration} !important; }`);
    out.push(`:root { --as-transition-duration: ${signature.duration}; }`);
  }
  if (signature.timing) {
    out.push(
      `${el} body, ${el} body * { transition-timing-function: ${signature.timing} !important; }`,
    );
    out.push(`:root { --as-transition-timing: ${signature.timing}; }`);
  }
  // color (re-themed by role)
  if (signature.accent) {
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="active"], ${el} [class*="Active"], ${el} [class*="selected"], ${el} [class*="Selected"], ${el} a { color: ${signature.accent} !important; border-color: ${signature.accent} !important; }`,
    );
    out.push(
      `${el} [class*="accent"], ${el} [class*="Accent"], ${el} [class*="primary"], ${el} [class*="Primary"], ${el} [class*="selected"], ${el} [class*="Selected"] { background-color: ${signature.accent} !important; }`,
    );
    out.push(
      `:root { --agentskin-accent: ${signature.accent}; --as-accent: ${signature.accent}; }`,
    );
  }
  if (signature.background) {
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-color: ${signature.background} !important; }`,
    );
    out.push(
      `:root { --agentskin-background: ${signature.background}; --as-bg: ${signature.background}; }`,
    );
  }
  if (signature.foreground) {
    out.push(`${el} body { color: ${signature.foreground} !important; }`);
    out.push(
      `:root { --agentskin-foreground: ${signature.foreground}; --as-fg: ${signature.foreground}; }`,
    );
  }
  if (signature.surface) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"] { background-color: ${signature.surface} !important; }`,
    );
    out.push(
      `:root { --agentskin-surface: ${signature.surface}; --as-surface: ${signature.surface}; }`,
    );
  }
  // gradient accent background (bakeable)
  if (signature.gradientAccent) {
    const g =
      signature.accent && signature.background
        ? `linear-gradient(135deg, ${signature.accent} 0%, ${signature.background} 72%)`
        : 'linear-gradient(135deg, var(--agentskin-accent) 0%, var(--agentskin-bg) 72%)';
    out.push(
      `${el} body, ${el} [class*="root"], ${el} [class*="Root"] { background-image: ${g} !important; }`,
    );
    out.push(`:root { --as-grad: ${g}; }`);
  }
  // structure
  if (signature.borderWidth != null) {
    out.push(
      `${el} [class*="panel"], ${el} [class*="Panel"], ${el} [class*="card"], ${el} [class*="Card"], ${el} [class*="surface"], ${el} [class*="Surface"], ${el} [class*="sidebar"], ${el} [class*="Sidebar"] { border-width: ${signature.borderWidth}px !important; }`,
    );
  }
  if (signature.lineHeight != null) {
    out.push(`${el} body { line-height: ${signature.lineHeight} !important; }`);
  }
  return out.join('\n');
}
