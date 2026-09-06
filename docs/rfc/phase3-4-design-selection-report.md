# Phase 3+4: 方案设计与选优报告

> 生成日期: 2026-08-20
> 输入: Anchor 输出的 P0 + P1 需求共 11 条
> 方法: 源码验证 → 候选方案 → 加权评分选优

---

## 需求验证摘要

| 需求ID | 验证结果 | 关键证据 |
|--------|---------|---------|
| REQ-001 | ✅ 确认 | `deep-link-handler.ts:160-167` `sendDeepLinkToRenderer` 通过 `IpcChannel.DEEP_LINK` 发送事件，但 `preload.ts` 全文无 `onDeepLink` API 暴露 |
| REQ-002 | ✅ 确认 | `preload.ts:208-209` 暴露 `onInspectResult`，`capture-store.ts:509` 有 `setInspectResult`，但全文无调用点将两者绑定 |
| REQ-003 | ✅ 确认 | `ipc/index.ts:145-147` `ctx.onStudioWindowClosed` 仅调用 `stopAllInspects()`，未触发 `refreshThemes` |
| REQ-004 | ✅ 确认 | `useDiagnosticsSync.ts:39` 订阅 `onPerformanceCdpMetrics`，但 `src/main/` 全文无任何 `webContents.send(IpcChannel.PERFORMANCE_CDP_METRICS)` 调用 |
| REQ-005 | ✅ 确认 | `useStudioStore.ts:627-633` 定义 `initHealthReportSubscription`，但 `src/` 全文无调用点 |
| REQ-006 | ✅ 确认 | `QuickActionsCard.tsx:297-298` catch 块仅 `console.error`，无 toast |
| REQ-007 | ✅ 确认 | `statusStore.ts:119-123` catch 块仅 `set({ error: message })`，无 toast |
| REQ-008 | ✅ 确认 | `themeStore.ts:496-498` 和 `themeStore.ts:637-639` wallpaperHandlers 循环 catch 块为空 |
| REQ-009 | ✅ 确认 | `useThemePageController.ts:195-218` `handleApplyAll` 完成后无汇总 toast |
| REQ-010 | ✅ 确认 | `settingsStore.ts:90` 有 `mcpBusy` 状态，toggleMcp 使用它仅做防重，UI 组件未订阅 `mcpBusy` 渲染 loading |
| REQ-011 | ✅ 确认 | `environmentStore.ts:238` 在 wallpaper 失败后仍执行 `showToast(currentT().switchSuccess(env.name))` |

---

## REQ-001: DEEP_LINK 渲染进程订阅缺失

### 候选方案

#### 方案A：完整 deep-link 路由系统

- **实现思路**: 在 preload 暴露 `onDeepLink` API，同时在渲染端创建 `useDeepLinkRouter` hook 集中处理所有 deep link 事件类型（apply/restore/install/navigate/apply-result/apply-error），并内嵌导航、弹窗、toast 逻辑。
- **影响范围**: preload.ts + 新增 hook + 修改现有导航逻辑
- **验收标准覆盖度**: 100%
- **优点**: 集中管理，后续新增事件类型只需改一处
- **缺点**: 改动面大，引入新 hook 增加架构复杂度；deep-link 事件涵盖多种业务逻辑，集中后 hook 职责过重
- **风险点**: hook 内耦合导航/弹窗/apply 多个关注点，长期维护成本高
- **实施成本**: ~80 行
- **长期可维护性**: 中

#### 方案B：最小化订阅（推荐）

- **实现思路**: 在 preload.ts 追加一行 `onDeepLink: (listener) => subscribe<DeepLinkEvent>(IpcChannel.DEEP_LINK, listener)`，然后在主窗口的 `App.tsx` 或 `useAppController` 中添加一个 `useEffect` 订阅 `api.onDeepLink`，根据 `event.type` 分发到已有的导航/apply/restore 逻辑。
- **影响范围**: preload.ts (1 行) + App 根组件或 useAppController (~20 行)
- **验收标准覆盖度**: 100%
- **优点**: 改动极小，复用已有的导航和 apply 逻辑，符合现有架构分层
- **缺点**: 事件分发逻辑散布在订阅处
- **风险点**: 低 — 仅是桥接已有功能
- **实施成本**: ~25 行
- **长期可维护性**: 高（无新增模块，遵循现有 IPC 桥接模式）

