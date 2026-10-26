# ui — 渲染进程

## 用途
Electron 渲染进程的 React 应用层，包含全部 Zustand Store、页面组件、领域组件、基础 UI 组件库、设计系统与全局样式。

## 结构

### 根目录（应用入口）

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `App.tsx` | 应用根组件：路由决策、全局 Provider 挂载、错误边界、Toast 堆叠、动态背景、侧边栏/标题栏布局、密度/运动偏好映射 | 无（顶层入口） | `DialogsHost`, `DynamicBackground`, `ErrorBoundary`, `InjectDock`, `PageSkeleton`, `sidebar/*`, `TitleBar`, `useAppController`, `useNotificationStore`, `useSettingsStore` | — |
| `StudioApp.tsx` | Studio 模式入口（独立窗口）：无侧边栏/壁纸背景，自定义标题栏，订阅 STATUS_CHANGED 推送 | 无（独立窗口入口） | `ErrorBoundary`, `StudioPage`, `useShellStore`, `useStatusStore`, `useStudioStore`, `studio/sync-hooks` | — |
| `colors.ts` | 颜色 token 设计契约——JS 内联样式互操作（canvas/chart），镜像 `globals.css` 中声明的 CSS 变量（导出 `var()` 引用而非 hex） | ⚠️ 当前零引用（契约文件，供新组件接入时优先使用） | 无（纯常量导出） | `docs/design-tokens.md` |
| `globals.css` | 全局 CSS 变量（5 级背景深度、品牌色、阴影、z-index 比例、排版阶梯）、Tailwind v4 `@theme inline` 映射、基础 Reset、滚动条、页面过渡动画、粒子系统 keyframes | 所有组件（全局生效） | `tailwindcss`, `tw-animate-css`, `shadcn-tailwind.css` | `docs/design-tokens.md` |
| `shadcn-tailwind.css` | shadcn/ui 兼容层样式（accordion 动画等） | 所有组件（全局生效） | 无（CSS 文件） | — |

### 子目录概览

| 路径 | 用途 | 文件数（非测试） |
|------|------|--------|
| `components/` 根 | 独立组件（AppMark, CommandPalette, DetailPanel, DialogsHost, DynamicBackground, ErrorBanner, ErrorBoundary, InjectDock, InstallProgress, Logo, PageSkeleton, PetViewer, RenameDialog, TitleBar） | 14 |
| `components/sidebar/` | 侧边栏套件（Provider/Content/Rail/Menu/MenuItem/MenuSub/Tooltip/sidebarSurface/index） | 9 |
| `components/quick-apply/` | 图片→主题快速应用面板（QuickApplyPanel + index） | 2 |
| `components/ui/` | 基础 UI 组件库（shadcn 风格） | 42 |
| `components/studio/` | Studio 创作模式专用组件（含 center/ 子目录） | 40 |
| `components/themes/` | 主题展示组件（卡片、预览、虚拟网格、社区、作者面板、源详情） | 11 |
| `components/wallpaper/` | 壁纸组件（卡片、网格、裁剪、渲染设置、注入结果） | 6 |
| `components/workspace/` | 工作台组件（环境卡片、详情 sheet、状态组件、调整面板） | 9 |
| `components/apps/` | 应用管理组件（AppCard, AppDetailsDrawer） | 2 |
| `components/diagnostics/` | 诊断面板组件（CDP 性能、漂移、选择器、可视化分析） | 6 |
| `components/settings/` | 设置页组件（Dashboard, MarkdownStyleSettings） | 2 |
| `hooks/` | 自定义 React Hook | 17 |
| `lib/` | 业务工具函数（调色板、壁纸渲染、DOM 导出、哈希等） | 10 |
| `pages/` | 页面级路由组件（含 wallpaper/ 子目录与 CommunityPage） | 8 |
| `stores/` | Zustand Store（25 个模块，含 test-helpers/ 8 个） | 33 |
| `studio/` | Studio 子 Store（project/bundle/capture/image-wallpaper/sync） | 8 |
| `types/` | UI 局部类型定义 | 7 |
| `utils/` | UI 工具（色彩理论、渲染日志、占位计数） | 4 |
| `design/` | 主题模式定义（theme-mode；colors.ts 契约文件位于 src/ui/colors.ts） | 1 |
| `api/` | 渲染进程 API 客户端 | 2 |
| `storage/` | 持久化存储（环境预设 store） | 1 |
| `styles/` | 页面级样式（workspace.css 及 workspace/ 子模块） | 3 |
| `assets/` | 静态资源（应用图标 PNG） | 6 |

### 基础 UI 组件（components/ui/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `accordion.tsx` | 手风琴折叠面板（radix-ui 封装） | `StudioDrawer`, `ResourcesSection`, `InspectorProfile` | `radix-ui` |
| `avatar.tsx` | 用户头像（radix-ui 封装） | `EnvironmentCard` | `radix-ui` |
| `badge.tsx` | 徽章/标签（CVA 变体：default/primary/outline/secondary/destructive） | `AppCard`, `ThemeCard`, `CommunityThemeCard`, `StudioTopBar` | `cn` |
| `button.tsx` | 按钮（CVA 变体：default/primary/outline/secondary/ghost/destructive/link） | 全局 50+ 组件 | `cn`, `Spinner` |
| `checkbox.tsx` | 复选框（radix-ui 封装） | `SettingsDashboard`, `CenterTabThemeEditor` | `radix-ui` |
| `close-button.tsx` | 图标关闭按钮（accessible aria-label 内置） | `Dialog`, `Sheet`, `ErrorBanner`, `AppCard` | `cn` |
| `collapsible.tsx` | 可折叠面板（radix-ui 封装） | `TweakPanel`, `SettingsDashboard` | `radix-ui` |
| `command.tsx` | 命令面板（Dialog + 搜索过滤，base-ui 封装） | `CommandPalette` | `Dialog`, `cn` |
| `date-picker.tsx` | 日期选择器（react-day-picker + Popover） | 待补充 | `Popover`, `Button`, `useShellStore` |
| `dialog.tsx` | 对话框（base-ui 封装，含 Portal/Overlay/Content/Header/Footer） | `DetailPanel`, `DialogsHost`, `RenameDialog`, `CommandPalette` | `base-ui`, `CloseButton` |
| `dropdown-menu.tsx` | 下拉菜单（base-ui Menu 封装） | `EnvironmentCard`, `QuickActionsCard`, `AppCard` | `base-ui` |
| `empty-state.tsx` | 统一空状态占位（图标 + 标题 + 提示 + 操作按钮） | `CommunityTabPanel`, `SelectorProbePanel`, `VisualAnalysisPanel`, `CenterTabBundle` | `cn` |
| `filter-chips.tsx` | 过滤芯片（多选/单选 chip 组） | `ThemesPage`, `WallpaperEnginePage` | `cn` |
| `huge-icon.tsx` | 大尺寸图标（SVG 包裹器） | `EmptyState` | `cn` |
| `input-group.tsx` | 输入框组（前缀/后缀/按钮组合） | `PageToolbar`, `CommandPalette`, `SelectorProbePanel` | `Input`, `Button`, `cn` |
| `input.tsx` | 文本输入框（base-ui 封装） | 全局 30+ 组件 | `base-ui` |
| `navigation-menu.tsx` | 导航菜单（radix-ui 封装） | 待补充 | `radix-ui` |
| `page-header.tsx` | 页面标题头（标题 + 描述 + 计数 + 操作区） | `ThemesPage`, `WallpaperEnginePage`, `SettingsPage` | `cn` |
| `page-toolbar.tsx` | 页面工具栏（搜索 + 过滤 + 排序 + 操作） | `ThemesPage`, `WallpaperEnginePage` | `InputGroup`, `Select`, `cn` |
| `pagination.tsx` | 分页导航 | 待补充 | `buttonVariants`, `cn` |
| `popover.tsx` | 弹出层（radix-ui 封装） | `DatePicker`, `StudioTopBar` | `radix-ui` |
| `progress.tsx` | 进度条（确定/不确定模式） | `InstallProgress`, `DownloadProgress`, `AgentStatusBar`, `VisualAnalysisPanel` | `cn` |
| `resizable.tsx` | 可调整尺寸面板（react-resizable-panels 封装） | `StudioStage`, `WorkspacePage` | `react-resizable-panels` |
| `scroll-area.tsx` | 滚动区域（radix-ui 封装） | `ThemesPage`, `WallpaperEnginePage`, `StudioDrawer` | `radix-ui` |
| `section-label.tsx` | 分区标签（标签 + 计数 + 操作按钮） | `StudioDrawer`, `DockTabExport`, `LedgerPanel` | `cn` |
| `segmented-control.tsx` | 分段控制器（统一实现，替换 5 个手写变体） | `CommunityTabPanel`, `StudioTopBar`, `TitleBar` | `cn` |
| `select.tsx` | 选择器（radix-ui 封装） | `TweakPanel`, `PageToolbar`, `CenterTabRaw` | `radix-ui` |
| `separator.tsx` | 分隔线（base-ui 封装） | `TitleBar`, `StudioTopBar`, `Sidebar` | `base-ui` |
| `skeleton.tsx` | 骨架屏原子组件（Skeleton / SkeletonCard / SkeletonListRow / SkeletonStat） | `PageSkeleton` | `cn` |
| `SkeletonProvider.tsx` | 声明式骨架屏容器（config-driven，grid/list 自适应） | `App`, `ThemesPage`, `AppsPage`, `WorkspacePage`, `SettingsPage`, `WallpaperEnginePage` | `cn` |
| `SkeletonTransition.tsx` | 骨架屏过渡（骨架 ↔ 真实内容切换动画，保留为底层原语） | 无（底层原语） | `cn` |
| `sonner.tsx` | Toast 通知（sonner 封装，主题感知） | `DialogsHost` | `sonner` |
| `spinner.tsx` | 加载旋转器（Loader2 图标 + 可选标签） | `AppCard`, `DetailPanel`, `InstallProgress`, `SelectorProbePanel` | `useShellStore` |
| `switch.tsx` | 开关（radix-ui 封装，size 变体） | `RenderSettingsPanel`, `SettingsDashboard`, `MarkdownStyleSettings` | `radix-ui` |
| `table.tsx` | 表格（容器 + table + thead/tbody/tr/td） | `PerformancePanel`, `LedgerPanel` | `cn` |
| `tabs.tsx` | 标签页（radix-ui 封装） | `StudioInspector`, `CenterStageTab`, `CommunityTabPanel` | `radix-ui` |
| `textarea.tsx` | 多行文本输入 | `SelectorProbePanel`, `CenterTabRaw`, `MarkdownStyleSettings` | `cn` |
| `toggle-group.tsx` | 切换按钮组（radix-ui 封装） | `CenterTabThemeEditor`, `ExtendedColorsEditor` | `toggle`, `radix-ui` |
| `toggle.tsx` | 切换按钮（CVA 变体） | `ToggleGroup`, `FilterChips` | `radix-ui` |
| `token-swatch.tsx` | 色板色块（名称 + 值 + 点击复制） | `ThemePreview`, `CenterTabThemeEditor`, `ExtendedColorsEditor` | `cn` |
| `tooltip.tsx` | 工具提示（radix-ui 封装） | `TitleBar`, `StudioTopBar`, `AppCard` | `radix-ui` |

