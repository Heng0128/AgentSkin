// SPDX-License-Identifier: MPL-2.0

/**
 * semantic-quant/taxonomy.mjs — 语义量化层：标准枚举字典 + 组件索引（单一数据源）
 *
 * 本模块是 RFC 2026-08-17-semantic-quant-layer 的 Phase 1 核心数据文件。
 * 约束（自动化强制，见 scripts/check-semantic-contract.mjs）：
 *   - `selectivity-registry.mjs` 禁止增加本模块定义的语义字段（key 白名单）；
 *   - 枚举值禁止在 Phase 1 业务代码中使用（FUTURE_RESERVED_* 守卫）；
 *   - bindings 在 Phase 1 禁止非空（N:M 例外未出现前不得手写）。
 *
 * 版本号语义：TAXONOMY_SCHEMA_VERSION 仅在字段增删改时手动递增，
 * 与 engine package.json 的 version 完全独立、不联动。
 */

/**
 * @typedef {"shell"|"sidebar"|"main-content"|"composer"|"top-nav"|"overlay"|"status-bar"|"toast-layer"|"global-overlay"} UiArea
 * @typedef {"container"|"input"|"button"|"dropdown"|"card"|"text"|"icon"|"divider"|"mask"|"scrollbar"|"list-item"} ComponentKind
 * @typedef {"global"|"page"|"component"|"decoration"|"state"} ComponentLayer
 * @typedef {"high"|"medium"|"low"} RiskLevel
 */

/**
 * 数据结构版本号。
 * 变更历史：
 *   1 — 初始版本（Phase 1）
 */
export const TAXONOMY_SCHEMA_VERSION = 1;

/**
 * UI 区域枚举。
 * Phase 1 已用：shell / sidebar / main-content / composer / top-nav
 * Phase 2 预留：overlay / status-bar / toast-layer / global-overlay
 */
