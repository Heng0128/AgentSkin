# AgentSkin 巡检报告 — F-架构正交

> 生成时间: 2026-08-28 12:00
> 方向: F-架构正交（模块循环依赖、公共类型重复定义、Store 跨调用边界）
> 权重: 2
> 状态: **COMPLETED**
> 快照 commit: `23d60436`

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 58（去重后） |
| 严重度分布 | critical: 2, major: 15, minor: 20, info: 21 |
| 已修复根因 | 2/4（RC1 Critical + RC3 Major） |
| 已修复问题数 | 5（2 critical + 3 major） |
| 修改文件 | 12 |
| 新增 commit | 3（2 Phase5 + 1 Phase7） |
| 回滚次数 | 0 |
| 验证轮次 | Phase 6 + Phase 7-r1 |

---

## 方向选取

**加权随机选取结果**: F-架构正交（权重 2）

**历史回避**: 无（最近 5 次: D/C/F/B/L，无连续 2 次 COMPLETED）

**选取计算**: 总权重 24，种子 12（当前小时），12 mod 24 = 12，落入 F 区间 (11-12)。

---

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|---------|---------|---------|------------|------|
| RC1-1 | src/shared/errors/notify.ts | 18 | critical | shared 层导入 useNotificationStore（shared→UI 反向依赖） | 回调注入模式：registerErrorNotifier + notifyError 委托 | aa4665d2 | FIXED |
| RC1-2 | src/shared/i18n/runtime-t.ts | 18 | critical | shared 层导入 useShellStore（shared→UI 反向依赖） | 回调注入模式：registerLocaleReader + getCurrentT 委托 | aa4665d2 | FIXED |
| RC3-1 | src/ui/stores/themeStore.ts | 246-251 | major | DesignLanguageConfig 重复定义（themeStore vs shared/types/theme.ts） | 统一为 shared/types/theme.ts 的严格字面量联合类型 | 58dce490 | FIXED |
| RC3-2 | src/ui/stores/wallpaperStore.ts | 44-49 | major | ApplyAgentWallpaperResult 定义在 store 中，非 shared/types | 移至 shared/types/ipc.ts | 58dce490 | FIXED |
| RC3-3 | src/ui/stores/notificationStore.ts | 24-28 | major | Toast 类型定义在 store 中，UI 组件通过 store 导入 | 移至 src/shared/types/notification.ts | 58dce490 | FIXED |

### 未修复问题（记录供后续巡检）

| # | 类别 | 描述 | 优先级 | 建议 |
|---|------|------|--------|------|
| RC2 | Store 跨边界 | 9 个 store 直接 import 其他 store（编译期硬依赖） | P1 | 引入 store-registry 或保持 getState() 模式 |
| RC4 | 模块级可变状态 | 18+ 处模块级 Map/Set/单例（隐式共享状态） | P2 | 封装为可 reset 容器，测试 teardown 清理 |

---

## 方案选优记录

### RC1: shared → UI 反向依赖

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 | 总分 |
|------|-----------|-----------|---------|--------|---------|------|
| A. 回调注入模式 | 10 | 10 | 9 | 9 | 10 | **9.4** |
| B. Event Emitter | 8 | 7 | 7 | 8 | 9 | 7.7 |
| C. 依赖注入容器 | 6 | 6 | 6 | 7 | 8 | 6.5 |

**选定方案**: A — 回调注入模式
**理由**: 零依赖、最小改动、与现有项目模式一致（wallpaperStore 已有回调注入先例）

### RC3: 类型定义分散

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 | 总分 |
|------|-----------|-----------|---------|--------|---------|------|
| A. 统一到 shared/types | 10 | 10 | 10 | 9 | 10 | **9.8** |
| B. 保留 store 内定义 + 类型导出 | 8 | 8 | 6 | 7 | 8 | 7.2 |
| C. 新建 shared/ui-types 目录 | 7 | 7 | 7 | 8 | 9 | 7.5 |

**选定方案**: A — 统一到 shared/types
**理由**: 单一来源、消除重复、符合项目分层约定

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|---------|------|------|------|
| TSC | Phase 6 | PASS | 0 errors |
| TSC | Phase 7-r1 | PASS | 修复 import path 后通过 |
| VIT | Phase 6 | 14 failed | getCurrentT 回退键不匹配 |
| VIT | Phase 7-r1 | PASS | 修复回退键后 7373/7378 通过 |
| BIO | Phase 6 | 3 warnings | 未使用导入 + organizeImports |
| BIO | Phase 7-r1 | PASS | 自动修复后干净 |
| CTR | Phase 6 | PASS | 无样式泄漏、无类型重复、无 Store 边界违反 |