### 根目录独立组件（components/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `AppMark.tsx` | 应用图标标记（6 款 Agent 图标注册表 + 渲染组件） | `AppCard`, `DetailPanel`, `AgentStatusBar`, `InjectResultsPanel` | `assets/apps/*.png`, `AGENT_META` |
| `CommandPalette.tsx` | 全局 Cmd+K 命令面板（导航/主题/操作三组命令） | `TitleBar` | `command`, `useAppController`, `design/theme-mode` |
| `DetailPanel.tsx` | 右侧详情侧栏（已安装主题操作：应用/分享/删除/重启提示） | `ThemesPage` | `AppMark`, `Button`, `Dialog`, `Spinner`, `useAppController` |
| `DialogsHost.tsx` | 全局对话框宿主（渲染 dialogStore 队列 + Toast 通知） | `App.tsx` | `sonner`, `useDialogStore`, `useNotificationStore` |
| `DynamicBackground.tsx` | 动态壁纸背景（全屏壁纸 + 色调遮罩 + 粒子叠加 + 视差） | `App.tsx` | `wallpaperRender`, `wallpaperVideo`, `useShellStore`, `ParticleOverlay` |
| `ErrorBanner.tsx` | 瞬态操作错误横幅（push/import/scan 失败） | `WorkspacePage`, `EnvironmentGrid`, `ThemesPage` | `Button`, `CloseButton` |
| `ErrorBoundary.tsx` | 类组件错误边界（inline/compact 模式，支持重置） | `App.tsx`, `StudioApp.tsx`, `StudioPage` | `Button`, `renderer-log` |
| `InjectDock.tsx` | 浮动底部胶囊（注入状态 + 快速操作：恢复全部） | `App.tsx` | `Button`, `useAppController` |
| `InstallProgress.tsx` | 安装流程进度条（步骤列表 + 耗时 + 状态图标） | `App.tsx`（lazy InstallWizard） | `Progress`, `installFlowStore` |
| `Logo.tsx` | AgentSkin 品牌标记（color/mono 双变体 SVG） | `TitleBar`, `Sidebar`, `StudioTitleBar` | `cn` |
| `PageSkeleton.tsx` | 通用页面骨架屏（header + toolbar + card grid，用于 Suspense 默认 fallback） | `App` | `Skeleton` |
| `PetViewer.tsx` | 桌面宠物查看器（精灵图动画 + 拖拽移动 + 右键菜单，运行在独立 `pet.html` 渲染窗口） | 暂无（`pet.html` 挂载点，主窗口零接线） | `petStore`, `@shared/types/pet` |
| `RenameDialog.tsx` | 重命名对话框（输入 + 确认/取消） | `EnvironmentCard`, `StudioDrawer` | `cn` |
| `quick-apply/` | 图片→主题快速应用面板（idle→pending→progress→done/error 状态机：拖放/粘贴/选择图片 → IPC 流水线 → 结果+撤销） | 暂无（仅渲染测试引用，零页面接线） | `useNotificationStore`, `@shared/types/ipc` |
| `sidebar/` | 侧边栏套件：`SidebarProvider`（Context + 折叠态；`collapsed` 描述**挂载分支**而非 store 目标——App 通过 `presentation` prop 注入暂存态）→ `SidebarRail`（56px 折叠栏：头部为单一**常驻**展开按钮（`SIDEBAR_HEADER_BUTTON_CLASS`，32px 热区，从挂载起始终可点——v2.11 恢复 logo 默认可见：按钮视觉层 logo ↔ `PanelLeftOpen` 在 hover/键盘聚焦时交叉淡变，热区恒定、目标永不消失，点 logo 同样可展开））/ `SidebarContent`（192px 展开体：品牌头（字标，不含版本号——版本信息归 Settings）+ 常驻收起按钮）+ `SidebarMenu`（scroll-fade-y 滚动渐隐 + 品牌色滚动条 + 底部 hairline）/`SidebarMenuItem`（hover 3px Spring 位移、motion-safe 降级、激活态图标品牌着色 + 渐变品牌线 + `as-brand-line-in` 入场动画）/`SidebarMenuSub`（子导航 guide rail 品牌指示线 + hover 位移对齐 + 挂载渐显）+ `SidebarTooltip`（Portal 化，根治横向溢出滚动条）。页头属侧栏本体（`sidebarHeaderClass()`：h-12 品牌头、透明浮于一画布表面；`.as-sidebar-header` 拖拽区，按钮 no-drag opt-out），不属于标题层——标题层无任何视觉，仅为主列 36px 透明拖拽条 + 右端悬浮控件。**两段式收起动画契约**（App 持有暂排）：分支各自钉住目标宽度（`SIDEBAR_EXPANDED_WIDTH`/`SIDEBAR_COLLAPSED_WIDTH`，`--sidebar-width` 同源），列宽过渡时 `overflow-hidden` 裁切固定宽内容（无回流）——收起先滑出旧体、过渡结束再换入 Rail（`useLayoutEffect` 保证展开换装先于绘制），分隔线（`border-r`）由 App 列容器持有、全程贴边；分支入场统一 `as-fade-in` 于根节点。`sidebarSurface.ts` 为共享表面 chrome（壳层 `select-none`；一画布模型：常态表面 = 页面 `--background`，壁纸模式透明让壁纸透出；v2.10 起 hover-reveal 机制（`.sidebar-reveal` 规则 + `group/sidebar` 标记）已删除——折叠/展开按钮常驻，`size-7` 升 `size-8`；v2.11 折叠态按钮内改为 logo ↔ 展开箭头视觉交叉淡变（按钮本体仍常驻））+ `bindSidebarSubTokens()`（`--ag-sidebar-*` 子 token 桥，全部由 `--sidebar-*` color-mix 派生，hover 分档 8%/常态 5%）；运行态条已移出侧边栏 | `App.tsx` | `Logo`, `useShellStore` |
| `TitleBar.tsx` | 自定义无边框标题栏（36px 透明拖拽 chrome——无背景无边框，浮于整窗画布/壁纸上，与侧栏页头拼成横贯全窗的连续拖拽带；主题切换 + 窗口控件悬浮其上；品牌/页面文字已移除——侧边栏页头已承载品牌，社区路由下旧面包屑会渲染「AgentSkin \| AgentSkin」病态重复） | `App.tsx` | `Logo`, `useShellStore`, `useStatusStore` |

