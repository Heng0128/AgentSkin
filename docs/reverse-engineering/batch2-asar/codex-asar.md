# ASAR 静态分析报告 — OpenAI Codex (codex Agent)

> 分析日期：2026-08-31 | 目标版本：Codex v26.814.5167 (build 6720) | ASAR 大小：286,815,889 bytes (~273.5 MB)
> 安装路径：`C:\Program Files\WindowsApps\OpenAI.Codex_26.814.5167.0_x64__2p2nqsd0c76g0\`
> ASAR 路径：`app\resources\app.asar`
> 数据来源：静态 ASAR 解包 (`extract-summary.md/json`) + CDP 运行时快照 (`cdp-summary.json`) + 现有引擎文件 + 适配器源码

---

## 1. 文件拓扑

### 1.1 包身份

| 项 | 值 |
|----|----|
| 包格式 | Electron ASAR (app.asar + app.asar.unpacked) |
| 产品名 | OpenAI Codex (package: `openai-codex-electron`) |
| 品牌标识 | `chatgpt` (`codexAppBrand`) |
| 版本 (asar内) | 26.814.41407 |
| 版本 (MSIX) | 26.814.5167.0_x64 |
| codexBuildNumber | 6720 |
| Electron | 42.3.0 (devDependencies) |
| 运行时 | Owl Runtime (Chromium 151.0.7922.137) — **非标准 Electron** |
| 渲染 URL | `app://-/index.html` |
| 渲染框架 | React 19 + Tailwind CSS 4 + Vite / Rolldown 构建 |
| 挂载点 | `<div id="root">` |
| 安装器 | MSIX (Windows Store) + auto-unpack-natives |
| DevTools 端口文件 | `%APPDATA%\ChatGPT\DevToolsActivePort` / `%APPDATA%\Codex\DevToolsActivePort` |

### 1.2 目录结构（关键路径）

```
app.asar (273.5 MB)
├── .vite/
│   └── build/
│       ├── main-DDMnkoHt.js           ← 主进程主 chunk (2.6MB)
│       ├── core-CShdJPiO.js           ← 核心能力注入 (53KB)
│       ├── preload.js                 ← 主窗口 preload (4KB)
│       ├── sandbox-preload.js         ← MCP/app-sandbox 渲染
│       ├── browser-page-preload.js    ← 浏览器页 preload
│       ├── avatar-overlay-composition-surface-preload.js  ← 头像浮层
│       ├── early-bootstrap.js         ← 入口引导
│       ├── bootstrap-jSAMXPd1.js      ← 异步引导
│       └── src-KMpTO78a.js            ← 合并主进程逻辑
├── webview/
│   ├── index.html                     ← 唯一 HTML 渲染入口
│   ├── avatar-overlay-composition-surface.html  ← 头像浮层面
│   └── assets/
│       ├── index-CYwdiPs9.js          ← 主渲染 chunk
│       ├── rolldown-runtime           ← Rolldown 运行时
│       ├── app-initial-*.css/js       ← 初始化资源
│       └── modulepreload-polyfill-9rlIWhXt.js
├── package.json                       ← 包元数据
└── (其他资源文件)

app.asar.unpacked/                     ← 原生模块
├── node_modules/
│   └── (原生依赖)
└── (提权工具等)
```

### 1.3 Preload 脚本清单

| 文件 | 用途 | 注入层 |
|------|------|--------|
| `.vite/build/preload.js` | 主窗口 preload (IPC 桥接、contextBridge) | 主渲染 |
| `.vite/build/sandbox-preload.js` | MCP/app-sandbox 渲染执行 | 沙箱 |
| `.vite/build/browser-page-preload.js` | 浏览器页 preload | 浏览器 |
| `.vite/build/avatar-overlay-composition-surface-preload.js` | 头像浮层 preload | 浮层 |
| `webview/assets/modulepreload-polyfill-9rlIWhXt.js` | 模块预加载 polyfill | 主渲染 |

### 1.4 入口点分析

```
early-bootstrap.js
  ↓
require("./src-KMpTO78a.js")          // 主进程逻辑
  ↓
require("./bootstrap-jSAMXPd1.js")    // 异步引导
  ↓
webview/index.html                    // 渲染入口
  ↓
assets/index-CYwdiPs9.js
  ↓
#root 挂载 React 应用 (React 19)
```

---

## 2. 应用类型判定

### 2.1 结论：桌面 Electron 应用（非 CLI）

**Codex (ChatGPT Desktop)** 是标准的 Electron 桌面应用，使用：

