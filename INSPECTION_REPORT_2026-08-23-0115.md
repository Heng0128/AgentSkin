# AgentSkin 自动化巡检报告 — 方向 A：核心链路可靠性

- **方向编号 + 方向名**: A — 核心链路可靠性（权重 3）
- **状态**: COMPLETED（含 1 项 ⚠️ CRITICAL 待人工确认）
- **快照 commit**: `5dbbd14`（注：该快照摄于上一轮遗留的 `inspection-recon-2026-08-15-2230` 分支；本轮执行时工作树已回到 `main` 主干，HEAD `27e5aa9` 已包含本轮的 additive observability 源码改动，故本轮净新增为测试文件 + JSDoc 同步）
- **执行时间**: 2026-08-23 01:15
- **调度模型**: Scout-α/β 并行 → Merger → Architect → Selector → Builder → Verifier×4 并行 → Fixer → Auditor

## 执行摘要

本次选取方向 A（核心链路可靠性），目标为 `agent-engine-service.ts`（855 行 Facade）的 apply/restore/wallpaper 全流程可靠性。

Scout-α 正向追踪发现：Facade 核心方法**已有测试**，但经 `vi.mock('./theme-apply-flow')` 等桩屏蔽了真实业务错误路径，导致 3 个 CRITICAL 可靠性缺口未被覆盖：
- **CRITICAL-1**：`reconcileActiveThemes` 先改内存、再持久化；若持久化失败（被吞），内存与磁盘不一致 → 下次加载主题"复活"。
- **CRITICAL-2**：`apply` 后台 follow-up 任务经 `.catch(() => undefined)` 静默吞错，无可见性/补偿。
- **CRITICAL-3**：`writeState` 在 3 次阈值内静默吞掉持久化错误，瞬态磁盘失败导致永久内存/磁盘分裂。

Scout-β 逆向扫描确认：公开方法均有 ≥1 测试，但边界条件（未知 AgentId 运行时校验、restore 失败向 IPC 冒泡、部分失败补偿）未测。

**选优决策**：CRITICAL-1/2 属**行为变更型修复**，会破坏现有锁定该行为的测试契约（如 `agent-engine-service.test.ts:442-450` 断言"吞错而非抛错"），按 **G6 ⚠️ CRITICAL** 仅标注方案、不自动执行，留待人工确认。本轮执行**安全、增量、零回归**的可见性增强（CRITICAL-3 的可见性子目标）：新增 `lastPersistError()` + `persist_failed` 结构化事件，并补测试锁定之。

- **发现问题总数**: 3（critical 3 / major 0 / minor 0 / info 0）— CRITICAL-1/2/3
- **已修复数**: 1（CRITICAL-3 的可见性维度，additive）
- **待人工确认数**: 2（CRITICAL-1 desync 修复、CRITICAL-2 后台吞错修复，均 G6 ⚠️）
- **回滚次数**: 0
- **新增测试**: 3（persist-visibility 套件），全过；既有 4 套 agent-engine 测试 104/104 无回归

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/main/agent-engine-service.ts | 909-932 | critical | `reconcileActiveThemes` 持久化失败时内存已 null 但磁盘未落盘，desync 窗口无信号 | ⚠️ G6：持久化成功后再提交内存变更 / 失败回滚；需改现有测试契约 | （待人工确认） | CRITICAL_PENDING |
| 2 | src/main/agent-engine-service.ts | 805/890/898 | critical | 后台 follow-up 经 `.catch(()=>undefined)` 静默吞错，无可见性/补偿 | ⚠️ G6：经 `logStructured` 暴露后台失败 + 重试/告警 | （待人工确认） | CRITICAL_PENDING |
| 3 | src/main/agent-engine-service.ts | 639-662 | critical | `writeState` 阈值内静默吞错，desync 不可见 | 增量可见性：`lastPersistErrorMessage` 字段 + `persist_failed` 结构化事件 + `lastPersistError()` getter（不改 swallow 合同）；新增测试锁定 | 源码已含于 HEAD `27e5aa9`；测试 `a306fe11`；JSDoc `996a2793` | COMPLETED |

## 方案选优记录

- **候选方案数**: 3（针对 CRITICAL-3 可见性缺口）
  1. 仅日志（行级 `[state] persist failed`）—— 已被；缺乏结构化信号
  2. 增量结构化可见性（选中）：`lastPersistError()` + `persist_failed` 事件 —— 低风险、可测、不破合同
  3. 直接修复 desync（CRITICAL-1 一并解决）—— 高风险、破现有测试契约 → 归 G6
