# CodeDrobe/core 深度技术分析

> **分析日期**: 2026-08-27
> **仓库**: https://github.com/CodeDrobe/core
> **版本**: v0.7.0-beta.0
> **许可证**: Apache-2.0

---

## 摘要

CodeDrobe/core 是一个面向 Chromium/Electron 桌面应用的**多应用主题 CLI 运行时**。它通过 CDP（Chrome DevTools Protocol）在 loopback 接口上注入可逆的 CSS 主题包，不修改应用安装包、不重写 `app.asar`。其核心设计哲学是**声明式、无 JS、可回滚**——主题包只包含 JSON 元数据、CSS 和内嵌图片，禁止携带可执行 JavaScript。

与 AgentSkin 的「引擎 + Studio + UI」全栈架构不同，CodeDrobe 是一个**纯 CLI 库**，没有图形界面，面向的是 Agent/AI Skill 调用场景和 Electron 主进程集成场景。

---

## 1. 架构分析

### 1.1 目录结构

```
src/
├── adapters/          # 应用适配器（纯声明式对象）
│   ├── index.mjs      # 适配器注册表
│   ├── codex.mjs      # OpenAI Codex
│   ├── workbuddy.mjs  # Tencent WorkBuddy
│   ├── qoderwork.mjs  # QoderWork (CN + 全球版)
│   └── traework.mjs   # TRAE SOLO (CN + 全球版)
├── auth/              # 商店认证与凭证管理
├── cdp/               # CDP WebSocket 会话抽象
│   └── session.mjs    # CdpSession 类
├── host/              # 宿主应用设置管理
│   └── codex-settings.mjs  # Codex 外观配置读写
├── runtime/           # 核心运行时
│   ├── skin.mjs       # 高层 API: applySkin / restoreSkin
│   ├── injector.mjs   # 注入/验证/移除/快照
│   ├── launcher.mjs   # 应用发现、启动、端口解析
│   ├── renderer-payload.mjs  # 构建注入到渲染进程的 JS 表达式
│   ├── dom-snapshot.mjs      # DOM 快照（用于 AI 辅助主题制作）
│   ├── host-settings.mjs     # 宿主设置事务抽象
│   └── profiles/              # 渲染器配置档案
│       └── codex-theme-v1.mjs # 旧版 Codex 主题兼容层
├── theme/             # 主题包处理
│   ├── package.mjs    # 打包/校验/读取/转换
│   ├── store.mjs      # 主题商店 API（搜索/下载）
│   ├── legacy.mjs     # 旧版 .codex-theme 转换
│   └── publish.mjs    # 发布到商店
├── cli.mjs            # CLI 入口（约 27K 字符）
├── index.mjs          # 公共 API 入口
└── update.mjs         # 自更新检查
```

### 1.2 分层设计

CodeDrobe 的分层比 AgentSkin 更扁平：

```
┌─────────────────────────────────────────────┐
│                  CLI (cli.mjs)               │
│  apps / detect / apply / probe / verify /    │
│  restore / dom / theme / update              │
├─────────────────────────────────────────────┤
│             High-Level API (skin.mjs)        │
│  applySkin() / restoreSkin() / watchTheme()  │
├─────────────────────────────────────────────┤
│           Runtime Services                   │
│  injector.mjs  launcher.mjs  host-settings   │
├─────────────────────────────────────────────┤
│         CDP Transport (cdp/session.mjs)      │
│         WebSocket + Runtime.evaluate         │
├─────────────────────────────────────────────┤
│        Adapter Objects (adapters/*.mjs)      │
│  声明式配置: 端口/路径/探针/平台差异          │
└─────────────────────────────────────────────┘
```

### 1.3 与 AgentSkin 架构对比

