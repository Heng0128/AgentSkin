# Codex 架构文档 (AgentSkin)

> 逆向理解产物。基于真实安装包静态解包（`extract-asar-summary.mjs`），未写回任何原应用文件。
> 静态层来源：`raw/extract-summary.json`；动态校验见 `cdp-full-extract`
> （登录态完整界面，自动发现端口；本次已运行，见 §8/§9）。
> 目标：支撑深度主题注入 / SDK 脆弱性分级 / 语义锚点维护。
>
> 本文合并两类来源：
> ① **实测**（本机 v26.814，§1-§9）：静态 asar + 动态 CDP 第一手数据，以本机为准；
> ② **外部交叉合参**（§10-§16）：explodex / codex-plusplus / CodeDrobe / CodeFace /
>   Codex Dream Skin / loop-codex / Cmochance 七个逆向项目的合参，参考版本 v26.527~v26.715。
> 两源存在版本漂移（如运行时应答、CDP 启动途径），冲突处已在正文下标注，以实测数据为准。

## 1. 包身份

| 项 | 值 | 来源 |
|----|----|------|
| 包名 | `openai-codex-electron` | `webview/../package.json#name` |
| productName | `Codex` | `package.json` |
| author | OpenAI | `package.json` |
| asar 内版本 | `26.814.41407` | `package.json#version` |
| codexBuildNumber | `6720` | `package.json#codexBuildNumber` |
| Electron | `42.3.0` | `devDependencies.electron` |
| 应用品牌 | `chatgpt`（`codexAppBrand`） | `package.json` |
| 当前安装 | MSIX `OpenAI.Codex` `26.814.5167.0_x64` | `Get-AppxPackage` |
| 安装根 | `C:\Program Files\WindowsApps\OpenAI.Codex_26.814.5167.0_x64__2p2nqsd0c76g0` | 实测 |
| asar | `<root>\app\resources\app.asar`（273.5MB） | 实测 |
| 包类型 | MSIX + auto-unpack-natives（脆弱性相关，见 §8） | `forge` 配置 |

> 注意：asar 内 `version`（41407）与实际安装包版本号（5167）不是同一编码体系，归档时以 axar 内版本为准。

> **运行时应答（外部合参 v26.527+，§16 已动态确认）**：codex-plusplus 等报告 Codex 已从标准 Electron 迁移到
> 自定义 **Owl Runtime**（Chromium 壳，非 Electron Framework，`Frameworks/Codex Framework.framework`；
> 对应 Electron 兼容层 v42.1.0，`usesOwlAppShell()`/`getBuildFlavor()` 可探测）。
> ✅ **v26.814 实测：`usesOwlAppShell()=true`、`getBuildFlavor()="prod"`，Chromium `Chrome/151.0.7922.137`**。
> 即**确认运行于 Owl Runtime**（Chromium 151 远新于 Electron 42 内置版本），适配器应走 Owl 分支。

## 2. 入口链与进程架构

`package.json#main` → `.vite/build/early-bootstrap.js`：

```
early-bootstrap.js
├─ require("./src-KMpTO78a.js")                 // 合并的主进程逻辑 chunk
├─ desktop-open-path-queue(BtqbTQxD).r(darwin)  // 平台路径队列守卫
└─ .then(() => require("./bootstrap-jSAMXPd1.js")) // 异步引导
```

主构建产物（`.vite/build/`）：
- `main-DDMnkoHt.js`（2.6MB，主进程主 chunk）
- `core-CShdJPiO.js`（53KB，核心能力注入）
- `preload.js`（4KB，主窗口 preload）
- `sandbox-preload.js`（MCP/app-sandbox 渲染执行）
- `browser-page-preload.js` / `avatar-overlay-composition-surface-preload.js`（多窗 preload）
- 若干 `worker|service|upload|child-process-snapshot-worker` chunk

**进程模型推断**：Electron 主进程（`main`）+ 渲染进程（webview 页面）+ worker 消息通道
（`codex_desktop:worker:<id>:from-view/for-view` 对的 preload 实现）+ 独立的 app sandbox
宿主（`sandbox-preload.js`）。见 §4 的 IPC 信道佐证。

## 3. 渲染面（Renderer）

