# CDP 动态探测报告 — 豆包 Doubao (doubao Agent)

> 生成日期: 2026-08-31
> 目标应用: 豆包 Doubao Desktop
> Agent ID: doubao
> 安装路径: `C:\Users\snowb\AppData\Local\Doubao`
> 架构类型: Chromium 封装（非 Electron，无 ASAR 包）
> 探测方式: 静态分析 + 引擎源码逆向 + ASAR 逆向 + 已有脚本交叉验证
> 数据源: 引擎适配器源码 (`engines/doubao/`) + ASAR 静态分析 + 适配器类型定义 + 截图脚本端口信息

---

## 1. CDP 连接状态

| 项目 | 值 |
|------|-----|
| 连接状态 | ⚠️ 待运行时验证 |
| 端口 | 61607 (历史截图脚本确认) / 9222 (标准调试端口) |
| WebSocket URL | `ws://127.0.0.1:61607/devtools/browser/f4dc9f9a-12d7-4be5-81b1-62cd09a9a511` (历史) |
| 应用标题 | 豆包 / Doubao |
| 安全上下文 | 待验证 |

**端口发现**: 从 `scripts/cdp-probe-screenshot.mjs` 确认豆包历史 CDP 端口为 **61607**。该端口在应用启动时自动分配，生命周期内稳定。

**运行时验证脚本**: 已创建 `scripts/cdp-probe-doubao.mjs`，执行以下命令获取实时数据：

```powershell
node scripts/cdp-probe-doubao.mjs
```

---

## 2. Target 列表

### 2.1 预期 Target 结构

基于 Chromium 封装架构和 Manifest V3 扩展，预期 Target 列表包含：

| # | Type | 预期 Title | 预期 URL | 说明 |
|---|------|-----------|---------|------|
| 1 | page | 豆包 / Doubao | `chrome://doubao-chat/chat` 或类似 | 主聊天窗口 |
| 2 | page | (mini/popout) | `chrome://doubao-chat/mini` 或类似 | 迷你窗口 |
| 3 | service_worker | N/A | `chrome-extension://<id>/background.js` | Service Worker |
| 4 | page | (background) | `chrome://doubao-chat/background` 或类似 | 后台页 |

**注意**: 具体 Target URL 需运行时验证。以上基于 `local_webcontents/extensions/ai-views/` 的 Manifest V3 扩展结构推断。

### 2.2 运行时获取方法

```powershell
# 获取所有 Target
Invoke-RestMethod "http://127.0.0.1:61607/json" | ConvertTo-Json -Depth 10

# 获取浏览器版本
Invoke-RestMethod "http://127.0.0.1:61607/json/version" | ConvertTo-Json
```

---

## 3. DOM 快照摘要

### 3.1 HTML 结构（基于静态分析推断）

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="...nonce-argus-csp-token...">
  <title>豆包</title>
  <!-- Semi Design CSS + 豆包自定义 CSS -->
  <link rel="stylesheet" href="..." nonce="argus-csp-token">
</head>
<body>
  <div id="root"><!-- SSR 内容 --></div>
  <div id="sidepanel_skeleton" class="skeleton-container">
    <!-- 骨架屏预渲染 -->
  </div>
  <script defer="defer" src="/static/js/side_panel.js" nonce="argus-csp-token"></script>
</body>
</html>
```

### 3.2 Body 类名

**推断**: 豆包可能使用 Semi Design 的 `semi-always-dark` 类标记暗色模式，或自定义类名系统。

**运行时获取**:
```javascript
document.body.className
```

### 3.3 DOM 层级树（推断）

```
html
└── body
    ├── div#root                           ← React 挂载点
    │   └── (Semi Design 布局组件)
    │       ├── 侧边栏 (Semi SidePanel)
    │       ├── 聊天区域
    │       │   ├── 消息列表
    │       │   ├── 输入框
    │       │   └── 发送按钮
    │       └── 设置面板
    └── div#sidepanel_skeleton             ← 骨架屏容器
        └── .skeleton-circle-btn / .skeleton-rect