### 诊断面板组件（components/diagnostics/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `CdpPerformancePanel.tsx` | CDP 实时性能 HUD（连接数/P99 延迟/注入吞吐/内存趋势） | `SettingsPage` | `useDiagnosticsStore` |
| `DriftStatusPanel.tsx` | P3 自愈漂移检测状态（per-agent 漂移分数/信号/自愈触发） | `SettingsPage` | `useDiagnosticsStore`, `AppMark`, `api` |
| `PerformancePanel.tsx` | 性能日志只读视图（总 apply 数/平均耗时/最近 apply 表） | `SettingsPage` | `useDiagnosticsStore`, `api`, `APP_META` |
| `SecondaryInjectTrace.tsx` | 二次注入（webview/iframe）进度追踪（per-agent 步骤时间线） | `SettingsPage` | `useSecondaryInjectStore`, `AppMark` |
| `SelectorProbePanel.tsx` | CSS 选择器探测与验证（单选择器探测 + 批量验证） | `SettingsPage` | `useSelectorStore`, `Button`, `Input`, `Textarea` |
| `VisualAnalysisPanel.tsx` | 可视化分析面板（目标列表/摘要/检测/导出/进度） | `SettingsPage` | `useVisualAnalysisStore`, `useVisualAnalysisSync` |

### 主题展示组件（components/themes/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `CommunityTabPanel.tsx` | 社区主题浏览器（搜索/排序/卡片网格/加载更多） | `ThemesPage` | `CommunityThemeCard`, `ThemeDetailPanel`, `useCommunityStore` |
| `CommunityThemeCard.tsx` | 社区主题单卡（预览/元数据/标签/安装操作） | `CommunityTabPanel` | `Badge`, `Button`, `DownloadProgress` |
| `DownloadProgress.tsx` | 社区主题下载进度条（进度/字节/阶段图标） | `CommunityThemeCard` | `Progress` |
| `ThemeCard.tsx` | 主题单卡（预览/选择/应用状态/预览对话框） | `VirtualThemeGrid` | `AppMark`, `Badge`, `Button`, `Dialog`, `ThemePreview` |
| `ThemeDetailPanel.tsx` | 社区主题详情侧栏（预览/元数据/色板/描述/安装） | `CommunityTabPanel` | `Button`, `useShellStore` |
| `ThemePreview.tsx` | 主题预览面板（14-token 色板 + 模拟 UI mock） | `ThemeCard` | `ThemeCenterCardModel` |
| `VirtualThemeGrid.tsx` | 虚拟化主题网格（窗口化渲染，响应式列数） | `ThemesPage` | `ThemeCard` |

### 壁纸组件（components/wallpaper/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `ImageCropDialog.tsx` | 图片裁剪对话框（拖拽定位 + 缩放 + 固定宽高比） | `StudioImageToThemePanel` | 无（纯 Canvas API） |
| `InjectResultsPanel.tsx` | 壁纸注入结果侧栏（预览 + 元数据 + agent 注入列表 + 渲染设置） | `WallpaperEnginePage` | `AppMark`, `Accordion`, `AgentStatusDot`, `RenderSettingsPanel` |
| `ParticleOverlay.tsx` | CSS 动画粒子层（雨/雪/心/星/叶，尊重 prefers-reduced-motion） | `DynamicBackground` | 无（纯 CSS 动画） |
| `RenderSettingsPanel.tsx` | 壁纸渲染设置面板（对齐/翻转/滤镜/视差/速度/循环） | `InjectResultsPanel` | `Switch` |
| `WallpaperCard.tsx` | 壁纸单卡（视频/GIF/图片预览 + 选择 + 删除） | `WallpaperGrid` | `Spinner`, `wallpaperVideo`, `wallpaperUtils` |
| `WallpaperGrid.tsx` | 壁纸网格列表（纯呈现，props 注入） | `WallpaperEnginePage` | `WallpaperCard`, `wallpaperUtils` |

### 工作台组件（components/workspace/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `AgentDetailSheet.tsx` | 环境详情 Sheet（主题信息 + 应用操作） | `EnvironmentCard` | `AppMark`, `Button`, `Sheet`, `AgentStatusDot` |
| `AgentLivePreview.tsx` | 实时预览表面（获取 agent 原生 DOM 快照 + 覆盖层实时预览） | `WorkspacePage` | `RealDomPreview`, `api`, `useWorkspaceStore` |
| `AgentStatusBar.tsx` | Agent 状态条（per-agent 图标/名称/状态点/主题名/进度条） | `WorkspacePage` | `AppMark`, `useBootProgress` |
| `AgentStatusDot.tsx` | 统一动画状态点（refreshing/active/available/detecting/offline/error） | `AgentStatusBar`, `EnvironmentCard`, `AgentDetailSheet`, `InjectResultsPanel` | `cn` |
| `EnvironmentCard.tsx` | 环境单卡（主题预览色条 + 状态环 + 菜单操作） | `EnvironmentGrid` | `AppMark`, `Avatar`, `DropdownMenu`, `Progress`, `AgentStatusDot` |
| `EnvironmentGrid.tsx` | 环境网格（响应式网格 + 实时刷新指示器） | `WorkspacePage` | `EnvironmentCard`, `ErrorBanner`, `useBootProgress` |
| `QuickActionsCard.tsx` | 快速操作卡（主题状态条 + 快速切换 + 从图片创建 + 传统操作） | `WorkspacePage` | `api`, `useShellStore`, `useStatusStore`, `useThemeStore` |
| `QuickEnvironmentCreate.tsx` | 内联快速创建环境预设表单 | `WorkspacePage` | `api`, `useEnvironmentStore`, `useNotificationStore` |
| `TweakPanel.tsx` | 实时调整控制面板（color/shape/typography/motion 四组） | `WorkspacePage` | `Input`, `Select`, `Switch`, `useWorkspaceStore` |
| `WorkspaceQuickActions.tsx` | 可视化操作卡片（图标 + 标签 + 描述） | `QuickActionsCard` | `cn` |

### 应用管理组件（components/apps/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `AppCard.tsx` | 应用单卡（图标/名称/状态点/CDP 端口/双击启动；启动中脉动点 + 启动提示） | `AppsPage` | `AppMark`, `useShellStore`（i18n） |
| `AppDetailsDrawer.tsx` | 应用详情抽屉（身份区 + 已适配 chip + 元数据网格 + 启动/隐藏操作） | `AppsPage` | `AppMark`, `Button`, `AGENT_META`, `useAppsStore` |

### 仪表盘组件（components/dashboard/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|

### 设置页组件（components/settings/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `MarkdownStyleSettings.tsx` | Markdown 运行时样式设置（颜色选择器 + 字体 + 实时预览） | `SettingsPage` | `api`, `t`/`showToast`（由页面注入） |
| `SettingsDashboard.tsx` | 设置页仪表盘（6 适配器注入状态概览 + 相对时间） | `SettingsPage` | `useStatusStore`, `useThemeStore` |

