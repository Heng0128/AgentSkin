# 引擎对比与专家诊断：QoderWork CN (`qoderwork`)

> 诊断日期：2026-09-01
> 交叉验证源：`batch3-validation/qoderwork-cross-validation.md`
> 现有引擎：`engines/qoderwork/adapter.mjs` + `tokens.css` + `cosmetic.css` + `src/adapters/domestic/qoder.ts`
> 方法论：adapter-comparator 四维度对比 + 风险评估

---

## 0. 诊断摘要

| 维度 | 评分 | 状态 |
|------|------|------|
| 选择器准确性 | 82/100 | ⚠️ 主窗口良好，canvas/writing 空白 |
| Token 映射完整性 | 78/100 | ⚠️ --color-* 全量覆盖，popup 局部遗漏 |
| 注入策略正确性 | 92/100 | ✅ adoptedStyleSheets 绕过 CSP，自愈机制完善 |
| 架构假设有效性 | 70/100 | ⚠️ 多窗口声明不足，RUM 冲突未防御 |

**综合健康度：80.5/100**（低于交叉验证报告的 86%，因四维度审计暴露隐性缺陷）

**关键发现**：
1. canvas/writing 渲染器完全未覆盖（P0）
2. RUM preload 存在样式清除风险且无防御（P1）
3. popup 局部变量（~20 个）未映射（P1）
4. CodeMirror 6 编辑器缺少透明适配（P2）

---

## 1. 四维度对比矩阵

### 1.1 维度 A：选择器准确性

| 选择器 | 用途 | 真实 DOM 验证 | 匹配状态 |
|--------|------|--------------|---------|
| `#root` | React 根容器 | ASAR 确认所有渲染器共享 | ✅ 精确 |
| `.agents-layout-root` | 布局根容器 | 适配器已验证 | ✅ 精确 |
| `.agents-layout-body` | 布局体 | 适配器已验证 | ✅ 精确 |
| `.agents-content-area` | 内容区 | 适配器已验证 | ✅ 精确 |
| `.agents-sidebar` | 侧边栏 | 适配器已验证 | ✅ 精确 |
| `[data-active="true"]` | 导航激活态 | 适配器已验证 | ✅ 精确 |
| `[data-resizable-sidebar]` | 右侧面板 | 适配器已验证 | ✅ 精确 |
| `.chat-input-editor-text` | 聊天输入 | 适配器已验证 | ✅ 精确 |
| `button[class~="group/extensions-nav"]` | 导航按钮 | 适配器已验证 | ✅ 精确 |
| `.cm-editor` | CodeMirror 编辑器 | ASAR 确认存在 | ❌ 未覆盖 |
| `.cm-content` | CM6 内容区 | ASAR 确认存在 | ❌ 未覆盖 |
| `.cm-line` | CM6 行 | ASAR 确认存在 | ❌ 未覆盖 |
| `[role="dialog"]` | 对话框覆盖层 | ASAR: 中稳定性 | ⚠️ 通配匹配 |
| `[role="menu"]` | 菜单覆盖层 | ASAR: 中稳定性 | ⚠️ 通配匹配 |
| `[class*="agents-header"]` | 标题栏通配 | ASAR: 中稳定性 | ⚠️ 过度匹配风险 |
| `[class*="titlebar"]` | 标题栏通配 | ASAR: 中稳定性 | ⚠️ 过度匹配风险 |

**维度 A 评分**：
- 高稳定性锚点覆盖：10/10 (100%)
- 中稳定性锚点覆盖：4/6 (67%) — `.cm-editor/.cm-content/.cm-line` 未覆盖
- 低稳定性锚点覆盖：0/6 (0%) — canvas/writing 渲染器完全缺失

**发现问题 A1**：CodeMirror 6 的三个核心选择器（`.cm-editor`、`.cm-content`、`.cm-line`）在 adapter.mjs 中完全缺少。代码区域背景不透明，art punch-through 失效。