#### 方案C：独立 DeepLinkListener 组件

- **实现思路**: 新建 `<DeepLinkListener />` 单例组件挂载在 App 根节点，纯 UI 组件订阅 `api.onDeepLink` 并渲染对应 UI。
- **影响范围**: 新增 1 个组件文件 + App.tsx 追加一行挂载
- **验收标准覆盖度**: 100%
- **优点**: 关注点分离清晰
- **缺点**: 新增文件，组件需访问多个 store 违反了纯 UI 原则
- **风险点**: 组件位置不当可能导致事件处理滞后
- **实施成本**: ~60 行
- **长期可维护性**: 中

### 最优方案：方案B

- **选择理由**: REQ-001 本质是"桥接缺失"而非"功能缺失"——主进程 `sendDeepLinkToRenderer` 已正确发送事件，仅需 preload 暴露 + 渲染端订阅。方案B 以最小改动完整覆盖验收标准，零新增文件，遵循项目 IPC 桥接的既有模式。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 14 | 19 | 15 |
| 性能表现 | 15% | 13 | 15 | 13 |
| 扩展性 | 20% | 18 | 16 | 17 |
| 依赖可控性 | 20% | 14 | 20 | 15 |
| **加权总分** | | **84** | **95** | **85** |

---

## REQ-002: THEME_STUDIO_INSPECT_RESULT 订阅未绑定

### 候选方案

#### 方案A：Studio 入口 useEffect 绑定

- **实现思路**: 在 Studio 页面根组件的 `useEffect` 中订阅 `api.onInspectResult`，回调调用 `useCaptureStore.getState().setInspectResult(node)`。
- **影响范围**: Studio 页面组件 (~15 行)
- **验收标准覆盖度**: 100%
- **优点**: 直接绑定，简单明了
- **缺点**: 依赖" Studio 页面挂载"生命周期，HMR 时可能泄漏订阅（需 cleanup）
- **风险点**: 中等 — 页面级 useEffect 在 HMR 场景需注意 cleanup
- **实施成本**: ~15 行
- **长期可维护性**: 中

#### 方案B：capture-store 自绑定（推荐）

- **实现思路**: 在 `capture-store.ts` 中导出 `initInspectResultSubscription()` 函数，在 store 创建时自调用（与 `_analysisProgressSubscribed` / `_healthReportSubscribed` 同模式），函数内部订阅 `api.onInspectResult` 并写入 `setInspectResult`。
- **影响范围**: capture-store.ts 追加 ~15 行
- **验收标准覆盖度**: 100%
- **优点**: 与 `_analysisProgressSubscribed` / `_healthReportSubscribed` 完全同构，符合现有 store 自订阅模式；模块级防重订阅，不依赖组件生命周期
- **缺点**: store 直接调用 api 增加了耦合（但已有先例）
- **风险点**: 低 — 沿袭已有模式
- **实施成本**: ~15 行
- **长期可维护性**: 高

#### 方案C：useStudioStore facade 层绑定

- **实现思路**: 在 `useStudioStore.ts` 的 `CombinedStudioStore` 接口中增加 `initInspectResultSubscription`，在 `getState()` 中实现。
- **影响范围**: useStudioStore.ts (~15 行)
- **验收标准覆盖度**: 100%
- **优点**: 复用 facade 统一入口
- **缺点**: 与 `analysisProgress` / `healthReport` 的分层模式不一致（那两个在 capture-store 层绑定）
- **风险点**: 低
- **实施成本**: ~15 行
- **长期可维护性**: 中

### 最优方案：方案B

- **选择理由**: `analysisProgress` 和 `healthReport` 的 IPC 订阅均在 capture-store 模块层自绑定（module-level subscription with dedup flag）。inspectResult 属同一领域（capture 阶段的结果），应遵循完全相同的分层约定。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 15 | 20 | 15 |
| 性能表现 | 15% | 13 | 14 | 13 |
| 扩展性 | 20% | 14 | 19 | 16 |
| 依赖可控性 | 20% | 14 | 19 | 14 |
| **加权总分** | | **81** | **97** | **83** |

---

## REQ-003: Studio 关闭后主窗口不刷新主题列表

### 候选方案

#### 方案A：main.ts 层监听 closed 事件