### Studio 创作组件（components/studio/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `agent-profile-utils.ts` | 静态 Agent 配置文件数据（token 计数/品牌颜色，避免 IPC） | `AgentProfileSummary` | `AGENT_META` |
| `AgentProfileSummary.tsx` | Agent 配置文件摘要（token 数/类别/品牌色/策略） | `StudioDrawer` | `agent-profile-utils` |
| `AgentsSection.tsx` | Agent 安装状态 + 安全姿态分区 | `StudioDrawer` | `AppMark`, `agentStore` |
| `CenterStageTab.tsx` | 中心舞台标签页路由（theme/wallpaper/bundle/raw 切换） | `StudioStage` | `CenterTabThemeEditor`, `CenterTabWallpaper`, `CenterTabBundle`, `CenterTabRaw` |
| `ContrastBadge.tsx` | WCAG 2.1 AA/AAA 对比度交通灯指示器 | `CenterTabThemeEditor`, `ExtendedColorsEditor` | `scripts/extended-colors.mjs` |
| `device-frame.tsx` | 设备视口帧（CSS transform: scale 模拟分辨率） | `StudioStage`, `PreviewWindow` | 无 |
| `DockTabExport.tsx` | 底部 Dock "导出" 标签页（主题包导出表单） | `StudioDock` | `Button`, `Input`, `useStudioStore`, `api` |
| `DomHighlight.tsx` | DOM 高亮叠加层（iframe 悬停/选中元素矩形框） | `PreviewWindow` | 无 |
| `ExternalThemeImportPanel.tsx` | 外部主题导入面板（Codedrobe/VS Code JSON/Raw CSS 转换） | `StudioDrawer` | `useNotificationStore` |
| `FileInfoCard.tsx` | 共享文件信息卡片（预览图/文件名/大小/清除） | `StudioImageToThemePanel`, `ExternalThemeImportPanel` | 无 |
| `FloatingToolbar.tsx` | 浮动底部工具栏（缩放控制 + 检查切换） | `StudioStage` | `Button`, `useStudioStore`, `useWorkspaceStore` |
| `harmony.ts` | 色彩和谐调色板生成器（互补/类似/三角/分裂互补/单色） | `StudioImageToThemePanel`, `CenterTabThemeEditor` | 无 |
| `inspector-element.tsx` | 元素详情面板（计算样式/CSS 变量/DOM 面包屑/盒模型） | `StudioInspector` | `api` |
| `InspectorProfile.tsx` | 检查器 "Profile" 标签页（可视化分析进度管道） | `StudioInspector` | `AppMark`, `useStudioStore`, `NativeProfilePanel` |
| `LedgerPanel.tsx` | Transform Ledger 浏览器（per-action 分组 + 启用切换 + Get CSS） | `StudioDrawer` | `api` |
| `NativeProfilePanel.tsx` | 本地配置文件摘要（组件数/角色分布/高程梯） | `InspectorProfile` | 无 |
| `palette.ts` | 调色板辅助函数 re-export（从 `@/lib/palette`） | `StudioImageToThemePanel`, `CenterTabThemeEditor` | `@/lib/palette` |
| `PreviewWindow.tsx` | 预览窗口（状态栏 + 标题 + iframe srcDoc + 缩放） | `StudioStage` | `AppMark`, `useElementPicker`, `usePseudoForce`, `useLiveDom`, `dom-export` |
| `RealDomPreview.tsx` | 真实 DOM 预览（srcDoc iframe + 覆盖层注入 + A/B 比较） | `AgentLivePreview`, `PreviewWindow` | `dom-export`, `safe-css` |
| `ResourcesSection.tsx` | 主题库 + 壁纸 +  bundles 分区 | `StudioDrawer` | `useStudioStore`, `useWallpaperStore` |
| `StudioDock.tsx` | 底部 Dock 面板（可拖拽高度 + 标签栏 + 内容路由） | `StudioPage` | `DockTabExport`, `useWorkspaceStore` |
| `StudioDrawer.tsx` | 左侧工作区抽屉（Projects/Resources/Agents 分区） | `StudioPage` | `AppMark`, `Badge`, `Button`, `AgentProfileSummary`, `ResourcesSection`, `AgentsSection` |
| `StudioImageToThemePanel.tsx` | 图片→主题提取面板（拖放上传→14-token 提取→应用） | `CenterTabWallpaper` | `useStudioStore`, `useNotificationStore`, `harmony` |
| `StudioInspector.tsx` | 右侧检查器（Profile/Element 标签页 + 窗口指示器） | `StudioPage` | `InspectorProfile`, `inspector-element`, `useWorkspaceStore` |
| `StudioStage.tsx` | 舞台区域（预览窗口 + 设备帧 + 浮动工具栏） | `StudioPage` | `CenterStageTab`, `FloatingToolbar`, `PreviewWindow`, `device-frame` |
| `StudioStatusBar.tsx` | 工作区状态栏（24px，缩放百分比） | `StudioPage` | `useWorkspaceStore` |
| `StudioTitleBar.tsx` | Studio 窗口标题栏（32px，项目名 + 窗口控件） | `StudioPage` | `api`, `useShellStore`, `useStudioStore` |
| `StudioTopBar.tsx` | 工作区顶栏（品牌 + 撤销/重做 + 面板切换） | `StudioPage` | `Badge`, `Button`, `useStudioStore`, `useWorkspaceStore` |
| `TemplatePicker.tsx` | 主题模板选择器（卡片网格 + 过滤 + 种子项目） | `StudioDrawer` | `api`, `useStudioStore`, `useNotificationStore` |
| `TreatmentSummary.tsx` | 治疗分类结果展示（per-verdict 置信度 + Apply CSS） | `PreviewWindow` | `api` |

### Studio 中心标签页组件（components/studio/center/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `CenterTabBundle.tsx` | Bundle 管理面板（列表 + 导入/安装/删除） | `CenterStageTab` | `useStudioStore`, `EmptyState` |
| `CenterTabRaw.tsx` | CSS 源编辑器（CDP 读取 + 编辑 + 注入） | `CenterStageTab` | `useWorkspaceStore` |
| `CenterTabThemeEditor.tsx` | 可视化主题编辑器（设计语言 + 14-token 色板 + WCAG） | `CenterStageTab` | `useThemeStore`, `ContrastBadge`, `harmony` |
| `CenterTabWallpaper.tsx` | 壁纸→主题面板（组合 StudioImageToThemePanel） | `CenterStageTab` | `StudioImageToThemePanel` |
| `ExtendedColorsEditor.tsx` | 扩展颜色编辑器（添加/编辑/删除 + WCAG + OKLCH 滑块） | `CenterTabThemeEditor` | `ContrastBadge`, `scripts/extended-colors.mjs`, `scripts/oklch-utils.mjs` |

### 自定义 Hook（hooks/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `apply-result.ts` | ApplyResponse 纯分类器（success/requires-restart/port-occupied/skipped-concurrent） | `useAppController` | `ApplyResponse` |
| `use-element-picker.ts` | iframe 元素选择器（坐标 + elementFromPoint + CSS 选择器路径） | `PreviewWindow` | 无 |
| `use-pseudo-force.ts` | iframe 伪类强制（:data-studio-hover/focus/active 属性模拟） | `PreviewWindow` | 无 |
| `useAppController.ts` | 聚合所有 Store 为单一 controller 对象，桥接 UI 生命周期 | `App.tsx`, `ThemesPage`, `WallpaperEnginePage`, `SettingsPage`, `InjectDock` | 全部 Store, `useBoot`, `useBootProgress` |
| `useBoot.ts` | 一次性启动序列（获取 bootstrap + 订阅 runtime-log + 状态轮询） | `useAppController` | `useConcurrencyReporter` |
| `useBootProgress.ts` | 订阅 runtime-log 事件，驱动 bootProgressStore | `useAppController` | `bootProgressStore` |
| `useConcurrencyReporter.ts` | 并发报告器（推送 companionBusy/switchEpoch 指标到主进程） | `useBoot` | `environmentStore`, `wallpaperStore` |
| `useContainerWidth.ts` | 容器宽度测量（ResizeObserver） | 无（保留为通用工具） | 无 |
| `useDiagnosticsSync.ts` | 同步诊断数据（超时事件/并发指标/CDP 指标） | `SettingsPage` | `diagnosticsStore`, `api` |
| `useLiveDom.ts` | 实时 DOM 订阅（CDP + 降级缓存 + 自动刷新） | `PreviewWindow` | `api` |
| `useRelativeTime.ts` | 相对时间格式化 | `AgentStatusBar`, `SettingsDashboard` | 无 |
| `useSkeletonStrategy.ts` | 骨架屏防闪烁策略（anti-flicker + timeout） | `ThemesPage`, `WallpaperEnginePage`, `WorkspacePage`, `SettingsPage`, `AppsPage` | 无 |
| `useThemeCenter.ts` | 主题中心 Hook（搜索/过滤/排序/选择器计算） | `ThemesPage` | `themeStore` |
| `useThemeMode.ts` | 浅色/深色模式切换 | `SettingsPage`, `TitleBar` | `design/theme-mode` |
| `useVisualAnalysisSync.ts` | 可视化分析数据同步 | `VisualAnalysisPanel` | `visualAnalysisStore`, `api` |
| `useWallpaperPageController.ts` | 壁纸页面专用控制器 | `WallpaperEnginePage` | `wallpaperStore`, `notificationStore` |