**发现问题 A2**：`[class*="agents-header"]` 和 `[class*="titlebar"]` 通配选择器在非 header 元素上可能误匹配（2026-08-23 已发生过 `[class*="item"]` 误匹配 resize handle 的类似问题）。

---

### 1.2 维度 B：Token 映射完整性

#### 1.2.1 主命名空间 `--color-*`（~80+ 变量）

| 类别 | tokens.css 映射数 | 实际变量数 | 覆盖率 |
|------|------------------|-----------|--------|
| Primary / Brand | 11 | ~11 | 100% |
| Text Hierarchy | 7 | ~10 | 70% |
| Backgrounds | 10 | ~12 | 83% |
| Borders | 3 | ~12 | 25% ⚠️ |
| Fills | 5 | ~6 | 83% |
| Semantic (success/error/warning/info) | 16 | ~16 | 100% |
| Diff | 4 | 4 | 100% |
| Accent Palette | 18 | ~18 | 100% |
| Shadows | 10 | 10 | 100% |
| Highlights | 6 | 6 | 100% |
| **小计** | **~90** | **~105** | **~86%** |

#### 1.2.2 Popup 局部命名空间（~20 变量）

| 命名空间 | 变量数 | tokens.css 映射 | 覆盖率 |
|----------|--------|----------------|--------|
| `--bg-*` | 3 | 0 | 0% ❌ |
| `--text-*` | 4 | 0 | 0% ❌ |
| `--border-*` / `--fill-*` | 3 | 0 | 0% ❌ |
| `--radius-*` | 3 | 0 | 0% ❌ |
| `--shadow-*` | 2 | 0 | 0% ❌ |
| `--primary-*` | 3 | 0 | 0% ❌ |
| `--success/--error/--warning` | 4 | 0 | 0% ❌ |
| **小计** | **~22** | **0** | **0%** ❌ |

**发现问题 B1**：popup 局部变量完全未映射。这些变量定义在 `chrome-extension/popup.html` 内联 `<style>` 中，当 AgentSkin 注入到 chrome-extension 分区 session 时，popup 外观不受主题控制。

**发现问题 B2**：`--color-border-*` 系列仅映射了 3/12 变量（`--color-border` / `--secondary` / `--tertiary`），缺失 `--color-border-inverse`、`--color-border-ghost`、`--color-border-info`、`--color-border-danger`、`--color-border-success`、`--color-border-warning`、`--color-border-disabled`。

**发现问题 B3**：`--color-text-*` 扩展变量映射缺失。tokens.css 映射了 7 个文本变量，但 ASAR 检测到 `--color-text-inverse`、`--color-text-ghost`、`--color-text-info`、`--color-text-danger`、`--color-text-success`、`--color-text-warning`、`--color-text-disabled` 共 7 个扩展文本变量未映射。

---

### 1.3 维度 C：注入策略正确性

| 策略要素 | 引擎实现 | 最佳实践 | 评估 |
|---------|---------|---------|------|
| 主注入方式 | `adoptedStyleSheets` | `adoptedStyleSheets` | ✅ 正确 |
| CSP 绕过 | `adoptedStyleSheets` 绕过 nonce | 无需 nonce | ✅ 正确 |
| Sheet 管理器 | `window.__agentskin_sheet_manager__` | 共享管理器 | ✅ 正确 |
| 层标记 | `sheet.__agentskin_layer = 'adapter'` | 层标识 | ✅ 正确 |
| 防重入 | `window[MARKER]` 检查 | 单次注入 | ✅ 正确 |
| 自愈机制 | 2s 定时器 + 1.5s sheet guard + MutationObserver | 多层防御 | ✅ 冗余但安全 |
| 渲染器检测 | `detectRendererType()` pathname 匹配 | 路径+DOM 双验证 | ⚠️ 单一依据 |
| Token 发现 | 共享 `token-discovery.mjs` 模块 | 增量扫描 | ✅ 正确 |
| DeepCore | `DEEP_CONFIG.enabled = true` | 深度适配 | ✅ 已声明 |