单 asar 内唯一 HTML 入口：`webview/index.html`（即主应用渲染页）。

- 加载 `assets/index-CYwdiPs9.js` + `rolldown-runtime` + `app-initial-*.js/css`。
- 页面根：`<div id="root">`。
- **样式系统**：Tailwind CSS 4，`@layer theme, base, components, utilities;`（依赖 CSS 先于 app.css 加载，故显式声明 layer 顺序）。
- **启动页**：`--startup-background` + OpenAI blossom logo + shimmer，主题 token 位于 `:root` / `:root.electron-dark` / `@media (prefers-color-scheme: dark)` 三处。
- **系统主题信号**：preload 在 `documentElement` 上添加 `className` `electron-dark` / `electron-light`（来自 `codex_desktop:get-system-theme-variant` sendSync）。这是 AgentSkin 需 hook 的原生主题切换点。
- 次要渲染面：`webview/avatar-overlay-composition-surface.html`（头像浮层，见 §6）。

### 3.1 主题 token 规模（静态）

| 指标 | 值 |
|------|----|
| CSS 变量数 | 1503 |
| CSS 字节 | 1,095,056 |
| stylesheet 数 | 193 |

变量命名空间覆盖：`text/border/radius/shadow/font/color/composer/sidebar/thread/main/header/
app/duration/shimmer/openai/dropdown/markdown/mermaid` 等。React 直出族语义 token 家族，
可直接由 `--text-*/--bg-*/--border-*` 等 namespace 归桶做 CSS var bridge（见 §7）。

## 4. Preload 与 IPC 契约（真实协议）

`preload.js` 为主窗口 preload，向主世界暴露：

```
contextBridge.exposeInMainWorld("codexWindowType", "electron")
contextBridge.exposeInMainWorld("electronBridge", { ... })
```

静态提取命中：`preloadExposed = ["codexWindowType", "electronBridge"]`。

### 4.1 electronBridge 方法
`sendMessageFromView` / `sendWorkerMessageFromView(name,msg)` / `subscribeToWorkerMessages(name,cb)`
/ `getPathForFile(file)`（webUtils）/ `startFileDrag` / `showContextMenu(item)`
/ `getSharedObjectSnapshotValue(key)` / `getInitialSidebarBootstrap()`
/ `getSystemThemeVariant()` / `subscribeToSystemThemeVariant(cb)`
/ `getSentryInitOptions()` / `getDesktopUserAgent()` / `getAppSessionId()` / `getBuildFlavor()`
/ `isDeviceCheckSupported()` / `isIntelMacBuild()` / `usesOwlAppShell()` / `getFastModeRolloutMetrics()`。

### 4.2 命名信道（`codex_desktop:*`）
- `codex_desktop:set/get/invoke/…` 主-渲染通信
- `codex_desktop:message-from-view` / `codex_desktop:message-for-view`（双向 message bus，支持 chunked 流）
- `codex_desktop:chunked-message-ack`（分块消息确认协议）
- `codex_desktop:worker:<id>:from-view` / `codex_desktop:worker:<id>:for-view`（worker 通道）
- `codex_desktop:mcp-app-sandbox-host-message`（sandbox 宿主，用 postMessage 转发 ports）
- `codex_desktop:connect-app-host` / `codex_desktop:show-context-menu` / `codex_desktop:get-sentry-init-options`
- `codex_desktop:get-build-flavor` / `codex_desktop:get-uses-owl-app-shell`
- `codex_desktop:get-system-theme-variant` / `codex_desktop:system-theme-variant-updated`
- `codex_desktop:get-initial-sidebar-bootstrap` / `codex_desktop:get-fast-mode-rollout-metrics`
- `codex_desktop:trigger-sentry-test` / `codex_desktop:start-file-drag` / `codex_desktop:get-shared-object-snapshot`

> 主题注入可 hook 的系统点：`get-system-theme-variant` 的 sendSync 返回值决定 `electron-dark/light`
> class，以及 `system-theme-variant-updated` 事件。AgentSkin 应据此感知原生主题态以镜像切换。

## 5. 内容安全策略（CSP）

来源：`webview/index.html` 的 `<meta http-equiv="Content-Security-Policy">`。脚本已修正
HTML 实体解码（`&#39;`→`'`）。

