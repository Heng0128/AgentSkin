# Agent 主题系统规范

> 本文档定义 AgentSkin 面向 AI Agent / 聊天 / 编码 / 协作产品的主题系统。不只是"调色板"，而是每个主题都有独特的组件设计、交互逻辑和适用场景。

---

## 一、设计原则

### 1.1 Agent 主题必须优先满足的条件

| 条件 | 要求 | 不适合 |
|------|------|--------|
| 长时间阅读不累 | 低噪声背景、清晰行高、稳定灰阶 | 蒸汽波、酸性荧光、像素风全屏 |
| 聊天层级清楚 | User/Assistant/System/Tool/Error/Success 状态色分明 | 单一气泡风格 |
| 代码块可读 | monospace 字体、代码高亮、diff 色 | 纯装饰性主题 |
| 信息密度可切换 | Comfortable / Compact / Chat / Code / Board 模式 | 固定密度 |

### 1.2 消息类型与状态体系

```
User       → 用户消息
Assistant  → AI 回复
System     → 系统通知（居中灰色）
Tool       → 工具调用卡片（可折叠）
Error      → 错误状态（红）
Success    → 成功状态（绿）
Running    → 执行中（蓝/青）
Approval   → 权限确认（橙/红）
Plan       → 计划展示
Task       → 任务卡片
Diff       → 代码变更
File       → 文件引用
```

---

## 二、风格分级

### S 级：最适合 Agent 产品（可作为默认主题）

| 风格 | 改造方向 | 适合产品 |
|---|---|---|
| Apple / iOS 现代风 | 轻量聊天/办公界面 | WorkBuddy、移动端 Agent |
| Aurora 深色 / Vercel / Linear | Coding Agent 默认暗色 | Codex、zcode、QoderWork |
| Bento Grid | Dashboard / 任务总览 | Traework、WorkBuddy |
| macOS 现代风 | 桌面 Agent / 工作台外壳 | 桌面端 AI 工作台 |
| Notion / Linear / Figma 工具美学 | 文档、任务、知识库 | Traework、WorkBuddy |
| Material Design / Material You | 跨平台 Android/Web | 通用 Agent |
| Windows 11 Fluent | 企业办公/桌面工具 | WorkBuddy、Traework |
| 微信风 | 国内聊天/服务/私域 Agent | WorkBuddy、客服 Agent |

### A 级：适合作为局部组件或子模式

| 风格 | 用途 |
|---|---|
| 瑞士国际主义 | 设置页、文档页、品牌页 |
| 杂志编辑风 | 长文档阅读模式 |
| 毛玻璃 | 浮层、Command Palette、导航 |
| 液态风 | AI loading / avatar / background accent |
| 终端 Terminal | 开发者模式、运行日志 |
| 新粗野 | 空状态、按钮、活动页 |
| 手绘风 | onboarding、空状态、轻松模式 |

### B 级：仅作个性化皮肤

Win7 Aero / Win95/98 / 古早 QQ / Winamp / Pixel 8-bit / Y2K — 适合彩蛋主题或 Retro 模式。

### C 级：不建议作为 Agent 主界面

酸性设计 / 赛博朋克全屏 / 蒸汽波 / 新拟物 / 拟物皮革 / 轻奢黑金 / 拼贴纸风 — 影响功能性和可读性。

---

## 三、8 个 Agent 专属主题

### 3.1 Agent Chat Dark（默认开发者主题）

**适合产品**：Codex、zcode、QoderWork、Developer Agent

**核心感觉**：深色、稳定、低噪声、代码可读、长时间不累

```css
:root[data-theme="agent-dark"] {
  --bg: #07080c;
  --bg-elevated: #0d0f16;
  --panel: #10141d;
  --panel-2: #151a25;
  --border: rgba(255,255,255,0.09);
  --border-strong: rgba(255,255,255,0.16);

  --text: #e8eaf0;
  --text-muted: #98a0b3;
  --text-faint: #6b7288;

  --accent: #7c5cff;
  --accent-hover: #8f72ff;
  --accent-soft: rgba(124,92,255,0.16);

  --success: #34d399;
  --warning: #f5b342;
  --danger: #f87171;
  --info: #60a5fa;

  --code-bg: #05060a;
  --code-border: rgba(255,255,255,0.08);
  --code-text: #dfe3ee;

  --user-bubble: rgba(124,92,255,0.18);
  --assistant-bubble: transparent;
  --tool-card: rgba(255,255,255,0.03);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  --shadow-sm: 0 1px 2px rgba(0,0,0,0.3);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.35);
  --shadow-lg: 0 24px 80px rgba(0,0,0,0.45);
}
```

**推荐指数**：★★★★★

---

### 3.2 Agent Chat Light（默认办公主题）

**适合产品**：WorkBuddy、Traework、Office Agent、HR Agent、Document Agent

**核心感觉**：干净、温和、办公化、低压力

```css
:root[data-theme="agent-light"] {
  --bg: #f7f8fa;
  --bg-elevated: #ffffff;
  --panel: #ffffff;
  --panel-2: #f2f4f8;
  --border: rgba(15,23,42,0.08);
  --border-strong: rgba(15,23,42,0.14);

  --text: #16181d;
  --text-muted: #667085;
  --text-faint: #98a2b3;

  --accent: #2563eb;
  --accent-hover: #1d4ed8;
  --accent-soft: rgba(37,99,235,0.10);

  --success: #16a34a;
  --warning: #d97706;
  --danger: #dc2626;
  --info: #0ea5e9;

  --code-bg: #0b1220;
  --code-border: rgba(255,255,255,0.06);
  --code-text: #e5e7eb;

  --user-bubble: rgba(37,99,235,0.10);
  --assistant-bubble: transparent;
  --tool-card: rgba(15,23,42,0.03);

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;

  --shadow-sm: 0 1px 2px rgba(15,23,42,0.06);
  --shadow-md: 0 8px 24px rgba(15,23,42,0.10);
  --shadow-lg: 0 24px 80px rgba(15,23,42,0.16);
}
```