### 业务工具函数（lib/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `app-dedupe.ts` | 应用去重与增量合并（渲染侧，re-export shared/app-identity） | `appsStore` | `@shared/app-identity` |
| `dom-export.ts` | DOM 导出为 srcDoc（安全标签白名单 + 覆盖层注入） | `RealDomPreview`, `PreviewWindow` | `safe-css`, `DomTreeNode` |
| `hash.ts` | 渲染侧哈希工具（Web Crypto SHA-256） | 待补充 | 无 |
| `palette.ts` | 调色板辅助函数（hexMix/lumOf/paletteFromSnapshot/buildSkinTokens 等） | `capture-store`, `StudioImageToThemePanel`, `studio/palette` | `color-theory` |
| `snapshot-to-override.ts` | CDP 主题快照→ToolOverride 基线提取（纯函数） | 待补充 | `ThemeVisualSnapshot`, `ToolOverride` |
| `status-utils.ts` | 系统状态查找工具（findAppStatus 纯函数） | `agentStore` | `SystemStatus`, `AgentId` |
| `utils.ts` | 通用工具（cn = clsx + twMerge） | 全局 50+ 组件 | `clsx`, `tailwind-merge` |
| `wallpaperRender.ts` | 壁纸渲染 CSS 辅助 re-export（从 @shared/wallpaper-render） | `DynamicBackground` | `@shared/wallpaper-render` |
| `wallpaperUtils.ts` | 壁纸工具（响应式网格 class + 文件大小格式化） | `WallpaperGrid`, `InjectResultsPanel`, `WallpaperCard` | 无 |
| `wallpaperVideo.ts` | 壁纸视频加载器（流式 loopback URL + LRU 缓存 + 去重） | `DynamicBackground`, `WallpaperCard` | `api` |

### 页面组件（pages/）

| 路径 | 用途 | 消费者 | 内部依赖 |
|------|------|--------|---------|
| `AppsPage.tsx` | 应用快速启动页（扫描/启动/详情抽屉） | `App.tsx`（lazy） | `useAppsStore`, `useShellStore`, `AppCard`, `AppDetailsDrawer` |
| `CommunityPage.tsx` | 社区主题浏览页（双栏：主题网格 + 右侧 SourceDetailPanel 条件渲染；源选择器由侧栏子菜单承担，解析 `community.<sourceId>` 子路由后切 activeSource） | `App.tsx`（lazy） | `useCommunityStore`, `CommunityTabPanel`, `SourceDetailPanel`, `AuthorPanel`, `PageHeader` |
| `SettingsPage.tsx` | 设置页（通用/外观/系统/高级/关于分区 + 诊断面板） | `App.tsx`（lazy） | `useAppController`, `useDiagnosticsSync`, `useThemeMode`, `SettingsDashboard`, `MarkdownStyleSettings`, 诊断组件 |
| `StudioPage.tsx` | 主题 Studio 创作页（标题栏/顶栏/抽屉/舞台/检查器/状态栏/Dock） | `StudioApp` | `StudioTitleBar`, `StudioTopBar`, `StudioDrawer`, `StudioStage`, `StudioInspector`, `StudioStatusBar`, `StudioDock` |
| `ThemesPage.tsx` | 主题浏览与应用（已安装/社区双标签、拖放导入、字符串导入） | `App.tsx`（lazy） | `useAppController`, `useThemeCenter`, `useSkeletonStrategy`, `VirtualThemeGrid`, `CommunityTabPanel`, `DetailPanel` |
| `WallpaperEnginePage.tsx` | 壁纸引擎页（toolbar + grid + detail sidebar） | `App.tsx`（lazy） | `useAppController`, `useWallpaperPageController`, `useSkeletonStrategy`, `WallpaperGrid`, `InjectResultsPanel` |
| `WorkspacePage.tsx` | 实时微调整面板（三栏布局：Agent 选择 rail / 预览 / 调整面板） | `App.tsx`（lazy） | `useShellStore`, `useStatusStore`, `useWorkspaceStore`, `AgentLivePreview`, `TweakPanel`, `QuickActionsCard`, `EnvironmentGrid` |
| `wallpaper/describeWallpaperFailure.ts` | 壁纸注入失败 verdict→本地化消息映射 | `WallpaperEnginePage` | `UiMessages` |

### Zustand Store（stores/）