| 指令 | 值 |
|------|----|
| default-src | `'none'` |
| script-src | `'self' 'sha256-…' 'wasm-unsafe-eval'  https://cdn.plaid.com/…` |
| style-src | `'self' 'unsafe-inline'` |
| img-src | `'self' app: blob: data: https:` |
| frame-src | `'self' blob: codex-sandbox://…  https://cdn.plaid.com` |
| worker-src | `'self' blob:` |
| font-src | `'self' data:` |
| media-src | `'self' app: blob: data:` |
| connect-src | `'self'  https://ab.chatgpt.com  https://api.mapbox.com  https://cdn.openai.com  https://events.mapbox.com  https://learn.chatgpt.com  https://production.plaid.com  https://sandbox.plaid.com  wss://chatgpt.com  wss://ws.chatgpt-staging.com  wss://ws.chatgpt.com` |
| sandbox / contextIsolation | contextIsolation=`true`；sandbox 由 `sandbox` 选项 JS 计算（minified `Mge(e.sandboxPolicy)`，静态无法还原，需动态验证） |

**结论 / 注入影响**：
- `style-src 'unsafe-inline'` → AgentSkin 的 `<style>` 注入被允许，此为 React 直出族
  标准注入位点（`agentskin-theme-style-codex`）。
- `default-src 'none'` + `script-src 'self' + 白名单` → 禁止运行时 eval 外部脚本；通过
  CDP `CSSStyleSheet.replaceSync()` 注入样式表不受 CSP 限制，仍为优选路径。
- `connect-src` 白名单固定 → AgentSkin 若有基于本机端口回连的机制不受影响（回连走本地
  IPC/CDP，均非 http(s) 渲染面），但任何 HTTP 回连方案都会触 CSP，需避免。

## 6. 语义锚点（data 属性 / testid）

适配器选区、语义节点标记、注入命中评估的真实索引。静态命中（值 + 频次），去噪后：

| 类别 | 代表性锚点 | 用途 |
|------|-----------|------|
| 通用状态 | `data-state` `data-variant` `data-active` `data-selected` `data-disabled` `data-interactive` `data-invalid` `data-anatomy` `data-theme` | 折元/表单状态控件（不应被主题误伤） |
|**Composer**| `data-composer-expanded-top-tray` `data-composer-navigation-target` `data-composer-navigation-selected` `data-composer-markdown` | **主题注入的核心编辑区锚点** |
| Agent 活动 | `data-agent-activity-file-link` `data-gutter-buffer` `data-column-number` `data-line` | 执行面板/代码行区域 |
| 通知 | `data-sonner-toast` / `data-sonner-toaster` | Toast 层级，独立于主 token |
| 书写块 | `data-learning-block-wide-width` `data-learning-block-time-loop` `data-block` `data-pill` `data-separator-wrapper` `data-separator-content` | 富文本书写块 |
| 物理光照 | `data-mascot-part` `data-presbyopia-element` `data-hyperopia-element` | 头像/视觉元素（隔离，不注入） |

**testid**（设计系统层，值含命名风格）：
- 表单/工作簿：`popcorn-*`（`popcorn-annotation-editor`、`popcorn-viewport-host`、`popcorn-edit-toolbar`、`popcorn-find-bar`、`popcorn-presentation-*`、`popcorn-filter-*`、`popcorn-sheet-tab-*`、`popcorn-toolbar-action-*`）
- 执行外壳：`exec-shell-body`、`` exec-shell-body ``（动态拼接）
- 头像浮层（次 renderer）：`avatar-mascot-button`、`avatar-overlay-notification-badge`、`avatar-mascot-*`
- 其他可寻址：`generated-image-preview`、`chatgpt-dil-widget`、`right-panel-composer-overlay`、`automation-title-input`

**关键约束（对接 RFC 语义锚点）**：Codex 主渲染页与 `avatar-overlay` 浮层页并存，选择器必须限定主 renderer（排除 `?initialRoute=avatar-overlay` 目标），见适配器 `rendererHints.secondaryPatterns`。

## 7. 主题注入策略（对照 AgentSkin 适配器）