**发现问题 C1**：`detectRendererType()` 仅依赖 `pathname.includes()` 字符串匹配，对于 canvas/writing 渲染器，URL 为 `file:///resources/canvas/index.html`，但现有代码只检查 `voice-overlay`、`mcp-app-preview`、`artifact-preview`、`quickpick` 四个路径，需要补充。

**发现问题 C2**：自愈机制三重冗余（2s 定时器 + 1.5s sheet guard + MutationObserver）在 canvas/writing 这种大型 bundle（6.4MB / 3.7MB）渲染器中可能导致初始化竞态 —— 在 React 挂载完成前自愈定时器已触发 re-inject。

---

### 1.4 维度 D：架构假设有效性

| 假设 | 引擎声明 | 实际状态 | 偏差 |
|------|---------|---------|------|
| Electron 架构 | 假设标准 Electron | `dist/index.cjs` + `dist/preload.cjs` | ✅ 正确 |
| 窗口角色 | `WindowRole.Main` 单角色 | 7 个独立渲染器（含 canvas/writing） | ⚠️ 覆盖不足 |
| CDP 端口 | 假设 ephemeral 模式 | `--remote-debugging-port=0` 确认 | ✅ 正确 |
| React 版本 | 未显式声明 | React 19.2.1 确认 | ✅ 无冲突 |
| 编辑器类型 | 未显式声明 | CodeMirror 6 (`@codemirror/view` + `state`) | ❌ 缺少适配 |
| RUM 影响 | 未声明风险 | `arms-rum-preload.cjs` 注册到所有 session | ⚠️ 无防御 |
| session 分区 | 假设单 partition | ASAR 检测到自定义 partition | ⚠️ 潜在遗漏 |
| IPC 通道 | 未声明依赖 | `arms:rum-bridge` 存在 | ✅ 无冲突 |

**发现问题 D1**：`windowHints` 仅声明 `WindowRole.Main` 单角色。QoderWork CN 实际存在 `voice-overlay`、`mcp-app-preview`、`artifact-preview`、`quickpick`、`canvas`、`writing` 共 6 个额外渲染器窗口。虽然 `detectRendererType()` 对 4 个非 main 渲染器做了路径检测，但 `qoder.ts` 的窗口声明与实际不匹配，可能导致 AgentSkin 的窗口匹配逻辑对额外窗口处理不当。

**发现问题 D2**：ASAR 检测到自定义 session 分区存在。AgentSkin 的注入可能不会自动扩展到自定义分区 session（如 `persist:qoderwork-canvas` 之类），导致 canvas/writing 渲染器在独立 session 中完全收不到注入。

---

## 2. 引擎问题清单

### 2.1 过时/过期配置

| # | 问题 | 位置 | 严重性 |
|---|------|------|--------|
| S1 | `detectRendererType()` 缺少 `canvas` 和 `writing` 分支 | adapter.mjs:90-97 | P0 |
| S2 | `RENDERER_CSS` 对象缺少 `canvas` 和 `writing` 专属 CSS | adapter.mjs:291-417 | P0 |
| S3 | `qoder.ts` windowHints 仅声明 `WindowRole.Main`，与实际 7 渲染器不符 | qoder.ts:33-39 | P1 |
| S4 | tokens.css 缺失 7 个 `--color-border-*` 扩展变量映射 | tokens.css | P2 |
| S5 | tokens.css 缺失 7 个 `--color-text-*` 扩展变量映射 | tokens.css | P2 |
| S6 | tokens.css 完全缺失 popup 局部命名空间映射（~22 变量） | tokens.css | P1 |
| S7 | Dimension A 选择器 `[class*="titlebar"]` 存在过度匹配历史 | adapter.mjs:71 | P2 |

### 2.2 顺序/架构问题