export const UI_AREA = Object.freeze({
  /** ✅ Phase1 已用：应用外壳 */
  SHELL: 'shell',
  /** ✅ Phase1 已用：侧边栏 */
  SIDEBAR: 'sidebar',
  /** ✅ Phase1 已用：主内容区 */
  MAIN_CONTENT: 'main-content',
  /** ✅ Phase1 已用：输入区 */
  COMPOSER: 'composer',
  /** ✅ Phase1 已用：顶部导航 */
  TOP_NAV: 'top-nav',
  /**
   * 📋 Phase2 预留：弹窗浮层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  OVERLAY: 'overlay',
  /**
   * 📋 Phase2 预留：底部状态栏
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  STATUS_BAR: 'status-bar',
  /**
   * 📋 Phase2 预留：消息提示层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  TOAST_LAYER: 'toast-layer',
  /**
   * 📋 Phase2 预留：全局蒙层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  GLOBAL_OVERLAY: 'global-overlay',
});

/**
 * 组件功能分类枚举。
 * Phase 1 已用：container / input / list-item
 * Phase 2 预留：button / dropdown / card / text / icon / divider / mask / scrollbar
 */
export const COMPONENT_KIND = Object.freeze({
  /** ✅ Phase1 已用：容器类 */
  CONTAINER: 'container',
  /** ✅ Phase1 已用：输入类 */
  INPUT: 'input',
  /** ✅ Phase1 已用：列表项 */
  LIST_ITEM: 'list-item',
  /**
   * 📋 Phase2 预留：按钮
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  BUTTON: 'button',
  /**
   * 📋 Phase2 预留：下拉菜单
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  DROPDOWN: 'dropdown',
  /**
   * 📋 Phase2 预留：卡片
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  CARD: 'card',
  /**
   * 📋 Phase2 预留：文本
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  TEXT: 'text',
  /**
   * 📋 Phase2 预留：图标
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  ICON: 'icon',
  /**
   * 📋 Phase2 预留：分隔线
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  DIVIDER: 'divider',
  /**
   * 📋 Phase2 预留：遮罩
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  MASK: 'mask',
  /**
   * 📋 Phase2 预留：滚动条
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  SCROLLBAR: 'scrollbar',
});

/**
 * 视觉层级权重枚举。
 * Phase 1 已用：page / component
 * Phase 2 预留：global / decoration / state
 */
export const COMPONENT_LAYER = Object.freeze({
  /** ✅ Phase1 已用：页面容器层 */
  PAGE: 'page',
  /** ✅ Phase1 已用：功能组件层 */
  COMPONENT: 'component',
  /**
   * 📋 Phase2 预留：全局层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  GLOBAL: 'global',
  /**
   * 📋 Phase2 预留：装饰层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  DECORATION: 'decoration',
  /**
   * 📋 Phase2 预留：状态交互层
   * @future Reserved for Phase2 Theme-Studio — Phase1 业务代码禁止使用
   */
  STATE: 'state',
});

/**
 * 遗漏风险等级枚举。
 *
 * 分级为人工 curate 元数据（依据 docs/reports/semantic-quant-review-2026-08-17.md §6）：
 * 依据"改漏后的视觉破坏度 + 采样阻断性"粗分，非程序自动计算。
 */
export const RISK_LEVEL = Object.freeze({
  /** 高风险：缺失即视觉严重破损或阻塞预检（如 root） */
  HIGH: 'high',
  /** 中风险：可见但破坏度可控 */
  MEDIUM: 'medium',
  /** 低风险：装饰性、改漏影响小 */
  LOW: 'low',
});

/**
 * 组件索引（COMPONENT_INDEX）— 语义层主表。
 *
 * key = componentId（稳定标识，跟随 UI 业务语义概念，不跟随 DOM 结构；
 * 发布即稳定，改名走 DEPRECATED_ALIASES 弃用流程，见 semantic-resolve.mjs）。
 *
 * bindings：仅用于真实 N:M 跨 agent 映射例外（一个逻辑组件跨多个 registry
 * 语义名、或一个语义名拆多个组件）。Phase 1 derive-by-default 自动映射，
 * bindings 保持空数组——check-semantic-contract.mjs 强制此约束。
 *
 * @type {Record<string, {
 *   uiArea: UiArea;
 *   componentKind: ComponentKind;
 *   componentLayer: ComponentLayer;
 *   riskLevel: RiskLevel;
 *   bindings: Array<{ agentId: string; semanticName: string }>;
 * }>}
 */
export const COMPONENT_INDEX = Object.freeze({
  root: {
    uiArea: 'shell',
    componentKind: 'container',
    componentLayer: 'page',
    riskLevel: 'high',
    bindings: [],
  },
  sidebar: {
    uiArea: 'sidebar',
    componentKind: 'container',
    componentLayer: 'page',
    riskLevel: 'high',
    bindings: [],
  },
  workspace: {
    uiArea: 'main-content',
    componentKind: 'container',
    componentLayer: 'page',
    riskLevel: 'medium',
    bindings: [],
  },
  composer: {
    uiArea: 'composer',
    componentKind: 'input',
    componentLayer: 'component',
    riskLevel: 'high',
    bindings: [],
  },
  toolbar: {
    uiArea: 'top-nav',
    componentKind: 'container',
    componentLayer: 'page',
    riskLevel: 'medium',
    bindings: [],
  },
  'message-list': {
    uiArea: 'main-content',
    componentKind: 'container',
    componentLayer: 'component',
    riskLevel: 'high',
    bindings: [],
  },
});

/**
 * componentId → registry 语义名 的显式映射（derive-by-default 的派生依据）。
 *
 * 绝大多数为同名；`message-list`（kebab-case）→ registry 语义名 `messageList`
 * （registry 历史命名，保持不动）。本表是"componentId 集合"的权威来源，
 * check-semantic-contract.mjs 据此做双向一致性校验。
 */
export const COMPONENT_ID_TO_SEMANTIC_NAME = Object.freeze({
  root: 'root',
  sidebar: 'sidebar',
  workspace: 'workspace',
  composer: 'composer',
  toolbar: 'toolbar',
  'message-list': 'messageList',
});

/**
 * registry 语义名 → componentId 的反向映射（由 COMPONENT_ID_TO_SEMANTIC_NAME 派生，
 * 供 verify-style 采样 key 映射使用）。勿手动维护。
 */
export const SEMANTIC_NAME_TO_COMPONENT_ID = Object.freeze(
  Object.fromEntries(
    Object.entries(COMPONENT_ID_TO_SEMANTIC_NAME).map(([componentId, semanticName]) => [semanticName, componentId]),
  ),
);

/**
 * 弃用 componentId 注册表。
 * 格式：{ 旧 componentId: { deprecatedAt: <TAXONOMY_SCHEMA_VERSION>, replacedBy: 新 componentId } }
 * Phase 1 为空表；未来改名时填写并同步升级 schema 版本。
 */
export const DEPRECATED_ALIASES = Object.freeze({});

/**
 * Phase 2 预留枚举值集合（FUTURE_RESERVED_*）。
 *
 * 单一数据源在本文件——check-semantic-contract.mjs 导入本表做
 * "Phase 1 代码禁止使用预留枚举"守卫（禁止把成员名硬编码进 lint 规则）。
 * 未来增删预留值：改本文件即可，守卫自动跟随。
 */
export const FUTURE_RESERVED_UI_AREA = Object.freeze([
  UI_AREA.OVERLAY,
  UI_AREA.STATUS_BAR,
  UI_AREA.TOAST_LAYER,
  UI_AREA.GLOBAL_OVERLAY,
]);

export const FUTURE_RESERVED_COMPONENT_KIND = Object.freeze([
  COMPONENT_KIND.BUTTON,
  COMPONENT_KIND.DROPDOWN,
  COMPONENT_KIND.CARD,
  COMPONENT_KIND.TEXT,
  COMPONENT_KIND.ICON,
  COMPONENT_KIND.DIVIDER,
  COMPONENT_KIND.MASK,
  COMPONENT_KIND.SCROLLBAR,
]);

export const FUTURE_RESERVED_COMPONENT_LAYER = Object.freeze([
  COMPONENT_LAYER.GLOBAL,
  COMPONENT_LAYER.DECORATION,
  COMPONENT_LAYER.STATE,
]);

/**
 * 全部预留值的扁平集合（守卫扫描用）。
 */
export const FUTURE_RESERVED_VALUES = Object.freeze([
  ...FUTURE_RESERVED_UI_AREA,
  ...FUTURE_RESERVED_COMPONENT_KIND,
  ...FUTURE_RESERVED_COMPONENT_LAYER,
]);