| 路径 | Store | 职责 | 跨 Store 依赖 | 主要消费者 |
|------|-------|------|--------------|-----------|
| `agentStore.ts` | agent | Agent 目录列表，同步种子来自 AGENT_META | `statusStore`（通过 `appStatusFor` 读取实时状态） | `useAppController`, `StudioDrawer` |
| `appsStore.ts` | apps | 扫描的 Electron 应用列表、启动/运行状态、隐藏应用 | `dialogStore`, `notificationStore`, `settingsStore`, `themeStore` | `AppsPage`, `useAppController` |
| `bootProgressStore.ts` | bootProgress | 启动进度解析器（纯 reducer，解析 structured log） | 无跨 Store 依赖 | `useBootProgress` → `useAppController` |
| `communityStore.ts` | community | DreamSkin 社区主题浏览/下载/安装生命周期 | `notificationStore` | `CommunityTabPanel` |
| `diagnosticsStore.ts` | diagnostics | 诊断面板数据：IPC 超时、并发指标、健康报告、漂移状态、内存采样、性能追踪 | 无跨 Store 依赖（独立数据层） | `useDiagnosticsSync`, `SettingsPage` |
| `dialogStore.ts` | dialog | 模态框/对话框队列（重启提示、删除确认、文件导入确认等） | 无跨 Store 依赖（纯状态容器） | `useAppController`, `themeStore`, `environmentStore`, `appsStore` |
| `environmentStore.ts` | environment | 环境预设 CRUD + 切换（主题+壁纸组合） | `themeStore`, `notificationStore`, `dialogStore`, `shellStore` | `useAppController`, `QuickEnvironmentCreate` |
| `import-guard.ts` | importGuard | 跨 Store 导入去重锁（防止 themeStore 和 installFlowStore 重复导入） | 无跨 Store 依赖 | `installFlowStore`, `themeStore` |
| `inject-status-store.ts` | injectStatus | 统一注入状态骨架（Phase 1）：per-agent 注入状态 + apply/restore 委托 action，渐进替换散落在 9+ Store 的注入态字段（当前零消费者接线，Phase 计划见文件头） | 无（独立骨架） | 暂无（Phase 2 迁移 InjectDock/AgentStatusBar/SettingsDashboard） |
| `installFlowStore.ts` | installFlow | 安装流程状态机（idle→selecting→installing→completed/failed） | `notificationStore`, `shellStore`, `themeStore`, `import-guard` | `useAppController`, `App.tsx` |
| `notificationStore.ts` | notification | Toast 通知队列 + `fail` 错误处理管道 | `shellStore`（读取 locale 用于错误消息翻译） | 几乎所有 Store（theme/wallpaper/settings/installFlow/apps/environment/community） |
| `petStore.ts` | pet | 桌面宠物系统：已安装宠物列表、激活项、可见性、位置（localStorage 持久化）、当前动画 | `api`（IPC） | `PetViewer`（该组件自身暂未接线） |
| `secondaryInjectStore.ts` | secondaryInject | 二次注入（webview/iframe）进度追踪 | 无跨 Store 依赖 | `SecondaryInjectTrace` |
| `selectorStore.ts` | selector | CSS 选择器探测与验证 | 无跨 Store 依赖 | `SelectorProbePanel` |
| `settingsStore.ts` | settings | 用户偏好设置、MCP 服务器管理、app 路径/端口配置 | `notificationStore`, `statusStore`, `shellStore` | `useAppController`, `SettingsPage`, `appsStore` |
| `shellStore.ts` | shell | Shell 状态：locale、route、sidebar、inject dock、logs、booting | 无跨 Store 依赖；注册 `registerLocaleReader` 供 i18n 读取 | `App.tsx`, `StudioApp`, `useAppController`, `notificationStore`, 所有 Page |
| `statusStore.ts` | status | 系统状态 + 刷新生命周期，订阅 `onCoordinatorStatus` 实时更新 running/pid/port | 无跨 Store 依赖（独立） | `useAppController`, `agentStore`, `themeStore`, `settingsStore`, `wallpaperStore`, `WorkspacePage`, `StudioApp` |
| `studioStore.ts` | studio | Studio 创作模式（facade），委托给 4 个子 Store | 委托 `project-store`, `bundle-store`, `capture-store`, `image-wallpaper-store` | `StudioApp`, `StudioPage` 及所有 studio 组件 |
| `themeStore.ts` | theme | 主题生命周期：目录获取、搜索、选择、apply/restore、导入/删除/导出，IPC 事件订阅 | `notificationStore`, `statusStore`, `dialogStore`, `wallpaperStore`（通过 callback 注入打破循环） | `useAppController`, `ThemesPage`, `environmentStore`, `installFlowStore`, `appsStore` |
| `theme-usage-store.ts` | themeUsage | 主题使用频率查询层（LRU 排序，主进程持有真实跟踪与持久化），供快速切换菜单消费 | `api`（THEME_USAGE_GET） | 快速切换菜单 |
| `visualAnalysisStore.ts` | visualAnalysis | 可视化分析工作流（目标列表、摘要、导出） | 无跨 Store 依赖 | `useVisualAnalysisSync`, `VisualAnalysisPanel` |
| `wallpaperStore.ts` | wallpaper | 动态壁纸状态：列表、启用/选中、per-agent 偏好、渲染选项，壁纸→主题联动 | `notificationStore`, `statusStore`, `themeStore`（通过 `registerWallpaperHandler` 回调打破循环） | `useAppController`, `WallpaperEnginePage`, `ResourcesSection` |
| `wallpaper-handler-registry.ts` | — | 独立注册表，切断 themeStore ↔ wallpaperStore 的 ES 模块循环依赖（`registerWallpaperHandler` 自 themeStore 迁出至此） | 无（两侧共同 import 的中立模块） | `themeStore`, `wallpaperStore` |
| `workspace-presets.ts` | workspacePresets | 工作区预设定义（5 种布局） | 无（纯常量） | `workspaceStore` |
| `workspaceStore.ts` | workspace | 工作区布局与实时调整：单窗口、dock/inspector/drawer、覆盖层、撤销/重做、原始 CSS 编辑 | 无跨 Store 依赖（独立） | `WorkspacePage`, `StudioStage`, `StudioDock`, `StudioInspector`, `StudioTopBar`, `PreviewWindow` |

### Store 测试辅助（stores/test-helpers/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `index.ts` | 测试辅助聚合入口（re-export 所有 reset 函数） | 所有 store 测试文件 |
| `reset-agent-store.ts` | 重置 agentStore 到初始状态 | `agentStore.test.ts` |
| `reset-apps-store.ts` | 重置 appsStore 到初始状态 | `appsStore.test.ts` |
| `reset-community-store.ts` | 重置 communityStore 到初始状态 | `communityStore.test.ts` |
| `reset-settings-store.ts` | 重置 settingsStore 到初始状态 | `settingsStore.test.ts` |
| `reset-status-store.ts` | 重置 statusStore 到初始状态 | `statusStore.test.ts` |
| `reset-workspace-store.ts` | 重置 workspaceStore 到初始状态 | `workspaceStore.test.ts` |
| `store-test-harness.ts` | 通用 Zustand Store 测试脚手架（mock api + 重置 + 类型化 mock） | 所有 store 测试文件 |

### Studio 子 Store（studio/）

| 路径 | Store | 职责 | 跨 Store 依赖 | 主要消费者 |
|------|-------|------|--------------|-----------|
| `bundle-store.ts` | bundle | 外部主题 bundle 管理：列表、导入+安装、删除 | `notificationStore`, `shellStore` | `CenterTabBundle`, `useStudioStore` |
| `capture-store.ts` | capture | 捕获/检查/覆盖层状态：tool overrides + 撤销/重做 + 检查模式 + 实时 DOM + 导出 | `notificationStore`, `shellStore`, `project-store` | `useStudioStore`, `PreviewWindow`, `sync-hooks` |
| `image-wallpaper-store.ts` | imageWallpaper | 图片→主题提取 + 壁纸→主题实时预览 | `notificationStore`, `shellStore`, `capture-store`, `project-store` | `useStudioStore`, `StudioImageToThemePanel` |
| `index.ts` | — | Studio 子 Store barrel（re-export 所有子 store + 类型） | 子 Store | `studioStore` |
| `project-store.ts` | project | Studio 工程 CRUD：列表、选择、创建表单、导入、重命名 | `notificationStore`, `shellStore` | `useStudioStore`, `StudioDrawer`, `sync-hooks` |
| `sync-hooks.ts` | — | 跨 Store 同步钩子（工程切换时重置捕获状态） | `capture-store`, `project-store` | `StudioApp` |
| `useStudioStore.ts` | studio | Facade（合并 4 个子 Store 为单一 hook，兼容原 studioStore API） | 全部 4 个子 Store | `StudioApp`, `StudioPage`, 所有 studio 组件 |

### UI 类型定义（types/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `drift-status.ts` | 漂移状态类型 re-export（从 @shared/types/drift-status） | `DriftStatusPanel` |
| `index.ts` | UI 契约白名单（允许的 import 边界定义） | 架构边界文档 |
| `navigation.ts` | 导航模型（Route 类型：workspace/apps/themes/wallpaper/studio/settings） | `sidebar`, `TitleBar`, `StudioTopBar`, `shellStore` |
| `override.ts` | Studio 覆盖层类型（StudioColorSets + re-export ToolOverride/TweakSession） | `RealDomPreview`, `AgentLivePreview`, `capture-store` |
| `palette.ts` | 调色板源/输出契约（PaletteSource/PaletteResult/PaletteOutput） | `StudioImageToThemePanel`, `CenterTabThemeEditor` |
| `theme-center.ts` | 主题中心卡片模型（ThemeCenterCardModel） | `ThemeCard`, `VirtualThemeGrid`, `ThemePreview` |
| `workspace.ts` | 工作区类型（ViewMode/PreviewView/DockTabId/WindowState 等） | `workspaceStore`, `StudioStage`, `StudioDock`, `StudioInspector` |

### UI 工具（utils/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `color-theory.d.ts` | 色彩理论 JS 模块类型声明 | TypeScript 编译 |
| `color-theory.mjs` | 色彩理论工具（hexToRgb/rgbToHex 等） | `palette.ts`, `StudioImageToThemePanel` |
| `placeholder-count.ts` | 响应式占位数量计算（容器宽度→列数→总数） | 无（保留为通用工具） |
| `renderer-log.ts` | 渲染进程日志门面（INFO/WARN/ERROR 三级，ERROR 转发主进程） | `ErrorBoundary`, `StudioPage`, 全局 |

### 设计系统（design/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `theme-mode.ts` | 主题模式运行时（dark/light/system，localStorage 持久化） | `useThemeMode`, `CommandPalette`, `TitleBar` |

### API 客户端（api/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `agentSkinClient.ts` | `window.agentSkin` 类型化包装（AgentSkinApi 契约单一入口） | 全局 40+ 组件/hook/store |

### 持久化存储（storage/）

| 路径 | 用途 | 消费者 |
|------|------|--------|
| `environment-store.ts` | 环境预设持久化桥接（主进程 JSON 文件 + 一次性 localStorage 迁移） | `environmentStore` |

