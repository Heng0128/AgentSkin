# 巡检报告 2026-08-26-0900

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | B |
| 方向名 | 注入性能与可观测化 |
| 权重 | 2 |
| 状态 | COMPLETED |
| 快照 commit | b7933e29 |
| 随机数 | 5/21 |
| 执行时间 | 2026-08-26 09:00 |

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 20（去重后） |
| Critical | 1 |
| Major | 10 |
| Minor | 8 |
| Info | 1 |
| 已修复 | 18 |
| 部分修复 | 2 |
| 待人工确认 | 0 |
| 回滚次数 | 0 |
| 独立 commits | 22 |
| 修改文件数 | 28 |
| 净代码变化 | +774/-156 |

## 方向描述

**注入性能与可观测化**：关注 CDP 连接复用、Apply Trace 结构化埋点、performance-ipc 数据闭环。

## 发现与修复明细

### RC1 — Session Pool 生命周期完整性与安全阀缺失 (Critical→Fixed)

| # | 文件 | 行号 | 严重度 | 问题 | 修复方案 | Commit |
|---|------|------|--------|------|---------|--------|
| B-02 | session-pool.ts | 246 | major | 容量守卫在 open() 之后才检查上限 | 容量守卫前置到 open() 之前 | e61679af |
| M-03 | session-pool.ts | 153/306 | major | 退休会话缺乏强制回收安全阀 | 增加全局 setInterval 定期扫描超龄退休会话 | e61679af |
| M-05 | reload-watchdog.ts | 110 | major | 长寿命 CDP 会话绕过 pool | 改为走 pool.acquire + event delegation | 84e87faa |
| β-05 | session-pool.ts | 123 | major | targetKeyFor 返回 'unknown-target' | 改用递增唯一标识 `unknown-${++counter}` | e61679af |
| B-09 | apply-baseline.ts | 265 | minor | 直接使用 connectCdp 未走 pool | 改为 session-pool.acquire 复用 | 4cd1b2da |

### RC2 — Trace/可观测性信号完整性与正确性缺陷 (Critical→Fixed)

| # | 文件 | 行号 | 严重度 | 问题 | 修复方案 | Commit |
|---|------|------|--------|------|---------|--------|
| M-01 | cdp-client.ts | 407 | critical | connectEventCdp 失败路径 step 名错误 | 修正为 'connectEventCdp' 与成功路径对齐 | 2596e6a4 |
| M-06 | performance-recorder.ts | 392 | major | 单迹模型导致并发 apply 丢失可观测性 | 改为 per-agent trace map | 2596e6a4 |
| B-08 | theme-apply-flow.ts | 637 | major | finishTrace() 在后台任务完成前截断 | 移到 Promise.allSettled 之后 | 22d6f77d |
| B-10 | performance-logger.ts | 187 | minor | 环形缓冲区溢出仅首次警告 | 改为每 100 次溢出周期性警告 | 5d97757b |
| B-11 | performance-ipc.ts | 37 | minor | 仅拉取接口无推送 | 新增 push 通道 subscribeTrace | 2554a3ab |

### RC3 — 批量并发操作的资源所有权与完成信号处理缺陷 (Major→Fixed)

| # | 文件 | 行号 | 严重度 | 问题 | 修复方案 | Commit |
|---|------|------|--------|------|---------|--------|
| B-04 | cdp-fanout.ts | 580 | major | firstSession 双重 releaseSession | 所有权转移语义确保只释放一次 | ddea8924 |
| B-07 | performance-recorder.ts | 392 | major | 单迹并发 | per-agent map 隔离 | 2596e6a4 |
| β-07 | cdp-client.ts | 169 | minor | pending.get 非空断言 | 防御性 null-guard | 5e1d2ace |

### RC4 — Theme 验证与完整性判定过度降级 (Major→Fixed)

| # | 文件 | 行号 | 严重度 | 问题 | 修复方案 | Commit |
|---|------|------|--------|------|---------|--------|
| β-04 | injection-runtime.ts | 70 | major | isThemeFullyApplied layers 缺失时退化 | 新增三值 ThemeApplyVerdict 类型 | 42f05d79 |
| β-09 | injection/shared.ts | 150 | minor | waitForTheme 超时后返回 null | 返回 WaitForThemeResult 含最后验证 | f4ea3427 |

### RC5 — 类型契约漂移与测试覆盖系统性缺口 (Major→Partial)

| # | 文件 | 行号 | 严重度 | 问题 | 修复方案 | Commit |
|---|------|------|--------|------|---------|--------|
| β-08 | cdp-client.test.ts | — | major | 未覆盖 connectEventCdp 错误路径 | 新增 4 个测试（错误路径 + ghost response） | RC5-B |
| β-06 | types.ts | — | minor | 无 schema 快照测试 | 新增 4 个 round-trip 测试 | RC5-B |
| β-10 | contracts | — | info | 无契约测试 | 新增 8 个 round-trip 测试 | RC5-B |

## 方案选优记录

### RC1 — Session Pool 生命周期

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|-----------|-----------|---------|--------|-----------|------|
| A. Pool Gateway | 70 | 75 | 65 | 70 | 75 | 70.75 |
| **B. Fix-in-Place** | **85** | **80** | **75** | **80** | **82** | **80.35** |
| C. Pool Split Short/Long | 60 | 70 | 60 | 65 | 70 | 64.25 |
| D. Safe-Guard Service | 75 | 75 | 70 | 72 | 78 | 73.90 |

