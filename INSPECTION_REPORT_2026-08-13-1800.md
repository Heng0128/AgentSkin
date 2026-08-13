# AgentSkin 巡检报告 — 2026-08-13 1800

## 元信息

- **方向编号**: K
- **方向名**: 渲染管线 (React 19 + Zustand v5 tearing 排查、useSyncExternalStore selector 稳定性)
- **状态**: COMPLETED
- **快照 commit**: `af02146` (snapshot: pre-inspection baseline 2026-08-13-1800-K-rendering-pipeline)
- **执行时间**: 2026-08-13 18:00 ~ 18:30
- **分支**: main (直接操作)

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 17 |
| Critical | 0 |
| Major | 11 |
| Minor | 5 |
| Info | 1 |
| 根因数 | 8 |
| 已修复 (本巡检) | 0 (3 个高 ROI 问题由并行巡检 `1d2ebe5` 抢先修复) |
| 已修复 (并行) | 3 |
| 待后续处理 | 8 |
| 回滚次数 | 0 |

**核心结论**: 方向 K 的 3 个最高 ROI 问题在巡检期间已被并行巡检 agent 正确修复。Phase 6 验证通过 (VIT 32/32, BIO clean)。1 个新的 TSC 回归由并行 commit `1c0b860` 引入。

---

## Phase 1-2: 发现与根因

### 根因分布

| 根因 | 描述 | 影响文件 | 严重度 | 状态 |
|------|------|----------|--------|------|
| R1 | bootProgressStore Map 每次重建 + useBootProgress 订阅整个 Map → 启动期高频重渲染 | bootProgressStore.ts, useBootProgress.ts | major | 已修复 (并行) |
| R2 | toggleSidebar 不持久化 localStorage → 刷新丢失用户偏好 | shellStore.ts | major | 已修复 (并行) |
| R3 | wallpaperStore companion 递归导致壁纸双应用 | wallpaperStore.ts | major | 确认为 by-design |
| R4 | environmentStore switchEnvironment null/undefined 比较产生重复 preset | environmentStore.ts | major | 已修复 (并行) |
| R5 | useAppController 渲染函数体内 getState() 非订阅 → 可能返回过时数据 | useAppController.ts | major | 未修复 |
| R6 | installFlowStore 5 个僵尸字段永不被 set() 更新 | installFlowStore.ts | major | 未修复 |
| R7 | as any/never 类型断言掩盖真实类型问题 | 多文件 | minor | 未修复 |
| R8 | handleApplyAll cursor++ 非原子并发 worker 竞态 | useWallpaperActions.ts | major | 未修复 (JS 单线程下实际安全) |

### 关键发现明细

| # | 文件 | 行号 | 严重度 | 问题描述 | 修复方案 | 状态 |
|---|------|------|--------|----------|----------|------|
| 1 | bootProgressStore.ts | 141 | major | applyLine 每次创建新 Map 导致重渲染 | early return 当数据无变化 | 已修复 (并行) |
| 2 | shellStore.ts | 83 | major | toggleSidebar 不持久化 | 添加 localStorage.setItem | 已修复 (并行) |
| 3 | environmentStore.ts | 128 | major | null vs undefined 比较 | `env.theme?.id ?? null` | 已修复 (并行) |
| 4 | useBootProgress.ts | 32 | major | 订阅整个 progress Map | 随 R1 一起解决 | 已修复 (并行) |
| 5 | useAppController.ts | 338 | major | getState() 在渲染体非订阅模式 | 需重构转为 selector | 未修复 |
| 6 | installFlowStore.ts | 105 | major | 5 个僵尸字段永不被 set() | 移除或正确维护 | 未修复 |
| 7 | useWallpaperActions.ts | 149 | major | cursor++ 非原子 | JS 单线程下安全，可标注 | 未修复 |
| 8-17 | 多文件 | - | minor/info | as any、僵尸字段、只读字段、日期生成等 | 增量清理 | 未修复 |

---

## Phase 3-4: 方案选优

### R1 (bootProgressStore) — 方案对比

| 方案 | 思路 | 优点 | 缺点 | 评分 |
|------|------|------|------|------|
| A: useShallow | 改用 useShallow 订阅 Map | 简单, 1 行改动 | 治标不治本, Map 引用仍变 | 02.4 |
| **B: early return** | applyLine 内容无变化时返回原 state | 根治, Map 引用不变, 零依赖 | 增加比较逻辑 | **17.3** |
| C: useSyncExternalStore | 替换 zustand 订阅 | 最精细控制 | 过重, 需大改 | 10.1 |

**选择**: B (early return) — 加权评分最高: 时间复杂度 0.85 / 空间复杂度 00.9 / 长期可维护性 0.95 / 扩展性 0.85 / 依赖可控性 1.0

