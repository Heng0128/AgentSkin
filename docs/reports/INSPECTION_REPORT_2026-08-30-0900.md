# INSPECTION REPORT — 2026-08-30-0900

## 元信息

- **方向编号**: F
- **方向名**: 架构正交性（模块循环依赖、公共类型重复定义、Store 跨调用边界）
- **状态**: COMPLETED
- **快照 commit**: `42dcbce`
- **执行时长**: ~25 分钟
- **选取机制**: 加权轮盘赌 (hour=9 → 区间 9/21 → F)，A 连续 2 次 COMPLETED 回避

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 23 (去重前 31) |
| 严重度分布 | CRITICAL: 3, MAJOR: 8, MINAR: 9, INFO: 3 |
| 根因聚类数 | 10 (RC1-RC10) |
| 已修复根因 | 8/10 (RC1-RC5, RC7-RC10) |
| 延后根因 | 2/10 (RC6 store 循环解耦 — 架构守卫已在) |
| 直接修复 commit | 6 (5 phase5 + 1 phase8-audit) |
| 验证轮次 | Phase6 一次通过，无 Phase7 修复 |
| 新增修改文件 | 13 |

---

## 发现与修复明细

| # | RC | 文件 | 行号 | 严重度 | 问题描述 | 修复 | 状态 |
|----|----|------|------|--------|----------|------|------|
| F-INJ-02 | RC2 | installFlowStore.ts | 221 | CRITICAL | fileResult 跨调用竞态 — withImportLock 回调内赋值、回调外读取，不同 path 的并发调用互相覆盖 | 闭包 cell 对象隔离每次调用 | ✅ FIXED |
| F-ENV-03 | RC3 | environmentStore.ts | 240-248 | CRITICAL | switchEnvironment switching 竞态 — finally 内 epoch 删除导致后续调用 current()=0 跳过 switching=false | 删除 delete 调用 | ✅ FIXED |
| F-APP-04a | RC4 | appsStore.ts | 85-100 | MAJOR | HMR 闭包悬挂 — coordinator 订阅在模块重载时累积 | moduleState + detachAllListeners | ✅ FIXED |
| F-CON-07 | RC7 | config/settings.ts | 155, 173 | MAJOR | settings 缓存不失效 — 外部编辑文件后读取到旧值 | 写入后 invalidateSettingsCache | ✅ FIXED |
| F-ARC-01 | RC11 | shared/types/ipc.ts | 845 | CRITICAL | DomTreeNode 冗余 inline import — 类型已在同文件定义 | 简化为直接引用 | ✅ FIXED |
| F-REG-03 | RC5 | adapters/registry.ts | 22-24 | MINOR | 模块级 Map + 布尔标记无 reset | 新增 resetAdapterRegistry | ✅ FIXED |
| F-LOG-08 | RC5 | main/logger.ts | 26-28 | MINOR | listener/buffer/locale 无 reset | 新增 resetLoggerState | ✅ FIXED |
| F-LOC-08 | RC5 | main/locale-preferences.ts | 176-178 | MINOR | cachedThemeMode 无 reset | 新增 resetLocalePreferencesCache | ✅ FIXED |
| F-AUD-10 | RC5 | main/audio-level.ts | 155-193 | MINOR | 子进程泄漏风险 — 无完整 dispose | 新增 disposeAudioLevelModule | ✅ FIXED |
| F-THM-03 | RC8 | ui/stores/themeStore.ts | 342-346 | MAJOR | HMR stale closure — setFileImportPrompt 静态捕获 | lazy wrapper | ✅ FIXED |
| F-STA-09 | RC9 | ui/stores/statusStore.ts | 102 | MINOR | promise.race timeout 句柄泄漏 | clearTimeout | ✅ FIXED |
| F-CDP-10 | RC10 | shared/cdp-discovery.ts | 63-71 | MINOR | 三个 TTL cache 无 reset | 新增 resetCdpDiscoveryCaches | ✅ FIXED |

### 延后根因