| 维度 | CodeDrobe/core | AgentSkin (desktop-main) |
|------|---------------|-------------------------|
| **定位** | CLI 运行时库 | 完整桌面应用 (Electron) |
| **用户界面** | 无（面向 Agent/CLI） | React 19 + Tailwind v4 |
| **技术栈** | 纯 Node.js ESM (.mjs) | React + Zustand + Electron |
| **分层** | CLI → Runtime → CDP | UI → preload → IPC → 主进程 → 适配器 → CDP |
| **适配器形式** | 声明式对象字面量 | TypeScript 类 + 策略模式 |
| **主题格式** | 声明式 JSON（无 JS） | 14-token 主题契约 |
| **状态管理** | 无持久化状态 | 12+ Zustand Store |
| **商店** | 有（API 集成） | 无（禁止自建 CDN/服务端） |
| **验证机制** | 声明式 required/recommended/contexts | 运行时 probe + verify |
| **包大小** | ~50KB 源码 | 完整 Electron 应用 |

**关键设计差异**:

1. **无 UI 层**: CodeDrobe 是纯后端库，不提供图形界面。它的消费者是 AI Skill（通过 CLI 调用）或 Electron 主进程（通过 npm 包导入）。
2. **适配器即数据**: 适配器是纯对象，不包含方法逻辑。所有运行时逻辑（发现、启动、注入、验证）由通用引擎处理，适配器只提供差异化配置。
3. **声明式验证**: 验证规则完全声明在 JSON 配置中，无需编写验证代码。

---

## 2. QoderWork 适配技术细节

### 2.1 `remote-debugging-port=0` 限制的处理

QoderWork 所有版本的主进程都强制设置 `remote-debugging-port=0`，这意味着调用者无法预知实际的 CDP 端口。CodeDrobe 的解决方案：

**设计思想**: 放弃端口控制权，转而通过文件系统发现实际端口。

**机制**:
- Chromium 在启动时会将实际绑定的端口写入 `DevToolsActivePort` 文件
- 不同版本（CN/全球）使用不同的用户数据目录，因此有各自独立的端口文件
- 配置中声明了 `devToolsActivePortFile` 数组，运行时轮询这些文件读取实际端口
- 显式传入的 `--port` 参数始终优先于文件发现

**可借鉴思想**: 当目标应用不配合提供固定端口时，利用 Chromium 自身的 `DevToolsActivePort` 文件作为服务发现机制。这是一种「约定优于配置」的思路——不要求目标应用配合，而是利用平台标准行为。

### 2.2 DevToolsActivePort 文件发现机制

```
macOS CN:  ~/Library/Application Support/QoderWork CN/DevToolsActivePort
macOS 全球: ~/Library/Application Support/QoderWork/DevToolsActivePort
Windows CN: %APPDATA%\QoderWork CN\DevToolsActivePort
Windows 全球: %APPDATA%\QoderWork\DevToolsActivePort
```

**实现要点**:
- 读取文件第一行，解析为整数端口
- 验证端口范围 (1024-65535)
- 支持多edition场景下的多文件轮询
- 启动过程中持续重试读取（因为文件在启动后才生成）

### 2.3 CN 版 vs 全球版差异处理

CodeDrobe 采用「一个适配器覆盖多版本」的策略：

- **Bundle ID**: `com.qoder.work.cn` (CN) / `com.qoder.work` (全球)
- **验证状态**: 仅 macOS CN 版 0.9.12 通过真机验证
- **静态分析依据**: 官方安装包的渲染层样式表逐字节一致，地标类名清单完全相同
- **结论**: 一个 adapter id 服务两个版本，主题无需区分

**设计思想**: 当多个版本共享相同的渲染层 DOM 结构时，无需为每个版本单独维护适配器。通过静态分析验证一致性后，可以安全地合并。

### 2.4 验证流程: probe → apply → verify

```
probe:   检查当前 DOM 是否兼容（不注入、不修改）
   ↓
apply:   预检 → 注入 CSS → 等待 500ms → 验证
   ↓
verify:  独立验证已注入主题的完整性
```

**预检逻辑**:
1. 等待 CDP target 出现
2. 构建兼容性检查表达式（合并适配器基础探针 + 主题探针）
3. 在渲染进程中执行 `Runtime.evaluate`
4. 根地标缺失 → 视为启动中，给予完整启动预算重试
5. 根地标存在但其他不匹配 → 给予较短稳定预算