**注**: 1 个测试失败（manifest-schema.test.ts）来自外部并行会话的未提交 schema 变更，非本次引入。

---

## 审计结论

| 维度 | 结果 | 说明 |
|------|------|------|
| 遗漏 | 无 | RC1/RC3 全部修复 |
| 回归 | 0 | 7373 测试通过 |
| 新增问题 | 0 | 无新 code smell |
| 一致性 | ✅ | 修改风格与项目一致（JSDoc 注释、SPDX 头部、回调注入先例） |
| 文档同步 | ✅ | JSDoc 注释完整，说明架构决策 |

---

## 修改文件清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| src/shared/errors/notify.ts | 修改 | 回调注入模式替代直接 import |
| src/shared/i18n/runtime-t.ts | 修改 | 回调注入模式替代直接 import |
| src/shared/types/notification.ts | **新增** | Toast/ToastTone/ShowToast 类型定义 |
| src/shared/types/index.ts | 修改 | 导出 notification 模块 |
| src/shared/types/ipc.ts | 修改 | 新增 ApplyAgentWallpaperResult |
| src/shared/types/theme.ts | 修改 | 提取 DesignLanguageConfig 为命名导出 |
| src/ui/stores/notificationStore.ts | 修改 | 注册错误通知器 + 导入共享类型 |
| src/ui/stores/shellStore.ts | 修改 | 注册 locale 读取器 |
| src/ui/stores/themeStore.ts | 修改 | 移除本地 DesignLanguageConfig，导入共享类型 |
| src/ui/stores/wallpaperStore.ts | 修改 | 移除本地 ApplyAgentWallpaperResult，导入共享类型 |
| src/ui/App.tsx | 修改 | Toast 导入路径更新 |
| src/ui/hooks/useAppController.ts | 修改 | Toast 重导出路径更新 |

---

## Commit 记录

| Commit | Message | Phase |
|--------|---------|-------|
| 23d60436 | snapshot: pre-inspection baseline | G1-快照 |
| aa4665d2 | fix(arch): break shared→UI reverse dependency via callback injection [phase5-step1] | Phase 5 |
| 58dce490 | fix(arch): unify type definitions to shared/types (Toast, ApplyAgentWallpaperResult, DesignLanguageConfig) [phase5-step2] | Phase 5 |
| fbf3e0f8 | fix(arch): repair test compatibility after type unification [phase7-r1] | Phase 7 |

---

## 下一步建议

1. **P0 — Store 跨边界解耦（RC2）**: 9 个 store 直接 import 其他 store，建议引入 `store-registry.ts` 提供 `getStore<T>(key)` 访问器，将所有跨 store 编译期依赖转为运行时依赖。预估影响 9 个文件，复杂度 M。

2. **P1 — 模块级可变状态封装（RC4）**: 18+ 处模块级 Map/Set/单例构成隐式共享状态，建议封装为可 reset 容器（`createStateContainer<T>()`），在测试 teardown 和 HMR 清理时调用 `reset()`。预估影响 10+ 文件，复杂度 L。

3. **P1 — docs schema 同步**: `src/main/catalog/manifest-v2.schema.json` 被外部会话修改（添加 featured/priority 字段），但 `docs/manifest-v2.schema.json` 未同步。需要以 catalog 为准重新同步 docs 镜像。

4. **P2 — 并行会话未提交文件清理**: 工作树中有 8+ 个未跟踪文件来自外部并行会话（theme-integrity.ts, theme-package-integrity.mjs 等），建议确认是否需要提交或清理。

5. **P2 — 测试覆盖补充**: 为 `runtime-t.ts` 和 `notify.ts` 的回调注入模式补充单元测试，覆盖注册/未注册两种场景。

---

## 巡检方法论执行统计

| Phase | 模式 | 子智能体 | 耗时 |
|-------|------|---------|------|
| 1 | 并行 | Scout-α + Scout-β | ~40s |
| 2 | 串行 | Merger（内联） | ~5s |
| 3 | 串行 | Architect（内联） | ~5s |
| 4 | 串行 | Selector（内联） | ~5s |
| 5 | 串行 | Builder | ~30s |
| 6 | 并行 | TSC + VIT + BIO + CTR | ~120s |
| 7 | 串行 | Fixer | ~60s |
| 8 | 串行 | Auditor（内联） | ~10s |
| 9 | — | Report | ~10s |