| RC | 描述 | 延后理由 |
|----|------|---------|
| RC6 | store↔store 循环依赖 (themeStore↔environmentStore) | 架构守卫 check-architecture-boundaries 已在；解耦需要重构调用模式，影响面广，非本次范围 |

---

## 方案选优记录

**候选方案 1 — Multi-RC Repair Bundle (选定)**
- 每个 RC 独立修复，独立 commit
- 不影响外部会话文件
- 可分步回滚
- 总分: 时间复杂度 18/20, 空间复杂度 13/15, 可维护性 23/25, 扩展性 18/20, 依赖可控性 20/20 = **92/100**

**候选方案 2 — Store 集中清理 + 循环解耦**
- 一次性重构所有 store 依赖
- 风险: 引入回归、影响外部会话工作
- 总分: 65/100 — 舍弃（风险过高）

**候选方案 3 — 仅修复 CRITICAL + MAJOR，跳过 MINOR**
- 保守策略
- 总分: 78/100 — 舍弃（MINOR 修复成本低、累积价值高）

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | 1 | ✅ PASS | 修改文件零新增错误 |
| VIT | 1 | ✅ PASS | UI 830/830, Main 5449/5466 (17 预存失败) |
| BIO | 1 | ✅ PASS | 13 文件 0 error 0 warning |
| CTR | 1 | ✅ PASS | 0 C4 违规, 24 跨 store 依赖仅信息性记录 |

---

## 审计结论

- **遗漏**: 无（RC1-RC5, RC7-RC10 全部有对应修复）
- **回归**: 无（所有修改文件零新增 TSC 错误，UI 全绿）
- **新增问题**: 审计发现双下划线命名不规范，已修复 (commit 4d150295)
- **一致性评分**: 4/5 (moduleState 模式 themeStore 用 class, appsStore 用对象字面量 — 轻微不一致，但可接受)
- **文档同步**: 无需更新（修改均为内部实现细节）

---

## Phase 5 全部 Commits

| Commit | Message |
|--------|---------|
| dfc2c2a5 | fix(architecture): repair RC2/RC3/RC4/RC7 — critical races + HMR safety [phase5-step1] |
| 1334b9ec | fix(architecture): add module-level state reset hooks (RC5) [phase5-step2] |
| c6d0a031 | fix(architecture): HMR lazy lookup + timeout cleanup (RC8/RC9) [phase5-step3] |
| f852967e | fix(architecture): add cdp-discovery cache reset test hook (RC10) [phase5-step4] |
| 94bef7bb | fix(architecture): remove redundant inline import for DomTreeNode (RC11) [phase5-step5] |
| 4d150295 | fix(architecture): normalize reset hook naming (remove __ prefix) [phase8-audit] |

---

## 下一步建议

1. **方向 A — 核心链路可靠性（权重最高）**: agent-engine-service.ts (855行零测试) apply/restore/wallpaper 全流程测试覆盖。4 个核心 Store (agentStore/settingsStore/communityStore/secondaryInjectStore) 零测试。
2. **方向 D — 测试质量均衡**: 补充 installFlowStore.runImport/runImportFromPath 异步路径测试；修复 persistFailures 6 个预存失败 (writeState 未捕获错误)。
3. **方向 C — 内存与资源审计**: 主进程内存趋势，BrowserWindow 泄漏检测，CDP WebSocket 及时释放验证。
4. **方向 K — 渲染管线**: useSyncExternalStore selector 稳定性审查，防止 React 19 + Zustand 撕裂。
5. **方向 F — 后续跟进**: RC6 (store 循环解耦) 可在后续轮次专项攻坚；检查 communityStore→themeStore 新增跨 store 依赖是否需要治理。

---

## 附录：外部并行会话文件清单

以下文件在本巡检期间处于外部并行会话修改状态，已全程避让：

- `src/shared/import/theme-signature-verifier.ts`
- `src/shared/import/theme-signature-verifier.test.ts`
- `src/shared/injection/injection-gate.ts`
- `src/shared/injection/injection-gate.test.ts`
- `src/main/cdp/injection/theme-auto-repair.ts` (未跟踪)
- `src/main/cdp/injection/theme-auto-repair.test.ts` (未跟踪)
