# ASAR 静态分析：QoderWork CN (`qoderwork`)

> 分析日期：2026-08-30
> 目标路径：`C:\Program Files\QoderWork CN\QoderWork CN\resources\app.asar`
> 分析方式：二进制头部解析 + 字符串特征提取 + 散落资源目录审查
> Agent ID：`qoderwork`

---

## 1. 文件拓扑

### 1.1 目录树（顶层）

```
QoderWork CN/
├── QoderWork CN.exe              ← Electron 主程序
├── resources/
│   ├── app.asar                  ← 主 ASAR 包（~4MB+，含 node_modules + dist + 内嵌 HTML）
│   ├── app.asar.unpacked/        ← 解压目录（原生模块 WASM 等）
│   ├── app-update.yml            ← 更新配置（provider: generic, url: static.qoder.com.cn）
│   ├── canvas/
│   │   └── index.html            ← Canvas 渲染器（6.4MB，React 19 内联 bundle）
│   ├── writing/
│   │   └── index.html            ← Writing Editor 渲染器（3.7MB，React 19 内联 bundle）
│   ├── chrome-extension/         ← 浏览器扩展（content-scripts + popup）
│   ├── legokits/                 ← AI Slides / Canvas / Writing MCP 套件
│   │   ├── ai-slides/            ← 演示文稿生成（含 20+ 布局 HTML 模板）
│   │   ├── canvas/               ← 画布设计工具（含 40+ skill 示例）
│   │   └── writing/              ← 写作工具
│   ├── skills/                   ← 内置技能（docx/pdf/pptx/xlsx 等）
│   ├── skills-market/            ← 技能市场元数据
│   ├── plugins-example/          ← 插件示例（1688/财富管理/投研等）
│   ├── migrations/               ← SQLite 迁移脚本（38+ 个）
│   ├── dynamic-text/             ← 国际化字符串（qoder-work.json）
│   ├── awareness-templates/      ← AI 人格模板（AGENTS.md/SOUL.md）
│   ├── native-messaging-host/    ← 本地消息桥
│   ├── qoder-auth-wasm/          ← 认证 WASM 模块
│   └── vm-boot/                  ← 虚拟机启动环境
├── locales/                      ← Electron i18n（52 个语言包）
└── *.dll / *.pak                 ← Chromium/Electron 原生依赖
```

### 1.2 ASAR 内部结构（头部解析）

ASAR 头部 JSON 揭示内部以 `node_modules` 为根组织：

```
app.asar/
├── node_modules/
│   ├── @ali/
│   │   └── qoder-config-service-sdk/   ← 阿里内部配置服务 SDK
│   │       ├── dist/ (cache/, config-client.js, constants.js, diff.js, ...)
│   │       ├── src/ (TypeScript 源码)
│   │       └── package.json (v0.2.0)
│   ├── @arms/
│   │   └── rum-core/                   ← ARMS RUM 监控 SDK（会话/采集/上报）
│   ├── @azure/
│   │   └── msal-common/                ← Microsoft 认证库（v15.16.1）
│   ├── @modelcontextprotocol/
│   │   └── sdk/                        ← MCP 协议 SDK
│   ├── @alicloud-emas/
│   │   └── httpdns/                    ← 阿里云 HTTPDNS SDK
│   ├── axios/ (v0.27.2)
│   ├── rrweb/                          ← 会话录制（rrweb 协议）
│   ├── codemirror/ (@codemirror/view, @codemirror/state, ...)
│   └── ... (大量 Electron/Node 依赖)
├── dist/
│   ├── index.cjs                       ← 主进程入口（推测）
│   └── preload.cjs                     ← 预加载脚本
└── [内联 HTML/JS/CSS bundle]
```

### 1.3 关键文件说明

| 文件 | 大小 | 说明 |
|------|------|------|
| `app.asar` | ~4MB+ | 主进程 + 内联渲染器 bundle |
| `canvas/index.html` | 6.4MB | Canvas 工具（React 19.2.1 内联生产 bundle） |
| `writing/index.html` | 3.7MB | Writing Editor（React 19.2.1 内联生产 bundle） |
| `chrome-extension/popup.html` | ~0.7KB | 浏览器扩展 popup（qoder-design token 定义） |
| `app-update.yml` | 4行 | 自动更新配置 |

---

## 2. 入口点分析

### 2.1 HTML 入口 → JS → CSS 依赖链

#### 主窗口（Main Window）
```
app.asar (主进程)
  → dist/index.cjs (Electron main)
    → BrowserWindow.loadURL('file://.../index.html')
      → 内联 <script type="module"> (React 19 + 应用代码)
        → --color-* CSS 变量（qoder-design token 系统）
```