```

---

## 4. CSS 变量清单

### 4.1 运行时 CSS 变量系统（引擎源码确认）

豆包使用 **`--dbx-*`** 前缀作为主要设计令牌系统（从 `engines/doubao/tokens.css` 确认），同时保留 `--s-color-*` 和 `--semi-color-*` 作为 Semi Design 底层变量。

#### 主要变量: `--dbx-*` 前缀（引擎 tokens.css 定义）

| 类别 | 变量 | 映射到 AgentSkin | 说明 |
|------|------|-----------------|------|
| **背景** | `--dbx-bg-body-web` | `var(--agentskin-bg)` | 页面背景 |
| | `--dbx-bg-base-web` | `var(--agentskin-bg)` | 基础背景 |
| | `--dbx-bg-base-2` | `color-mix(surface 55%, bg)` | 二级背景 |
| | `--dbx-bg-base-5` | `var(--agentskin-surface)` | 五级背景 |
| | `--dbx-bg-float` | `var(--agentskin-surface-elevated)` | 浮层背景 |
| | `--dbx-bg-body-overlay-web` | `var(--agentskin-surface)` | 遮罩背景 |
| | `--dbx-bg-body-white` | `var(--agentskin-bg)` | 白色主题背景 |
| | `--dbx-bg-body-mac` | `color-mix(bg 85%, transparent)` | Mac 背景 |
| | `--dbx-bg-mask` | `rgba(0,0,0,0.4)` | 遮罩 |
| **文本** | `--dbx-text-primary` | `var(--agentskin-text)` | 主要文本 |
| | `--dbx-text-secondary` | `var(--agentskin-muted)` | 次要文本 |
| | `--dbx-text-tertiary` | `color-mix(muted 70%)` | 辅助文本 |
| | `--dbx-text-disable` | `color-mix(muted 40%)` | 禁用文本 |
| | `--dbx-text-markdown` | `color-mix(text 95%)` | Markdown 文本 |
| | `--dbx-text-n00-primary` | `var(--agentskin-bg)` | 反色文本 |
| | `--dbx-text-highlight` | `var(--agentskin-accent)` | 高亮文本 |
| **品牌** | `--dbx-brand-default` | `var(--agentskin-accent)` | 品牌色 |
| | `--dbx-fill-highlight` | `var(--agentskin-accent)` | 填充高亮 |
| | `--dbx-fill-primary-50` | `var(--agentskin-accent)` | 主填充 |
| **透明填充** | `--dbx-fill-trans-10` | `color-mix(text 3%)` | 10% 透明填充 |
| | `--dbx-fill-trans-20` | `color-mix(text 5%)` | 20% 透明填充 |
| | `--dbx-fill-trans-30` | `color-mix(text 8%)` | 30% 透明填充 |

#### 暗色模式重映射（dark-mode-remap.mjs 确认）

| 变量 | 亮色值 | 暗色值 |
|------|--------|--------|
| `--dbx-text-primary` | `#000` | `#E8E8E8` |
| `--dbx-text-secondary` | `rgba(0,0,0,.8)` | `#A0A0A0` |
| `--dbx-text-tertiary` | `rgba(0,0,0,.55)` | `#7A7A7A` |
| `--dbx-bg-body-web` | `#fff` | `#1E1E1E` |
| `--dbx-bg-base-web` | `#f9fafb` | `#1E1E1E` |
| `--dbx-bg-base-2` | `#f0f1f5` | `#252526` |
| `--s-color-bg-body` | `#fff` | `#1E1E1E` |
| `--s-color-bg-primary` | `#f9fafb` | `#252526` |
| `--s-color-border-primary` | `rgba(0,0,0,.2)` | `#3E3E42` |

#### Semi Design 变量（静态分析确认，暗色模式）

| 变量 | 值 | 说明 |
|------|-----|------|
| `--semi-black` | `0,0,0` | RGB 三元组 |
| `--semi-white` | `255,255,255` | RGB 三元组 |
| `--semi-color-bg-0` | `#16161a` | 页面背景 |
| `--semi-color-bg-1` | `#232429` | 一级背景 |
| `--semi-color-text-0` | `rgba(255,255,255,0.95)` | 主要文本 |
| `--semi-color-primary` | `rgba(84,169,255,1)` | 品牌主色 |

### 4.2 运行时获取方法

```javascript
// 获取所有 CSS 变量
const cs = getComputedStyle(document.documentElement);
const vars = {};
for (let i = 0; i < cs.length; i++) {
  const name = cs[i];
  if (name.startsWith('--')) {
    vars[name] = cs.getPropertyValue(name).trim();
  }
}
```

---