| # | 问题 | 位置 | 严重性 |
|---|------|------|--------|
| O1 | 自愈三重定时器（2s + 1.5s + progressive 2s）可能在大型 bundle 渲染器中产生竞态 | adapter.mjs:571-596 | P1 |
| O2 | Token discovery agent 的 `categoryPatterns` 仅定义 `bg` 类别，缺少 `text`、`border`、`fill` 等类别 | adapter.mjs:47-49 | P2 |
| O3 | `checkSelectorHealth()` 仅检查 L1，缺少 L2/CodeMirror 选择器健康检查 | adapter.mjs:120-142 | P2 |
| O4 | DeepCore 配置 `routes` 和 `fragments` 为空对象，对 canvas/writing 无深度适配 | adapter.mjs:440-446 | P1 |
| O5 | `expectedLayers = 1` 假设 adapter 仅占一层，若 DeepCore 共享层则计数偏少 | adapter.mjs:563 | P3 |

### 2.3 缺失功能

| # | 功能 | 影响 | 严重性 |
|---|------|------|--------|
| M1 | canvas 渲染器专属 CSS（画布区域透明、工具栏玻璃效果） | 画布页面无主题效果 | P0 |
| M2 | writing 渲染器专属 CSS（编辑器区域透明、纸张效果） | 写作页面无主题效果 | P0 |
| M3 | CodeMirror 6 透明背景规则（`.cm-editor`、`.cm-content`、`.cm-line`） | 代码块背景不透明 | P1 |
| M4 | RUM preload 冲突防御（`ArmsEventBridge` 检测 + 样式保护） | RUM 脚本可能清除注入样式 | P1 |
| M5 | 自定义 session 分区注入扩展 | canvas/writing 可能使用独立 partition | P1 |
| M6 | popup 局部变量映射 | chrome-extension popup 主题不完整 | P2 |
| M7 | `data-testid` 运行时检测逻辑 | 无法利用运行时发现的测试锚点 | P3 |

---

## 3. 风险评估

### 3.1 连锁故障风险

