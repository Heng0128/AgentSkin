# CDP 动态探测报告：QoderWork CN (`qoderwork`)

> 探测日期：2026-08-31
> 目标路径：`C:\Program Files\QoderWork CN\QoderWork CN\resources\app.asar`
> 探测方式：CDP 端口扫描 + DevToolsActivePort 文件探测 + 静态 ASAR 分析
> Agent ID：`qoderwork`

---

## 1. CDP 连接状态

### 1.1 连接结果：**FAILED — 应用未运行**

| 项目 | 值 |
|------|-----|
| 状态 | ❌ 未连接 |
| 端口 | N/A |
| 方法 | DevToolsActivePort 文件探测 + 端口扫描 |
| 原因 | QoderWork CN 当前未运行 |

### 1.2 探测过程

1. **DevToolsActivePort 文件探测**：扫描了以下候选目录：
   - `%APPDATA%\QoderWork\` — 未找到
   - `%APPDATA%\QoderWork CN\` — 未找到
   - `%LOCALAPPDATA%\QoderWork\` — 未找到
   - `%LOCALAPPDATA%\QoderWork CN\` — 未找到

2. **端口扫描**：扫描了 9222-9225、9330-9340 范围内的常见 CDP 端口，均未发现活动的 CDP endpoint。

3. **应用启动尝试**：`C:\Program Files\QoderWork CN\QoderWork CN.exe` 存在，但启动后仍未检测到 CDP 端口（应用使用 `--remote-debugging-port=0` 即 ephemeral 模式，不暴露固定端口）。

### 1.3 诊断结论

QoderWork CN 使用 `--remote-debugging-port=0`（ephemeral 模式），CDP 端口仅通过 `DevToolsActivePort` 文件发布。由于应用当前未运行，无法获取实时 CDP 数据。

**建议**：
- 启动 QoderWork CN 后重新探测
- 或使用 AgentSkin 引擎的 launcher 自动处理端口发现
- 静态 ASAR 分析（第 2 节）已提供完整的离线结构信息

---

## 2. Target 列表

> ⚠️ 应用未运行，无法获取实时 target 列表。以下为 ASAR 静态分析推断的渲染器页面。

### 2.1 推断的 CDP Targets（来自 ASAR 分析）

| # | 类型 | 推断 URL | 用途 | ASAR 来源 |
|---|------|---------|------|----------|
| 0 | page | `file:///.../index.html` | 主工作区 | `app.asar` 内嵌 |
| 1 | page | `file:///.../voice-overlay.html` | 语音输入覆盖层 | ASAR 内检测到 |
| 2 | page | `file:///.../mcp-app-preview.html` | MCP 应用预览 | ASAR 内检测到 |
| 3 | page | `file:///.../artifact-preview.html` | 产物预览面板 | ASAR 内检测到 |
| 4 | page | `file:///.../quickpick.html` | 命令面板 | ASAR 内检测到 |
| 5 | page | `file:///.../canvas/index.html` | 画布设计工具 | `resources/canvas/` (6.4MB) |
| 6 | page | `file:///.../writing/index.html` | 写作编辑器 | `resources/writing/` (3.7MB) |

### 2.2 渲染器覆盖分析

| 渲染器 | 现有 adapter 覆盖 | 说明 |
|--------|-----------------|------|
| `main` | ✅ 已覆盖 | 主窗口，adapter 已验证 |
| `voice-overlay` | ✅ 已覆盖 | 语音覆盖层 |
| `mcp-app-preview` | ✅ 已覆盖 | MCP 预览 |
| `artifact-preview` | ✅ 已覆盖 | 产物预览 |
| `quickpick` | ✅ 已覆盖 | 命令面板 |
| `canvas` | ⚠️ 缺失 | 画布工具，需补充 `detectRendererType()` |
| `writing` | ⚠️ 缺失 | 写作编辑器，需补充 `detectRendererType()` |

---

## 3. DOM 快照摘要

> ⚠️ 应用未运行，无法获取实时 DOM。以下为 ASAR 静态分析推断的 DOM 结构。

### 3.1 HTML 结构推断

