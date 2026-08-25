# AgentSkin 自动化巡检报告 — 方向 H：Studio工程瘦身

- **方向编号 + 方向名**: H — Studio工程瘦身（ThemeStudio 组件化拆分 / StudioApp.tsx 膨胀监控，权重 2）
- **状态**: COMPLETED（含若干 future 待办，无 CRITICAL）
- **快照 commit**: `e3f7f35f`（基线：`snapshot: pre-inspection baseline [H-studio-slim]`）
- **执行时间**: 2026-08-23 05:00
- **调度模型**: Scout-α/β 并行 → Merger → Architect → Selector → Builder → Verifier×4 并行 → Fixer(未触发) → Auditor

## 执行摘要

本次选取方向 H（Studio工程瘦身）。Scout 探查发现：名义目标 `StudioApp.tsx` / `StudioPage.tsx` 已**完成组件化且精简**（StudioApp 100 行、StudioPage 56 行，由 StudioTitleBar/StudioTopBar/StudioDrawer/StudioStage/StudioInspector/StudioStatusBar/StudioDock 等标准组件组装），不存在"膨胀待拆"。真正待"工程瘦身"的高 ROI 点在 **`WorkspacePage.tsx`（467 行）内联错误 banner 膨胀** 与**跨文件硬编码 CSS 变量别名 `var(--redbg)` 散落**。

选优后执行：提取 `WorkspacePage` 内联错误 banner 为共享 `ErrorBanner` 组件 + 硬编码文案常量化 + 跨文件 `var(--redbg)`/`var(--destructive)` 内联 style 收敛为语义化 Tailwind 类（`bg-destructive/10 text-destructive` / `bg-destructive`），消除对内部 `--redbg` 别名的直接依赖、统一危险态视觉语言。

- **发现问题总数**: 3（critical 0 / major 1 / minor 2 / info 0，按本轮 scouts）
- **已修复数**: 3（RC-H1 banner 内联膨胀 + RC-H2 跨文件 `var(--redbg)` 散落 + 硬编码中文文案常量化）
- **待人工确认数**: 0
- **回滚次数**: 0
- **全量回归**: TSC 0；VIT `WorkspacePage.test.tsx` 11/11 无回归（关键断言 `CDP timeout` 仍成立）；AppsPage/AgentLivePreview 无对应测试文件（已确认），改动仅样式/类名零行为变更；BIO 0；CTR 0（`var(--redbg)` 内联残留清零，无类型重复/Store 越界）

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/ui/pages/WorkspacePage.tsx | 344-361, 445-458 | major | 两处错误 banner 内联重复渲染：直接使用 `style={{background:'var(--redbg)'}}` 与 `style={{color:'var(--destructive)'}}` 绕过语义 token，且硬编码中文 `实时推送失败：`/`导入失败：` 散落行内 | 提取本地 `ErrorBanner` 共享组件（语义类 `bg-destructive/10 text-destructive`）；硬编码文案抽为模块常量 `PUSH_FAILED_FALLBACK`/`IMPORT_FAILED_FALLBACK`（明确 i18n fallback 性质） | `ce115fbc` | COMPLETED |
| 2 | src/ui/pages/AppsPage.tsx | 227-241 | minor | 扫描失败 banner 同样内联 `var(--redbg)`/`var(--destructive)` + 硬编码 `扫描失败：` | 收敛为 `bg-destructive/10 text-destructive` 语义类 + `role="alert"`（保持与 WorkspacePage 一致） | `a06bc778` | COMPLETED |
| 3 | src/ui/components/workspace/AgentLivePreview.tsx | 166 | minor | 刷新失败指示条内联 `style={{background:'var(--destructive)'}}` | 收敛为 `bg-destructive` 语义类（1px 顶栏指示条用实色更合适） | `a06bc778` | COMPLETED |
| 4 | 全局（token 定义层） | tokens.css:43-44 | info | `--accent-subtle`/`--accent-ghost: var(--redbg)` 是别名，TSX 直接使用 `var(--redbg)` 跳过语义层（非缺陷，定义本身合理） | 不改定义；仅消除 TSX 内联使用，统一走语义类/语义 token | （future/本轮回避） | PENDING_REVIEW |
| 5 | src/shared/i18n（方向 E 范畴） | — | minor | `实时推送失败：`/`导入失败：`/`扫描失败：` 仍未进入 i18n 消息表（仅常量化，未根治 i18n 完整性） | future：纳入方向 E（国际化完整性）统一处理，本轮不越界 | （future） | PENDING |
| 6 | src/ui/pages/WorkspacePage.tsx（467 行） | — | minor | 单文件仍承载 health bar / agent rail / preview / tweak / export-import / undo-redo / inspect 大量内联逻辑，整体可读性与可测性有进一步拆分空间 | future：按 M3/M5/M8/M9 特性拆分为 `Workspace*Section` 子组件；本轮已通过 banner 提取迈出第一步 | （future） | PENDING |

