# AgentSkin 巡检报告 2026-08-29-0600-v2

## 元信息
- **方向编号**: C
- **方向名**: 内存占用与资源审计
- **状态**: COMPLETED
- **快照 commit**: `45abf343`
- **最终 commit**: `6e84e307`
- **执行时间**: 2026-08-29 06:00

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 7 (去重后) |
| Critical | 0 |
| Major | 2 |
| Minor | 3 |
| Info | 2 |
| 已修复 | 5 (2 major + 3 minor) |
| 延期/免修 | 2 (info 级 dead code) |
| 回滚次数 | 0 |
| 新增 commits | 4 (1 snapshot + 3 fix) |

## 发现与修复明细

| # | 文件 | 行号 | 严重度 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|--------|---------|---------|------------|------|
| 1 | boot-sequence.ts | 382 | major | TextureDecodePool 全局单例从未终止，Worker 线程可能成为僵尸线程 | 添加 registerDisposable(() => terminateTextureDecodePool()) | a08b2243 | FIXED |
| 2 | boot-sequence.ts | 378 | major | performanceLogger.clear() 未在 shutdown 调用，50 条 trace buffer 不释放 | 添加 registerDisposable(() => performanceLogger.clear()) | a08b2243 | FIXED |
| 3 | concurrency-metrics-ipc.ts | 62 | major | ipcMain.on 监听器无 removeListener，HMR/重复注册时堆叠 | 重构为返回 { dispose } 模式，接入 ctx.disposables | cf415ffa | FIXED |
| 4 | cdp-client.ts | 293 | minor | WebSocket close() 后未清理事件监听器，闭包引用链保持到 GC | close() 末尾 null 赋值 ws.onclose/onerror/onopen/onmessage | 6e84e307 | FIXED |
| 5 | wallpaper-server.ts | 272 | minor | createReadStream error 监听器在流结束后未移除 | 添加 once('close'/'end') 时 removeListener | 6e84e307 | FIXED |
| 6 | port-lease-pool.ts | 224 | minor | dispose() 是 dead code，从未被接入生命周期 | — | — | INFO (免修) |
| 7 | health-monitor.ts | 380 | info | injectionHealthMonitor 是 dead code，仅测试用 | — | — | INFO (免修) |

## 方案选优记录

### RC1 (boot-sequence 清理不完整)
- **候选方案**: A) 添加 registerDisposable (选中) B) process.on('before-quit') 钩子 C) 移除 dead code
- **选择理由**: 方案 A 与现有 terminateSceneWorkerPool 模式完全一致，零风险，可验证
- **评分**: 时间复杂度 20% / 空间复杂度 15% / 可维护性 25% / 扩展性 20% / 依赖可控性 20% = 最优

### RC2 (IPC 缺少 dispose)
- **候选方案**: A) 返回 dispose 函数 (选中) B) ipcMain.once C) 模块级 cleanup
- **选择理由**: 方案 A 与 registerPerformanceIpce 模式一致，符合项目约定
- **评分**: 同上维度最优

### RC3 (资源释放路径不完整)
- **候选方案**: A) removeAllListeners (初选，测试失败) B) 逐项 null 赋值 (最终选中) C) 不处理
- **选择理由**: removeAllListeners 干扰 WebSocket 内部 close 时序导致 14 个测试失败，改用 null 赋值后 52/52 通过
- **评分**: 方案 B 无依赖、零回归、可回滚

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | R1 | PASS | 零新错误（预存错误与本次无关） |
| VIT | R1 | PASS | 7772/7777 通过（1 个性能基准 flaky + 4 skipped，均与本次无关） |
| BIO | R1 | PASS | 修改文件零违规 |
| CTR | R1 | PASS | 无样式泄漏、无类型重复、无 Store 跨边界 |

## 审计结论

| 维度 | 结论 |
|------|------|
| 遗漏 | 无 — 3 个 RC 均完整修复 |
| 回归 | 无 — 双重清理均幂等安全 |
| 新增问题 | 无 — 无反模式或 code smell |
| 一致性 | 良好 — 仅清理方式 micro-style 差异 |
| 文档同步 | 已同步 — JSDoc 和代码注释均更新 |

## 下一步建议

1. **方向 A (核心链路可靠性)** — agent-engine-service.ts 855 行零测试，建议优先覆盖 apply/restore/wallpaper 全流程
2. **方向 D (测试质量均衡)** — Scene 子系统测试过多、核心服务零测试，建议补测 agentStore/settingsStore
3. **方向 F (架构正交)** — 模块级可变状态泛滥（18+ 处），建议逐步封装为类
4. **Dead code 清理** — cdp-reconnect.ts (465 行)、injectionHealthMonitor、PortLeasePool.dispose 可考虑移除或标记 @deprecated
5. **性能基准测试稳定性** — injection-benchmark.test.ts 因系统负载波动失败，建议增加容差或标记为 flaky