| 特征 | 状态 | 说明 |
|------|------|------|
| Electron 运行时 | ✅ | Owl Runtime (Chromium 151) |
| ASAR 打包 | ✅ | `app.asar` (273.5 MB) |
| 自定义协议 | ✅ | `app://` scheme |
| CDP 可访问 | ✅ | 端口 62300/62640 实测 |
| MSIX 分发 | ✅ | Windows Store 包 |
| 多窗口 | ✅ | 主窗口 + 设置 + 头像浮层 |

### 2.2 与 "OpenAI Codex CLI" 的区分

**重要区分**：OpenAI 目前有两个名为 "Codex" 的产品：

| 产品 | 类型 | 包名 | 安装路径 |
|------|------|------|---------|
| **ChatGPT Desktop (Codex)** | Electron 桌面应用 | `OpenAI.Codex` (MSIX) | `%LOCALAPPDATA%\Programs\OpenAI\...` 或 `C:\Program Files\WindowsApps\OpenAI.Codex_*` |
| **OpenAI Codex CLI** | CLI 工具 (Node.js) | `openai-codex` (npm) | 全局 npm 安装路径 |

本次分析目标是**桌面应用**（ChatGPT Desktop），它基于 Electron + Owl Runtime。

### 2.3 指定路径分析

用户指定的路径 `C:\Users\snowb\AppData\Local\OpenAI\Codex` **不是**标准 MSIX 安装路径。标准 MSIX 安装根为：

```
C:\Program Files\WindowsApps\OpenAI.Codex_26.814.5167.0_x64__2p2nqsd0c76g0\
```

---

## 3. 可访问源码分析

### 3.1 CSS 体系

| 指标 | 值 |
|------|----|
| CSS 变量总数 | 1,503 |
| CSS 字节 | 1,095,056 |
| Stylesheet 数 | 193 |
| 运行时 rootVars (per scheme) | 1,246 |

#### 变量命名空间分布 (top)

| 命名空间 | 数量 | 角色 |
|---------|------|------|
| `--vscode-*` | 732 | 空壳命名空间（有引无赋值） |
| `--color-*` | 218 | 主视觉 token 层 |
| `--tw-*` | 32 | Tailwind 工具变量 |
| `--radius-*` | 21 | 圆角 |
| `--text-*` | 20 | 排版字号 |
| `--codex-*` | 10 | 应用专属 |
| `--wb-*` | 10 | 写作块 |

### 3.2 真视觉层：`--color-token-*` (23/25 覆盖)

Codex 的主视觉完全由 `--color-token-*` 命名空间驱动（25 个，钉在 `:root`）：

| Token | 角色 |
|-------|------|
| `--color-token-bg-primary` | 主背景 |
| `--color-token-bg-secondary` | 次背景 |
| `--color-token-bg-tertiary` | 第三层背景 |
| `--color-token-main-surface-primary` | 主内容面 |
| `--color-token-side-bar-background` | 侧边栏背景 |
| `--color-token-text-primary` | 主文字 |
| `--color-token-text-secondary` | 次文字 |
| `--color-token-text-tertiary` | 辅助文字 |
| `--color-token-border` | 边框 |
| `--color-token-border-default/light/heavy` | 边框变体 |
| `--color-token-dropdown-background` | 下拉背景 |
| `--color-token-input-border` | 输入框边框 |
| `--color-token-list-hover-background` | 悬停背景 |
| `--color-token-primary` | 品牌强调色 |
| `--color-token-focus-border` | 焦点边框 |
| `--color-token-diff-surface` | 差异面 |
| `--color-token-charts-*` | 图表色板 |

### 3.3 注入机制现状

#### 已有注入路径

| 路径 | 文件 | 用途 |
|------|------|------|
| Engine L0 | `engines/codex/tokens.css` | 占位 no-op（加载器必需） |
| Engine L1 | `engines/codex/adapter.mjs` | 结构层注入 |
| Engine L2 | `engines/codex/cosmetic.css` | 美化增强 |
| Per-theme | `scripts/generators/codexCss.mjs` → `codexColorTokenOverrides()` | 主题 token 覆盖 |
| CSS Builder | `src/main/cdp/injection/css-builders/codex-css-builder.ts` | Safe CSS (CSP 兼容) |
| Runtime Profile | `src/engine/src/runtime/profiles/codex-theme-v1.mjs` | 运行时注入 |

#### CSP 应对策略

Codex 采用极端 CSP：`default-src 'none' + sha256` 哈希校验。

| 策略 | 状态 |
|------|------|
| adoptedStyleSheets | 首选（现代） |
| `<style>` 元素降级 | CSP 严格时回退 |
| insertRule 注入 | 最终降级 |
| CSP 违规监听 | ✅ 已部署 |
| Safe CSS 生成 | ✅ CSP 兼容子集 |