---

## 3. TRAE SOLO 适配技术细节

### 3.1 VS Code 衍生应用的识别方法

TRAE SOLO 基于 Code-OSS（VS Code 开源版），但主窗口是自定义的 solo-lite shell，不是 Monaco 编辑器工作台。

**识别策略**:
- URL 匹配: `/\/electron-browser\/solo\/solo-lite\.html/i`
- 排除辅助窗口（进程浏览器、文件预览等位于 `electron-browser` 其他子目录的页面）

**关键洞察**: 不是所有 VS Code 衍生应用都使用 Monaco 工作台作为主窗口。TRAE SOLO 使用 React 渲染的自定义 shell（`#root`），这意味着：
- 不能复用 VS Code 的 `workbench.css` 选择器
- 需要独立提取 solo-lite 的 DOM 结构
- 但保留了 VS Code 的某些约定（如 `electron-browser` 目录结构）

### 3.2 solo-lite shell vs Monaco workbench

| 特征 | solo-lite shell | Monaco workbench |
|------|----------------|-----------------|
| 渲染技术 | React | 原生 DOM + CSS |
| 根选择器 | `#root .panel-container` / `#root .solo-lite-layout` | `.monaco-workbench` |
| CSS 类名 | 语义化（`.task-list-base`, `.chat-input-v2-...`） | Monaco 内部命名 |
| 注入策略 | 标准 CSS 注入 | 需要处理 Shadow DOM |

### 3.3 Windows Inno Setup AppId 发现机制

TRAE SOLO 在 Windows 上通过 Inno Setup 安装，CodeDrobe 使用注册表卸载键来定位安装路径：

```
HKCU/HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}_is1
```

**8 个 GUID** 覆盖了 x64/arm64 × 用户/系统 × 全球/CN 的组合。

**可借鉴思想**: 对于 Inno Setup 安装的应用，注册表卸载键是最可靠的发现方式，尤其是当应用安装在非默认驱动器时。`DisplayIcon` 和 `InstallLocation` 两个值都可以用于定位可执行文件。

### 3.4 CN 版 bundleId

```
cn.trae.solo.app
```

与全球版 `com.trae.solo.app` 不同，但共享相同的 Code-OSS commit (`ce5758dc`) 和逐字节一致的 solo-lite UI 样式表。

---

## 4. 每窗口 probe/verify 机制

### 4.1 二级窗口的跳过逻辑

CodeDrobe 对多窗口场景的处理非常精细：

**核心问题**: 弹出式聊天窗口、隐藏 overlay 等二级表面缺少主窗口的 DOM 结构，如果按主窗口标准验证，会导致合法窗口被误判为不兼容。

**解决方案 — `markSecondaryTargets` 函数**:

```
1. 检查是否至少有一个窗口满足主窗口条件（compatible === true）
2. 如果有 → 将不满足条件的窗口标记为 skipped: true
3. 如果没有主窗口 → 不标记任何窗口，让真正的问题暴露
```

**设计思想**: 「相对兼容性」而非「绝对兼容性」。只要有一个窗口能工作，其他窗口的缺失就是合理的退化，而非错误。

### 4.2 验证失败时的错误报告格式

```javascript
{
  code: "CODEDROBE_VERIFY_FAILED",
  message: "Theme application verification failed for N renderer target(s): 
            <窗口描述> → <原因1>; <原因2> ‖ ...",
  missing: [
    { scope: "adapter|theme", context: "contextName", 
      severity: "required|recommended", name: "landmarkName",
      selectors: [".sel1", ".sel2"], invalidSelectors: [] }
  ],
  results: [ /* 每个窗口的完整结果 */ ]
}
```

**错误原因类型**:
- 缺少必需的 DOM 地标
- 水平溢出（主题将布局撑出视口）
- 主题样式表缺失
- 主题运行时未安装

### 4.3 AgentSkin 可借鉴的验证模式

