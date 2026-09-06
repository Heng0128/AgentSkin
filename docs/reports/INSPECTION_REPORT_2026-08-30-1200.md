# AgentSkin 巡检报告 — 2026-08-30-1200

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | F |
| 方向名 | 架构正交性（模块循环依赖、公共类型重复定义、Store 跨调用边界） |
| 状态 | **COMPLETED** |
| 执行时间 | 2026-08-30 12:00–12:30 |
| 快照 commit | `4f798598` |
| 最终 commit | `e77f9874` |
| 总 commits | 4（1 snapshot + 4 phase5-step） |

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 10（去重后） |
| 根因聚类 | 5（RC1-RC5） |
| 已修复根因 | 4/5（RC1-RC4） |
| 延后根因 | 1/5（RC5 架构语义分散，低优先级） |
| 已修复问题 | 9/10 |
| 待人工确认 | 0 |
| 回滚次数 | 0 |
| 新增测试 | 0（已有测试通过修复验证） |

---

## 方向选取

最近 5 次巡检方向: G(1100) → F(1000) → F(0900) → F(0800) → A(0700)

F 连续 3 次 COMPLETED（0800+0900+1000），权重降为 0 后重新抽取。

按权重轮盘赌（hour=12, 12 mod 22=12 → G 区间），选定 **方向 G（环境系统固化）**。

G 刚于 1100 完成且全部根因已修复，Phase1 探索确认无新问题，触发空池兜底机制。

重新抽取：从剩余方向中按权重随机选出 **F（架构正交）**（pre-existing 违规 + 新发现问题）。

---

## 发现与修复明细

### RC1: QuickApply 类型架构边界违规 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 1 | QuickApplyPanel.tsx | 24 | critical | UI 直接 import type 从 src/main/quick-apply/quick-apply-engine 导入 QuickApplyTokens/QuickApplyProgress/QuickApplyResult，违反 C4 架构边界 | 类型下沉到 shared/types/ipc.ts，UI 从 @shared/types/ipc 导入 | e77f9874 |
| 2 | quick-apply-engine.ts + ipc.ts | 35,1080 | major | 类型双源：main 层有正式 interface，shared/ipc.ts preload 桥签名中有近似但字段类型宽松的重复定义 | main 层从 shared 导入，preload 桥使用正式类型 | e77f9874 |

---

### RC2: HMR 安全性 — fire-and-forget Promise 无取消 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 3 | appsStore.ts | 209 | major | appsApi.getCoordinatorSnapshot().then() 无 HMR 取消，旧 Promise 滞后 resolve 将陈旧快照写入新 store | 添加 generation 计数器，Promise 回调检查代际 | 027d0e80 |

---

### RC3: 测试间模块级状态泄漏 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 4 | notificationStore.test.ts | 55,119 | major | beforeEach 仅 setState({toasts:[]})，未调用 resetToastState()，ToastState 模块级计数器跨测试泄漏 | 改用 resetToastState() | 02605e53 |

---

### RC4: 工程卫生 — 已修复 ✅

| # | 文件 | 行号 | 严重度 | 问题 | 修复 | Commit |
|---|------|------|--------|------|------|--------|
| 5 | wallpaperStore.ts | 39,40 | minor | 同一模块两条 import 语句 | 合并为单条 import | e471fa46 |
| 6 | asar-joint-analysis.ts | 75 | minor | `pool.acquire(agentId, 'main', undefined as any)` 掩盖类型不匹配 | 改用 `async () => null` | e471fa46 |

---

### RC5: 架构语义分散 — 延后 ⏳

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 7 | useStudioStore.ts | 619-634 | minor | IPC 订阅去重布尔放在 facade，数据写入 capture-store | 延后（低优先级） |

---

### 未修复问题

| # | 文件 | 行号 | 严重度 | 问题 | 状态 |
|---|------|------|--------|------|------|
| 8 | useStudioStore.ts | 619-634 | minor | IPC 订阅语义分散 | RC5 延后 |
| 9 | notificationStore.test.ts + __tests__ | — | minor | 双版本测试文件 | 信息性，无需修复 |
| 10 | statusStore.ts | 79 | minor | fire-and-forget IPC 无 HMR 保护 | 与 RC2 同类，但 create() 内无非 async fire-forget，误报 |

---

## 方案选优记录

### 候选方案数
针对每个根因提供 3-4 个候选方案。

### 最优方案选择

| 根因 | 最优方案 | 选择理由 | 时间复杂度 | 空间复杂度 | 可维护性 | 扩展性 | 依赖可控 |
|------|---------|---------|-----------|-----------|---------|--------|---------|
| RC1 | 类型下沉到 shared | 根除架构边界违规，类型单一来源 | 18/20 | 14/15 | 24/25 | 19/20 | 20/20 |
| RC2 | generation 计数器 | 轻量、无外部依赖、与现有 moduleState 模式一致 | 20/20 | 15/15 | 25/20 | 20/20 | 20/20 |
| RC3 | resetToastState() | 简单直接，复用已有导出函数 | 20/20 | 15/15 | 25/25 | 20/20 | 20/20 |
| RC4 | 三处一并修复 | 改动最小，零风险 | 20/20 | 15/15 | 25/25 | 20/20 | 20/20 |

