# AgentSkin 架构冗余 + 视觉统一 双轨只读审计报告

> **审计日期**: 2026-08-24
> **审计方式**: 8 子代理并行只读审计 × 2 轮验证深度检查
> **审计范围**: src/ 全量 + themes/ + engines/ + scripts/
> **约束**: 只读，不修改任何代码

---

## 一、审计方法论

本次审计分三批执行：

**第一批（8 子代理并行）** 覆盖 8 个审计维度：
1. useAppController 聚合审计
2. Store 边界与外观域重叠审计
3. App/Agent/Target 实体模型审计
4. 页面模板与卡片系统视觉审计
5. 按钮/徽标/状态色/表单/空状态审计
6. Overlay 层级与排版一致性审计
7. IPC/CDP 链路与死代码审计
8. Studio 窗口复杂度审计

**第二批（2 子代理并行）** 交叉验证 + 深度检查：
- 验证 agent：对 7 项关键声明逐一 grep/read 确认
- 深度 agent：覆盖 IPC 通道、Preload、主进程服务层、共享类型、Hooks、Studio 子 Store 等易遗漏区域

**第三批（人工综合）** 汇总去重、分级、排序。

---

## 二、总体判断

### 2.1 架构冗余度

> **中等偏高，但不是推倒级。**

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 路由系统 | 低冗余 | 手写 useState 路由合理 |
| 页面数量 | 低冗余 | 6 页封顶内，Studio 收为路由更优 |
| Store 数量 | 中冗余 | 15+ Store，workspaceStore 26 字段/29 action 是最大污染点 |
| useAppController | 中高冗余 | 68 字段暴露，12-15 个死字段，93% 浪费率（SettingsPage） |
| 外观状态域 | 中高冗余 | Design Language 被拆成 3 个 Store 的 4 种数据结构 |
| 实体模型 | 中高冗余 | 7 层模型表达同一概念，`Agent` 接口零引用 |
| 全局叠加层 | 中冗余 | z-index 双轨制，无统一变量系统 |
| Studio 窗口 | 高冗余 | ~10,800 行专属代码， TitleBar/StatusBar/Sidebar 全部重实现 |

### 2.2 视觉不统一度

> **偏高，是当前体验短板。**

| 维度 | 评分 | 说明 |
|------|:----:|------|
| 页面模板 | 不统一 | PageHeader 一致，Toolbar/Filter/EmptyState/LoadingState 各自为政 |
| 卡片系统 | 不统一 | 4 款卡片在 hover/选中/边框/字阶/徽标 6 个维度系统性分歧 |
| 徽标系统 | 噪音高 | 最多 5 种颜色同时出现在一张卡片上 |
| 状态色 | 不统一 | `cr-*` 与 Tailwind 原生混用，Studio ContrastBadge 完全脱离设计系统 |
| 字号 | 污染严重 | `text-xs`(12px)/`text-sm`(14px) 等 Tailwind 默认值超出 design tokens |
| 间距 | 少量违规 | `gap-[9px]`/`gap-[6px]`/`p-[10px_14px_4px]` 违反 4px 网格 |
| 空状态 | 碎片化 | 12 处空状态有 12 种实现，无统一组件 |
| 圆角/阴影 | 良好 | 基于 CSS 变量，一致性优秀 |

### 2.3 关键结论

> **AgentSkin 当前的问题不是"功能不够"，而是"架构治理和设计系统治理没跟上"。**

架构冗余不是页面太多或功能太多导致的，而是**状态域边界不够清晰 + 中间聚合层过重 + UI 模式没有收敛**造成的。

视觉不统一不是单个组件丑，而是**卡片、按钮、徽标、状态色、间距、字号、空状态没有统一约束**造成的系统感缺失。

这两个问题的根因是同一个：**缺少统一抽象层**。

---

## 三、P0 — 影响稳定性 / 安全 / 数据完整性

| # | 问题 | 文件 | 说明 |
|---|------|------|------|
| P0-1 | **`PERSIST_FAILURE_WARNING` 通道断裂** | `main-context.ts:196` → `diagnosticsStore` | 主进程推送持久化失败告警，但 preload 未暴露订阅方法，渲染进程 `persistFailures` 永远为 0。用户无法收到磁盘写失败的关键告警。 |
| P0-2 | **`AgentId` 类型双重定义** | `shared/types/agent.ts:6` vs `main/theme-asset/adapt/registry.ts:7-16` | 两个独立的 `AgentId` 类型定义无编译时约束，`check-injection-contract` 只检查前者。C1 不变量存在漂移风险。 |

