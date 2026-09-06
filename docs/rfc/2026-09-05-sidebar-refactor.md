# RFC 2026-09-05 — Sidebar 组合式重构与 Swiss 适配

**状态**: DRAFT
**作者**: CatPaw Agent
**日期**: 2026-09-05

## 摘要

将 `src/ui/components/sidebar.tsx`（单文件 361 行多功能混合组件）重构为组合式 Sidebar 组件体系。新体系以 shadcn/ui 组合式模式为蓝本，使用 `SidebarProvider` Context + `SidebarRail` / `SidebarContent` / `SidebarMenu` / `SidebarMenuItem` / `SidebarMenuSub` 积木化拆分，并通过 Swiss 设计系统 token 全量覆盖（6px 半径、10/11/13/16/20 字号、纯色表面、克制动效）。

新增能力：hover-to-open 中间态浮层、agent 状态列表（替代单数字 badge）、完整键盘导航（↑↓↔ + Enter / Esc）、touch long-press popover、Zustand persist 持久化折叠态、`safeAreaInset` macOS 适配字段。

## 当前问题

1. 设计系统违规：text-[12px] 越界、rounded-lg 非 6px、backdrop-blur-md 过强毛玻璃、ease-spring 未注册
2. 无障碍缺失：tooltip 无 role/aria-describedby、无键盘导航、touch 设备无 long-press
3. 交互缺陷：折叠态 Community 三动作耦合展开+导航+子菜单、agent 状态只显示总数无详情
4. 代码重复：Community 分支与标准按钮的 tooltip JSX 完全重复
5. 状态持久化：手工 localStorage 读写非主流模式，与 12 Store 架构风格不一致

## 改动范围

### 新增文件（9 个）

| 文件 | 职责 |
|------|------|
| `src/ui/components/sidebar/index.ts` | barrel export |
| `src/ui/components/sidebar/SidebarProvider.tsx` | Context + useSidebar hook（订阅 shellStore） |
| `src/ui/components/sidebar/SidebarRail.tsx` | 左侧细走廊（logo + toggle） |
| `src/ui/components/sidebar/SidebarContent.tsx` | 右侧内容区 + hover 中间态浮层容器 |
| `src/ui/components/sidebar/SidebarMenu.tsx` | 菜单列表 |
| `src/ui/components/sidebar/SidebarMenuItem.tsx` | 单个菜单项（含 active 指示条 + label） |
| `src/ui/components/sidebar/SidebarMenuSub.tsx` | 子菜单容器 |
| `src/ui/components/sidebar/SidebarTooltip.tsx` | a11y tooltip 原语 |
| `src/ui/components/sidebar/RunningAgentList.tsx` | 运行中 agent 列表 |
| `src/ui/hooks/useSidebarHover.ts` | hover-to-open 300ms 中间态 hook |
| `tests/ui/components/sidebar/*.test.tsx` | 单元测试（每组件至少 1 个主路径用例） |

### 修改文件（4 个）

| 文件 | 改动描述 |
|------|---------|
| `src/ui/stores/shellStore.ts` | 引入 zustand/middleware persist，移除手工 localStorage；加 safeAreaInset 字段 |
| `src/ui/App.tsx` | 替换 `<Sidebar />` 组合为新 SidebarProvider 体系 |
| `src/ui/components/sidebar.tsx` | 删除（迁移完成，由 index.ts barrel 替代） |

### 不修改的范围
- 不新增第三方运行时依赖（zustand/middleware 已在 zustand 包内，Radix 系列已安装）
- 不新增 UI 页面（不触发六页上限 RFC 条款）
- 不修改 manifest schema 或 14-token 契约
- 不修改任何 adapter 注入引擎逻辑

## 前置条件（落地前必须解决）

1. **双重事实源**：Subscriber 订阅 shellStore 而非自持副本，避免 Context + Store 漂移
2. **动画依赖冲突**：项目使用 tailwindcss v4 内置 tw-animate-css，不复用 tailwindcss-animate
3. **Electron suspend**：监听 `document.visibilitychange` 清理 hover pending timers
4. **macOS safe-area**：shellStore 新增 `safeAreaInset` 字段 + CSS padding 兜底

## 回滚方案

- 保留原 sidebar.tsx 在 git 历史，直接 `git checkout <commit> -- src/ui/components/sidebar.tsx` 即可恢复
- App.tsx 中 Sidebar 入口为单一行替换，回滚只需恢复该行
- shellStore 的 persist 中间件为 additive，移除时同步删除 persist 配置即可
- 新文件均可独立删除不影响存量功能

## 风险

| 风险 | 缓解 |
|------|------|
| Context 子树重渲 | Context 拆分子域 + React.memo 叶子 |
| hover-timer 泄漏 | useRef 存 timer，mouseleave 必清 |
| Electron suspend 后 timer 误触发 | visibilitychange 事件清除所有 pending timers |
| 折叠动作与 navigation 的状态竞争 | Provider 提供 subscribe 方法让组件读最新值而非快照 |
| zh-CN 英文版宽不一致 | 中文版展开宽度考虑 160px fallback |