#### Canvas 渲染器
```
canvas/index.html (6.4MB)
  → 内联 <script type="module" crossorigin>
    → React 19.2.1 (react-jsx-runtime, react-dom-client)
    → 应用组件（内联）
    → --color-* CSS 变量
```

#### Writing 渲染器
```
writing/index.html (3.7MB)
  → 内联 <script type="module" crossorigin>
    → React 19.2.1 (react-jsx-runtime, react-dom-client)
    → 应用组件（内联）
    → --color-* CSS 变量
```

#### Chrome Extension Popup
```
chrome-extension/popup.html
  → <style> 内联（:qoder-design token 定义）
  → popup.js（模块脚本）
```

### 2.2 Preload 脚本

ASAR 中存在 `dist/preload.cjs`，通过以下机制注册：
- `session.registerPreloadScript({ type: 'frame', filePath })` — Electron 34+ 新 API
- 降级：`session.setPreloads([...])` — 传统方式

RUM preload（`arms-rum-preload.cjs`）被写入临时目录后注册到所有 session（含自定义 partition）。

### 2.3 多窗口结构

ASAR 中检测到以下独立渲染器页面声明：

| 渲染器 | 路径 | 用途 |
|--------|------|------|
| `main` | `index.html`（内嵌） | 主工作区 |
| `voice-overlay` | `voice-overlay.html` | 语音输入覆盖层 |
| `mcp-app-preview` | `mcp-app-preview.html` | MCP 应用预览 |
| `artifact-preview` | `artifact-preview.html` | 产物预览面板 |
| `quickpick` | `quickpick.html` | 命令面板 |
| `canvas` | `resources/canvas/index.html` | 画布设计工具 |
| `writing` | `resources/writing/index.html` | 写作编辑器 |

---

## 3. CSS Token 清单

### 3.1 命名空间：`--color-*`（qoder-design 系统）

QoderWork CN 使用完整的 `--color-*` CSS 变量体系。从 popup.html 和 ASAR 内容提取：

#### Primary / Brand
```css
--color-primary: #73CD94;
--color-primary-hover: #8EE5A1;
--color-primary-text: #FDFDFD;
--color-primary-bg; --color-primary-bg-hover;
--color-primary-border; --color-primary-border-hover;
--color-text-on-primary: #FDFDFD;
```

#### Text Hierarchy
```css
--color-text: #141414;
--color-text-secondary: #638261;
--color-text-tertiary: #838280;
--color-text-quaternary;
--color-text-base;
--color-muted; --color-muted-foreground;
--color-text-inverse; --color-text-ghost;
--color-text-info; --color-text-danger; --color-text-success; --color-text-warning; --color-text-disabled;
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
--color-border-inverse; --color-border-ghost;
--color-border-info; --color-border-danger; --color-border-success; --color-border-warning; --color-border-disabled;
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
--color-error: #FF4D4F; --color-error-bg: #FFF2F0;
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

### 3.2 命名空间：`--bg-*`（popup 局部）

```css
--bg: #FDFDFD;
--bg-highlight: #080807;
--bg-highlight-hover: #2a2a29;
```

### 3.3 命名空间：`--text-*`（popup 局部）

```css
--text: #141414;
--text-secondary: #638261;
--text-tertiary: #838280;
--text-on-primary: #FDFDFD;
```

### 3.4 命名空间：`--border-*` / `--fill-*`（popup 局部）

```css
--border: #E6E6E6;
--fill: #EFEFEF;
--fill-tertiary: #F9F9F9;
```

### 3.5 命名空间：`--radius-*` / `--shadow-*`（popup 局部）

```css
--radius: 8px;
--radius-sm: 6px;
--radius-lg: 16px;
--shadow-card: 0 4px 6px -1px rgba(0,0,0,0.06), 0 2px 4px -2px rgba(0,0,0,0.04);
--shadow-card-primary: 0 10px 15px -3px rgba(115,205,148,0.08), ...;
```

### 3.6 命名空间：`--primary-*`（popup 局部）

```css
--primary: #73CD94;
--primary-hover: #8EE5A1;
--primary-text: #FDFDFD;
```

### 3.7 命名空间：`--success` / `--error` / `--warning`（popup 局部）

```css
--success: #73CD94;
--error: #FF4D4F;
--error-bg: #FFF2F0;
--warning: #FAAD14;
```

### 3.8 变量总数估计

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

## 4. Fragility Seeds（锚点稳定性评估）

### 4.1 高稳定性锚点（High）

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

### 4.2 中稳定性锚点（Medium）

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

### 4.3 低稳定性锚点（Low）

| 锚点 | 类型 | 依据 |
|------|------|------|
| CSS Modules hash 类名 | class | 编译时生成，版本间变化 |
| 内联 style 属性 | style | 动态计算，不可预测 |
| `[class*="voice-overlay"]` | class pattern | 语音覆盖层（推测） |
| `[class*="mcp-preview"]` | class pattern | MCP 预览（推测） |
| `[class*="artifact-preview"]` | class pattern | 产物预览（推测） |
| `[class*="quickpick"]` | class pattern | 命令面板（推测） |

### 4.4 Top 10 锚点（按注入价值排序）

1. `#root` — 全局艺术层锚点
2. `html.agentskin-host-qoderwork:root` — token 覆盖选择器
3. `.agents-layout-root` / `.agents-layout-body` — 布局透明化
4. `.agents-sidebar` — 侧边栏玻璃效果
5. `.chat-input-editor-text` — 输入框焦点环
6. `[data-active="true"]` — 导航激活态
7. `[data-resizable-sidebar]` — 右侧面板玻璃效果
8. `[role="dialog"]` — 对话框覆盖层
9. `.cm-editor` / `.cm-content` — 代码编辑器
10. `button[class~="group/extensions-nav"]` — 导航按钮 hover

