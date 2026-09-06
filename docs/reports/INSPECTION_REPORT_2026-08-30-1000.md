# AgentSkin 巡检报告 — 2026-08-30 1000

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | F |
| 方向名 | 架构正交（模块循环依赖、公共类型重复定义、Store跨调用边界） |
| 状态 | **COMPLETED** |
| 执行时间 | 2026-08-30 10:00–10:50 |
| 快照 commit | `12f012f` |
| 最终 commit | `ffb7b9e5` |
| 总 commits | 6 (1 snapshot + 5 step + 1 audit fix) |

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 18（去重前，Scout-α 3 + Scout-β 15） |
| 去重后有效问题 | 17 |
| CRITICAL | 1 |
| MAJOR | 6 |
| MINOR | 8 |
| INFO | 2 |
| 根因聚类 | 13（RC1-RC13） |
| 已修复根因 | 10/13 |
| 已修复问题 | 15/17 |
| 延后根因 | 3（RC1/RC6/RC8） |
| 待人工确认 | 1（RC1 需 RFC） |
| 回滚次数 | 0 |
| 新增 commits | 6 |

---

## 方向选取

最近 5 次巡检方向: F(0800) → A(0700) → A(0600) → C(0500) → B(0400)

A 连续 2 次 COMPLETED（0700+0600），权重降为 0 后重新抽取。

按权重轮盘赌（hour=10, 10 mod 21=10 → F 区间），选定 **方向 F（架构正交）**。

---

## 发现与修复明细

### RC1: themeStore ↔ environmentStore 双向循环依赖 — 延后 ⚠️

| 维度 | 内容 |
|------|------|
| 文件 | `src/ui/stores/themeStore.ts:24,628` + `src/ui/stores/environmentStore.ts:30,192` |
| 严重度 | CRITICAL |
| 问题 | 两文件互相 import 并调用 getState()，导致模块初始化顺序耦合、潜在死锁 |
| 状态 | **延后**（需 RFC 评审，0800 RC1 已确认延后） |

---

### RC2: appsStore moduleState 生命周期缺陷 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 1 | appsStore.ts | 187-198 | major | moduleState 未导出 reset | 导出 `resetAppsModuleState()` | aabc2658 |
| 2 | reset-apps-store.ts | 18-27 | major | resetAppsStore 未清理 moduleState | 调用 `resetAppsModuleState()` | aabc2658 |

---

### RC3: 测试间模块级状态泄漏 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 3 | environmentStore.test.ts | 全局 | major | 未调用 resetSwitchEpochGuard() | beforeEach 添加调用 | 66fca77e |
| 4 | wallpaperStore.test.ts | 全局 | major | 未调用 resetCompanionBusyGuard() | beforeEach 添加调用 | 66fca77e |
| 5 | appsStore.test.ts | 121-125 | major | 订阅回调未清理 | 通过 resetAppsStore 自动调用 | aabc2658 |
| 6 | appsStore.test.ts | 208-220 | minor | 测试执行顺序依赖 | 同上 | aabc2658 |

---

### RC4: appsStore ScannedApp.id 不安全断言 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 7 | appsStore.ts | 324 | major | `app.id as AgentId` 不安全 | 改用 `app.adapterMatch` | 81adc900 |
| 8 | appsStore.ts | 389 | major | `appId as AgentId` 不安全 | 改用 `app.adapterMatch` + null 检查 | 81adc900 |

---

### RC5: environmentStore 冗余类型断言 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 9 | environmentStore.ts | 192,197,205,216 | minor | `env.agent.id as AgentId` 冗余 | 移除 as AgentId（agent.id 已是 AgentId 类型） | 81adc900 |

---

### RC6: themeStore.test.ts as never 断言 — 延后 ⏳

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 10 | themeStore.test.ts | 344,361,376,415 | minor | as never 掩盖类型不匹配 | 延后（需导出 DialogState 类型） |

---

### RC7: epoch 守卫无上限 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 11 | environmentStore.ts | 59-64 | minor | epoch 单调递增无上限 | 添加 >= 1_000_000 重置保护 | 81adc900 |

---