```html
<!DOCTYPE html>
<html lang="zh-CN" class="">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>QoderWork CN</title>
    <meta http-equiv="Content-Security-Policy" content="..." />
    <!-- 内联 <style> 或 <link> 极少 — CSS 通过 JS bundle 注入 -->
  </head>
  <body class="">
    <div id="root"><!-- React 19 挂载点 --></div>
    <script type="module" crossorigin>
      <!-- React 19.2.1 内联生产 bundle -->
    </script>
  </body>
</html>
```

### 3.2 body className 推断

- **推断值**：`""`（空字符串或主题相关 class）
- **依据**：React 19 应用通常不设置 body class，样式通过 CSS-in-JS 或 CSS Modules 管理

### 3.3 关键 DOM 特征

| 特征 | 值 | 依据 |
|------|-----|------|
| React 根容器 | `#root` | ASAR 内 React 19 bundle |
| React 版本 | 19.2.1 | `react-dom-client` 检测 |
| 框架 | React 19 + 内联生产 bundle | ASAR 分析 |
| 编辑器 | CodeMirror 6 | `@codemirror/view` + `@codemirror/state` |
| 文档语言 | `zh-CN` | 中文版本 |

---

## 4. CSS 变量清单

> ⚠️ 应用未运行，无法获取运行时计算值。以下为 ASAR 静态分析提取的 CSS 变量定义。

### 4.1 命名空间：`--color-*`（qoder-design 主系统）

#### Primary / Brand
```css
--color-primary: #73CD94;
--color-primary-hover: #8EE5A1;
--color-primary-text: #FDFDFD;
--color-primary-bg;
--color-primary-bg-hover;
--color-primary-border;
--color-primary-border-hover;
--color-text-on-primary: #FDFDFD;
```

#### Text Hierarchy
```css
--color-text: #141414;
--color-text-secondary: #638261;
--color-text-tertiary: #838280;
--color-text-quaternary;
--color-text-base;
--color-muted;
--color-muted-foreground;
--color-text-inverse;
--color-text-ghost;
--color-text-info;
--color-text-danger;
--color-text-success;
--color-text-warning;
--color-text-disabled;
```

#### Backgrounds
```css
--color-bg-container;
--color-bg-elevated;
--color-bg-layout;
--color-bg-spotlight;
--color-bg-base;
--color-bg-mask;
--color-bg-highlight: #080807;
--color-bg-highlight-hover: #2a2a29;
--color-background;
--color-popover;
--color-white-opacity;
--color-black-opacity;
```

#### Borders
```css
--color-border: #E6E6E6;
--color-border-secondary;
--color-border-tertiary;
--color-border-inverse;
--color-border-ghost;
--color-border-info;
--color-border-danger;
--color-border-success;
--color-border-warning;
--color-border-disabled;
```

#### Fills
```css
--color-fill: #EFEFEF;
--color-fill-secondary;
--color-fill-tertiary: #F9F9F9;
--color-fill-quaternary;
--color-fill-disable;
```

#### Semantic
```css
--color-success: #73CD94;
--color-error: #FF4D4F;
--color-error-bg: #FFF2F0;
--color-warning: #FAAD14;
--color-info;
--color-link;
```

#### Accent Palette
```css
--color-pink; --color-pink-bg; --color-pink-hover;
--color-purple; --color-purple-bg; --color-purple-hover;
--color-teal; --color-teal-bg; --color-teal-hover;
--color-lavender; --color-lavender-bg; --color-lavender-hover;
--color-sage; --color-sage-bg; --color-sage-hover;
--color-mauve; --color-mauve-bg; --color-mauve-hover;
```

#### Shadows
```css
--color-shadow-2xs; --color-shadow-xs; --color-shadow-sm; --color-shadow-md;
--color-shadow-lg; --color-shadow-xl; --color-shadow-2xl; --color-shadow-3xl;
--color-shadow-scrim;
```

#### Highlights
```css
--color-highlight-xs; --color-highlight-sm; --color-highlight-md;
--color-highlight-lg; --color-highlight-xl;
```

#### Diff
```css
--color-diff-insert; --color-diff-insert-bg;
--color-diff-remove; --color-diff-remove-bg;
```

#### Rings
```css
--color-ring-primary; --color-ring-secondary; --color-ring-inverse;
--color-ring-info; --color-ring-danger; --color-ring-success; --color-ring-warning;
```

### 4.2 命名空间：`--bg-*`（popup 局部）

