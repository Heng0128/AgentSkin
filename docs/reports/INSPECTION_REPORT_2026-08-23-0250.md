# AgentSkin 自动化巡检报告 — 方向 F：架构正交

- **方向编号 + 方向名**: F — 架构正交（权重 2）
- **状态**: COMPLETED（含 1 项 ⚠️ CRITICAL 待人工确认 + 若干 future 待办）
- **快照 commit**: `178cd7e6`
- **执行时间**: 2026-08-23 02:50
- **调度模型**: Scout-α/β 并行 → Merger → Architect → Selector → Builder → Verifier×4 并行 → Fixer → Auditor

## 执行摘要

本次选取方向 F（架构正交）：循环依赖、公共类型重复、Store 跨边界调用。

Scout-α 正向追踪 + Scout-β 逆向扫描，共发现 1 个 CRITICAL、多个 MAJOR/MINOR 正交性问题。经 Merger 聚类为 3 个根因（RC1 边界逃逸/硬路径耦合、RC2 公共类型重复、RC3 main-context↔bundle-ipc 运行时环）。

**选优决策**：本轮执行 RC1 中**最安全、最高 ROI** 的子项 —— F-2（scanner 域 13 处深层相对 `../../../../shared/...` 导入 → `@shared` 别名）。其余高/中风险项按范围与风险分层处置：
- F-1（`theme-ipc.ts` 越界引用 engine 内部 `.mjs`）属 **G6 ⚠️ CRITICAL**，修复需改动 `src/engine` 公共 API，超出 `src/main` 编辑范围 → 留作独立后续。
- AgentId/ThemeColors 重复、`main-context` 环 → 标记 future，非本轮范围。

