# AgentSkin 巡检报告 — 方向 K（渲染管线）

## 元信息

| 字段 | 值 |
|------|-----|
| 方向编号 | K |
| 方向名 | 渲染管线（React19+Zustand 撕裂排查、useSyncExternalStore selector 稳定性） |
| 状态 | **COMPLETED** |
| 快照 commit | `5eee7388` |
| 最终 commit | `99bfb8b5` |
| 执行时间 | 2026-08-25 16:00–16:35 |
| 选取方式 | 加权随机（权重 2，随机数 19/24） |

## 执行摘要

| 指标 | 数值 |
|------|------|
| 发现问题总数 | 30（Scout-α 15 + Scout-β 15） |
| 去重后问题数 | 25 |
| 根因聚类数 | 7 |
| 已修复根因 | 4/7（RC1/RC4/RC5/RC6） |
| 未修复根因 | 3/7（RC2/RC3/RC7 — 留待后续） |
| 新增测试 | 0（本次聚焦性能修复，未新增测试） |
| 修改文件 | 6 |
| 独立 commit | 4 + 1 fix |
| 回滚次数 | 0 |
| 审计发现问题 | 0 |

---

## 根因与修复明细

### RC1: useStudioStore facade 全量订阅 + 新对象返回（Critical）

**问题描述**: `useStudioStore` facade 通过无 selector 方式订阅所有 4 个子 store，任意子 store 的任意字段变化都会触发 facade 重渲染。同时 `getCombinedState()` 在每次渲染时创建全新对象，导致所有使用 facade 的组件（StudioStatusBar、StudioTopBar 等）全量重渲染。

**影响范围**: `src/ui/studio/useStudioStore.ts`

**修复方案**: 
- 将 4 个无 selector 订阅改为 `useShallow` + 字段选择器，仅在实际订阅字段变化时重渲染
- 使用 `useMemo` 包裹 `combined` 和 `result`，确保引用稳定性
- 重构 `getCombinedState()` 为 `buildCombinedState(project, bundle, capture, iw)` 参数化版本

**修复 commit**: `5805d0a5`

---

### RC2: Store selector 不稳定 — 每次更新创建新引用（Major，未修复）

**问题描述**: `statusStore`、`appsStore` 等核心 store 每次更新都创建全新对象/Map，导致 `useSyncExternalStore` 的 shallow compare 失效，消费者无法跳过不必要的重渲染。

**影响范围**: `src/ui/stores/statusStore.ts`、`src/ui/stores/appsStore.ts`

**未修复原因**: 涉及核心 store 架构，改动风险高。建议后续方向 K 续检或方向 F（架构正交）覆盖。

---

### RC3: 跨 store 异步时序问题（Major，未修复）

**问题描述**: `themeStore.restoreAll` 使用 `Promise.all` 并发执行多个 restore，每个 restore 完成后独立调用 `useStatusStore.setState()`，在 React 19 的 `useSyncExternalStore` 下可能触发 tearing 检测（error #185）。

**影响范围**: `src/ui/stores/themeStore.ts`

**未修复原因**: 需要重构为批量 setState 或串行执行，涉及核心链路。建议提交 RFC 评审。

---

### RC4: 模块级可变状态泄漏（Major）

**问题描述**: 
1. `VirtualThemeGrid` 的 RAF 批处理使用模块级变量 `_rafPending` 和 `_rafCallbacks`，多实例场景下互相干扰
2. `workspaceStore` 的 `PUSH_DURATION_HISTORY` 滚动缓冲在 store reset 时不清理，导致测试间数据泄漏

**影响范围**: `src/ui/components/themes/VirtualThemeGrid.tsx`、`src/ui/stores/workspaceStore.ts`

**修复方案**:
1. 将 RAF 模块级变量移入 `useRef`，每个组件实例独立
2. 添加 `testResetPushDurationHistory()` 方法并在 `resetWorkspaceStore()` 中调用

**修复 commit**: `091505c3`

---

### RC5: 组件 render 中创建新引用 props（Major）

**问题描述**: `useAppController` 返回包含 50+ 字段的大型对象，每次渲染都是全新引用。下游 `React.memo` 子组件因浅比较失效而全量重渲染。

**影响范围**: `src/ui/hooks/useAppController.ts`

**修复方案**: 使用 `useMemo` 包裹返回值，列出完整依赖数组。`setLocale` 用 `useCallback` 包裹确保引用稳定。

**修复 commit**: `64bc53da`

---

### RC6: 直接 DOM 操作与 React 冲突（Major）