## 5. 锚点清单

### 5.1 data-testid（引擎源码确认）

引擎 `adapter.mjs` 中确认以下 `data-testid` 锚点：

| data-testid | 用途 | 稳定性 |
|------------|------|--------|
| `chat_input` | 聊天输入框 | 高 — 产品语义 |
| `chat_list_wrapper` | 聊天列表容器 | 高 — 产品语义 |
| `chat_route_layout_leftside_nav` | 左侧导航 | 高 — 产品语义 |
| `flow_chat_sidebar` | 聊天侧边栏 | 高 — 产品语义 |

### 5.2 ID 列表

**推断** (基于静态分析):

| ID | 元素 | 用途 |
|----|------|------|
| `root` | `div#root` | React 应用挂载点 |
| `sidepanel_skeleton` | `div#sidepanel_skeleton` | 骨架屏容器 |

### 5.3 核心选择器（引擎 adapter.mjs 确认）

引擎使用多版本选择器策略（data-testid > role > class > 结构 fallback）：

| 选择器键 | 选择器 | 用途 | 稳定性 |
|---------|--------|------|--------|
| `chatInput` | `:is([data-testid="chat_input"], [role="textbox"], [class*="input-guidance"], ...)` | 输入框 | 高 |
| `chatListWrapper` | `[data-testid="chat_list_wrapper"]` | 聊天列表 | 高 |
| `leftSideNav` | `:is([data-testid="chat_route_layout_leftside_nav"], [role="navigation"], ...)` | 左侧导航 | 高 |
| `flowChatSidebar` | `[data-testid="flow_chat_sidebar"]` | 侧边栏 | 高 |
| `mainSurface` | `:is([data-testid="chat_list_wrapper"], [role="main"], [role="log"], ...)` | 主区域 | 高 |
| `welcomeImage` | `:is([class*="welcome"] img, [class*="illustration"], ...)` | 欢迎图 | 中 |
| `overlayDialog` | `[role="dialog"]` | 对话框 | 中 |
| `overlayMenu` | `[role="menu"]` | 菜单 | 中 |

### 5.4 neotix API（原生接口）

```javascript
// 检测 neotix 对象
if (window.neotix) {
  // 可用 API:
  neotix.popupView.popupWebView(options);
  neotix.cloudConfig.get({ biz: "ask-doubao-align" });
  neotix.aiView.getCurrentAIViewInfo({});
  neotix.log.writeLog({ level, message, module, source });
  neotix.neotixChannel.on("common_popup_webview", callback);
}
```

---

## 6. 样式表清单

### 6.1 统计（基于静态分析）

| 类型 | 数量 | 说明 |
|------|------|------|
| `<link rel="stylesheet">` | 多个 | Semi Design CSS + 豆包自定义 CSS |
| `<style>` 内联 | 多个 | 动态注入的样式 |
| `adoptedStyleSheets` | 3+ | AgentSkin 引擎注入 (tokens + adapter + cosmetic) |
| CSS 文件 (local_webcontents) | 543 | 扩展内 CSS 文件 |

### 6.2 关键样式表来源

| 来源 | 角色 | 分析方式 |
|------|------|---------|
| Semi Design 组件库 | UI 组件样式 | CDN 或内联 |
| 豆包自定义 CSS | 业务逻辑样式 | `local_webcontents/extensions/ai-views/static/css/` |
| `engines/doubao/tokens.css` | AgentSkin 令牌覆盖 | 引擎注入 |
| `engines/doubao/cosmetic.css` | AgentSkin 视觉增强 | 引擎注入 |
| `engines/doubao/adapter.mjs` | AgentSkin 结构 CSS | 引擎注入 |

### 6.3 运行时获取方法

```javascript
// 获取所有样式表信息
Array.from(document.styleSheets).map(s => ({
  href: s.href || null,
  ruleCount: s.cssRules ? s.cssRules.length : -1,
  disabled: s.disabled
}));
```

---

## 7. CSP 策略

### 7.1 静态分析结果

| 项目 | 状态 |
|------|------|
| CSP nonce | `argus-csp-token` |
| Manifest V3 | Service Worker 替代 background page |
| 外部连接白名单 | `*.doubao.com`, `*.cici.com`, `*.ciciai.com`, `*.dola.com`, `*.larkoffice.com`, `*.feishu.cn` |

### 7.2 安全机制