### 页面样式（styles/）

| 路径 | 用途 |
|------|------|
| `workspace.css` | Studio/Workspace 页面网格布局（topbar/drawer/stage/inspector/status） |
| `workspace/dock.css` | Studio Dock 样式 |
| `workspace/layout.css` | Studio 布局辅助样式 |

---

## 工程联动图

### 联动链 1：主题应用链路（最复杂）

```
用户点击应用 → themeStore.applyToApp()
  → api.applyTheme() [IPC]
  → 主进程执行 CDP 注入
  → 返回 ApplyResponse
  → apply-result.ts 分类（success/requires-restart/port-occupied）
  → statusStore.setStatus() [Response-as-Truth]
  → notificationStore.showToast()
  → dialogStore.setRestartPrompt() [如需重启]
```

### 联动链 2：Store 数据流（hooks → stores → components）

```
useAppController（聚合层）
  ├── useBoot() → bootProgressStore.applyLine()
  ├── useBootProgress() → bootProgressStore
  ├── useDiagnosticsSync() → diagnosticsStore
  ├── useVisualAnalysisSync() → visualAnalysisStore
  ├── useWallpaperPageController() → wallpaperStore + notificationStore
  └── useConcurrencyReporter() → environmentStore + wallpaperStore
        │
        ▼
  App.tsx（路由决策 + 布局）
    ├── sidebar/*（Provider + Rail 56px / Content 192px）→ shellStore + statusStore
    ├── TitleBar → shellStore + statusStore
    ├── DynamicBackground → wallpaperStore + wallpaperVideo
    ├── InjectDock → useAppController
    └── lazy Pages
        ├── ThemesPage → themeStore + useThemeCenter
        ├── WallpaperEnginePage → wallpaperStore + useWallpaperPageController
        ├── WorkspacePage → workspaceStore + statusStore
        ├── AppsPage → appsStore
        └── SettingsPage → settingsStore + diagnosticsStore
```

### 联动链 3：Studio 创作流（studio stores → components → IPC）

```
StudioApp → initStudioCrossSync()
  │
  ├── useStudioStore (facade)
  │     ├── project-store（工程 CRUD）
  │     ├── capture-store（覆盖层 + 撤销/重做 + 导出）
  │     ├── bundle-store（bundle 管理）
  │     └── image-wallpaper-store（图片→主题提取）
  │
  └── StudioPage
        ├── StudioTitleBar → api.windowMinimize/Close
        ├── StudioTopBar → studioStore.undo/redo + workspaceStore
        ├── StudioDrawer → studioStore + agentStore
        │     ├── AgentProfileSummary → agent-profile-utils
        │     ├── ResourcesSection → studioStore + wallpaperStore
        │     └── AgentsSection → agentStore
        ├── StudioStage → workspaceStore + studioStore
        │     ├── PreviewWindow → useLiveDom + useElementPicker + usePseudoForce
        │     ├── CenterStageTab → CenterTabThemeEditor/Bundle/Raw/Wallpaper
        │     └── FloatingToolbar → workspaceStore.setWindowScale
        ├── StudioInspector → workspaceStore + studioStore
        │     ├── InspectorProfile → studioStore.analysisProgress
        │     └── inspector-element → api
        ├── StudioDock → workspaceStore + studioStore
        │     └── DockTabExport → api.exportTheme
        └── StudioStatusBar → workspaceStore.window.scale
```

### 联动链 4：壁纸→主题联动链路

```
wallpaperStore.setAndApplyAgentWallpaper()
  → api.setAgentWallpaper() [持久化偏好]
  → api.applyAgentWallpaper() [CDP 注入]
  → runWallpaperCompanion() [pywal 风格联动]
    → api.extractThemeFromWallpaper() [提取主题]
    → api.applyTheme() [应用主题]
    → statusStore.setStatus()
```

### 联动链 5：启动引导链路

```
useAppController → useBoot()
  → api.getBootstrap() [获取 locale + 版本]
  → shellStore.setLocale/setAppVersion/setBooting
  → api.onRuntimeLog() → bootProgressStore.applyLine()
  → api.onStatusChanged() → statusStore.refreshStatus()
  → useConcurrencyReporter() [并发指标推送]
```

### 联动链 6：实时调整链路

```
WorkspacePage → workspaceStore.updateOverride()
  → 乐观更新 UI
  → persistOverridesByAgent() [localStorage]
  → pushToAgent() [debounce 150ms]
    → api.pushTweak() [CDP 注入]
    → recordPushDuration() [性能基线]
```

### 联动链 7：环境切换链路

```
environmentStore.switchEnvironment()
  → themeStore.applyToApp() / themeStore.restoreApp() [主题半段]
  → api.applyWallpaperToAgent() / api.removeWallpaperFromAgent() [壁纸半段]
  → dialogStore.setRestartPrompt(null) [清除过期提示]
  → notificationStore.showToast()
```

### 联动链 8：诊断数据流

```
主进程 IPC 事件
  ├── diagnostics:concurrency-metrics → useDiagnosticsSync → diagnosticsStore
  ├── performance:new-trace → useDiagnosticsSync → diagnosticsStore
  ├── performance:cdp-metrics → useDiagnosticsSync → diagnosticsStore
  ├── theme:drift-status → diagnosticsStore.driftStatusByAgent
  ├── theme:secondary-inject-progress → secondaryInjectStore
  └── visual-analysis:status → useVisualAnalysisSync → visualAnalysisStore
        │
        ▼
  SettingsPage 诊断面板
    ├── CdpPerformancePanel → diagnosticsStore
    ├── DriftStatusPanel → diagnosticsStore + api
    ├── PerformancePanel → diagnosticsStore + api
    ├── SecondaryInjectTrace → secondaryInjectStore
    ├── SelectorProbePanel → selectorStore
    └── VisualAnalysisPanel → visualAnalysisStore
```

---

## 依赖方向图

```
无依赖（叶子层）
  ├── colors.ts
  ├── globals.css / shadcn-tailwind.css
  ├── workspace-presets.ts
  ├── use-element-picker.ts
  ├── use-pseudo-force.ts
  ├── useRelativeTime.ts
  ├── useSkeletonStrategy.ts
  ├── useContainerWidth.ts
  ├── status-utils.ts (仅依赖 shared/types)
  ├── wallpaperRender.ts (re-export @shared/wallpaper-render)
  ├── wallpaperUtils.ts
  ├── placeholder-count.ts
  ├── agent-profile-utils.ts
  ├── harmony.ts
  ├── types/drift-status.ts (re-export)
  ├── types/navigation.ts
  ├── types/index.ts
  └── components/ui/* (43 个基础组件，仅依赖 cn/radix-ui/base-ui)

单层依赖
  ├── apply-result.ts → shared/types
  ├── useBootProgress.ts → bootProgressStore
  ├── useThemeCenter.ts → themeStore
  ├── useThemeMode.ts → design/theme-mode
  ├── useDiagnosticsSync.ts → diagnosticsStore, api
  ├── useVisualAnalysisSync.ts → visualAnalysisStore, api
  ├── useWallpaperPageController.ts → wallpaperStore, notificationStore
  ├── useConcurrencyReporter.ts → environmentStore, wallpaperStore
  ├── useLiveDom.ts → api
  ├── agentStore.ts → statusStore
  ├── bootProgressStore.ts → 无（纯 reducer）
  ├── dialogStore.ts → 无（纯状态容器）
  ├── workspaceStore.ts → 无（独立）
  ├── diagnosticsStore.ts → 无（独立数据层）
  ├── communityStore.ts → notificationStore
  ├── visualAnalysisStore.ts → 无
  ├── secondaryInjectStore.ts → 无
  ├── selectorStore.ts → 无
  ├── import-guard.ts → 无
  ├── api/agentSkinClient.ts → shared/types
  ├── storage/environment-store.ts → api, shared/types
  ├── lib/palette.ts → color-theory, shared/types
  ├── lib/dom-export.ts → safe-css, shared/types
  ├── lib/wallpaperVideo.ts → api
  ├── lib/app-dedupe.ts → @shared/app-identity
  ├── studio/bundle-store.ts → api, notificationStore, shellStore
  ├── studio/capture-store.ts → api, notificationStore, shellStore, project-store
  ├── studio/image-wallpaper-store.ts → api, notificationStore, shellStore, capture-store, project-store
  ├── studio/project-store.ts → api, notificationStore, shellStore
  └── studio/sync-hooks.ts → capture-store, project-store

多层依赖（核心枢纽）
  ├── useAppController.ts → 全部 Store + useBoot + useBootProgress
  ├── shellStore.ts → 注册 registerLocaleReader
  ├── statusStore.ts → 被 10+ Store/组件引用
  ├── themeStore.ts → notificationStore, statusStore, dialogStore, wallpaperStore
  ├── wallpaperStore.ts → notificationStore, statusStore, themeStore
  ├── notificationStore.ts → shellStore（被 12+ Store 引用）
  ├── settingsStore.ts → notificationStore, statusStore, shellStore
  ├── environmentStore.ts → themeStore, notificationStore, dialogStore, shellStore
  ├── appsStore.ts → dialogStore, notificationStore, settingsStore, themeStore
  ├── installFlowStore.ts → notificationStore, shellStore, themeStore, import-guard
  ├── studioStore.ts → project-store, bundle-store, capture-store, image-wallpaper-store
  ├── useStudioStore.ts → 全部 4 个子 Studio Store
  ├── App.tsx → 全部 Page + 独立组件 + useAppController
  └── StudioPage.tsx → 全部 Studio 组件 + useStudioStore
```