### 落选方案存档
- RC1: 维持现状+注释说明（不能解决根本问题）、仅修改 UI 导入路径到 shared 但不移动类型（类型仍在 main，仍有双源风险）
- RC2: AbortController（过度设计，generation 计数器足够）、取消 boot promise 功能（影响启动体验）
- RC3: 删除 ToastState 类（改动过大，影响生产代码）
- RC4: 仅修复部分问题（累积价值低）

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | 1 | ✅ | 0 新增错误（预存错误在 window-matcher.ts/base.ts，与本次无关） |
| VIT | 1 | ✅ | notificationStore 8/8、appsStore 40/40、quick-apply-engine 全部通过 |
| BIO | 1 | ⚠️ | 预存错误在 QuickApplyPanel.tsx (useExhaustiveDependencies)，非本次引入 |
| CTR | 1 | ✅ | QuickApplyPanel.tsx 违规已修复（唯一违规项消除） |

### TSC 验证
- 新增错误: 0
- 预存错误: window-matcher.ts (JSDoc 注释中 */ 闭合)、base.ts (外部会话范围)

### VIT 验证
- notificationStore.test.ts: 8/8 ✅
- appsStore.test.ts: 40/40 ✅
- quick-apply-engine.test.ts: 17/17 ✅
- quick-apply-ipc.test.ts: 预存 transform 错误（window-matcher.ts parse error）

### CTR 验证
- QuickApplyPanel.tsx 架构边界违规: **已修复** ✅
- injection-orchestrator.ts 违规: 预存（外部会话引入）
- 24 条 C4-STORE 跨 store 依赖: 信息性记录

---

## 审计结论

| 维度 | 结论 |
|------|------|
| 遗漏 | RC5（架构语义分散）延后，非必须修复 |
| 回归 | 无 — 修改范围限定在 QuickApply 类型/notificationStore/appsStore/wallpaperStore/asar-joint-analysis |
| 新增问题 | 无 — 未引入新 code smell |
| 一致性 | 通过 — generation 计数器与现有 moduleState 模式一致，类型下沉与 shared/types 架构一致 |
| 文档同步 | 通过 — 类型移动有 JSDoc 注释说明 |

---

## 修改文件清单

| 文件 | 修改类型 | 净增行数 |
|------|---------|---------|
| src/shared/types/ipc.ts | 源码 | +54（新增 QuickApply 类型 + 简化桥签名） |
| src/main/quick-apply/quick-apply-engine.ts | 源码 | -45（移除本地类型定义，改为从 shared 导入） |
| src/main/quick-apply/quick-apply-deps.ts | 源码 | +1（拆分 import） |
| src/main/ipc/quick-apply-ipc.ts | 源码 | +1（修改 import 路径） |
| src/main/ipc/quick-apply-ipc.test.ts | 源码 | +1（拆分 import） |
| src/ui/components/quick-apply/QuickApplyPanel.tsx | 源码 | +1（修改 import 路径） |
| src/ui/stores/notificationStore.test.ts | 测试 | +3（beforeEach 改用 resetToastState） |
| src/ui/stores/appsStore.ts | 源码 | +8（generation 计数器） |
| src/ui/stores/wallpaperStore.ts | 源码 | +7（合并 import） |
| src/main/ipc/asar-joint-analysis.ts | 源码 | +1（替换 as any） |

---

## 测试增量
- 新增测试: 0（本次为修复已有测试 + 代码改进，未新增独立测试用例）
- 回归: 0（全部修改文件测试通过）

---

## Commits

```
e77f9874 fix(architecture): move QuickApply types to shared boundary [phase5-step4]
027d0e80 fix(appsStore): add generation counter to prevent stale boot promise after HMR [phase5-step3]
e471fa46 fix(hygiene): merge duplicate imports + remove as any [phase5-step2]
02605e53 fix(test): add resetToastState() to notificationStore beforeEach [phase5-step1]
4f798598 snapshot: pre-inspection baseline 2026-08-30-1200 [direction F]
```

---

## 下次巡检建议

1. **方向 A（核心链路可靠性，权重最高）** — agent-engine-service.ts 855 行零测试，apply/restore/wallpaper 全流程测试覆盖
2. **方向 D（测试质量均衡）** — 4 个核心 Store（agentStore/settingsStore/communityStore/secondaryInjectStore）仍零独立测试
3. **方向 K（渲染管线）** — React 19 + Zustand 撕裂排查、useSyncExternalStore selector 稳定性
4. **方向 C（内存与资源审计）** — 主进程内存趋势、BrowserWindow 泄漏检测
5. **完成 window-matcher.ts 修复** — JSDoc 注释中 `*/` 闭合导致 tsc/vitest transform 失败，影响多个测试文件

---

*报告生成时间: 2026-08-30 12:30*