基于静态 asar + 动态 CDP（`codex-full-extract.json`）双重证据。**关键架构修正**：
Codex 并非纯 React 直出族——登录页为 React（`webview/index.html`），但主工作区
以 **VS Code(Monaco) 为底**，根命名空间 `--vscode-*` 占 59%（732/1246）。运行时实测
命名空间分布（见 §8 A 证据）：

| namespace | 数量 | 性质 |
|-----------|------|------|
| `--vscode-*` | 732 | Monaco 编辑器全量 token（背景/前景/边框/选择） |
| `--color-*` | 218 | **真实配色语义 token**（`--color-background-*` 等） |
| `--tw-*` | 32 | Tailwind 变体 |
| `--radius-*` / `--spacing-*` / `--shadow-*` | ~33 | 几何/间距/阴影 |
| `--text-*` | 20 | **字体排版 scale（`--text-sm=13px`…`--text-4xl=72px`），非颜色** |
| `--gray-*`/`--purple-*`/`--red-*`… | ~100 | 调色板原始色 |

因此：
1. **注入位点**：主 `webview/index.html`，CSS var bridge 以 **`--color-*` 为主
   （背景/前景/边框），`--vscode-*` 为工作区精调，`--text-*` 只调字号不动颜色**。
   静态文档 § 3.1 假设的 `--bg-*`/`--border-*` namespace **不存在**——必须改用
   `--color-background-*` 等，否则桥接落空。
2. **样式注入合法**：CSP `style-src 'unsafe-inline'` 放行 `<style>`（动态 CDP 确认页面正
   在渲染，样式表获取无 CORS 阻断、采样 API 无污染）；但优选 `CSSStyleSheet.replaceSync()`，
   与 baseline 重放一致且不受 CSP 限制。
3. **主题切换 hook**：监听 `system-theme-variant-updated`，镜像 `electron-dark/light` class
   转移（动态 CDP 三态切换均成功）。
4. **排除区**：`popcorn-*`、`exec-shell-*`、`data-sonner-toast`、`data-anatomy`、
   `data-mascot-part` 等原生控件保持不受影响（allow/skip/transparent），避免误伤设计系统控件。
5. **渲染面隔离**：主 renderer 与 `avatar-overlay` 浮层并存，注入仅落主 renderer
   （排除 `?initialRoute=avatar-overlay` target），浮层用独立 token 面，勿混写。

## 8. 脆弱性分级（动态已验证 + 需持续回归）

> 静态种子来自 `raw/extract-summary.json`；动态证据来自 `raw/codex-full-extract.json`
> （CDP 连接成功、12 stylesheet 无 CORS 阻断、暗/亮/默认三态切换成功、采样 API 无污染，
> 见 §8.C 质量证据）。**仍标注需回归的项**表示需跨版本观察，非本次已知缺陷。

### 8.A 动态证据（CDP，2026-08-18 56901 端口，登录态完整界面）

```
rootVars:   default=1246  dark=1246  light=1246   （三态一致，主题切换真实生效）
domNodes:   295（default/dark/light 同）           （登录态主渲染器完整界面，maxDepth=24）
renderer:   主 = app://-/index.html               （rendererHints 跳过 1 个次 renderer=avatar-overlay）
stylesheets: 12，corsBlocked=0                     （可完整读取，无采样阻碍）
stylesVars:  dark=1255 light=1246 neutral=1538     （暗色额外注入 9 个变量）
apiPolluted: []                                    （getComputedStyle/matchMedia 等全原生）
truncated:   false                                  （DOM 捕获完整，无截断）
```

> 登录态完整界面为 **295 节点**（不再受登录/欢迎态稀疏限制）。脆弱性结论中的
> 工作区 token 用量**不依赖** DOM 峰值（它来自实时是否存在 732 个 `--vscode-*` 变量）。

### 8.B 依赖点分级