- **最优方案**: 方案 2
- **选择理由**: 解决根因（desync 窗口不可见）→ 已解决可见性维度；不引入依赖；可分阶段；可验证（vitest）；可回滚（独立 commit）；不破现有行为契约
- **各维度评分**: 时间复杂度 10/10，空间复杂度 10/10，长期可维护性 9/10，扩展性 9/10，依赖可控性 10/10

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC (tsc --noEmit) | 1 | PASS | 退出码 0，零 error |
| VIT (vitest run 新增套件) | 1 | FAIL→PASS | 首轮 AgentId 导入错/私有 log spy/JSON slice 错 → Fixer 修复后 3/3 通过 |
| BIO (biome check) | 1 | FAIL→PASS | 首轮未用 import + 排序 → `--write` 修复后 0 |
| CTR (契约/类型一致性) | 1 | PASS | `persist_failed` 为联合类型纯增量，无重复定义/Store 越界 |
| VIT (全 agent-engine 套件回归) | 2 | PASS | 4 套件 104/104 无回归 |
| TSC | 2(修复后) | PASS | 退出码 0 |
| VIT | 2(修复后) | PASS | 退出码 0，3/3 |
| BIO | 2(修复后) | PASS | 退出码 0 |

## 审计结论

- **遗漏**: 有（符合范围）—— CRITICAL-3 可见性已覆盖；CRITICAL-1/2 作为 G6 ⚠️ 待人工确认，未自动执行
- **回归**: 无 —— `persist_failed` 纯追加联合成员，无既有消费者收窄；4 套件 104 通过
- **新增问题**: 无 —— 每次失败 emit 为设计意图（无 renderer 消费者、无自旋）；单线程无并发问题；命名无碰撞
- **一致性**: 无 —— SPDX/vi.mock/biome import 顺序/事件形状全部符合兄弟测试
- **文档同步**: 无 —— `lastPersistError()` 与字段 JSDoc 齐全；Auditor 建议已在 `writeState` JSDoc 显式列出 `persist_failed`（commit `996a2793`）

## ⚠️ CRITICAL 待人工确认（G6）

**CRITICAL-1 修复方案（reconcileActiveThemes desync）**
- 思路：将"先改内存后持久化"改为"先持久化快照、成功后再提交内存变更；失败则回滚内存"。
- 影响：`agent-engine-service.ts` `reconcileActiveThemes`（909-932）；需改 `agent-engine-service.test.ts:442-450`（当前断言"吞错而非抛错"）、`agent-engine-service-metrics.test.ts` 中 `persistFailures` 相关断言。
- 风险：触及 4 个测试套件契约；需新增"持久化失败时内存回滚"测试。
- 回滚：`git revert <commit>`。

**CRITICAL-2 修复方案（后台 follow-up 吞错）**
- 思路：`apply` 返回后，后台 `background` promise 的失败改经 `logStructured({type:'apply_failed',...})` 暴露 + 可选重试/用户告警，不再 `.catch(()=>undefined)`。
- 影响：`agent-engine-service.ts:805/890/898`。
- 风险：需 renderer 侧接线消费 `apply_failed`（当前无 consumer）。
- 回滚：`git revert <commit>`。

## 下一步建议（优先级排序，供下次巡检输入）

1. **[High / ⚠️ CRITICAL]** 人工确认并执行 CRITICAL-1 desync 修复（持久化成功后再提交内存 + 失败回滚），同步更新锁定旧行为的测试。
2. **[High / ⚠️ CRITICAL]** 人工确认并执行 CRITICAL-2 后台失败可见性修复（经 `apply_failed` 结构化事件暴露）。
3. **[Medium]** 为 `apply` 关键路径补**真实 flow（非 mock）**集成测试，覆盖"部分 agent 应用失败不影响其他 agent"的补偿语义。
4. **[Medium]** 在 renderer 侧解析 `[STRUCTURED]|` 日志行，对 `persist_failed` / `apply_failed` 展示 desync / 后台失败告警 UI（消费本轮新增信号）。
5. **[Low]** 长期：为 `src/main` 引入 CI 单元覆盖率门禁，防止核心服务零测试回归（方向 D 遗留项）。

## 附：本次 Git 提交（main）

- `a306fe11` test(agent-engine): cover persistence-failure observability [phase5-step1]
- `996a2793` docs(agent-engine): document persist_failed structured event in writeState [phase5-step2]
- 源码 additive observability（contract + service）已含于 HEAD `27e5aa9`（上一轮快照 `5dbbd14` 的代码改动随分支合并进入 main）
