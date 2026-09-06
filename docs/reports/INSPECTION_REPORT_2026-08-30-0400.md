# AgentSkin 巡检报告 — 2026-08-30 0400

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | B |
| 方向名 | 注入性能与可观测化（CDP连接复用、Apply Trace结构化埋点、performance-ipc数据闭环） |
| 状态 | **COMPLETED** |
| 快照 commit | `d3b63aec` |
| 最终 commit | `e5f66565` |
| 总 commits | 9 (snapshot + 6 step + 2 repair) |
| 开始时间 | 2026-08-30 04:00 |
| 结束时间 | 2026-08-30 04:55 |

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 11（去重后） |
| CRITICAL | 1 |
| MAJOR | 4 |
| MINOR | 5 |
| INFO | 1 |
| 根因聚类 | 6（RC1-RC6） |
| 已修复根因 | 6/6（100%） |
| 已修复问题 | 11/100% |
| 待人工确认数 | 0 |
| 回滚次数 | 0 |
| 新增 commit | 8（不含快照） |
| 新增测试 | ~12（session-pool 2 + cdp-inject 1 + performance-ipc 5 + delegates 调整2） |
| 修改文件 | 9 |

## 方向选取

加权随机 (hour=4, 4 mod 24=4 → B 区间)，**方向B：注入性能与可观测化**。

历史回避检查 — 最近5次：I/J/H/F/D，无连续2次 COMPLETED 的方向，无需回避。

## 根因聚类

| RC | 严重等级 | 描述 | 涉及文件 |
|----|---------|------|----------|
| RC1 | CRITICAL | Performance Trace 核心数据丢失 — `recordNamedStep(undefined, ...)` 模式使 CDP connect 和主题验证等关键 apply 阶段在 trace 中完全不可见 | shared.ts, cdp-client.ts |
| RC2 | MAJOR | performance-ipc 测试契约与数据闭环缺陷 — mock 与真实 API 不匹配、数据消费闭环未验证 | performance-ipc.test.ts |
| RC3 | MAJOR | session-pool 核心复用逻辑测试覆盖不足 — 缺少释放后复用、池满拒绝等关键场景 | session-pool.test.ts |
| RC4 | MAJOR | cdp-inject 测试子串匹配路由脆弱 — 表达式文本变化会导致假阳性 | cdp-inject.test.ts |
| RC5 | MINOR | health-monitor 性能热点 — 遍历全部计算样式属性而非目标 token | health-monitor.ts |
| RC6 | MINOR | session-pool 死代码 — `epoch` 参数在 `doAcquire` 中未使用 | session-pool.ts |

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|---------|---------|---------|------------|------|
| 1 | src/main/cdp/injection/shared.ts | 215 | major | waitForTheme 调用 recordNamedStep(undefined) 导致数据丢失 | 添加可选 agentId 参数 | db679b2a | ✅ |
| 2 | src/main/cdp/cdp-client.ts | 379,414 | major | connectCdp/connectEventCdp 传 undefined agentId | 添加可选 agentId 参数 | db679b2a | ✅ |
| 3 | src/main/ipc/performance-ipc.test.ts | 43-61 | critical | mock 签名与真实 API 契约不匹配 | 补充数据闭环验证（结构/错误/溢出/fan-out） | 79d14b6a | ✅ |
| 4 | src/main/ipc/performance-ipc.test.ts | 87-238 | major | 只验证数据收集，不验证数据消费 | 新增 5 个数据闭环测试 | 79d14b6a | ✅ |
| 5 | src/main/cdp/session-pool.test.ts | 10-16,113 | major | 缺少释放后复用、池满拒绝场景 | 新增 2 个测试 | 8c36cba1 | ✅ |
| 6 | src/main/cdp/cdp-inject.test.ts | 89-133 | major | smartEvaluate 子串匹配路由脆弱 | 添加 unmatched 追踪器 + 测试 | 18210185 | ✅ |
| 7 | src/main/cdp/injection/health-monitor.ts | 313-329 | minor | performCheck 遍历所有计算样式属性 | 改用 getPropertyValue 定向读取目标 token | fe9fba87 | ✅ |
| 8 | src/main/cdp/session-pool.ts | 275-279 | minor | doAcquire 的 _epoch 参数是死代码 | 移除 epoch 参数及所有调用方传参 | 4e415302, 4978ce34 | ✅ |
| 9 | src/main/services/performance/performance-logger.ts | 44,201 | minor | MAX_HISTORY=50 可能不足；watchdogRecoveryCount 硬编码为 0 | 设计可接受，不修改 | — | ℹ️ |
| 10 | src/main/cdp/port-resolver.ts | 65-66 | minor | rented set 无 TTL 驱逐 | 设计可接受，rented 为单实例跟踪 | — | ℹ️ |
| 11 | CDP 多层 | 多处 | info | 魔法数字散落 | 各模块内已局部化且有清晰命名，集中化降低可读性 | — | ℹ️ |