**问题描述**: `ThemeCard` 的 icon img `onError` 回调直接操作 DOM (`e.target.style.display = 'none'`)，在 React 19 concurrent rendering 下可能被覆盖。

**影响范围**: `src/ui/components/themes/ThemeCard.tsx`

**修复方案**: 添加 `iconError` state，用条件渲染替代直接 DOM 操作（与 preview img 的 `imgError` 模式一致）。

**修复 commit**: `64bc53da`

---

### RC7: 测试覆盖盲区与假断言（Minor，未修复）

**问题描述**: 
- `statusStore` 订阅回调零测试覆盖
- `secondaryInjectStore.test.ts` 存在假断言（测试名与断言不匹配）
- `shellStore.test.ts` 未覆盖 localStorage 异常路径
- `workspaceStore.test.ts` 的 `flushPromises` 实现不可靠

**未修复原因**: 测试质量属于方向 D（测试质量均衡）覆盖范围。

---

## 方案选优记录

| 根因 | 候选方案 | 选定方案 | 选择理由 |
|------|---------|---------|---------|
| RC1 | ① 删除 facade 直接订阅子 store ② useShallow + useMemo ③ 拆分 hook | 方案② | 向后兼容、改动最小、性能收益明确 |
| RC4 | ① 实例级 useRef ② 模块级 Map<instanceId, state> ③ 移除 RAF 批处理 | 方案① | 标准 React 模式、零依赖、多实例安全 |
| RC5 | ① useMemo 包裹 ② 拆分 controller 为多个 hook ③ 消费者侧 useShallow | 方案① | 改动集中、消费者零变更、引用稳定性保证 |
| RC6 | ① React state ② ref callback ③ CSS `onError` + hidden class | 方案① | 与 preview img 模式一致、最简洁 |

---

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|----------|------|------|------|
| TSC | R1 | ❌ 1 error | `buildCombinedState` 参数类型过严 |
| TSC | R2 | ✓ pass | 改为 Pick 接口后通过 |
| VIT | R1 | ✓ 4988 passed | 1 个预存 vi.mock hoisting 失败（非本次引入） |
| BIO | R1 | ✓ pass | 4 个核心源文件通过 |
| CTR | R1 | ✓ pass | 公共 API 完全向后兼容 |

---

## 审计结论

| 维度 | 结果 | 说明 |
|------|------|------|
| 遗漏检查 | 无 | RC1/RC4/RC5/RC6 均有对应修复 |
| 回归检查 | 无 | 修改仅影响渲染性能，未触及业务逻辑 |
| 新增问题 | 无 | 未引入新 code smell 或反模式 |
| 一致性 | ✓ | 修改风格与项目现有模式一致（useShallow、useCallback 已在项目中使用） |
| 文档同步 | N/A | 未修改公开 API，无需文档更新 |

---

## 修改文件清单

| 文件 | 修改类型 | 说明 |
|------|---------|------|
| `src/ui/studio/useStudioStore.ts` | 重构 | useShallow 订阅 + useMemo 缓存 + buildCombinedState 参数化 |
| `src/ui/components/themes/VirtualThemeGrid.tsx` | 修复 | RAF 模块级变量 → useRef 实例级 |
| `src/ui/components/themes/ThemeCard.tsx` | 修复 | DOM 操作 → React state |
| `src/ui/hooks/useAppController.ts` | 修复 | useMemo 包裹返回值 + useCallback 包裹 setLocale |
| `src/ui/stores/workspaceStore.ts` | 增强 | 添加 testResetPushDurationHistory 方法 |
| `src/ui/stores/test-helpers/reset-workspace-store.ts` | 增强 | 调用 testResetPushDurationHistory |

---

## 下一步建议

1. **【高优先级】RC3 跨 store 异步撕裂修复** — `restoreAll` 并发 setStatus 是 React 19 下的已知风险（error #185），建议提交 RFC 评审批量更新方案
2. **【中优先级】RC2 Store selector 稳定性** — 对 `statusStore`、`appsStore` 等核心 store 实施 selector 稳定性模式（仅在内容变化时更新引用）
3. **【中优先级】方向 D 覆盖 RC7** — 将 RC7 的测试覆盖盲区纳入下次方向 D 巡检
4. **【低优先级】useStudioStore facade 消费者审计** — 检查所有调用 `useStudioStore()` 无 selector 的组件，引导使用 `useShallow` 或字段选择器
5. **【监控】agent-engine-service.test.ts vi.mock hoisting** — 该测试文件的 mock 问题需独立修复，建议作为方向 A 续检项