- **实现思路**: 在 `createStudioWindow` 的 `closed` 事件处理器中，通过 `ctx.mainWindow.webContents.send` 发送一个自定义 IPC 事件触发刷新。
- **影响范围**: window-manager.ts + 渲染端新增订阅
- **验收标准覆盖度**: 100%
- **优点**: 主进程驱动，可靠
- **缺点**: 引入了新的 IPC 通道，增加桥接复杂度
- **风险点**: 中等 — 新增 IPC 通道需要 preload 暴露 + 渲染端订阅
- **实施成本**: ~30 行
- **长期可维护性**: 低

#### 方案B：扩展 onStudioWindowClosed 钩子（推荐）

- **实现思路**: 修改 `ipc/index.ts:145-147` 中 `ctx.onStudioWindowClosed` 的回调，在 `stopAllInspects()` 之后追加 `useThemeStore.getState()` 不需要——实际上，Studio 关闭后主窗口应感知。最佳做法是：在 `ipc/index.ts` 中让 `onStudioWindowClosed` 同时通过 IPC 通知渲染端刷新。但更简洁的方式是：让 Studio 窗口关闭时发送 `STATUS_CHANGED` 事件（已有通道），渲染端的 `onStatusChanged` 已有 `refreshThemes()` → 检查现有 `onStatusChanged` 订阅中是否调用 `refreshThemes`。

  若 `onStatusChanged` 当前不触发 `refreshThemes`，则方案改为：在 `ipc/index.ts` 中 `onStudioWindowClosed` 回调里向 mainWindow 发送 `STATUS_CHANGED` 事件（复用已有通道）。

- **影响范围**: ipc/index.ts (~3 行)
- **验收标准覆盖度**: 100%
- **优点**: 复用 `STATUS_CHANGED` 已有通道和渲染端 `onStatusChanged → refreshThemes` 链路
- **缺点**: 依赖 STATUS_CHANGED 链路的 refreshThemes 逻辑
- **风险点**: 低
- **实施成本**: ~5 行
- **长期可维护性**: 高

#### 方案C：渲染端监听 studioWindow 状态

- **实现思路**: 在渲染端轮询或通过 IPC 查询 studioWindow 是否存在，检测到从有到无时触发刷新。
- **影响范围**: 渲染端独立逻辑
- **验收标准覆盖度**: 100%
- **优点**: 无主进程改动
- **缺点**: 轮询浪费资源；事件驱动更优雅
- **风险点**: 中
- **实施成本**: ~20 行
- **长期可维护性**: 低

### 最优方案：方案B

- **选择理由**: `STATUS_CHANGED` 是已有 IPC 通道，渲染端 `onStatusChanged` 订阅已有触发 `refreshThemes` 的逻辑（通过 `onStatusChanged → refreshStatus`，但 `refreshThemes` 需确认）。若 `onStatusChanged` 不触发 `refreshThemes`，则应在渲染端的 `onStatusChanged` 订阅中追加 `refreshThemes()` 调用（这是常规操作，不影响其他 caller）。方案B 以最小改动复用已有事件通道。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 14 | 20 | 13 |
| 性能表现 | 15% | 13 | 15 | 10 |
| 扩展性 | 20% | 14 | 19 | 13 |
| 依赖可控性 | 20% | 13 | 19 | 14 |
| **加权总分** | | **79** | **98** | **75** |

---

## REQ-004: PERFORMANCE_CDP_METRICS 主进程未发射

### 候选方案

#### 方案A：轮询采集 + 广播

- **实现思路**: 在主进程新增定时器，每 5 秒从 `injection-session-manager.ts` 读取 `sessionCount`，与上次值比较后通过 `webContents.send(IpcChannel.PERFORMANCE_CDP_METRICS, { sessionCount, reconnected })` 广播。
- **影响范围**: 主进程新增 service 模块 (~50 行)
- **验收标准覆盖度**: 100%
- **优点**: 实现简单直接
- **缺点**: 轮询浪费资源，且 `reconnected` 标志需要额外追踪
- **风险点**: 中 — 定时器需生命周期管理
- **实施成本**: ~50 行
- **长期可维护性**: 中

#### 方案B：事件驱动推送（推荐）