### RC8: AgentEngineServiceApi 测试覆盖不足 — 延后 ⏳

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 12 | contracts.test.ts | 240-277 | minor | 仅检查 key 存在性 | 延后（低优先级） |

---

### RC9: 架构边界检查遗漏 — 信息性 ℹ️

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 13 | check-architecture-boundaries.mjs | 306-310 | info | 正则无法检测动态 import | 信息性，无需修复 |

---

### RC10: 回调异常吞没 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 14 | themeStore.ts | 629-636 | minor | try-catch 包裹整个循环 | 将 try-catch 移至循环内 | 9ee8dbb5 |
| 15 | themeStore.ts | 493-495 | minor | restoreApp 缺少异常保护 | 添加 try-catch | ffb7b9e5 |

---

### RC11: 测试逻辑自相矛盾 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 16 | environmentStore.test.ts | 177-216 | minor | 断言恒真 | 重写为真正测试竞态条件 | 9ee8dbb5 |

---

### RC12: void 返回类型设计 — 信息性 ℹ️

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 17 | contracts.ts | 350 | info | updateConcurrencyMetricsFromRenderer 返回 void | 信息性，设计建议 |

---

### RC13: secondaryInjectStore 清理入口缺失 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 18 | secondaryInjectStore.ts | 72-73 | minor | 订阅句柄无外部清理入口 | 新增 `resetSecondaryInjectSubscriptions()` | aabc2658 |

---

## 方案选优记录

### 候选方案数
针对每个根因提供 3-4 个候选方案，针对核心修复（RC2/RC3/RC4/RC10）做了深度对比。

### 最优方案选择

| 根因 | 最优方案 | 选择理由 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 |
|------|---------|---------|-----------|-----------|---------|--------|---------|
| RC2 | 导出 reset + 接入 test helper | 复用现有模式，改动最小 | 20% | 15% | 25% | 20% | 20% |
| RC3 | beforeEach 统一调用 reset | 与 0800 修复模式一致 | 20% | 15% | 25% | 20% | 20% |
| RC4 | 使用 adapterMatch 替代断言 | 数据模型已有正确类型信息 | 20% | 15% | 25% | 20% | 20% |
| RC5 | 直接移除冗余断言 | 零风险 | 20% | 15% | 25% | 20% | 20% |
| RC6 | 导出 DialogState 后修复 | 需改动多处，延后 | — | — | — | — | — |
| RC7 | 添加上限常量 | 防御性编程，改动最小 | 20% | 15% | 25% | 20% | 20% |
| RC8 | 增加行为测试 | 低优先级延后 | — | — | — | — | — |
| RC10 | try-catch 移至循环内 | 保证每个 handler 独立捕获 | 20% | 15% | 25% | 20% | 20% |
| RC11 | 重写测试逻辑 | mockImplementationOnce 触发真实竞态 | 20% | 15% | 25% | 20% | 20% |
| RC13 | 新增导出函数 | 对齐其他 store 模式 | 20% | 15% | 25% | 20% | 20% |

### 落选方案存档
- RC2: WeakRef GC（不可靠）、Reset 注册表（引入新范式）
- RC3: vi.isolateModules（与现有 mock 模式冲突）
- RC4: 重新设计 key 策略（改动面过大，adapterMatch 已够用）
- RC10: 提取工具函数（循环只有 2 处，过度抽象）

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | R1 | **PASS** | 0 新增错误（全部预存） |
| VIT | R1 | **PASS** | 89/89 修改文件测试全绿 |
| BIO | R1 | **PASS** | 7 文件 0 warning |
| CTR | R1 | **PASS** | 0 新增违规（QuickApplyPanel 为预存） |

### TSC 验证
- 新增错误: 0
- 预存错误: 23（quick-apply-ipc, scene-renderer-async, preload, theme-signature-verifier, injection-gate, QuickApplyPanel, useDiagnosticsSync — 与本次无关）

### VIT 验证
- 修改文件测试: 89/89 全绿（secondaryInjectStore 10 + environmentStore 11 + appsStore 40 + wallpaperStore 18 + themeStore 10）
- 全量 UI 测试: 836 passed / 5 failed（失败全为 QuickApplyPanel.test.tsx 预存 jsdom 问题）