> 注意：浅色主题下代码块建议仍用深色底，代码可读性更强。

**推荐指数**：★★★★★

---

### 3.3 CodeDeck IDE（编程工作台主题）

**适合产品**：Codex、zcode、QoderWork、coding agent、terminal agent

**核心感觉**：像 IDE，不像普通聊天软件

```css
:root[data-theme="code-deck"] {
  --bg: #0a0c10;
  --sidebar: #0e1117;
  --editor: #0d1017;
  --chat: #10151f;
  --panel: #131926;
  --panel-2: #182032;

  --border: #1e2634;
  --border-strong: #2a3550;

  --text: #dbe2ee;
  --text-muted: #8b93a7;
  --text-faint: #5f6880;

  --accent: #4c8dff;
  --accent-2: #22d3ee;
  --accent-soft: rgba(76,141,255,0.16);

  --success: #4ade80;
  --warning: #facc15;
  --danger: #fb7185;
  --info: #38bdf8;

  --code-bg: #070a0f;
  --code-text: #d7e0ee;
  --code-border: #171f2c;

  --selection: rgba(76,141,255,0.25);

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --font-ui: "Inter", "PingFang SC", sans-serif;
  --font-code: "JetBrains Mono", "Fira Code", monospace;
}
```

**界面结构**：

```
Left:   Repo / Files
Center: Code / Diff / Preview
Right:  Agent Chat / Inspector
Bottom: Terminal / Logs / Problems
```

**组件重点**：文件树、tab bar、code diff、git status、terminal panel

**推荐指数**：★★★★★

---

### 3.4 Workboard（任务/项目/办公主题）

**适合产品**：Traework、WorkBuddy、Project Agent、Team Agent

**核心感觉**：任务看板 + 文档 + Agent 进度混合工作台

```css
:root[data-theme="workboard"] {
  --bg: #f5f7fb;
  --surface: #ffffff;
  --surface-2: #eef2f8;
  --border: rgba(15,23,42,0.07);
  --border-strong: rgba(15,23,42,0.12);

  --text: #171a20;
  --text-muted: #657084;
  --text-faint: #98a2b3;

  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-soft: rgba(79,70,229,0.10);

  --success: #10b981;
  --warning: #f59e0b;
  --danger: #ef4444;
  --info: #3b82f6;

  --card-shadow: 0 4px 16px rgba(15,23,42,0.06);
  --radius-card: 16px;
  --radius-button: 10px;
}
```

**组件重点**：task card、kanban column、timeline、agent run history

**推荐指数**：★★★★☆

---

### 3.5 WeChat-like（国内聊天服务型 Agent）

**适合产品**：WorkBuddy、客服 Agent、私域运营 Agent、C 端服务 Agent

**核心感觉**：熟悉、低学习成本、像聊天软件

```css
:root[data-theme="wechat-like"] {
  --bg: #ededed;
  --surface: #ffffff;
  --surface-2: #f7f7f7;
  --border: rgba(0,0,0,0.05);

  --text: #191919;
  --text-muted: #7f7f7f;
  --text-faint: #b2b2b2;

  --accent: #07c160;
  --accent-hover: #06a552;
  --accent-soft: rgba(7,193,96,0.10);

  --bubble-user: #95ec69;
  --bubble-agent: #ffffff;
  --system-text: #b2b2b2;

  --success: #07c160;
  --warning: #fa9d3b;
  --danger: #fa5151;
  --info: #10aeff;

  --radius-card: 8px;
  --radius-button: 8px;
  --radius-bubble: 10px;
}
```

**消息结构**：
- 用户消息：绿色气泡，右侧
- Agent 消息：白色气泡，左侧
- 系统消息：居中灰字
- 工具执行：折叠卡片

**推荐指数**：★★★★☆

---

### 3.6 Terminal Ops（命令行/日志主题）

**适合产品**：zcode、Codex、DevOps Agent、SRE Agent、Shell Agent

**核心感觉**：命令行、日志、执行流、高可信

```css
:root[data-theme="terminal-ops"] {
  --bg: #05070a;
  --panel: #0a0f14;
  --border: rgba(148,163,184,0.14);
  --text: #d7e2ea;
  --muted: #7b8a99;
  --accent: #22d3ee;
  --success: #4ade80;
  --warning: #facc15;
  --danger: #fb7185;
  --code: #67e8f9;
}
```

**特点**：等宽字体为主、日志可折叠、命令可复制、error line 红色高亮

**注意**：不要做成全屏 CRT 扫描线（除非彩蛋模式），主界面应现代，终端感只保留排版和颜色。

**推荐指数**：★★★★☆

---

### 3.7 Retro Desktop（个性化皮肤）

**适合产品**：趣味模式、桌面宠物型 Agent、活动皮肤

**核心感觉**：把 Agent 做成桌面上的小伙伴 / 老系统里的智能窗口

**可保留元素**：窗口标题栏、关闭/最小化按钮、任务栏、开始菜单、聊天气泡、系统通知

**推荐做法**：把复古 OS 当成"皮肤壳"，内部仍然是现代 Agent Chat 组件。

> 外观：Win7 玻璃窗口 → 内部：现代聊天流 + 代码块 + 任务卡片

**推荐指数**：★★★☆☆（仅适合个性化，不适合默认）

---

### 3.8 Focus Doc（文档阅读/写作主题）

**适合产品**：WorkBuddy、Traework、Document Agent、Meeting Summary Agent

**核心感觉**：安静、专注、适合长文阅读和写作

```css
:root[data-theme="focus-doc"] {
  --bg: #fbfbfa;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #6b7280;
  --accent: #374151;
  --accent-2: #2563eb;
  --border: rgba(0,0,0,0.06);
  --code-bg: #0b1220;
}
```