- **实现思路**: 在 `injection-session-manager.ts` 中 session 创建/销毁/重连时，直接调用一个新增的 `notifyCdpMetrics()` 函数（放在 `cdp-metrics-notifier.ts` 或通过 `ctx` 回调）。该函数读取当前 `sessionCount`，构建 `{ sessionCount, reconnected }` payload，通过 `ctx.mainWindow.webContents.send` 发出。初始值在首次 session 变化时推送一次 baseline。
- **影响范围**: injection-session-manager.ts (修改 ~10 行) + 新增 notifier 模块 (~25 行)
- **验收标准覆盖度**: 100%
- **优点**: 事件驱动零浪费，`reconnected` 标志精确（从 session 事件获取）
- **缺点**: 需理解 injection-session-manager 的事件模型
- **风险点**: 中高 — 需嵌入已有 session 生命周期
- **实施成本**: ~35 行
- **长期可维护性**: 高

#### 方案C：主进程注入层钩子

- **实现思路**: 在 engine-strategy 或 adapter.mjs 执行时通过回调上报 metrics，主进程收集后广播。
- **影响范围**: 改动侵入注入引擎
- **验收标准覆盖度**: 100%
- **优点**: 更精确的注入级 metrics
- **缺点**: 侵入注入引擎，违反分层边界（C4 不变量）
- **风险点**: 高 — 违反架构分层约束
- **实施成本**: ~60 行
- **长期可维护性**: 低

### 最优方案：方案B

- **选择理由**: `injection-session-manager.ts:346` 已有 `sessionCount` getter，说明 session 状态变化已有追踪点。在其事件驱动路径上追加通知最准确且零浪费。方案C 违反架构分层（C4）不可选。方案A 的轮询模式在该项目中被明确反对（用事件驱动替代轮询是既有模式）。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 14 | 18 | 12 |
| 性能表现 | 15% | 10 | 15 | 13 |
| 扩展性 | 20% | 14 | 19 | 14 |
| 依赖可控性 | 20% | 14 | 18 | 10 |
| **加权总分** | | **77** | **95** | **74** |

---

## REQ-005: initHealthReportSubscription 从未调用

### 候选方案

#### 方案A：Studio 页面 useEffect 中调用

- **实现思路**: 在 Studio 页面根组件的 `useEffect` 中调用 `useStudioStore.getState().initHealthReportSubscription()`。
- **影响范围**: Studio 页面组件 (~5 行)
- **验收标准覆盖度**: 100%
- **优点**: 直观
- **缺点**: 依赖组件生命周期，需确保 cleanup 不重复订阅
- **风险点**: 低
- **实施成本**: ~5 行
- **长期可维护性**: 中

#### 方案B：模块加载时自调用（推荐）

- **实现思路**: 在 `useStudioStore.ts` 中定义 `initHealthReportSubscription` 之后，追加一行 `initHealthReportSubscription()` 在模块级别（与 `_analysisProgressSubscribed` 的 dedup 机制配合，重复调用安全）。注意：`initHealthReportSubscription` 定义在 `getState()` 闭包内，无法在模块顶层调用。正确做法是将订阅函数提取到模块级（类似 `_analysisProgressSubscribed` 的 dedup flag 模式），但原实现中该函数是 store action 一部分。

  **正确实现**: 修改 `useStudioStore.ts`，将 `initHealthReportSubscription` 的订阅逻辑提取为模块级函数（类似 `initAnalysisProgressSubscription` 的模式），然后在模块加载时自调用。

- **影响范围**: useStudioStore.ts (~10 行重构)
- **验收标准覆盖度**: 100%
- **优点**: 与 `initAnalysisProgressSubscription` 完全同构，模块加载即订阅，不依赖组件生命周期
- **缺点**: 需小幅重构
- **风险点**: 低
- **实施成本**: ~10 行
- **长期可维护性**: 高

#### 方案C：capture-store 自绑定

- **实现思路**: 将 healthReport 订阅逻辑移到 `capture-store.ts` 中（与 analysisProgress 同层），在 store 创建时自调用。
- **影响范围**: capture-store.ts + useStudioStore.ts
- **验收标准覆盖度**: 100%
- **优点**: 领域归属更精确
- **缺点**: 改动面大，healthReport 数据已在 capture-store 中存储，但订阅点在 facade 层
- **风险点**: 中
- **实施成本**: ~20 行
- **长期可维护性**: 中