1. **声明式验证配置**: 将验证规则从代码中分离为 JSON 配置，使非开发者也能理解和编写验证规则。
2. **三级严重度**: `required`（阻断）/ `recommended`（警告）/ `contexts`（条件性检查）。
3. **启动中检测**: 根地标缺失不立即失败，而是给予启动预算重试。
4. **二级窗口跳过**: 通过相对兼容性判断避免误判。
5. **错误上下文丰富**: 错误信息包含窗口标识、作用域、上下文、尝试过的选择器、解析错误等。

---

## 5. 可借鉴的设计模式

### 5.1 声明式验证配置

CodeDrobe 的验证系统完全由声明式配置驱动：

```json
{
  "required": [
    { "name": "chat-surface", "any": [".chat-container", ".wb-cb-chat"] }
  ],
  "recommended": [
    { "name": "conversation-list", "any": [".conversation-list"] }
  ],
  "contexts": [
    {
      "name": "active-chat",
      "when": { "any": [".chat-route"] },
      "required": [
        { "name": "message-list", "any": [".message-list"] }
      ]
    }
  ]
}
```

**核心原则**:
- `any` 列表表示「任一匹配即通过」—— 适应应用的 DOM 变化
- `required` 缺失阻断注入，`recommended` 缺失仅警告
- `contexts` 实现页面路由感知的验证（只在特定页面检查特定元素）
- 适配器只保留跨页面稳定的地标，主题 target 中声明功能/页面特定的依赖

**可借鉴思想**: 将验证逻辑从「写代码判断」转变为「声明期望」，降低主题开发和适配器维护的门槛。

### 5.2 DOM 快照 API

CodeDrobe 提供只读的 DOM 快照功能，用于 AI 辅助主题制作：

**捕获内容**:
- 元素父子关系、深度、标签
- 语义类名（过滤掉生成类名如 CSS Modules hash）
- 安全属性（`role`, `data-testid`, `aria-*`, `contenteditable` 等）
- 候选选择器及其匹配数量
- 边界框（位置和尺寸）
- 主题相关的计算样式（33 个 CSS 属性）
- 适配器地标命中情况

**隐私保护**:
- 排除文本内容、表单值、可访问名称
- 排除 URL 查询参数和 hash
- 排除链接和媒体源
- URL 路径中的长哈希/数字段替换为 `:id`

**可借鉴思想**: 为 AI 提供结构化的 DOM 信息时，需要平衡「信息丰富度」与「隐私安全」。CodeDrobe 的白名单属性方法和 URL 脱敏策略值得参考。

### 5.3 自动端口发现

CodeDrobe 的端口发现策略是一个多层回退系统：

```
1. 用户显式指定的 --port（最高优先级）
2. 适配器配置的 defaultPort
3. DevToolsActivePort 文件读取（针对强制 port=0 的应用）
4. 轮询所有候选端口，检查是否有匹配的 CDP target
```

**设计思想**: 不要假设端口是固定的。目标应用可能强制使用随机端口、可能有多个实例、可能使用非标准端口。通过「尝试 + 验证」的方式确定有效端口。

### 5.4 主题包格式（声明式、无 JS）

`.codedrobe-theme` 是纯 JSON 文件（非 ZIP），结构如下：

```json
{
  "format": "codedrobe-theme",
  "schemaVersion": 1,
  "theme": { "id": "...", "displayName": "...", "version": "..." },
  "targets": {
    "codex": { "css": "/* CSS */", "options": {...}, "verification": {...} },
    "workbuddy": { "css": "/* CSS */", "verification": {...} }
  },
  "assets": {
    "images": {
      "hero": { "filename": "hero.webp", "mimeType": "image/webp", "base64": "..." }
    }
  }
}
```

**约束**:
- 禁止外部 CSS（`@import` 和 `url(...)` 远程资源被拒绝）
- 禁止 JavaScript
- 最多 32 张图片，单包 30MB 限制
- 图片通过 Blob URL 注入，映射为 CSS 变量 `--codedrobe-image-<id>`

**可借鉴思想**: 主题包的安全性通过「格式约束」而非「运行时沙箱」实现。禁止 JS 和远程资源从根本上消除了主题包的安全风险。

