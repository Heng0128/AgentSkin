# AgentSkin 自动化巡检报告 — 方向 K：渲染管线稳定性

- **方向编号 + 方向名**: K — 渲染管线（React19 + Zustand 撕裂排查 / useSyncExternalStore selector 稳定性，权重 2）
- **状态**: COMPLETED（无 CRITICAL 待人工确认；修复 1 处 critical 级撕裂风险）
- **快照 commit**: `f784a4bff`（基线：`snapshot: pre-inspection baseline [K-render-pipeline]`）
- **执行时间**: 2026-08-23 06:00
- **调度模型**: Scout-α(正向追踪渲染链路) + Scout-β(逆向扫描 selector/tearing，code-explorer 子智能体) 并行 → Merger → Architect → Selector → Builder → Verifier×4 并行 → Fixer(1 轮) → Auditor

## 执行摘要

本次选取方向 K（渲染管线稳定性）。Scout-β（code-explorer 逆向扫描 14 个 store + 全部页面/组件）发现：项目对复合 selector 防护到位（`useShallow` 3 处 + `useMemo` 派生模式），store 侧不可变更新避免引用残旧，模式 1/3/4/5 **零可疑命中**。唯一真实高风险点为 **`WorkspacePage.tsx:58-59` 在 render 期直接 `useShellStore.getState().locale` 读取并用于渲染**，违反 `src/ui/INDEX.md:102`「选择器稳定 / 避免 useSyncExternalStore tearing」不变量：处于撕裂窗口且 locale 切换不触发重渲染（severity critical，相对本项目标准）。

选优后执行：将 render 期 `getState()` 改为订阅式 `useShellStore((s) => s.locale)` 读取，删除非订阅 `currentT()` 函数，根治撕裂风险并改善 locale 切换行为。

- **发现问题总数**: 1（critical 1 / major 0 / minor 0 / info 0，按本轮 scouts；另含修复中暴露的 1 个 BIO warning 级未用 import）
- **已修复数**: 1（RC-K1 render 期 getState 撕裂）+ 1（BIO warning 未用 `UiMessages` 导入）
- **待人工确认数**: 0
- **回滚次数**: 0
- **全量回归**: TSC 0；VIT `WorkspacePage.test.tsx` 11/11 无回归（关键断言 `CDP timeout` 仍成立）；BIO 0；CTR 0（无类型重复/Store 越界/样式泄漏）

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/ui/pages/WorkspacePage.tsx | 58-59 (+105) | critical | render 期直接 `useShellStore.getState().locale` 读取（`currentT()` 在 line 105 用于渲染），违反 INDEX.md:102 不变量；处于 useSyncExternalStore 撕裂窗口且 locale 切换不重渲染 | 删除 `currentT()`；组件内改 `const locale = useShellStore((s) => s.locale); const t = uiMessages[locale];`（订阅式读取） | `1e258e100a` | COMPLETED |
| 2 | src/ui/pages/WorkspacePage.tsx | 45 | info(warning) | 删除 `currentT` 后 `type UiMessages` 导入未使用（biome lint warning） | 移除未使用类型导入 `import { uiMessages } from '@shared/i18n'` | `c2c6f0a7a4` | COMPLETED |

> 已排除（非方向 K 范围，避免误报）：`StudioApp.tsx:68`、`useAppController.ts:239-264`、`StudioTopBar.tsx`、`StudioDock.tsx:43`、`DockTabExport.tsx`、`UnifiedWorkspacePage.tsx` 等处 `getState()` 均位于事件处理器 / effect 内，非 render 期读取，不触发撕裂。

## 方案选优记录

- **候选方案数**: 3
  1. 订阅式读取 `locale`（`useShellStore((s)=>s.locale)`）+ 删除 `currentT`（选中）
  2. 用 `useShallow`/memo 包装 `currentT` 返回值（治标不治本，render 期 getState 仍在 → 重试）
  3. 新建全局 `useUiMessages()` i18n hook（XL，需新建共享 hook，回归面大）—— 拒选