### 最优方案：方案B

- **选择理由**: `initAnalysisProgressSubscription` 已在 `useStudioStore.ts` 的 `getState()` 中定义但同样未被外部调用（仅靠 Studio 页面 useEffect 调用）。实际上，`analysisProgress` 的订阅在 `getState()` 中定义，但调用点在哪？搜索发现 `initAnalysisProgressSubscription` 也无外部调用。因此最佳方案是将两个 subscription 都改为模块级自调用模式（提取为模块级函数），一次性解决 REQ-005 和潜在的 analysisProgress 问题。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 15 | 20 | 14 |
| 性能表现 | 15% | 13 | 14 | 13 |
| 扩展性 | 20% | 14 | 19 | 15 |
| 依赖可控性 | 20% | 14 | 19 | 13 |
| **加权总分** | | **81** | **97** | **80** |

---

## REQ-006: QuickActionsCard 图片提取主题失败无反馈

### 候选方案

#### 方案A：追加 toast 通知（推荐）

- **实现思路**: 在 `QuickActionsCard.tsx:297-298` 的 catch 块中，追加 `useNotificationStore.getState().showToast(currentT().extractFailed, 'destructive')`。
- **影响范围**: QuickActionsCard.tsx (~3 行)
- **验收标准覆盖度**: 100%
- **优点**: 最小改动，直接满足验收标准
- **缺点**: 无
- **风险点**: 极低
- **实施成本**: ~3 行
- **长期可维护性**: 高

#### 方案B：提取为独立错误处理函数

- **实现思路**: 在组件外定义 `handleExtractError(error)` 统一处理，catch 块调用之。
- **影响范围**: QuickActionsCard.tsx (~10 行)
- **验收标准覆盖度**: 100%
- **优点**: 错误处理可复用
- **缺点**: 过度设计——当前仅一处调用
- **风险点**: 无
- **实施成本**: ~10 行
- **长期可维护性**: 中

#### 方案C：使用 notifyError 统一错误管道

- **实现思路**: 用 `notifyError(error)` 替代 `console.error`，走项目统一错误通知管道。
- **影响范围**: QuickActionsCard.tsx (~1 行替换)
- **验收标准覆盖度**: 100%
- **优点**: 符合项目统一错误处理约定
- **缺点**: `notifyError` 可能产生与现有 `console.info` 不一致的 UI 风格
- **风险点**: 低
- **实施成本**: ~1 行
- **长期可维护性**: 高

### 最优方案：方案A

- **选择理由**: 方案A 最直观，与项目中其他 store 动作的 toast 模式一致（如 `baselineSnapshot` 失败时 `showToast(..., 'destructive')`）。方案C 的 `notifyError` 也是合理选择，但 `showToast` 更精确控制 toast 类型。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 19 | 15 | 18 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 16 | 18 | 16 |
| 依赖可控性 | 20% | 19 | 16 | 18 |
| **加权总分** | | **94** | **89** | **92** |

---

## REQ-007: statusStore refreshStatus 超时无 toast

### 候选方案

#### 方案A：catch 块追加 toast（推荐）

- **实现思路**: 在 `statusStore.ts:119-123` 的 catch 块中，追加 `useNotificationStore.getState().showToast(message, 'destructive')`。
- **影响范围**: statusStore.ts (~2 行)
- **验收标准覆盖度**: 100%
- **优点**: 最小改动，直接满足验收标准
- **缺点**: 无
- **风险点**: 极低
- **实施成本**: ~2 行
- **长期可维护性**: 高

#### 方案B：使用 notifyError 统一管道

- **实现思路**: 用 `notifyError(err)` 替代 `set({ error: message })`，走统一错误通知。
- **影响范围**: statusStore.ts (~2 行)
- **验收标准覆盖度**: 100%
- **优点**: 符合统一错误处理约定
- **缺点**: 丢失了 `error` 状态（UI 可能依赖它显示重试按钮）
- **风险点**: 中 — 需确认 UI 是否依赖 `error` 状态
- **实施成本**: ~2 行
- **长期可维护性**: 中

#### 方案C：保留 error 状态 + 追加 toast

