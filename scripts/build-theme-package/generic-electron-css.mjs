// SPDX-License-Identifier: MPL-2.0

/**
 * # generic-electron-css — 运行时语义 CSS 构建器
 *
 * 设计哲学（综合 Dream Work Theme / Codex-Dream-Skin / CodeDrobe）:
 *   - Dream Work Theme: mainSelectors 运行时查表 → 一个构建器服务 N 应用
 *   - Codex-Dream-Skin: 12 个注册部件 + Safe CSS → 主题不可能破坏应用
 *   - CodeDrobe: verification.any 冗余候选 → 任一匹配即通过
 *   - 用户洞察: 应用主题不应因 CSS token 名变化而频繁修改
 *
 * 输出: 一份纯语义 CSS (不含任何应用原生 token 名), 直接注入 :root 即可工作
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEMANTIC_SELECTORS = JSON.parse(
  readFileSync(join(__dirname, '../../engines/shared/semantic-selectors.json'), 'utf8'),
);

/**
 * 应用类型注册表 — 替代旧的 HOST_SELECTOR + INJECTION_MODE 分散配置
 * 添加新应用 = 加一行, 不动其他代码
 */
export const APP_REGISTRY = {
  // generic-electron: 单一 theme.css 通过语义选择器适配
  zcode: { kind: 'generic-electron' },
  workbuddy: { kind: 'generic-electron' },
  codex: { kind: 'generic-electron', cspFallback: true },
  qoderwork: { kind: 'generic-electron' },
  // bespoke: 应用特殊，需要手写覆盖层
  traework: {
    kind: 'bespoke',
    reason: 'uses style-element injection instead of adoptedStyleSheets',
  },
  doubao: { kind: 'bespoke', reason: 'requires dark-mode token remap + bgObserver' },
};

/**
 * 构建 semantic-only CSS — 不含任何应用原生 token 名
 *
 * @param {string} appId - 应用 ID
 * @param {Record<string,string>} palette - 14 token 键值对
 * @param {{shadow?:string,glass?:string}} [options] - 阴影/毛玻璃预设
 * @returns {string} 可注入 :root 的语义 CSS
 */
export function buildGenericElectronCss(appId, palette, options = {}) {
  const selectors = SEMANTIC_SELECTORS[appId];
  if (!selectors) {
    console.warn(`[generic-electron-css] ⚠ 未注册应用 ${appId}, 使用最小回退`);
    return buildMinimalFallback(appId, palette);
  }
  const shadow = options.shadow || 'medium';
  const lines = [];

  lines.push(`/* AgentSkin semantic CSS — generated for ${appId} */`);
  lines.push(`/* 应用更新不会使此 CSS 失效 — 选择器是语义的 */`);
  lines.push('');

  // ---- 1. 14 token 注入 ----
  lines.push('.agentskin-host {');
  for (const [k, v] of Object.entries(palette)) {
    lines.push(`  ${k}: ${v};`);
  }
  lines.push('}');
  lines.push('');

  // ---- 2. 背景系统 (semantic selectors, zero app-token names) ----
  const MAIN = selectors.main?.join(',\n  ') || 'main';
  lines.push(`${MAIN} {`);
  lines.push(`  background: var(--sk-bg) !important;`);
  lines.push(`  color: var(--sk-text) !important;`);
  lines.push('}');
  lines.push('');

  // 侧边栏 — 半透明 surface (Dream Work Theme 模式: color-mix)
  const SIDEBAR = selectors.sidebar?.join(',\n  ') || 'aside';
  lines.push(`${SIDEBAR} {`);
  lines.push(`  background: color-mix(in srgb, var(--sk-surface) 12%, transparent) !important;`);
  lines.push('}');
  lines.push('');

  // 输入区域
  const COMPOSER = selectors.composer?.join(',\n  ') || '[contenteditable]';
  lines.push(`${COMPOSER} {`);
  lines.push(`  background: var(--sk-input-bg) !important;`);
  lines.push('}');
  lines.push('');

  // 弹窗 + 覆盖层
  const DIALOG = selectors.dialog?.join(',\n  ') || "[role='dialog']";
  lines.push(`${DIALOG} {`);
  lines.push(`  background: var(--sk-surface-elevated) !important;`);
  lines.push(`  box-shadow: var(--sk-shadow-${shadow}) !important;`);
  lines.push('}');
  lines.push('');

  // 消息气泡
  lines.push('[class*="message"], [class*="bubble"], [class*="chat-item"] {');
  lines.push(`  background: var(--sk-code-bg) !important;`);
  lines.push(`  border: 1px solid var(--sk-border) !important;`);
  lines.push('}');
  lines.push('');

  // 按钮和链接 — accent
  const BUTTON = selectors.button?.join(',\n  ') || 'button';
  lines.push(`${BUTTON} {`);
  lines.push(`  background: var(--sk-accent) !important;`);
  lines.push(`  border-color: var(--sk-accent) !important;`);
  lines.push('}');
  lines.push('');

  // 滚动条
  lines.push('::-webkit-scrollbar { width: 8px; height: 8px; }');
  lines.push('::-webkit-scrollbar-thumb {');
  lines.push(`  background: var(--sk-border) !important;`);
  lines.push(`  border-radius: 4px;`);
  lines.push('}');
  lines.push('');

  // code 块
  lines.push('pre, code, .code-block {');
  lines.push(`  background: var(--sk-code-bg) !important;`);
  lines.push(`  color: var(--sk-code-fg) !important;`);
  lines.push('}');

  return lines.join('\n');
}

/**
 * 最小回退 — 仅注入 14 token, 不做任何背景/布局假设
 */
function buildMinimalFallback(appId, palette) {
  const lines = [`/* AgentSkin fallback CSS for ${appId} — 仅 token 注入 */`, '.agentskin-host {'];
  for (const [k, v] of Object.entries(palette)) lines.push(`  ${k}: ${v};`);
  lines.push('}');
  return lines.join('\n');
}

/**
 * 检查 appId 是否支持 generic-electron 路径
 */
export function isGenericElectron(appId) {
  return APP_REGISTRY[appId]?.kind === 'generic-electron';
}

/**
 * 获取所有 bespoke 应用列表（需要手动 overrides 的应用）
 */
export function getBespokeAppIds() {
  return Object.entries(APP_REGISTRY)
    .filter(([, v]) => v.kind === 'bespoke')
    .map(([k]) => k);
}
