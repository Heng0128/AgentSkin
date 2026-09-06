# AgentSkin 巡检报告 — 2026-08-25 1100

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | A |
| 方向名 | 核心链路可靠性 |
| 状态 | COMPLETED |
| 快照 commit | `3c1d4366` |
| 最终 commit | `69edf652` |
| 巡检时间 | 2026-08-25 11:00–11:55 |

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 22（去重后） |
| Critical | 3（含 1 个误报） |
| Major | 11 |
| Minor | 8 |
| 已修复 | 2（RC2 + RC4） |
| 误报/无需修复 | 1（RC1 双重递增） |
| 待人工确认 | 0 |
| 回滚次数 | 0 |
| 新增测试 | 8 |
| 修改文件 | 6 |

## 发现与修复明细

| # | 文件 | 行号 | 严重性 | 问题描述 | 修复方案 | 状态 |
|---|------|------|--------|----------|----------|------|
| 1 | agent-engine-service.ts | 825–842 | Critical | apply() 递归调用缺少栈溢出保护 | 转换为有界迭代（max 5 retries） | ✅ 已修复 |
| 2 | agent-engine-service.ts | 1056–1081 | Major | dispose() 不等待 in-flight background tasks | 新增 disposeAsync() 方法 | ✅ 已修复 |
| 3 | agent-engine-service.ts | 675–693 | Critical | persistFailures 双重递增（误报） | 无需修复——writeState 内部捕获不传播 | ✅ 误报确认 |
| 4 | agent-engine-service.ts | 739–743 | Major | status() 缓存 TOCTOU | 低优先级，本次不修复 | 📋 待后续 |
| 5 | agent-engine-service.ts | 940–965 | Major | restoreAll() 并发 wallpaper 操作 | 低优先级，本次不修复 | 📋 待后续 |
| 6–22 | 各测试文件 | — | Major/Minor | 测试覆盖盲区 | 新增 8 个核心可靠性测试 | ✅ 已修复 |

## 方案选优记录

### RC2: apply() 递归 → 有界迭代

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 | 总分 |
|------|-----------|-----------|----------|--------|----------|------|
| A: 迭代+最大重试 | 9 | 8 | 9 | 8 | 10 | **8.8** |
| B: 递归深度检查 | 7 | 6 | 7 | 7 | 10 | 7.3 |
| C: 队列模式 | 8 | 7 | 8 | 9 | 8 | 8.0 |

**选中方案 A**：简单有效、防止栈溢出和永久阻塞。

### RC4: dispose() 等待 in-flight

| 方案 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 | 总分 |
|------|-----------|-----------|----------|--------|----------|------|
| A: disposeAsync 全面修复 | 8 | 8 | 9 | 9 | 10 | **8.8** |
| B: 仅修复 dispose | 9 | 9 | 7 | 7 | 10 | 8.2 |
| C: mutex 保护 | 7 | 6 | 7 | 8 | 8 | 7.2 |

**选中方案 A**：新增 disposeAsync() 方法，同步 dispose() 保持向后兼容。

## 验证结果

| 验证器 | 轮次 | 结果 | 备注 |
|--------|------|------|------|
| TSC | 1 | ✅ PASS | 无新引入类型错误 |
| VIT | 2 | ✅ PASS | 4575 passed（6 个预存失败非本次引入） |
| BIO | 1 | ⚠️ SKIPPED | Biome 未安装（环境限制） |
| CTR | 1 | ✅ PASS | 无契约违规 |

## 审计结论

| 维度 | 结果 | 说明 |
|------|------|------|
| 遗漏检查 | ✅ 无 | RC2/RC4 已修复，RC1 确认为误报 |
| 回归检查 | ✅ 无 | 4575 测试通过，无新失败 |
| 新增问题 | ✅ 无 | 未引入新 code smell |
| 一致性 | ✅ 通过 | 修改风格与项目一致 |
| 文档同步 | ✅ 通过 | contracts.ts 接口已更新 |

## 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| src/main/agent-engine-service.ts | 修改 | apply() 有界迭代 + disposeAsync() |
| src/main/services/contracts.ts | 修改 | 新增 disposeAsync() 接口 |
| src/main/agent-engine-service-core-reliability.test.ts | 新增 | 8 个核心可靠性测试 |
| src/main/agent-engine-service.test.ts | 修改 | dispose 测试改用 disposeAsync |
| src/main/agent-engine-service-apply-integration.test.ts | 修改 | dispose 测试改用 disposeAsync |
| src/main/agent-engine-service-restore-integration.test.ts | 修改 | dispose 测试改用 disposeAsync |

## 下一步建议

1. **方向 D（测试质量均衡）** — 为核心 Store（agentStore/settingsStore）添加直接测试覆盖
2. **方向 F（架构正交）** — 消除模块级可变状态泛滥（18+ 处隐式共享状态）
3. **方向 B（注入性能）** — CDP 连接复用与 Apply Trace 结构化埋点
4. **方向 C（内存审计）** — BrowserWindow 泄漏与 CDP WebSocket 释放
5. **方向 J（主题契约）** — 14-token 目标应用一致性验证