---

## 四、P1 — 影响架构清晰度和可维护性

### 4.1 useAppController 过度聚合

| 问题 | 详情 |
|------|------|
| 暴露字段过多 | 68 个字段，SettingsPage 只用 5 个（浪费率 93%） |
| 死字段 | `setActiveAgentId`, `sidebarCollapsed`, `setSidebarCollapsed`, `logsOpen`, `setLogsOpen`, `booting`, `settingsOpen`, `setSettingsOpen`, `flowState`, `wallpaper.setAgentWallpaper`, `wallpaper.applyAgentWallpaper`, `wallpaper.activateThemeWallpaper` 等 12-15 个字段在现役代码中零消费 |
| 重渲染风险 | controller 对象和新创建的 `wallpaper` 子对象每次 render 都是新引用，prop drilling 导致 React 身份变化传播 |
| 缓解因素 | 内部 selector 都是单字段订阅（zustand 层面 OK）；WorkspacePage/AppsPage 已改用细粒度 store 直连，证明架构在演进 |

**修正**：验证发现死字段数字略夸大（子代理报 18-21 个，实际 12-15 个），但核心判断成立。

### 4.2 workspaceStore 概念污染

| 问题 | 详情 |
|------|------|
| 规模 | 26 数据字段 + 29 action = 项目中最大的单一 Store |
| 概念混杂 | Studio 布局状态（viewMode/dock/inspector/drawer）+ Tweak 实时编辑 + Raw CSS 编辑器 + Undo/Redo + 命名预设 = 5 个独立关注点 |
| 废弃字段 | `viewMode` 注释写 "Always 'single'" — 已废弃的多窗口模式遗留 |

### 4.3 Design Language 三头马车

同一概念（圆角/间距/动效）被拆成 3 个 Store 的 4 种数据结构：

| 存储位置 | 数据结构 | 持久化方式 |
|----------|----------|-----------|
| `themeStore.designLanguage` | `DesignLanguageConfig` | manifest |
| `settingsStore.radiusScale/density/motion` | `RadiusScale/Density/Motion` | localStorage |
| `workspaceStore.currentOverrides` | `ToolOverride` | CDP WebSocket |

三套消费路径各自独立，没有统一契约。

### 4.4 Status 三域割裂

| 存储位置 | 语义 |
|----------|------|
| `statusStore.status` | 权威 SystemStatus（IPC polled） |
| `agentStore.agents[].status` | 启动回退用静态快照（仅 boot 一次） |
| `appsStore.runningApps` | coordinator push 维护的运行时 Map |

`agentStore` 已桥接到 `statusStore`（通过 `appStatusFor`），但 `appsStore.runningApps` 完全独立维护与 `status.apps` 相同的信息。

### 4.5 实体模型冗余

| 冗余 | 详情 |
|------|------|
| `Agent` 接口 | `agent.ts:228` — 零引用死代码，验证确认 |
| `AgentCatalogStatus` | 4 字段被 `AppStatus` 完全包含，两者独立更新 |
| `APP_META` 镜像 | `app-mark.tsx:16` 与 `AGENT_META` 平行映射 |
| `EnvironmentModel` | `agentRunning/agentInstalled/detectedVersion/detectedPath` 可从 `AppStatus` 完全派生 |

### 4.6 死代码

| 类型 | 具体项 |
|------|--------|
| 归档页面 | `archive/AgentDashboardPage.tsx`, `archive/AgentsPage.tsx`, `archive/UnifiedWorkspacePage.tsx` — 验证零 import |
| 死翻译键 | ~30 个 `uiMessages` 键零消费（`emptyInstalledTitle`, `cdpPortLabel`, `dashboardWelcome` 系列, `quickGuide` 系列, `agentsPageTitle` 系列等） |
| 死 Hooks | `useCommandPalette`（仅 INDEX.md 引用）、`useWallpaperActions`（文件自认死代码且与 `useWallpaperPageController` 重复）、`useEnvironments`（仅被归档页面引用） |
| 孤儿 Preload | `onCssEvents` — preload 暴露、主进程推送、但渲染进程零消费 |
| 孤儿测试 | `css-ipc.test.ts` — 对应源文件不存在 |
| Studio 死方法 | `bumpDomTreeVersion`、`setProjects`、`createEmpty` — 定义但从未调用 |

---

## 五、P2 — 影响视觉统一和体验

### 5.1 页面模板不一致