**组件重点**：长文档阅读、AI 总结卡片、高亮注释、引用来源、大纲侧栏、评论/suggestion

**推荐指数**：★★★★☆

---

## 四、产品 × 主题映射

| 产品 | 默认主题 | 第二模式 | 彩蛋 |
|---|---|---|---|
| Codex 类 | Agent Dark | CodeDeck | Terminal Ops |
| zcode | CodeDeck | Terminal Ops | Retro Terminal |
| QoderWork | CodeDeck | Workboard | Agent Dark/Light |
| Traework | Workboard | Agent Light | Bento Dashboard |
| WorkBuddy | Agent Light | WeChat-like | Retro Desktop |
| Office Agent | Focus Doc | Agent Light | macOS Modern |
| Dev Agent | Agent Dark | Terminal Ops | Cyber accent |
| Team Agent | Workboard | Fluent | Material |

---

## 五、Agent 专属组件设计

Agent 不是普通 IM，主题必须包含以下组件：

### 5.1 用户消息

```css
.message-user {
  background: var(--user-bubble);
  color: var(--text);
  border-radius: 14px 14px 4px 14px;
  padding: 12px 14px;
  max-width: 72%;
}
```

### 5.2 Agent 消息

不推荐强气泡（AI 输出长，强气泡让阅读变累）：

```css
.message-assistant {
  background: transparent;
  color: var(--text);
  line-height: 1.7;
  max-width: 860px;
}
```

### 5.3 System 消息

```css
.message-system {
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
}
```

### 5.4 Tool Call 工具调用卡片

可折叠卡片，带状态色：

```css
.tool-card {
  background: var(--tool-card);
  border: 1px solid var(--border);
  border-left: 3px solid var(--info);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

.tool-card.running  { border-left-color: var(--info); }
.tool-card.success  { border-left-color: var(--success); }
.tool-card.error    { border-left-color: var(--danger); }
```

卡片内容：图标 + 工具名 / 参数摘要 / 运行状态 / 耗时 / 结果预览 / 展开详情

### 5.5 Code Block

```css
.code-block {
  background: var(--code-bg);
  color: var(--code-text);
  border: 1px solid var(--code-border);
  border-radius: var(--radius-md);
  font-family: var(--font-code);
  font-size: 13px;
  line-height: 1.6;
  overflow-x: auto;
}
```

头部包含：语言标签、文件路径、Copy / Apply / Diff / Edit 按钮

### 5.6 Diff Card

```css
.diff-add {
  background: rgba(74,222,128,0.12);
  color: var(--success);
}
.diff-remove {
  background: rgba(251,113,133,0.12);
  color: var(--danger);
}
```

### 5.7 File Chip

```css
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  font-size: 12px;
}
```

### 5.8 Approval / Permission Card

```css
.approval-card {
  border: 1px solid rgba(248,113,113,0.35);
  background: rgba(248,113,113,0.08);
  border-radius: var(--radius-md);
  padding: 12px;
}
```

按钮：Allow once / Always allow / Reject

### 5.9 Composer 输入框

```css
.composer {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 12px;
  box-shadow: var(--shadow-md);
}
```

包含：自动高度 textarea / @ 引用文件 / / 命令 / 模型选择 / Token 使用 / 附件按钮 / 发送/停止按钮

---

## 六、统一 Design System 策略

> 同一套 Agent Design System + 不同产品 accent color + 不同模式主题

### 6.1 产品 Accent Color

| 产品 | 主色 | 气质 |
|---|---|---|
| Codex 类 | `#4c8dff` | 专业代码蓝 |
| zcode | `#22d3ee` | 终端青 |
| QoderWork | `#7c5cff` | 智能紫 |
| Traework | `#4f46e5` | 协作靛蓝 |
| WorkBuddy | `#07c160` 或 `#2563eb` | 亲和绿 / 办公蓝 |

### 6.2 通用模式

```text
Chat Mode    → 聊天优先
Code Mode    → 代码优先
Board Mode   → 任务优先
Doc Mode     → 文档优先
Terminal Mode → 命令行优先
Retro Mode   → 个性化皮肤
```

### 6.3 模式切换时的主题行为

| 模式 | 默认布局 | 默认主题 |
|---|---|---|
| Chat | 左侧列表 + 右侧聊天 | Agent Light |
| Code | 左侧文件 + 中间编辑 + 右侧聊天 | Agent Dark |
| Board | 左侧项目 + 中间看板 + 右侧活动 | Workboard |
| Doc | 左侧大纲 + 中间文档 + 右侧 AI | Focus Doc |
| Terminal | 上编辑 + 下终端 | Terminal Ops |

---

## 七、主题包分组

建议做 5 个主题包，用户可按需安装：

| 主题包 | 包含主题 | 用途 |
|---|---|---|
| **Agent Core** | Agent Dark + Agent Light | 所有产品通用 |
| **Agent Dev** | CodeDeck + Terminal Ops | Codex / zcode / QoderWork |
| **Agent Work** | Workboard + Focus Doc | Traework / WorkBuddy |
| **Agent Chat** | WeChat-like + iOS Chat | 聊天型 / 客服 Agent |
| **Agent Retro** | Desktop 95 / Win7 / Old QQ | 个性化 / 彩蛋 |

---

## 八、总结

> 如果只能选一个默认主题：**Modern Agent Dark + Agent Light 双主题**
>
> 编码场景默认 Dark，办公场景默认 Light。

8 个专属主题 × 5 个产品 × 6 种模式 = **丰富的差异化体验**，而非同质化调色板。

---

## 九、可执行实施方案 — 文件级改造清单

> 本章将前述 8 个 Agent 专属主题（Agent Chat Dark / Agent Chat Light / CodeDeck IDE / Workboard / WeChat-like / Terminal Ops / Retro Desktop / Focus Doc）从设计规范转化为可落地的代码改造清单。每个文件路径、每条依赖、每个字段均有明确归属，开发者可按本章直接执行。

