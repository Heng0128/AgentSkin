---
name: agentskin-desktop
description: AI Agent 视觉定制引擎 — 通过 CDP 注入为 6 款 AI 应用提供主题与界面定制。自动安装、配置、换肤、验证。
version: 1.0.0
platforms:
  - win32
  - darwin
prerequisites:
  - node: ">=22.0.0"
  - npm: ">=9.0.0"
---

# AgentSkin Desktop — AI Agent 操作手册

> 本手册供外部 AI Agent（Claude Code、Cursor、Codex 等）读取，用于自动执行 AgentSkin 的安装、配置、换肤与排障。

---

## 1. 触发条件

当用户提出以下请求时，使用本 Skill：

- "给 XX 换肤"、"安装主题"、"应用皮肤"、"customize XX appearance"
- "安装 AgentSkin"、"配置 AgentSkin"、"apply AgentSkin"
- "traework 主题"、"workbuddy 换肤"、"doubao 美化"、"codex 主题"
- "列出可用主题"、"切换主题"、"恢复原生界面"
- "验证主题是否生效"、"排障"、"doctor"

---

## 2. 前置条件检查

在执行任何操作前，逐项确认：

### 2.1 运行环境

```bash
# 检查 Node.js 版本（要求 >= 22.0.0)
node --version

# 检查 npm 版本（要求 >= 9.0.0）
npm --version
```

**验证通过条件：** Node.js >= 22.0.0，npm >= 9.0.0。
**失败处理：** 提示用户升级 Node.js，推荐使用 nvm 或 fnm。

### 2.2 项目完整性

```bash
# 确认在项目根目录
ls package.json

# 确认依赖已安装
ls node_modules/.package-lock.json
```

**验证通过条件：** `package.json` 存在且 `node_modules` 已安装。
**失败处理：** 运行 `npm install`。

### 2.3 目标应用检测

按第 5 章「平台检测与应用发现」流程执行。

---

## 3. 平台检测

```
IF process.platform === 'win32':
  → Windows 平台：支持全部 6 个应用
ELIF process.platform === 'darwin':
  → macOS 平台：支持 traework、qoderwork、workbuddy、doubao、codex、zcode
ELSE:
  → Linux 不支持，通知用户并中止
```

> **注意：** Windows 是主要支持平台。macOS 支持全部 6 个应用（部分适配器仍在完善中）。Linux 不在官方支持范围内。

---

## 4. 安装流程

### 4.1 克隆与依赖安装

```bash
# 克隆仓库（如尚未克隆）
git clone <repository-url> agentskin-desktop
cd agentskin-desktop

# 安装依赖
npm install
```

**验证通过条件：** `npm install` 退出码为 0，无 `ERR!` 输出。
**失败处理：** 检查网络代理、npm 镜像源（推荐 `https://registry.npmmirror.com`）。

### 4.2 全量校验

```bash
npm run check
```

该命令依次执行 16 项独立检查（不短路）：

| 序号 | 检查项 | 不变量 |
|------|--------|--------|
| 1 | biome lint | 代码风格 |
| 2 | tsc --noEmit | 类型安全 |
| 3 | check-design-tokens | C6 设计 token 合规 |
| 4 | check-i18n | 中英 key 对齐 |
| 5 | check-themes | C2 14-token 契约 |
| 6 | check-architecture-boundaries | C4 分层依赖方向 |
| 7 | check-injection-contract | C1 AgentId 四源一致 |
| 8 | check-store-contracts | C5 Store 契约一致性 |
| 9 | check-native-defect-consistency | C8 缺陷修正一致性 |
| 10 | check-license-header | C7 SPDX 头部 |
| 11 | check-theme-staleness | C3 Palette-CSS 同步 |
| 12 | check-semantic-contract | 语义层隔离 |
| 13 | check-specificity-budget | CSS 特异性预算 |
| 14 | check-dependency-audit | 依赖供应链安全 |
| 15 | check-selector-fragility | 选择器健壮性 |
| 16 | generate-defect-fixes-doc --verify | C9 缺陷文档新鲜度 |

**验证通过条件：** 全部 16 项通过，退出码为 0。
**失败处理：** 根据输出定位失败项，逐一修复。

### 4.3 启动开发模式

```bash
npm start
```

> **注意：** `npm start` 实际执行 `electron-vite preview --skipBuild`（预览模式）。开发模式使用 `npm run dev`（执行 `electron-vite dev`）。

