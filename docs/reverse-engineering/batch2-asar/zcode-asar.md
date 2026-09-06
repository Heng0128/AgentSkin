# ASAR 静态分析报告 — ZCode (zcode Agent)

> 分析日期：2026-08-30 | 目标版本：ZCode v3.7.7 | ASAR 大小：297,238,899 bytes (~283 MB)
> 安装路径：`C:\Program Files\ZCode` | ASAR 路径：`resources\app.asar`
> 数据来源：静态 ASAR 解包 (`extract-summary.md/json`) + CDP 运行时快照 (`cdp-summary.json`) + 现有引擎文件

---

## 1. 文件拓扑

### 1.1 包身份

| 项 | 值 |
|----|----|
| 包格式 | Electron ASAR (app.asar + app.asar.unpacked) |
| 安装器 | Squirrel (ZCode.exe + Uninstall ZCode.exe) |
| 产品名 | ZCode (@zcode/desktop) |
| 版本 | 3.7.7 |
| 渲染 URL | `file:///C:/Program%20Files/ZCode/resources/app.asar/out/renderer/index.html` |
| 渲染框架 | React 19 + Tailwind v4 + Vite 构建 |
| 挂载点 | `#root` |
| Chromium Profile | `%APPDATA%\ZCode\session\` |
| DevTools 端口文件 | `%APPDATA%\ZCode\session\DevToolsActivePort` |

### 1.2 目录结构（关键路径）

```
app.asar (283 MB)
├── out/
│   ├── renderer/                    ← 渲染进程
│   │   ├── index.html               ← 主入口 (file://)
│   │   ├── assets/
│   │   │   ├── preload-helper-BHSF1fZ9.js  ← Preload 辅助
│   │   │   ├── *.js                 ← 主渲染 JS chunks
│   │   │   └── *.css                ← 主渲染 CSS (7 张)
│   │   └── index.html               ← 主渲染页面
│   ├── preload/
│   │   ├── index.cjs                ← 主 Preload 脚本
│   │   ├── embeddedBrowserJavaScriptDialog.cjs  ← 嵌入式浏览器对话框
│   │   └── processMonitor.cjs       ← 进程监控器
│   └── main/                        ← 主进程 (Electron main)
├── glm/                             ← GLM 插件包
│   └── packages/
│       ├── android-emulator-plugin/
│       ├── browser-use-plugin/
│       ├── document-skills-plugin/
│       ├── ios-simulator-plugin/
│       └── ...
└── config/
    └── default.json                 ← 默认配置

app.asar.unpacked/                   ← 原生模块（不打包进 ASAR）
├── node_modules/
│   ├── node-pty/prebuilds/win32-x64/  ← 终端模拟 (conpty, winpty)
│   └── ssh2/lib/protocol/crypto/     ← SSH 加密原生模块
└── elevate.exe                      ← Windows 提权工具
```

### 1.3 Preload 脚本清单

| 文件 | 用途 |
|------|------|
| `out/renderer/assets/preload-helper-BHSF1fZ9.js` | 渲染进程 Preload 辅助 |
| `out/preload/index.cjs` | 主 Preload（IPC 桥接、contextBridge） |
| `out/preload/embeddedBrowserJavaScriptDialog.cjs` | 嵌入式浏览器 JS 对话框 |
| `out/preload/processMonitor.cjs` | 进程监控器 |

### 1.4 入口点分析

```
index.html
  ↓ 加载
out/renderer/assets/*.js (主 chunk)
  ↓ 执行
#root 挂载 React 应用
  ↓ 渲染
CSS 变量体系 (--color-* ×256, --tw-* ×46, --text-* ×23, ...)
```

**HTML 入口文件：**
- `out/renderer/index.html` — 主渲染入口（唯一 HTML 入口，单页应用）
- 无 `cua-permission-panel.html`、`process-monitor.html` 等独立 HTML（这些功能通过 React 路由/对话框实现）

**JS/CSS 依赖链：**
- 主 JS chunk 包含完整的 React 应用（对话视图、设置、终端、文件浏览等）
- CSS 通过 adoptedStyleSheets 或 `<style>` 标签注入（7 张样式表，0 CORS 错误）
- 使用 Tailwind v4 的 `@theme` 指令生成设计 token

---

## 2. CSS Token 清单

### 2.1 命名空间总览（:root 变量，每 scheme 390 个）

| 命名空间 | 数量 | 角色 | 注入策略 |
|---------|------|------|---------|
| `--color-*` | 256 | **主视觉层**（Tailwind v4 语义面） | 主题层全权接管（65+16 覆盖） |
| `--tw-*` | 46 | Tailwind 工具类变量 | 不注入（结构 token） |
| `--text-*` | 23 | 文本尺寸/行高 | 主题层产出（扁平语义段） |
| `--beam-*` | 14 | ZCode 特色光效 token | 保留原生 |
| `--container-*` | 10 | 容器查询阈值 | 不注入 |
| `--radius-*` | 7 | 圆角半径 | 不注入 |
| `--font-*` | 6 | 字体族 | 不注入 |
| `--blur-*` | 6 | 模糊半径 | 不注入 |
| `--default-*` | 4 | 默认值 | 不注入 |
| `--leading-*` | 4 | 行高 | 不注入 |
| `--tracking-*` | 4 | 字间距 | 不注入 |
| `--animate-*` | 3 | 动画关键帧 | 不注入 |
| `--ease-*` | 2 | 缓动函数 | 不注入 |
| `--animated-*` | 2 | 动画开关 | 不注入 |
| `--aspect-*` | 1 | 宽高比 | 不注入 |
| `--none-*` | 1 | 空值 | 不注入 |
| `--ui-*` | 1 | 功能面 token | 不注入 |

### 2.2 `--color-*` 主视觉语义族（256 个中的重点）

**主面（已桥接 5 个 + 主题层覆盖 65 个）：**

| 变量 | AgentSkin 角色 | 桥接方式 |
|------|---------------|---------|
| `--color-foreground` | text | bridge |
| `--color-foreground-subtle` | muted | bridge |
| `--color-accent` | accent | bridge |
| `--color-primary` | accent | bridge |
| `--color-border` | border | bridge |

**故意保留原生（art-transparent）：**
- `--color-background` — 透明，hero/壁纸可见
- `--color-surface` — 透明，hero art 透视
- `--bg-primary`, `--bg-base`, `--bg-canvas` — 透明通道

**次级面（主题层覆盖 16 个）：**
- `--color-card`, `--color-popover`, `--color-tooltip`, `--color-menu`
- `--color-sidebar`, `--color-panel`, `--color-input`, `--color-tab`
- `--color-subagent-node*`, `--color-plugin-node*`, `--color-skill-node*`

**终端 ANSI 16 色（保留原生，功能语义色）：**
- `--color-terminal-black/red/green/yellow/blue/magenta/cyan/white`
- `--color-terminal-bright-*`

### 2.3 静态 vs CDP 缺口（7 个命名空间）

| 命名空间 | 静态有、CDP 无 | 成因 |
|---------|---------------|------|
| `--highlight-*` | 2 vars | 可能来自未加载 chunk 或封闭 shadow root |
| `--markdown-*` | 2 vars | 可能来自未加载 chunk 或 CSS-in-JS |
| `--react-*` | 1 var | PDF.js text layer |
| `--spacing-*` | 1 var | Tailwind @theme 生成，CDP 聚合可能漏采 |
| `--attachment-*` | 1 var | 可能来自未加载 chunk |
| `--bg-*` | 1 var | 可能走 distributed/component-inline |
| `--side-*` | 1 var | 可能来自未加载 chunk |

---

## 3. Fragility Seeds（锚点稳定性评估）

### 3.1 data-testid 锚点（369 个命中）

**高稳定性锚点（推荐使用）：**

| data-testid | 出现次数 | 用途 |
|------------|---------|------|
| `chat-input` | 4 | 聊天输入框 |
| `chat-view` | 1 | 聊天视图容器 |
| `docx-editor-viewer` | 1 | DOCX 编辑器 |
| `plugin-store-config-input` | 2 | 插件商店配置 |
| `plugin-store-source-degraded` | 2 | 插件商店降级 |
| `plugin-store-group-toggle` | 2 | 插件商店分组 |

**动态 data-testid（使用 `:qr()` 模式，运行时生成）：**

| 模式 | 出现次数 | 说明 |
|------|---------|------|
| `:qr(Gr,e.sectionId)` | 3 | 章节锚点 |
| `:qr(An,e.taskId)` | 3 | 任务锚点 |
| `:qr(zn,n.key)` | 2 | 键值锚点 |
| `:qr(Or,e.key)` | 2 | 工作段锚点 |
| `:qr(sre,n)` | 2 | 会话锚点 |
| `:qr(Kn,e.key)` | 2 | 键值锚点 |
| `:qr(Br,e.id)` | 2 | 上传状态锚点 |
| `:qr(Yt,e.id)` | 2 | 上传重试锚点 |
| `:qr(ct,e.id)` | 2 | 卡片锚点 |
| `:qr(Let,e.key)` | 2 | 列表项锚点 |

### 3.2 其他 data-* 属性

| 属性 | 出现次数 | 稳定性 |
|------|---------|--------|
| `data-slot` | 133 | 高（Radix UI slot 标记） |
| `data-background` | 73 | 中 |
| `data-streamdown` | 51 | 中 |
| `data-column-number` | 45 | 高 |
| `data-line` | 45 | 高 |
| `data-state` | 43 | 高（Radix UI 状态） |
| `data-active` | 43 | 高 |
| `data-no-newline` | 42 | 中 |
| `data-separator-wrapper` | 41 | 中 |
| `data-gutter-buffer` | 39 | 中 |
| `data-image-thumbnail-trigger` | 26 | 中 |
| `data-disabled` | 21 | 高 |
| `data-precedence` | 17 | 中 |
| `data-plugin-id` | 17 | 高 |
| `data-additions` | 16 | 中 |
| `data-gutter` | 15 | 中 |
| `data-highlighted` | 14 | 中 |
| `data-line-annotation` | 14 | 中 |
| `data-code` | 14 | 中 |

### 3.3 稳定 class 锚点（非 hash，203 个）

**高稳定性（Tailwind 语义类）：**
- `.bg-background`, `.bg-background-win-alt`, `.bg-transparent`
- `.border-border`, `.border-l`, `.border-t`, `.border-transparent`
- `.dark`（暗色模式标记）
- `.data-[state=closed]:animate-collaps`（Radix 状态类）
- `.data-[state=open]:animate-collapsible-down`
- `.data-horizontal:flex-col`
- `.[app-region:drag]`, `.[app-region:no-drag]`（窗口拖拽区域）
- `.[scrollbar-gutter:stable]`
- `.@container/conversation`, `.@container/topoverlayer`（容器查询）

**中稳定性（Tailwind 工具类）：**
- `.absolute`, `.aspect-square`, `.duration`, `.duration-150`
- `.cursor-grab`, `.border`, `.border-0`, `.bg-clip-padding`

### 3.4 稳定性分级

| 等级 | 依赖点 | 崩溃概率 | 说明 |
|------|--------|---------|------|
| **Low** | `file://` 渲染面身份 | Unlikely | scheme 稳定 |
| **Low** | 原生 `:root` 变量（命名空间） | Unlikely | 设计系统 token，集中声明 |
| **Low** | 变量来源走原生快路径 | Unlikely | `documentElement` 计算即可覆盖 |
| **Medium** | DOM 树节点数 / 锚点集合 | Sometimes | 惰性渲染与空态影响采集 |
| **High** | 非 hash class 语义选择器 | Very likely | 非公开 API，随组件重构变化 |
| **High** | 组件 DOM 结构（div 层级） | Very likely | 布局重构即崩 |

---

## 4. 架构摘要

### 4.1 安全机制

| 机制 | 值 | 说明 |
|------|----|------|
| contextIsolation | `true` | 渲染进程与 preload 隔离 |
| webSecurity | `null` | 默认值（file:// 下无跨域） |
| sandbox | `"b"` | 启用沙箱 |
| CSP | `from=none` | 无内容安全策略（file:// 特性） |
| 核心 API 污染 | 无 | querySelectorAll/getComputedStyle/matchMedia/getPropertyValue 均为原生 |

### 4.2 注入机制

**注入通道：** CDP WebSocket → `Runtime.evaluate`（主进程侧发起）

**注入层（L0-L4）：**

| 层 | 引擎 | 注入方式 | 内容 |
|----|------|---------|------|
| L0 | engine-strategy | adoptedStyleSheets | CSS 变量桥接（5 个 `--color-*` → AgentSkin 角色） |
| L1 | engine-strategy | adoptedStyleSheets | tokens.css（占位，主题层全权） |
| L2 | adapter.mjs | adoptedStyleSheets + 元素级 inline | 结构适配（侧边栏毛玻璃、输入框、PDF.js、KaTeX） |
| L3 | HybridInjector | adoptedStyleSheets | 动态层（增量/全量/热替换） |
| L4 | DeepCore | adoptedStyleSheets (Shadow DOM) | 深度层（Shadow DOM + 路由） |

**CSS 变量桥接（bridge 字段）：**
```javascript
bridge: [
  { var: "--color-foreground", role: "text" },
  { var: "--color-foreground-subtle", role: "muted" },
  { var: "--color-accent", role: "accent" },
  { var: "--color-primary", role: "accent" },
  { var: "--color-border", role: "border" },
]
```

### 4.3 窗口结构

**主窗口（Main）：**
- 渲染 URL：`file:///.../out/renderer/index.html?restoreSession=true&supportsSettings=true&zcodeLaunchMarks=...`
- 单 frame，无多 frame / OOPIF
- DOM 规模：227-238 节点（视会话状态）
- 7 张样式表，0 CORS 错误

**设置窗口（Settings）：**
- 通过 React 路由/对话框实现（无独立 HTML 入口）
- 匹配模式：`*/settings*`, `*/preferences*`, `settings`

**其他窗口/面板：**
- 嵌入式浏览器对话框（`embeddedBrowserJavaScriptDialog.cjs`）
- 进程监控器（`processMonitor.cjs`）
- 权限请求面板（`cua-permission-panel` — 通过 React 组件实现）
- 文件预览（PDF.js、DOCX、PPTX、XLSX — 动态加载）

### 4.4 PDF.js 集成

- PDF.js 动态加载（用户打开 PDF 时触发）
- 页面 `.page` 保持白色背景（可读性）
- 工具栏/侧边栏应用毛玻璃效果
- CJK 字符映射（30+ bcmap 文件）
- 选择器：`.pdfViewer`, `.pdf-viewer`, `#toolbarViewer`, `#sidebarContainer`

### 4.5 KaTeX 集成

- KaTeX 动态加载（含公式的消息渲染时触发）
- 公式文字颜色跟随主题
- SVG 路径 `fill`/`stroke` 跟随 `currentColor`
- 选择器：`.katex`, `.katex-display`, `.katex .katex-html`

### 4.6 IPC 暴露面

| IPC 类型 | 计数 | 说明 |
|---------|------|------|
| `class:python` | 12 | Python LSP |
| `property:python` | 12 | Python 属性 |
| `node:sqlite` | 10 | SQLite 数据库 |
| `L:source` | 9 | 源码语言 |
| `L:text.html.markdown` | 8 | Markdown 语言 |
| `oauth:active_provider` | 7 | OAuth 提供商 |
| `xdp:xdp` | 6 | XDP 协议 |
| `zcode:task-notification-sound` | 6 | 任务通知音效 |
| `about:blank` | 5 | 空白页 |
| `openai:chat` | 5 | OpenAI 聊天 |
| `openai:messages` | 5 | OpenAI 消息 |

---

## 5. 与现有引擎的匹配度评估

### 5.1 适配器匹配

| 维度 | 现有引擎 | ASAR 分析结果 | 匹配度 |
|------|---------|-------------|--------|
| Agent ID | `zcode` | `zcode` | 完全匹配 |
| matchTarget | `['zcode', 'app.asar']` | URL/title 匹配 | 完全匹配 |
| 窗口角色 | Main + Settings | 主窗口 + 设置路由 | 完全匹配 |
| 渲染 URL | `file://` + `#root` | `file:///.../out/renderer/index.html` | 完全匹配 |
| 变量桥接 | 5 个 `--color-*` | 256 个 `--color-*` | 桥接覆盖 5/256（其余由主题层覆盖） |

### 5.2 引擎层匹配

| 文件 | 状态 | 说明 |
|------|------|------|
| `engines/zcode/adapter.mjs` | ✅ 完整 | 结构适配 + 自愈 + PDF.js/KaTeX 支持 |
| `engines/zcode/tokens.css` | ✅ 占位 | RFC A' 方案：主题层全权，引擎层 no-op |
| `engines/zcode/cosmetic.css` | ✅ 完整 | 选择器、滚动条、链接、代码块、动效 |
| `src/engine/src/adapters/zcode.mjs` | ✅ 完整 | 适配器定义 + bridge + verification |
| `src/adapters/domestic/zcode.ts` | ✅ 完整 | 连接管理 + 多窗口声明 |
| `src/main/cdp/injection/css-builders/zcode-css-builder.ts` | ✅ 完整 | CSS 构建器 + PDF.js/KaTeX 支持 |
| `src/shared/injection/contracts/zcode.contract.json` | ✅ 完整 | 验证契约（4 个 context） |

### 5.3 已知差距与风险

| 差距 | 严重度 | 缓解措施 |
|------|--------|---------|
| 7 个 token 命名空间静态有、CDP 无 | Low | 不纳入注入作用域（非核心渲染面） |
| 3 个 data-testid 未在 CDP 验证 | Low | 懒加载/空态影响，运行时动态检测 |
| 256 个 `--color-*` 仅覆盖 65+16 | Medium | 剩余为布局/图表/低使用率 token，不追全量 |
| Tailwind v4 语义面命名可能漂移 | Medium | 主题层按语义面覆盖，非按色值 |
| `#root` 选择器可能消失 | Low | Any: `["#root", "body"]` 兜底 |
| 第三方 hook 生态共存 | Low | 注入幂等 + MutationObserver 自愈 |

### 5.4 安全边界合规

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 不拦截 PermissionRequest | ✅ | 仅做视觉注入 |
| 不 hook AskUserQuestion | ✅ | 不模拟用户操作 |
| 不读取 token/session | ✅ | 不访问用户数据 |
| 不修改 app.asar | ✅ | 只读注入 |
| 不调用系统辅助功能 | ✅ | 仅 CDP 范围 |
| CSS 变量桥接声明式 | ✅ | bridge 字段纯声明 |

---

## 6. 注入面总结

### 6.1 可注入点

| 注入面 | 选择器 | 稳定性 | 用途 |
|--------|--------|--------|------|
| 根挂载 | `#root` | High | 主应用容器 |
| 主表面 | `main`, `[role="main"]` | High | 主内容区 |
| 侧边栏 | `[data-agentskin-sidebar]` | Medium | 导航/文件树 |
| 输入框 | `[data-agentskin-composer]` | Medium | 聊天输入 |
| 对话框 | `[role="dialog"]` | High | 弹窗/设置 |
| 菜单 | `[role="menu"]` | High | 上下文菜单 |
| 工具提示 | `[role="tooltip"]` | High | 悬浮提示 |
| PDF 查看器 | `.pdfViewer` | Medium | 文件预览 |
| KaTeX 公式 | `.katex` | Medium | 数学公式 |

### 6.2 注入约束

- **CSP**: `from=none` — 无 CSP 限制，注入自由
- **CORS**: 0 错误 — 无跨域阻断
- **API 污染**: 无 — 核心 API 均为原生
- **DOM 截断**: 无 — 完整 DOM 可遍历
- **多 frame**: 无 — 单 target 覆盖

---

## 7. 结论

ZCode 是 6 端中"原生 token 体系最庞大（256 个 `--color-*`）"的端，也是唯一在 RFC 评审后走"主题层全权接管"架构的端。现有引擎层（adapter.mjs + tokens.css + cosmetic.css）与 ASAR 分析结果完全匹配，注入架构（L0-L4 四引擎 + 编排层）运行良好。

**关键发现：**
1. ASAR 包 283 MB，包含完整的 React 19 + Tailwind v4 渲染进程
2. 4 个 Preload 脚本，主 Preload 通过 contextBridge 暴露 IPC
3. 390 个 `:root` CSS 变量（每 scheme），22 个命名空间
4. 369 个 data-testid 命中，203 个稳定 class 锚点
5. 安全机制完善（contextIsolation=true, sandbox="b"）
6. PDF.js 和 KaTeX 动态加载，需 MutationObserver 感知
7. 与现有引擎匹配度 >95%，无重大架构偏差