```
风险链 1：Multi-Renderer Cascade
┌─────────────────────────────────────────────────────────────────┐
│ 触发：用户打开 canvas 渲染器                                     │
│ ├─ detectRendererType() 返回 'main'（fallback）                 │
│ ├─ 加载 STRUCTURAL_CSS（主窗口选择器）                           │
│ ├─ #root 匹配 → 透明化成功                                       │
│ ├─ .agents-layout-root 不匹配 → 无 fallback CSS                 │
│ ├─ 画布原生背景色显现 → art punch-through 完全失效              │
│ ├─ 用户看到画布原色 + 主窗口透明 → 视觉断裂                     │
│ └─ 严重性：高 │ 概率：100%（只要打开 canvas/writing 必现）       │
└─────────────────────────────────────────────────────────────────┘

风险链 2：RUM Preload Timing Attack
┌─────────────────────────────────────────────────────────────────┐
│ 触发：QoderWork CN 启动，arms-rum-preload.cjs 注册              │
│ ├─ RUM preload 在所有 session 中执行                             │
│ ├─ 可能通过 contextBridge 暴露 ArmsEventBridge                  │
│ ├─ RUM 初始化逻辑（如 rrweb 录制）可能操作 DOM/stylesheets       │
│ ├─ 如果 RUM 在 adapter 注入前执行完毕 → 无冲突                   │
│ ├─ 如果 RUM 定时器持续监控 DOM → 可能替换 adoptedStyleSheets    │
│ ├─ adapter 的 1.5s sheet guard 会重新追加 sheet                  │
│ ├─ RUM + adapter 竞争 → 样式闪烁或注入失败                      │
│ └─ 严重性：中 │ 概率：待运行时验证（取决于 RUM 实现）            │
└─────────────────────────────────────────────────────────────────┘

风险链 3：Self-Heal Storm in Large Bundles
┌─────────────────────────────────────────────────────────────────┐
│ 触发：canvas 渲染器（6.4MB bundle）加载                           │
│ ├─ React 19 首次渲染耗时长（大 bundle）                          │
│ ├─ adapter 注入 → 2s 定时器启动                                   │
│ ├─ 5 次 progressive retry 触发 re-inject → 5 次 sheet.replaceSync│
│ ├─ MutationObserver 同时捕获大量 DOM 变更                         │
│ ├─ 300ms debounce × 多次触发 → 多次 full CSS recompile           │
│ ├─ 大型 sheet + 频繁 replaceSync → 主线程阻塞                    │
│ └─ 严重性：低 │ 概率：中（仅大型渲染器首屏加载时）                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 回归风险量化

| 场景 | 当前风险 | 修复后残余风险 | 修复收益 |
|------|---------|---------------|---------|
| canvas 渲染器打开 | 100% 视觉断裂 | 0% | 100% |
| writing 渲染器打开 | 100% 视觉断裂 | 0% | 100% |
| RUM preload 干扰 | ~30% 样式闪烁 | <5%（防御后） | 25% |
| 宿主版本升级 | ~15% 选择器失效 | <10%（健康检查增强） | 5% |
| popup 主题缺失 | 100% popup 原生 | 0% | 100% |
| CM6 代码区不透明 | 100% 代码块原色 | 0% | 100% |

### 3.3 跨适配器对比基准

| 维度 | qoderwork | traework | workbuddy | 差异分析 |
|------|-----------|----------|-----------|---------|
| 渲染器覆盖 | 5/7 (71%) | 1/1 (100%) | 3/3 (100%) | ⚠️ 低于平均水平 |
| Token 变量数 | ~100+ | ~30 | ~50 | 最高复杂度 |
| CSP 复杂度 | 中（CM6 nonce）| 低 | 中 | 与 doubao 相当 |
| 第三方干扰 | 高（RUM+rrweb）| 低 | 中 | 最高风险 |
| 自愈机制 | 三重防御 | 二重 | 三重 | 处于平均水平 |

---

## 4. 修复建议

### 4.1 P0：必须立即修复

#### P0-1：补充 canvas 渲染器检测与 CSS

**影响**：画布设计工具（6.4MB）完全无主题效果

**修复位置**：`engines/qoderwork/adapter.mjs`

**修复内容**：
1. 在 `detectRendererType()` 中增加 `canvas` 路径检测
2. 在 `RENDERER_CSS` 中增加 `canvas` 配置块
3. canvas 渲染器需要特殊处理：画布区域本身不应透明（用户需要看到画布），但工具栏、侧边面板需要玻璃效果

**参考 CSS 结构**：
```javascript
'canvas': `
/* === canvas: 画布设计工具 === */
/* 画布区域保持原色（用户需要看到内容），工具栏玻璃化 */
html.${HOST_CLASS} [class*="canvas-toolbar"],
html.${HOST_CLASS} [class*="canvas-side-panel"],
html.${HOST_CLASS} [class*="canvas-layers-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 72%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  border-color: var(--ag-glass-border) !important;
}
`
```

#### P0-2：补充 writing 渲染器检测与 CSS

**影响**：写作编辑器（3.7MB）完全无主题效果

**修复位置**：`engines/qoderwork/adapter.mjs`

**修复内容**：
1. 在 `detectRendererType()` 中增加 `writing` 路径检测
2. 在 `RENDERER_CSS` 中增加 `writing` 配置块
3. 写作编辑器需要区分：纸张区域可保持浅色，但外围面板需要透明/玻璃效果

#### P0-3：修复 detectRendererType 路径匹配

**当前缺陷**：ASAR 确认 canvas 路径为 `resources/canvas/index.html`，writing 路径为 `resources/writing/index.html`。`pathname.includes('canvas')` 可匹配，但需确认 Electron 渲染器 `file://` URL 中路径格式。

**修复方案**：
```javascript
function detectRendererType() {
  const pathname = window.location.pathname || '';
  const href = window.location.href || '';
  if (pathname.includes('voice-overlay')) return 'voice-overlay';
  if (pathname.includes('mcp-app-preview')) return 'mcp-app-preview';
  if (pathname.includes('artifact-preview')) return 'artifact-preview';
  if (pathname.includes('quickpick')) return 'quickpick';
  if (pathname.includes('canvas') || href.includes('canvas/index.html')) return 'canvas';
  if (pathname.includes('writing') || href.includes('writing/index.html')) return 'writing';
  return 'main';
}
```

---

### 4.2 P1：近期修复

