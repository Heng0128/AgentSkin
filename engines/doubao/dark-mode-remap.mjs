/**
 * ENGINE: doubao — Dark Mode Token Remap
 * ------------------------------------------------------------
 * 豆包原生只有亮色模式，暗色主题需要重映射豆包的 DBX / s-color
 * 文字 token，避免黑色文字落在暗色背景上。
 *
 * 本模块导出三个函数：
 *   - getDarkModeTokenOverrides()  → 暗色模式下的 CSS 变量覆盖
 *   - getDarkModeElementOverrides() → 暗色模式下的元素级覆盖 CSS
 *   - isDarkModePreferred()        → 检测当前是否为暗色系统偏好
 *
 * 设计原则：
 *   - 不引入新依赖，纯计算函数（便于单元测试）
 *   - token 值使用 agentskin-* 变量引用，跟随主题变化
 *   - 仅在被 adapter.mjs 检测到暗色偏好时注入，不干扰亮色主题
 */

// 有效的 CSS 颜色值正则（hex / rgb / rgba / hsl / hsla / named / var()）
const CSS_COLOR_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(.+\)$|^hsla?\(.+$|^var\(.+\)$|^[a-z]+$/;

/**
 * 验证字符串是否为有效的 CSS 颜色值。
 * 用于测试断言和运行时防御。
 */
export function isValidCssColor(value) {
  if (typeof value !== 'string') return false;
  return CSS_COLOR_RE.test(value.trim());
}

/**
 * 返回暗色模式下的额外 CSS 变量覆盖。
 * 覆盖范围与 tokens.css 的亮色定义平行，使用 agentskin-* 变量引用。
 *
 * @returns {Record<string, string>} CSS 自定义属性名 → 暗色值
 */
export function getDarkModeTokenOverrides() {
  return {
    /* --- 文字颜色重映射（使用 agentskin 变量，跟随主题） --- */
    '--dbx-text-primary': 'var(--agentskin-text)',
    '--dbx-text-secondary': 'var(--agentskin-text-muted)',
    '--dbx-text-tertiary': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
    '--dbx-text-disable': 'color-mix(in srgb, var(--agentskin-text) 35%, transparent)',
    '--dbx-text-markdown': 'var(--agentskin-text)',

    /* n00 = "on neutral-00"（暗色下反转文本） */
    '--dbx-text-n00-primary': 'var(--agentskin-bg)',
    '--dbx-text-n00-secondary': 'color-mix(in srgb, var(--agentskin-bg) 90%, var(--agentskin-text))',
    '--dbx-text-n00-tertiary': 'color-mix(in srgb, var(--agentskin-bg) 75%, var(--agentskin-text))',
    '--dbx-text-n00-disable': 'color-mix(in srgb, var(--agentskin-bg) 60%, var(--agentskin-text))',

    /* --- 背景色重映射 --- */
    '--dbx-bg-primary': 'var(--agentskin-bg)',
    '--dbx-bg-secondary': 'var(--agentskin-surface)',
    '--dbx-bg-tertiary': 'var(--agentskin-surface-elevated)',
    '--dbx-bg-float': 'var(--agentskin-surface-elevated)',
    '--dbx-bg-body-web': 'var(--agentskin-bg)',
    '--dbx-bg-base-web': 'var(--agentskin-bg)',
    '--dbx-bg-base-2': 'var(--agentskin-surface)',
    '--dbx-bg-base-5': 'var(--agentskin-surface-elevated)',
    '--dbx-bg-body-overlay-web': 'var(--agentskin-surface)',
    '--dbx-bg-body-white': 'var(--agentskin-bg)',
    '--dbx-bg-body-mac': 'var(--agentskin-bg)',
    '--dbx-bg-browser-win': 'var(--agentskin-bg)',
    '--dbx-bg-browser-mac': 'color-mix(in srgb, var(--agentskin-bg) 95%, black)',

    /* --- 边框色 --- */
    '--dbx-border-primary': 'var(--agentskin-border)',
    '--dbx-border-secondary': 'color-mix(in srgb, var(--agentskin-border) 70%, transparent)',
    '--dbx-line-divider-5': 'color-mix(in srgb, var(--agentskin-border) 70%, transparent)',
    '--dbx-line-divider-10': 'var(--agentskin-border)',
    '--dbx-line-7': 'var(--agentskin-border)',
    '--dbx-line-10': 'var(--agentskin-border)',
    '--dbx-line-15': 'color-mix(in srgb, var(--agentskin-border) 120%, white)',
    '--dbx-line-20-hover': 'color-mix(in srgb, var(--agentskin-border) 140%, white)',

    /* --- s-color 系列（Semi Design 实际驱动 token） --- */
    '--s-color-bg-body': 'var(--agentskin-bg)',
    '--s-color-bg-primary': 'var(--agentskin-surface)',
    '--s-color-bg-secondary': 'var(--agentskin-surface-elevated)',
    '--s-color-bg-tertiary': 'color-mix(in srgb, var(--agentskin-surface-elevated) 110%, white)',
    '--s-color-bg-float': 'var(--agentskin-surface-elevated)',
    '--s-color-bg-dialogs': 'var(--agentskin-surface-elevated)',
    '--s-color-bg-dialogs-grey': 'var(--agentskin-surface)',

    '--s-color-text-primary': 'var(--agentskin-text)',
    '--s-color-text-secondary': 'var(--agentskin-text-muted)',
    '--s-color-text-tertiary': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
    '--s-color-text-quaternary': 'color-mix(in srgb, var(--agentskin-text) 40%, transparent)',
    '--s-color-text-disable': 'color-mix(in srgb, var(--agentskin-text) 35%, transparent)',

    '--s-color-border-tertiary': 'var(--agentskin-border)',
    '--s-color-border-secondary': 'color-mix(in srgb, var(--agentskin-border) 120%, white)',

    /* --- semi-color 系列（Semi Design 核心 token） --- */
    '--semi-color-bg-0': 'var(--agentskin-bg)',
    '--semi-color-bg-1': 'var(--agentskin-surface)',
    '--semi-color-bg-2': 'var(--agentskin-surface-elevated)',
    '--semi-color-bg-3': 'color-mix(in srgb, var(--agentskin-surface-elevated) 110%, white)',
    '--semi-color-bg-4': 'color-mix(in srgb, var(--agentskin-surface-elevated) 120%, white)',

    '--semi-color-text-0': 'var(--agentskin-text)',
    '--semi-color-text-1': 'var(--agentskin-text-muted)',
    '--semi-color-text-2': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
    '--semi-color-text-3': 'color-mix(in srgb, var(--agentskin-text) 40%, transparent)',

    '--semi-color-border': 'var(--agentskin-border)',
    '--semi-color-fill-0': 'var(--agentskin-surface-elevated)',
    '--semi-color-fill-1': 'color-mix(in srgb, var(--agentskin-surface-elevated) 120%, white)',
    '--semi-color-fill-2': 'color-mix(in srgb, var(--agentskin-surface-elevated) 140%, white)',

    '--semi-color-disabled-bg': 'var(--agentskin-surface-elevated)',
    '--semi-color-disabled-border': 'var(--agentskin-border)',
    '--semi-color-disabled-fill': 'color-mix(in srgb, var(--agentskin-surface-elevated) 120%, white)',
    '--semi-color-disabled-text': 'color-mix(in srgb, var(--agentskin-text) 35%, transparent)',

    /* --- ffc 组件 token --- */
    '--ffc-text-primary': 'var(--agentskin-text)',
    '--ffc-text-secondary': 'var(--agentskin-text-muted)',
    '--ffc-text-tertiary': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
    '--ffc-text-disabled': 'color-mix(in srgb, var(--agentskin-text) 35%, transparent)',
    '--ffc-bg-float': 'var(--agentskin-surface-elevated)',
    '--ffc-bg-subtle': 'var(--agentskin-surface)',
    '--ffc-textarea-color': 'var(--agentskin-text)',
    '--ffc-textarea-placeholder-color': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
    '--ffc-textarea-disabled-color': 'color-mix(in srgb, var(--agentskin-text) 35%, transparent)',
    '--ffc-ai-edit-textarea-color': 'var(--agentskin-text)',
    '--ffc-ai-edit-textarea-placeholder-color': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',

    /* --- Gray ramp（暗色模式使用 agentskin 变量） --- */
    '--gray1': 'var(--agentskin-text)',
    '--gray2': 'color-mix(in srgb, var(--agentskin-text) 80%, var(--agentskin-bg))',
    '--gray3': 'color-mix(in srgb, var(--agentskin-text) 65%, var(--agentskin-bg))',
    '--gray4': 'var(--agentskin-text-muted)',
    '--gray5': 'color-mix(in srgb, var(--agentskin-text) 45%, var(--agentskin-bg))',
    '--gray6': 'color-mix(in srgb, var(--agentskin-text) 35%, var(--agentskin-bg))',
    '--gray7': 'color-mix(in srgb, var(--agentskin-border) 120%, white)',
    '--gray8': 'var(--agentskin-surface-elevated)',
    '--gray9': 'color-mix(in srgb, var(--agentskin-surface-elevated) 95%, black)',
    '--gray10': 'color-mix(in srgb, var(--agentskin-surface) 95%, black)',
    '--gray11': 'color-mix(in srgb, var(--agentskin-bg) 95%, black)',
    '--gray12': 'var(--agentskin-bg)',

    /* --- 语义色 --- */
    '--normal-bg': 'var(--agentskin-surface)',
    '--normal-bg-hover': 'var(--agentskin-surface-elevated)',
    '--normal-text': 'var(--agentskin-text)',
    '--normal-border': 'var(--agentskin-border)',
    '--hover-bg-color': 'var(--agentskin-surface-elevated)',
    '--active-bg-color': 'color-mix(in srgb, var(--agentskin-surface-elevated) 110%, white)',
    '--left-side': 'var(--agentskin-surface)',

    /* --- 输入框 --- */
    '--input-guidance-input-container-background': 'var(--agentskin-surface)',
    '--input-guidance-input-editor-color': 'var(--agentskin-text)',
    '--input-guidance-input-editor-placeholder-color': 'color-mix(in srgb, var(--agentskin-text) 50%, transparent)',
  };
}

/**
 * 返回暗色模式下的元素级覆盖 CSS。
 * 覆盖 tokens.css 无法表达的组件特定样式（侧栏、搜索框、历史对话等）。
 *
 * @returns {string} CSS 字符串，可直接注入 adoptedStyleSheets
 */
export function getDarkModeElementOverrides() {
  return `
/* === 暗色模式：豆包元素级覆盖 === */
/* 侧栏账号信息 */
html.agentskin-host-doubao .dbx-account-info,
html.agentskin-host-doubao [class*="account"],
html.agentskin-host-doubao [class*="user-info"] {
  color: var(--agentskin-text) !important;
}
html.agentskin-host-doubao [class*="account"] .dbx-text-secondary,
html.agentskin-host-doubao [class*="user-info"] .dbx-text-secondary {
  color: var(--agentskin-text-muted) !important;
}

/* 搜索框 */
html.agentskin-host-doubao [class*="search"] input,
html.agentskin-host-doubao input[class*="search"],
html.agentskin-host-doubao [class*="SearchBar"] input,
html.agentskin-host-doubao [data-testid*="search"] input {
  background: var(--agentskin-surface) !important;
  color: var(--agentskin-text) !important;
  border-color: var(--agentskin-border) !important;
}
html.agentskin-host-doubao [class*="search"] input::placeholder,
html.agentskin-host-doubao input[class*="search"]::placeholder {
  color: color-mix(in srgb, var(--agentskin-text) 50%, transparent) !important;
}

/* 历史对话列表 */
html.agentskin-host-doubao .dbx-history-item,
html.agentskin-host-doubao [class*="history-item"],
html.agentskin-host-doubao [class*="conversation-item"],
html.agentskin-host-doubao [class*="chat-item"],
html.agentskin-host-doubao [class*="session-item"] {
  color: var(--agentskin-text-muted) !important;
}
html.agentskin-host-doubao .dbx-history-item:hover,
html.agentskin-host-doubao [class*="history-item"]:hover,
html.agentskin-host-doubao [class*="conversation-item"]:hover,
html.agentskin-host-doubao [class*="chat-item"]:hover,
html.agentskin-host-doubao [class*="session-item"]:hover {
  background: var(--agentskin-surface-elevated) !important;
}
html.agentskin-host-doubao .dbx-history-item[class*="active"],
html.agentskin-host-doubao .dbx-history-item [class*="active"],
html.agentskin-host-doubao [class*="history-item"][class*="active"],
html.agentskin-host-doubao [class*="conversation-item"][class*="active"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 110%, white) !important;
  color: var(--agentskin-text) !important;
}

/* 顶部标题栏 */
html.agentskin-host-doubao .dbx-titlebar,
html.agentskin-host-doubao [class*="titlebar"],
html.agentskin-host-doubao [class*="header-bar"] {
  background: var(--agentskin-bg) !important;
  border-color: var(--agentskin-border) !important;
}
html.agentskin-host-doubao [class*="h-header-height"] {
  background: var(--agentskin-bg) !important;
  border-color: var(--agentskin-border) !important;
}

/* 首页建议卡片 */
html.agentskin-host-doubao .dbx-suggestion-card,
html.agentskin-host-doubao [class*="suggestion-card"],
html.agentskin-host-doubao [class*="recommend-card"],
html.agentskin-host-doubao [class*="guide-card"] {
  background: var(--agentskin-surface) !important;
  border-color: var(--agentskin-border) !important;
}
html.agentskin-host-doubao .dbx-suggestion-card:hover,
html.agentskin-host-doubao [class*="suggestion-card"]:hover {
  background: var(--agentskin-surface-elevated) !important;
}

/* 对话内容区域 */
html.agentskin-host-doubao [class*="message-content"],
html.agentskin-host-doubao [class*="chat-content"],
html.agentskin-host-doubao [class*="msg-body"] {
  color: var(--agentskin-text) !important;
}

/* 输入框操作栏 */
html.agentskin-host-doubao .dbx-composer-actions,
html.agentskin-host-doubao [class*="composer-actions"],
html.agentskin-host-doubao [class*="input-actions"],
html.agentskin-host-doubao [class*="chat-input-actions"] {
  color: color-mix(in srgb, var(--agentskin-text) 50%, transparent) !important;
}

/* 滚动条暗色适配 */
html.agentskin-host-doubao ::-webkit-scrollbar-thumb {
  background: var(--agentskin-border) !important;
}
html.agentskin-host-doubao ::-webkit-scrollbar-thumb:hover {
  background: color-mix(in srgb, var(--agentskin-border) 120%, white) !important;
}
`;
}

/**
 * 检测当前是否为暗色主题偏好。
 * 通过 CSS media query 判断系统偏好。
 * 在非浏览器环境（如单元测试）中返回 false。
 *
 * @returns {boolean} true 表示暗色模式偏好
 */
export function isDarkModePreferred() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * 将 token 对象转换为 CSS 自定义属性声明字符串。
 * 供 adapter.mjs 在运行时注入暗色 token 覆盖。
 *
 * @param {Record<string, string>} tokens getDarkModeTokenOverrides() 的返回值
 * @param {string} selector CSS 选择器（默认 html.agentskin-host-doubao:root）
 * @returns {string} CSS 规则字符串
 */
export function tokensToCss(tokens, selector = 'html.agentskin-host-doubao:root') {
  const declarations = Object.entries(tokens)
    .map(([k, v]) => `${k}: ${v} !important;`)
    .join('\n  ');
  return `${selector} {\n  ${declarations}\n}`;
}

/**
 * 完整暗色模式 CSS = token 覆盖 + 元素级覆盖。
 * 一次性生成所有暗色样式，供 adapter.mjs 直接注入。
 *
 * @returns {string} 完整暗色 CSS 字符串
 */
export function getFullDarkModeCss() {
  const tokens = getDarkModeTokenOverrides();
  const tokenCss = tokensToCss(tokens);
  const elementCss = getDarkModeElementOverrides();
  return [tokenCss, elementCss].join('\n');
}