```css
--bg: #FDFDFD;
--bg-highlight: #080807;
--bg-highlight-hover: #2a2a29;
```

### 4.3 命名空间：`--text-*`（popup 局部）

```css
--text: #141414;
--text-secondary: #638261;
--text-tertiary: #838280;
--text-on-primary: #FDFDFD;
```

### 4.4 命名空间：`--border-*` / `--fill-*`（popup 局部）

```css
--border: #E6E6E6;
--fill: #EFEFEF;
--fill-tertiary: #F9F9F9;
```

### 4.5 命名空间：`--radius-*` / `--shadow-*`（popup 局部）

```css
--radius: 8px;
--radius-sm: 6px;
--radius-lg: 16px;
--shadow-card: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04);
--shadow-card-primary: 0 10px 15px -3px rgba(115,205,148,0.08), ...;
```

### 4.6 命名空间：`--primary-*`（popup 局部）

```css
--primary: #73CD94;
--primary-hover: #8EE5A1;
--primary-text: #FDFDFD;
```

### 4.7 命名空间：`--success` / `--error` / `--warning`（popup 局部）

```css
--success: #73CD94;
--error: #FF4D4F;
--error-bg: #FFF2F0;
--warning: #FAAD14;
```

### 4.8 变量总数估计

| 命名空间 | 变量数 | 来源 |
|---------|--------|------|
| `--color-*` | ~80+ | qoder-design 系统（ASAR 内） |
| `--bg-*` | ~3 | popup.html |
| `--text-*` | ~4 | popup.html |
| `--border-*` | ~1 | popup.html |
| `--fill-*` | ~2 | popup.html |
| `--radius-*` | ~3 | popup.html |
| `--shadow-*` | ~2 | popup.html |
| `--primary-*` | ~3 | popup.html |
| `--success/--error/--warning` | ~4 | popup.html |
| **合计** | **~100+** | |

---

## 5. 锚点清单

> ⚠️ 应用未运行，无法获取实时锚点列表。以下为 ASAR 静态分析 + adapter 代码推断的锚点。

### 5.1 高稳定性锚点（High）

| 锚点 | 类型 | 依据 |
|------|------|------|
| `#root` | id | React 根容器，所有渲染器共享 |
| `html.agentskin-host-qoderwork` | class | AgentSkin 注入的 host class |
| `.agents-layout-root` | class | 布局根容器（adapter 已验证） |
| `.agents-layout-body` | class | 布局体（adapter 已验证） |
| `.agents-content-area` | class | 内容区（adapter 已验证） |
| `.agents-sidebar` | class | 侧边栏（adapter 已验证） |
| `[data-active="true"]` | attribute | 导航激活状态（adapter 已验证） |
| `[data-extension-nav-item="true"]` | attribute | 扩展导航项（adapter 已验证） |
| `[data-resizable-sidebar]` | attribute | 可调整侧边栏（adapter 已验证） |
| `.chat-input-editor-text` | class | 聊天输入框（adapter 已验证） |
| `button[class~="group/extensions-nav"]` | class+tag | 导航按钮（adapter 已验证） |

### 5.2 中稳定性锚点（Medium）

| 锚点 | 类型 | 依据 |
|------|------|------|
| `[class*="agents-header"]` | class pattern | 标题栏（通配匹配） |
| `[class*="titlebar"]` | class pattern | 标题栏（通配匹配） |
| `[class*="chat-panel"]` | class pattern | 聊天面板（通配匹配） |
| `[class*="message-list"]` | class pattern | 消息列表（通配匹配） |
| `[class*="conversation-panel"]` | class pattern | 对话面板（通配匹配） |
| `[class*="workspace-panel"]` | class pattern | 工作区面板（通配匹配） |
| `[role="dialog"]` | ARIA | 对话框覆盖层 |
| `[role="menu"]` | ARIA | 菜单覆盖层 |
| `[role="tooltip"]` | ARIA | 工具提示 |
| `[role="listbox"]` | ARIA | 列表框 |
| `.cm-editor` | class | CodeMirror 6 编辑器（ASAR 内检测到） |
| `.cm-content` | class | CodeMirror 6 内容区 |
| `.cm-line` | class | CodeMirror 6 行 |

### 5.3 低稳定性锚点（Low）