### 5.5 渲染器配置档案（Renderer Profiles）

CodeDrobe 引入了「渲染器配置档案」的概念，用于处理需要特殊 DOM 操作的主题（如旧版 Codex 主题需要注入装饰层 DOM 元素）：

```javascript
// 档案由适配器声明，主题通过 ID 引用
rendererProfiles: {
  "codex-theme-v1": {
    runtime: ({ theme, imageDataUrls, imageUrls }) => ({
      ensure: () => { /* 创建/更新装饰层 DOM */ },
      cleanup: () => { /* 移除装饰层 */ },
      verify: () => ({ pass: true/false, missing: [...] })
    }),
    cleanup: () => { /* 静态清理函数 */ }
  }
}
```

**设计思想**: 将「需要 JS 运行时的特殊情况」隔离为受信任的、由适配器声明的档案，而非允许主题自带 JS。主题只能通过 ID 引用档案，不能提供代码。

### 5.6 事务式应用与回滚

`applySkin()` 实现了完整的事务语义：

```
1. 准备宿主设置（备份原配置）
2. 启动应用（如需要）
3. 注入主题到渲染进程
4. 验证注入结果
   ↓ 失败
5. 回滚渲染器（移除已注入的 CSS）
6. 回滚宿主设置（恢复原配置）
```

**设计思想**: 主题应用应该是原子操作——要么完全成功，要么完全回滚。部分成功的状态对用户来说是最糟糕的体验。

### 5.7 选择器 Lint 系统

CodeDrobe 在主题打包和检查时提供非阻断的选择器 lint 警告：

- **位置选择器**: `:nth-child` / `:first-child` 等对 DOM 顺序敏感
- **深子链**: 超过 3 层 `>` 直接子选择器
- **本地化属性**: `[aria-label="..."]` 等依赖文本内容的选择器
- **生成类名**: CSS Modules hash、BEM 变体等不稳定类名
- **过长选择器**: 超过 180 字符

**可借鉴思想**: 在主题开发阶段就识别潜在脆弱性，而不是等到应用更新后才发现主题失效。

---

## 6. 适配器设计规范

CodeDrobe 对适配器的职责有明确定义：

### 6.1 适配器只描述宿主差异

- macOS Bundle ID、候选路径、可执行文件相对路径
- Windows Appx 包、候选路径、注册表卸载键
- 独立默认 CDP 端口
- CDP 页面目标识别规则（`matchTarget`）
- 验证探针（`verification`）
- 每平台最后验证版本和日期（`lastVerified`）
- 可选的渲染器配置档案和宿主设置处理器

### 6.2 运行时逻辑由通用引擎处理

以下逻辑全部在 `runtime/` 中实现，新增适配器无需复制：
- CDP 会话管理
- 注入前预检
- 主题探针合并
- 缺失节点报告
- 重载监听
- 截图
- 主题包校验
- 宿主设置事务和恢复

### 6.3 适配器注册

```javascript
const adapters = new Map(
  [codex, workbuddy, qoderwork, traework].map(
    (adapter) => [adapter.id, adapter]
  )
);
```

适配器通过 `registerAdapter()` 动态注册，无需修改引擎代码。

---

## 7. 技术栈与工程实践

### 7.1 技术选型

- **语言**: 纯 JavaScript ESM (`.mjs`)，仅分发时附带 `.d.ts` 类型声明
- **运行时**: Node.js >= 22.4（使用原生 WebSocket）或 Bun >= 1.3
- **依赖**: 零运行时依赖（仅 devDependencies 有 TypeScript）
- **测试**: Node.js 内置 `node:test` 框架
- **类型检查**: `tsc --noEmit`（仅检查测试类型，不编译源码）

### 7.2 包结构

```json
{
  "exports": {
    ".": { "types": "./types/index.d.ts", "default": "./src/index.mjs" },
    "./adapters": { "types": "./types/adapters.d.ts", "default": "./src/adapters/index.mjs" },
    "./theme": { "types": "./types/theme.d.ts", "default": "./src/theme/index.mjs" }
  }
}
```