| 附属结构 | ThemesPage | WallpaperEnginePage | AppsPage | SettingsPage | WorkspacePage |
|----------|:----------:|:-------------------:|:--------:|:------------:|:-------------:|
| Toolbar | 内联在 PageHeader | 独立 Toolbar 组件 | 按钮内联在 Header | 无 | 无 |
| Filter | FilterChips + toggle | FilterChips + search input + select | FilterChips | Section rail | 无 |
| EmptyState | 图标 + 双行文字 | 整页替换 | 纯文字 | 仅日志区 | 无 |

5 页有 5 种 Toolbar 策略、5 种 EmptyState 实现。

### 5.2 卡片系统分歧

| 属性 | AppCard | ThemeCard | WallpaperCard | EnvironmentCard |
|------|:-------:|:---------:|:-------------:|:---------------:|
| 圆角 | `--radius-md` ✓ | `--radius-md` ✓ | `--radius-md` ✓ | `--radius-md` ✓ |
| 边框策略 | ghost 无框 | border-transparent → solid | 无 → border | 无 → border-2 |
| hover 行为 | bg 变色 | 上浮 + 阴影加粗 | 几乎不可见 | **完全缺失** |
| 选中态语义 | `ring-success` (运行态) | `ring-primary ring-1` | `ring-primary ring-1` | `border-2` |
| 标题字号 | 14px (`text-body`) | 13px | 13px | 14px (`text-sm`) |
| 徽标位置 | 1 个 StatusDot | 4 个徽标位 | 3 个徽标位 | 右上角 + 底部 |
| 骨架屏圆角 | `--radius-md` ✓ | — | `rounded-lg` 不匹配 | — |

**核心问题**：圆角虽然是统一的 `--radius-md`，但 AppsPage 骨架屏用 `rounded-lg`（不匹配），且 hover/选中/边框/标题字阶/徽标各自为政。`EnvironmentCard.statusAccent` 返回空对象导致 hover 完全无视觉反馈。

### 5.3 徽标颜色过多

同一张 WallpaperCard 上最多出现 5 种徽标色（primary/info/success/warning/muted）。ThemeCard 最多 4 个徽标位。所有卡片徽标位置不统一（左上、右上、右下、底部）。

### 5.4 状态色混用

| 语义 | 混用情况 |
|------|----------|
| Success | `cr-success` vs `success`（Tailwind 原生）— 不同色值 |
| Warning | `cr-warning` vs `yellow-950` |
| 对比度通过 | Studio: `green-500` 硬编码；其他: `cr-success` |
| 对比度失败 | Studio: `red-500` 硬编码；其他: `destructive` |

**Studio ContrastBadge 完全脱离设计系统**，不支持主题切换。

### 5.5 表单控件不一致

| 问题 | 详情 |
|------|------|
| Studio Toolbox | SliderRow/SelectRow/TextRow/ToggleRow 全部自研，未复用 UI 组件库的 Input/Select/Switch |
| RenderSettingsPanel | 原生 `<input type="range">` 和 `<select>`，与 SettingsPage 的表单风格不一致 |
| SelectTrigger 高度 | default 模式 36px 与 Input 24px 不匹配，SettingsPage 被迫用 `className="h-6"` 覆盖 |
| Textarea 字号 | `text-base`(16px)，其他表单控件都是 10px |

### 5.6 z-index 双轨制

| 窗口 | z-index 系统 | 层级值 |
|------|-------------|--------|
| 主窗口 | Tailwind 硬编码 | z-0, z-10, z-20, z-50, z-[90], z-[100], z-[110] |
| Studio | CSS 变量 | --z-stage:1, --z-toolbar:50, --z-dock:100, --z-topbar:110, --z-status:120, --z-dialog:200 |

两套系统在 z-50 和 z-100-110 区间语义重叠。虽然不同时渲染不冲突，但维护时容易混淆。

---

## 六、P3 — 低优先级打磨项

| # | 问题 | 说明 |
|---|------|------|
| P3-1 | `gap-[9px]`/`gap-[6px]` 间距违规 | RenderSettingsPanel 和 StudioDrawer 中有非 4 倍数间距 |
| P3-2 | `rounded-[4px]` 硬编码 | checkbox 中使用，但 shadcn/ui 标准样式可接受 |
| P3-3 | `LandmarkSnapshot` 类型别名重复导出 | ipc.ts 和 snapshot-theme.ts 各导出一份 |
| P3-4 | `dualPreviewActive` 未被显式重置 | workspaceStore 中该字段只在 compare 预设时设为 true，无清除逻辑 |
| P3-5 | `agentStore.loaded` | 标记加载完成，但 agents 有同步回退值，UI 不依赖此字段 |
| P3-6 | `appsStore.drawerAppId` | 纯局部 UI 状态不应在全局 Store 中 |
| P3-7 | `settingsStore.mcpRunning/mcpUrl` | MCP HTTP 服务器状态属于基础设施域，与外观/设置概念无关 |

