# ASAR 静态分析报告 — TRAE SOLO CN (traework Agent)

> 生成日期: 2026-08-31
> 目标应用: TRAE SOLO CN v0.1.60 (tronBuildVersion 2.3.79029)
> 安装路径: `C:\Users\snowb\AppData\Local\Programs\TRAE SOLO CN`
> 架构类型: **VS Code OSS 散文件布局（无 ASAR 包）**
> 分析方式: 静态文件遍历 + 源码逆向 + 现有引擎交叉验证

---

## 1. 文件拓扑

### 1.1 目录树（关键节点）

```
TRAE SOLO CN/
├── TRAE SOLO CN.exe                    ← Electron 主进程入口
├── vcruntime140.dll, msvcp140.dll      ← VC++ 运行时
├── ffmpeg.dll, vk_swiftshader.dll      ← 媒体/图形
├── resources/
│   └── app/
│       ├── product.json                ← 应用元数据（版本、协议、扩展清单）
│       ├── out/
│       │   ├── main.js                 ← 主进程（Electron main, ~8315 行源码）
│       │   ├── cli.js                  ← CLI 入口
│       │   └── vs/
│       │       ├── code/electron-browser/
│       │       │   └── solo/
│       │       │       ├── solo-lite.html      ★ 主窗口 HTML 入口
│       │       │       ├── workbench.js        ★ 渲染进程引导脚本
│       │       │       └── arch-mismatch.html  ← 架构不匹配提示页
│       │       ├── workbench/
│       │       │   └── workbench.desktop.main.solo-lite.{js,css}  ★ 工作台核心
│       │       └── platform/           ← VS Code 平台层（配置、扩展、IPC）
│       ├── node_modules/
│       │   └── @byted-icube/
│       │       ├── solo-lite/dist/     ← TRAE Solo Lite React 应用
│       │       │   ├── index.mjs       ← Solo Lite ESM 入口
│       │       │   └── index.css       ← Solo Lite 样式（CSS 变量定义）
│       │       ├── desktop-modules/    ← 桌面端模块
│       │       ├── ai-modules-chat/    ← AI 聊天模块
│       │       └── bundled-deps/       ← 捆绑的 React 等依赖
│       └── extensions/                 ← 内置扩展
│           ├── byted-solo.builtin-mcp/ ← MCP 内置扩展
│           └── cloudide.icube-*/       ← iCube 集成扩展
└── aha_doctor/                         ← 诊断工具
```

### 1.2 关键文件说明

| 文件 | 角色 | 大小/行数 |
|------|------|----------|
| `solo-lite.html` | 主窗口 HTML 入口，加载 workbench.js | 55 行 |
| `workbench.js` | 渲染进程引导：importmap 配置、CSS 加载、模块引导 | 7 行（压缩前 ~200） |
| `workbench.desktop.main.solo-lite.js` | 工作台核心 JS（Monaco Editor + VS Code 平台） | 8315 行（压缩） |
| `workbench.desktop.main.solo-lite.css` | 工作台核心 CSS（~1.2MB，含 Monaco Editor 全部样式） | ~1.2MB |
| `@byted-icube/solo-lite/dist/index.css` | Solo Lite 应用样式（icube 设计令牌） | ~37 行（入口） |
| `main.js` | Electron 主进程（窗口管理、IPC、扩展主机） | ~8000+ 行（压缩） |
| `product.json` | 应用配置（版本、协议名、内置扩展清单） | ~76KB |

---

## 2. 入口点分析

### 2.1 HTML → JS → CSS 依赖链

```
solo-lite.html
├── <link> ../../../../node_modules/@byted-icube/solo-lite/dist/index.css
├── <script type="module"> ./workbench.js
│   ├── 创建 importmap（vscode-bootstrap-import-map）
│   │   ├── react / react-dom → @byted-icube/bundled-deps/compiled/react/
│   │   ├── katex → node_modules/katex/dist/katex.mjs
│   │   ├── @byted-icube/desktop-modules → dist/index.mjs
│   │   ├── @byted-icube/ai-modules-chat → dist/index.mjs
│   │   └── mutative → node_modules/mutative/dist/mutative.esm.js
│   ├── 动态加载 CSS（workbench.desktop.main.solo-lite.css 或 slim 变体）
│   ├── 动态加载 JS（workbench.desktop.main.solo-lite.js 或 slim 变体）
│   └── 触发模块加载：
│       ├── @byted-icube/solo-lite/dist/index.mjs  ← Solo Lite React 应用
│       └── @byted-icube/desktop-modules/dist/index.mjs
└── <div id="root">  ← React 挂载点
```

