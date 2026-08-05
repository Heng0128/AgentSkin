# AgentSkin 剩余功能 — GitHub 参考优化方案

> 本文档覆盖用户尚未提及但项目中已存在或需要建设的功能模块，包含工作流/任务管理、状态监控面板、主题商店、动态壁纸、音频可视化等，均基于 GitHub 实际项目调研。

---

## 一、工作流/任务管理系统（Workspace Page）

### 1.1 现状
AgentSkin 现有 Workspace Page 展示环境网格（EnvironmentGrid）、Agent 状态、快速操作。但功能偏向"监控面板"而非"工作台"。

### 1.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **MyAgents** | 1.7k+ commits | 个人 Agent 工作台：Chrome 风格标签页 + 工作区文件树 + 内嵌终端/浏览器 + MCP | 工作区绑定 Agent（每个 Agent 对应一个真实工作目录） |
| **OpenWork** | 18.7k | Claude Cowork 替代品：可视化执行时间轴 + 权限审批弹窗 + MCP 支持 | 时序可视化 + "人在回路"的权限审批模式 |
| **holaOS** | 5.7k | Agent OS 架构：Runtime + Memory + MCP + Workspace | OS 级别三层分离设计 |
| **Mission Control** | — | Agent 编队管理仪表盘：Widget Grid 布局 + 实时成本监控 + CLI 集成 | Widget Grid（可拖拽环境卡片）+ Token 消耗追踪 |
| **agents-ui-kit** | — | 基于 shadcn/ui 的 AI Agent 组件库：AgentCard + TaskQueue + Message | AgentCard 范式（头像 + 状态灯 + 能力标签） |

### 1.3 建议改进

```
改造方向：从 "监控面板" 进化为 "Agent 工作台"

新增能力:
  1. 每个 Agent 绑定一个 Workspace 目录（文件系统视图）
  2. 多标签页：可同时打开多个 Agent 会话
  3. Tool Call 时间轴可视化（参考 OpenWork）
  4. 权限审批弹窗（参考 OpenWork 三选项）
  5. Token 消耗实时统计 + 成本追踪（参考 Mission Control）
  6. 内嵌终端面板（查看 Agent 真实执行日志）
  7. 任务列表 + 进度追踪（参考 agents-ui-kit TaskQueue）
```

---

## 二、状态监控面板（Agent Status / Environment Cards）

### 2.1 现状
现有环境卡片（EnvironmentCard）展示 Agent 基础状态（在线/离线/端口），但缺乏"心跳监控"和"安全检查"的 UI 设计。

### 2.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **Uptime Kuma** | 88.7k | 自托管监控：WebSocket 心跳推送 + 状态页面 + Incident 管理 | 心跳卡片 UI（绿灯/红灯/脉冲动画）+ 多目标卡片列表 |
| **Cline** | 5k+ commits | IDE 内自主编码 Agent：任务步骤可视化 + 权限审批 | 任务步骤展开/折叠 + 每步结果格式化 |
| **Kubetail** | — | K8s 实时日志仪表盘：多容器日志合并为单一时间线 | 多源日志聚合时间线技术 |
| **cmd-memo** | — | Electron 浮动 Gadget：置顶+半透明+贴靠+托盘联动 | 轻量级状态组件实现 |
| **MoliTodo** | — | Electron 浮动面板：托盘+置顶+SQLite+AI Skill API | 浮动面板的 Electron 实现 |

### 2.3 建议改进

```
改造方向：Uptime Kuma 风格的状态监控卡片

每个 Agent 环境卡片新增:
  1. 心跳状态指示器（脉冲动画 → 正常 / 闪烁 → 异常 / 灰色 → 离线）
  2. 健康检查历史（最近 24h 可用率 99.9%）
  3. 最近 Incident（CDP 连接失败 / 主题注入失败）
  4. Token 消耗实时曲线
  5. 一键诊断（自动检查 CDP 端口 + 安装路径 + 主题状态）
  6. 可选：浮动置顶状态条（cmd-memo 模式）

Uptime Kuma 状态机直接复用:
  investigating → identified → monitoring → resolved
```

---

## 三、主题商店 / Theme Marketplace

### 3.1 现状
AgentSkin 没有内置主题市场。用户只能手动安装主题或在 Theme Studio 新建。缺少发现、浏览、评价、更新机制。

### 3.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **Obsidian 插件/主题市场** | 6324+ 插件 + 661+ 主题 | 安全模式开关 → 分类 Tab → 搜索排序 → 详情页（README + 版本） | 分类 Tab + 安全模式 + 一键安装 |
| **VSCode Extension Gallery** | — | Activity Bar → 列表（描述/发布者/下载量/五星）→ 详情（README 渲染 + Changelog） | 详情页安装→启用两阶段 + 版本历史 |
| **Rubick** | 9.6k | Electron 工具箱：npm 插件分发 + 搜索安装 + 分类 | npm 分发模式（无服务器、纯客户端） |
| **Hoppscotch 主题选择器** | 79.4k | 实时预览 + 即时应用（颜色/模式/强调色） | 主题选择器实时预览模式 |

### 3.3 建议改进

```
新增 Theme Marketplace 页面（Settings 或独立 Tab）:

结构（参考 Obsidian + VSCode Marketplace）:
  +--------------------------------------------------+
  | [Search...]  [Category ▾] [Sort: Popular ▾]      |
  +--------------------------------------------------+
  |                                                  |
  |  +----------+  +----------+  +----------+         |
  |  | 缩略图   |  | 缩略图   |  | 缩略图   |         |
  |  | Theme A  |  | Theme B  |  | Theme C  |         |
  |  | ★★★★☆   |  | ★★★★★   |  | ★★★☆☆   |         |
  |  | [Install] |  | [Install] |  | [Install] |         |
  |  +----------+  +----------+  +----------+         |
  |                                                  |
  +--------------------------------------------------+
  
详情页（点击卡片后弹出/跳转）:
  +--------------------------------------------------+
  | [Theme Name]        [Install] [Preview]          |
  | Author: xxx ★ 4.5 (123 reviews)  v2.1.0         |
  |                                                   |
  | [Screenshot 1] [Screenshot 2] [Screenshot 3]      |
  |                                                   |
  | Description: ...                                  |
  | Changelog: ...                                    |
  | Tags: dark, coding, minimal                       |
  | Compatibility: ✅ WorkBuddy ✅ Doubao ...          |
  +--------------------------------------------------+

安装流程（参考 Rubick）:
  → GitHub URL / npm 包名 → 拉取主题包 → 校验 schema → 安装到 themes/ → 启用
```

