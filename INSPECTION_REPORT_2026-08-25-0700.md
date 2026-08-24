# AgentSkin 巡检报告 2026-08-25-0700

## 元信息
- **方向编号**: F
- **方向名**: 架构正交（模块循环依赖、公共类型重复定义、Store 跨调用边界）
- **状态**: COMPLETED
- **快照 commit**: `3864972d` (snapshot: pre-inspection baseline [F-arch-orthogonality-round2])
- **最终 commit**: `c8ab5890`
- **执行时间**: 2026-08-25 07:00–07:40
- **选取权重**: 2（命中概率中等，上次巡检已部分修复，本次为深化）

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 42（Scout-α 32 + Scout-β 10） |
| 去重后问题数 | 12（按根因聚类） |
| 根因聚类数 | 5 |
| 已修复数 | 2（RC1 部分覆盖 + RC2 完全修复） |
| 新增测试 | 20 |
| 待人工确认数 | 0 |
| 回滚次数 | 0 |

---

## 根因聚类

### RC1: 7个核心Store完全缺少测试覆盖
- **严重性**: critical
- **影响范围**: agentStore/dialogStore/notificationStore/settingsStore/installFlowStore/communityStore/secondaryInjectStore
- **根因**: 架构拆分后 Store 层测试未同步补充，业务逻辑无回归保护

### RC2: LaunchResult 类型重复定义
- **严重性**: major
- **影响范围**: shared/types/agent.ts vs engine/types/index.d.ts
- **根因**: 两个模块各自定义同名但形状不同的接口，可能导致类型混淆

### RC3: 模块级可变状态泛滥
- **严重性**: major
- **影响范围**: 18+ 处模块级 `let`/`const` Map/Set 构成隐式共享状态
- **根因**: 从 hooks 提取 Store 时保留了模块级变量模式，未引入显式生命周期管理

### RC4: Store 跨调用边界耦合
- **严重性**: major
- **影响范围**: themeStore→5 stores, environmentStore→4 stores, settingsStore→3 stores
- **根因**: 使用 `getState()` 直接调用其他 Store 形成隐式耦合网络

### RC5: 接口契约不一致
- **严重性**: minor
- **影响范围**: wallpaperStore、workspaceStore、communityStore
- **根因**: 接口定义与实际运行时返回值不匹配

---

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|----------|----------|----------|-------------|------|
| 1 | src/ui/stores/notificationStore.ts | — | critical | 通知 Store 零测试覆盖 | 新建 notificationStore.test.ts（6测试） | 5f79392b | ✅ FIXED |
| 2 | src/ui/stores/dialogStore.ts | — | critical | 对话框 Store 零测试覆盖 | 新建 dialogStore.test.ts（6测试） | 5f79392b | ✅ FIXED |
| 3 | src/ui/stores/installFlowStore.ts | — | critical | 安装流程 Store 零测试覆盖 | 新建 installFlowStore.test.ts（8测试） | 5f79392b | ✅ FIXED |
| 4 | src/engine/types/index.d.ts | 391 | major | LaunchResult 与 shared 侧同名不同形 | 重命名为 EngineLaunchResult | 38400b3d | ✅ FIXED |
| 5 | src/ui/stores/themeStore.ts | 81-82, 188-191 | major | agentChains/globalChain/IPC cancelers 模块级状态 | — | — | 📋 FUTURE |
| 6 | src/ui/stores/wallpaperStore.ts | 57 | major | companionBusyByAgent 模块级 Set | — | — | 📋 FUTURE |
| 7 | src/ui/stores/appsStore.ts | 78-81 | major | launchingGuard/customExePaths 模块级 Set | — | — | 📋 FUTURE |
| 8 | src/ui/stores/environmentStore.ts | 54 | major | switchEpochByAgent 模块级 Map | — | — | 📋 FUTURE |
| 9 | src/ui/stores/settingsStore.ts | 16-18 | major | 跨 Store 调用 statusStore/notificationStore/shellStore | — | — | 📋 FUTURE |
| 10 | src/ui/stores/installFlowStore.ts | 104-106 | major | clearingHandle/installEpoch/lastSourcePath 模块级状态 | — | — | 📋 FUTURE |
| 11 | src/main/mcp/mcp-server.ts | 48-49 | major | SERVER_NAME/SERVER_VERSION/serverInstance 模块级状态 | — | — | 📋 FUTURE |
| 12 | src/main/services/app-run-state-coordinator.ts | 206 | major | _instance 单例模式模块级状态 | — | — | 📋 FUTURE |

---

## 方案选优记录

### RC1 (Store 测试覆盖) 方案对比