---

## 七、Studio 窗口专题

> Studio 是本次审计发现冗余最集中的单一模块。

### 7.1 规模

| 指标 | 数值 |
|------|------|
| 专属代码行数 | ~10,800 行（组件 7,054 + Store 1,792 + IPC 978 + 窗口状态 248 + facade 571） |
| 组件数 | 37 个 TSX 文件 |
| 子 Store | 4 个（project/bundle/capture/image-wallpaper）+ 1 个 571 行 facade |
| 专属 IPC 通道 | 24 个 |
| 最大组件 | Toolbox.tsx (906 行) |

### 7.2 与主窗口重复

| 功能 | 主窗口实现 | Studio 实现 | 重复程度 |
|------|-----------|-------------|----------|
| TitleBar | title-bar.tsx (164 行) | StudioTitleBar (116 行) | 结构/行为重复 |
| StatusBar | status-bar.tsx (96 行) | StudioStatusBar (26 行) | 部分重复 |
| Sidebar/Drawer | sidebar.tsx (67 行) | StudioDrawer (487 行) | Studio 重新实现了 Project 列表 + Resources + Agent 安全态势 |
| Bootstrap | renderer.tsx (30 行) | studio.tsx (36 行) | 近乎相同 |
| 窗口状态持久化 | 无 | studio-window-state.ts (248 行) | Studio 独有 |

### 7.3 Facade 复杂度

`useStudioStore` 571 行的 facade 中有约 150 行 switch 逻辑用于 `getState()`/`setState()` 手动 key 路由，以及模块作用域变量（`_analysisProgress`、`_healthReportByAgent`）不走 zustand 订阅。

### 7.4 子 Store 健康度

4 个子 Store 之间**无循环依赖**（DAG 结构正确），facade 路由字段完整。主要问题是 facade 层过厚和模块级变量绕过了响应式系统。

---

## 八、视觉风格方向建议

AgentSkin 应走 **专业工具型 / 控制中心** 路线：

| 原则 | 当前状态 | 目标状态 |
|------|----------|----------|
| 少颜色 | 5 种徽标色同卡出现 | 状态色只在必要时出现 |
| 弱边框 | 边框策略已初步统一 | 统一 `--card-border` token |
| 小圆角 | 已基于 CSS 变量 | 保持现状 |
| 低阴影 | 已克制 | 保持现状 |
| 统一间距 | 80% 合规 | 100% 4px 网格 |
| 统一字号 | `text-xs`/`text-sm` 大量使用 | 严格 6 档：10/11/13/16/20/22px |
| 明确层级 | 字号层级部分失控 | 页面标题 > 区块标题 > 正文 > 辅助 |
| 动效克制 | 已有 `--duration-multiplier` | 保持现状 |

---

## 九、后续治理路线图

### Phase A: 清理死代码（1-2 天，零风险）

1. 删除 3 个归档页面（`archive/*.tsx`）
2. 清理 ~30 个死翻译键
3. 删除 3 个死 Hooks（`useCommandPalette`/`useWallpaperActions`/`useEnvironments`）
4. 删除 `Agent` 零引用接口
5. 删除 `onCssEvents` 孤儿 preload 和主进程推送
6. 删除 `bumpDomTreeVersion`/`setProjects`/`createEmpty` 未调用方法
7. 删除 `css-ipc.test.ts` 孤儿测试
8. 清理 `useAppController` 12-15 个死字段

### Phase B: IPC 通道修复（半天，低风险）

1. 修复 `PERSIST_FAILURE_WARNING` 通道：在 preload 和 AgentSkinApi 中添加 `onPersistFailureWarning`
2. 统一 `AgentId` 类型：`registry.ts` 改用 `import type { AgentId } from '@shared/types/agent'`

### Phase C: 视觉统一（3-5 天，中等风险）