---

## 四、动态壁纸增强（Wallpaper Engine 集成）

### 4.1 现状
AgentSkin 现有 wallpaper-server + wallpaper-injector 支持 scene/video/web/preset 类型壁纸，UI 在 WallpaperEnginePage。

### 4.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **Lively Wallpaper** | — | 开源动态壁纸引擎 | 全屏检测自动暂停 + 多显示器独立控制 + 库导入 |
| **Sucrose Wallpaper Engine** | — | WinUI + .NET 开源引擎 | 在线商店 + 本地库双层架构 + 节能模式 |
| **RePKG** (notscuffed) | — | 逆向 WE 的 PKG/TEX 格式 → PNG | AgentSkin 可直接复用其二进制格式解析 |
| **wallhaven (xiaobili)** | — | Electron + Vue 3 + TS 壁纸浏览下载 | 技术栈完全对齐 AgentSkin |

### 4.3 建议改进

```
改造方向：壁纸 + 主题 双向联动 + 主题商店集成

新增能力:
  1. 壁纸库缩略图网格浏览（参考 wallhaven Electron 实现）
  2. 从壁纸提取主色 → 自动推荐配套主题（参考 pywal）
  3. 壁纸详情页：作者/分辨率/类型/评分/安装量
  4. 壁纸预设包（分类 + 标签 + 精选推荐）
  5. 下载进度条 + 缓存管理
  6. 多显示器独立控制（参考 Lively）
  7. 性能模式：全屏应用/游戏时自动暂停（参考 Lively）
  8. 从 Wallpaper Engine Workshop 直接导入（参考 RePKG）
```

---

## 五、音频可视化 / 音频响应式效果

### 5.1 现状
AgentSkin 有 audio-level.ts 检测系统音频级别，但没有可视化 UI。

### 5.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **Web Audio API 可视化示例** | MDN 官方 | AnalyserNode + 波形/频普/圆形 | 标准 Web Audio 可视化技术 |
| **MilkDrop (Winamp)** | 经典 | 音频驱动粒子/波形 | 经典音频可视化风格 |
| **CSS Audio Visualizer projects** | — | CSS-only or Canvas-based | 轻量级实现 |
| **Wallpaper Engine Web Audio** | — | 壁纸随音频律动 | WE 的音频驱动壁纸模式 |

### 5.3 建议改进

```
新增 "Audio Visualizer" 模块（可选功能）:

实现方案:
  1. Windows Core Audio API（loopback capture）获取系统音频
  2. AnalyserNode → frequency data / waveform data
  3. Canvas 2D / WebGL 渲染可视化效果
  4. CDP → 壁纸/Agent UI 实时推送音频数据

可视化风格:
  - Waveform: 经典示波器风格
  - Frequency Bars: 底部均衡器风格
  - Circular: 圆形频谱（Apple Music 风格）
  - Particle: 粒子随音乐律动（MilkDrop 风格）

应用场景:
  - 壁纸动画响应音乐
  - Agent 等待时界面律动
  - 音乐播放器 + Agent 联动
```

---

## 六、应用安装 / 启动进度（DialogsHost / InstallProgress）

### 6.1 现状
AgentSkin 有 install-progress.tsx 和 dialogs-host.tsx 处理异步操作反馈。

### 6.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **线性进度条 (Linear App)** | — | 确定性进度条 + 状态文字 + 错误恢复 | 清晰的多阶段安装流程 |
| **Steam 安装流程** | — | 磁盘空间检查 + 下载 + 安装 + 校验 | 大型应用标准安装流程 |
| **npm install 进度** | 终端标准 | 多层依赖 + 实时日志 | 开发者熟悉的进度模式 |

### 6.3 建议改进

```
安装流程标准化:

  +--------------------------------------------------+
  | Installing Theme: "Midnight Coder"                |
  |                                                   |
  | [████████████████░░░░░░░░░░░░] 65%               |
  |                                                   |
  | Step 3/5: Validating CSS compatibility...         |
  |  ✅ Downloaded theme package (2.3MB)              |
  |  ✅ Validated manifest.json                       |
  |  ✅ Extracted color schemes                       |
  |  🔄 Injecting theme into CDP target...             |
  |  ⬜ Applying to wallpaper engine                  |
  |                                                   |
  | [Cancel]                      [Background]         |
  +--------------------------------------------------+

错误处理:
  - 可重试步骤自动 3 次重试
  - 失败时给出具体修复建议（CDP 未连接 → 打开 WorkBuddy）
  - 部分失败允许"继续安装"（跳过 CDP 注入）
```

---

## 七、设置页面整体重构

### 7.1 现状
SettingsPage 采用左 Section Rail（通用/应用检测/系统），每个 Section 内是 SettingRow 列表。

### 7.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **macOS System Settings** | Apple 标准 | 左侧分类 + 右侧详情 + 搜索 | 原生 macOS 设置范式 |
| **Windows 11 Settings** | Microsoft 标准 | 卡片式布局 + 快速操作 + 深度链接 | Win11 Fluent 设置体验 |
| **VS Code Settings** | — | 搜索驱动 + JSON 编辑 + UI 切换 | 开发者友好的设置体验 |
| **Raycast Preferences** | — | 顶部 Tab + 命令搜索 + 快速跳转 | CLI 工具的设置体验 |
| **Obsidian Settings** | — | 左 Tab 分类 + 内嵌社区插件市场 | 设置 ↔ 市场的无缝集成 |

### 7.3 建议改进