**验证通过条件：** Electron 窗口弹出，无控制台报错。
**失败处理：** 检查 `out/main/index.js` 是否存在（不存在则先 `npm run build`）。

---

## 5. 平台检测与应用发现

### 5.1 Windows 检测策略

对每个目标应用，按以下顺序检测（首次匹配即止）：

**方法 A — 文件系统扫描：**
```
扫描目录：
  - C:\Program Files\<dirName>
  - C:\Program Files (x86)\<dirName>
  - %LOCALAPPDATA%\Programs\<dirName>
  - %LOCALAPPDATA%\<dirName>
```

**方法 B — 注册表扫描：**
```
检查路径：
  - HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*
  - HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*
  - HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*
匹配 DisplayName
```

**方法 C — MSIX 包扫描（codex 专用）：**
```powershell
Get-AppxPackage -Name "OpenAI.Codex*"
```

**方法 D — 进程检查：**
```powershell
Get-Process -Name "<exeName>" -ErrorAction SilentlyContinue
```

### 5.2 macOS 检测策略

```
检查路径：
  - /Applications/<AppName>.app
  - ~/Applications/<AppName>.app
```

### 5.3 6 个目标应用检测参数

| Agent ID | 显示名 | 平台 | 目录名 | 可执行文件 |
|----------|--------|------|--------|-----------|
| `traework` | TRAE Work | win32, darwin | `TRAE SOLO CN` | `TRAE SOLO CN.exe` |
| `qoderwork` | QoderWork | win32, darwin | `QoderWork CN` | `QoderWork CN.exe` |
| `workbuddy` | WorkBuddy | win32, darwin | `WorkBuddy` | `WorkBuddy.exe` |
| `doubao` | 豆包 Desktop | win32, darwin | `Doubao` | `Doubao.exe` |
| `codex` | OpenAI Codex | win32, darwin | `ChatGPT` | `ChatGPT.exe` / MSIX `OpenAI.Codex` |
| `zcode` | ZCode | win32, darwin | `ZCode` | `ZCode.exe` |

### 5.4 CDP 就绪检测

目标应用必须暴露 CDP WebSocket 端口才能注入。

**端口发现三层策略：**
1. 读取 `DevToolsActivePort` 文件（位于应用用户数据目录）
2. 通过 PID argv 提取 `--remote-debugging-port` 参数
3. netstat 扫描应用 PID 的监听端口

**已知稳定端口（经验值，可能因版本变化）：**

| Agent ID | 默认 CDP 端口 |
|----------|-------------|
| traework | 9222 |
| qoderwork | 9223 |
| workbuddy | 9224 |
| doubao | 9225 |
| codex | 9226 |
| zcode | 9227 |

**验证端口存活：**
```
GET http://localhost:<port>/json/version
→ 响应包含 "webSocketDebuggerUrl" 即端口在线
```

---

## 6. 换肤流程

### 6.1 列出可用主题

```bash
# 列出 themes/ 下所有主题
ls themes/
```

每个主题目录结构：
```
themes/<theme-id>/
├── manifest.json          ← 主题元数据 + 14 个语义色 token
├── icon.webp              ← 主题图标
├── preview.webp           ← 预览截图
├── hero.jpg               ← Hero 背景图（可选）
├── palette.css            ← 生成的调色板 CSS
└── assets/
    └── css/
        ├── traework.css   ← 6 个 Agent 专用 CSS
        ├── qoderwork.css
        ├── workbuddy.css
        ├── doubao.css
        ├── codex.css
        └── zcode.css
```

**当前内置主题（15 个）：**
academy-corridor-winter、crimson-horned-mecha、exploding-tag-storm、fuji-balcony-overcast、fuji-rooftop-winter、galactic-garden、industrial-sage-toad、luffy-grand-departure、midnight-dessert-feast、miku-future-beats、shibuya-rooftop-mask、stage-bassist-blue、sunset-cellphone-girl、void-donut-boy、winged-mecha-ascendant、yule-fireplace-glow

### 6.2 读取主题详情

```bash
# 读取 manifest.json 获取主题完整信息
cat themes/<theme-id>/manifest.json
```

