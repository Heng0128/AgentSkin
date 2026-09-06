# 竞品深度分析报告：aiwenjie777/codex-skin-skill

> 分析日期：2026-08-24 | 分析师：AgentSkin 架构组
> 仓库地址：https://github.com/aiwenjie777/codex-skin-skill
> 关联原始项目：Fei-Away/Codex-Dream-Skin（本项目衍生源）

---

## 一、项目概览

| 指标 | 数据 |
|------|------|
| Stars | 51 |
| Forks | 6 |
| Watchers | 51 |
| Open Issues | 1 |
| License | MIT (继承自 Codex-Dream-Skin) |
| 创建时间 | 2026-07-16 |
| 最后更新 (GitHub 显示) | 2026-08-24 |
| 最后代码提交 | 2026-07-23（main 分支 HEAD） |
| 主语言 | Shell 77.7KB / JavaScript 61.7KB / CSS 41.6KB / PowerShell 7KB |
| 正式发布 (Releases) | 无 |
| 贡献者 | 单人项目（aiwenjie777 / hukaiwen） |
| 版本号 | plugin.json 声明 `0.2.0`；macOS VERSION 文件声明 `1.3.4` |

### 活跃度判断

- **代码冻结**：最后一次有意义的代码提交在 2026-07-23，距今超过一个月。最近 commit 仅为群二维码图片更新、README 作者署名修复、Git 身份保护等文档类 PR，无实质性功能迭代。
- **无 Release 管理**：GitHub Releases 为空，用户需直接从 `main` 分支获取代码。
- **生态规模小**：51 star / 6 fork，单人维护，无社区 PR。
- **产品化了原始项目**：本质是对 Fei-Away/Codex-Dream-Skin 的"Skill 化包装"，将 macOS 引擎（Dream Skin Studio）和新增 Windows 支持统一到 `.codex-plugin` 插件体系下。

---

## 二、技术架构分析

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────┐
│  Codex 桌面端 (用户直接在对话中发出指令)              │
└──────────────┬──────────────────────────────────────┘
               │ Skill 指令 (自然语言)
               ▼
┌─────────────────────────────────────────────────────┐
│  codex-skill-skill 插件 (.codex-plugin/plugin.json)  │
│  ├── codex-skin-switcher  (主题切换/安装/恢复)        │
│  ├── codex-theme-creator  (从图片创建主题)            │
│  └── codex-skin-publisher (发布/分享)                 │
└──────────────┬──────────────────────────────────────┘
               │ 脚本调用
               ▼
┌─────────────────────────────────────────────────────┐
│  平台特定执行层                                       │
│  ├── macos/                                          │
│  │   ├── scripts/injector.mjs    (CDP 注入引擎)       │
│  │   ├── assets/renderer-inject.js (页面内注入逻辑)   │
│  │   ├── assets/dream-skin.css   (基础样式)           │
│  │   └── assets/theme.json       (主题数据)           │
│  └── windows/                                        │
│      ├── scripts/injector.mjs    (CDP 注入引擎)       │
│      ├── scripts/start-dream-skin.ps1 (PowerShell)   │
│      └── themes/<name>/          (主题文件夹)         │
└─────────────────────────────────────────────────────┘
               │ CDP (127.0.0.1)
               ▼