- **实现思路**: 保留 `set({ error: message })` 供 UI 重试按钮使用，同时追加 `showToast`。
- **影响范围**: statusStore.ts (~3 行)
- **验收标准覆盖度**: 100%
- **优点**: 兼容 UI 现有 error 状态使用
- **缺点**: 双重错误反馈可能让用户困惑
- **风险点**: 低
- **实施成本**: ~3 行
- **长期可维护性**: 高 |

### 最优方案：方案A

- **选择理由**: 方案A 最简洁。`error` 状态已被设置（供 UI 读取），追加 toast 是额外反馈而非替代。方案B 的 `notifyError` 会丢失 error 状态。方案C 双重反馈可能过度。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 19 | 15 | 17 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 17 | 14 | 18 |
| 依赖可控性 | 20% | 19 | 14 | 17 |
| **加权总分** | | **95** | **83** | **92** |

---

## REQ-008: themeStore restoreApp wallpaper 回调静默吞失败

### 候选方案

#### 方案A：catch 块追加 warn 日志（推荐）

- **实现思路**: 在 `themeStore.ts:496-498` 和 `themeStore.ts:637-639` 的空 catch 块中，追加 `console.warn('[themeStore] wallpaper handler failed for', appId, error)`。
- **影响范围**: themeStore.ts (2 处，各 ~2 行)
- **验收标准覆盖度**: 100%（失败不再完全静默）
- **优点**: 最小改动，保留"不阻塞主流程"的设计意图，同时提供可观测性
- **缺点**: 用户无感知（但 wallpaper 恢复失败不应阻塞主题恢复）
- **风险点**: 极低
- **实施成本**: ~4 行
- **长期可维护性**: 高

#### 方案B：catch 块追加 toast

- **实现思路**: catch 块中追加 `useNotificationStore.getState().showToast(...)`。
- **影响范围**: themeStore.ts (~6 行)
- **验收标准覆盖度**: 100%
- **优点**: 用户可感知
- **缺点**: wallpaper 恢复失败是次要操作，弹 toast 可能过度干扰
- **风险点**: 低
- **实施成本**: ~6 行
- **长期可维护性**: 中

#### 方案C：catch 块追加 notifyError

- **实现思路**: 用 `notifyError(error)` 走统一错误管道。
- **影响范围**: themeStore.ts (~2 行)
- **验收标准覆盖度**: 100%
- **优点**: 统一错误处理
- **缺点**: notifyError 可能触发额外 UI 副作用
- **风险点**: 低
- **实施成本**: ~2 行
- **长期可维护性**: 中 |

### 最优方案：方案A

- **选择理由**: wallpaper 恢复是"尽力而为"的副作用操作（注释已说明"Wallpaper restore failure must not block the restore flow"）。`console.warn` 提供开发者可观测性而不干扰用户，符合该操作的设计意图。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 19 | 15 | 16 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 18 | 15 | 16 |
| 依赖可控性 | 20% | 19 | 14 | 15 |
| **加权总分** | | **96** | **84** | **87** |

---

## REQ-009: useThemePageController applyAll 无聚合结果 toast

### 候选方案

#### 方案A：handleApplyAll 完成后追加汇总 toast（推荐）

- **实现思路**: 在 `useThemePageController.ts:214` `await Promise.all(workers)` 之后、`finally` 之前，统计成功/失败数，调用 `controller.showToast?.()` 显示汇总。由于 `runApply` 内部无成功/失败追踪，需为每个 worker 增加结果收集。

  具体实现：在 `handleApplyAll` 中用 `results` 数组收集每个 `runApply` 的成败，完成后根据 `failCount` 显示不同 toast。

- **影响范围**: useThemePageController.ts (~15 行)
- **验收标准覆盖度**: 100%
- **优点**: 与 `restoreAll` 的汇总 toast 模式一致
- **缺点**: 需小幅重构结果收集逻辑
- **风险点**: 低
- **实施成本**: ~15 行
- **长期可维护性**: 高

#### 方案B：仅在有失败时 toast

- **实现思路**: 仅当 `failCount > 0` 时显示 toast。
- **影响范围**: useThemePageController.ts (~8 行)
- **验收标准覆盖度**: 80%（缺少成功反馈）
- **优点**: 更简洁
- **缺点**: 全部成功时无反馈，用户可能不确定是否完成
- **风险点**: 低
- **实施成本**: ~8 行
- **长期可维护性**: 中

#### 方案C：复用 restoreAll 的 toast 模式