### 2.2 Slim/Full 模式切换

`workbench.js` 通过 `product.iCubeApp?.soloLiteAppSlimEnabled` 控制加载精简版（slim）或完整版：

- **Slim 模式**: `workbench.desktop.main.solo-lite-slim.js` + `.css`
- **Full 模式**: `workbench.desktop.main.solo-lite.js` + `.css`

### 2.3 多入口 HTML 文件

| HTML 文件 | 用途 |
|-----------|------|
| `solo-lite.html` | 主窗口（Solo Lite 模式） |
| `arch-mismatch.html` | 架构不匹配提示（Apple Silicon vs Intel） |
| `file-preview.html` | 文件预览窗口 |
| `icubeProcessExplorer.html` | iCube 进程浏览器 |
| `fake.html` / `index.html` | Webview 预加载页 |
| `webWorkerExtensionHostIframe.html` | 扩展主机 Worker iframe |

---

## 3. CSS Token 清单

### 3.1 命名空间概览

TRAE SOLO CN 使用 **三层 CSS 变量体系**：

| 命名空间 | 前缀 | 用途 | 数量级 |
|----------|------|------|--------|
| VS Code 标准 | `--vscode-*` | 编辑器/工作台标准令牌 | ~200+ |
| iCube 设计系统 | `--vscode-icube-*` | ByteDance 专有设计令牌 | ~80+ |
| 裸前缀 iube | `--bg-*`, `--text-*`, `--icon-*`, `--border-*` | 与 `--vscode-icube-*` 同义别名 | ~40+ |

### 3.2 iCube 设计令牌（--vscode-icube-*）

从 `traework-full-extract.json` 运行时提取 + 静态分析确认：

#### 背景色（colorBg*）

| 变量 | 默认值（dark） | 用途 |
|------|---------------|------|
| `--vscode-icube-colorBg1` | （透明覆盖目标） | 主背景 |
| `--vscode-icube-colorBg2` | 次级背景 | 面板/侧边栏 |
| `--vscode-icube-colorBg3` | 第三级背景 | 浮层/弹窗 |
| `--vscode-icube--bg-bg-base-default` | `transparent` | 应用根背景 |
| `--vscode-icube--bg-bg-base-secondary` | 侧边栏背景 | 任务列表底色 |
| `--vscode-icube--bg-bg-base-tertiary` | 第三级背景 | |
| `--vscode-icube--bg-bg-menu` | 菜单背景 | |
| `--vscode-icube--bg-bg-tooltip` | 工具提示背景 | |
| `--vscode-icube--bg-bg-input` | 输入框背景 | |
| `--vscode-icube--bg-bg-overlay-l1~l4` | 透明叠加层 | hover/focus/active |
| `--vscode-icube--bg-bg-invert` | 反转背景 | 工具提示 |
| `--vscode-icube--bg-bg-brand` | 品牌色背景 | 按钮/品牌元素 |
| `--vscode-icube--bg-bg-white` | 白色表面 | 工具栏胶囊 |

#### 文本色（colorText*）

| 变量 | 默认值（dark） | 用途 |
|------|---------------|------|
| `--vscode-icube-colorDefaultText` | 主文本 | 默认文字 |
| `--vscode-icube-colorHighlightText` | 高亮文本 | 选中/强调 |
| `--vscode-icube-colorTextGray` | `#9599a6` | 次要文本 |
| `--vscode-icube-colorGrayText` | 灰色文本 | 描述/占位符 |
| `--vscode-icube-colorDisableText` | 禁用文本 | 禁用状态 |
| `--vscode-icube--text-text-default` | 主文本 | |
| `--vscode-icube--text-text-secondary` | 次要文本 | |
| `--vscode-icube--text-text-tertiary` | 第三级文本 | |
| `--vscode-icube--text-text-brand` | 品牌文本 | 链接/品牌 |
| `--vscode-icube--text-text-onaccent` | 强调色上文本 | 按钮文字 |
| `--vscode-icube--text-text-disabled` | 禁用文本 | |