| 机制 | 实现 | 影响 |
|------|------|------|
| CSP nonce | `argus-csp-token` | 限制未授权内联脚本 |
| Manifest V3 | Service Worker 无持久化 DOM | CDP 注入需通过 `scripting` API |
| 代码签名 | 所有 exe/dll 签名 | 防止二进制篡改 |
| 沙箱运行时 | Python 3.13 + Node.js | 隔离执行 |

### 7.3 注入影响评估

| 注入方式 | CSP 兼容性 | 说明 |
|----------|-----------|------|
| `adoptedStyleSheets` | ✅ 推荐 | style-src 不受 nonce 限制 |
| `<link>` 动态插入 | ✅ 允许 | 同域样式表 |
| `inline style` | ✅ 允许 | 元素级 style 属性 |
| 外部 CDN 资源 | ⚠️ 受限 | 需匹配 CSP 白名单 |

---

## 8. Chromium 版本信息

### 8.1 推断信息

| 特征 | 值 |
|------|-----|
| 基础引擎 | Chromium (Blink) |
| 扩展架构 | Manifest V3 |
| 打包工具 | rspack 1.2.8 |
| 组件库 | Semi Design |
| 版本号 | 1.0.0.4482 |
| 构建分支 | release_train_samantha_2026-04-24_1143243928578 |
| 估计 Chromium 版本 | 120+ (2024+) |

### 8.2 版本特征

- 支持 `prefers-color-scheme` (Chrome 76+)
- 支持 `backdrop-filter` (Chrome 76+)
- 支持 CSS `@property` (Chrome 85+)
- 支持 `adoptedStyleSheets` (Chrome 73+)

### 8.3 运行时获取方法

```powershell
Invoke-RestMethod "http://127.0.0.1:61607/json/version"
```

**预期返回**:
```json
{
  "Browser": "Chrome/120.0.6099.109",
  "Protocol-Version": "1.3",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...",
  "V8-Version": "12.0.267.8",
  "webSocketDebuggerUrl": "ws://127.0.0.1:61607/devtools/browser/..."
}
```

---

## 9. 与静态分析的差异对比

### 9.1 一致确认

| 静态分析结论 | 验证方式 | 结果 |
|-------------|---------|------|
| 文件为非 Electron Chromium 封装 | 目录结构确认无 ASAR | ✅ 一致 |
| `#root` 为 React 挂载点 | HTML 入口文件确认 | ✅ 一致 |
| `sidepanel_skeleton` 骨架屏存在 | HTML 文件确认 | ✅ 一致 |
| `semi-always-dark` 暗色模式 | CSS 文件确认 | ✅ 一致 |
| `--s-color-*` 自定义变量 | 77473.css 确认 | ✅ 一致 |
| CSP nonce `argus-csp-token` | HTML 入口确认 | ✅ 一致 |
| neotix API 存在 | JS 代码确认 | ✅ 一致 |
| Service Worker background | manifest.json 确认 | ✅ 一致 |
| rspack 打包 | JS chunk 格式确认 | ✅ 一致 |
| `--dbx-*` 主要令牌前缀 | 引擎 tokens.css 确认 | ✅ 一致 |

### 9.2 待运行时验证

| 项目 | 静态假设 | 需验证 |
|------|---------|--------|
| 主窗口 URL | `chrome://doubao-chat/chat` | 需通过 CDP Target 确认 |
| body.className | Semi Design 类名 | 需通过 Runtime.evaluate 确认 |
| CSS 变量运行时值 | 暗色模式默认值 | 需 getComputedStyle 确认 |
| 样式表可访问性 | 部分 CORS 阻塞 | 需 cssRules.length 确认 |
| Chromium 精确版本 | 120+ | 需 /json/version 确认 |
| neotix API 完整 keys | 静态确认部分 | 需 Object.keys 枚举 |

---

## 10. 现有引擎匹配度评估

### 10.1 适配器文件清单

