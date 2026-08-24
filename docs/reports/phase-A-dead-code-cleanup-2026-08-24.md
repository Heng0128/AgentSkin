# Phase A 死代码清理执行报告

> **执行日期**: 2026-08-24
> **执行方式**: 10 个子代理 × 3 批（并行→并行→验证）
> **阶段**: Phase A — 零风险死代码清理

---

## 一、执行摘要

本次清理覆盖 8 个维度、10 个子代理、3 批次执行。

| 批次 | 子代理数 | 执行内容 | 结果 |
|------|:--------:|----------|------|
| 1 | 6 并行 | 归档页面、Agent 接口、孤儿测试、useAppController 死字段、Studio 死方法、onCssEvents 孤儿、死 Hooks | 全部完成 |
| 2 | 2 并行 | 死翻译键（48 个）、useAppController 剩余死字段（4 个） | 全部完成 |
| 3 | 2 并行 | 全量验证 + 深度检查 | 发现测试文件 7 处断言需同步修复 |
| 修复 | 人工 | 测试文件 `useAppController.test.ts` 断言清理 | 全部完成 |

**最终验证**: 3620/3620 测试通过，源码层面零断裂引用。

---

## 二、清理明细

### 2.1 删除的文件（8 个）

| 文件 | 行数 | 原因 |
|------|:----:|------|
| `src/ui/pages/archive/AgentDashboardPage.tsx` | 279 | 归档页面，零引用 |
| `src/ui/pages/archive/AgentsPage.tsx` | 173 | 归档页面，零引用 |
| `src/ui/pages/archive/UnifiedWorkspacePage.tsx` | 535 | 归档页面，零引用 |
| `src/main/ipc/css-ipc.test.ts` | 459 | 孤儿测试（源文件不存在） |
| `src/main/cdp/css-event-bridge.ts` | 183 | CSS 事件推送无人消费 |
| `src/main/cdp/css-event-bridge.test.ts` | 233 | 对应模块的测试 |
| `src/shared/types/css-event.ts` | 21 | CSS 事件类型无人引用 |
| `src/ui/hooks/useCommandPalette.ts` | — | 死 Hook，零活动消费方 |
| `src/ui/hooks/useEnvironments.ts` | — | 死 Hook，仅被归档页面引用 |
| `src/ui/hooks/useWallpaperActions.ts` | — | 死 Hook，文件自认死亡 |

### 2.2 修改的文件

| 文件 | 修改内容 | 删除行数 |
|------|----------|:--------:|
| `src/shared/types/agent.ts` | 删除 `Agent` 零引用接口 | 8 行 |
| `src/ui/hooks/useAppController.ts` | 删除 16 个死字段（订阅+return） | 56 行 |
| `src/shared/i18n.ts` | 删除 48 个死翻译键（中英文） | ~100 行 |
| `src/shared/ipc-channels.ts` | 删除 `CSS_EVENTS` 常量定义 | 5 行 |
| `src/shared/types/ipc.ts` | 删除 `AgentSkinApi.onCssEvents` 签名 | 1 行 |
| `src/preload.ts` | 删除 `onCssEvents` 暴露 | 1 行 |
| `src/ui/studio/capture-store.ts` | 删除 `bumpDomTreeVersion` 方法 | 2 行 |
| `src/ui/studio/project-store.ts` | 删除 `setProjects` + `createEmpty` 方法 | 7 行 |
| `src/ui/hooks/useAppController.test.ts` | 同步清理 11 处断言 + Mock 对象 | ~30 行删除 |

### 2.3 保留项

| 项 | 保留原因 |
|----|----------|
| `APP_META`（app-mark.tsx） | 有 6 处真实引用，非死代码 |
| `agentsTitle` 翻译键 | 被 `StudioDrawer.tsx:382` 使用 |
| `emptyInstalledHint` 翻译键 | 被 `ThemesPage.tsx:275` 使用 |
| `forceRestartLaunch` | 被 `dialogs-host.tsx:172` 使用 |
| `setFlowState` | 被 `App.tsx:170` 使用 |

---

## 三、验证结果

### 3.1 断裂引用检查（全部通过）

全站 grep 确认以下符号在 `src/` 和 `src/main/` 中零命中：
- 已删除文件名：`AgentDashboardPage`, `AgentsPage`, `UnifiedWorkspacePage`
- 已删除符号：`CSS_EVENTS`, `onCssEvents`, `CssStyleSheetEvent`, `CssEventHandler`
- 已删除 Hooks：`useCommandPalette`, `useEnvironments`, `useWallpaperActions`
- 已删除测试/css：`css-ipc`, `css-event-bridge`
- 已删除 Studio 方法：`bumpDomTreeVersion`, `setProjects`, `createEmpty`
- 已删除 useAppController 字段：`setActiveAgentId`, `sidebarCollapsed`, `logsOpen`, `booting`, `settingsOpen`, `loadSettings`, `chooseAppPath`, `clearAppPath`, `saveAppPort`, `flowState`

### 3.2 测试验证

| 项 | 结果 |
|----|------|
| 测试文件数 | 227 |
| 通过 | 227 |
| 跳过 | 4 |
| 失败 | 0 |
| 总测试数 | 3620 |
| 总耗时 | 87.38s |

### 3.3 发现的用例遗漏（已修复）

验证子代理发现 `useAppController.test.ts` 有 7 处断言仍引用已删除字段，导致测试失败。需同步清理断言和 Mock 对象。已修复并验证通过。

---

## 四、净删除统计

| 类别 | 行数 |
|------|:----:|
| 归档页面（3 个文件） | 987 |
| 孤儿文件（5 个文件） | ~900 |
| useAppController 死字段 | 80 |
| 死翻译键（48 个） | ~100 |
| Studio 死方法 | ~9 |
| IPC 通道/类型清理 | ~7 |
| 测试断言同步清理 | ~30 |
| **合计净删除** | **~2,100 行** |

---

## 五、未覆盖项（Phase A 范围外）

以下项目因归档页面和死 Hooks 已删除，现在已成为新的死代码，需后续 Phase 处理：

| 新发现的死代码 | 说明 |
|---------------|------|
| `PERSIST_FAILURE_WARNING` 通道断裂 | Phase B 修复 |
| `AgentId` 类型双重定义 | Phase B 修复 |
| `useWallpaperPageController` 中可能存在的死字段 | 待深度验证 |

---

## 六、下一步建议

Phase A 完成后的推荐顺序：

1. **Phase B — IPC 通道修复**（半天）：修复 `PERSIST_FAILURE_WARNING` 断裂通道、统一 `AgentId` 类型。低风险。

2. **Phase C — 视觉统一**（3-5 天）：
   - 创建 `<EmptyState>` 共享组件
   - 统一状态色迁移至 `cr-*` CSS 变量
   - 修复 `text-xs`/`text-sm` 字号污染
   - 修复间距违规
   - 建立 z-index 变量系统
   - 骨架屏圆角修正

3. **Phase D — 架构瘦身**（1-2 周）：拆分 workspaceStore、统一 Design Language、降级 environmentStore

4. **Phase E — Studio 治理**（1-2 周）：删除 facade、合并 IPC、评估收为路由

建议优先推进 Phase B+P2 项中的 P0-1（修复断裂 IPC 通道），因为它影响数据完整性（用户无法收到磁盘写失败告警）。