#### 图标色（icon-icon*）

| 变量 | 默认值（dark） | 用途 |
|------|---------------|------|
| `--vscode-icube--icon-icon-default` | 主图标色 | |
| `--vscode-icube--icon-icon-default-hover` | 悬停图标色 | |
| `--vscode-icube--icon-icon-secondary` | 次要图标色 | |
| `--vscode-icube--icon-icon-tertiary` | 第三级图标色 | |
| `--vscode-icube--icon-icon-onaccent` | 强调色上图标 | |
| `--vscode-icube--icon-icon-disabled` | 禁用图标色 | |
| `--vscode-icube--icon-icon-white` | `#fff` | 纯白图标 |

#### 边框/分割线

| 变量 | 用途 |
|------|------|
| `--vscode-icube-colorLine1` | 主分割线 |
| `--vscode-icube-colorLine2` | 次级分割线 |
| `--vscode-icube--border-border-neutral-l1~l3` | 中性边框层级 |

#### 品牌/强调色

| 变量 | 用途 |
|------|------|
| `--vscode-icube-colorBrand` | 品牌主色 |
| `--vscode-icube-colorBrandTransparent` | 品牌透明色（rgba(224,226,242,0.05)） |
| `--vscode-icube-colorBtnHover` | 按钮悬停色 |
| `--vscode-icube-colorBtnHover2` | 按钮悬停色 2 |

#### 功能色

| 变量 | 用途 |
|------|------|
| `--vscode-icube-modalOverlay` | 模态遮罩（rgba(0,0,0,0.4)） |
| `--vscode-icube-checkboxDisabledBackground` | 禁用复选框背景（#666b75） |
| `--vscode-icube-emptyExplorerSplitColor` | 空资源管理器分割色 |
| `--vscode-icube--status-alert-surface-l3` | 告警表面色 |
| `--vscode-icube--text-text-preformat-foreground` | 预格式化文本色 |

### 3.3 裸前缀令牌（--bg-*, --text-*, --icon-*, --border-*）

TRAE 同时声明了 `--vscode-icube-*` 和裸前缀两个版本，值完全相同：

```css
--bg-bg-base-default  ≡  --vscode-icube--bg-bg-base-default
--text-text-default   ≡  --vscode-icube--text-text-default
--icon-icon-default   ≡  --vscode-icube--icon-icon-default
--border-border-neutral-l2  ≡  --vscode-icube--border-border-neutral-l2
```

**注入策略**: 必须同时覆盖两个命名空间（tokens.css 已实现）。

### 3.4 VS Code 标准令牌（--vscode-*）

标准 VS Code 令牌用于 Monaco Editor 和工作台核心：

| 类别 | 关键变量 |
|------|---------|
| 编辑器 | `--vscode-editor-background`, `--vscode-editor-foreground`, `--vscode-editor-selectionBackground` |
| 侧边栏 | `--vscode-sideBar-background`, `--vscode-sideBar-foreground` |
| 面板 | `--vscode-panel-background`, `--vscode-panel-border` |
| 输入 | `--vscode-input-background`, `--vscode-input-foreground`, `--vscode-input-placeholderForeground` |
| 列表 | `--vscode-list-hoverBackground`, `--vscode-list-activeSelectionBackground` |
| 按钮 | `--vscode-button-background`, `--vscode-button-foreground`, `--vscode-button-hoverBackground` |
| 链接 | `--vscode-textLink-foreground`, `--vscode-textLink-activeForeground` |
| 滚动条 | `--vscode-scrollbarSlider-background`, `--vscode-scrollbarSlider-hoverBackground` |
| 菜单 | `--vscode-menu-background`, `--vscode-menu-foreground`, `--vscode-menu-border` |
| 下拉 | `--vscode-dropdown-background`, `--vscode-dropdown-foreground`, `--vscode-dropdown-border` |
| 复选框 | `--vscode-checkbox-background`, `--vscode-checkbox-foreground`, `--vscode-checkbox-border` |
| 标题栏 | `--vscode-titleBar-activeBackground`, `--vscode-titleBar-inactiveBackground` |
| 状态栏 | `--vscode-statusBar-background` |
| 活动栏 | `--vscode-activityBar-background` |