---

### 9.1 准备阶段 — 必须优先克隆的项目

在动手编码之前，先把以下参考项目 clone 到本地，提取其色彩体系、CSS 变量组织和主题切换机制的核心设计。

| 排名 | 项目 | 地址 | Star | 借鉴点 |
|---|---|---|---|---|
| 🥇 | catppuccin/catppuccin | https://github.com/catppuccin/catppuccin | ~19k | 多平台色彩体系（4-flavour 结构：Latte / Frappé / Macchiato / Mocha），JSON palette 定义，跨平台一致性极强 |
| 🥈 | spacepad-labs/linear-themes | https://github.com/spacepad-labs/linear-themes | ~3k | Linear 主题系统的 CSS 变量组织方式，Light/Dark 完全对称，accent 色彩切换模式 |
| 🥉 | tailwindlabs/tailwindcss | https://github.com/tailwindlabs/tailwindcss | ~85k | OKLCH 色彩空间 + CSS 变量驱动的配置体系，设计令牌的类型定义方式 |
| 4 | primer/primer-design | https://github.com/primer/primer-design | ~6k | GitHub 官方 Design System，色彩 tokens 的三层语义结构（base → component → pattern） |
| 5 | saxc/components | https://github.com/saxc/components | ~1k | 组件变体系统（variant）实现参考，不同 style 切换对应不同 CSS 类 |
| 6 | keybase/client | https://github.com/keybase/client | ~7k | 聊天应用的主题切换完整实现，palette → CSS → runtime 注入的实际工程案例 |

> ** clone 目标**：并非复制大段代码，而是阅读其 `palette.json` / `tokens.css` / 主题切换入口函数的组织方式，提取「颜色 → 设计令牌 → CSS 组件」的三层映射模式。

---

### 9.2 新增 npm 依赖

```bash
# 色彩处理（OKLCH 空间、对比度计算）
npm install culori

# 验证主题 JSON schema（开发依赖）
npm install -D zod

# CSS 变量生成工具（可选，如不使用手写 CSS）
npm install -D style-dictionary

# 主题切换时的颜色插值动画（可选）
npm install @motion.dev/css
```

> 决策说明：`culori` 用于在构建期校验各主题色彩对比度满足 WCAG AA（正文 ≥ 4.5:1）；`zod` 已在项目中使用，用于 `colors.json` 运行时 schema 校验；如不需要动态生成 CSS，可跳过 `style-dictionary`。

---

### 9.3 文件修改清单 — 按阶段

#### Phase 1：主题色板 JSON 化

**目标**：把所有硬编码的 CSS 变量从样式文件中抽离，集中到每个主题的 `colors.json`，使主题切换只需替换 JSON 引用。

| 文件路径 | 操作 | 说明 |
|---|---|---|
| `themes/agent-core/colors.json` | 新建 | Agent Dark + Agent Light 色板（双模式同文件） |
| `themes/agent-dev/colors.json` | 新建 | CodeDeck + Terminal Ops 色板 |
| `themes/agent-work/colors.json` | 新建 | Workboard + Focus Doc 色板 |
| `themes/agent-chat/colors.json` | 新建 | WeChat-like + iOS Chat 色板 |
| `themes/agent-retro/colors.json` | 新建 | Retro Desktop 色板 |
| `src/shared/schemas/theme-colors.ts` | 新建 | colors.json 的 Zod schema 定义（字段白名单校验） |
| `src/core/theme/color-loader.ts` | 新建 | 读取 colors.json → 生成 CSS 变量 → 注入 `:root[data-theme]` 的入口函数 |
| `src/main/services/theme-catalog.ts` | 修改 | 迭代 directories 加载时调用 `color-loader` 而非直接读 CSS |
| `biome.json` | 修改 | 添加 `themes/**` 路径排除或 JSON schema 配置 |

#### Phase 2：组件变体系统

**目标**：在 Theme Studio 中新增「组件」Tab，允许用户在运行时切换组件风格变量（bubble shape / sidebar style / input density），无需改色板。

| 文件路径 | 操作 | 说明 |
|---|---|---|
| `themes/agent-core/src/bubbles.css` | 新建 | 聊天气泡变体：accent vs transparent vs bordered（参考组件 5.1–5.3） |
| `themes/agent-core/src/sidebar.css` | 新建 | 侧边栏样式：compact / comfortable / minimal |
| `themes/agent-core/src/input.css` | 新建 | 输入框变体：minimal / pill / bordered-with-icon |
| `themes/agent-dev/src/bubbles.css` | 新建 | IDE 场景中气泡更紧凑（窄 radius、降低 padding） |
| `themes/agent-dev/src/sidebar.css` | 新建 | 文件树为主的 Sidebar（树形缩进、icon 密度） |
| `src/ui/components/ThemeStudio/ComponentsTab.tsx` | 新建 | Theme Studio 中新增的「组件」选项卡面板 |
| `src/ui/components/ThemeStudio/VariantSelector.tsx` | 新建 | 变体选择器（radio-card 组件，展示每个 variant 的缩略预览） |
| `src/main/services/theme-bundle.ts` | 修改 | 新增 `variant` 字段，序列化到用户偏好 |
| `src/core/theme/color-loader.ts` | 修改 | 在注入 CSS 变量后追加注入变体类名到 `document.body` |

#### Phase 3：5 个主题包的具体文件清单

根据「七、主题包分组」的划分，各主题包文件结构如下：

