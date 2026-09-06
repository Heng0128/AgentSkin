# AgentSkin 深度巡检报告

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | B |
| 方向名 | 注入性能与可观测化 |
| 状态 | **COMPLETED** |
| 执行时间 | 2026-08-29 04:00 |
| 快照 commit | `84cab05f` |
| 选取理由 | 加权随机 (hour=4, 4 mod 22=4 → B 区间) |
| F 方向回避 | F 连续 2 次 COMPLETED，本次降权为 0 |

---

## 执行摘要

| 指标 | 值 |
|------|-----|
| 发现问题总数 | 27（去重后） |
| Critical | 0 |
| Major | 12 |
| Minor | 13 |
| Info | 2 |
| **已修复 Major** | **9 / 12** |
| 已修复 Minor | 0 |
| 待人工确认 | 0 |
| 回滚次数 | 0 |
| 新增 commits | 6（5 phase5 + 1 audit fix） |

---

## 根因与修复明细

| # | 根因 | 严重级 | 问题数 | 方案 | 修复 commit | 状态 |
|---|------|--------|--------|------|------------|------|
| RC1 | CDP 会话类型不安全强转 | major | 2 | 运行时 session.on/off 检查 | `740237bc` | ✅ FIXED |
| RC2 | 模块级可变状态泄漏 (acquireLocks) | major | 4 | invalidateEpoch + dispose 清理锁 Map | `b1c68c65` | ✅ FIXED |
| RC3 | CDP evaluate 结果无 type-guard | major | 5 | 结构化 type-guard (verifyTheme + apply-baseline) | `fe250645` | ✅ FIXED |
| RC4 | 性能追踪数据不完整 | major+minor | 4 | 统一 hrtime 时钟源 + IPC 监听器 dispose wiring | `8b292498` + `9e9d63a9` | ✅ FIXED |
| RC5 | health-monitor 活性检查缺失 | major | 1 | consecutiveEvalFailures 计数器 + 自动停止 | `72c54e24` | ✅ FIXED |
| RC6 | 魔法数字和硬编码超时 | minor | 3 | 未修复（低优先级） | — | ⏸️ DEFERRED |

---

## 发现与修复明细表

| # | 文件 | 严重级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|--------|---------|---------|------------|------|
| 1 | session-pool.ts:158 | major | acquireLocks Map 在 epoch 淘汰时未清理 | clearAgentAcquireLocks + dispose 清理 | `b1c68c65` | ✅ |
| 2 | performance-recorder.ts:283 | major | finishedAt 混用 Date.now() 和 hrtime | 统一使用 startedAt + totalDuration | `8b292498` | ✅ |
| 3 | performance-ipc.ts:75 | major | subscribeTrace 返回值未保存 | 返回 { dispose } + 接入 ctx.disposables | `8b292498` + `9e9d63a9` | ✅ |
| 4 | cdp-client.ts:370 | major | connectCdp 计时空操作 | 未修复（需架构改动，agentId 缺失） | — | ⏸️ |
| 5 | reload-watchdog.ts:141 | major | CdpSession 强转 EventCdpSession | 运行时 session.on/off 检查 + log | `740237bc` | ✅ |
| 6 | health-monitor.ts:131 | major | 死会话无限循环 evaluate | consecutiveEvalFailures=3 自停止 | `72c54e24` | ✅ |
| 7 | inspect-session.ts:92 | major | EventCdpSession 强转 | 运行时检查 + throw Error | `740237bc` | ✅ |
| 8 | injection/shared.ts:95 | major | verifyTheme 无 type-guard | isThemeVerification 结构验证 | `fe250645` | ✅ |
| 9 | apply-baseline.ts:214 | major | captureBaseline 无 type-guard | isBaselineProbeResult 结构验证 | `fe250645` | ✅ |
| 10 | session-pool.ts:124 | major | unknownTargetCounter 模块级状态 | 未修复（低风险，需配合 unknownTargetCounter wrap 修复） | — | ⏸️ |
| 11 | reload-watchdog.ts:101 | major | watchdogs Map 模块级状态 | 未修复（需测试配合添加 cleanup） | — | ⏸️ |
| 12 | cdp-fanout.ts:188 | minor | connectWithRetry 硬编码魔法数字 | 未修复（低优先级） | — | ⏸️ |
| 13 | apply-baseline.ts:307 | minor | connectCdp 3000ms vs 4000ms 不一致 | 未修复 | — | ⏸️ |
| 14 | cdp-reconnect.ts:155 | minor | commandQueue 无界增长 | 未修复（低优先级） | — | ⏸️ |
| 15-27 | 其他 minor/info | minor/info | TODO 注释、空快照回滚、错误消息不一致等 | 未修复 | — | ⏸️ |

---

## 方案选优记录