| 方案 | 时间复杂度 | 空间复杂度 | 长期可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|------------|------------|--------------|--------|------------|------|
| A: 逐Store手写 | 7/10 | 8/10 | 6/10 | 7/10 | 10/10 | 7.55 |
| **B: 共享基础设施+逐Store** | 6/10 | 7/10 | 9/10 | 9/10 | 10/10 | **8.05** ✅ |
| C: 优先覆盖 | 8/10 | 8/10 | 7/10 | 7/10 | 10/10 | 7.90 |
| D: 快照测试 | 10/10 | 10/10 | 4/10 | 5/10 | 10/10 | 7.30 |

**选择理由**: 方案 B 长期回报最高，与现有模式兼容，后续边际成本趋零。实际执行中优先覆盖 3 个最高风险 Store（notification/dialog/installFlow），后续可按同样模式扩展。

### RC2 (LaunchResult 重复) 方案对比

| 方案 | 时间复杂度 | 空间复杂度 | 长期可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|------------|------------|--------------|--------|------------|------|
| **A: 重命名 engine 侧** | 10/10 | 10/10 | 8/10 | 8/10 | 10/10 | **9.00** ✅ |
| B: 联合类型 | 6/10 | 7/10 | 9/10 | 9/10 | 10/10 | 7.95 |
| C: 文档 | 10/10 | 10/10 | 4/10 | 5/10 | 10/10 | 7.30 |
| D: 统一类型 | 6/10 | 7/10 | 6/10 | 7/10 | 10/10 | 7.00 |

**选择理由**: 方案 A 改动最小、风险最低，两个类型语义确实不同（launcher vs engine），不应强行统一。

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| Verifier-TSC | R1 | ⚠️ PASS (pre-existing errors only) | 24 个错误均为预存（WorkspacePage JSX + communityStore 类型），非本次修改引入 |
| Verifier-VIT | R1 | ✅ PASS | 新增 20/20 ✓ + 全量 4531/4535 ✓（4 失败为预存依赖问题） |
| Verifier-BIO | — | ⏭️ SKIPPED | Biome 未安装（环境限制） |
| Verifier-CTR | R1 | ✅ PASS | 无样式泄漏/类型重复/Store 边界违规 |

**预先存在失败 (非本次修改引起)**:
- `boot-sequence.test.ts` — `fixtures/mocks/electron.ts` 中 `merged is not defined`
- `theme-from-image.test.ts` — 缺失 `@material/material-color-utilities` 模块
- `wallpaper-sample.test.ts` / `wallpaper-ipc.test.ts` — 同上 electron mock 问题

---

## 审计结论

| 维度 | 结果 |
|------|------|
| 遗漏检查 | ✅ 已修复的 2 个根因（RC1 部分 + RC2 完全）有对应实施；未修复的 RC3/RC4/RC5 标记为 FUTURE |
| 回归检查 | ✅ 无意外影响范围，仅改动 1 个源文件 + 3 个测试文件 |
| 新增问题 | ✅ 无新增 code smell |
| 一致性 | ✅ 测试风格与项目一致（vi.hoisted + vi.mock + setState 重置） |
| 文档同步 | ✅ 无需同步（测试文件为内部实现细节） |

**总体评价: PASS**

---

## Commit 清单

| Hash | Message |
|------|---------|
| `3864972d` | snapshot: pre-inspection baseline [F-arch-orthogonality-round2] |
| `38400b3d` | refactor(engine): rename LaunchResult to EngineLaunchResult [phase5-step1] |
| `5f79392b` | test(stores): add unit tests for notificationStore, dialogStore, installFlowStore [phase5-step2] |
| `50227730` | test(stores): fix installFlowStore test window.setTimeout mock [phase7-r1] |
| `711217b2` | test(stores): fix dialogStore test type errors [phase7-r2] |
| `c8ab5890` | test(stores): fix dialogStore InstalledTheme type for fileImportPrompt [phase7-r3] |

---

## 下一步建议

1. **[P0] 补充剩余 4 个核心 Store 测试** — agentStore/settingsStore/communityStore/secondaryInjectStore 仍零覆盖，建议按本次建立的模式继续补充。预估 +40 测试。

2. **[P1] 模块级可变状态统一治理** — themeStore/notificationStore/wallpaperStore/workspaceStore/appsStore 共 5 个 Store 存在 18+ 处模块级可变状态，建议提取为 `createModuleState()` 统一工厂，支持 HMR 清理和测试重置。本次巡检已识别但标记为 FUTURE，需独立方向实施。

3. **[P1] Store 跨边界调用治理** — themeStore 直接调用 5 个其他 store 的 getState()，建议引入事件总线或中间件模式解耦。environmentStore（4 个下游）、settingsStore（3 个下游）同理。

4. **[P2] 修复 fixtures/mocks/electron.ts 的 `merged is not defined`** — 这是导致 5 个测试文件无法运行的根因，影响 boot-sequence/wallpaper/theme-from-image 测试。

5. **[P2] 安装缺失的 @material/material-color-utilities 依赖** — 使 theme-from-image 测试可运行。

---

*报告生成时间: 2026-08-25 07:40*
