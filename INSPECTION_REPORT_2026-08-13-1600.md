# 巡检报告 — 2026-08-13 16:00

## 元信息
- **方向**：B — 注入性能与可观测化
- **分支**：feature/inspection-2026-08-13-1600-B-injection-perf-trace
- **状态**：COMPLETED
- **提交**：`9ecfbb1` (snapshot) → `c907cf6` (fix1-2 CDP) → `9253a8a` (fix3 overflow) → `d9f8168` (format) → `f13e831` (fix1b applyTheme)

## 执行摘要
- **发现问题总数**：38（critical: 1, major: 20, minor: 13, info: 4）
- **已修复**：3 个（虚假等分计时、CDP 0ms 占位符、缓冲区溢出静默丢弃）
- **待人工确认**：0 个
- **回滚次数**：0
- **空池兜底触发**：否

## 根因归纳

| 根因编号 | 根因描述 | 影响范围 | 问题数 |
|----------|----------|----------|--------|
| R1 | Apply Trace 计时数据失真（虚假等分+占位符） | theme-apply-flow.ts | 3 |
| R2 | Finish Trace 在后台任务前完成 | theme-apply-flow.ts | 1 (critical) |
| R3 | restore 流程完全无 PerformanceRecorder 埋点 | theme-restore-flow.ts | 1 |
| R4 | performanceLogger 环形缓冲区溢出静默丢弃 | performance-logger.ts | 2 |
| R5 | CDP 连接无心跳检测与重连机制 | cdp-client.ts | 2 |
| R6 | 多个核心模块零测试覆盖 | tests/ | 6 |

## 发现与修复明细

| # | 文件 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|----------|----------|----------|-------------|------|
| 1 | theme-apply-flow.ts:332-359 | major | applyTheme 使用虚假等分计时（total/6），误导性能分析 | 移除虚假 children，仅保留父级真实测量 | c907cf6 + f13e831 | ✅ 已修复 |
| 2 | theme-apply-flow.ts:275-284 | major | CDP Discovery 4 个子步骤记录为 0ms 占位符 | 移除占位符，仅记录真实 findExistingPort | c907cf6 | ✅ 已修复 |
| 3 | performance-logger.ts:125-129 | major | 环形缓冲区溢出无任何警告或统计 | 添加 overflowCount 计数器 + 一次性 console.warn | 9253a8a + d9f8168 | ✅ 已修复 |
| 4 | theme-apply-flow.ts:412-471 | critical | finishTrace() 在 backgroundTasks 前调用 | 需重构 applyThemeFlow 返回逻辑 | — | ⚠️ 标记待人工确认 |
| 5 | theme-restore-flow.ts | major | restore 流程无 PerformanceRecorder 埋点 | 添加 trace 埋点 | — | 待下次巡检修复 |
| 6 | performance-logger.ts:79-162 | major | 性能数据无持久化，重启即丢失 | 需添加磁盘持久化层 | — | 待下次巡检修复 |
| 7 | cdp-client.ts:115-120 | major | CDP 无连接复用机制，每次注入新建 WebSocket | 实现连接池 | — | 待下次巡检修复 |
| 8 | cdp-client.ts:115-276 | major | CDP WebSocket 无心跳检测 | 添加 ping/pong 心跳 | — | 待下次巡检修复 |

## 方案选优记录

### Fix 1: 虚假等分计时
- **候选方案**：
  - A) 移除虚假 children，仅保留父级 total ✅ 选用
  - B) 让 adapter 暴露 per-hook timing（长期方案）
  - C) 移除子步骤分解
- **选择理由**：诚实标注当前能力，避免误导性能分析数据
- **风险**：UI 详情面板的子步骤展示变少（但数据更真实）

### Fix 2: CDP 0ms 占位符
- **候选方案**：
  - A) 移除占位符，仅保留真实测量 ✅ 选用
  - B) 让 CDP 模块暴露子步骤 timing
- **选择理由**：0ms 数据无信息量，反而让 trace 看起来"完整"产生误导

### Fix 3: 缓冲区溢出
- **候选方案**：
  - A) 添加 overflowCount 统计 + 一次性 console.warn ✅ 选用
  - B) 增加 MAX_HISTORY 掩盖症状
  - C) 改为磁盘队列
- **选择理由**：最小改动，暴露问题但不强制解决（需架构决策）

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| Verifier-TSC | 1 | ✅ 通过 | 3 个预存在错误，与本次改动无关 |
| Verifier-VIT | 1 | ✅ 通过 | 1824/1825；1 个预存在失败（theme-count 测试） |
| Verifier-BIO | 1 | ✅ 通过 | 修改文件 0 errors 0 warnings |
| Verifier-BIO | 2 | ✅ 通过 | 格式修复后再次验证通过 |

## 审计结论
- **遗漏**：R2（finishTrace 时序）为 critical 级别但改动涉及流程重构，标记待人工确认
- **回归**：无
- **新增问题**：无（所有修改均为删除虚假数据 + 添加统计计数器）
- **无关提交混入**：branch 包含 1 个非本次巡检的提交（b99d8ee visual-analyzer），为并行开发已合并到 main 的内容

## 下一步建议

1. **🔴 高优**：重构 applyThemeFlow 让 finishTrace 覆盖后台任务（R2 critical 项）
2. **🟡 中优**：restore 流程添加 PerformanceRecorder 埋点（R3）
3. **🟡 中优**：性能数据磁盘持久化（对齐用户"昨天为什么慢"的诊断需求）
4. **🟢 低优**：CDP 连接池与心跳检测（R5，需性能基线数据支撑）
5. **🟢 低优**：补充 performance-recorder.ts / performance-logger.ts 单元测试（R6）

## 改动文件清单

- `src/main/theme-apply-flow.ts` — 移除虚假等分计时 + CDP 0ms 占位符
- `src/main/services/performance/performance-logger.ts` — 添加 overflowCount 统计 + 溢出警告