---

## 4. Fragility Seeds（锚点稳定性评估）

### 4.1 高稳定性锚点（推荐使用）

| 锚点 | 类型 | 稳定性依据 | 用途 |
|------|------|-----------|------|
| `#root` | ID | React 挂载点，唯一且稳定 | 艺术层 ::before |
| `.solo-lite-layout` | class | CDP 确认 11 个匹配（主容器） | 主表面穿透 |
| `.task-list-base` | class | 任务列表容器，BEM-ish 命名 | 侧边栏玻璃效果 |
| `.task-list-panel` | class | 任务面板，与 base 同构 | 侧边栏玻璃效果 |
| `.solo-lite-chat-panel-container` | class | CDP 确认（chat 面板容器） | 聊天区穿透 |
| `.solo-lite-panel-box-shadow` | class | 面板阴影容器 | 阴影清除 |
| `.solo-lite-panel-border` | class | 面板边框容器 | 边框重主题化 |
| `html.solo-lite` | body class | CDP 确认稳定 | 全局作用域 |
| `html.icube-simple-style` | body class | CDP 确认稳定 | iCube 简约模式 |
| `html.theme-icube` | body class | CDP 确认稳定 | iCube 主题 |
| `html.vs-dark` / `html.dark` | body class | CDP 确认稳定 | 暗色模式 |
| `html.windows` | body class | CDP 确认稳定 | Windows 平台 |
| `.monaco-workbench` | class | VS Code 核心类名，跨版本稳定 | 令牌覆盖 |
| `[data-trae-ref]` | data attr | TRAE 专有浏览器自动化标记（17+ 元素） | 浏览器自动化 UI |

### 4.2 中稳定性锚点（条件使用）

| 锚点 | 类型 | 稳定性依据 | 条件 |
|------|------|-----------|------|
| `.chat-input-v2-input-box-editable` | class | 聊天输入框（contenteditable） | 仅 chat-view |
| `.chat-input-v2-editor-part` | class | 编辑器外层 | 仅 chat-view |
| `.chat-input-v2-send-button` | class | 发送按钮 | 仅 chat-view |
| `.messageInputContainer` | class | 消息输入容器 | 仅 chat-view |
| `.messageInputChatInput` | class | 消息输入聊天区 | 仅 chat-view |
| `.task-list-new-task-item` | class | 任务行（probe-verified） | 仅 task-view |
| `.task-list-skills-item` | class | 技能行 | 仅 task-view |
| `.task-list-group-new-btn` | class | 新建组按钮 | 仅 task-view |
| `.task-list-shadow-bottom` | class | 侧边栏底部阴影 | 仅 task-view |
| `[class*="mode-switcher-btn"]` | class | 模式切换按钮 | 视图切换时 |
| `[class*="message-bubble"]` | class | 消息气泡 | 有聊天内容时 |
| `[class*="user-message__text-box"]` | class | 用户消息文本框 | 有聊天内容时 |
| `[role="dialog"]` | ARIA | 对话框 | 弹窗出现时 |
| `[role="menu"]` | ARIA | 菜单 | 菜单展开时 |
| `[role="tab"]` + `[aria-selected]` | ARIA | 标签页 | 始终稳定 |

### 4.3 低稳定性锚点（避免使用）

| 锚点 | 风险 | 原因 |
|------|------|------|
| `[class*="item"]` | 过度匹配（105+ 元素） | 通用子串 |
| `[class*="message"]` | 过度匹配（120+ 元素） | 含 messageInput* |
| `[class*="active"]` | 过度匹配 | 通用状态类 |
| `[class*="segmented"]` | 未使用 | TRAE 无此模式 |
| `.panel-container` | CDP 未找到 | 不存在于 DOM |
| `[data-testid]` | 未发现 | TRAE 使用 data-trae-ref |

