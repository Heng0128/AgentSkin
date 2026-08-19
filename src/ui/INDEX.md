# ui — 渲染进程

## 用途
Electron 渲染进程的 React 应用层，包含全部 12 个 Zustand Store、7 个页面、30+ 通用组件与领域组件、设计系统与全局样式。

## 结构

### 根目录（应用入口）

| 路径 | 用途 |
|------|------|
| `App.tsx` | 应用根组件，路由决策、全局 Provider 挂载、错误边界 |
| `StudioApp.tsx` | Studio 模式入口，独立于主应用的创作界面 |
| `globals.css` | 全局 CSS 变量、主题 token 注入、Tailwind 基础层 |
| `shadcn-tailwind.css` | shadcn/ui 兼容层样式 |
| `colors.ts` | 颜色常量与主题色板映射 |

### 子目录

| 路径 | 用途 |
|------|------|
| `stores/` | 12 个 Zustand Store + 辅助模块 |
| `pages/` | 页面级路由组件 |
| `components/` | 通用 + 领域组件 |
| `components/ui/` | 基础 UI 组件库（30+ 个 shadcn 风格组件） |
| `components/diagnostics/` | 诊断面板组件 |
| `components/studio/` | Studio 创作模式专用组件 |
| `components/themes/` | 主题卡片与虚拟网格 |
| `components/wallpaper/` | 壁纸卡片、网格、渲染设置、注入结果面板 |
| `components/workspace/` | 工作区环境卡片、详情 sheet、状态组件 |
| `hooks/` | React Hook 集合（16 个） |
| `lib/` | 业务工具函数（调色板预设、壁纸渲染、状态工具等） |
| `design/` | 设计令牌与主题模式定义 |
| `api/` | 渲染进程 API 客户端（AgentSkinClient） |
| `utils/` | 通用工具（色彩理论、渲染日志） |
| `styles/` | 页面级样式（workspace-tokens.css, workspace.css） |
| `storage/` | 持久化存储（环境预设 store） |
| `types/` | 渲染进程局部类型定义 |
| `assets/` | 静态资源 |

### Store 清单（stores/）

| 文件 | Store | 职责 |
|------|-------|------|
| `agentStore.ts` | agent | Agent 列表、选中态、注入状态、Agent 操作 |
| `bootProgressStore.ts` | bootProgress | 启动进度、阶段标记、完成状态 |
| `diagnosticsStore.ts` | diagnostics | 诊断数据面板：性能、日志、CDP 连接状态 |
| `dialogStore.ts` | dialog | 模态框/对话框队列管理 |
| `environmentStore.ts` | environment | 环境配置：工作区环境 CRUD |
| `installFlowStore.ts` | installFlow | 安装流程状态机 |
| `notificationStore.ts` | notification | 全局通知队列 |
| `secondaryInjectStore.ts` | secondaryInject | 二次注入追踪 |
| `settingsStore.ts` | settings | 用户偏好设置 |
| `shellStore.ts` | shell | Shell 状态：侧边栏、标题栏、路由 |
| `statusStore.ts` | status | 全局状态指示灯 |
| `studioStore.ts` | studio | Studio 创作模式状态 |
| `themeStore.ts` | theme | 主题选择、调色板、应用状态 |
| `wallpaperStore.ts` | wallpaper | 壁纸资源、注入状态、预览 |
| `workspaceStore.ts` | workspace | 工作区布局与状态 |

### 核心 Hook（hooks/）

| 文件 | 用途 |
|------|------|
| `useAppController.ts` | 全局应用控制器，桥接 Store 与 UI 生命周期 |
| `useBoot.ts` | 启动流程 Hook，监听 bootProgress 并驱动页面切换 |
| `useBootProgress.ts` | 启动进度数据订阅 |
| `useCommandPalette.ts` | 命令面板快捷键与搜索逻辑 |
| `useConcurrencyReporter.ts` | 并发操作报告，展示后台任务进度 |
| `useEnvironments.ts` | 工作区环境管理 Hook |
| `useRelativeTime.ts` | 相对时间格式化（"3 分钟前"） |
| `useThemeCenter.ts` | 主题中心 Hook，调色板与主题操作 |
| `useThemeMode.ts` | 浅色/深色模式切换 |
| `useWallpaperActions.ts` | 壁纸操作 Hook（选择、应用、预览、删除） |
| `useWallpaperPageController.ts` | 壁纸页面专用控制器 |

### 页面组件（pages/）

| 文件 | 路径 | 用途 |
|------|------|------|
| `WorkspacePage.tsx` | /workspace | 工作区页 |
| `ThemesPage.tsx` | /themes | 主题浏览与应用页 |
| `WallpaperEnginePage.tsx` | /wallpaper | 壁纸引擎页 |
| `SettingsPage.tsx` | /settings | 设置页 |
| `AppsPage.tsx` | /apps | 应用管理页 |
| `wallpaper/describeWallpaperFailure.ts` | — | 壁纸失败描述辅助 |

### 已归档页面（pages/archive/）

以下文件已从路由中移除，仅保留供实现参考：

| 文件 | 原路径 | 归档原因 |
|------|--------|----------|
| `AgentsPage.tsx` | /agents | 已合并至 WorkspacePage |
| `AgentDashboardPage.tsx` | /agents/:id | 已合并至 WorkspacePage |
| `UnifiedWorkspacePage.tsx` | /workspace | 已被新版 WorkspacePage 取代 |

## 约定

1. **Store 通信**：跨 Store 调用使用 `getState().action()` 模式，禁止 Store 间直接 import。
2. **路由模型**：使用手写 `useState<Route>` 路由，不引入 react-router（单窗口 Electron 场景下复杂度高于收益）。
3. **选择器稳定**：Zustand v5 + React 19 下，selector 必须返回稳定引用，避免 useSyncExternalStore tearing。
4. **禁止被动挂载同步 set()**：不在 useEffect 中同步调用 setState 触发全量重渲染。
5. **国际化**：翻译由 Store action 内部读取 locale 实现，不在组件层注入 t 函数。
6. **设计 Token**：UI 间距禁止任意散值（如 `gap-[9px]`），使用 Tailwind 标准档（4px 网格 2–96px）；`w-*`/`h-*` 布局尺寸不受限——由 `check-design-tokens.mjs`（C6）强制，允许集以脚本为准。
7. **组件就近测试**：领域组件的 `.test.tsx` 与组件同目录，UI 组件测试放在 `components/ui/` 同目录。
