# 接入新的 AI 应用适配器

本文档描述如何为 AgentSkin 接入一款新的 AI 应用适配器（adapter），使其能够通过 CDP 注入获得主题与视觉定制能力。

---

## 什么是 AdapterConfig

`adapter-config.mjs` 是适配器的**配置层**，导出一个符合 `AdapterConfig` 接口的对象，通过 `window.__agentskin_{agentId}_config__` 暴露给共享引擎。配置对象由 `engines/shared/adapter-engine.mjs` 中的 `createAdapter(config)` 工厂消费，负责整个适配器生命周期（sheet 注入、自愈、DeepCore 引导等）。

### AdapterConfig 字段一览

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `agentId` | `string` | 是 | 适配器唯一标识，须与目录名一致 |
| `hostClass` | `string` | 是 | 注入到 `document.documentElement` 的 CSS 类名，所有 CSS 规则须以此为作用域 |
| `marker` | `string` | 是 | 幂等守卫的 `window` 键名，防止重复注入 |
| `selectors` | `object` | 是 | 选择器映射，须包含 `rootContainer` 和至少一个 `route:*` 键 |
| `structuralCss` | `string` | 是 | 核心 CSS 字符串，包含透明化、毛玻璃、装饰层等样式 |
| `tokenConfig` | `object` | 否 | Token 发现配置：`knownPrefixes`、`outputSelector`、`categoryPatterns` 等 |
| `deepConfig` | `object` | 否 | DeepCore 配置：`shadowMode`、`routes`、`fragments`、`enabled` |
| `intervals` | `object` | 否 | 生命周期间隔：`selfHeal` (2000)、`sheetGuard` (1500)、`reinjectDebounce` (100)、`progressiveRetry` (2000) |
| `applyHeuristicOverride` | `function` | 否 | 逐元素启发式样式回调（在 DOM 突变时调用） |
| `dynamicCss` | `function\|string` | 否 | 动态 CSS 生成器（每次 reinject 时重新计算） |
| `onReinject` | `function` | 否 | reinject 生命周期钩子 |
| `onHealthCheck` | `function` | 否 | 健康检查回调，接收 report 对象 |
| `onRouteDetected` | `function` | 否 | 路由变化回调（仅在 selectors 含 `route:*` 时触发） |
| `injection` | `string` | 否 | 注入策略：`'adopted'` (默认) 或 `'style-element'` |
| `cspFallback` | `boolean` | 否 | 是否启用 CSP 降级链（codex 使用） |

---

## 接入步骤

### Step 1：创建目录

在 `engines/{agentId}/` 下创建适配器目录。`agentId` 须为 lowercase kebab-case。

```
engines/{agentId}/
  ├── adapter-config.mjs   ← 配置 + 所有应用特定逻辑
  ├── adapter.mjs          ← 薄包装器（调用共享引擎）
  ├── tokens.css           ← engine-strategy 的 token 覆盖
  └── cosmetic.css         ← 视觉微调 CSS
```

### Step 2：编写 `adapter-config.mjs`

参考 `engines/zcode/adapter-config.mjs`（最简模板）。最简配置须包含：

```js
(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-{agentId}';
  const MARKER = '__agentskin_{agentId}_adapter__';

  const SELECTORS = {
    rootContainer: '#root',  // 应用的根容器选择器
    'route:default': '#root',
  };

  const STRUCTURAL_CSS = `
html.${HOST_CLASS} body {
  color: var(--agentskin-text) !important;
  background: transparent !important;
}
html.${HOST_CLASS} body::before {
  content: '' !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  pointer-events: none !important;
  background: var(--agentskin-art, none) cover no-repeat !important;
}
`;

  window.__agentskin_{agentId}_config__ = {
    agentId: '{agentId}',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    structuralCss: STRUCTURAL_CSS,
    intervals: { selfHeal: 2000, sheetGuard: 1500, reinjectDebounce: 100, progressiveRetry: 2000 },
  };
})();
```

**关键约定：**

1. 配置对象必须挂载到 `window.__agentskin_{agentId}_config__`，以便 `adapter.mjs` 从全局读取。
2. CSS 规则必须锚定在 `html.{hostClass}` 作用域下，防止泄漏到其他应用的 DOM。
3. 所有 `!important` 声明需谨慎使用，仅在覆盖宿主硬编码内联样式时使用。

### Step 3：编写 `adapter.mjs`（薄包装器）

```js
(() => {
  'use strict';

  const MARKER = '__agentskin_{agentId}_adapter__';
  if (window[MARKER]) return 'already-applied';

  const engine = window.__agentskin_shared_engine__;
  if (!engine || typeof engine.createAdapter !== 'function') {
    console.warn('[AgentSkin] {agentId}-adapter: shared engine not loaded');
    return 'no-engine';
  }

  const config = window.__agentskin_{agentId}_config__;
  if (!config) return 'no-config';

  try { window.__agentskin_sheet_manager__?.install?.(); } catch {}

  const adapter = engine.createAdapter(config);
  adapter.apply();
  return 'applied';
})();
```