```
改造方向：从 "Settings 页面" 进化为 "Settings + Store + Devices" 三栏

新 Settings 结构:

+------------------------------------------------------------------+
| ⚙ SETTINGS                                          [Search...]   |
+------------+-----------------------------------------------------+
|            |                                                     |
| GENERAL    |  Sections with visual cards:                       |
|   Theme      [Current: Midnight Agent ▾]  [Browse Themes]      |
|   Language   [English ▾]                                       |
|   Updates    [Check Now]  v1.2.3 ✅ up to date                  |
|                                                                 |
| SYSTEM     |                                                     |
|   Logs       [42 entries]  [View Logs]  [Copy]                  |
|   Hardware   ☑ Disable GPU acceleration                        |
|   Performance  [Low Latency ▾]                                 |
|                                                                 |
| APPS       |                                                     |
|   WorkBuddy    ● online  [Configure]                           |
|   Doubao       ○ offline  [Start]                               |
|   Trae         ● online  [Configure]                           |
|                                                                 |
| THEME      |  [NEW]                                              |
|   Current Theme: Midnight Agent                                 |
|   [Browse Store...] [Open Theme Studio]                        |
|   Color Scheme: [Nord ▾]                                        |
|                                                                 |
| BUNDLES    |  [NEW]                                              |
|   [Midnight Coder] [Install]  Theme+Wallpaper Combo            |
|   [Sakura Chat] [Install]     Theme+Wallpaper Combo            |
|                                                                 |
| STORE      |  [NEW - tab 切换]                                    |
|   [Themes] [Wallpapers] [Bundles]                              |
|   [Grid of marketplace items]                                  |
|                                                                 |
+------------+-----------------------------------------------------+
```

---

## 八、Tray 系统托盘增强

### 8.1 现状
AgentSkin 有 tray-manager.ts 处理基础托盘功能。

### 8.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **Electron Tray 官方示例** | — | 系统托盘 + 菜单 + 图标切换 | Electron 标准模式 |
| **MoliTodo** | — | 托盘 + 浮动面板 + 置顶半透 | 托盘联动浮动面板 |
| **cmd-memo** | — | 托盘图标右击切换显示/隐藏 | 简洁托盘交互 |

### 8.3 建议改进

```
增强版托盘菜单:

  +---------------------------------------+
  | 🤖 AgentSkin                          |
  |---------------------------------------|
  | Quick Actions:                        |
  |  ● Apply Last Theme                   |
  |  ● Pause Wallpaper                    |
  |  ● Toggle Desktop Mode                |
  |---------------------------------------|
  | Agents:                               |
  |  ● WorkBuddy (online)                 |
  |  ○ Doubao   (offline)                 |
  |  ● Trae     (online)                  |
  |---------------------------------------|
  |  ● Theme Studio...                    |
  |  ● Settings...                        |
  |  ─────────────────────────            |
  |  ● Quit                               |
  +---------------------------------------+

托盘图标动画:
  - 静态：正常状态
  - 脉冲绿点：有 Agent 在线
  - 橙色闪烁：需要用户批准
  - 红色：所有 Agent 离线
```

---

## 九、启动画面 / Boot Screen

### 9.1 现状
AgentSkin 有 boot-screen.tsx + boot-progress.tsx 以及 splash.html。

### 9.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **VS Code Welcome** | — | 最近项目 + 帮助 + 交互式 tutorials | 智能欢迎页 |
| **Figma Splash** | — | 最近社区文件 + 新闻 + 教程 | 社区驱动欢迎页 |
| **Linear App Launch** | — | 极简直线 + 键盘快捷方式引导 | 效率工具启动体验 |
| **Raycast Onboarding** | — | 欢迎 + 权限请求 + 基础操作 | 权限友好的启动流 |

### 9.3 建议改进

```
启动流优化:

  Splash (1-2s) → Boot Screen (渐进式) → Workspace
  
  Splash.html 保留极简 Logo 动画

  Boot Screen 增加:
    +-------------------------------------------+
    | 🤖 AgentSkin                             |
    |                                          |
    | Initializing...                          |
    |  ✅ Theme Engine loaded                   |
    |  ✅ Wallpaper Server started              |
    |  🔄 Scanning for Agents...                |
    |     Found: WorkBuddy, Trae, Doubao        |
    |  🔄 Checking theme health...              |
    |  ⬜ Applying last theme                   |
    |                                          |
    | [Skip]                        Cancel     |
    +-------------------------------------------+

  Boot 完成后:
    → 显示 Workspace（不弹窗）
    → Badge 提示 "2 agents need attention"
```

---

## 十、多 Agent 协同 / 联动

### 10.1 现状
AgentSkin 把 6 个 Agent 独立管理，没有"联动"概念。

### 10.2 GitHub 参考项目

| 项目 | Stars | 核心能力 | 借鉴点 |
|------|-------|---------|--------|
| **OpenAI Swarm** | — | 多 Agent 协作框架 | Agent 间通信协议 |
| **CrewAI** | — | 多 Agent 角色定义 + 任务分配 | Agent 角色系统 |
| **AutoGen** (Microsoft) | — | 多 Agent 对话 + 协作完成 | Agent 对话模式 |

### 10.3 建议改进

```
新增 "Multi-Agent 协同" 概念（远期）:

场景:
  1. Codex 输出代码 → 自动发给 WorkBuddy 做 Code Review
  2. Trae 报告任务完成 → 自动更新 WorkBuddy 今日摘要
  3. 发现异常 → 通知所有在线 Agent

实现位置: 在 Workspace 新增 "Workflows" Tab
```

---

## 十一、整体优先级排序