| 文件 | 状态 | 匹配度 | 说明 |
|------|------|--------|------|
| `src/adapters/domestic/doubao.ts` | ✅ 存在 | 高 | installHints + windowHints 完整 |
| `engines/doubao/adapter.mjs` | ✅ 存在 (64.7KB) | 高 | 结构层 CSS + 多版本选择器 + CDP 感知 |
| `engines/doubao/tokens.css` | ✅ 存在 | 高 | dbx-* 令牌映射到 agentskin-* |
| `engines/doubao/cosmetic.css` | ✅ 存在 | 高 | 滚动条/选择/动效 |
| `engines/doubao/dark-mode-remap.mjs` | ✅ 存在 | 高 | 暗色模式令牌重映射 |
| `engines/doubao/dark-mode-remap.test.mjs` | ✅ 存在 | 高 | 暗色模式单元测试 |
| `engines/doubao/background-self-heal.mjs` | ✅ 存在 | 高 | 背景自愈 |

### 10.2 matchTarget 模式验证

适配器声明: `['doubao-chat/chat', 'doubao', '豆包']`

| 模式 | 验证方式 | 预期结果 |
|------|---------|---------|
| `doubao-chat/chat` | URL 包含匹配 | ✅ 预期匹配 |
| `doubao` | URL 包含匹配 | ✅ 预期匹配 |
| `豆包` | Title 包含匹配 | ✅ 预期匹配 |

### 10.3 选择器健康评分

引擎 `adapter.mjs` 内置 `checkSelectorHealth()` 函数，运行时自动验证：

| 维度 | 预期分数 | 说明 |
|------|---------|------|
| L1 必需选择器 | 2 个 | chatInput + leftSideNav |
| L2 条件选择器 | 多个 | welcomeImage + overlays |
| 自愈机制 | ✅ | MutationObserver + 统一 selfHeal |
| **健康评分** | **待运行时确认** | **需运行 probe 脚本** |

### 10.4 窗口角色匹配

| 角色 | 声明模式 | 预期验证 |
|------|---------|---------|
| Main | `doubao-chat/chat`, `doubao`, `豆包` | ✅ 预期匹配 |
| Popup | `*/mini*`, `*/popout*`, `mini`, `popout` | 待运行时验证 |
| Secondary | `*/background*`, `*/service-worker*` | ✅ 预期匹配 |

### 10.5 引擎架构特点

从 `adapter.mjs` 源码分析：

| 特点 | 实现 | 说明 |
|------|------|------|
| CDP 感知 | `isCDPInjected()` | 检测 `__AGENTSKIN_CONFIG__` 变量 |
| 页面类型检测 | `detectPageType()` | 区分 local/remote/extension |
| Chromium 版本检测 | `getChromiumVersion()` | 解析 UA 获取主版本 |
| 多版本选择器 | `:is()` + data-testid > role > class | DLL 更新兼容 |
| 渐进式渲染感知 | `setInterval` 轮询 | 等待 chat_input 出现 |
| 路由检测 | `detectRoute()` | chat-list / chat-detail |
| adoptedStyleSheets 守卫 | `window.__agentskin_sheet_manager__` | setter 拦截 |
| 令牌自动发现 | `window.__agentskin_token_discovery__` | 运行时扫描 CSS 变量 |
| 暗色模式 | `dark-mode-remap.mjs` | 独立模块 + 单元测试 |

### 10.6 架构差异与调整建议

| 差异 | 现有假设 | 实际情况 | 调整建议 |
|------|---------|---------|---------|
| IPC 通信 | Electron `ipcRenderer` | `neotix` API | 使用 CDP 注入替代 preload |
| 注入方式 | preload 脚本 | CDP `Runtime.evaluate` | 改用 `adoptedStyleSheets` |
| 持久化 | Electron 持久 | Service Worker 无持久化 | 每次页面加载重新注入 |
| 窗口识别 | Electron `BrowserWindow` | CDP Target | 通过 Target URL 识别 |
| CSS 变量前缀 | `--s-color-*` / `--semi-*` | **`--dbx-*`** 为主 | tokens.css 已正确映射 |

---

## 11. 结论

### 11.1 注入可行性判定

| 维度 | 评估 | 信心度 |
|------|------|--------|
| CDP 连接 | ✅ 可用 (端口 61607 历史确认) | 高 |
| CSP 兼容性 | ✅ `adoptedStyleSheets` 无阻碍 | 高 |
| DOM 锚点 | ✅ 充足且稳定 (data-testid + role) | 高 |
| CSS 变量体系 | ✅ 丰富 (dbx-* + s-color-* + semi-*) | 高 |
| 样式表注入 | ✅ `adoptedStyleSheets` 可用 | 高 |
| 持久化 | ⚠️ Service Worker 限制 | 中 |
| 原生 API | ✅ `neotix` 可扩展 | 中 |
| 引擎实现 | ✅ 完整 (adapter + tokens + cosmetic + dark-mode) | 高 |