- **最优方案**: 方案 1
- **选择理由**: 直接消除 RC-K1 根因（render 期 getState）；不引入新依赖/新 hook；改动集中单步可回滚；`WorkspacePage.test.tsx` 11/11 仍可验证无回归；订阅式读取与文件中其他 store 消费点风格一致
- **各维度评分**: 时间复杂度 10/10（2 行改动），空间复杂度 10/10（零新增），长期可维护性 10/10（符合 INDEX.md:102 不变量、消除隐含撕裂）、扩展性 9/10（订阅式模式可复用于其他页面 locale 读取）、依赖可控性 10/10

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (tsc --noEmit) | 1 / r1 | PASS | 退出码 0 |
| VIT (WorkspacePage.test.tsx) | 1 / r1 | PASS | 11/11（关键 `CDP timeout` 断言在；locale 重构无回归） |
| BIO (biome check) | 1 → r1 | WARN→PASS | 轮1 发现未用 `UiMessages` 导入 warning；r1 移除后 0 |
| CTR (契约/类型一致性) | 1 | PASS | 无类型重复；无 Store 跨边界；无样式泄漏；selector 返回基本类型稳定 |
| Fixer | round 1 | 完成 | 修复 BIO warning 后 4 验证器全重验通过 |

## 审计结论

- **遗漏**: 无 —— RC-K1 已修复；其余 `getState()` 调用正确排除（非 render 期）
- **回归**: 无 —— `WorkspacePage.test.tsx` 11/11 通过；locale 切换现正确触发重渲染（行为改善）
- **新增问题**: 无 —— `const locale = useShellStore((s)=>s.locale)` 返回基本类型（稳定引用）；`uiMessages[locale]` 为查表非新对象；无悬挂引用
- **一致性**: 无 —— 订阅式读取与 WorkspacePage 既有 `useStatusStore`/`useWorkspaceStore` 消费风格一致，符合 INDEX.md:102
- **文档同步**: 无 —— 改动为组件内 UI 逻辑，无公开 API/类型变更；不变量已在 INDEX.md 描述

## 下一步建议（优先级排序，供下次巡检输入）

1. **[Low / 方向 K 延伸]** 扫描其余页面是否存在同类「render 期 `getState()` 读取用于渲染」隐患（本次仅确认 `WorkspacePage` 一处；`AppsPage`/`SettingsPage`/`ThemesPage` 等可批量复核，建立 `check:no-render-getstate` 守卫脚本更稳）。
2. **[Low / 方向 E]** 将方向 H 遗留的硬编码错误文案（`实时推送失败：`/`导入失败：`/`扫描失败：`）纳入 i18n 消息表；本轮 `WorkspacePage` 已订阅 locale，配合 i18n 根治可彻底消除硬编码兜底。
3. **[Medium / 方向 H]** 按 M3/M5/M8/M9 将 `WorkspacePage.tsx`（仍 ~465 行）拆分为 `Workspace*Section` 子组件，降低单文件复杂度（本轮已提取 `ErrorBanner` + 订阅式 locale，迈出两步）。
4. **[Low / 方向 F]** 复核方向 K 涉及的 `shellStore` 订阅是否触发跨 store 循环依赖（本次改动未触及，留作方向 F 输入）。
5. **[Low]** 为 `AppsPage` / `AgentLivePreview` 补充错误态/语言切换交互测试（当前零覆盖，本轮靠类型 + 样式保证）。

## 附：本次 Git 提交（main）

- `f784a4bff` snapshot: pre-inspection baseline [K-render-pipeline]
- `1e258e100a` fix(ui): subscribe to locale in WorkspacePage to avoid render-time getState tearing [phase5-step1]
- `c2c6f0a7a4` fix(ui): remove unused UiMessages import after tearing fix [phase7-r1]