| 依赖点 | 评级 | 依据 | AgentSkin 影响 |
|--------|------|------|----------------|
| `better-sqlite3` + `node-pty` | **Critical** | asar 内原生 .node 模块，须与 Electron 42 的 NODE_MODULE_VERSION 严格匹配；MSIX `auto-unpack-natives` | 升级可能导致原生模块 ABI 失配崩溃；**禁止清理/替换 asar.unpacked 内原生文件** |
| `codex_desktop:*` 信道字符串 | **Critical** | preload 中硬编码全量信道；重构即"找不到 Sync/Invoke" | 主题 hook 依赖 `get-system-theme-variant` / `system-theme-variant-updated`，升级需回归 |
| **token 命名空间**（`--vscode-*`/`--color-*`/`--text-*` 实际分工） | **Critical** | 动态 CDP 实证：`--text-*` 是字号非颜色、无 `--bg-*`、`--vscode-*` 占过半 | 桥接若按 React 直出假设（`--bg-*`）会整体落空 → **驱动重构适配器命名空间映射** |
| CSP meta | **High** | 值变动直接影响注入合法性（当前 `style-src 'unsafe-inline'` 放行） | 若移除 `unsafe-inline`，`<style>` 注入失效，须回退 replaceSync |
| `electron-dark/light` class | **High** | preload 直接写 `documentElement.classList`（动态响应 `prefers-color-scheme` 成功） | 主题切换 hook 依赖此约定，改名即失配 |
| ~~登录态 DOM 稀疏~~ | ~~Med~~ | 已解除：登录态完整界面复采 295 节点（§8.A） | 主题还原度验证不再受登录态限制，可在当前登录态直接进行 |
| `webview/index.html` 入口 | **Med** | chunk hash（`index-CYwdiPs9`）随版本漂移 | 锚点用 `#root` 稳定；不依赖 hash 文件名 |
| `popcorn-*`/`exec-shell-*` testid | **Med** | 设计系统内部，可改名 | 仅用于排除区，漂移风险低、影响面小 |
| `data-composer-*` 锚点 | **Med** | 高频命中、相对稳定 | 核心注入区，升级回归重点 |
| OpenAI blossom 启动 token | Low | 仅启动临时占位，非打磨可跳过 | 保真度边际项 |

## 9. 数据新鲜度与复核

### 静态层
- 命令：`node scripts/extract-asar-summary.mjs --app-path "<WindowsApps>\app\resources\app.asar" --app codex`
- 报告：`docs/apps/codex/raw/extract-summary.{json,md}`
- 本次提取：2026-08-18（`extractedAt = 2026-08-18T13:11:00Z`）

### 动态层
- 命令：`node scripts/cdp-full-extract.mjs --name codex --out docs/apps/codex/raw`
  （端口自动发现，复用项目三层策略：DevToolsActivePort→PID argv→netstat，本次经 netstat 命中 56901）
- 报告：`docs/apps/codex/raw/codex-full-extract.json` + `codex-baseline.json`
- CDP 端口：Codex 以 `--remote-debugging-port=0` 启动后动态分配给主进程（本次 56901）
- 主渲染器：`app://-/index.html`，经 `rendererHints.secondaryPatterns` 排除 `avatar-overlay` 次渲染器
- 质量（§8.C）：12 stylesheet 无 CORS 阻断、暗/亮/默认三态切换成功、
  DOM 未截断（295 节点）、采样 API 无污染（`apiPolluted=[]`）

### 局限与回归
- **登录态局限已解除**：复采为登录态完整界面（295 节点），可据此进行主题还原度验证。
- **仍需动态/跨版本确认**：`sandbox` 取值、ipcMain channel 全集、单进程 vs 多进程架构；
  命名空间桥接（§7/§8）需在登录态对 `--color-*`/`--vscode-*` 做一次完整映射回归。
- 脆弱性分级已由静态种子 → 动态验证升级；标注"需回归"的项随应用版本更新重跑本文档。
- **CDP 启动途径（§16 已动态确认）**：本机实测用 `--remote-debugging-port` 可连上 CDP，
  但应用**强制 `port=0`**，实际端口临时分配（本次 56901）。explodex/Codex Dream Skin 报告的
  **v26.715 起移除 `--remote-debugging-port` 担忧未复现**。实践：不预设固定端口，经临时端口
  （DevToolsActivePort 文件 / 监听扫描）发现；Owl Runtime 亦可探测 `CODEXPP_REMOTE_DEBUG*` env 兜底。

---

# 外部交叉合参（§10-§16）