1. 创建 `<EmptyState>` 共享组件，统一 12 处空状态
2. 统一状态色：废弃 `bg-success`/`text-success` 原生 Tailwind，全部迁移至 `cr-*` CSS 变量
3. Studio ContrastBadge 从 `green-500`/`red-500` 硬编码改为 `cr-success`/`destructive`
4. 修复 `text-xs`/`text-xs` 字号污染：替换为 design tokens 档位
5. 修复间距违规：`gap-[9px]` → `gap-2`，`p-[10px_14px_4px]` → `p-[12px_16px_4px]`
6. 修复 AppsPage 骨架屏圆角：`rounded-lg` → `rounded-[var(--radius-md)]`
7. 修复 EnvironmentCard `statusAccent` 空对象：补上 hover 视觉规则
8. 修复 AppCard `hover:bg-muted hover:bg-accent` 冗余声明
9. 建立 z-index 变量系统：统一主窗口和 Studio 的层级语义
10. 统一卡片标题字阶：`text-body`/`text-sm`(14px) → `text-[13px]`

### Phase D: 架构瘦身（1-2 周，较高风险）

1. 拆分 workspaceStore：
   - Studio 布局字段 → `studioLayoutStore`
   - Tweak 实时编辑 → `tweakStore`
   - Raw CSS 编辑 → `rawCssStore`
2. 统一 Design Language：合并 `themeStore.designLanguage` + `settingsStore.radiusScale/density/motion` + `workspaceStore.currentOverrides` 为单一 `DesignLanguageConfig`
3. 降级 environmentStore：3 字段 Facade 移入 themeStore 或模块级状态
4. 统一实体模型：删除 `AgentCatalogStatus`（合并入 `AppStatus`），消除 `APP_META` 镜像
5. 拆分 useAppController：按页面/功能域拆分为 4-5 个 domain hooks
6. `appsStore.runningApps` 改为从 `statusStore` 派生

### Phase E: Studio 治理（1-2 周，较高风险）

1. 删除 facade `useStudioStore`，让组件直接消费 4 个子 Store
2. 将 `_analysisProgress`/`_healthReportByAgent` 提升为真正 zustand store
3. 合并重复的 bundle IPC 通道
4. 评估 Studio 是否可收为主窗口 `/studio` 路由（预计减少 1,500-2,000 行）

---

## 十、不应做的事

| 禁止项 | 原因 |
|--------|------|
| 不要马上全面重构 | 问题还没完全摸清，大重构会把已有能力一起打碎 |
| 不要马上全局"美化" | 没有规范的美化只会让不统一更严重 |
| 不要引入 CommandPalette | 已有 `useCommandPalette` 死代码，不解决核心问题 |
| 不要新建 UI 框架 | (shadcn/ui + Tailwind 已足够，问题是执行层面而非框架层面) |
| 不要在 workspaceStore 上继续加字段 | 应该先拆分再扩展 |

---

## 十一、审计可信度声明

### 评分修正

8 份子代理报告经交叉验证后，整体可信度 **7.5/10**：

| 子代理声明 | 验证结果 |
|------------|----------|
| Agent 接口零引用 | ✅ 确认 |
| useAppController 18-21 死字段 | ⚠️ 实际 12-15 个（夸大 30%） |
| workspaceStore 30 字段 | ✅ 确认（26 字段 + 29 action） |
| Studio facade 571 行 | ⚠️ 实际 572 行（差 1 行） |
| 死翻译键 ~30 个 | ✅ 抽查 5/5 确认死键 |
| 归档页面零引用 | ✅ 确认 |
| gap-[9px] 违规 | ✅ 确认 |

### 审计盲区（本次未能深度覆盖）

1. Studio 37 个组件的具体视觉一致性（数量太大，只审计了 Toolbox/StudioTopBar/InspectorProfile）
2. 动画过渡一致性（动效时长、easing 函数是否有统一系统）
3. 暗黑模式下的视觉一致性（未做 dark mode 专项对比）
4. i18n 翻译完整性（英文 `en-US` 字典未审计，只查了 `zh-CN`）
5. 无障碍（a11y）合规性（aria 标签、键盘导航、屏幕阅读器支持未审计）

---

## 十二、一句话总结

> AgentSkin 的架构问题和视觉问题是同一个根因的两个症状：缺少统一抽象层。架构上需要建立清晰的域模型（Catalog/Runtime/Appearance/Injection/Shell）和统一 Design Language 契约；视觉上需要建立卡片、按钮、徽标、状态色、空状态的共享组件库和强制约束。治理顺序应该是：先清死代码（Phase A）→ 修复断裂通道（Phase B）→ 统一视觉基础件（Phase C）→ 拆分 God Store（Phase D）→ 治理 Studio（Phase E）。不要跳步，不要在 Phase A 完成前做 Phase D。