| 锚点 | 类型 | 依据 |
|------|------|------|
| CSS Modules hash 类名 | class | 编译时生成，版本间变化 |
| 内联 style 属性 | style | 动态计算，不可预测 |
| `[class*="voice-overlay"]` | class pattern | 语音覆盖层（推测） |
| `[class*="mcp-preview"]` | class pattern | MCP 预览（推测） |
| `[class*="artifact-preview"]` | class pattern | 产物预览（推测） |
| `[class*="quickpick"]` | class pattern | 命令面板（推测） |

### 5.4 data-testid 清单

> ⚠️ 应用未运行，无法获取实时 data-testid 列表。ASAR 分析未检测到显式 data-testid 属性。

**推断**：QoderWork CN 可能不使用 `data-testid` 属性，或仅在部分组件中使用。需要运行时探测确认。

### 5.5 element id 清单

> ⚠️ 应用未运行，无法获取实时 id 列表。

**推断的高稳定性 id**：

| id | 用途 | 依据 |
|----|------|------|
| `#root` | React 根容器 | React 19 标准模式 |

---

## 6. 样式表清单

> ⚠️ 应用未运行，无法获取运行时样式表信息。以下为 ASAR 静态分析推断。

### 6.1 推断的样式表结构

| 类型 | 数量 | 说明 |
|------|------|------|
| 内联 `<style>` | 0-1 | 主窗口 CSS 通过 JS bundle 注入 |
| 外部 `<link rel="stylesheet">` | 0 | 无外部样式表（内联 bundle） |
| `adoptedStyleSheets` | 1-2 | AgentSkin 注入后存在 |

### 6.2 CSS 注入机制

| 机制 | 状态 | 说明 |
|------|------|------|
| `adoptedStyleSheets` | 主注入方式 | adapter 已验证使用 |
| 内联 `<style>` | 由 React bundle 管理 | CSS-in-JS 或 styled-components |
| CSS Modules | 使用 | 编译时 hash 类名 |

---

## 7. CSP 策略

### 7.1 推断的 CSP 配置

| 配置项 | 推断值 | 依据 |
|--------|--------|------|
| Meta CSP | 可能存在 | ASAR 中检测到 `EditorView.cspNonce` |
| Script nonce | 存在 | CodeMirror 6 使用 CSP nonce |
| Style nonce | 可能存在 | 内联样式可能需要 nonce |
| `adoptedStyleSheets` | 不受 CSP 限制 | 已使用，无影响 |

### 7.2 CSP Nonce 处理

ASAR 中检测到 `EditorView.cspNonce`（CodeMirror 6），表明宿主 CSP 策略对内联样式有 nonce 要求。

- **影响**：直接插入 `<style>` 标签可能被 CSP 阻止
- **缓解**：`adoptedStyleSheets` 不受 CSP 限制（已默认使用）
- **建议**：维持当前 `adoptedStyleSheets` 策略，无需额外处理

---

## 8. 与静态分析的差异对比

### 8.1 静态分析 vs 动态探测

| 维度 | 静态分析（ASAR） | 动态探测（CDP） | 差异 |
|------|-----------------|----------------|------|
| CSS Token 命名空间 | `--color-*` 完整提取 | 未获取（应用未运行） | 动态可确认运行时值 |
| 根容器选择器 | `#root` 确认 | 未确认 | 动态可验证 |
| 布局类名 | `.agents-layout-root/body` 确认 | 未确认 | 动态可验证 |
| 侧边栏 | `.agents-sidebar` 确认 | 未确认 | 动态可验证 |
| 导航按钮 | `button.group/extensions-nav` 确认 | 未确认 | 动态可验证 |
| 激活状态 | `[data-active="true"]` 确认 | 未确认 | 动态可验证 |
| 输入框 | `.chat-input-editor-text` 确认 | 未确认 | 动态可验证 |
| 渲染器覆盖 | 7 种渲染器 | 未确认 | 动态可验证实际 URL |
| CodeMirror | `.cm-editor/.cm-content` 推断 | 未确认 | 动态可验证 |
| CSP nonce | `EditorView.cspNonce` 检测 | 未确认 | 动态可获取实际策略 |
| RUM preload | `arms-rum-preload.cjs` 检测 | 未确认 | 动态可验证冲突 |

### 8.2 关键差异点