---

## 核心消费者分布

| 模块 | 被引用次数 | 主要引用者类别 |
|------|-----------|---------------|
| `cn` (utils.ts) | 50+ | 几乎所有 UI 组件 |
| `useAppController` | 5 | `App.tsx`, `ThemesPage`, `WallpaperEnginePage`, `SettingsPage`, `InjectDock` |
| `useShellStore` | 12+ | `App.tsx`, `StudioApp`, `StudioPage`, `WorkspacePage`, `ThemesPage`, `SettingsPage`, `AppsPage`, `notificationStore`, `environmentStore`, `installFlowStore`, `sidebar`, `TitleBar` |
| `useStatusStore` | 10+ | `useAppController`, `agentStore`, `themeStore`, `settingsStore`, `wallpaperStore`, `WorkspacePage`, `StudioApp` |
| `useThemeStore` | 8+ | `useAppController`, `ThemesPage`, `environmentStore`, `installFlowStore`, `appsStore`, `QuickActionsCard` |
| `useWorkspaceStore` | 10+ | `WorkspacePage`, `StudioStage`, `StudioDock`, `StudioInspector`, `StudioTopBar`, `PreviewWindow`, `FloatingToolbar`, `StudioStatusBar`, `CenterTabRaw`, `TweakPanel` |
| `useSettingsStore` | 4 | `App.tsx`, `useAppController`, `SettingsPage`, `appsStore` |
| `useNotificationStore` | 12+ | 几乎所有 Store（theme/wallpaper/settings/installFlow/apps/environment/community） |
| `useDialogStore` | 5+ | `useAppController`, `themeStore`, `environmentStore`, `appsStore` |
| `useDiagnosticsStore` | 4 | `useAppController`, `WorkspacePage`, `SettingsPage`, 诊断面板组件 |
| `useStudioStore` | 20+ | `StudioApp`, `StudioPage`, 所有 studio 组件 |
| `useWallpaperStore` | 5+ | `useAppController`, `WallpaperEnginePage`, `DynamicBackground`, `ResourcesSection` |
| `useAgentStore` | 3 | `useAppController`, `App.tsx`, `StudioDrawer` |
| `useCommunityStore` | 2 | `CommunityTabPanel`, `CommunityThemeCard` |
| `useSecondaryInjectStore` | 1 | `SecondaryInjectTrace` |
| `useSelectorStore` | 1 | `SelectorProbePanel` |
| `useVisualAnalysisStore` | 1 | `VisualAnalysisPanel` |
| `api` (agentSkinClient) | 40+ | 全局组件/hook/store |
| `AppMark` | 10+ | `AppCard`, `DetailPanel`, `AgentStatusBar`, `InjectResultsPanel`, `DriftStatusTrace`, `SecondaryInjectTrace` |

---

## 约定

1. **Store 通信**：跨 Store 调用使用 `getState().action()` 模式，禁止 Store 间直接 import。
2. **路由模型**：使用手写 `useState<Route>` 路由，不引入 react-router（单窗口 Electron 场景下复杂度高于收益）。
3. **选择器稳定**：Zustand v5 + React 19 下，selector 必须返回稳定引用，避免 useSyncExternalStore tearing。
4. **禁止被动挂载同步 set()**：不在 useEffect 中同步调用 setState 触发全量重渲染。
5. **国际化**：翻译由 Store action 内部读取 locale 实现，不在组件层注入 t 函数。
6. **设计 Token**：UI 间距禁止任意散值（如 `gap-[9px]`），使用 Tailwind 标准档（4px 网格 2–96px）；`w-*`/`h-*` 布局尺寸不受限——由 `check-design-tokens.mjs`（C6）强制，允许集以脚本为准。
7. **组件就近测试**：领域组件的 `.test.tsx` 与组件同目录，UI 组件测试放在 `components/ui/` 同目录。
8. **循环依赖防控**：`wallpaperStore ↔ themeStore` 通过 `registerWallpaperHandler` 回调机制解耦。
9. **IPC 单一入口**：所有 IPC 调用必须通过 `api`（agentSkinClient）进行，禁止直接访问 `window.agentSkin`。
10. **Studio 子 Store 同步**：跨子 Store 边界反应（如工程切换重置捕获状态）通过 `sync-hooks.ts` 协调，不在 Store 内部直接调用。
11. **类型边界**：UI 层仅允许从 `@/types/*`、`@shared/types`、`@shared/i18n` 导入类型，禁止跨架构边界导入。
12. **日志规范**：渲染进程日志通过 `renderer-log.ts` 门面，ERROR 级转发主进程 agent-engine.log，INFO 仅开发控制台。

---

## 变更影响速查

> 修改以下模块时需格外谨慎，影响范围广：

| 模块 | 风险等级 | 原因 |
|------|---------|------|
| `useAppController.ts` | 🔴 高 | 中央聚合层，订阅全部 Store |
| `shellStore.ts` | 🔴 高 | Shell 状态核心，12+ 文件依赖 |
| `notificationStore.ts` | 🔴 高 | 全局通知队列，12+ Store 依赖 |
| `statusStore.ts` | 🔴 高 | 系统状态核心，10+ 文件依赖 |
| `themeStore.ts` | 🔴 高 | 主题生命周期核心，8+ 文件依赖 |
| `globals.css` | 🔴 高 | 全局 CSS 变量，影响所有组件样式 |
| `api/agentSkinClient.ts` | 🔴 高 | IPC 契约单一入口，40+ 文件依赖 |
| `useStudioStore.ts` | 🔴 高 | Studio facade，20+ 组件依赖 |
| `wallpaperStore.ts` | 🟡 中 | 壁纸状态核心，5+ 文件依赖 |
| `settingsStore.ts` | 🟡 中 | 用户偏好核心，4+ 文件依赖 |
| `environmentStore.ts` | 🟡 中 | 环境预设核心，4+ 跨 Store 依赖 |
| `appsStore.ts` | 🟡 中 | 应用列表核心，4+ 跨 Store 依赖 |
| `installFlowStore.ts` | 🟡 中 | 安装流程状态机，4+ 跨 Store 依赖 |
| `studioStore.ts` | 🟡 中 | Studio facade，20+ 组件依赖 |
| `App.tsx` | 🟡 中 | 应用根组件，路由决策入口 |
| `components/sidebar.tsx` | 🟡 中 | 侧边栏导航，影响页面切换 |
| `components/ui/button.tsx` | 🟡 中 | 基础按钮，50+ 组件依赖 |
| `components/ui/dialog.tsx` | 🟡 中 | 对话框基类，DetailPanel/CommandPalette 依赖 |
| `lib/utils.ts` (cn) | 🟡 中 | 样式合并工具，50+ 组件依赖 |
| `types/navigation.ts` | 🟡 中 | Route 类型，影响所有导航组件 |
| 其他模块 | 🟢 低 | 消费者 ≤ 5，影响可控 |