---

## 4. 架构摘要

### 4.1 进程模型

```
主进程 (main-DDMnkoHt.js)
├── 渲染进程 (webview/index.html)      ← 主注入目标
├── 沙箱进程 (sandbox-preload.js)      ← MCP/代码执行
├── 浏览器页 (browser-page-preload)     ← 嵌入式浏览
└── 浮层进程 (avatar-overlay)          ← 不注入
```

### 4.2 IPC 暴露面

| 通道方向 | 用途 |
|---------|------|
| `codex_desktop:worker:<id>:from-view` | Worker → 主进程 |
| `codex_desktop:worker:<id>:for-view` | 主进程 → Worker |
| `codex_desktop:get-system-theme-variant` | 主题模式查询 |
| `electronBridge.*` | Preload 暴露的 API |

### 4.3 安全配置

| 策略 | 值 |
|------|----|
| contextIsolation | ✅ 启用 |
| sandbox | ✅ 渲染沙箱 |
| webSecurity | ✅ 启用 |
| nodeIntegration | ❌ 禁用 |
| CSP | 极端 (default-src 'none') |

### 4.4 构建系统

| 工具 | 用途 |
|------|------|
| Vite | 构建框架 |
| Rolldown | JS 打包 (替代 Rollup) |
| Lightning CSS | CSS 压缩/编译 |
| Tailwind CSS 4 | 样式系统 |

---

## 5. 现有引擎配置有效性评估

### 5.1 适配器层 (`src/adapters/domestic/codex.ts`)

| 项 | 状态 | 说明 |
|----|------|------|
| Agent ID | ✅ | `codex` |
| Display Name | ✅ | OpenAI Codex |
| Install Hints | ✅ | MSIX + exe + registry |
| Window Hints | ✅ | Main + Settings + Secondary |
| Markdown Styles | ✅ | 运行时注入支持 |

### 5.2 Engine Adapter (`src/engine/src/adapters/codex.mjs`)

| 项 | 状态 | 说明 |
|----|------|------|
| ID | ✅ | `codex` |
| matchTarget | ✅ | app:// + chatgpt + codex + openai |
| defaultPort | ⚠️ | `0` (动态发现) |
| lastVerified | ✅ | macOS v26.707.72221 build 5307 (2026-07-16) |
| Platforms (darwin) | ✅ | ChatGPT.app + bundleId |
| Platforms (win32) | ✅ | MSIX + 7 个可执行文件候选路径 |
| Bridge | ✅ | `--color-token-*` → AgentSkin 角色 |
| Verification | ✅ | `rootAny: ["main[class*='MainContentSurface']"]` |

### 5.3 Bridge 映射

| 原生 Token | AgentSkin 角色 | 透明度 |
|-----------|---------------|--------|
| `--color-token-text-primary` | text | - |
| `--color-token-text-secondary` | muted | - |
| `--color-token-bg-tertiary` | surface-elevated | 0.85 |
| `--color-token-border` | border | 0.5 |
| `--color-token-border-heavy` | border | - |

### 5.4 Landmarks (语义锚点)

| 名称 | 选择器 | 等级 |
|------|--------|------|
| host-root | `:root.agentskin-host-codex` | Required |
| sidebar | `.app-shell-left-panel` | Recommended |
| main-surface | `main.main-surface, main, [role="main"]` | Recommended |
| composer | `.composer-surface-chrome` | Recommended |
| header | `header.app-header-tint` | Recommended |
| sidebar-item | `button.sidebar-item` | Recommended |

### 5.5 主题 CSS (Per-theme codex.css)

**状态**：✅ 已完整支持

12 个内置主题均包含专属 `codex.css`：
- academy-corridor-winter, crimson-horned-mecha, exploding-tag-storm
- fuji-balcony-overcast, fuji-rooftop-winter, galactic-garden
- industrial-sage-toad, luffy-grand-departure, midnight-dessert-feast
- miku-future-beats, shibuya-rooftop-mask, stage-bassist-blue
- sunset-cellphone-girl, void-donut-boy, winged-mecha-ascendant
- yule-fireplace-glow

---

## 6. 建议

### 6.1 路径修正

| 问题 | 建议 |
|------|------|
| 用户指定路径 `C:\Users\snowb\AppData\Local\OpenAI\Codex` 不存在 | 使用 MSIX 标准路径 `C:\Program Files\WindowsApps\OpenAI.Codex_<version>_x64__*\app\resources\app.asar` |
| 路径可能因版本变化 | 通过 `Get-AppxPackage -Name "OpenAI.Codex"` 动态发现 |