> 本节来自 explodex / codex-plusplus / CodeDrobe / CodeFace / Codex Dream Skin /
> loop-codex / Cmochance 七个项目的逆向合参，参考版本 v26.527~v26.715。
> 多数 portal / attribute 未在本机 §6 静态索引命中，需在 v26.814 动态复核后再决定是否作为
> AgentSkin 注入锚点。标注 ⚠️ 者为两源冲突或高脆弱项，标注 ✅ 者为设计系统稳定项。

## 10. 注入区域分层（Tier A/B/C）——外部 Portal Anchor 方法论

Codex 官方暴露了一批 **Portal Anchor**（React portal 目标），是最稳定的注入位点：

### 10.A Tier A — 官方 Portal Anchor（优先）

| Zone ID | Selector | 用途 |
|---------|----------|------|
| `aboveComposer` | `[data-above-composer-portal]` / `#above-composer-portal` | 输入框上方扩展 UI |
| `aboveComposerQueue` | `[data-above-composer-queue-portal]` | 排队消息 UI |
| `mcpAppPortal` | `[data-mcp-app-portal-target="true"]` | MCP iframe 宿主 |
| `threadFooter` | `[data-thread-scroll-footer="true"]` | 粘性输入框底部 |
| `browserSidebarBanner` | `[data-testid="browser-sidebar-top-banner-portal"]` | 浏览器侧栏顶部 |
| `homeAmbient` | `[data-home-ambient-suggestions]` | 首页建议条 |
| `composerOverlay` | `[data-composer-overlay-floating-ui]` | 浮动自动补全 |

> ⚠️ 与 §6 对照：本机 v26.814 静态索引未命中以上 `data-*-portal`/`data-above-composer-*`
> 锚点（§6 命中的 composer 锚点是 `data-composer-expanded-top-tray` 等）。二者可能是不同
> 渲染路径（已验证登录态主界面 vs 外部项目的完整工作区）。**必须动态复核后选用**。

### 10.B Tier B — 启发式回退

| Zone ID | Selectors（优先级顺序） |
|---------|-------------------------|
| `sidebar` | `aside[data-testid="app-shell-floating-left-panel"]` → `aside.app-shell-left-panel` → `[data-pip-obstacle="app-shell-floating-left-panel"] aside` |
| `composerActions` | `.ProseMirror` parent form/shell → `[class*="composer" i]` |
| `appHeader` | `.app-header-tint` → header landmark |
| `statusOverlay` | `document.body`（fixed, z-index max） |

### 10.C Tier C — 只读布局感知（不挂载）

| Attribute | Values |
|-----------|--------|
| `data-app-shell-main-content-layout` | `default` / `full-bleed` / `thread-edge-scroll` / `floating` |
| `data-app-shell-focus-area` | — |
| `data-tab-id` | `browser` / `diff` / `mcp-app` / `sandbox` / `timeline` |

### 10.D 选择器稳定性排名（外部项目共识，与 §8 铁律一致）

```
1. data-testid="..."              ← 故意留的测试钩子，最稳定
2. data-*-portal                  ← 故意留的扩展点
3. data-app-* / data-app-action-* ← 布局控制属性
4. [role="dialog"][data-state]    ← 组件状态属性
5. .ProseMirror                   ← 历史稳定的第三方库 class
6. .app-shell-left-panel          ← 语义化 class（可能变）
7. [class*="composer" i]          ← 子串匹配（脆弱）
8. Tailwind utility stacks        ← 设计重构就变
9. Hash CSS module (_xxx_1)       ← ❌ 每次构建都变，绝对避免
```

## 11. 设计系统 token（稳定）——`--color-token-*` 与工具类

### 11.A 设计系统变量（✅ Low 脆弱性）

```
:root {
  --color-token-text-primary / --color-token-text-secondary / --color-token-text-link-foreground
  --color-token-bg-fog / --color-token-border / --color-token-border-focus
  --color-token-charts-blue / --color-token-foreground/20
  --color-foreground / --color-background-panel / --color-text-accent / --color-icon-accent
  --color-bg-accent-hover / --color-bg-accent-active
  --gray-0
}
```