| 优先级 | 功能 | 投入 | 影响 |
|--------|------|------|------|
| 🔴 P0 | 状态监控面板改进（Uptime Kuma 心跳 UI） | 1周 | Agent 可观测性大幅提升 |
| 🔴 P0 | 设置页面整合 Theme Store + Bundle 管理 | 1周 | 生态入口统一 |
| 🟡 P1 | Theme Marketplace（浏览 + 安装 + 详情） | 2周 | 主题生态闭环 |
| 🟡 P1 | 工作流面板（多标签页 + Tool Call 时间轴） | 2周 | 工作台体验升级 |
| 🟡 P1 | 壁纸 ↔ 主题 联动（从壁纸提取主色） | 1周 | 视觉联动差异点 |
| 🟢 P2 | Boot Screen 优化 + Progress | 3天 | 第一印象提升 |
| 🟢 P2 | Tray 增强 + Quick Actions | 2天 | 快捷访问 |
| 🟢 P2 | 安装流程标准化 + 进度可视化 | 3天 | 降低用户焦虑 |
| 🔵 P3 | 音频可视化 + 壁纸律动 | 1周 | 差异化功能 |
| 🔵 P3 | Multi-Agent 协同 | 2周 | 远期竞争力 |

---

## 十二、总结

以上 11 个功能模块中，**最紧迫的四个**：

1. **状态监控面板** — 从"静态卡片"升级为"实时心跳监控"（Uptime Kuma 模式）
2. **设置页整合** — 把 Theme Store / Bundle / Logs 统一入口（Obsidian + VSCode 模式）
3. **Theme Marketplace** — 浏览 / 安装 / 更新 一站式（参考 Rubick npm 分发 + VSCode 详情页）
4. **壁纸 ↔ 主题 联动** — 壁纸选完后自动推荐 / 生成配套主题（参考 pywal 颜色量化）

这四项完成后，AgentSkin 就从"工具"进化为"平台"。

---

## 九、可执行实施方案 — 文件级改造清单（按模块）

### 9.1 准备阶段 — 必须优先克隆的项目

在动手编码之前，必须先 clone 以下 5 个参考项目到本地，逐个运行、阅读源码、截图记录关键 UI 和架构。按优先级排序：

| 优先级 | 项目 | 仓库地址 | Stars | 核心价值 | 克隆命令 |
|--------|------|----------|-------|---------|---------|
| 🥇 P0 | **Uptime Kuma** | `louislam/uptime-kuma` | 88.7k | 心跳卡片 UI + 多目标监控状态机 + WebSocket 实时推送 | `git clone --depth 1 https://github.com/louislam/uptime-kuma.git` |
| 🥈 P0 | **Obsidian** | `obsidianmd/obsidian-api` + 社区插件示例 | — | 安全模式开关 + 分类 Tab + 详情页 + 一键安装 | Clone obsidian-sample-plugin 作为参考 |
| 🥉 P1 | **Lively Wallpaper** | ** `rocksdanister/lively` | — | 全屏检测自动暂停 + 多显示器独立控制 | `git clone --depth 1 https://github.com/rocksdanister/lively.git` |
| P1 | **Hoppscotch** | ** `hoppscotch/hoppscotch` | 79.4k | 主题选择器实时预览 + 即时应用机制 | `git clone --depth 1 https://github.com/hoppscotch/hoppscotch.git` |
| P1 | **Linear App** (进度条参考) | `linear/linear` (客户端为闭源，参考开源实现) | — | 确定性多阶段进度条 + 状态文字 | 参考 linear-next-progress 等社区实现 |

**克隆后逐一执行的调研任务：**

```
对每个参考项目执行：
  1. npm install && 启动项目
  2. 截图记录核心 UI 状态（正常/异常/加载/空）
  3. 阅读核心组件源码（标记关键 hooks、state 结构）
  4. 记录 IPC/通信模式（主进程 ↔ 渲染进程）
  5. 摘录可复用的数据结构定义（TypeScript interface）
  6. 输出 1 页 A4 调研报告（放入 docs/research/）
```

---

### 9.2 新增 npm 依赖 — 按模块分组安装

```bash
# === P0 — Theme Marketplace ===
npm install semver          # 语义化版本比较，主题包版本校验
npm install zod             # Schema 验证（已有，升级至 v4 复用）

# === P0 — 状态监控面板 ===
# 使用 Electron 内置 net 模块 + Node.js WebSocket 客户端，无需额外依赖

# === P1 — Workspace 工作台 ===
npm install recharts@^2     # TokenUsageChart 折线图/面积图组件
npm install @radix-ui/react-dialog  # 权限审批弹窗（无头组件）

# === P1 — Settings 重构 ===
# 复用现有 react-hook-form + zod，无需新增依赖

# === P2 — Tray + 音频可视化 ===
npm install wnaudio         # Windows Core Audio loopback (npm i wnaudio)
npm install nanoid          # 生成工具调用 ID（已有可用）

# === 开发依赖 ===
npx install -D @types/semver  # semver 类型声明
```

**安装命令汇总：**

```bash
npm install semver recharts @radix-ui/react-dialog wnaudio
npm install -D @types/semver
```

---

### 9.3 各模块文件修改清单 — 按优先级

#### 模块 1: Theme Marketplace（P0，预计 2 周）

```
Phase 1 — 页面骨架 + 路由
  [新增]  src/ui/pages/MarketplacePage.tsx
         — 市场浏览页主体，包含 SearchBar + CategoryFilter + SortDropdown + ItemGrid
         — 路由注册至 React Router: /marketplace
  [新增]  src/ui/components/marketplace/SearchBar.tsx
         — 搜索输入框 + 清除按钮，防抖 300ms
  [新增]  src/ui/components/marketplace/CategoryFilter.tsx
         — Category Tab 条（全部/暗色/亮色/极简/代码/节日...），参考 Obsidian
  [新增]  src/ui/components/marketplace/SortDropdown.tsx
         — 排序下拉：热门/最新/评分/下载量

Phase 2 — 卡片组件 + 列表渲染
  [新增]  src/ui/components/marketplace/ThemeStoreCard.tsx
         — 缩略图（lazy load）+ 主题名 + 作者 + 评分星级 + 安装量 + InstallButton
         — 安装中状态：spinner + 进度百分比
         — 已installed状态：check icon + "Installed" 标签

Phase 3 — 详情页 + 安装流
  [新增]  src/ui/components/marketplace/ThemeDetailPanel.tsx
         — 右侧详情面板或 Modal（参考 VSCode Detail Pane）
         — Screenshots 轮播 + Description + Changelog + Tags + Compatibility
  [新增]  src/ui/components/marketplace/InstallProgressList.tsx
         — 安装进度浮层，复用 Linear 多阶段进度条

Phase 4 — 后端服务 + IPC
  [新增]  src/main/services/marketplace-service.ts
         — 核心 API 封装：searchThemes / installTheme / rateTheme / getThemeDetail
         — 源：优先支持 GitHub API 拉取主题清单，备选自建 CDN JSON
         — 本地缓存：已安装主题清单持久化至 electron-store
  [新增]  src/main/ipc/marketplace-ipc.ts
         — IPC 通道注册：marketplace:search / install / progress / detail

Phase 5 — 集成与配置
  [修改]  src/ui/hooks/useSettings.ts
         — 新增 marketplace section: { storeUrl: string, cacheDir: string, lastSync: number }
         — 新增 marketplace.browse action（打开 MarketplacePage）
  [修改]  src/main/ipc/index.ts（或主 IPC 注册入口）
         — 注册 marketplace-ipc 所有通道

参考 UI 模式：Obsidian Category Tab + VSCode Detail Pane + Rubick npm 安装流
```

