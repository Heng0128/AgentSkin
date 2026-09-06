// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-full-extract — 常量与配置
 */

// ============== 配置 ==============

export const DEFAULT_MAX_DOM_NODES = 2000;
export const DEFAULT_MAX_DEPTH = 24;
export const THEME_SWITCH_WAIT = 600; // ms to wait after theme switch

// ============== per-Agent 时序配置表（审计 A-11 / R-21） ==============

export const DEFAULT_TIMING = {
  themeSwitchWait: 600, // 主题切换后等待重渲染
  connectTimeout: 8000, // WS 连接超时
  commandTimeout: 10000, // 单条 CDP 命令超时
  evalTimeout: 15000, // Runtime.evaluate 超时
  retry: 1, // 连接失败重试次数
};

export const AGENT_TIMING = {
  traework: { themeSwitchWait: 700, commandTimeout: 12000 },
  doubao: { themeSwitchWait: 800, evalTimeout: 18000 },
  codex: { retry: 2 },
  qoderwork: {},
  workbuddy: {},
  zcode: {},
};

/** 解析某 Agent 的时序参数 = DEFAULT_TIMING ⊳ AGENT_TIMING[agentId]。 */
export function resolveAgentTiming(agentId) {
  return { ...DEFAULT_TIMING, ...(AGENT_TIMING[agentId] ?? {}) };
}

// ============== 采样样式属性表 ==============

export const ORDERED_STYLE_PROPS = [
  // 颜色类
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'column-rule-color',
  'fill',
  'stroke',
  // 背景类
  'background-image',
  'background-position',
  'background-size',
  'background-repeat',
  // 字体类
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-variant',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'text-indent',
  // 间距类
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  // 边框/圆角
  'border-width',
  'border-style',
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  // 阴影
  'box-shadow',
  'text-shadow',
  // 尺寸
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  // 布局
  'display',
  'position',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'grid-template-columns',
  'grid-template-rows',
  // 透明度/混合
  'opacity',
  'mix-blend-mode',
  'isolation',
  // 滤镜
  'filter',
  'backdrop-filter',
  // 变换/动效
  'transform',
  'transition',
  'transition-duration',
  'transition-timing-function',
  'animation',
  'animation-duration',
  // 溢出/滚动
  'overflow',
  'overflow-x',
  'overflow-y',
  // 光标/指针
  'cursor',
  'pointer-events',
  'user-select',
  // 裁剪
  'clip-path',
  'mask',
  'mask-image',
  // 表格
  'border-collapse',
  'border-spacing',
  // 列表
  'list-style',
  'list-style-type',
];

// ============== per-Agent 变量命名空间白名单（审计 A-17） ==============

export const AGENT_VAR_NAMESPACES = {
  codex: ['--text-', '--bg-', '--border-'],
  vscode: ['--vscode-'],
  workbuddy: ['--wb-'],
  zcode: ['--cv-', '--zcode-'],
  qoderwork: ['--vs-', '--vscode-'],
  doubao: ['--dbx-', '--db-'],
  traework: ['--tw-'],
};
export const AGENT_VAR_NAMESPACE_DEFAULT = ['--'];

export function isAgentVar(name, agentName) {
  const prefixes = AGENT_VAR_NAMESPACES[agentName] ?? AGENT_VAR_NAMESPACE_DEFAULT;
  return prefixes.some((p) => name.startsWith(p));
}