> ⚠️ 与 §7 对照：§7 实测命名空间以 `--vscode-*`(732) 与 `--color-*`(218) 为主；
> 外部项目报告的 `--color-token-*` 家族经 §16 动态复核 **在 v26.814 `:root` 实测存在（25 个）**，
> 与 `--color-*` 分属不同 token 层。桥接时可在已实测命中的 `--color-*`（§7）之外，把
> `--color-token-*`（§11.A）作为补充层动态探测合并。

### 11.B 稳定工具类（codex-plusplus 推荐）

- 文本：`text-token-text-primary` / `text-token-text-secondary` / `text-token-text-link-foreground`
- 背景：`bg-token-*`；边框：`border-token-border`
- 间距：`px-row-x` / `py-row-y` / `p-panel` / `h-toolbar`
- 交互：`cursor-interaction` / `focus-visible:ring-token-focus-border`

> 设计注意（Cmochance）：覆盖 `--color-token-*` + 运行时 `--color-*` 两层而非写死颜色，
> 让主题跟随 Codex 自身明暗模式。

## 12. baseTheme 官方主题系统

| 项 | 说明 |
|----|------|
| 设置入口 | Settings → Appearance |
| 可配置项 | base theme(light/dark/system)、accent color、background、foreground、UI/code fonts |
| 配置存储 | `config.toml` 的 `[desktop]`（appearance keys） |
| 主题分享格式 | `codex-theme-v1:{...}` JSON 字符串（Settings → Appearance → Import） |
| CLI 主题 | `/theme` 命令，存 `[tui]` section |

> CDP 注入的 CSS 是**运行时叠加层**，不修改 `config.toml`；但可通过修改 appearance key
> 切换官方基础主题，再叠加自定义 CSS来跟随明暗模式。

## 13. 外部项目适配技术对比

| 项目 | 深度适配技术 | 值得学习 |
|------|--------------|----------|
| **explodex** | SDK + plugins、DOM zones、React fiber walk、AppServer capture、`observeZone` 重挂载 | 注入区域分层、脆弱性分级、升级清单 |
| **codex-plusplus** | Owl Runtime 检测、`CODEXPP_REMOTE_DEBUG` env、Settings Page 骨架、幂等 MutationObserver、React Fiber 工具 | Owl 适配、token class 复用、安全注入模式 |
| **CodeDrobe** | adapter 抽象、preflight landmark(required/recommended/contexts)、验证回滚、DOM snapshot 隐私、baseTheme 写 config | 工程化最完整、adapter 可复用 |
| **CodeFace** | Rust CDP、主题管理内嵌 Settings、运行时健康门回滚、CSS 安全限制、装饰层 pointer-events:none | 无缝 UX、健康检查、安全边界 |
| **Codex Dream Skin** | 按 route 调透明度、装饰 DOM 分层、VBScript 启动器、Windows 进程管理 | 视觉最精细、Windows 启动方案 |
| **loop-codex** | 四层选择器回退(backendNodeId→a11y→CSS→XPath)、DOM SHA-256 指纹漂移检测、CDP 安全守卫 | 应对更新的最健壮方案 |
| **Cmochance** | 设计令牌双层覆盖、11 套主题、page reload 自动重应用 | 不写死颜色、主题跟随明暗 |

## 14. 安全边界（外部合参）

| 项 | 配置 |
|----|------|
| CDP 绑定 | loopback only(`127.0.0.1`)，无同用户认证 → 本机其他本地进程可访问 |
| contextIsolation | `true`（与 §4 实测一致） |
| CSP | `default-src 'none'`、`style-src 'unsafe-inline'`（放行注入，见 §5 实测） |
| 不修改 | `app.asar` / 应用二进制 / 签名资源 / `auth.json` / API key / 模型供应商设置 |
| CSS 安全限制(CodeFace) | 禁外部 URL / 字体 / `@import`；图片 ≤16MiB；CSS ≤256KiB |
| 装饰层 | `pointer-events: none`，不拦截原生控件点击 |
| DOM 快照隐私 | 排除文本内容/表单值/可访问名/query/hash/链接/媒体源 |

## 15. 升级检查清单（外部推荐，加以外部合参版本复核）

1. 重新解包 `webview/assets/`，diff 主 JS 的 bridge handler map 看 type 字符串是否改名。
2. 验证 portal attrs：`data-above-composer-portal`、`data-thread-scroll-footer`、
   `data-mcp-app-portal-target` 等是否还在。