### Step 4：放置主题 CSS 层

- `tokens.css`：覆盖应用中与 engine-strategy 主题 layer 相关的设计 token。
- `cosmetic.css`：额外的视觉微调（滚动条、字体、间距修正等）。

两个文件由 orchestrator 读取并注入，不需要手动 import。

### Step 5：在 orchestrator 注册拼接顺序

`src/main/palette/orchestrator.ts` 负责将共享引擎运行时 + adapter-config + adapter.mjs 拼接为单一 JS 表达式。拼接顺序为：

```
shared modules (按固定顺序):
  adapter-engine → style-injector → token-discovery → self-heal → deep-core → visual-engine → verify

per-agent (按以下顺序):
  adapter-config.mjs  ← 可选（有则拼接）
  adapter.mjs         ← 始终拼接
```

新适配器无需修改 orchestrator.ts —— 只要文件存在于 `engines/{agentId}/` 目录且文件名符合约定，拼接是自动的。但需要确保 `adapter-config.mjs` 在 `adapter.mjs` 之前执行（框架已保证）。

### Step 6：运行校验

```bash
node scripts/validate-adapter.mjs {agentId}
npm run check
```

两条命令均须通过。

---

## 特殊场景速查表

| 场景 | 使用适配器 | 说明 |
|------|-----------|------|
| CSP 降级链 | `codex` | 配置 `cspFallback: true` + `injection: 'adopted'`，在 `onReinject` 中实现 adopt → style-element → insertRule 三级降级 |
| 暗色模式重映射 | `doubao` | 使用 `darkTokenRemap` 对象将 80+ 宿主 `--dbx-*` / `--s-color-*` 变量映射到 `--agentskin-*` |
| BG Observer | `doubao` | 通过 `dynamicCss` 回调持续检测宿主 `body` 的 `style` 属性并透明化处理 |
| SW 缓存击穿防护 | `workbuddy` | 在 config IIFE 顶部调用 `initSWProtection()`（清理 Workbox 缓存 + 拦截 SW 注册 + 监听 `controllerchange`） |
| localStorage 主题感知 | `workbuddy` | 通过 `initThemeStorageAwareness()` 包装 `localStorage.setItem`，主题变化时触发 `__agentskin_workbuddy_force_reinject()` |
| style-element 注入 | `traework` | 设置 `injection: 'style-element'`，绕过 `adoptedStyleSheets`（某些 Electron 版本不支持） |
| 几何检测（无稳定选择器） | `zcode`, `workbuddy`, `doubao` | 在 `applyHeuristicOverride` 中通过 `getBoundingClientRect()` DOM 几何探测侧边栏/输入容器 |

---

## 参考适配器复杂度分级

| 适配器 | adapter.mjs 行数 | adapter-config.mjs 行数 | 复杂度 | 参考场景 |
|--------|-----------------|------------------------|--------|---------|
| zcode | ~60 | ~380 | 低 | 最简模板，config-driven |
| codex | ~60 | ~470 | 中 | CSP 降级链 |
| qoderwork | ~60 | ~400 | 低 | 标准 IIFE |
| workbuddy | ~60 | ~460 | 中 | SW 防护 + localStorage 感知 |
| doubao | ~60 | ~810 | 高 | 暗色重映射 + BG Observer + 几何检测 |
| traework | ~490 | 无 adapter-config | 中 | 传统 IIFE，内嵌全部逻辑 |

---

## FAQ：常见陷阱

**Q: 选择器优先级不够，样式被宿主覆盖怎么办？**
A: 所有 CSS 规则须锚定在 `html.{hostClass}` 下。如果仍被覆盖，检查宿主的 `!important` 内联样式，用 `applyHeuristicOverride` 钩子逐元素清除。

**Q: Token 映射不生效？**
A: 检查 `tokenConfig.outputSelector` 是否与 `hostClass` 匹配，确认 `knownPrefixes` 包含宿主的前缀。`--agentskin-*` 由 engine-strategy 管理，adapter 不应覆盖。

**Q: CSP 阻塞了 adoptedStyleSheets？**
A: 配置 `cspFallback: true` + `injection: 'adopted'`，共用 codex 的三级降级：adoptedStyleSheets → style 元素 → insertRule。监听 `securitypolicyviolation` 事件自动降级。

**Q: 宿主 SW 覆盖了注入的样式？**
A: 参考 workbuddy 的 `initSWProtection()`：清理 Workbox 缓存 + 拦截 `navigator.serviceWorker.register` + 监听 `controllerchange` 事件触发 reinject。

**Q: adapter.mjs 应该有多大？**
A: 使用共享引擎后，adapter.mjs 应控制在 150 行以内（理想 60-80 行）。所有应用特定逻辑移入 `adapter-config.mjs`。超过 200 行说明未能充分利用共享引擎抽象。

**Q: 新增适配器是否需要 RFC？**
A: 是。按 AGENTS.md 第 7 条黄金规则 #1，新增适配器须 RFC 评审（除非用户基数大且目标应用无原生主题能力）。将 RFC 提交到 `docs/rfc/` 目录。