**选择方案 B**：最低成本、最细粒度回滚、4 文件 ~200 行

### RC2 — Trace/可观测性

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|-----------|-----------|---------|--------|-----------|------|
| **A. Trace Fix+Push** | **85** | **88** | **90** | **92** | **84** | **87.85** |
| B. Clock+Overflow | 75 | 78 | 72 | 74 | 80 | 75.55 |
| C. Event Sourcing | 60 | 65 | 85 | 70 | 75 | 71.75 |
| D. Telemetry SDK | 40 | 50 | 60 | 55 | 45 | 52.75 |

**选择方案 A**：覆盖全部 5 个缺陷、per-agent map 消除 shadow-trace

### RC3 — 并发所有权

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|-----------|-----------|---------|--------|-----------|------|
| A. RAII Guard | 80 | 82 | 78 | 80 | 82 | 80.20 |
| **B. Counter Audit** | **88** | **85** | **80** | **82** | **80** | **83.05** |
| C. using Declaration | 65 | 75 | 70 | 72 | 75 | 71.15 |
| D. Idempotent Token | 70 | 72 | 68 | 70 | 75 | 70.70 |

**选择方案 B**：最小改动（3 文件 ~80 行）、精确所有权语义

### RC4 — Theme 验证

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|-----------|-----------|---------|--------|-----------|------|
| **A. 3-Tier Verdict** | **88** | **85** | **88** | **85** | **86.75** | **86.55** |
| B. waitForTheme Fix | 95 | 92 | 75 | 80 | 88 | 85.10 |
| C. Pipeline Pattern | 65 | 70 | 60 | 65 | 72 | 65.90 |
| D. Client Negotiation | 72 | 75 | 68 | 72 | 78 | 72.70 |

**选择方案 A**：Boolean→full/partial/failed、向后兼容

### RC5 — 类型契约

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|-----------|-----------|---------|--------|-----------|------|
| **A. Zod Schema+CI** | 82 | 80 | 92 | 88 | 86 | **85.60** |
| B. Test Pyramid | 90 | 88 | 75 | 80 | 92 | 84.10 |
| C. Branded Types | 85 | 82 | 80 | 82 | 85 | 82.80 |
| D. Property Tests | 75 | 78 | 78 | 75 | 80 | 77.30 |

**实际执行方案 B**：避免引入新依赖，纯 Vitest 扩展

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| Verifier-TSC | R1 | PASS | 0 errors |
| Verifier-VIT | R1 | PASS | 4754 passed, 0 failures |
| Verifier-BIO | R1 | PASS | 0 errors |
| Verifier-CTR | R1 | PASS | 类型一致、Store 边界清晰、接口契约一致 |

## 审计结论

| 维度 | 结果 | 发现数 |
|------|------|--------|
| 遗漏检查 | 18/20 完全修复 | 2 部分修复（schema 快照测试缺失） |
| 回归检查 | 通过 | 2 低风险（容量守卫计数含退休会话、无 unsubscribe） |
| 新增问题 | 通过 | 2 低风险（双时钟模式、force-discard 未文档化） |
| 一致性 | 通过 | 符合项目现有风格 |
| 文档同步 | 通过 | JSDoc 完整 |

## Commits 清单

```
f9866d94 fix(session-pool): guard release() against double-decrement
5e1d2ace fix(cdp-client): add null-guard for pending Map waiter
ddea8924 fix(cdp-fanout): transfer firstSession ownership
2596e6a4 refactor(performance): per-agent trace map + unified clock
22d6f77d fix(theme-apply): move finishTrace after backgroundTasks settle
5d97757b fix(performance-logger): periodic overflow warning
2554a3ab feat(performance-ipc): add push channel
b9ee8dfa test(performance): align tests with periodic warning
4cd1b2da fix(cdp/apply-baseline): route through session pool
f10d06ff fix(cdp/inspect-session): route through pool
84e87faa fix(cdp/reload-watchdog): route through pool
d9f40533 fix(cdp): wire session pool through callers
e61679af fix(cdp/session-pool): capacity guard + safety valve + targetKeyFor
42f05d79 fix(injection): add ThemeApplyVerdict three-tier verdict
f4ea3427 fix(injection): waitForTheme returns WaitForThemeResult
d55b4731 fix(hardening): watchdog graded response
d98a7b40 fix(reload-watchdog): graded response
8ffe7796 fix(cdp): update waitForTheme callers
c579cc6b fix(test): update reload-watchdog test for layers
d6670444 docs(report): RC4-A builder report
ee2bb819 docs(report): RC1-B builder report
9ee0f0d0 docs(report): RC2-A builder report
```

## 下一步建议

1. **Add schema snapshot tests** — 为 ThemeApplyTrace、WaitForThemeResult、ThemeVerification 添加 schema 快照测试，防止未来类型契约漂移（中优先级）
2. **Store unsubscribe function** — 为 trace subscription 添加 unsubscribe 路径，防止内存泄漏（低优先级）
3. **Unify waitForTheme timestamps** — 统一为单一单调时间戳，消除双时钟混淆（低优先级）
4. **Document force-discard behavior** — 在 session-pool 模块文档中说明 force-discard 行为的触发条件和影响（低优先级）
5. **Move RC1-A Pool Gateway** — 长期考虑实施 Pool Gateway 模式，统一管理所有 CDP 会话生命周期（需 RFC 评审）