3. 跑 capability probe：AppServer send 是否绑定、applyThreadSettings 是否返回 true。
4. 确认 localStorage 前缀 `codex:persisted-atom:` 未变。
5. 检查侧栏结构 `flex.items-center.gap-2` footer、`data-app-action-sidebar-*` 属性。
6. 跑 E2E：reasoning-effort-prefix、主题注入、composer 插入文本。
7. 更新 `meta.codexVersion` + reference build 行 + 重新生成 CDP DOM 快照。

## 16. 外部 Adapter 设计要点（CodeDrobe 规范参考）与复核项

```
interface CodexAdapter {
  id: 'codex'
  defaultPaths: { mac: '/Applications/Codex.app',
                  win: ['%LOCALAPPDATA%\\Programs\\Codex', 'Microsoft Store 版路径'],
                  linux: null }
  launch: detached spawn + Owl Runtime env（CODEXPP_REMOTE_DEBUG=1）
  portStrategy: 'fixed' | 'env-var'          // v26.715+ 需 env-var 兜底
  targetMatcher: url => url.startsWith('app://-/index.html')
  multiWindow: 250ms 轮询，8s 上限
  landmarks: {
    required: ['[data-above-composer-portal]'],            // 阻断级
    recommended: ['aside.app-shell-left-panel', '.ProseMirror'],  // 警告级
    contexts: ['data-app-shell-main-content-layout', 'data-tab-id']  // 路由级
  }
  apply: inject CSS + blob URL images + optional baseTheme write
  verify: required landmark 必须匹配，否则回滚
  restore: remove injected style nodes + restore appearance keys
}
```

**与 AgentSkin 适配器对照**：现有 codex 适配器已实现
`rendererHints.secondaryPatterns`（排除 `?initialRoute=avatar-overlay`）与
`targetMatcher`（`app://-/index.html`）——与上述外部规范一致。

**跨版本复核结果（本机 v26.814，CDP 56901 实测 `cdp-validate-codex.mjs`）**：

| # | 复核项 | 结果 | 影响 |
|---|--------|------|------|
| 1 | `usesOwlAppShell()` / `getBuildFlavor()` | `usesOwlAppShell()=true`、`getBuildFlavor()="prod"`、`codexWindowType="electron"` | ✅ 确认 **Owl Runtime**；适配器走 Owl 分支（Chromium `Chrome/151.0.7922.137`，非 Electron 42 内置 Chromium） |
| 2 | `--remote-debugging-port` 仍被解析？ | ✅ 可连上 CDP；但应用**强制 `port=0`**，实际端口临时分配（本次 56901） | v26.715 "移除"担忧未复现；仍须用临时端口发现（DevToolsActivePort/监听扫描），不预设固定端口 |
| 3 | Tier A portal 锚点存在？ | ✅ 部分存在（状态相关）：`data-above-composer-portal`×1、`data-home-ambient-suggestions`×1；队列/线程底/MCP/overlay 锚点为 **0**（惰性/未激活态） | 锚点方法论成立，但**按功能区/交互态惰性渲染**；注入前须 await 对应状态 |
| 4 | `--color-token-*` 在 `:root`？ | ✅ 存在，**25 个**（`--color-token-text-tertiary`、`--color-token-diff-surface`、`--color-token-bg-primary`、`--color-token-input-border`、`--color-token-main-surface-primary` 等） | 修正 §7/§11：`--color-token-*` 家族在 v26.814 实测存在，与 §7 的 `--color-*` 分属不同 token 层，桥接更完整 |
| 5 | `app:` scheme 隔离？ | ✅ 独立 CDP target：主页 `app://-/index.html` + 次 renderer `app://-/index.html?initialRoute=%2Favatar-overlay`（`scheme=app:`，自成 one） | 隔离成立；适配器 `targetMatcher` 需排除 overlay，现有 `excludeInitialRoute` 逻辑正确 |

> 探针脚本：`node scripts/cdp-validate-codex.mjs --port <临时端口> --json`
> 注：§6 静态索引未命中 Tier A 锚点，因采样时锚点处于惰性未渲染态；以本动态实测为准。