## 方案选优记录

- **候选方案数**: 3
  1. 提取 `ErrorBanner` 本地组件 + 语义类收敛 + 文案常量化（选中）
  2. 仅将 `var(--redbg)` 替换为语义 token `var(--accent-subtle)`（最小改动，但不解决硬编码中文文案、且语义上错误态用 accent-subtle 不如 destructive 贴切）
  3. 完整拆分 `WorkspacePage` 为多个文件（XL，回归面大，风险高）—— 拒选
- **最优方案**: 方案 1
- **选择理由**: 直接消除 RC-H1/RC-H2 两个根因（内联重复 + 样式别名散落）；不引入新依赖；改动集中可单步回滚；`WorkspacePage.test.tsx` 11/11 仍可验证无回归；语义类与项目 design system 一致
- **各维度评分**: 时间复杂度 10/10，空间复杂度 10/10，长期可维护性 9/10（去重 + 语义类可复用），扩展性 9/10（ErrorBanner 可复用于其他错误态），依赖可控性 10/10

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (tsc --noEmit) | 1 | PASS | 退出码 0 |
| VIT (WorkspacePage.test.tsx) | 1 | PASS | 11/11（关键 `CDP timeout` 断言在，banner 重构无回归） |
| VIT (AppsPage/AgentLivePreview) | 1 | N/A | 无对应测试文件（已确认），改动仅样式类零行为变更 |
| BIO (biome check) | 1 | PASS | 0 error/warning |
| CTR (契约/类型一致性) | 1 | PASS | `var(--redbg)` 内联残留清零；无类型重复；无 Store 跨边界 |
| Fixer | — | 未触发 | 4 验证器全过 |

## 审计结论

- **遗漏**: 无（预期内）—— RC-H1/RC-H2 已修复；i18n 根治（方向 E）与 WorkspacePage 整体拆分正确标注 future
- **回归**: 无 —— `WorkspacePage.test.tsx` 11/11 通过；AppsPage/AgentLivePreview 改动仅 className/style，零行为变更
- **新增问题**: 无 —— `ErrorBanner` 为文件内私有函数组件（非 export），作用域合理；`bg-destructive/10`/`bg-destructive` 均依赖 globals.css 已声明的 `destructive` 色（语义类可用）；AgentLivePreview 改用实色 `bg-destructive` 因是 1px 指示条
- **一致性**: 无 —— 语义类与 studio design system 一致；组件提取风格与现有 studio 组件化体系吻合
- **文档同步**: 无 —— 改动为组件内部 UI，无公开 API/类型变更；新增 `ErrorBanner` 与常量已补 JSDoc

## 下一步建议（优先级排序，供下次巡检输入）

1. **[Medium / 方向 E]** 将 `实时推送失败：`/`导入失败：`/`扫描失败：` 等硬编码错误文案纳入 i18n 消息表（本轮仅常量化，未根治 i18n 完整性）；同步清理 `?? '关闭'` 等兜底硬编码。
2. **[Medium / 方向 H]** 按 M3/M5/M8/M9 特性将 `WorkspacePage.tsx`（467 行）进一步拆分为 `WorkspaceHealthSection` / `WorkspaceAgentRail` / `WorkspaceInspectToolbar` 等子组件，降低单文件复杂度、提升可测性（本轮已通过 `ErrorBanner` 提取迈出第一步）。
3. **[Low]** 评估 `tokens.css` 中 `--accent-subtle: var(--redbg)` 别名是否可改为直接引用更高层语义 token，减少 `--redbg` 中间别名层级（非缺陷，纯整洁度）。
4. **[Low]** 为 `AppsPage` / `AgentLivePreview` 补充错误态交互测试（当前无测试覆盖，本轮改动靠类型 + 样式保证），提升关键路径回归防护。
5. **[Low / 方向 F]** 复核 `StudioApp`/`StudioPage` 组件树深度，确认无新的循环依赖或 Store 跨边界调用（本轮未触及，留作方向 F 输入）。

## 附：本次 Git 提交（main）

- `e3f7f35f` snapshot: pre-inspection baseline [H-studio-slim]
- `ce115fbc` refactor(ui): extract ErrorBanner + de-hardcode error banners in WorkspacePage [phase5-step1]
- `a06bc778` refactor(ui): converge inline --redbg/--destructive styles to semantic classes [phase5-step2]