支持三种导入方式：
- `import { applySkin } from "@codedrobe/core"` — 完整 API
- `import { getAdapter } from "@codedrobe/core/adapters"` — 仅适配器
- `import { readThemePackage } from "@codedrobe/core/theme"` — 仅主题工具

### 7.3 自更新机制

CLI 内置更新检查：
- 全局安装时，每 24 小时检查一次新版本
- JSON 输出、CI、非交互执行不检查
- 可通过环境变量禁用

---

## 8. 总结与定位

### 8.1 CodeDrobe 的核心优势

1. **极简架构**: 纯 CLI 库，零运行时依赖，单包 ~50KB
2. **声明式优先**: 适配器、验证规则、主题格式全部声明式
3. **安全设计**: 主题包禁止 JS，从格式层面消除安全风险
4. **事务语义**: 完整的应用-验证-回滚流程
5. **多窗口处理**: 智能区分主窗口和二级窗口
6. **AI 友好**: DOM 快照 API 专为 AI 辅助主题制作设计

### 8.2 与 AgentSkin 的互补关系

CodeDrobe 和 AgentSkin 解决的是同一问题的不同层面：

| 层面 | CodeDrobe | AgentSkin |
|------|-----------|-----------|
| **运行时** | CLI / 库 | Electron 主进程 |
| **用户界面** | 无 | React 完整 UI |
| **主题制作** | AI 辅助（DOM 快照） | Studio 可视化编辑 |
| **主题分发** | 商店（API） | 本地/手动 |
| **目标用户** | AI Agent / 开发者 | 终端用户 |
| **适配器管理** | 内置 4 个 | 内置 6 个 |

### 8.3 可借鉴清单（仅供学习参考）

以下设计思想值得在 AgentSkin 架构优化时参考：

1. **声明式验证配置** — 将验证规则从代码分离为配置
2. **DevToolsActivePort 发现** — 处理强制随机端口的应用
3. **二级窗口跳过逻辑** — 相对兼容性判断
4. **启动中检测** — 区分「未启动」和「不兼容」
5. **DOM 快照隐私保护** — 白名单属性 + URL 脱敏
6. **选择器 Lint** — 开发阶段识别脆弱选择器
7. **事务式回滚** — 原子操作保证
8. **渲染器配置档案** — 隔离受信任的特殊操作
9. **适配器即数据** — 降低新增适配器的边际成本

---

## 附录 A: 适配器验证状态

| 适配器 | macOS | Windows | 真机验证版本 |
|--------|-------|---------|-------------|
| codex | 已验证 | 已验证 (MS Store) | 26.707.72221 |
| workbuddy | 已验证 | 已验证 | 5.2.6 |
| qoderwork (CN) | 已验证 | 静态分析 | 0.9.12 |
| qoderwork (全球) | 静态分析 | 静态分析 | 0.9.12 |
| traework (全球) | 已验证 | 静态分析 | 0.1.36 |
| traework (CN) | 静态分析 | 静态分析 | 0.1.36 |

## 附录 B: 关键源码文件索引

| 文件 | 用途 |
|------|------|
| `src/runtime/skin.mjs` | 高层 API: applySkin / restoreSkin |
| `src/runtime/injector.mjs` | 注入/验证/移除/快照/监听 |
| `src/runtime/launcher.mjs` | 应用发现、启动、端口解析 |
| `src/runtime/renderer-payload.mjs` | 构建注入表达式 |
| `src/runtime/dom-snapshot.mjs` | DOM 快照生成 |
| `src/cdp/session.mjs` | CDP WebSocket 会话 |
| `src/theme/package.mjs` | 主题包校验/打包/读取 |
| `src/adapters/index.mjs` | 适配器注册表 |

---

> **声明**: 本报告仅供技术学习分析使用。文中涉及的设计思想、架构模式、技术方案等仅供参考，不构成对 AgentSkin 项目的具体实施建议。任何代码层面的实现应遵循 AgentSkin 项目自身的不变量约束和架构规范。