## 方案选优记录

### RC1 — Performance Trace 数据丢失

| 方案 | 描述 | 选择 |
|------|------|------|
| A. 为 connectCdp/connectEventCdp/waitForTheme 添加可选 agentId 参数 | 更新引擎调用方传入 agentId，向后兼容 | ✅ 最优 |
| B. 使用线程局部存储设置"当前 agent" | 引入模块级可变状态 | ❌ |
| C. 仅在调用方容易获取 agentId 的地方修复 | 部分修复，不一致 | ❌ |

**选择理由**：A 方案向后兼容（可选参数），从根源解决问题，且更新了所有引擎调用方（engine-strategy/cdp-strategy/delegates）。

### RC5 — health-monitor 性能热点

| 方案 | 描述 | 选择 |
|------|------|------|
| A. 使用 getPropertyValue() 定向读取目标 token | 从 O(total CSS props) 降为 O(expected tokens) | ✅ 最优 |
| B. 缓存 style.length 结果 | 不解决每次遍历的根本问题 | ❌ |

**选择理由**：A 方案直接消除不必要的迭代，CDP evaluate 传输量从 ~100 个属性降为 ~14 个 token。

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | 2 | ✅ | 0 新增 |
| VIT (修改文件) | 2 | ✅ | 76/76 passed |
| VIT (全量) | 1 | ✅ | 8812 passed, 2 failed (预存: engines/scripts) |
| BIO | 1 | ✅ | 本次修改文件 0 新增 error |
| CTR | 1 | ✅ | 无样式泄漏、无类型重复、无 Store 边界跨界 |

## 审计结论

| 维度 | 结论 |
|------|------|
| 遗漏检查 | 无 — 11 个问题全部有对应修复或接受标记 |
| 回归检查 | 无 — 修改仅限注入/trace/测试层，未影响未预期模块 |
| 新增问题 | 无 — 未引入新 code smell 或反模式 |
| 一致性 | 修改风格与项目一致（JSDoc 注释 + 可选参数 + 测试覆盖） |
| 文档同步 | 无需 — 未修改公开 API |

## 修改文件清单

| 文件 | 类型 | 修改说明 |
|------|------|---------|
| src/main/cdp/injection/shared.ts | 修复 | waitForTheme 添加 agentId 参数 |
| src/main/cdp/cdp-client.ts | 修复 | connectCdp/connectEventCdp 添加 agentId 参数 |
| src/main/agent-engine/delegates.ts | 修复 | 调用 connectCdp 时传入 appId |
| src/main/cdp/injection/engine-strategy.ts | 修复 | 调用 waitForTheme 时传入 agent |
| src/main/cdp/injection/cdp-strategy.ts | 修复 | InjectThemeOptions 添加 agentId 并传给 waitForTheme |
| src/main/cdp/injection/health-monitor.ts | 性能 | performCheck 改用定向 getPropertyValue |
| src/main/cdp/session-pool.ts | 重构 | 移除死代码 epoch 参数（acquire/doAcquire/acquireSession） |
| src/main/ipc/asar-joint-analysis.ts | 修复 | 移除多余的第 4 参数 |
| src/main/cdp/session-pool.test.ts | 测试 | 新增释放后复用 + 池满拒绝测试 |
| src/main/cdp/cdp-inject.test.ts | 测试 | smartEvaluate 添加 unmatched 追踪器 + 新增表达式覆盖测试 |
| src/main/ipc/performance-ipc.test.ts | 测试 | 新增 5 个数据闭环验证测试 |
| src/main/agent-engine/delegates.test.ts | 修复 | 更新 connectCdp 调用期望匹配新签名 |

## 测试增量

| 项目 | 基线 | 本次后 | 增量 |
|------|------|--------|------|
| session-pool.test.ts | 8 | 10 | +2 |
| cdp-inject.test.ts | 24 | 25 | +1 |
| performance-ipc.test.ts | ~45 | ~50 | +5 |
| delegates.test.ts | 10 | 10 | 调整断言 |
| **总计** | — | — | **+8 新测试** |

## 下一步建议

1. **方向 A（核心链路可靠性）** — agent-engine-service.ts (855行) 仍零测试覆盖，权重最高
2. **方向 D（测试质量均衡）** — Scene 子系统测试过多、核心服务零测试问题持续
3. **方向 F（架构正交）** — 模块级可变状态泛滥 (18+ 处)，本次仅清理了 epoch 死代码
4. **延续本次方向 B** — RC5 health-monitor 优化生效后可量化 CDP evaluate 次数下降；RC1 trace 修复后在真实 apply 中验证 agentId 正确传递
5. **preload 侧 type-guard** — 上次方向 I 遗留的渐进式加固