**themes/agent-core/**（通用包，所有产品内置）

```
themes/agent-core/
├── colors.json          # Agent Chat Dark + Agent Chat Light 的色彩定义
├── manifest.json       # 包元数据：id, name, description, version, modes: ["dark","light"]
└── src/
    ├── base.css        # 通用 reset / typography / spacing
    ├── bubbles.css     # 聊天气泡（dark & light 两种配色）
    ├── sidebar.css     # 侧边栏（dark & light 两种配色）
    ├── input.css       # 输入框
    ├── code-block.css # 代码块
    ├── tool-card.css  # 工具调用卡片
    └── approval.css   # 审批卡片
```

**themes/agent-dev/**（开发工具包）

```
themes/agent-dev/
├── colors.json          # CodeDeck + Terminal Ops
├── manifest.json
└── src/
    ├── base.css
    ├── bubbles.css     # 紧凑风格
    ├── sidebar.css     # 文件树
    ├── editor.css      # 代码编辑器高亮
    ├── terminal.css    # 终端面板样式
    ├── diff.css        # diff 卡片
    └── code-block.css
```

**themes/agent-work/**（协作办公包）

```
themes/agent-work/
├── colors.json          # Workboard + Focus Doc
├── manifest.json
└── src/
    ├── base.css
    ├── task-card.css   # 任务卡片
    ├── kanban.css      # 看板列
    ├── timeline.css    # 时间线
    ├── doc-read.css    # 文档阅读模式
    └── comment.css     # 评论/suggestion
```

**themes/agent-chat/**（聊天服务包）

```
themes/agent-chat/
├── colors.json          # WeChat-like + iOS Chat
├── manifest.json
└── src/
    ├── base.css
    ├── bubbles.css     # 微信风格：绿/白双色气泡
    ├── sidebar.css     # 会话列表
    ├── group-chat.css  # 群聊界面
    └── sticker.css     # 表情包区域
```

**themes/agent-retro/**（个性化彩蛋包）

```
themes/agent-retro/
├── colors.json          # Retro Desktop（默认 Win7 风格）
├── manifest.json
└── src/
    ├── window.css      # 复古窗口栏
    ├── taskbar.css     # 底部任务栏
    ├── start-menu.css  # 开始菜单
    └── bubble-skin.css # 复古聊天气泡皮肤
```

#### Phase 4：每个 Agent 的 product-config 映射

**目标**：在用户未明确选择主题时，根据当前绑定的产品线自动匹配最佳默认主题。

| 文件路径 | 操作 | 说明 |
|---|---|---|
| `src/main/config/product-config.ts` | 新建 | 产品线枚举 + 默认主题映射 |
| `src/main/services/theme-catalog.ts` | 修改 | 初始化时读取 `product-config` 的默认值 |
| `src/ui/pages/SettingsPage.tsx` | 修改 | 根据 `product-config` 决定 ThemeCard 列表的默认选中项 |
| `src/shared/constants/products.ts` | 新建 | 定义产品 ID 枚举（workbuddy / qoderwork_cn / traework_cn / zcode / doubao） |
| `src/main/services/agent-detector.ts` | 修改 | 新增 `resolveDefaultTheme()` 公共方法，供多处调用 |

---

### 9.4 文件清单汇总表

以下为本次改造需要 **创建** 与 **修改** 的全部文件路径：

| 序号 | 文件路径 | 操作类型 | 所属阶段 |
|---|---|---|---|
| 1 | `themes/agent-core/colors.json` | 新建 | Phase 1 |
| 2 | `themes/agent-core/src/bubbles.css` | 新建 | Phase 2 |
| 3 | `themes/agent-core/src/sidebar.css` | 新建 | Phase 2 |
| 4 | `themes/agent-core/src/input.css` | 新建 | Phase 2 |
| 5 | `themes/agent-core/src/code-block.css` | 新建 | Phase 3 |
| 6 | `themes/agent-core/src/tool-card.css` | 新建 | Phase 3 |
| 7 | `themes/agent-core/src/approval.css` | 新建 | Phase 3 |
| 8 | `themes/agent-core/src/base.css` | 新建 | Phase 3 |
| 9 | `themes/agent-core/manifest.json` | 新建 | Phase 3 |
| 10 | `themes/agent-dev/colors.json` | 新建 | Phase 1 |
| 11 | `themes/agent-dev/src/bubbles.css` | 新建 | Phase 2 |
| 12 | `themes/agent-dev/src/sidebar.css` | 新建 | Phase 2 |
| 13 | `themes/agent-dev/src/editor.css` | 新建 | Phase 3 |
| 14 | `themes/agent-dev/src/terminal.css` | 新建 | Phase 3 |
| 15 | `themes/agent-dev/src/diff.css` | 新建 | Phase 3 |
| 16 | `themes/agent-dev/src/code-block.css` | 新建 | Phase 3 |
| 17 | `themes/agent-dev/src/base.css` | 新建 | Phase 3 |
| 18 | `themes/agent-dev/manifest.json` | 新建 | Phase 3 |
| 19 | `themes/agent-work/colors.json` | 新建 | Phase 1 |
| 20 | `themes/agent-work/src/task-card.css` | 新建 | Phase 3 |
| 21 | `themes/agent-work/src/kanban.css` | 新建 | Phase 3 |
| 22 | `themes/agent-work/src/timeline.css` | 新建 | Phase 3 |
| 23 | `themes/agent-work/src/doc-read.css` | 新建 | Phase 3 |
| 24 | `themes/agent-work/src/comment.css` | 新建 | Phase 3 |
| 25 | `themes/agent-work/src/base.css` | 新建 | Phase 3 |
| 26 | `themes/agent-work/manifest.json` | 新建 | Phase 3 |
| 27 | `themes/agent-chat/colors.json` | 新建 | Phase 1 |
| 28 | `themes/agent-chat/src/bubbles.css` | 新建 | Phase 3 |
| 29 | `themes/agent-chat/src/sidebar.css` | 新建 | Phase 3 |
| 30 | `themes/agent-chat/src/group-chat.css` | 新建 | Phase 3 |
| 31 | `themes/agent-chat/src/sticker.css` | 新建 | Phase 3 |
| 32 | `themes/agent-chat/src/base.css` | 新建 | Phase 3 |
| 33 | `themes/agent-chat/manifest.json` | 新建 | Phase 3 |
| 34 | `themes/agent-retro/colors.json` | 新建 | Phase 1 |
| 35 | `themes/agent-retro/src/window.css` | 新建 | Phase 3 |
| 36 | `themes/agent-retro/src/taskbar.css` | 新建 | Phase 3 |
| 37 | `themes/agent-retro/src/start-menu.css` | 新建 | Phase 3 |
| 38 | `themes/agent-retro/src/bubble-skin.css` | 新建 | Phase 3 |
| 39 | `themes/agent-retro/manifest.json` | 新建 | Phase 3 |
| 40 | `src/shared/schemas/theme-colors.ts` | 新建 | Phase 1 |
| 41 | `src/core/theme/color-loader.ts` | 新建 | Phase 1 |
| 42 | `src/ui/components/ThemeStudio/ComponentsTab.tsx` | 新建 | Phase 2 |
| 43 | `src/ui/components/ThemeStudio/VariantSelector.tsx` | 新建 | Phase 2 |
| 44 | `src/main/config/product-config.ts` | 新建 | Phase 4 |
| 45 | `src/shared/constants/products.ts` | 新建 | Phase 4 |
| 46 | `src/main/catalog/theme-catalog.ts` | 修改 | Phase 1+4 |
| 47 | `src/ui/pages/SettingsPage.tsx` | 修改 | Phase 4 |
| 48 | `src/main/services/theme-bundle.ts` | 修改 | Phase 2 |
| 49 | `src/main/services/agent-detector.ts` | 修改 | Phase 4 |
| 50 | `biome.json` | 修改 | Phase 1 |

---

### 9.5 代码示例

#### 9.5.1 colors.json 示例（参考 catppuccin 的 4-flavour 结构）

```json
{
  "id": "agent-core",
  "name": "Agent Core",
  "version": "1.0.0",
  "modes": {
    "dark": {
      "meta": { "name": "Agent Chat Dark", "description": "默认开发者深色主题" },
      "colors": {
        "bg": { "hex": "#07080c", "oklch": "oklch(14.5% 0.012 270)" },
        "bgElevated": { "hex": "#0d0f16", "oklch": "oklch(16.5% 0.015 270)" },
        "panel": { "hex": "#10141d", "oklch": "oklch(19% 0.018 270)" },
        "panel2": { "hex": "#151a25", "oklch": "oklch(22% 0.020 270)" },
        "border": { "hex": "rgba(255,255,255,0.09)", "oklch": "oklch(100% 0 0 / 0.09)" },
        "borderStrong": { "hex": "rgba(255,255,255,0.16)", "oklch": "oklch(100% 0 0 / 0.16)" },
        "text": { "hex": "#e8eaf0", "oklch": "oklch(93% 0.008 270)" },
        "textMuted": { "hex": "#98a0b3", "oklch": "oklch(68% 0.020 270)" },
        "textFaint": { "hex": "#6b7288", "oklch": "oklch(49% 0.022 270)" },
        "accent": { "hex": "#7c5cff", "oklch": "oklch(58% 0.20 285)" },
        "accentHover": { "hex": "#8f72ff", "oklch": "oklch(63% 0.20 285)" },
        "accentSoft": { "hex": "rgba(124,92,255,0.16)", "oklch": "oklch(58% 0.20 285 / 0.16)" },
        "success": { "hex": "#34d399", "oklch": "oklch(78% 0.16 158)" },
        "warning": { "hex": "#f5b342", "oklch": "oklch(80% 0.14 80)" },
        "danger": { "hex": "#f87171", "oklch": "oklch(70% 0.18 25)" },
        "info": { "hex": "#60a5fa", "oklch": "oklch(72% 0.14 250)" },
        "codeBg": { "hex": "#05060a", "oklch": "oklch(13% 0.010 270)" },
        "codeBorder": { "hex": "rgba(255,255,255,0.08)", "oklch": "oklch(100% 0 0 / 0.08)" },
        "codeText": { "hex": "#dfe3ee", "oklch": "oklch(90% 0.008 270)" },
        "userBubble": { "hex": "rgba(124,92,255,0.18)", "oklch": "oklch(58% 0.20 285 / 0.18)" },
        "assistantBubble": { "hex": "transparent", "oklch": "oklch(100% 0 0 / 0)" },
        "toolCard": { "hex": "rgba(255,255,255,0.03)", "oklch": "oklch(100% 0 0 / 0.03)" }
      },
      "radii": { "sm": "8px", "md": "12px", "lg": "16px", "xl": "24px" },
      "shadows": {
        "sm": "0 1px 2px rgba(0,0,0,0.3)",
        "md": "0 8px 24px rgba(0,0,0,0.35)",
        "lg": "0 24px 80px rgba(0,0,0,0.45)"
      }
    },
    "light": {
      "meta": { "name": "Agent Chat Light", "description": "默认办公浅色主题" },
      "colors": {
        "bg": { "hex": "#f7f8fa", "oklch": "oklch(97% 0.003 270)" },
        "bgElevated": { "hex": "#ffffff", "oklch": "oklch(100% 0 0)" },
        "panel": { "hex": "#ffffff", "oklch": "oklch(100% 0 0)" },
        "panel2": { "hex": "#f2f4f8", "oklch": "oklch(95% 0.005 270)" },
        "border": { "hex": "rgba(15,23,42,0.08)", "oklch": "oklch(15% 0.01 250 / 0.08)" },
        "borderStrong": { "hex": "rgba(15,23,42,0.14)", "oklch": "oklch(15% 0.01 250 / 0.14)" },
        "text": { "hex": "#16181d", "oklch": "oklch(19% 0.010 250)" },
        "textMuted": { "hex": "#667085", "oklch": "oklch(46% 0.022 250)" },
        "textFaint": { "hex": "#98a2b3", "oklch": "oklch(67% 0.018 250)" },
        "accent": { "hex": "#2563eb", "oklch": "oklch(55% 0.20 260)" },
        "accentHover": { "hex": "#1d4ed8", "oklch": "oklch(48% 0.20 260)" },
        "accentSoft": { "hex": "rgba(37,99,235,0.10)", "oklch": "oklch(55% 0.20 260 / 0.10)" },
        "success": { "hex": "#16a34a", "oklch": "oklch(60% 0.16 150)" },
        "warning": { "hex": "#d97706", "oklch": "oklch(65% 0.14 70)" },
        "danger": { "hex": "#dc2626", "oklch": "oklch(55% 0.18 25)" },
        "info": { "hex": "#0ea5e9", "oklch": "oklch(65% 0.14 230)" },
        "codeBg": { "hex": "#0b1220", "oklch": "oklch(17% 0.020 250)" },
        "codeBorder": { "hex": "rgba(255,255,255,0.06)", "oklch": "oklch(100% 0 0 / 0.06)" },
        "codeText": { "hex": "#e5e7eb", "oklch": "oklch(92% 0.003 250)" },
        "userBubble": { "hex": "rgba(37,99,235,0.10)", "oklch": "oklch(55% 0.20 260 / 0.10)" },
        "assistantBubble": { "hex": "transparent", "oklch": "oklch(100% 0 0 / 0)" },
        "toolCard": { "hex": "rgba(15,23,42,0.03)", "oklch": "oklch(15% 0.01 250 / 0.03)" }
      },
      "radii": { "sm": "8px", "md": "12px", "lg": "16px", "xl": "24px" },
      "shadows": {
        "sm": "0 1px 2px rgba(15,23,42,0.06)",
        "md": "0 8px 24px rgba(15,23,42,0.10)",
        "lg": "0 24px 80px rgba(15,23,42,0.16)"
      }
    }
  },
  "variants": {
    "chat-bubble": {
      "default": "accent",
      "options": ["accent", "transparent", "bordered"]
    },
    "sidebar-style": {
      "default": "comfortable",
      "options": ["compact", "comfortable", "minimal"]
    },
    "input-style": {
      "default": "pill",
      "options": ["minimal", "pill", "bordered-with-icon"]
    }
  }
}
```

#### 9.5.2 ThemeCard 组件（在 Settings 页面展示主题缩略图）

```tsx
// src/ui/components/ThemeCard.tsx

import { cn } from '@/shared/utils/cn'

interface ThemeCardProps {
  id: string
  name: string
  mode: 'dark' | 'light'
  preview: {
    bg: string
    panel: string
    accent: string
    text: string
    bubble: string
  }
  isSelected: boolean
  onSelect: (id: string) => void
}

export function ThemeCard({ id, name, mode, preview, isSelected, onSelect }: ThemeCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(id)}
      className={cn(
        'group flex flex-col items-start rounded-xl border-2 p-3 transition-all',
        isSelected
          ? 'border-accent bg-accent/5 ring-2 ring-accent/20'
          : 'border-transparent hover:border-border hover:bg-panel-2'
      )}
    >
      {/* 主题缩略图预览 */}
      <div
        className="relative mb-3 flex h-24 w-full flex-col gap-1 rounded-lg p-2.5"
        style={{ backgroundColor: preview.bg }}
      >
        {/* 模拟侧边栏 */}
        <div
          className="h-3 w-8 rounded"
          style={{ backgroundColor: preview.panel }}
        />
        {/* 模拟聊天气泡 */}
        <div
          className="mt-1 h-3 w-12 rounded"
          style={{ backgroundColor: preview.bubble }}
        />
        <div
          className="mt-auto h-2.5 w-10 rounded"
          style={{ backgroundColor: preview.accent }}
        />
      </div>

      {/* 主题名称 */}
      <div className="flex items-center gap-2">
        <span
          className="text-sm font-medium"
          style={{ color: preview.text }}
        >
          {name}
        </span>
        <span className="rounded bg-panel-2 px-1.5 py-0.5 text-[10px] text-text-muted">
          {mode === 'dark' ? '深' : '浅'}
        </span>
      </div>

      {/* 选中指示器 */}
      {isSelected && (
        <span className="mt-1 text-[11px] text-accent">当前使用中</span>
      )}
    </button>
  )
}
```

#### 9.5.3 product-config 映射代码（8 个 agent → 默认主题 ID）

```ts
// src/main/config/product-config.ts