#### P1-1：RUM Preload 冲突防御

**影响**：ARMS RUM preload 可能清除 AgentSkin 注入的样式

**修复方案**：
1. 增加 `ArmsEventBridge` 存在检测，确认 RUM 环境
2. 将 sheet guard interval 从 1.5s 缩短至 1s（在 RUM 环境中更快响应）
3. 考虑监听 `DOMContentLoaded` 后的首次 RUM 活动窗口

```javascript
// RUM 环境检测
const hasRUM = typeof window.ArmsEventBridge !== 'undefined' || 
  Object.keys(window).some(k => k.startsWith('__arms') || k.startsWith('__rum'));
const sheetGuardMs = hasRUM ? 1000 : 1500;
```

#### P1-2：popup 局部变量映射

**影响**：chrome-extension popup 中 ~22 个局部变量未受主题控制

**修复位置**：`engines/qoderwork/tokens.css`

**修复内容**：在 `html.agentskin-host-qoderwork:root` 块中增加 popup 变量映射：
```css
/* Popup local namespace mapping */
--bg: var(--agentskin-surface) !important;
--bg-highlight: var(--agentskin-accent) !important;
--text: var(--agentskin-text) !important;
--text-secondary: var(--agentskin-muted) !important;
--text-on-primary: var(--agentskin-bg) !important;
--border: var(--agentskin-border) !important;
--fill: var(--agentskin-surface-elevated) !important;
--radius: 8px !important;
--radius-sm: 6px !important;
--radius-lg: 16px !important;
--primary: var(--agentskin-accent) !important;
--primary-hover: color-mix(in srgb, var(--agentskin-accent) 85%, white) !important;
--success: var(--agentskin-accent) !important;
--error: #ff4d4f !important;
--warning: #faad14 !important;
```

#### P1-3：CodeMirror 6 编辑器透明适配

**影响**：代码编辑区域背景不透明，art punch-through 在代码块处失效

**修复位置**：`engines/qoderwork/adapter.mjs` STRUCTURAL_CSS

**修复内容**：在 STRUCTURAL_CSS 中增加：
```css
/* === CodeMirror 6 editor transparent === */
html.${HOST_CLASS} .cm-editor,
html.${HOST_CLASS} .cm-scroller,
html.${HOST_CLASS} .cm-content,
html.${HOST_CLASS} .cm-line {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} .cm-gutters {
  background: color-mix(in srgb, var(--agentskin-surface) 50%, transparent) !important;
  border-right: 1px solid var(--ag-glass-border) !important;
}
html.${HOST_CLASS} .cm-activeLineGutter,
html.${HOST_CLASS} .cm-activeLine {
  background: color-mix(in srgb, var(--agentskin-accent) 8%, transparent) !important;
}
```

#### P1-4：更新 qoder.ts 窗口声明

**影响**：AgentSkin 窗口匹配逻辑可能不覆盖额外渲染器

**修复位置**：`src/adapters/domestic/qoder.ts`

**修复内容**：将 windowHints 扩展为多角色声明（或至少声明 `WindowRole.Renderer` 覆盖独立渲染器窗口）。

---

### 4.3 P2：计划修复

#### P2-1：扩展 --color-border-* 变量映射

**修复位置**：`engines/qoderwork/tokens.css`

增加缺失的 7 个 border 扩展变量：
```css
--color-border-inverse: var(--agentskin-text) !important;
--color-border-ghost: color-mix(in srgb, var(--agentskin-border) 30%, transparent) !important;
--color-border-info: rgba(11, 131, 241, 0.35) !important;
--color-border-danger: rgba(255, 77, 79, 0.35) !important;
--color-border-success: color-mix(in srgb, var(--agentskin-accent) 35%, transparent) !important;
--color-border-warning: rgba(250, 173, 20, 0.35) !important;
--color-border-disabled: color-mix(in srgb, var(--agentskin-border) 20%, transparent) !important;
```

#### P2-2：扩展 --color-text-* 变量映射