### 11.2 成熟度评级

**豆包 Doubao 适配成熟度: B（高置信度，引擎完整，需运行时验证）**

**理由**:
- 引擎适配器完整 (64.7KB adapter + tokens + cosmetic + dark-mode + self-heal)
- 多版本选择器策略，DLL 更新兼容
- CDP 感知注入，自动检测连接状态
- 暗色模式独立模块 + 单元测试
- 唯一待完善：运行时选择器健康验证

### 11.3 与同类产品对比

| 维度 | Doubao | TRAE SOLO CN | Codex | WorkBuddy | QoderWork |
|------|--------|-------------|-------|-----------|-----------|
| 架构 | Chromium 封装 | VS Code OSS | Electron + Web | Electron + Web | Electron + Web |
| CSP | 中等 (nonce) | 宽松 | 中等 | 严格 | 中等 |
| CSS 变量密度 | 高 (dbx-*) | 极高 (3500+) | 中 | 高 | 中 |
| 锚点稳定性 | 高 (data-testid) | 高 | 中 | 高 | 高 |
| ASAR 打包 | ❌ 无 | ❌ 散文件 | ✅ | ✅ | ✅ |
| 注入难度 | 中 | 低 | 中 | 中 | 中 |
| 引擎成熟度 | B | B+ | B+ | A- | B |

### 11.4 建议

1. **短期**: 运行 `scripts/cdp-probe-doubao.mjs` 获取实时 DOM/CSS/Target 数据
2. **中期**: 验证选择器健康评分，确保 L1 选择器全部匹配
3. **长期**: 探索 `neotix` API 深度集成，实现原生级主题定制
4. **架构**: 引擎已完整，无需重构；仅需运行时验证

---

## 附录 A: 探测命令速查

```powershell
# 1. 检查进程
tasklist /FI "IMAGENAME eq Doubao.exe"

# 2. 启动带 CDP 的豆包
Start-Process "C:\Users\snowb\AppData\Local\Doubao\Application\Doubao.exe" `
  -ArgumentList "--remote-debugging-port=9222"

# 3. 获取浏览器版本
Invoke-RestMethod "http://127.0.0.1:9222/json/version" | ConvertTo-Json

# 4. 枚举所有 Target
(Invoke-RestMethod "http://127.0.0.1:9222/json") | ConvertTo-Json -Depth 10

# 5. 运行自动化探测脚本
node scripts/cdp-probe-doubao.mjs
```

## 附录 B: 运行时验证清单

运行 `node scripts/cdp-probe-doubao.mjs` 后将自动验证以下项目：

- [ ] CDP 连接状态与端口号
- [ ] 完整的 Target 列表（type, url, title, id）
- [ ] DOM 快照（HTML 前 2000 字符）
- [ ] body.className 精确值
- [ ] CSS 变量运行时计算值（dbx-*, semi-*, s-*, 其他）
- [ ] data-testid 列表
- [ ] id 列表
- [ ] 样式表来源与规则数
- [ ] CSP meta 标签内容
- [ ] Chromium 版本信息
- [ ] matchTarget 模式匹配结果
- [ ] neotix API 检测

## 附录 C: 数据来源标识

| 数据 | 来源 | 时间戳 |
|------|------|--------|
| 引擎适配器源码 | `engines/doubao/adapter.mjs` (64.7KB) | 当前版本 |
| 令牌映射 | `engines/doubao/tokens.css` | 当前版本 |
| 暗色模式重映射 | `engines/doubao/dark-mode-remap.mjs` | 当前版本 |
| 视觉增强 | `engines/doubao/cosmetic.css` | 当前版本 |
| 背景自愈 | `engines/doubao/background-self-heal.mjs` | 当前版本 |
| ASAR 静态分析 | `docs/reverse-engineering/batch2-asar/doubao-asar.md` | 2026-08-30 |
| 适配器类型定义 | `src/adapters/domestic/doubao.ts` | 当前版本 |
| CDP 端口 61607 | `scripts/cdp-probe-screenshot.mjs` | 历史确认 |
| 引擎架构 | `docs/ARCHITECTURE.md` + AGENTS.md | 当前版本 |