import { ProductId } from '@/shared/constants/products'

export type ThemeId =
  | 'agent-dark'
  | 'agent-light'
  | 'code-deck'
  | 'terminal-ops'
  | 'workboard'
  | 'focus-doc'
  | 'wechat-like'
  | 'retro-desktop'

export interface ProductThemeConfig {
  defaultTheme: ThemeId
  alternateTheme: ThemeId
  eggTheme?: ThemeId
}

export const PRODUCT_THEME_MAP: Record<ProductId, ProductThemeConfig> = {
  // 编码类 → Agent Chat Dark
  'zcode': {
    defaultTheme: 'code-deck',
    alternateTheme: 'terminal-ops',
    eggTheme: 'retro-desktop',
  },
  // 编码类 → Agent Chat Dark（类 Codex 产品）
  'codex-type': {
    defaultTheme: 'agent-dark',
    alternateTheme: 'code-deck',
    eggTheme: 'terminal-ops',
  },
  // 编码 + 任务混合（QoderWork 类）
  'qoderwork_cn': {
    defaultTheme: 'code-deck',
    alternateTheme: 'workboard',
    eggTheme: 'agent-dark',
  },
  // 协作 + 文档（Traework 类）
  'traework_cn': {
    defaultTheme: 'workboard',
    alternateTheme: 'agent-light',
    eggTheme: 'focus-doc',
  },
  // 办公 + 聊天（WorkBuddy 类）
  'workbuddy': {
    defaultTheme: 'agent-light',
    alternateTheme: 'wechat-like',
    eggTheme: 'retro-desktop',
  },
  // 豆包 类 — 聊天 + 文档为主
  'doubao': {
    defaultTheme: 'focus-doc',
    alternateTheme: 'agent-light',
    eggTheme: 'wechat-like',
  },
}