---

## 5. 架构摘要

### 5.1 CSP 策略

ASAR 中检测到 `EditorView.cspNonce`（CodeMirror 6），表明编辑器使用 CSP nonce 机制。
- 主进程可能设置 `Content-Security-Policy` 头
- CodeMirror 使用 `nonce` 属性绕过 CSP 对内联样式的限制
- 注入时需保留 nonce 或采用 `adoptedStyleSheets`（不受 CSP nonce 限制）

### 5.2 注入机制

| 机制 | 状态 | 说明 |
|------|------|------|
| `adoptedStyleSheets` | 已使用 | 主注入方式（adapter 已验证） |
| `contextBridge.exposeInMainWorld` | 宿主使用 | RUM 暴露 `ArmsEventBridge` |
| `session.registerPreloadScript` | 宿主使用 | RUM preload 注册 |
| `session.setPreloads` | 降级方案 | 传统 preload 注册 |
| `BrowserWindow` API | 宿主使用 | 主窗口创建 |
| `protocol` API | 宿主使用 | 自定义协议处理 |
| `ipcMain` / `ipcRenderer` | 宿主使用 | IPC 通信 |
| `crashReporter` | 宿主使用 | 崩溃上报 |
| `powerMonitor` | 宿主使用 | 电源监控 |

### 5.3 安全配置

| 配置项 | 值 | 依据 |
|--------|-----|------|
| `contextIsolation` | 启用（推测） | `contextBridge.exposeInMainWorld` 使用 |
| `sandbox` | 部分（auth frame） | `sandbox="allow-scripts allow-same-origin allow-forms"` |
| `nodeIntegration` | 禁用（推测） | 现代 Electron 默认 |
| `webSecurity` | 启用（推测） | 现代 Electron 默认 |

### 5.4 IPC 暴露面

| 通道 | 方向 | 用途 |
|------|------|------|
| `arms:rum-bridge` | renderer → main | RUM 数据上报 |
| `arms-rum-preload.cjs` | preload → renderer | RUM 桥接 |
| 标准 Electron IPC | 双向 | 应用业务逻辑 |

### 5.5 第三方 SDK 集成

| SDK | 用途 | 版本 |
|-----|------|------|
| `@arms/rum-core` | 实时监控（ARMS） | 0.0.4（electron 适配层） |
| `@ali/qoder-config-service-sdk` | 配置中心 | 0.2.0 |
| `@alicloud-emas/httpdns` | HTTPDNS 解析 | 1.0.0 |
| `@azure/msal-common` | Microsoft 认证 | 15.16.1 |
| `@modelcontextprotocol/sdk` | MCP 协议 | 2026-01-26 |
| `rrweb` | 会话录制 | 内联 bundle |
| `CodeMirror 6` | 代码编辑器 | @codemirror/view + state |
| `axios` | HTTP 客户端 | 0.27.2 |

### 5.6 主入口

ASAR 中检测到 `dist/index.cjs`（main 字段）和 `dist/preload.cjs`（preload 字段），符合标准 Electron 应用结构。

---

## 6. 与现有引擎的匹配度评估

### 6.1 现有适配器状态

| 组件 | 路径 | 状态 |
|------|------|------|
| `adapter.mjs` | `engines/qoderwork/adapter.mjs` | ✅ 完整（622 行） |
| `tokens.css` | `engines/qoderwork/tokens.css` | ✅ 完整（173 行） |
| `cosmetic.css` | `engines/qoderwork/cosmetic.css` | ✅ 完整（46 行） |
| DOM 适配器 | `src/adapters/domestic/qoder.ts` | ✅ 完整（40 行） |