### 4.4 锚点稳定性分级

```
High (稳定)     ████████████████████  #root, .solo-lite-layout, .task-list-base, body classes
Medium (条件)   ████████████          .chat-input-v2-*, .task-list-new-task-item
Low (避免)      ████                  [class*="item"], [class*="message"]
```

---

## 5. 架构摘要

### 5.1 CSP 策略

**主窗口**: 未发现显式 CSP 头（VS Code OSS 默认策略）。

**Widget Sandbox**（动态 UI 渲染）:
```
Content-Security-Policy:
  default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:;
  script-src 'self' 'unsafe-inline' 'unsafe-eval' https:;
  style-src 'self' 'unsafe-inline' https:;
  img-src * data: blob:;
  connect-src 'self' https: data: blob:;
  frame-src 'self' blob: data:;
```

**评估**: CSP 较为宽松（`unsafe-inline` + `unsafe-eval`），对 adoptedStyleSheets 注入无阻碍。

### 5.2 安全机制

| 机制 | 状态 | 依据 |
|------|------|------|
| contextIsolation | ✅ 启用 | `main.js` webPreferences 配置 |
| sandbox | ✅ 启用 | `main.js` + WebPageLoader 使用 sandbox:true |
| webSecurity | ✅ 启用 | VS Code OSS 默认 |
| nodeIntegration | ❌ 禁用 | Electron 安全最佳实践 |
| 自定义协议 | `solo-cn://` | product.json 声明 |

### 5.3 注入机制

| 注入面 | 方式 | 优先级 |
|--------|------|--------|
| `adoptedStyleSheets` | CSSStyleSheet.replaceSync() | 主注入通道 |
| `<link>` 标签 | 动态创建 stylesheet link | 宿主原生 CSS |
| `importmap` | type="importmap" script | 模块路径映射 |
| inline style | element.style.setProperty() | 启发式守卫 |
| `@font-face` | 内联 @font-face 声明 | 字体加载 |

### 5.4 窗口结构

```
主窗口 (BrowserWindow)
├── solo-lite.html (主工作台)
│   ├── #root (React 应用)
│   │   ├── .solo-lite-layout (flex 容器)
│   │   │   ├── .task-list-base (侧边栏/任务列表)
│   │   │   └── .solo-lite-chat-panel-container (聊天面板)
│   │   │       ├── .chat-input-v2-* (输入区)
│   │   │       └── 消息列表
│   └── Monaco Editor (代码编辑器)
├── arch-mismatch.html (架构不匹配提示)
├── file-preview.html (文件预览)
├── icubeProcessExplorer.html (进程浏览器)
└── Widget Sandbox (localhost 动态 UI)
```

### 5.5 IPC 暴露面

| 通道方向 | 通道名模式 | 用途 |
|----------|-----------|------|
| sandbox → main | `vscode:sandbox::main-invoke-*` | 沙箱调用主进程 |
| main → sandbox | `vscode:main::sandbox-send-*` | 主进程推送沙箱 |
| main → sandbox | `vscode:main::sandbox-broadcast-*` | 主进程广播 |
| iCube IPC | `vscode:icube:*` | iCube 专有通信 |

---

## 6. 与现有引擎的匹配度评估

### 6.1 引擎文件清单

| 文件 | 状态 | 匹配度 |
|------|------|--------|
| `engines/traework/adapter.mjs` | ✅ 存在 | 高 — 结构层 CSS + 令牌发现 + 自愈 |
| `engines/traework/tokens.css` | ✅ 存在 | 高 — 完整 icube 令牌覆盖 |
| `engines/traework/cosmetic.css` | ✅ 存在 | 高 — 滚动条/选择/动效 |
| `agent-rules/traework.theme.rule.json` | ✅ 存在 | 中 — 需补全 globalApiCandidates |
| `docs/apps/traework/ADAPTATION.md` | ✅ 存在 | 高 — 适配文档 |
| `docs/apps/traework/architecture.md` | ✅ 存在 | 高 — 架构文档 |
| `docs/apps/traework/fragility.md` | ✅ 存在 | 高 — 锚点稳定性文档 |