/**
 * 根据产品 ID 获取主题配置（提供安全回退）
 */
export function getProductThemeConfig(productId: ProductId): ProductThemeConfig {
  return PRODUCT_THEME_MAP[productId] ?? {
    defaultTheme: 'agent-dark',
    alternateTheme: 'agent-light',
  }
}
```

```ts
// src/main/services/agent-detector.ts（新增 resolveDefaultTheme）

import { getProductThemeConfig, ThemeId } from '../config/product-config'
import { detectCurrentProduct } from './agent-detector'

/**
 * 根据当前检测到的产品线，决定默认主题。
 * 仅在用户未设置主题偏好时调用。
 */
export function resolveDefaultTheme(): ThemeId {
  const product = detectCurrentProduct()
  const config = getProductThemeConfig(product.id)
  return config.defaultTheme
}
```

#### 9.5.4 colors.json 的 Zod Schema 校验

```ts
// src/shared/schemas/theme-colors.ts

import { z } from 'zod'

const ColorValue = z.object({
  hex: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  oklch: z.string(),
})

const Radii = z.object({
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
  xl: z.string(),
})

const ShadowSet = z.object({
  sm: z.string(),
  md: z.string(),
  lg: z.string(),
})

const ModeColorSet = z.object({
  meta: z.object({
    name: z.string(),
    description: z.string().optional(),
  }),
  colors: z.object({
    bg: ColorValue,
    bgElevated: ColorValue,
    panel: ColorValue,
    panel2: ColorValue,
    border: ColorValue,
    borderStrong: ColorValue,
    text: ColorValue,
    textMuted: ColorValue,
    textFaint: ColorValue,
    accent: ColorValue,
    accentHover: ColorValue,
    accentSoft: ColorValue,
    success: ColorValue,
    warning: ColorValue,
    danger: ColorValue,
    info: ColorValue,
    codeBg: ColorValue,
    codeBorder: ColorValue,
    codeText: ColorValue,
    userBubble: ColorValue,
    assistantBubble: ColorValue,
    toolCard: ColorValue,
  }),
  radii: Radii,
  shadows: ShadowSet,
})