manifest.json 关键字段：
- `id`：唯一标识（与目录名一致）
- `displayName`：显示名
- `mode`：`"dark"` / `"light"` / `"auto"`
- `colors`：14 个语义色 token（accent, secondary, background, foreground, muted, surface, surfaceElevated, border, codeBackground, codeForeground, inputBackground, buttonBackground, buttonForeground, focusRing）
- `targets`：各 Agent 的 CSS 路径 + 验证锚点
- `supportedAgents`：支持的 Agent ID 列表

### 6.3 应用主题

#### 前提条件
1. 目标应用已安装（见第 5 章）
2. 目标应用正在运行且 CDP 就绪
3. 用户已选定主题

#### 注入流程

AgentSkin 采用五层注入架构（L0-L4）：

| 层 | 内容 | 来源 |
|----|------|------|
| L0 | 调色板：14 个 `--agentskin-*` CSS 变量 | `build-palette.mjs` 生成 |
| L1 | 原生 token 映射：目标应用 CSS 变量 → `var()` | `engines/<agent>/tokens.css` |
| L2 | 视觉打磨：圆角、阴影、间距 | `engines/<agent>/cosmetic.css` |
| L3 | 主题 CSS：主题特定样式 | 主题包 `assets/css/<agent>.css` |
| L4 | 结构适配：JS DOM 调整 + MutationObserver 自愈 | `engines/<agent>/adapter.mjs` |

**持久化机制：** `Page.addScriptToEvaluateOnNewDocument` 确保注入在目标应用导航后依然有效。

**注入顺序（由主进程编排）：**
```
adopted-sheets-manager → token-discovery → deep-core → hybrid-injector → adapter.mjs
```

#### 通过 MCP Server 操作（推荐）

AgentSkin 提供 MCP Server（stdio transport），暴露 7 个工具：

```bash
# 启动 MCP Server
node scripts/agent-skin-mcp-server.mjs
```

| 工具名 | 用途 | 参数 |
|--------|------|------|
| `list-targets` | 列出所有可注入目标 | 无 |
| `get-server-status` | 获取服务状态与 CDP 端口占用 | 无 |
| `take-screenshot` | CDP 截图 | `agentId`, `format?` |
| `get-dom-snapshot` | 获取 DOM 树快照 | `agentId`, `maxDepth?` |
| `verify-injection` | 验证注入状态 | `agentId` |
| `list-discovery-targets` | 发现所有可用注入目标 | 无 |
| `get-applied-theme` | 获取当前应用的主题 | `agentId` |

#### 通过 CDP 直接注入（无 MCP 时）

```javascript
// 1. 连接 CDP WebSocket
const ws = new WebSocket('ws://localhost:<port>/devtools/page/<targetId>');

// 2. 注入主题 CSS
const style = document.createElement('style');
style.setAttribute('data-agentskin-theme', '<theme-id>');
style.textContent = /* 读取 themes/<theme-id>/assets/css/<agentId>.css */;
document.head.appendChild(style);

// 3. 设置 MutationObserver 自愈
const observer = new MutationObserver(() => {
  if (!document.querySelector('[data-agentskin-theme="<theme-id>"]')) {
    // 重新注入
  }
});
observer.observe(document.head, { childList: true, subtree: true });
```

---

## 7. 验证流程（三重验证）

### 7.1 第一重：注入标记检查

```bash
# 通过 MCP 工具
→ verify-injection: agentId="<agentId>"
```

检查以下标记：
- `globalThis.__AGENTSKIN__` 运行时桥接对象
- `document.adoptedStyleSheets` 中的 `__agentskin` 规则
- `document.documentElement` 上的 `agentskin-host-<agentId>` CSS 类

**验证通过条件：** `injected === true`，`themeId` 与预期一致。

### 7.2 第二重：DOM 选择器命中检查

每个主题的 `manifest.json` 定义了 `targets.<agentId>.verification.required` 选择器：

| Agent ID | 必需选择器（任一匹配） |
|----------|----------------------|
| traework | `.panel-container`, `.solo-lite-layout` |
| qoderwork | `.agents-layout-root` |
| workbuddy | `.teams-container` |
| doubao | 主题定义 |
| codex | 主题定义 |
| zcode | 主题定义 |

```javascript
// CDP Runtime.evaluate
document.querySelector('.panel-container') !== null  // traework 示例
```

**验证通过条件：** 每个 required 组至少一个选择器匹配。

### 7.3 第三重：视觉确认

```bash
# 通过 MCP 工具截图
→ take-screenshot: agentId="<agentId>"
```