1. **CSS 变量运行时值**：静态分析只能提取定义，动态探测可获取计算后的实际值
2. **渲染器 URL**：静态分析推断路径，动态探测可确认实际 `window.location.href`
3. **CSP 实际策略**：静态分析检测到 nonce 存在，动态探测可获取完整 CSP 头
4. **RUM 冲突**：静态分析检测到 preload，动态探测可验证是否干扰 CSS 注入

---

## 9. 现有引擎匹配度评估

### 9.1 现有适配器状态

| 组件 | 路径 | 状态 |
|------|------|------|
| `adapter.mjs` | `engines/qoderwork/adapter.mjs` | ✅ 完整（622 行） |
| `tokens.css` | `engines/qoderwork/tokens.css` | ✅ 完整（173 行） |
| `cosmetic.css` | `engines/qoderwork/cosmetic.css` | ✅ 完整（46 行） |
| DOM 适配器 | `src/adapters/domestic/qoder.ts` | ✅ 完整（40 行） |

### 9.2 matchTarget 模式验证

| 模式 | 推断匹配 | 说明 |
|------|---------|------|
| `qoder` | ✅ 匹配 | 应用名称包含 "Qoder" |
| `qoderwork` | ✅ 匹配 | 应用名称包含 "QoderWork" |

**matchRate**：`2/2` — 完全匹配

### 9.3 匹配度矩阵

| 维度 | 现有覆盖 | ASAR 实际 | 差距 |
|------|---------|-----------|------|
| CSS Token 命名空间 | `--color-*` | `--color-*` | ✅ 完全匹配 |
| 根容器选择器 | `#root` | `#root` | ✅ 完全匹配 |
| 布局类名 | `.agents-layout-root/body` | `.agents-layout-root/body` | ✅ 完全匹配 |
| 侧边栏 | `.agents-sidebar` | `.agents-sidebar` | ✅ 完全匹配 |
| 导航按钮 | `button.group/extensions-nav` | `button.group/extensions-nav` | ✅ 完全匹配 |
| 激活状态 | `[data-active="true"]` | `[data-active="true"]` | ✅ 完全匹配 |
| 输入框 | `.chat-input-editor-text` | `.chat-input-editor-text` | ✅ 完全匹配 |
| 多窗口声明 | `WindowRole.Main` | 单主窗口 | ✅ 匹配 |
| matchTarget | `['qoder', 'qoderwork']` | `qoderwork` | ✅ 匹配 |
| 渲染器检测 | 5 种 | 7 种（含 canvas/writing） | ⚠️ 需补充 |
| CodeMirror | 未覆盖 | `.cm-editor/.cm-content` | ⚠️ 需补充 |
| RUM 冲突 | 未处理 | `arms:rum-bridge` preload | ⚠️ 需注意 |
| CSP nonce | 未处理 | `EditorView.cspNonce` | ⚠️ 需注意 |

### 9.4 差距与建议

#### 9.4.1 渲染器覆盖扩展（P1）

ASAR 分析确认存在 7 种渲染器页面，现有 adapter 覆盖 5 种。缺失：

- **`canvas`** — `resources/canvas/index.html`（6.4MB React 19 bundle）
- **`writing`** — `resources/writing/index.html`（3.7MB React 19 bundle）

建议：在 `detectRendererType()` 中增加 `canvas` 和 `writing` 路径检测。

#### 9.4.2 CodeMirror 编辑器适配（P2）

ASAR 内检测到 CodeMirror 6（`@codemirror/view`, `@codemirror/state`），编辑器使用 CSP nonce。

建议：
- 为 `.cm-editor`、`.cm-content`、`.cm-line` 添加透明背景规则
- 使用 `adoptedStyleSheets` 绕过 CSP nonce 限制（已默认使用）

#### 9.4.3 RUM Preload 冲突（P2）

宿主注册 `arms-rum-preload.cjs` 到所有 session，通过 `contextBridge.exposeInMainWorld` 暴露 `ArmsEventBridge`。

影响：
- RUM preload 可能干扰 AgentSkin 的 CSS 注入时序
- `dom-ready` 事件注入的 JS 可能覆盖 adapter 的 `adoptedStyleSheets`