---

#### 模块 2: 状态监控面板（P0，预计 1 周）

```
Phase 1 — 心跳指示器组件
  [新增]  src/ui/components/workspace/HeartbeatIndicator.tsx
         — CSS keyframes 脉冲动画（box-shadow 扩散 + opacity）
         — 状态颜色映射：green / yellow / red / gray
         — 气泡 tooltip: "Last heartbeat: 2s ago"

Phase 2 — EnvironmentCard 增强
  [修改]  src/ui/components/workspace/EnvironmentCard.tsx
         — 增加 HeartbeatIndicator 子组件
         — 增加 TokenUsage sparkline（折线图迷你版）
         — 增加健康历史 Badge: "Uptime 99.7%"
         — 增加 Incidents 红点标记（click 展开 IncidentList）

Phase 3 — 心跳服务 + 状态机
  [新增]  src/main/services/health-monitor.ts
         — 状态机：investigating → identified → monitoring → resolved
         — 定时心跳检测循环（默认 30s 间隔，可配置）
         — WebSocket / IPC 推送心跳数据到渲染进程
  [修改]  src/main/cdp/cdp-ready.ts
         — 新增 heartbeatReport() API，每次 CDP 心跳成功后调用
         — 记录 lastHeartbeatTime 和 consecutiveFailures

Phase 4 — IPC 通道
  [新增]  src/main/ipc/health-ipc.ts
         — health:getStatus / startMonitor / stopMonitor / incidentList

参考 UI 模式：Uptime Kuma 心跳卡片 + Linear 状态灯
```

---

#### 模块 3: Workspace 工作台（P1，预计 2 周）

```
Phase 1 — 页面架构调整
  [修改]  src/ui/pages/WorkspacePage.tsx
         — 从"监控面板"标题改为"工作台"（顶部标题栏更新）
         — 引入 TabLayout：Agents / Workflows / Tasks
         — Agents Tab 保留现有环境网格 + 新增心跳指示器
         — Workflows Tab：预留占位（远期多 Agent 协同）
         — Tasks Tab：任务列表占位

Phase 2 — ToolCall 时间轴
  [新增]  src/ui/components/workspace/ToolCallTimeline.tsx
         — 垂直时间轴 UI（左侧时间线 + 右侧 content card）
         — 每个 ToolCall 展开显示：tool name / args / result / duration
         — 状态色点：pending / running / completed / failed

Phase 3 — 权限审批弹窗
  [新增]  src/ui/components/workspace/PermissionApprovalCard.tsx
         — 三选项设计：Allow Once / Always Allow / Deny
         — 展示：操作类型（文件读取 / 代码执行 / 文件写入 / 网络请求）
         — 紧急操作红色警告背景

Phase 4 — Token 消耗图表
  [新增]  src/ui/components/workspace/TokenUsageChart.tsx
         — Recharts AreaChart + Tooltip
         — 维度：Input Tokens / Output Tokens / Cost (USD)
         — 时间范围选择器：1h / 24h / 7d / 30d

参考 UI 模式：OpenWork 时间轴 + Linear 任务面板 + cli-usage sparkline
```

---

#### 模块 4: Settings 重构（P1，预计 1 周）

```
Phase 1 — Section 扩展
  [修改]  src/ui/pages/SettingsPage.tsx
         — Left Rail 新增 Tab：THEME / BUNDLES / STORE
         — 搜索栏升级支持全局 Ctrl+K 命令面板跳转

Phase 2 — THEME Section
  [新增]  src/ui/components/settings/ThemeSection.tsx
         — theme.current: 当前主题名 + 缩略图 + "Browse Store..." 按钮
         — theme.colorScheme: 下拉选项（Nord / Dracula / One Dark / 自定义...）
         — theme.studio: "Open Theme Studio" 跳转按钮

Phase 3 — BUNDLES Section
  [新增]  src/ui/components/settings/BundlesSection.tsx
         — bundle.list: 已安装 Bundle 卡片网格
         — 每个 Bundle 卡片：名称 + 包含主题+壁纸数 + 版本 + Uninstall 按钮
         — "Get Bundles" 跳转 Marketplace Bundles Tab

Phase 4 — STORE Section（ iframe 嵌入或 WebView）
  [新增]  src/ui/components/settings/StoreSection.tsx
         — 嵌入 Marketplace 浏览入口（"Open Full Marketplace"）
         — 分类快捷入口卡片（Featured / Trending / Top Rated）
         — 当前安装统计：已安装 12 个主题 / 3 个壁纸 / 2 个 Bundle

参考 UI 模式：macOS System Settings 布局 + Obsidian 设置分类 + VS Code 搜索面板
```

---

#### 模块 5: Tray 托盘 + 音频可视化（P2，预计 1 周）