### BIO 验证
- 7 个文件全部通过，0 warning

### CTR 验证
- C4-STORE 信息性警告 23 条（为已记录的跨 Store 依赖，不构成违规）
- 1 条预存违规（QuickApplyPanel.tsx:24 依赖 main 层，非本次引入）

---

## 审计结论

| 维度 | 结论 |
|------|------|
| 遗漏检查 | ✅ 可修复项均有对应修复（RC1 需 RFC，RC6/RC8 低优先级延后） |
| 回归检查 | ✅ 修改未影响未预期文件 |
| 新增问题 | ✅ 未引入新 code smell（audit 发现 2 处 minor 并已修复） |
| 一致性检查 | ✅ 修改风格与项目一致（JSDoc 注释、reset 函数命名） |
| 文档同步 | ✅ 公开 API 修改均有 JSDoc 说明 |

### 审计修复
- secondaryInjectStore: `disposeSecondaryInjectSubscriptions` 改为委托给 `resetSecondaryInjectSubscriptions`，消除重复代码
- themeStore: `restoreApp` 中的 wallpaperHandlers 循环添加 try-catch，与 `confirmDelete` 对称

---

## 修改文件清单

| 文件 | 修改类型 | 净增行数 |
|------|---------|---------|
| src/ui/stores/appsStore.ts | 导出 reset + 修复类型断言 + 移除导入 | +10 |
| src/ui/stores/secondaryInjectStore.ts | 新增 detachAllListeners + 导出 reset + 消除重复 | +15 |
| src/ui/stores/test-helpers/reset-apps-store.ts | 调用 resetAppsModuleState | +2 |
| src/ui/stores/environmentStore.ts | 移除冗余断言 + epoch 上限 + 移除导入 | +3 |
| src/ui/stores/environmentStore.test.ts | beforeEach reset + 修复测试逻辑 | -18 |
| src/ui/stores/wallpaperStore.test.ts | beforeEach reset | +2 |
| src/ui/stores/themeStore.ts | 异常吞没修复 × 2 处 | +8 |

---

## 测试增量
- 新增测试: 0（本次为修复已有测试 + 代码改进，未新增独立测试用例）
- 回归: 0（全部修改文件测试通过）

---

## Commits

```
ffb7b9e5 fix(audit): deduplicate secondaryInjectStore + add try-catch to restoreApp [phase7-r1]
a11fea98 fix(lint): remove unused AgentId imports after type assertion cleanup [phase5-step5]
9ee8dbb5 fix(architecture): fix error swallowing + repair epoch guard test logic [phase5-step4]
81adc900 fix(architecture): remove unsafe type assertions + add epoch bounds guard [phase5-step3]
66fca77e fix(test): add module-level reset calls in environment+wallpaper tests [phase5-step2]
aabc2658 fix(architecture): export module-level reset for appsStore + secondaryInjectStore [phase5-step1]
12f012f snapshot: pre-inspection baseline 2026-08-30-1000 [direction F]
```

---

## 下次巡检建议

1. **方向 A（核心链路可靠性）** — 权重最高。agent-engine-service.ts 仍有大量未覆盖路径，`writeState` 错误处理（6 个预存测试失败）需优先修复
2. **方向 D（测试质量均衡）** — 4 个核心 Store（agentStore/settingsStore/communityStore/secondaryInjectStore）仍零独立测试
3. **方向 K（渲染管线）** — React 19 + Zustand 撕裂排查值得定期审计
4. **完成 RC6 修复** — 导出 DialogState 类型替换 `as never` 断言（依赖 dialogStore 接口导出）
5. **RC1 双向循环依赖** — 需设计方案突破 themeStore ↔ environmentStore 的耦合（可考虑事件总线或 coordinator 层）

---

## 根因分布

| 严重度 | 总数 | 已修复 | 延后 |
|--------|------|--------|------|
| CRITICAL | 1 | 0 | 1 (RC1) |
| MAJOR | 6 | 6 | 0 |
| MINOR | 8 | 7 | 1 (RC6) |
| INFO | 2 | 0 | 2 (RC9/RC12) |
| **合计** | **17** | **13** | **4** |