**验证通过条件：** 截图显示主题色生效（背景色、强调色与 manifest.json 中 `colors` 一致）。

### 7.4 运行时质量门禁

```bash
# 连接 CDP 后采样计算样式
node scripts/runtime-check-all.mjs
```

检查项：
- 对比度（WCAG AA 标准）
- 水平溢出
- 关键选择器命中

---

## 8. Guardrails（安全边界）

### 8.1 禁止操作

| # | 禁止项 | 原因 |
|---|--------|------|
| 1 | **禁止修改目标应用的 `app.asar`** | AgentSkin 仅通过 CDP 注入，不修改目标应用文件。修改 app.asar 违反设计原则，且会在应用更新时失效 |
| 2 | **禁止未经用户同意重启运行中的应用** | 强制终止 AI Agent 可能导致数据丢失 |
| 3 | **禁止自建服务端、CDN、账号系统** | AgentSkin 定位为引擎非产品，无服务端 |
| 4 | **禁止在代码或日志中写入密钥/Token** | 安全红线 |
| 5 | **禁止注入后不验证** | 必须执行三重验证（第 7 章） |
| 6 | **禁止引入新适配器** | 6 个适配器上限，除非用户基数大且无原生主题能力 |
| 7 | **禁止 Studio 新增创作类功能** | 功能边界约束 |

### 8.2 CDP 安全约束

- CDP **仅绑定回环地址**（`127.0.0.1`），不暴露到局域网
- 注入为**会话级别**（session-scoped），默认不持久化到应用重启
- 目标应用更新后注入可能失效，需重新应用

### 8.3 MSIX 沙箱限制

codex 通过 Microsoft Store（MSIX）安装时，Windows App Container 沙箱可能限制 CDP 注入。
**处理：** 如注入失败，建议用户安装非 MSIX 版本。

---

## 9. 排障指南

### 9.1 常见问题速查

| 症状 | 原因 | 解决方案 |
|------|------|----------|
| `npm install` 失败 | 网络/镜像源 | 切换 npm 镜像：`npm config set registry https://registry.npmmirror.com` |
| `npm run check` 失败 | 某项不变量违规 | 根据输出定位失败 check，参照 `scripts/INDEX.md` 修复 |
| 应用未检测到 | 未安装或路径非标准 | 手动确认安装路径，检查注册表 |
| CDP 连接超时 | 应用未启动或端口未开放 | 确认应用运行；检查 DevToolsActivePort 文件 |
| 注入后无效果 | CSS 选择器不匹配 | 运行 `verify-injection` 检查标记；确认 DOM 选择器命中 |
| 主题部分生效 | 14-token 不完整 | 检查 manifest.json colors 是否齐全 |
| 应用重启后主题消失 | 正常行为（会话级注入） | AgentSkin 运行时通过 `addScriptToEvaluateOnNewDocument` 持久化 |
| 截图失败 | CDP target 不匹配 | 确认 target URL scheme 与应用匹配 |
| MSIX 注入失败 | 沙箱限制 | 建议安装非 MSIX 版本 |

### 9.2 错误码参考

| 错误码 | 含义 | 处理 |
|--------|------|------|
| `AGENT_NOT_RUNNING` | 目标应用未运行或 CDP 端口不可达 | 启动应用或检查端口 |
| `not-installed` | 应用未安装 | 引导用户安装 |
| `no-cdp` | 应用运行但无调试端口 | 需重启应用以启用 CDP |
| `spawn-error` | 启动应用失败 | 检查杀毒软件/权限 |
| `singleton-lock` | 应用单例模式已运行 | 使用运行中的实例 |
| `verification-failed` | DOM 选择器未命中 | 主题 CSS 可能不兼容当前应用版本 |

### 9.3 诊断命令

```bash
# 检查 MCP Server 状态
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-server-status","arguments":{}}}' | node scripts/agent-skin-mcp-server.mjs

# 发现所有可用注入目标
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list-discovery-targets","arguments":{}}}' | node scripts/agent-skin-mcp-server.mjs

# 验证注入状态
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"verify-injection","arguments":{"agentId":"workbuddy"}}}' | node scripts/agent-skin-mcp-server.mjs

# 获取当前主题
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get-applied-theme","arguments":{"agentId":"workbuddy"}}}' | node scripts/agent-skin-mcp-server.mjs
```

---

## 10. 还原流程

### 10.1 会话级移除（临时）