### 6.2 适配器覆盖度

| 覆盖维度 | 状态 | 说明 |
|----------|------|------|
| 艺术层 (#root::before) | ✅ | adapter.mjs STRUCTURAL_CSS |
| 侧边栏玻璃效果 | ✅ | .task-list-base/panel |
| 聊天面板穿透 | ✅ | .solo-lite-layout, chat-panel-container |
| 输入框玻璃效果 | ✅ | .chat-input-v2-input-box-editable |
| 消息气泡 | ✅ | [class*="message-bubble"] |
| 模式切换按钮 | ✅ | [class*="mode-switcher-btn"] |
| 用户消息文本框 | ✅ | .user-message__text-box |
| 导航遮罩 | ✅ | [class*="user-message-navigator__mask"] |
| 滚动条 | ✅ | cosmetic.css |
| 选择高亮 | ✅ | cosmetic.css |
| 令牌覆盖 | ✅ | tokens.css (80+ icube 变量) |
| 自愈机制 | ✅ | selfHeal + MutationObserver |
| 路由检测 | ✅ | task-view / chat-view |
| 选择器健康检查 | ✅ | checkSelectorHealth() |
| DeepCore 集成 | ✅ | DEEP_CONFIG 已配置 |
| data-trae-ref 锚点 | ✅ | cosmetic.css + adapter |

### 6.3 已知差距

| 差距 | 影响 | 建议 |
|------|------|------|
| `globalApiCandidates` 未填充 | 无法通过 API 静默切换主题 | 需运行时探测 |
| `globalStorePathCandidates` 未填充 | 无法定位全局状态路径 | 需运行时探测 |
| `canSilentSwitch: false` | 不支持静默切换 | 待验证 |
| Slim 模式差异未覆盖 | slim 模式可能有不同 DOM | 需额外探测 |
| 扩展主机 iframe | webWorkerExtensionHostIframe.html | 暂不影响注入 |

### 6.4 matchTarget 验证

现有适配器声明的 matchTarget: `['*/solo-lite.*', 'solo-lite', 'trae', 'traework']`

**验证结果**: ✅ 全部匹配
- URL: `vscode-file://vscode-app/.../solo-lite.html` → 匹配 `*/solo-lite.*`
- Body class: `solo-lite windows icube-simple-style theme-icube vs-dark dark` → 匹配 `solo-lite`
- 产品名: `trae-solo-cn` → 匹配 `trae`

---

## 7. 结论与建议

### 7.1 架构判定

TRAE SOLO CN 采用 **VS Code OSS + ByteDance iCube 设计系统** 的混合架构：
- 基于 VS Code 1.x 源码构建（Monaco Editor + 工作台平台）
- 通过 `@byted-icube/solo-lite` React 应用提供 AI 聊天界面
- 使用 `--vscode-icube-*` 三层令牌体系（icube 命名空间 + 裸前缀别名）
- 散文件布局（无 ASAR），便于静态分析

### 7.2 注入可行性

| 维度 | 评估 |
|------|------|
| 注入通道 | ✅ adoptedStyleSheets（CSP 无限制） |
| 令牌覆盖 | ✅ 三层命名空间均已映射 |
| 锚点稳定 | ✅ 高稳定性锚点充足 |
| 自愈机制 | ✅ 统一 selfHeal + MutationObserver |
| 安全风险 | 无（contextIsolation + sandbox 标准配置） |

### 7.3 后续行动

1. **补全 theme rule**: 填充 `globalApiCandidates` 和 `globalStorePathCandidates`（需运行时探测）
2. **Slim 模式验证**: 确认 slim 模式下的 DOM 差异
3. **扩展主机注入**: 评估 webWorkerExtensionHostIframe.html 是否需要注入
4. **运行时令牌发现**: 通过 `token-discovery.mjs` 验证完整 icube 变量集