### 6.2 匹配度矩阵

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
| 渲染器检测 | 5 种（main/voice/mcp/artifact/quickpick） | 7 种（含 canvas/writing） | ⚠️ 需补充 |
| CodeMirror | 未覆盖 | `.cm-editor/.cm-content` | ⚠️ 需补充 |
| RUM 冲突 | 未处理 | `arms:rum-bridge` preload | ⚠️ 需注意 |
| CSP nonce | 未处理 | `EditorView.cspNonce` | ⚠️ 需注意 |

### 6.3 差距与建议

#### 6.3.1 渲染器覆盖扩展（P1）

ASAR 分析确认存在 7 种渲染器页面，现有 adapter 覆盖 5 种。缺失：

- **`canvas`** — `resources/canvas/index.html`（6.4MB React 19 bundle）
- **`writing`** — `resources/writing/index.html`（3.7MB React 19 bundle）

建议：在 `detectRendererType()` 中增加 `canvas` 和 `writing` 路径检测。

#### 6.3.2 CodeMirror 编辑器适配（P2）

ASAR 内检测到 CodeMirror 6（`@codemirror/view`, `@codemirror/state`），编辑器使用 CSP nonce。

建议：
- 为 `.cm-editor`、`.cm-content`、`.cm-line` 添加透明背景规则
- 使用 `adoptedStyleSheets` 绕过 CSP nonce 限制（已默认使用）

#### 6.3.3 RUM Preload 冲突（P2）

宿主注册 `arms-rum-preload.cjs` 到所有 session，通过 `contextBridge.exposeInMainWorld` 暴露 `ArmsEventBridge`。

影响：
- RUM preload 可能干扰 AgentSkin 的 CSS 注入时序
- `dom-ready` 事件注入的 JS 可能覆盖 adapter 的 `adoptedStyleSheets`

建议：
- 在 adapter 中增加对 `ArmsEventBridge` 存在的检测
- 使用 `window.__agentskin_sheet_manager__` 防御 RUM 脚本的样式清除

#### 6.3.4 CSP Nonce 处理（P3）

CodeMirror 使用 `EditorView.cspNonce` Facet，表明宿主 CSP 策略对内联样式有 nonce 要求。

影响：
- 直接插入 `<style>` 标签可能被 CSP 阻止
- `adoptedStyleSheets` 不受 CSP 限制（已使用，无影响）

建议：维持当前 `adoptedStyleSheets` 策略，无需额外处理。

### 6.4 总体评估

| 指标 | 评分 | 说明 |
|------|------|------|
| Token 覆盖 | 95% | `--color-*` 全量映射，popup 局部变量已覆盖 |
| 结构适配 | 90% | 核心布局类名已验证，canvas/writing 需补充 |
| 多窗口支持 | 70% | 5/7 渲染器已覆盖 |
| 安全兼容 | 85% | adoptedStyleSheets 绕过 CSP，RUM 冲突需关注 |
| 自愈能力 | 90% | MutationObserver + 2s 定时器 + 1.5s sheet guard |
| **综合匹配度** | **86%** | **良好，少量补充即可完整覆盖** |

---

## 7. 注入面总结

### 7.1 可注入点

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

### 7.2 注入风险

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| RUM preload 清除样式 | 中 | `adoptedStyleSheets` + sheet guard interval |
| React 重渲染移除 host class | 低 | 2s 定时器重新注入 |
| CSP nonce 阻止 style 标签 | 低 | 使用 `adoptedStyleSheets`（已默认） |
| Canvas/Writing 渲染器未覆盖 | 中 | 补充 `detectRendererType()` 分支 |

---

## 附录 A：ASAR 头部结构（片段）

```
Offset 0:  04 00 00 00 7C 7D 3E 00  (pickle size = 8,124,796)
Offset 8:  64 7D 3E 00                  (header JSON size = 8,124,788)
Offset 12: 02 00 00 00                  (version = 2)
Offset 16: {"files":{"node_modules":{"files":{"@ali":{"files":...
```

ASAR 总大小约 8MB+（含 432 个 `"files"` 节点），包含完整的 `node_modules` 依赖树。

## 附录 B：关键字符串索引

| 字符串 | 偏移 | 上下文 |
|--------|------|--------|
| `@ali/qoder-config-service-sdk` | 头部 | 配置服务 SDK |
| `@arms/rum-core` | ~19204 | RUM 监控 |
| `arms:rum-bridge` | ~19204 | IPC 通道名 |
| `arms-rum-preload.cjs` | ~19322 | Preload 文件名 |
| `BrowserWindow` | ~19223 | Electron API |
| `EditorView.cspNonce` | ~354789 | CodeMirror CSP |
| `authFrame.setAttribute("sandbox"` | ~99888 | 认证 frame 沙箱 |
| `@azure/msal-common` | ~195147 | 认证库 |
| `@modelcontextprotocol/sdk` | ~646811 | MCP SDK |
| `qoderwork` | ~4713 | 客户端类型标识 |