```javascript
// CDP Runtime.evaluate
document.querySelectorAll('[data-agentskin-theme]').forEach(el => el.remove());
```

**效果：** 移除当前会话的主题注入，应用重启后自动恢复原生界面。

### 10.2 完整还原（通过 AgentSkin）

如果 AgentSkin 正在运行：
```
AgentEngineService.restore(agentId)
→ 移除所有注入层（L0-L4）
→ 恢复原始明暗方案
→ 移除视频壁纸（如有）
```

### 10.3 手动清理（无 AgentSkin 时）

```
1. 关闭目标应用
2. 删除 DevToolsActivePort 文件（位于应用用户数据目录）
3. 重启应用
→ 所有会话级 CSS 清除
```

---

## 11. 主题包格式速览

### 11.1 14-Token 契约

每个主题必须定义 14 个语义色 token：

| Token | 用途 |
|-------|------|
| `accent` | 强调色（链接、按钮、焦点） |
| `secondary` | 次要强调色 |
| `background` | 主背景色 |
| `foreground` | 主文字色 |
| `muted` | 次要文字/图标色 |
| `surface` | 卡片/面板背景 |
| `surfaceElevated` | 浮层/弹窗背景 |
| `border` | 边框色 |
| `codeBackground` | 代码块背景 |
| `codeForeground` | 代码文字色 |
| `inputBackground` | 输入框背景 |
| `buttonBackground` | 按钮背景 |
| `buttonForeground` | 按钮文字色 |
| `focusRing` | 焦点环色 |

### 11.2 分发格式

- `.agentskin-theme`：主题包（目录或压缩包）
- `.agentskin-bundle`：环境组合包（主题 + 壁纸）

### 11.3 导入转换支持

- Codedrobe (`.codedrobe-theme`)
- DreamSkin (`.dsh-skin`, `.zip`)
- 源码目录
- 已有 `.agentskin-theme`

解析器注册表：`src/shared/import/theme-source-parser.ts`

---

## 12. 命令速查表

| 命令 | 用途 |
|------|------|
| `npm install` | 安装依赖 |
| `npm run dev` | 开发模式（热重载） |
| `npm start` | 预览模式（跳过构建） |
| `npm run build` | 构建 |
| `npm test` | 运行测试（vitest） |
| `npm run check` | 全量校验（16 项不变量） |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | Biome lint |
| `npm run lint:fix` | Biome 自动修复 |
| `npm run design-tokens` | 设计 token 合规检查 |
| `npm run package` | 打包 Windows 版 |
| `npm run package:dir` | 打包为目录（免安装） |

---

## 附录 A：项目结构速览

```
agentskin-desktop/
├── src/
│   ├── main/           ← Electron 主进程（IPC、服务、CDP）
│   ├── ui/             ← React 渲染进程（组件、Store）
│   ├── shared/         ← 共享类型、工具
│   ├── engine/         ← 引擎核心（CDP session、主题包读写）
│   ├── adapters/       ← 6 个适配器定义
│   └── legacy/         ← 运行时桥接层
├── engines/            ← 6 个适配器运行时三件套
│   ├── traework/       ← adapter.mjs + tokens.css + cosmetic.css
│   ├── qoderwork/
│   ├── workbuddy/
│   ├── doubao/
│   ├── codex/
│   ├── zcode/
│   └── shared/         ← DeepCore、HybridInjector 等共享模块
├── themes/             ← 15 个内置主题
├── scripts/            ← 校验/构建/生成脚本（80+）
├── docs/               ← 架构/规范/报告文档
│   ├── ARCHITECTURE.md
│   ├── THEME_SPEC.md
│   ├── THEME_API.md
│   └── reports/
└── tests/              ← 测试文件（103 个）
```

## 附录 B：关键文档索引

| 文档 | 内容 |
|------|------|
| `docs/ARCHITECTURE.md` | 架构总览与模块地图（活文档） |
| `docs/THEME_SPEC.md` | 主题包规范 v2.1 |
| `docs/THEME_API.md` | 主题包接口规范 |
| `docs/PRODUCT.md` | 产品定位与护城河 |
| `docs/ROADMAP.md` | 当前路线与优先级 |
| `docs/design-tokens.md` | 设计 token 规范 |
| `docs/native-defect-fixes.md` | 原生缺陷修正规则（自动生成） |
| `scripts/INDEX.md` | 脚本用途与约定 |