┌─────────────────────────────────────────────────────┐
│  Codex Desktop 渲染进程 (app:// 协议)                 │
└─────────────────────────────────────────────────────┘
```

### 2.2 CDP 注入方式

**核心机制**：通过本地回环 CDP（WebSocket 连接 `127.0.0.1:9341` macOS / `127.0.0.1:9335` Windows）向 Codex 渲染进程注入样式和背景图片。

关键安全约束：
- **Loopback-only**：强制校验 WebSocket URL 的 host 必须是 `127.0.0.1`/`localhost`/`[::1]`
- **Signature 验证**（macOS 独有）：启动前校验 Codex.app 的签名、Team ID、架构、内置 Node.js 版本
- **Target 过滤**：仅注入 `app://` 协议的 page 类型 target
- **Codex 探针**（macOS）：通过探测 `main.main-surface`、`aside.app-shell-left-panel`、`.composer-surface-chrome` 等 DOM 标记确认是真正的 Codex 渲染进程
- **PID 锁定**：恢复时仅停止 PID、路径、启动时间都匹配的记录进程

### 2.3 主题格式

```json
// theme.json (schemaVersion: 1)
{
  "schemaVersion": 1,
  "id": "custom-1784123441349",
  "name": "Dream Skin",
  "brandSubtitle": "CODEX DREAM SKIN",
  "tagline": "把喜欢的画面变成可交互的 Codex 工作台。",
  "projectPrefix": "选择项目 · ",
  "projectLabel": "◉  选择项目",
  "statusText": "THEME ONLINE",
  "quote": "Make something wonderful",
  "image": "portal-hero.png",
  "colors": {
    "background": "#F7F4F5", "panel": "#FFFFFF",
    "panelAlt": "#FFF7F8", "accent": "#E25563",
    "accentAlt": "#F07A86", "secondary": "#F3A8AF",
    "highlight": "#C93D4C", "text": "#2B2224",
    "muted": "#8A7A7D", "line": "rgba(196, 120, 128, .22)"
  }
}
```

**格式特征**：
- 10 色自定义系统（非 AgentSkin 的 14-token）
- 一张背景图（banner + 任务背景）
- 品牌文案字段（brandSubtitle/tagline/statusText/quote）
- 图片转为 base64 DataURL 内联注入
- 主题以文件夹为单位：`themes/<name>/` 含 `dream-skin.css` + `dream-reference.png`

### 2.4 注入模式

| 模式 | 说明 |
|------|------|
| `--watch` | 持续监听 CDP target，自动重注入（默认模式） |
| `--once` | 注入一次即退出 |
| `--reload` | 先 reload 页面再注入 |
| `--verify` | 验证注入结果的视觉规范（DOM 标记 + 布局检查） |
| `--remove` | 移除注入，恢复原状 |
| `--check-payload` | 仅校验 payload 合法性（macOS 独有） |

### 2.5 "一句话换肤"的机制

**Skill 化换肤是核心创新点**：

1. 用户在 Codex 对话中说"Install Codex Skin"或发送图片+"Use this image as my Codex Skin"
2. Codex Agent 调用 `codex-skin-switcher` / `codex-theme-creator` Skill
3. Skill 自动运行对应平台的 shell/PowerShell 脚本
4. 脚本执行 CDP 注入流程（发现目标 -> 校验 -> 注入 -> 验证）
5. 截图验证结果返回给用户

**关键设计**：整个流程对用户完全透明——不需要打开终端、不需要手动重启 Codex、不需要理解 CDP 协议。

---

## 三、技术亮点

### 3.1 真正的 Agent-Native 交互范式

- **Skill 即一切**：用户完全不接触命令行或文件系统
- **自然语言驱动**："Switch to the Astronaut skin" 即可完成切换
- **确认式重启**：只在必要时（CDP 不可用时）才重启，且先征得用户同意
- **截图验证**：注入后自动截图，用户可直观确认效果
- **零配置**：不触碰 Codex `config.toml`、不改 API key / Base URL / model provider

### 3.2 双轨持久化策略

| 持久化内容 | macOS 路径 | Windows 路径 |
|-----------|-----------|-------------|
| 引擎 | `~/.codex/codex-dream-skin-studio` | `windows/` 目录内 |
| 状态/日志/图片 | `~/Library/Application Support/CodexDreamSkinStudio` | 未明确 |
| 主题备份 | Application Support 下 `theme-backup.json` | 主题文件夹 |

### 3.3 macOS LaunchAgent 一次性重启

macOS 版使用 oneshot, non-persistent LaunchAgent 完成重启——确认重启后创建一次性 LaunchAgent，Codex 关闭后自动以 CDP 模式重新启动，而非常驻后台进程。设计干净，不留副作用。

### 3.4 严格的 Verify 校验

macOS 的 verify 不仅检查 CSS 是否注入，还校验：
- `document.documentElement.classList.contains('codex-dream-skin')`
- `#codex-dream-skin-style` 存在
- `#codex-dream-skin-chrome` 存在且 `pointer-events: none`
- `.composer-surface-chrome` 可见
- `aside.app-shell-left-panel` 可见
- 无水平溢出 (scrollWidth > clientWidth)
- 在 home 路由时检查 banner 尺寸和卡片数量 (1-6 张)
- 在 task 路由时检查任务内容区域

### 3.5 图片即主题

用户直接提供图片 -> 提取颜色（手动指定 accent/highlight/secondary）-> 自动生成可切换的主题包。无需编写 CSS。

### 3.6 安全边界清晰

- 不修改官方 `.app`、`app.asar`、代码签名
- CDP 仅绑定 loopback
- 校验 target 属于 Codex
- 装饰层 `pointer-events: none`
- Theme install 与 API relay 配置解耦（分离步骤，不静默改写 API 设置）

---

## 四、与 AgentSkin 对比

### 4.1 架构对比

| 维度 | codex-skin-skill | AgentSkin |
|------|-----------------|-----------|
| 覆盖应用 | **仅 Codex** | 6 个应用 (traework/qoderwork/workbuddy/doubao/codex/zcode) |
| 注入层 | 单层 CDP 直接注入 | 四引擎分层 (strategy/adapter/hybrid-injector/deep-core) |
| 主题格式 | 10 色 + 1 图片 + 文案 | 14-token 系统 |
| 架构复杂度 | 低（~21KB 单文件 injector） | 高（12 Store + 编排层 + 多引擎） |
| 并发控制 | 无（单应用、单用户） | InjectionLock + InjectionQueue + 层所有权 |
| 状态管理 | 无（脚本式，每次重新发现） | 12 个 Zustand Store |
| 持久化 | theme.json + CSS + PNG | manifest.json + palette.css + 资源 |
| 平台支持 | macOS + Windows | Electron 壳内全平台 |
| 交互范式 | **Agent-native（Skill 驱动）** | UI 操作 + Studio |
| 安全模型 | loopback CDP + signature 校验 | 分层隔离 + 编排层 token 权限控制 |
| 验证机制 | DOM 标记 + 布局检查 | check-* 脚本族（C1-C11 不变量） |

### 4.2 codex-skin-skill 的优势

1. **Agent-native 范式**：Skill 化交互是真正的差异化优势，AgentSkin 完全没有这一层
2. **极低的使用门槛**：用户不需要打开任何 UI，直接在对话中完成
3. **安全边界极简且清晰**：因为只服务一个应用，可以做非常严格的 Codex 专属校验
4. **验证即截图**：不仅 DOM 校验，还实际截图用视觉确认
5. **LaunchAgent 一次性重启**：干净的恢复机制
6. **图片即主题的 UX**：零 CSS 基础也能创建主题

### 4.3 AgentSkin 的优势

1. **多应用覆盖**：一个引擎服务 6 个应用，复用度高
2. **分层注入架构**：strategy -> adapter -> dynamic-overrides -> deep-core，职责清晰
3. **14-token 契约**：更细粒度的颜色控制
4. **编排层保护**：InjectionLock / InjectionQueue / 层所有权 / Token 所有权
5. **Studio 可视化创作**：GUI 方式精细调控
6. **完整的不变量体系**：C1-C11 共 11 道防线
7. **适配器模式**：每个应用独立适配，不互相影响

---

## 五、可借鉴点对比表

| # | 借鉴点 | 来源实现 | AgentSkin 现状 | 可行性 | 优先级 | 说明 |
|---|--------|---------|---------------|--------|--------|------|
| 1 | **Skill 化换肤入口** | `.codex-plugin/` + 3 个 Skill | 无（纯 UI 驱动） | 中 | **P0（重大机会）** | AgentSkin 可提供一个"换肤 Skill"，让用户在已适配的 Agent 中直接说"换个赛博朋克皮肤"触发换肤流程 |
| 2 | **自然语言驱动的交互范式** | Agent 调用脚本完成全流程 | 需手动在 Studio 操作 | 中 | **P0** | 与 #1 配套，定义一套 Skill 接口规范 |
| 3 | **截图验证机制** | `Page.captureScreenshot` 自动截图 | `check-themes` 等静态检查 | 高 | **P1** | AgentSkin 可在 check 流程中增加截图比对验证 |
| 4 | **图片即主题的零门槛创建** | `customize-theme-macos.sh --image` | 需手动编写 CSS | 高 | **P1** | AgentSkin 的 Studio 可加"从图片生成主题"按钮 |
| 5 | **一次性 LaunchAgent 重启** | 非持久 LaunchAgent | Electron 自行管理重启 | 低 | P2 | AgentSkin 是 Electron 自有进程，不直接适用，但"确认后重启"模式可借鉴 |
| 6 | **Verify 自动化校验** | DOM 标记 + 布局检查 + 溢出检测 | check-* 脚本检查 CSS 契约 | 高 | **P1** | 可增加 check-theme-visual，对运行中的适配结果做 DOM 级别校验 |
| 7 | **Theme 与 API 配置解耦** | 明确分离两步 | AgentSkin 不变量 C1 已覆盖 | 高 | 已覆盖 | AgentSkin 已有 agent-id 一致性约束 |
| 8 | **目录级主题隔离** | `themes/<name>/` 文件夹 | `.agentskin-theme/` 包 | 高 | 已覆盖 | AgentSkin 主题包结构更规范 |
| 9 | **Windows PowerShell 自动提权** | `start-dream-skin.ps1 -RestartExisting` | 不涉及（Electron 壳内运行） | 低 | P2 | 仅参考 PowerShell 脚本的自我提升模式 |
| 10 | **Plugin Manifest 规范** | `plugin.json` (name/version/skills/interface) | 无 | 中 | P1 | 可定义 AgentSkin 自己的 Skill Manifest 供 Agent 发现 |

---

## 六、实施建议

### 6.1 重大发现：Skill 化换肤是范式创新（P0）

codex-skin-skill 对 AgentSkin 最大的启示不是技术实现（单层 CDP 注入相对简单），而是**交互范式的创新**：

> 用户不需要打开设置页面。直接在对话中说"换个皮肤"，Agent 完成全部操作。

这与 AgentSkin 当前的"打开 Studio -> 选主题 -> 点击应用"流程完全不同。AgentSkin 可在不改变核心架构的前提下，**增加一个 Skill 层**作为可选入口。

### 6.2 推荐实施路径

#### Phase 1：截图验证增强（1-2 周）
- 为 `check-themes` / `check-injection-contribution` 增加运行时截图验证能力
- 参考 macOS injector 的 `verifySession()` 函数，对 codex / traework 等应用做 DOM 标记校验
- 验证项：注入 class 存在、装饰层 pointer-events、原生控件可见、无溢出

#### Phase 2：图片即主题（2-3 周）
- 在 Studio 中增加"从图片生成主题"功能
- 自动从图片提取主色 -> 映射到 14-token -> 生成 `.agentskin-theme` 包
- 参考 `customize-theme-macos.sh --image --accent --secondary --highlight` 的参数化思路

#### Phase 3：Skill 化换肤入口（需 RFC，4-6 周）
- 定义 AgentSkin Skill Manifest 规范（参考 `.codex-plugin/plugin.json`）
- 实现 `agentskin-switcher` Skill：接收自然语言指令 -> 调用主进程 IPC -> 执行换肤
- 实现 `agentskin-creator` Skill：接收图片 -> 生成主题 -> 应用
- 实现 `agentskin-verifier` Skill：截图验证当前状态
- **注意**：此功能涉及"UI 页面新增"边界（六页封顶），需走 RFC 评审
- **注意**：Skill 化入口不是新增适配器，而是为已有 6 个应用提供 Agent-native 交互层

### 6.3 不建议借鉴的方面

1. **单层注入架构**：AgentSkin 的四引擎分层是更成熟的工程选择，不应退化
2. **10 色系统**：AgentSkin 的 14-token 契约更精细，不应简化
3. **单人维护模式**：AgentSkin 的 check-* 不变量体系是质量保障的核心，不应放弃
4. **无版本管理**：AgentSkin 应有规范的 Release 流程

### 6.4 风险提示

- codex-skin-skill 已一个月无代码更新，可能处于维护停滞状态
- 其衍生源 Fei-Away/Codex-Dream-Skin 是真正的原始创新者
- 51 star 的项目影响力有限，但其**Skill 化交互范式**值得高度重视
- 本项目无 Release 版本管理，生产使用风险较高

---

## 七、总结

codex-skin-skill 是一个**技术实现简单但交互范式创新**的项目。它的核心价值不在于 CDP 注入技术本身（单层直接注入，无编排层），而在于：

1. **Skill 化换肤**：让 Agent 成为换肤的操作入口
2. **零门槛体验**：用户不需要理解任何技术细节
3. **验证即截图**：用视觉反馈闭环

对 AgentSkin 而言，最值得借鉴的是**交互范式**而非技术实现。建议在保持四引擎架构和 14-token 契约不变的前提下，通过 RFC 流程评估增加"Skill 化换肤入口"作为可选交互层。

---

*报告生成时间：2026-08-24*
*数据来源：GitHub API、README.en.md、macOS SKILL.md、Windows injector.mjs、macOS injector.mjs、theme.json、plugin.json*