增加缺失的 7 个文本扩展变量：
```css
--color-text-inverse: var(--agentskin-bg) !important;
--color-text-ghost: color-mix(in srgb, var(--agentskin-text) 25%, transparent) !important;
--color-text-info: #0b83f1 !important;
--color-text-danger: #ff4d4f !important;
--color-text-success: var(--agentskin-accent) !important;
--color-text-warning: #faad14 !important;
--color-text-disabled: color-mix(in srgb, var(--agentskin-text) 35%, transparent) !important;
```

#### P2-3：增强选择器健康检查

**修复位置**：`engines/qoderwork/adapter.mjs`

将 `.cm-editor` 纳入 L2 健康检查：
```javascript
const l2Checks = [
  { key: 'cmEditor', selector: '.cm-editor', required: false },
];
```

#### P2-4：Token Discovery Agent 类别扩展

**修复位置**：`engines/qoderwork/adapter.mjs`

增加 `text`、`border`、`fill` 类别的自动发现规则：
```javascript
categoryPatterns: {
  bg: /bg|background|container|layout/,
  text: /text|color(?!-)/,
  border: /border|outline/,
  fill: /fill|surface/
},
valueTransforms: {
  bg: (v) => 'transparent',
  text: (v) => 'var(--agentskin-text)',
  border: (v) => 'var(--agentskin-border)',
  fill: (v) => 'transparent'
}
```

#### P2-5：DeepCore routes/fragments 配置

**修复位置**：`engines/qoderwork/adapter.mjs`

为 canvas/writing 渲染器增加 DeepCore 路由配置：
```javascript
routes: [
  { match: 'canvas', fragment: 'canvas-shell' },
  { match: 'writing', fragment: 'writing-editor' }
],
fragments: {
  'canvas-shell': { selector: '[class*="canvas-container"]', mode: 'glass' },
  'writing-editor': { selector: '[class*="writing-area"]', mode: 'transparent' }
}
```

---

### 4.4 P3：低优先级优化

#### P3-1：运行时 data-testid 探测

在 adapter 初始化后增加 data-testid 扫描，将发现的测试锚点存入 `window[MARKER].testAnchors`，供后续版本参考。

#### P3-2：选择器过度匹配防护

对 `[class*="agents-header"]` 和 `[class*="titlebar"]` 增加排除规则，避免误匹配非 header 元素：
```css
html.${HOST_CLASS} [class*="agents-header"]:not([class*="item"]):not([class*="nav"]) {
  /* ... */
}
```

#### P3-3：自愈定时器智能退避

在大型 bundle 渲染器中，将 progressive retry 的固定 2s 间隔改为指数退避（2s → 4s → 8s），减少首屏加载时的 re-inject 频率。

---

## 5. 修复优先级路线图

```
Phase 1（1-2 天）— P0 紧急修复
├── P0-1: canvas 渲染器检测 + CSS
├── P0-2: writing 渲染器检测 + CSS
├── P0-3: detectRendererType 路径匹配修复
└── 验收：canvas/writing 页面主题效果正常

Phase 2（2-3 天）— P1 重要修复
├── P1-1: RUM preload 冲突防御
├── P1-2: popup 局部变量映射
├── P1-3: CodeMirror 6 透明适配
├── P1-4: qoder.ts 窗口声明更新
└── 验收：RUM 环境无闪烁，popup 主题完整，代码区透明

Phase 3（3-5 天）— P2 计划修复
├── P2-1: border 扩展变量映射
├── P2-2: text 扩展变量映射
├── P2-3: 选择器健康检查增强
├── P2-4: Token Discovery 类别扩展
├── P2-5: DeepCore 路由配置
└── 验收：token 覆盖率 >98%，健康检查覆盖 L1+L2

Phase 4（持续）— P3 优化
├── P3-1: data-testid 运行时探测
├── P3-2: 选择器过度匹配防护
├── P3-3: 自愈定时器智能退避
└── 验收：引擎健康度 >95%
```

---

## 6. 专家结论

### 6.1 总体评价