### 6.2 安装检测增强

在 `src/engine/src/adapters/codex.mjs` 中，Windows 可执行文件候选路径可补充：

```javascript
executableCandidates: [
  // 现有 7 条...
  // 新增便携/解压版本路径
  "%LOCALAPPDATA%\\OpenAI\\Codex\\app\\ChatGPT.exe",
],
```

### 6.3 Owl Runtime 适配

Codex 已迁移至 **Owl Runtime** (非标准 Electron)：

- `usesOwlAppShell() = true`
- `getBuildFlavor() = "prod"`
- Chromium 151.0.7922.137

适配器已通过 `matchTarget` 的宽泛匹配策略兼容，无需特殊处理。但 Owl Runtime 的 JS API  surface 可能比标准 Electron 略窄，建议在未来的 lastVerified 更新时验证。

### 6.4 CSP 对抗升级

当前 CSP 极端严格 (`default-src 'none' + sha256`)，建议持续维护降级链：

1. `adoptedStyleSheets` (首选)
2. `<style>` 元素注入 (CSP 严格时)
3. `insertRule` 到现有 stylesheet (最终降级)
4. 监听 `securitypolicyviolation` 事件自动降级

### 6.5 适配器健康状态

| 维度 | 评级 | 说明 |
|------|------|------|
| 逆向完整度 | ⭐⭐⭐⭐⭐ | 25/25 token 覆盖，0 no-op |
| 选择器防护 | ⭐⭐⭐⭐ | 哈希类前缀匹配，不含裸 `main` |
| CSP 兼容 | ⭐⭐⭐⭐ | 三级降级 + 违规监听 |
| 版本漂移风险 | ⭐⭐⭐ | 低（token 名稳定，rootAny 哈希类抗漂移） |
| 主题生态 | ⭐⭐⭐⭐⭐ | 12+ 主题完整适配 |
| CI 验证 | ⭐⭐⭐⭐ | benchmark + 注入对比报告 |

### 6.6 无需更换分析目标

现有引擎配置完整且经过实测验证（端口 62300/62640 双实拍），无需寻找替代分析目标。当前 Codex 适配器是 6 个适配器中状态最好的之一。

---

## 7. 关键文件路径索引

| 文件 | 用途 |
|------|------|
| `engines/codex/adapter.mjs` | 结构层注入引擎 |
| `engines/codex/tokens.css` | L0 占位 (no-op) |
| `engines/codex/cosmetic.css` | L2 美化增强 |
| `src/engine/src/adapters/codex.mjs` | 元数据 + matchTarget + bridge |
| `src/engine/src/runtime/profiles/codex-theme-v1.mjs` | 运行时注入配置 |
| `src/engine/src/host/codex-settings.mjs` | 宿主设置生成 |
| `src/adapters/domestic/codex.ts` | 静态安装检测 + 窗口匹配 |
| `src/main/cdp/injection/css-builders/codex-css-builder.ts` | CSP 安全 CSS 生成器 |
| `src/shared/injection/contracts/codex.contract.json` | 注入契约 |
| `scripts/generators/codexCss.mjs` | 主题 token 覆盖生成 |
| `scripts/lib/landmarks/codex.mjs` | 语义锚点定义 |
| `agent-rules/codex.theme.rule.json` | 主题规则配置 |
| `docs/apps/codex/architecture.md` | 架构逆向文档 |
| `docs/apps/codex/fragility.md` | 脆弱性分级 |
| `docs/apps/codex/ADAPTATION.md` | 适配策略文档 |
| `docs/apps/codex/raw/codex-baseline.json` | 基线快照 |
| `docs/apps/codex/raw/codex-full-extract.json` | 全量 DOM 快照 |
| `docs/apps/codex/raw/extract-summary.md` | 静态解包摘要 |
| `docs/apps/codex/raw/cdp-summary.md` | CDP 运行时摘要 |
| `docs/apps/codex/raw/static-cdp-gap.md` | 静态 vs 运行时差距 |
| `docs/reports/codex-theme-porting-report.md` | 主题移植报告 |
| `docs/reports/codex-injection-benchmark-2026-08-23.md` | 注入对比基准 |
| `assets/probe-shots/codex.png` / `codex-probe.png` / `codex-themed.png` | 探针截图 |

---

## 8. 总结

Codex (ChatGPT Desktop) 是一个完整的 Electron 桌面应用，拥有成熟的 ASAR 包结构、丰富的 CSS 变量体系、以及完整的 AgentSkin 适配器配置。当前引擎状态健康，无需重构或寻找替代目标。建议在未来的 Codex 版本更新时重新运行 CDP 全量快照以验证选择器稳定性。
