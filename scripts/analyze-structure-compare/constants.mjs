// SPDX-License-Identifier: MPL-2.0

/**
 * # 结构对拍 — 常量与配置
 */

/** 运行时类名按出现频次保留的数量 */
export const RUNTIME_CLASS_CAP = 1000;
/** 运行时 :root 变量保留数量 */
export const RUNTIME_VAR_CAP = 2000;
/** 最多扫描的 renderer JS 文件数 */
export const STATIC_JS_FILE_CAP = 40;
/** 单个 JS 文件最多读取的字节 */
export const STATIC_BYTES_PER_FILE = 1_500_000;
/** 全部 CSS 最多读取的字节 */
export const STATIC_CSS_BYTES_TOTAL = 8_000_000;
/** 每个 diff 类别在报告里展示的数量 */
export const DIFF_LIST_CAP = 25;

/**
 * closed shadow root 无法被 JS 枚举（`el.shadowRoot` 恒为 `null`），只能靠规则库的
 * `shadowDomRiskSelectors` 已知风险选择器做启发式检测。这里的「种子」是规则库的初始候选：
 *   - 命中元素且该元素无 open shadowRoot → 判定为 closed shadow 盲区（主题注入无法穿透）。
 *   - 仅当对应组件在目标应用里**实际挂载**时才产生命中，不会凭空误报；种子本身不代表已确认。
 *
 * `COMMON` 为跨 Agent 固定种子：Chromium 原生 closed-shadow 宿主（UA shadow / 内置绘制控件），
 * 主题 CSS 无法穿透其内部，是稳定的注入盲区提示。
 */
export const SHADOW_RISK_SELECTORS_COMMON = [
  // Chromium 原生 closed shadow 宿主：UA shadow 内置绘制，注入无法穿透。
  'input[type="range"]',
  'input[type="color"]',
  'input[type="file"]',
  'input[type="date"]',
  'input[type="time"]',
  'input[type="datetime-local"]',
  'input[type="month"]',
  'input[type="week"]',
  'video',
  'audio',
  'select',
];

/** 各 Agent closed shadow 规则库种子候选。无实据的异常分支留空，避免无依据的猜测误报。 */
export const SHADOW_RISK_SELECTORS_BY_AGENT = {
  codex: [], // 渲染为 open DOM；已知编辑器/预览面并入 COMMON 原生宿主即可覆盖
  doubao: [], // 文档/视频等复杂内容走 OOPIF iframe，由 frame 聚合（enumerateTargets）覆盖，不在主 frame 内探测
  qoderwork: [],
  traework: [],
  workbuddy: [],
  zcode: [],
};

/** 通用兜底规则：完全未知 Agent 加载；不携带任何指纹，全靠运行时探测驱动。 */
export const FALLBACK_RULE = {
  agentId: 'fallback.generic',
  schemaVer: '1.3',
  themePersistCandidates: [
    { type: 'dataset', key: 'data-theme' },
    { type: 'localStorage', key: 'theme' },
    { type: 'localStorage', key: 'theme-mode' },
  ],
  globalApiCandidates: [],
  globalStorePathCandidates: [],
  lazyRiskComponents: ['Modal', 'Dropdown', 'Popover'],
  shadowDomRiskSelectors: [],
  themeImplMode: 'mixed',
  canSilentSwitch: false,
  switchSideEffects: [],
  lightFingerprint: { dataset: null, cssVars: {} },
  darkFingerprint: { dataset: null, cssVars: {} },
};

export const RULE_THEME_KEY_RE = /theme|dark|light|scheme|appearance|color-mode/i;
export const RULE_FINGERPRINT_VAR_RE =
  /bg|background|surface|canvas|panel|card|text|foreground|primary|accent|brand|link|border|divider|fill/i;
// 指纹只收「颜色语义」变量；值里出现尺寸/间距单位或 --spacing 引用的视为布局变量，跳过
export const RULE_DIMENSION_VALUE_RE = /\d+(px|rem|em|vh|vw|%)|var\(--spac/i;

// 噪声启发式（仅用于「建议」，不自动生效；跨 Agent / 高频阈值兜底降低误报）
export const IGNORE_UTILITY_RE = new RegExp(
  '^(hover|focus|focus-visible|focus-within|active|disabled|enabled|checked|selected|default|required|invalid|' +
    'visited|link|first|last|only|odd|even|group|group-hover|peer|peer-hover|marker|selection|placeholder|backdrop|' +
    'before|after|data-\\[[^\\]]*\\]|aria-\\[[^\\]]*\\]|\\[[^\\]]*\\]):',
);
export const IGNORE_CLASS_RE = new RegExp(
  '^(flex|flex-1|flex-auto|flex-none|flex-initial|flex-col|flex-row|flex-wrap|flex-nowrap|block|inline|inline-block|' +
    'inline-flex|table|table-row|table-cell|items-|justify-|content-|place-|self-|order-|basis-|grow|shrink|' +
    'px-|py-|pt-|pr-|pb-|pl-|ps-|pe-|mx-|my-|mt-|mr-|mb-|ml-|ms-|me-|p-|m-|' +
    'w-|h-|min-w-|max-w-|min-h-|max-h-|size-|gap-|gap-x-|gap-y-|space-x-|space-y-|' +
    'rounded|text-|bg-|border|opacity-|overflow-|whitespace-|select-|cursor-|' +
    'relative|absolute|fixed|sticky|static|top-|bottom-|left-|right-|inset-|z-|' +
    'leading-|font-|shadow|ring-|outline-|divide-|grid|grid-cols-|col-span-|row-span-|row-start-|col-start-|' +
    'truncate|sr-only|pointer-events-|object-|aspect-|break-|list-|' +
    'italic|underline|overline|line-through|uppercase|lowercase|capitalize|normal-case|antialiased|' +
    'visible|invisible|collapse|tracking-|decoration-|caret-|accent-|appearance-|will-change-|resize-|' +
    'transition-|duration-|ease-|delay-|animate-|scale-|rotate-|translate-|skew-|origin-|transform|backdrop-|' +
    'fill-|stroke-|scroll-|snap-|columns-)',
);
export const IGNORE_VAR_RE = new RegExp(
  '^--(tw-|color-|background|border|shadow|ring-|opacity|transition|duration|ease-|delay-|animate-|font|text-|' +
    'spacing|gap-|padding|margin|radius|z-index|transform|scale-|translate-|rotate-|blur|saturate|contrast|' +
    'backdrop|outline|inset-)',
);
export const IGNORE_HASH_RE = /_[A-Za-z0-9]{6,}/; // CSS Modules 哈希（类名 / 变量通用）
