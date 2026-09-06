# RFC: Studio 架构治理

| Field | Value |
|-------|-------|
| 状态 | 待评审 |
| 日期 | 2026-08-24 |
| 分支 | — |
| 范围 | `src/ui/StudioApp.tsx`, `src/ui/pages/StudioPage.tsx`, `src/ui/components/studio/`, `src/ui/studio/`, `src/main/window-manager.ts`, `src/main/main-context.ts`, `src/preload.ts` |
| 关联 RFC | `docs/rfc/2026-08-24-studio-architecture-refactor.md`（store 减重已完成） |

---

## 1. 背景与目标

### 1.1 现状痛点

**Studio 独立窗口承载约 10,800 行专属代码**，构成一个与主窗口并行的完整 UI 子系统。审计数据如下：

| 模块 | 行数 | 说明 |
|------|------|------|
| 组件层 | 7,054 | 37 个 TSX 文件（`src/ui/components/studio/`） |
| Store 层 | 1,792 | 4 个子 Store + 571 行 facade |
| IPC 通道 | 978 | 24 个专属通道 |
| 窗口状态 | 248 | `main-context.ts` studioWindow 管理 |

### 1.2 与主窗口的重复度分析

| 组件 | 主窗口 | Studio 窗口 | 重复性质 |
|------|--------|-------------|----------|
| TitleBar | 164 行 (`title-bar.tsx`) | 116 行 (`StudioTitleBar.tsx`) | **结构/行为重复**：两者都使用 `api.windowMinimize/windowToggleMaximize/windowClose`、同样的 maximize 监听、同样的 i18n 键；仅品牌文案和尺寸微调不同 |
| StatusBar | 96 行 (`status-bar.tsx`) | 26 行 (`StudioStatusBar.tsx`) | **功能子集**：Studio 仅展示 zoom 百分比，主窗口包含 LED + 版本 + 时钟 |
| Drawer / Sidebar | 67 行 (`sidebar.tsx`, 纯图标导航) | 487 行 (`StudioDrawer.tsx`) | **职责不同**：主 Sidebar 是路由导航，Studio Drawer 承载 Projects/Resources/Agents 业务面板——不构成直接重复，但两者共享 `useWorkspaceStore` 的 `drawer` 状态 |
| Bootstrap | 30 行 (`App.tsx` 挂载) | 36 行 (`StudioApp.tsx`) | **高度相似**：两者都订阅 `onStatusChanged`、都 pin route |
| 路由框架 | `App.tsx` 内置 `controller.route` 切换 | `StudioApp.tsx` 直接渲染 `<StudioPage />` | **本质重复**：Studio 作为独立窗口仅渲染单一页面 |

### 1.3 维护负担矩阵

| 维度 | 主窗口 | Studio 窗口 | 实际影响 |
|------|--------|-------------|----------|
| UI 层 | Sidebar + TitleBar + StatusBar + 5 路由页面 | StudioTitleBar + StudioStatusBar + StudioDrawer + StudioPage | 两套窗口状态、两套标题栏生命周期 |
| IPC 通道 | 统一 preload | 共享 preload + STATUS_CHANGED 跨窗口广播 | 新增 IPC 需考虑 fan-out 兼容性 |
| Store 订阅 | 直接消费 | facade 合并 4 子 store | 订阅路径更长，潜在性能损耗 |
| 主进程管理 | `mainWindow` 单例 | `mainWindow` + `studioWindow` 双 BrowserWindow | `main-context.ts` 需维护两套引用、两套生命周期 |

### 1.4 目标

1. **减少专属代码 1,500-2,000 行**：消除 TitleBar/StatusBar/Bootstrap 重复，降低长期维护成本；
2. **保留 Studio 核心功能完整**：PreviewWindow + Inspector + Toolbox + CenterStage 不受影响；
3. **不破坏现有多窗口工作流**：用户可继续"主窗口浏览 + Studio 预览编辑"的并行模式。

### 1.5 非目标

- 不重构 store 层（已由 `2026-08-24-studio-architecture-refactor.md` 完成）；
- 不删除 Studio 的 CenterStage / Inspector / Toolbox / PreviewWindow 组件；
- 不修改 14-token 主题契约或注入架构；
- 不合并主窗口的 Sidebar 导航与 Studio 的 Drawer 业务面板（职责不同）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [ ] 重构注入架构（L0-L4 注入层）—— **否**
- [ ] 新增 UI 页面（突破六页封顶）—— **否**
- [ ] 新增适配器（突破六适配器上限）—— **否
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）—— **否**

**结论**：本次变更不触发 AGENTS.md §6 的 RFC 强制条件，但鉴于涉及独立窗口生命周期、IPC fan-out、以及 10,800 行代码的治理，主动提交 RFC 供评审。