```
Phase 1 — Tray 增强
  [修改]  src/main/tray-manager.ts
         — 新增"Recent Themes"子菜单（最近 5 个应用主题，按 apply 时间排序）
         — 每个主题项：图标（颜色 dot）+ 名称 + click → 快速 apply
         — 新增状态段：在线 Agent 状态预览（最多显示 4 个）
         — 托盘图标动态更新：全部离线时灰度图标

Phase 2 — 音频可视化组件
  [新增]  src/ui/components/visualizer/AudioVisualizer.tsx
         — Canvas 2D 频谱渲染（Frequency Bars 模式）
         — 接入 wnaudio 获取系统音频流（loopback）
         — AnalyserNode 实时计算 frequency data
         — 可切换风格：FrequencyBars / Waveform / Circular / Particle

Phase 3 — 集成与配置
  [新增]  src/ui/components/visualizer/VisualizerSettings.tsx
         — 风格选择器 + 敏感度滑块 + FFT size 选项
         — 启用/禁用开关（默认关闭，低端设备不启用）

参考 UI 模式：MilkDrop 频普 + Apple Music 圆形频谱 + Wallpaper Engine 音频壁纸
```

---

### 9.4 代码示例

#### 9.4.1 Marketplace API 接口定义

```typescript
// src/shared/types/marketplace.types.ts

import { z } from 'zod';

/** 主题包清单条目（搜索结果） */
export const ThemeStoreItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(80),
  author: z.string(),
  version: z.string().semver(),
  description: z.string().max(500),
  thumbnailUrl: z.string().url(),
  downloadUrl: z.string().url(),
  downloads: z.number().nonnegative(),
  rating: z.number().min(0).max(5),
  ratingCount: z.number().nonnegative(),
  categories: z.array(z.string()),
  tags: z.array(z.string()),
  screenshotUrls: z.array(z.string().url()),
  compatibility: z.array(z.string()), // ['workbuddy', 'doubao', 'trae', ...]
  changelog: z.string(),
  publishedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  size: z.number(), // bytes
});

export type ThemeStoreItem = z.infer<typeof ThemeStoreItemSchema>;

/** 搜索请求 */
export const MarketplaceSearchSchema = z.object({
  query: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['popular', 'newest', 'rating', 'downloads']).default('popular'),
  page: z.number().int().positive().default(1),
  limit: z.number().int().min(1).max(50).default(20),
});

export type MarketplaceSearchParams = z.infer<typeof MarketplaceSearchSchema>;

/** 搜索响应 */
export interface MarketplaceSearchResponse {
  items: ThemeStoreItem[];
  totalCount: number;
  page: number;
  hasNextPage: boolean;
}

/** 安装进度事件 */
export interface InstallProgressEvent {
  themeId: string;
  themeName: string;
  stage: 'downloading' | 'validating' | 'extracting' | 'applying' | 'done';
  progress: number; // 0-100
  error?: string;
}

/** 评分请求 */
export interface RateThemeRequest {
  themeId: string;
  rating: number; // 1-5
  review?: string;
}
```

---

#### 9.4.2 HeartbeatIndicator 组件（CSS keyframes 脉冲动画）