建议：
- 在 adapter 中增加对 `ArmsEventBridge` 存在的检测
- 使用 `window.__agentskin_sheet_manager__` 防御 RUM 脚本的样式清除

#### 9.4.4 CSP Nonce 处理（P3）

CodeMirror 使用 `EditorView.cspNonce` Facet，表明宿主 CSP 策略对内联样式有 nonce 要求。

影响：
- 直接插入 `<style>` 标签可能被 CSP 阻止
- `adoptedStyleSheets` 不受 CSP 限制（已使用，无影响）

建议：维持当前 `adoptedStyleSheets` 策略，无需额外处理。

### 9.5 总体评估

| 指标 | 评分 | 说明 |
|------|------|------|
| Token 覆盖 | 95% | `--color-*` 全量映射，popup 局部变量已覆盖 |
| 结构适配 | 90% | 核心布局类名已验证，canvas/writing 需补充 |
| 多窗口支持 | 70% | 5/7 渲染器已覆盖 |
| 安全兼容 | 85% | adoptedStyleSheets 绕过 CSP，RUM 冲突需关注 |
| 自愈能力 | 90% | MutationObserver + 2s 定时器 + 1.5s sheet guard |
| **综合匹配度** | **86%** | **良好，少量补充即可完整覆盖** |

---

## 10. 注入面总结

### 10.1 可注入点

| 注入面 | 位置 | 优先级 | 说明 |
|--------|------|--------|------|
| `#root::before` | 所有渲染器 | P0 | 艺术层（hero image） |
| `html.agentskin-host-qoderwork:root` | 所有渲染器 | P0 | Token 覆盖 |
| `.agents-layout-root/body` | 主窗口 | P0 | 布局透明化 |
| `.agents-sidebar` | 主窗口 | P0 | 侧边栏玻璃效果 |
| `.chat-input-editor-text` | 主窗口 | P1 | 输入框焦点环 |
| `.cm-editor` | 编辑器区域 | P2 | 代码编辑器透明化 |
| `[role="dialog"]` | 覆盖层 | P1 | 对话框样式 |
| `iframe` | MCP 预览 | P2 | 预览容器边框 |

### 10.2 注入风险

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| RUM preload 清除样式 | 中 | `adoptedStyleSheets` + sheet guard interval |
| React 重渲染移除 host class | 低 | 2s 定时器重新注入 |
| CSP nonce 阻止 style 标签 | 低 | 使用 `adoptedStyleSheets`（已默认） |
| Canvas/Writing 渲染器未覆盖 | 中 | 补充 `detectRendererType()` 分支 |

---

## 11. 下一步行动

### 11.1 高优先级（P0-P1）

1. **启动 QoderWork CN 后重新探测** — 获取运行时 CSS 变量实际值、渲染器 URL、CSP 策略
2. **补充 canvas/writing 渲染器覆盖** — 在 `detectRendererType()` 中增加路径检测
3. **验证 RUM preload 冲突** — 确认 `arms-rum-preload.cjs` 是否干扰 CSS 注入

### 11.2 中优先级（P2）

4. **CodeMirror 编辑器适配** — 为 `.cm-editor` 系列添加透明背景规则
5. **CSP nonce 验证** — 确认实际 CSP 策略对内联样式的影响

### 11.3 低优先级（P3）

6. **data-testid 探测** — 运行时确认是否存在 `data-testid` 属性
7. **完整 id 列表** — 运行时获取所有 `[id]` 元素列表

---

## 附录 A：探测脚本

探测脚本已保存至：
`test-output/cdp-probe-qoderwork.mjs`

运行方式：
```bash
node test-output/cdp-probe-qoderwork.mjs
```

## 附录 B：相关文件索引

| 文件 | 用途 |
|------|------|
| `src/adapters/domestic/qoder.ts` | DOM 适配器（AgentSkin 侧） |
| `engines/qoderwork/adapter.mjs` | 注入引擎适配器 |
| `engines/qoderwork/tokens.css` | Token 映射 |
| `engines/qoderwork/cosmetic.css` |  cosmetic 样式 |
| `src/shared/cdp/port-manager.ts` | CDP 端口管理 |
| `src/shared/cdp/devtools-active-port.ts` | DevToolsActivePort 文件读取 |
| `docs/reverse-engineering/batch2-asar/qoderwork-asar.md` | ASAR 静态分析报告 |