---

## 3. 现状侦察（代码锚点）

| 锚点 | 文件:行 | 说明 |
|------|---------|------|
| `StudioApp.tsx` | `src/ui/StudioApp.tsx:30-100` | 独立窗口的 React 根组件 |
| `StudioPage.tsx` | `src/ui/pages/StudioPage.tsx:40-81` | 页面布局，组装 TitleBar/TopBar/Drawer/Stage/Inspector/StatusBar/Dock |
| `StudioTitleBar` | `src/ui/components/studio/StudioTitleBar.tsx:33-116` | 116 行独立标题栏 |
| `StudioStatusBar` | `src/ui/components/studio/StudioStatusBar.tsx:15-26` | 26 行状态栏 |
| `StudioDrawer` | `src/ui/components/studio/StudioDrawer.tsx:73-487` | 487 行业务面板 |
| `openStudioWindow` preload | `src/preload.ts:175` | 触发 STUDIO_OPEN IPC |
| `studioWindow` 主进程 | `src/main/main-context.ts:40,78,166-167` | BrowserWindow 引用与 STATUS_CHANGED fan-out |
| `STUDIO_OPEN` handler | `src/main/window-manager.ts` | 创建独立 BrowserWindow 加载 studio.html |
| `studio.html` 入口 | 主进程 HTML 加载配置 | 独立窗口的 HTML 入口（需确认路径） |
| `useStudioStore` facade | `src/ui/studio/useStudioStore.ts:1-572` | 571 行 facade，合并 4 子 store |
| `useAppController` | `src/ui/App.tsx` | 主窗口控制器，Studio 不消费 |

---

## 4. 设计方案

### 方案 A: Studio 收为主窗口路由页面

**核心思路**：删除独立窗口基础设施，将 Studio 整合为主窗口的一个路由页面（`/studio`）。

#### 改动范围

| 操作 | 文件 | 预计行数变化 |
|------|------|-------------|
| 删除 | `src/ui/StudioApp.tsx` | -100 |
| 删除 | `studio.html`（若存在） | -10 |
| 修改 | `src/ui/App.tsx` 新增 StudioPage 路由分支 | +3 |
| 删除 | `src/ui/components/studio/StudioTitleBar.tsx` | -116 |
| 删除 | `src/ui/components/studio/StudioStatusBar.tsx` | -26 |
| 修改 | `src/ui/pages/StudioPage.tsx` 移除 TitleBar/StatusBar/Drawer 自建、改用主窗口 App shell | -30 |
| 修改 | `src/main/window-manager.ts` 移除 `STUDIO_OPEN` handler | -40 |
| 修改 | `src/main/main-context.ts` 移除 `studioWindow` 引用与 fan-out | -20 |
| 修改 | `src/preload.ts` 移除 `openStudioWindow` bridge | -3 |
| 修改 | `src/ui/pages/ThemesPage.tsx` 中 `openStudioWindow()` 改为 `setRoute('studio')` | +1/-1 |
| **合计** | | **约 -2,300 行** |

#### 多窗口工作流替代方案

原"主窗口浏览 + Studio 独立窗口预览"模式消失后，提供两种替代：

1. **分屏模式**：Studio Page 占据主窗口全部工作区，通过主窗口 TitleBar 的标签页快速切换回 Workspace/Themes；
2. **弹出预览（可选）**：保留 `PreviewWindow` 组件的 iframe 内容可 detach 为独立 BrowserWindow（仅承载预览 iframe，不承载完整的 Studio shell）。

#### 优缺点

| 优点 | 缺点 |
|------|------|
| 消除 100% TitleBar/StatusBar/Bootstrap 重复 | 丢失真正的多窗口并行工作流 |
| 简化主进程管理（单 BrowserWindow） | 需在 StudioPage 内实现 Drawer 兼容（复用主窗口 App shell 需调整 ws-root 布局逻辑） |
| IPC 无需 fan-out，状态同步更简单 | `ThemesPage.tsx` 中"打开 Studio"交互模式变化（从弹出窗口变为路由跳转） |
| 减少 ~2,300 行代码 | 用户需要适应期 |

---

### 方案 B: 保留独立窗口但删除 facade

**核心思路**：保留独立窗口架构，仅通过删除 facade 层和合并 IPC 通道来减少代码量。

#### 改动范围