| 根因 | 候选方案数 | 最优方案 | 选择理由 |
|------|-----------|---------|---------|
| RC1 | 3 | A: 运行时类型检查 | 成本低、根因消除、零破坏 |
| RC2 | 3 | C: acquireLocks 泄漏清理 | M 改动、高稳定性 |
| RC3 | 3 | C: 仅修关键路径 (verifyTheme + apply-baseline) | 改动最小化、高价值 |
| RC4 | 3 | B: 时间源 + 监听器 | 高可观测性价值 |
| RC5 | 3 | B: 异常捕获自停止 | 最小改动、高价值 |
| RC6 | 3 | C: 不修复 | 低优先级 |

**评分维度** (时间复杂度 20% / 空间复杂度 15% / 长期可维护性 25% / 扩展性 20% / 依赖可控性 20%)

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| Verifier-TSC | 1 | ✅ PASS | 修改文件零错误（预存错误来自外部并行会话） |
| Verifier-VIT | 1 | ✅ PASS | 7674/7675 通过（1 个 flaky timing test，隔离运行通过） |
| Verifier-BIO | 1 | ✅ PASS | 8 个修改文件全部通过 |
| Verifier-CTR | 1 | ✅ PASS | 无样式泄漏、无类型重复、无 Store 跨边界 |

---

## 审计结论

| 维度 | 结果 | 说明 |
|------|------|------|
| 遗漏 | ⚠️ 有 | 3 个 Major 未修复（connectCdp 计时空操作、unknownTargetCounter、watchdogs Map） |
| 回归 | ✅ 无 | 修改严格限定在 9 个文件内 |
| 新增问题 | ⚠️ 有 | N-1 (MEDIUM): dispose 未 wiring → **已修复** (`9e9d63a9`) |
| 一致性 | ✅ 通过 | 风格与项目完全一致 |
| 文档同步 | ✅ 通过 | JSDoc 已同步更新 |

**测试缺口**（按优先级排序）：
1. RC5 `consecutiveEvalFailures` 自止（health-monitor.test.ts 缺失）
2. RC3 type-guard 拒绝路径（verify-theme.test.ts 缺失边界 JSON 测试）
3. RC4 `dispose` 行为（performance-ipc.test.ts 缺失）
4. RC4 `finishedAt === startedAt + duration` 精确等式断言

---

## 修改文件清单

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| src/main/cdp/injection/health-monitor.ts | 新增 consecutiveEvalFailures + 自止 | +28/-1 |
| src/main/services/performance/performance-recorder.ts | 移除 wallClockStart + 统一时钟 | +10/-8 |
| src/main/ipc/performance-ipc.ts | 返回 { dispose } + JSDoc | +18/-2 |
| src/main/ipc/index.ts | 接入 ctx.disposables | +5/-1 |
| src/main/cdp/session-pool.ts | 新增 clearAgentAcquireLocks + dispose 清理 | +23/-0 |
| src/main/cdp/injection/shared.ts | isThemeVerification type-guard | +34/-2 |
| src/main/cdp/apply-baseline.ts | isBaselineProbeResult type-guard | +37/-2 |
| src/main/cdp/inspect-session.ts | session.on/off 类型检查 | +7/-0 |
| src/main/cdp/reload-watchdog.ts | session.on/off 类型检查 | +8/-0 |

**总改动**: 9 文件, +170/-16 行

---

## 下一步建议

1. **[P1] 补充 RC5 health-monitor 单元测试** — 覆盖 consecutiveEvalFailures 自止逻辑、performCheck try/catch 路径
2. **[P1] 补充 RC3 type-guard 拒绝路径测试** — 验证 `{"adoptedSheetCount": "four"}` / `null` / `{}` 等边界输入返回 null
3. **[P2] 修复 cdp-client.ts:370 connectCdp 计时空操作** — 需要为 connectCdp 添加 agentId 参数（涉及 RFC §4.9 合规）
4. **[P2] session-pool unknownTargetCounter 回绕保护** — 添加 wrap 后的 key 冲突检测
5. **[P3] magic number 常量化** — 将 cdp-fanout、apply-baseline、cdp-reconnect 中的硬编码超时提取到 constants

---

## Git 历史

```
9e9d63a9 fix(ipc): wire up performance-ipc dispose to ctx.disposables [audit-fix-n1]
740237bc fix(cdp): add runtime type check for EventCdpSession cast [phase5-step5]
fe250645 fix(injection): add structural type-guard for CDP evaluate results [phase5-step4]
b1c68c65 fix(session-pool): clear acquireLocks on epoch invalidation + dispose [phase5-step3]
8b292498 fix(performance): unify timing source + capture IPC unsubscribe [phase5-step2]
72c54e24 fix(health-monitor): add consecutive eval failure detection + auto-stop [phase5-step1]
84cab05f snapshot: pre-inspection baseline [direction B]
```
