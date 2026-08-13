# AgentSkin 自动化巡检报告 — 方向 D：测试质量均衡

- **方向编号 + 方向名**: D — 测试质量均衡（权重 3）
- **状态**: COMPLETED
- **快照 commit**: `ac4eeff` (pre-inspection baseline)
- **执行时间**: 2026-08-13 19:40
- **调度模型**: Scout-α/β 并行 → Merger → Architect → Selector → Builder → Verifier×4 并行 → Fixer → Auditor

## 执行摘要

本次巡检选取方向 D（测试质量均衡）。Scout-α 正向追踪发现：类型基线问题已在上一轮 follow-up（cc49ef0）修复，`tsc --noEmit` 现零错误；真正盲区是**核心服务零测试**——`agent-engine-service.ts` 实际已有较完整测试，但 7 个关键委派子模块（theme-apply-flow / theme-restore-flow / app-discovery / theme-installer / cdp 注入与 wallpaper / theme/store）零测试。Scout-β 逆向扫描发现：测试质量整体良好，无假断言、空测试、吞错，仅少量 `expect.anything()`/`as any` 测试桩（minor）。

据此选优锁定 2 个纯函数/无依赖关键路径做精准补测，过程中由测试驱动发现并修复 1 个生产级 bug（未处理 rejection 泄漏）。

- **发现问题总数**: 1（critical 0 / major 1 / minor 0 / info 0）— 即 `PersistChain.safe` 未处理 rejection 泄漏（由测试暴露）
- **已修复数**: 1
- **待人工确认数**: 0
- **回滚次数**: 0
- **新增测试**: 20（theme-installer 9 + agent-engine-persist 11），全部通过

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/main/services/agent-engine-persist.ts | 142 | major | `PersistChain.safe` 用 `void result.finally(...)` 丢弃 rejected promise，写入失败时向进程泄漏未处理 rejection | 改为 `result.catch(() => {}).finally(...)` 挂到吞咽分支，保证链不进入 rejected 且 pending 计数 1:1 递减 | 7fb8bc5 (由并发自动化代提交，含本修复) | COMPLETED |
| 2 | src/main/catalog/theme-installer.ts | 87/109 | info | `parseSemver`/`compareSemver` 为模块私有，无法单测（含 audit #19 prerelease 优先级反转回归点） | 导出两函数（纯增量，无破坏性） | 2ce436e | COMPLETED |
| 3 | src/main/catalog/theme-installer.test.ts | — | info | 关键路径零测试 | 新增 9 例：解析/比较/prerelease 优先级回归/legacy 兜底 | 3e0ecba | COMPLETED |
| 4 | src/main/services/agent-engine-persist.test.ts | — | info | `isPersistedState` 守卫(R6-24) 与 PersistChain FIFO 隔离零测试 | 新增 11 例：字段级校验 + FIFO 顺序 + 拒绝写入隔离 | 2f2fd31 + 50bb22a | COMPLETED |

## 方案选优记录

- **候选方案数**: 3
  1. 全量补测 `agent-engine-service` Facade（XL，需大量 mock）—— 被否：范围过大、风险高、回归面宽
  2. 仅纯函数补测（S，本方案）—— 选中：低风险、高回归价值、确定性
  3. 引入测试覆盖率门禁（M，需 CI 改造）—— 推迟：依赖可控性弱
- **最优方案**: 方案 2 — 导出 2 个纯函数 + 新增 2 个测试文件
- **选择理由**: 解决根因（关键路径零测试）、不引入依赖、可分阶段、可验证（vitest）、可回滚（独立 commit）
- **各维度评分**: 时间复杂度 9/10，空间复杂度 10/10，长期可维护性 9/10，扩展性 8/10，依赖可控性 10/10

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (tsc --noEmit) | 1 | PASS | 退出码 0，零 error |
| VIT (vitest run) | 1 | FAIL→PASS | 首轮 1 未处理 rejection；定位到源 bug，修复后 20/20 通过 |
| BIO (biome check) | 1 | PASS | 退出码 0（修复后格式合规） |
| CTR (契约/类型一致性) | 1 | PASS | 导出为纯增量，无重复定义/Store 越界 |
| TSC | 2(修复后) | PASS | 退出码 0 |
| VIT | 2(修复后) | PASS | 退出码 0，20/20 |
| BIO | 2(修复后) | PASS | 退出码 0 |

## 审计结论

- **遗漏**: 有（符合范围）—— 2 个目标模块完整覆盖；其余零测试核心模块标记为未来工作
- **回归**: 无 —— HEAD 修复完好，未被并发提交 clobber；影响范围严格限定 2 源 + 2 测试
- **新增问题**: 无 —— `PersistChain.safe` 改动经审计确认为正确（无双重递减、调用方可观测失败、链不泄漏）
- **一致性**: 无 —— vitest/SPDX/`as any` 检查均与兄弟测试一致
- **文档同步**: 无 —— `PersistChain.safe` / `isPersistedState` 文档与实现同步准确

## 下一步建议（优先级排序，供下次巡检输入）

1. **[High]** 为 `theme-installer.ts` 含 I/O 的入口（`install`/`installAll`/`buildBundle`/`computeThemeContentHash`）补集成测试，使用临时目录 + `writeJsonAtomic` mock，覆盖降级/损坏包/并发覆盖路径。
2. **[High]** 为 `agent-engine-service.ts` 的 `reconcileActiveThemes` / `detectInstallation` / `applyTheme` 关键路径补 mock 化单测（Facade 分解后模块均已可测）。
3. **[Medium]** 为 `theme-apply-flow.ts` / `theme-restore-flow.ts` 补 apply/restore 全路径单测（Scout-α 标为 critical 盲区之首）。
4. **[Medium]** 引入 CI 覆盖率门禁（方案 3），对 `src/main` 设最低行覆盖阈值，防止零测试模块回归。
5. **[Low]** 解决多自动化并发提交导致的 ref-lock 冲突（本次 `7fb8bc5` 代提交了本巡检的源修复）——建议为各 automation 分配独立分支或串行锁，避免快照/提交互相干扰。

## 附：本次 Git 提交

- `ac4eeff` snapshot: pre-inspection baseline
- `2ce436e` fix(test-quality): export compareSemver/parseSemver [phase5-step1]
- `3e0ecba` test(catalog): cover semver precedence regression (audit #19) [phase5-step2]
- `2f2fd31` test(persist): cover isPersistedState guard + PersistChain FIFO [phase5-step3]
- `7fb8bc5` fix(style): 含 PersistChain.safe 未处理 rejection 修复 [phase7-r1，由并发自动化代提交]
- `50bb22a` test(persist): harden isolation test against unhandled rejection [phase7-r1]