| 操作 | 文件 | 预计行数变化 |
|------|------|-------------|
| 删除 facade | `src/ui/studio/useStudioStore.ts` | -571 |
| 提升模块状态 | `_analysisProgress`、`_healthReportByAgent` 提升为独立 zustand store | +60 |
| 迁移 22 处消费方 | 组件从 `useStudioStore(selector)` 改为直接消费 4 个子 store | -30（减少的 import 和 selector 间接层） |
| 合并 IPC 通道 | 24 个专属 bundle IPC 通道合并到统一通道 | -200 |
| 合并 STUDIO_OPEN | 简化窗口创建逻辑 | -60 |
| **合计** | | **约 -800 行** |

#### 优缺点

| 优点 | 缺点 |
|------|------|
| 改动最小，风险最低 | 仅减少 facade 层，未解决 TitleBar/StatusBar 重复 |
| 保留完整多窗口工作流 | 两套 UI 层维护负担依然存在 |
| 符合"非必要不重构"原则（注入架构 RFC 要求） | 减少行数有限（~800 行，占 10,800 的 7%） |

---

### 方案 C: 混合方案（推荐）

**核心思路**：分阶段执行——先以方案 B 降低复杂度和风险，观察 1-2 周后再决定是否执行方案 A。

#### Phase C1: Facade 删除 + IPC 合并（1-2 天）

执行方案 B 的全部内容：删除 571 行 facade、合并 IPC、提升模块状态至独立 store。

- **验证**：`npm run check` 全绿；Studio 独立窗口功能无回归；TTI 不劣化。
- **观察指标**：Studio 窗口打开频率、用户是否抱怨"需要多窗口并行"。

#### Phase C2: 决策点（观察期 1-2 周）

| 条件 | 动作 |
|------|------|
| Studio 使用频率低 + 用户主要在单窗口工作 | 启动方案 A（Studio 收为路由页面） |
| Studio 使用频率高 + 用户依赖多窗口并行 | 停止在 Phase C1，后续仅做增量优化 |
| 混合需求（多数单窗口，少数多窗口） | 实现"轻量弹出"：保留 PreviewWindow 全屏模式，但移除完整 Studio shell |

#### Phase C3: 条件性实施（若触发）

若 Phase C2 决定执行方案 A，则在此阶段完成：
- 删除独立窗口基础设施
- StudioPage 整合进主窗口路由
- 验证清单与方案 A 相同

---

## 5. 推荐方案：方案 C（混合方案）

### 决策依据

| 因素 | 分析 |
|------|------|
| **多窗口工作流必要性** | 当前用户存在"主窗口浏览主题 + Studio 编辑/预览"的真实并行需求；直接删除独立窗口可能损失高级用户的工作流效率 |
| **使用频率** | 需要数据支撑——首次治理不宜盲目做减法，先通过 facade 删除获得 800 行减重，同时保持架构可逆 |
| **架构简洁性 vs 功能完整性** | 方案 C 平衡两者：短期获得减重收益，长期根据数据决策是否进一步收敛 |
| **RFC 合规** | 整体变更不触发 AGENTS.md §6 强制条件（未突破六页上限、未新增适配器/修改数据模型），无需完整 RFC 评审流程；但主动提交以保留审计痕迹 |
| **风险** | Phase C1 改动范围可控（仅 Store/IPC 层），不影响 UI 布局；Phase C2 决策点基于真实数据 |

### 核心决策

1. **不立即删除独立窗口**：当前存在多窗口并行的真实使用场景，且主进程 fan-out 机制已稳定运行；
2. **优先删除 facade**：571 行 facade 是已知的冗余层，删除后可直接消费 4 个子 store，无功能损失；
3. **合并 IPC 通道**：24 个专属 bundle IPC 通道中存在功能重叠（refreshBundles/installBundle/deleteBundle 可用单一 `studio:bundle-action` 替代）；
4. **观察后再决策**：Phase C1 上线后收集 1-2 周使用数据，再评估是否需要进一步收敛为路由页面。

---

## 6. 迁移策略

### Phase C1 详细步骤

#### Step 1: 提升模块状态为独立 store

```
src/ui/studio/
  ├── analysis-progress-store.ts   # 新增：_analysisProgress 提升为 zustand store
  ├── health-report-store.ts       # 新增：_healthReportByAgent 提升为 zustand store
```

#### Step 2: 逐文件迁移 facade 消费方

按以下优先级迁移 22 处 `useStudioStore(selector)` 调用：

1. **高频组件**（优先迁移验证）：`StudioTopBar`、`StudioCenterPanel`、`PreviewWindow`
2. **中频组件**：`StudioInspector`、`DockTabExport`、`StudioImageToThemePanel`
3. **低频/一次性组件**：`WorkspaceDialog`、`WorkspaceSwitcher`、`kicker`

迁移模式：

```ts
// Before (facade):
const activeProject = useStudioStore((s) => s.getActiveProject());

// After (direct store):
import { useProjectStore } from '@/studio/project-store';
const activeProject = useProjectStore((s) => s.getActiveProject());
```