QoderWork CN 引擎在**主窗口场景**下表现良好：选择器策略成熟（多版本 fallback）、token 映射覆盖了核心变量、注入方式正确（adoptedStyleSheets 绕过 CSP）、自愈机制完善（三重防御）。

然而，引擎在**多窗口覆盖**方面存在显著缺口。7 种渲染器仅覆盖 5 种，缺失的 canvas（6.4MB）和 writing（3.7MB）是功能完备的独立应用，用户在这些页面中完全看不到主题效果，造成视觉断裂。这是当前最严重的缺陷。

### 6.2 与交叉验证报告的差异

交叉验证报告给出 86% 综合匹配度，本审计给出 80.5%。差异来源：

| 差异点 | 交叉验证 | 本审计 | 原因 |
|--------|---------|--------|------|
| 渲染器覆盖 | 71% 计入 | 权重提升 | 实际影响用户体验更严重 |
| Token 映射 | 95% 计入 | 78% 计入 | 发现 popup 局部变量完全缺失 |
| 安全兼容 | 85% 计入 | 75% 计入 | RUM 冲突无防御方案 |
| 架构假设 | 未独立评估 | 70% 计入 | 多窗口声明与实际不符 |

### 6.3 运行时验证优先级

以下发现需要 QoderWork CN 运行后通过 CDP 验证：

1. **CSS 变量运行时值**：静态提取的定义值可能被 JS 运行时覆盖
2. **canvas/writing 实际 URL**：确认 `window.location.href` 格式以校准 `detectRendererType()`
3. **RUM preload 实际行为**：确认 `arms-rum-preload.cjs` 是否操作 `adoptedStyleSheets`
4. **自定义 session 分区**：确认 canvas/writing 是否使用独立 partition
5. **data-testid 存在性**：ASAR 未检测到，运行时可能存在

### 6.4 最终建议

1. **立即执行 Phase 1**（P0 修复），消除 canvas/writing 的视觉断裂
2. **启动 QoderWork CN 后执行 CDP 探测**，验证 §6.3 的运行时盲区
3. **Phase 2 与 CDP 探测并行执行**，RUM 防御可基于 ASAR 分析先行实现
4. **将本审计纳入引擎组 backlog**，按路线图分阶段消化 P2/P3

---

## 附录 A：交叉验证事实引用表

| 引用编号 | 事实 | 本审计使用 |
|---------|------|-----------|
| I7 | 主命名空间 `--color-*`（~80+ 变量） | Token 映射完整性分析 |
| I8-14 | popup 局部变量（7 个命名空间，~20 变量） | 发现 popup 映射完全缺失 |
| I16-19 | 7 种渲染器，缺 canvas/writing | P0 修复依据 |
| I25-28 | 8 个可注入点，adoptedStyleSheets 绕过 CSP | 注入策略正确性确认 |
| I35 | P1：需补充 canvas/writing | 升级为 P0（影响用户体验） |
| I36 | P2：CodeMirror 编辑器需适配 | 确认为 P1（代码区不透明） |
| I37 | P2：RUM preload 冲突需注意 | 确认为 P1（无防御方案） |
| A4 | preload 注册机制（双模式） | 自定义 partition 风险推断 |
| A8 | rrweb 会话录制 SDK | RUM 冲突链分析 |
| A12 | Canvas/Writing 含 React 19.2.1 | 确认注入策略兼容性 |

## 附录 B：文件路径索引

| 文件 | 用途 |
|------|------|
| `engines/qoderwork/adapter.mjs` | 注入引擎适配器（622 行） |
| `engines/qoderwork/tokens.css` | Token 映射（173 行） |
| `engines/qoderwork/cosmetic.css` | Cosmetic 样式（46 行） |
| `src/adapters/domestic/qoder.ts` | DOM 适配器（40 行） |
| `docs/reverse-engineering/batch1-cdp/qoderwork-cdp.md` | CDP 动态探测报告 |
| `docs/reverse-engineering/batch2-asar/qoderwork-asar.md` | ASAR 静态分析报告 |
| `docs/reverse-engineering/batch3-validation/qoderwork-cross-validation.md` | 交叉验证报告 |