export const ThemeColorsSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  modes: z.object({
    dark: ModeColorSet,
    light: ModeColorSet,
  }).partial(),
})

export type ThemeColors = z.infer<typeof ThemeColorsSchema>
```

---

### 9.6 验证标准表格

每个阶段交付后，必须通过以下验证：

| 验证项 | 命令 | 期望 |
|---|---|---|
| **Phase 1 完成：colors.json 可加载** | `npx ts-node scripts/validate-theme-colors.ts themes/agent-core/colors.json` | 输出 `✓ agent-core colors.json 验证通过，共 34 个色彩 token` |
| **Phase 1 完成：无 schema 校验失败** | `npx ts-node scripts/validate-all-themes.ts` | 5 个主题包全部 ✓，0 个错误 |
| **Phase 2 完成：组件变体切换无控制台报错** | `pnpm test src/core/theme/color-loader.test.ts` | 全部单元测试通过（≥ 6 个用例） |
| **Phase 2 完成：VariantSelector 渲染正常** | 在 Theme Studio 中切换 3 种 variant 选项 | 实时预览区 CSS 变量正确更新，无闪烁 |
| **Phase 3 完成：5 个主题包 manifest 结构正确** | `npx ts-node scripts/validate-manifests.ts` | `agent-core / agent-dev / agent-work / agent-chat / agent-retro` 均 ✓ |
| **Phase 3 完成：对比度满足 WCAG AA** | `npx ts-node scripts/check-contrast.ts --min-ratio 4.5` | 所有主题正文/背景对比 ≥ 4.5:1，无违反项 |
| **Phase 4 完成：product-config 映射加载** | `pnpm test src/main/config/product-config.test.ts` | 8 个 productId 均匹配到有效 themeId |
| **Phase 4 完成：未选择主题时自动匹配默认** | 全新安装启动，检查 `localStorage.theme` | 值等于 `resolveDefaultTheme()` 返回值 |
| **全文档完成：构建无报错** | `pnpm build` | vite build 输出 ✓，electron-builder 打包成功 |
| **全文档完成：主题切换后 UI 无残留** | 切换 dark→light→dark→retro | 所有组件颜色正确更新，无残留旧主题色块 |

---

### 9.7 实施顺序建议

```
Week 1: Phase 1（JSON 化 + loader）
  ├── 周一：clone 参考项目，阅读 palette.json 结构
  ├── 周二：编写 theme-colors.ts Zod schema
  ├── 周三：生成 5 个 colors.json
  └── 周四：实现 color-loader.ts，接入 theme-catalog

Week 2: Phase 2（变体系统）
  ├── 周一：bubbles.css + sidebar.css + input.css
  ├── 周二：ComponentsTab.tsx + VariantSelector.tsx
  └── 周三：theme-bundle.ts 修改 + 用户偏好序列化

Week 3: Phase 3（4 个主题包的 CSS 文件）
  ├── agent-dev 全部 CSS
  ├── agent-work 全部 CSS
  └── agent-chat + agent-retro 全部 CSS

Week 4: Phase 4（product-config + 集成验证）
  ├── products.ts 常量定义
  ├── product-config.ts 映射
  ├── agent-detector 改造
  └── 集成测试 + 对比度检查 + 交付验收
```

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 配套文档: glass-and-theme-improvement.md*