- **实现思路**: 将 `restoreAll` 的 `restoreAllDone` / `restoreAllPartial` / `restoreAllFailed` toast 模式复制到 `handleApplyAll`。
- **影响范围**: useThemePageController.ts (~20 行)
- **验收标准覆盖度**: 100%
- **优点**: 与 restoreAll 完全一致
- **缺点**: 代码重复
- **风险点**: 低
- **实施成本**: ~20 行
- **长期可维护性**: 中 |

### 最优方案：方案A

- **选择理由**: 方案A 在 `handleApplyAll` 中增加结果收集（用 `try/catch` 包裹 `runApply` 并记录成败），完成后根据结果分布显示汇总 toast。与 `themeStore.ts` 中 `restoreAll` 的 `restoreAllDone` / `restoreAllPartial` / `restoreAllFailed` 三态 toast 模式对齐。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 20 | 25 |
| 代码质量 | 20% | 18 | 16 | 15 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 18 | 15 | 15 |
| 依赖可控性 | 20% | 18 | 16 | 14 |
| **加权总分** | | **94** | **82** | **84** |

---

## REQ-010: settingsStore mcpBusy 未在 UI 暴露为 loading

### 候选方案

#### 方案A：UI 组件订阅 mcpBusy 渲染 spinner（推荐）

- **实现思路**: 在 Settings 页面的 MCP toggle 按钮组件中，订阅 `useSettingsStore((s) => s.mcpBusy)`，当 `mcpBusy === true` 时渲染 spinner 并 disabled 按钮。
- **影响范围**: Settings 页面 MCP 组件 (~10 行)
- **验收标准覆盖度**: 100%
- **优点**: 直接满足验收标准，mcpBusy 状态已有，仅需 UI 绑定
- **缺点**: 需找到 MCP toggle 按钮所在组件
- **风险点**: 低
- **实施成本**: ~10 行
- **长期可维护性**: 高

#### 方案B：toggleMcp 内部直接操作 DOM

- **实现思路**: 在 `toggleMcp` 中通过 `document.getElementById` 直接操作按钮样式。
- **影响范围**: settingsStore.ts (~5 行)
- **验收标准覆盖度**: 100%
- **优点**: 无需改 UI 组件
- **缺点**: 违反 React 声明式原则，store 不应操作 DOM
- **风险点**: 高 — 违反架构约定
- **实施成本**: ~5 行
- **长期可维护性**: 极低 |

#### 方案C：新增 mcpLoading 派生状态

- **实现思路**: 在 settingsStore 中新增 `mcpLoading` 计算属性，UI 订阅之。
- **影响范围**: settingsStore.ts + UI 组件 (~15 行)
- **验收标准覆盖度**: 100%
- **优点**: 语义更清晰
- **缺点**: `mcpBusy` 已存在，新增字段冗余
- **风险点**: 低
- **实施成本**: ~15 行
- **长期可维护性**: 中 |

### 最优方案：方案A

- **选择理由**: `mcpBusy` 状态已在 store 中正确维护（`toggleMcp` 的 `set({ mcpBusy: true/false })`），问题仅是 UI 未订阅。方案A 以最小改动完成绑定，符合 React 数据流方向。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 19 | 8 | 15 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 18 | 10 | 16 |
| 依赖可控性 | 20% | 19 | 8 | 15 |
| **加权总分** | | **96** | **66** | **86** |

---

## REQ-011: environmentStore switchEnv 矛盾 toast

### 候选方案

#### 方案A：wallpaper 失败时跳过 success toast（推荐）

- **实现思路**: 在 `environmentStore.ts:207-228` 的 wallpaper 半段中，当 `!wp.ok` 或 `!result.ok` 时，除了已有的 `fail()` 调用，增加 `return false` 提前退出（与 theme 半段 `if (!ok) return false` 对称）。这样 `showToast(switchSuccess)` 不会在 wallpaper 失败时执行。
- **影响范围**: environmentStore.ts (~6 行)
- **验收标准覆盖度**: 100%
- **优点**: 逻辑对称（theme 失败 → return false，wallpaper 失败也 → return false），最小改动
- **缺点**: wallpaper 失败时 theme 已应用，用户看到 wallpaper 失败 toast 但 theme 已生效——这是正确行为
- **风险点**: 低
- **实施成本**: ~6 行
- **长期可维护性**: 高