#### Step 3: 合并 IPC 通道

合并前（示例）：

```
GET_BUNDLES → bundle/list
REFRESH_BUNDLES → bundle/refresh  
INSTALL_BUNDLE → bundle/install
DELETE_BUNDLE → bundle/delete
```

合并后：

```
STUDIO_BUNDLE_ACTION → { type: 'list' | 'refresh' | 'install' | 'delete', payload }
```

#### Step 4: 删除 facade

确认所有消费方迁移完毕后：
- 删除 `src/ui/studio/useStudioStore.ts`（571 行）
- 更新 `src/ui/studio/index.ts` 移除 facade re-export

#### Step 5: 验证

- `npm run check` 全绿（含 check-store-contracts C5）
- 手动验证 Studio 独立窗口：项目 CRUD、预览交互、导出流程、undo/redo

---

## 7. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | facade 删除后遗漏消费方导致运行时错误 | 中 | grep 未覆盖的动态 import | 全量替换 `useStudioStore` 引用后全局搜索确认零残留 | `npm run check` + 手动运行 Studio 窗口 |
| R2 | 模块状态提升后订阅时序变化 | 低 | `_analysisProgress` 从模块变量改为 zustand store，observe 回调不变 | 保持相同的 subscribe 接口；观察 24h 无异常 | 视觉回归 + IPC 事件监听日志 |
| R3 | IPC 合并后主进程 handler 兼容性问题 | 中 | 合并通道的消息格式与旧格式不兼容 | 保留旧通道为 deprecated alias（新 handler 同时监听新旧通道名） | `npm run check` + IPC 集成测试 |
| R4 | Phase C2 决策延迟导致技术债累积 | 低 | 观察期满后未做决策 | 设定硬性 deadline（Phase C1 上线后 14 天），到期默认维持现状 | 日历提醒 + TODO 标记 |
| R5 | Studio 使用频率数据采集不准确 | 低 | 无法判断用户是否依赖多窗口 | 在 STUDIO_OPEN 触发处埋点计数；结合用户反馈渠道 | 埋点数据统计 + 主动询问 3-5 名活跃用户 |

---

## 8. 验收标准

### Phase C1 验收

| # | 检查项 | 通过条件 |
|---|--------|----------|
| V1 | 静态检查 | `npm run check` 全绿（所有 C1-C10 不变量通过） |
| V2 | 行数减少 | 净减少 700-900 行（目标 800 行，±10% 容差） |
| V3 | facade 零残留 | `grep -r "useStudioStore" src/` 仅匹配注释或文档 |
| V4 | 子 store 直连 | 所有 Studio 组件直接 import 自 `@/studio/project-store`、`@/studio/bundle-store` 等 |
| V5 | Studio 功能回归 | 独立窗口能正常：创建项目 → 绑定 agent → 导入 bundle → 预览主题 → 拾取元素 → 导出 |
| V6 | IPC 兼容 | 旧 IPC 通道（若保留 deprecated alias）仍可被调用；新通道正常工作 |
| V7 | 多窗口工作流保留 | STUDIO_OPEN 仍可打开独立 Studio 窗口；STATUS_CHANGED fan-out 正常 |

### Phase C2 决策标准

| 指标 | 阈值 | 决策 |
|------|------|------|
| Studio 日均打开次数 | < 5 次 | 倾向方案 A |
| Studio 日均打开次数 | >= 10 次 | 倾向保留独立窗口 |
| 用户反馈中有"需要多窗口"诉求 | >= 3 人 | 强制保留独立窗口 |
| Studio 页面停留时间中位数 | < 2 分钟 | 倾向方案 A |

---

## 9. 人工复核项

1. **消费方迁移完整性**：`useStudioStore` 是否仅通过 `src/ui/studio/` 内的文件被消费？是否存在动态字符串拼接的 selector（如 `useStudioStore((s) => s[dynamicKey])`）导致 grep 遗漏？
2. **IPC 合并兼容性**：24 个 Studio 专属 IPC 通道中是否有被 preload 之外代码（如主进程内部）直接调用的？
3. **ThemePage 跳转交互**：`ThemesPage.tsx:191` 的 `openStudioWindow()` 改为路由跳转后，是否需要保留"在新窗口中打开"的右键/中键选项以满足高级用户需求？
4. **PreviewWindow detach 可行性**：若未来需要"轻量弹出"模式（仅 iframe 内容），当前 PreviewWindow 组件是否易于从 StudioPage 中独立出来？

---

## 10. 评审结论

（评审意见汇总，由评审人填写）

---

*End of RFC.*