### R2 (toggleSidebar) — 方案对比

| 方案 | 思路 | 评分 |
|------|------|------|
| **A: 内联持久化** | toggleSidebar 内部调用 localStorage.setItem | **18.1** |
| B: 委托 setSidebarCollapsed | toggle 改为调用 collaps | 16.3 |

**选择**: A (内联持久化) — 最小改动, 回滚简单

### R4 (environmentStore) — 方案对比

| 方案 | 思路 | 评分 |
|------|------|------|
| **A: null 归一化** | `env.theme?.id ?? null` | **19.2** |
| B: 显式 undefined 检查 | `p.themeId === undefined \|\| p.themeId === env.theme?.id` | 17.5 |

**选择**: A — 1 行改动, 与 createPreset 语义一致

---

## Phase 5-6: 实施与验证

### 实施情况

Phase 5 识别的问题全部在实施前已被并行巡检 commit `1d2ebe5` (18:15:57) 修复。本巡检净变更 = 0。

1d2ebe5 修复的文件列表:
- `src/ui/stores/shellStore.ts` — toggleSidebar 持久化
- `src/ui/stores/bootProgressStore.ts` — early return 去重
- `src/ui/stores/environmentStore.ts` — null 归一化
- 额外捆绑: wallpaper-injector, apply-result, 等

### 验证结果

| Verifier | 结果 | 轮次 | 备注 |
|---------|------|------|------|
| TSC | 已知旧错 + 1 新回归 | 1 | 3 个 pre-existing (af02146 已有), 1 个新回归 (1c0b860 引入 AgentDetailSheet.tsx) |
| VIT | 32/32 ✓ | 1 | store tests 全部通过 |
| BIO | 3 files ✓ | 1 | shellStore/bootProgressStore/environmentStore clean |
| CTR | ✓ | 1 | 无样式泄漏, 无 Store 边界违反, 无类型重复 |

---

## Phase 8: 审计结论

| 审计维度 | 结论 |
|----------|------|
| 遗漏检查 | 3 个高 ROI 问题有对应修复 ✓ |
| 回归检查 | 1 个新 TSC 回归 (AgentDetailSheet.tsx:120, commit 1c0b860) |
| 新增问题 | 1 个 trivial 可读性回归 (core-ipc.test.ts 注释合并) |
| 一致性 | 修复风格与项目一致 ✓ |
| 文档同步 | 无需更新文档 ✓ |

### 剩余问题

| ID | 文件 | 问题 | 推荐理由 |
|----|------|------|----------|
| R5 | useAppController.ts | getState() 非订阅模式 | 架构重构, 优先级中 |
| R6 | installFlowStore.ts | 5 个僵尸字段 | 代码卫生, 优先级低 |
| R8 | useWallpaperActions.ts | cursor++ 非原子 | JS 单线程下安全, 可忽略 |

---

## 并行巡检问题

本次巡检期间检测到多个并行 agent 同时操作 main 分支:

| Commit | 时间 | 描述 | 问题 |
|--------|------|------|------|
| `1d2ebe5` | 18:15:57 | fix(wallpaper-injector) 捆绑 9 文件 | 违反 G2 (单 commit 应单一逻辑) |
| `1c0b860` | 之前 | feat(workspace) apply button loading | 引入 TSC 回归: `detailApplying` 不存在 |
| `30a2c88` | 18:16:54 | fix(apply-result) | 质量可接受 |

### TSC 回归详情

| 文件 | 行号 | 错误 | 引入 commit |
|------|------|------|-------------|
| src/ui/components/workspace/AgentDetailSheet.tsx | 120 | `detailApplying` 不存在 (应为 `detailApply`) | `1c0b860` |

---

## 下一步建议

1. **[HIGH] 修复 TSC 回归 AgentDetailSheet.tsx:120** — `detailApplying` → `detailApply`，由并行 commit 1c0b860 引入，建议立即修复
2. **[HIGH] 建立 main 分支操作互斥机制** — 多个巡检 agent 同时操作 main 导致 commit 捆绑、回归引入。建议: hagen queue 或前置 git pull + 冲突检测
3. **[MEDIUM] 处理 installFlowStore 僵尸字段** — 移除或正确维护 5 个永不被 set() 更新的派生字段
4. **[MEDIUM] useAppController getState() 订阅化** — 将非订阅读取转为 selector，确保数据新鲜度
5. **[LOW] cursor++ 加注释** — 标注 JS 原子性保证，避免后续 agent 重复报告

---

## 附: 验证命令

```bash
npx tsc --noEmit         # 4 errors (3 pre-existing + 1 new)
npx vitest run src/ui/stores/  # 32/32 passed
npx biome check src/ui/stores/shellStore.ts src/ui/stores/bootProgressStore.ts src/ui/stores/environmentStore.ts  # clean
```