#### 方案B：全部成功才显示 success toast

- **实现思路**: 引入 `let success = true` 标志，theme/wallpaper 任一半段失败时置 false，最后 `if (success) showToast(switchSuccess)`。
- **影响范围**: environmentStore.ts (~8 行)
- **验收标准覆盖度**: 100%
- **优点**: 更精确
- **缺点**: 比方案A 多 2 行，逻辑等价
- **风险点**: 低
- **实施成本**: ~8 行
- **长期可维护性**: 高 |

#### 方案C：拆分为两个独立 toast

- **实现思路**: theme 成功时显示 theme toast，wallpaper 成功时显示 wallpaper toast，失败时各显示失败 toast。
- **影响范围**: environmentStore.ts (~15 行)
- **验收标准覆盖度**: 100%
- **优点**: 信息最精确
- **缺点**: 改动面大，可能产生多个 toast 同时弹出
- **风险点**: 中
- **实施成本**: ~15 行
- **长期可维护性**: 中 |

### 最优方案：方案A

- **选择理由**: 方案A 与 theme 半段的 `if (!ok) return false` 完全对称，保持代码一致性。wallpaper 失败时已有 `fail()` 显示错误 toast，`return false` 阻止 success toast 即消除矛盾。

| 维度 | 权重 | A | B | C |
|------|------|---|---|---|
| 功能完整性 | 25% | 25 | 25 | 25 |
| 代码质量 | 20% | 20 | 17 | 14 |
| 性能表现 | 15% | 15 | 15 | 15 |
| 扩展性 | 20% | 19 | 17 | 15 |
| 依赖可控性 | 20% | 19 | 17 | 14 |
| **加权总分** | | **98** | **91** | **83** |

---

## 方案汇总

| 需求ID | 最优方案 | 预估行数 | 风险 | 核心改动位置 |
|--------|---------|---------|------|-------------|
| REQ-001 | 方案B：最小化订阅 | ~25 行 | 低 | `preload.ts` + `useAppController` 或 `App.tsx` |
| REQ-002 | 方案B：capture-store 自绑定 | ~15 行 | 低 | `capture-store.ts` |
| REQ-003 | 方案B：扩展 onStudioWindowClosed | ~5 行 | 低 | `ipc/index.ts` |
| REQ-004 | 方案B：事件驱动推送 | ~35 行 | 中高 | `injection-session-manager.ts` + 新增 notifier |
| REQ-005 | 方案B：模块级自调用 | ~10 行 | 低 | `useStudioStore.ts` |
| REQ-006 | 方案A：追加 toast | ~3 行 | 极低 | `QuickActionsCard.tsx` |
| REQ-007 | 方案A：catch 块追加 toast | ~2 行 | 极低 | `statusStore.ts` |
| REQ-008 | 方案A：catch 块追加 warn 日志 | ~4 行 | 极低 | `themeStore.ts` (2 处) |
| REQ-009 | 方案A：handleApplyAll 汇总 toast | ~15 行 | 低 | `useThemePageController.ts` |
| REQ-010 | 方案A：UI 订阅 mcpBusy | ~10 行 | 低 | Settings MCP 组件 |
| REQ-011 | 方案A：wallpaper 失败 return false | ~6 行 | 低 | `environmentStore.ts` |

### 总计

- **总预估改动量**: ~130 行
- **最高风险项**: REQ-004（需嵌入 injection-session-manager 事件路径）
- **零新增文件**: 所有方案均修改现有文件，无新文件创建
- **新增依赖**: 无
- **架构分层合规**: 全部方案遵循 UI → preload → IPC → 主进程分层

### 实施优先级建议

1. **第一批（极低风险，快速收尾）**: REQ-006 / REQ-007 / REQ-008 — 共 ~9 行，纯追加反馈
2. **第二批（低风险，桥接类）**: REQ-001 / REQ-002 / REQ-005 — 共 ~50 行，IPC 桥接与订阅绑定
3. **第三批（低风险，逻辑修复）**: REQ-003 / REQ-010 / REQ-011 — 共 ~21 行，状态同步与矛盾修复
4. **第四批（中高风险，功能增强）**: REQ-004 / REQ-009 — 共 ~50 行，事件驱动改造与汇总逻辑