```tsx
// src/ui/components/workspace/HeartbeatIndicator.tsx

import React from 'react';

type HeartbeatStatus = 'healthy' | 'degraded' | 'critical' | 'offline';

interface HeartbeatIndicatorProps {
  status: HeartbeatStatus;
  lastBeatTime?: number; // Unix timestamp ms
  size?: number;
  showTooltip?: boolean;
}

const statusColorMap: Record<HeartbeatStatus, string> = {
  healthy: '#34C759',  // Apple green
  degraded: '#FF9500', // Orange
  critical: '#FF3B30', // Red
  offline: '#8E8E93',  // Gray
};

const statusLabelMap: Record<HeartbeatStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Incident',
  offline: 'Offline',
};

const HeartbeatIndicator: React.FC<HeartbeatIndicatorProps> = ({
  status,
  lastBeatTime,
  size = 10,
  showTooltip = true,
}) => {
  const color = statusColorMap[status];
  const animClass = status === 'healthy' ? 'heartbeat-pulse' : status === 'critical' ? 'heartbeat-flash' : '';

  const formatTimeAgo = (ts?: number): string => {
    if (!ts) return 'No data';
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 5) return `${seconds}s ago`;
    if (seconds < 60) return `${Math.floor(seconds)}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  };

  return (
    <span
      className={`heartbeat-wrapper ${animClass}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
      title={showTooltip ? `${statusLabelMap[status]} — Last beat: ${formatTimeAgo(lastBeatTime)}` : undefined}
    >
      <span
        className="heartbeat-dot"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          backgroundColor: color,
          display: 'inline-block',
          boxShadow: status === 'healthy'
            ? `0 0 0 0 ${color}80`
            : 'none',
        }}
      />
      <span className="heartbeat-label" style={{ fontSize: 11, color: '#666', fontWeight: 500 }}>
        {statusLabelMap[status]}
      </span>

      <style>{`
        @keyframes heartbeat-pulse {
          0%   { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0.6); }
          70%  { box-shadow: 0 0 0 ${size * 1.5}px rgba(52, 199, 89, 0); }
          100% { box-shadow: 0 0 0 0 rgba(52, 199, 89, 0); }
        }
        .heartbeat-pulse .heartbeat-dot {
          animation: heartbeat-pulse 2s ease-out infinite;
        }
        @keyframes heartbeat-flash {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        .heartbeat-flash .heartbeat-dot {
          animation: heartbeat-flash 1s ease-in-out infinite;
        }
      `}</style>
    </span>
  );
};

export default HeartbeatIndicator;
```

---

#### 9.4.3 ToolCallTimeline 数据结构（tool call 状态机）

```typescript
// src/shared/types/toolcall.types.ts

/** Tool Call 生命周期状态 */
export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 安全级别 — 决定是否需要用户审批 */
export type RiskLevel = 'safe' | 'moderate' | 'critical';

/** Tool Call 记录 */
export interface ToolCallRecord {
  id: string;                          // nanoid 生成
  agentId: string;                     // 关联 Agent
  sessionId: string;                   // 关联会话

  // 调用信息
  toolName: string;                    // 'read_file' | 'execute_code' | 'write_file' | 'http_request' ...
  toolCategory: string;                // 'file' | 'code' | 'network' | 'system'
  args: Record<string, unknown>;       // 调用参数（JSON）
  riskLevel: RiskLevel;                // 风险等级

  // 时间戳
  initiatedAt: number;                 // 发起时间 (ms)
  startedAt: number | null;            // 开始执行时间
  completedAt: number | null;          // 完成时间
  duration: number | null;             // 执行耗时 (ms)

  // 状态
  status: ToolCallStatus;

  // 结果
  result?: unknown;                    // 执行结果（序列化后）
  errorMessage?: string;               // 失败时错误信息

  // 权限审批
  permissionRequired: boolean;         // 是否需要审批
  permissionStatus?: 'approved' | 'denied' | 'timeout';
  permissionDecidedAt?: number;
}

/** Timeline 聚合 */
export interface ToolCallTimeline {
  agentId: string;
  sessionId: string;
  calls: ToolCallRecord[];
  totalCalls: number;
  completedCalls: number;
  failedCalls: number;
  pendingApprovals: number;
}

/** 权限审批决策 */
export interface PermissionDecision {
  callId: string;
  decision: 'allow_once' | 'allow_always' | 'deny';
  decidedAt: number;
  userNote?: string;
}
```

---

#### 9.4.4 marketplace-service.ts 核心方法

```typescript
// src/main/services/marketplace-service.ts

import { net } from 'electron';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import semver from 'semver';
import { ThemeStoreItem, MarketplaceSearchParams, InstallProgressEvent } from '@/shared/types/marketplace.types';

const DEFAULT_STORE_URL = 'https://cdn.agentskin.app/marketplace/index.json';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class MarketplaceService {
  private cache: Map<string, { data: ThemeStoreItem[]; timestamp: number }> = new Map();
  private readonly storeUrl: string;
  private readonly cacheDir: string;
  private readonly themesDir: string;

  constructor(storeUrl?: string) {
    this.storeUrl = storeUrl || DEFAULT_STORE_URL;
    this.cacheDir = join(app.getPath('userData'), 'marketplace-cache');
    this.themesDir = join(app.getPath('userData'), 'themes');
    this.ensureDirs();
  }

  /**
   * 搜索主题 — 从 CDN JSON 或 GitHub API 拉取，本地缓存 5min
   */
  async searchThemes(params: MarketplaceSearchParams): Promise<{ items: ThemeStoreItem[]; totalCount: number }> {
    const cacheKey = `search:${JSON.stringify(params)}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return { items: cached.data, totalCount: cached.data.length };
    }

    // 方式1：自建 CDN JSON（推荐）
    const response = await this.fetchFromCDN<ThemeStoreItem[]>(this.storeUrl);

    // 方式2：GitHub API 兜备
    // const response = await this.fetchFromGitHub(params);

    // 过滤 + 排序（本地处理，简单高效）
    let items = response;
    if (params.query) {
      const q = params.query.toLowerCase();
      items = items.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      );
    }
    if (params.category && params.category !== 'all') {
      items = items.filter(t => t.categories.includes(params.category));
    }

    // 排序
    switch (params.sort) {
      case 'newest':
        items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
        break;
      case 'rating':
        items.sort((a, b) => b.rating - a.rating);
        break;
      case 'downloads':
        items.sort((a, b) => b.downloads - a.downloads);
        break;
      default:
        items.sort((a, b) => b.downloads * b.rating - a.downloads * a.rating); // popular
    }

    // 分页
    const start = (params.page - 1) * params.limit;
    const pagedItems = items.slice(start, start + params.limit);

    this.cache.set(cacheKey, { data: pagedItems, timestamp: Date.now() });
    return { items: pagedItems, totalCount: items.length };
  }

  /**
   * 下载并安装主题 — 流式下载 + 进度推送
   */
  async installTheme(item: ThemeStoreItem, onProgress: (event: InstallProgressEvent) => void): Promise<string> {
    const { id, name, downloadUrl, version } = item;
    const destPath = join(this.themesDir, `${id}-${version}.zip`);

    // 阶段1：下载 (progress: 0-60%)
    onProgress({ themeId: id, themeName: name, stage: 'downloading', progress: 0 });
    await this.downloadFile(downloadUrl, destPath, (percent) => {
      onProgress({ themeId: id, themeName: name, stage: 'downloading', progress: Math.floor(percent * 0.6) });
    });

    // 阶段2：校验 (progress: 60-75%)
    onProgress({ themeId: id, themeName: name, stage: 'validating', progress: 60 });
    const isValid = await this.validateThemeZip(destPath);
    if (!isValid) throw new Error('Theme package integrity check failed');

    // 阶段3：解压 (progress: 75-90%)
    onProgress({ themeId: id, themeName: name, stage: 'extracting', progress: 75 });
    const extractPath = join(this.themesDir, id);
    await this.extractTheme(destPath, extractPath);
    onProgress({ themeId: id, themeName: name, stage: 'extracting', progress: 90 });

    // 阶段4：应用 (progress: 90-100%)
    onProgress({ themeId: id, themeName: name, stage: 'applying', progress: 90 });
    await this.applyTheme(extractPath);
    onProgress({ themeId: id, themeName: name, stage: 'done', progress: 100 });

    return extractPath;
  }

  /**
   * 评价主题 — 写入远端 / 本地聚合
   */
  async rateTheme(themeId: string, rating: number, review?: string): Promise<void> {
    // 本地评价先存，可后续同步至远端
    const ratingFile = join(this.cacheDir, `rating-${themeId}.json`);
    const record = { themeId, rating, review, ratedAt: Date.now() };
    await Bun.write(ratingFile, JSON.stringify(record, null, 2));
    // 可选：异步上传至远端 API
    // await fetch(`${this.storeUrl}/rate`, { method: 'POST', body: JSON.stringify(record) });
  }

  // ───────── private helpers ─────────

  private async ensureDirs(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
    await mkdir(this.themesDir, { recursive: true });
  }

  private fetchFromCDN<T>(url: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const request = net.request(url);
      request.on('response', (response) => {
        let data = '';
        response.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        response.on('end', () => {
          try { resolve(JSON.parse(data) as T); }
          catch (e) { reject(new Error(`Invalid JSON from ${url}: ${e}`)); }
        });
      });
      request.on('error', reject);
      request.end();
    });
  }

  private downloadFile(url: string, dest: string, onPercent: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = net.request(url);
      request.on('response', (response) => {
        const total = parseInt(response.headers['content-length'] as string || '0', 10);
        let received = 0;
        const stream = createWriteStream(dest);
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (total > 0) onPercent(received / total);
        });
        response.pipe(stream);
        stream.on('finish', () => { stream.close(); resolve(); });
        stream.on('error', reject);
      });
      request.on('error', reject);
      request.end();
    });
  }

  private async validateThemeZip(filePath: string): Promise<boolean> {
    // 简单 ZIP 魔数校验 + manifest.json 检查
    const { readFile } = await import('node:fs/promises');
    const buf = Buffer.alloc(4);
    const fd = await readFile(filePath); // 简化版，实际应使用 unzip 后校验
    return fd.subarray(0, 4).toString('hex') === '504b0304'; // ZIP magic number
  }

  private async extractTheme(zipPath: string, dest: string): Promise<void> {
    // 使用 Node.js 内置 zlib + 手工解析，或依赖 adm-zip / unzipper
    const { execFile } = await import('node:child_process');
    await new Promise<void>((resolve, reject) => {
      execFile('powershell', ['-Command', `Expand-Archive -Path '${zipPath}' -DestinationPath '${dest}' -Force`], (err) => {
        if (err) reject(err); else resolve();
      });
    });
  }

  private async applyTheme(themePath: string): Promise<void> {
    // 1. 读取 manifest.json
    // 2. 写入当前主题配置
    // 3. 触发 CDP 注入（如果 Agent 在线）
    const manifestPath = join(themePath, 'manifest.json');
    const manifest = JSON.parse(await Bun.read(manifestPath) as unknown as string);
    // 更新 useSettings 中的 theme.current
    // 触发主进程事件 → 渲染进程重新加载 ThemeProvider
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('theme:applied', manifest);
    });
  }
}
```

---

### 9.5 验证标准表格 — 按模块

| 模块 | 验收标准 | 验证命令/方法 | 通过指标 |
|------|---------|-------------|---------|
| **Theme Marketplace (P0)** | 1. 能在 2s 内加载并渲染 20 条主题卡片 | `npm run dev` → 导航至 /marketplace | 首屏渲染 < 2s，无骨架闪烁 |
| | 2. 点击 Install 后进度条分阶段推进，100% 后卡片状态切换为 "Installed" | 点击任意主题 Install | 4 阶段进度条平滑推进，网络断开可恢复 |
| | 3. 详情页截图可点击放大、兼容平台标签正确显示 | 点击主题卡片进入详情 | 截图懒加载正常，兼容标签无遗漏 |
| | 4. 搜索按下 Enter 后 300ms 防抖触发，结果正确 | 输入 "dark" → Enter | debounce 正确，无多余请求 |
| **状态监控面板 (P0)** | 1. 绿色 Agent 心跳点达到 2s 周期脉冲动画，视觉无卡顿 | 观察 EnvironmentCard 卡片 | animation 流畅，CPU < 5% |
| | 2. CDP 断开后 90s 内状态灯由绿变红，tooltip 显示 "Incident" | WorkBuddy 退出 → 等待 90s | 状态转换符合 investigating → identified |
| | 3. TokenUsage sparkline 每 30s 更新一条新数据点 | 等待 3 分钟观察图表 | 图表滚动 6 个数据点，无内存泄漏 |
| | 4. 重启 App 后心跳数据从磁盘恢复，不丢失历史 | electron重启后查看 EnvironmentCard | 离线时间点 ICD on timeline |
| **Workspace 工作台 (P1)** | 1. Tabs 切换无白屏闪，内容 Keep-alive | 3 个 Tab 间反复切换 10 次 | 每次切换 < 200ms，无加载状态 |
| | 2. ToolCallTimeline 每增加一条调用，时间轴实时 append | 等待 Agent 发起 Tool Call | 自动滚动到最新，展开/折叠正常 |
| | 3. 权限审批弹窗在 critical 级 Tool Call 时阻止执行并显示三选项 | 触发 write_file 弹窗出现 | 三选项功能正常，超时为 30s |
| | 4. TokenUsageChart 1h/24h/7d 切换时间范围时，URL 参数同步、支持分享链接 | 点击 7d → 刷新页面 | 刷新后仍显示 7d 视图 |
| **Settings 重构 (P1)** | 1. 左 Tab 切换平滑，THEME 缩略图同步当前主色 | Tab 切换 4 次 | 无深色页面闪烁 |
| | 2. Ctrl+K 命令面板打开，输入 "theme" 可跳转到 THEME Section | Ctrl+K 输入 theme → Enter | 跳转锚点正确，Section 高亮 |
| | 3. Bundle 安装进度流式推送，不阻塞 Settings 页面交互 | 安装 Bundle 时切换 Tab | Settings 不卡顿或白屏 |
| | 4. Search 输入框输入 "language" 高亮匹配 SettingRow | 搜索 "language" | 匹配行进入 viewport 高亮 |
| **Tray + 音频可视化 (P2)** | 1. Tray 菜单"Recent Themes"子菜单显示最近 5 个已 apply 主题 | 切换 5 个主题 → 右击 Tray | 顺序正确，与实际 apply 序列一致 |
| | 2. AudioVisualizer 播放网络音乐时频谱实时跟随节拍（肉眼可识别） | 打开 Spotify 播放 → Visualizer | FPS > 30，频谱与歌词同步 |
| | 3. FFT Size 在 2048 档时 CPU < 8%（低端设备降档至 256） | Task Manager 观察 CPU | CPU 指标符合预期 |
| | 4. 关闭 AudioVisualizer 设置后，主进程无音频 capture 进程残留 | 关闭 → 检查进程列表 | `audiodg.exe` 无异常增长 |

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 覆盖功能: 11 个剩余模块 + 1 个执行方案*