- **发现问题总数**: 6（critical 1 / major 3 / minor 2 / info 0）
- **已修复数**: 1（F-2，含连带 alias 配置补全）— 实际变更 13 源文件 + 2 配置文件 + 3 测试文件，0 逻辑改动
- **待人工确认数**: 1（F-1 ⚠️ CRITICAL）
- **回滚次数**: 0
- **全量回归**: TSC 0；VIT 全 `main` 项目 100+ 文件全绿；BIO 0；CTR 0

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/main/services/scanner/** (13 文件) | 顶部 import | major | 13 处 `../../../../shared/...` 深层相对导入，main 知悉 shared 目录拓扑，正交性差 | 全部改为 `@shared/...` 别名（已为项目既定风格，UI 151+ 处、main `selector-validator.ts:28` 已用） | `38bba751` + `a3661fa8` | COMPLETED |
| 2 | vitest.config.ts | 48-52 | major | main 项目缺 `@shared` alias，导致上述迁移后 scanner 测试解析失败 | main 项目 resolve.alias 补 `'@shared': src/shared`（与 ui 项目一致） | `43ef7e05` | COMPLETED |
| 3 | electron.vite.config.ts | 39-43 | minor | main 构建段缺 `@shared` alias（仅 vitest/ui 有），生产构建路径潜在发散风险（Auditor 发现） | main 构建段 resolve.alias 补 `'@shared'` | `c63fc66b` | COMPLETED |
| 4 | src/main/ipc/theme-ipc.ts | 18 | critical | 越界 `import {...} from '../../../src/engine/src/theme/package.mjs'` 直穿 engine 内部 `.mjs` | ⚠️ G6：需 engine 在公开入口 re-export 常量，main 改 `@agentskin/engine/theme`；涉 `src/engine` 公共 API | （待人工确认） | CRITICAL_PENDING |
| 5 | src/main/theme-asset/adapt/registry.ts + index.ts | 7-16 / 16 | major | `AgentId` fork 重定义并经 `theme-asset/index.ts` 对外重导出，与 canonical `src/shared/types/agent.ts` 重复 | future：统一到 shared canonical | （future） | PENDING |
| 6 | src/main/main-context.ts ↔ ipc/bundle-ipc.ts | 12 / 27 | major | 运行时值级导入环（init 顺序脆弱） | future：解耦 | （future） | PENDING |
| 7 | ThemeColors (main vs shared) | — | minor | 近似重复类型 | future：去重 | （future） | PENDING |
| 8 | engine↔shared 常量副本 (MAX_THEME_PACKAGE_BYTES) | — | major | 同源 F-1，engine 与 main 各持一份 | future：随 F-1 一并处理 | （future） | PENDING |

## 方案选优记录

- **候选方案数**: 3（针对 RC1 边界逃逸/硬路径耦合）
  1. 仅修 F-2 scanner 别名迁移（选中）：S 复杂度，零逻辑改动，全量可验证
  2. 全量消减深层相对（含 engine 边界）：XL，涉 engine 公共 API，风险高
  3. 引入 madge CI 门禁自动检测环：M，需 CI 改造
- **最优方案**: 方案 1
- **选择理由**: 解决根因（main 知悉 shared 目录拓扑→正交性弱）核心子项；不引入依赖；可分阶段；可验证（tsc+vitest）；可回滚（独立 commit）
- **各维度评分**: 时间复杂度 10/10，空间复杂度 10/10，长期可维护性 9/10（统一别名风格），扩展性 9/10，依赖可控性 10/10

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (tsc --noEmit) | 1 | PASS | 退出码 0，零 error |
| VIT (vitest run scanner) | 1 | FAIL→PASS | 首轮 `@shared` 未解析（main 项目缺 alias）→ Fixer 补 alias 后 5 文件 43 测通过 |
| BIO (biome check) | 1 | FAIL→PASS | 首轮 import 排序 → `--write` 后 0 |
| CTR (契约/类型一致性) | 1 | PASS | 纯 import 路径替换，无类型重复/Store 越界 |
| VIT (全 main 项目回归) | 2 | PASS | 100+ 文件全绿，无回归 |
| TSC | 2(修复后) | PASS | 退出码 0 |
| VIT (scanner) | 2(修复后) | PASS | 43 测通过 |
| BIO | 2(修复后) | PASS | 退出码 0 |

## 审计结论

- **遗漏**: 有（预期内）—— F-2 完全解决；F-1/AgentId/ThemeColors/环/engine 副本 均为 future pending（非本轮范围，已正确标注）
- **回归**: 无 —— 仅 import 路径替换 + 排序；alias 仅新增未改既有；scanner 运行时逻辑零改动；全 main 测试无回归
- **新增问题**: 无（1 监控项）—— `@shared` 在 tsc/vitest/ui-vite 三处一致；Auditor 指出 `electron.vite.config` main 段原缺 `@shared`（本轮已补全，消除发散风险）；无 npm 遮蔽；`root` 指向正确
- **一致性**: 无 —— `@shared` 为既定风格；biome 排序与项目一致
- **文档同步**: 无 —— 纯 import 变更，无 API/JSDoc 变更

## ⚠️ CRITICAL 待人工确认（G6）

**F-1 修复方案（engine 边界逃逸）**
- 思路：`src/engine/src/theme/index.mjs`（或 `package.json` exports）显式 `export { MAX_THEME_PACKAGE_BYTES }`；`src/main/ipc/theme-ipc.ts:18` 改为 `import { MAX_THEME_PACKAGE_BYTES } from '@agentskin/engine/theme'`，删除直穿 engine 内部 `.mjs` 的硬路径。
- 影响：`src/engine`（公共 API/exports 契约）+ `theme-ipc.ts`。
- 风险：改动 engine 包发布契约；需同步更新 `vitest.config.ts` 的 `'@agentskin/engine/theme'` alias（现有 `'@agentskin/engine/theme'` 已在 line 13）。
- 回滚：`git revert <commit>`。
- 说明：本项**需要编辑 `src/engine`**，超出本次 `src/main` 范围，正确留作独立后续，不与 scanner 正交性修复耦合。

## 下一步建议（优先级排序，供下次巡检输入）

1. **[High / ⚠️ CRITICAL]** 人工确认并执行 F-1：engine 公开 re-export 常量 + main 改用 `@agentskin/engine/theme`（涉 `src/engine` 公共 API）。
2. **[Medium]** 统一 `AgentId` 到 canonical `src/shared/types/agent.ts`：移除 `theme-asset/adapt/registry.ts` 的 fork 重导出，调用方改引 `@shared/types/agent`。
3. **[Medium]** 解耦 `main-context.ts ↔ ipc/bundle-ipc.ts` 运行时环（延迟/注入依赖，消除 init 顺序脆弱）。
4. **[Low]** 去重 `ThemeColors` 近似类型；将 engine↔shared 常量副本随 F-1 一并收敛到单一来源。
5. **[Low]** 引入 `madge` 循环依赖 CI 门禁（方向 F 候选方案 3），防止新增环回归。

## 附：本次 Git 提交（main）

- `178cd7e6` snapshot: pre-inspection baseline [F-arch-orthogonality]
- `38bba751` refactor(scanner): migrate deep relative shared imports to @shared alias [phase5-step1]
- `a3661fa8` refactor(scanner): migrate test shared imports to @shared alias [phase5-step2]
- `43ef7e05` fix(vitest): add @shared alias to main project for orthogonality [phase5-step3]
- `c63fc66b` fix(build): add @shared alias to main build segment to match vitest/ui [phase5-step4]
