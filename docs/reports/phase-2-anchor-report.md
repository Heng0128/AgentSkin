# Phase 2: 需求锚定报告

> Anchor 子智能体输出 — 合并 Scanner-α（代码层）与 Scanner-β（场景层），匹配真实用户需求，量化验收标准，剔除伪差距，按优先级排序。

---

## 合并统计

| 指标 | 数值 |
|------|------|
| Scanner-α 原始差距 | 8 |
| Scanner-β 原始差距 | 14 |
| 合并去重前总计 | 22 |
| 合并去重后 | 21 |
| 剔除伪差距 | 2 |
| **锚定需求** | **19** |

### 去重说明

Scanner-β #12（statusStore refreshStatus 超时无 toast）与 Scanner-α #2 实为同一问题，合并为一个需求。

---

## 剔除的伪差距

| # | 差异ID | 来源 | 剔除原因 |
|---|--------|------|---------|
| α-4 | NATIVE_PROFILE_READY 死代码 | Scanner-α | NATIVE_PROFILE_BUILD 是 invoke（请求-响应）模式，渲染进程在调用时直接获得返回值，无需额外的 READY 推送。主进程从未发射、渲染进程从未订阅、无用户路径可达。纯死代码，无真实用户需求。 |
| α-5 | THEME_USAGE_CHANGED 死代码 | Scanner-α | 通道定义为 SEND_ONLY 但主进程从未发射，preload 未暴露 API。theme-usage-store 通过主动拉取（THEME_USAGE_GET）正常工作，推送优化从未实现但不影响功能。纯死代码，无真实用户需求。 |

---

## 锚定需求清单

### P0 — 核心功能断裂（无 workaround）

| 需求ID | 描述 | 复杂度 | 验收标准 | 相关文档 |
|--------|------|--------|----------|---------|
| REQ-001 | **DEEP_LINK 渲染进程订阅缺失**：`deep-link-handler.ts:160` 通过 `webContents.send` 向 mainWindow 和 studioWindow 发射 DEEP_LINK 事件，但 `preload.ts` 未暴露 `onDeepLink` 订阅 API，渲染进程无任何组件监听。所有 `agentskin://` 协议的 UI 导航/应用确认/安装提示均无法触发。 | M | 1. preload 暴露 `onDeepLink(listener)` API<br>2. 渲染进程某 store 或组件订阅该事件<br>3. 触发 `agentskin://navigate?page=themes` 后主窗口切换至 themes 页面<br>4. 触发 `agentskin://apply?themeId=xxx` 后显示应用确认弹窗或 toast | `src/main/deep-link-handler.ts`<br>`src/preload.ts` |
| REQ-002 | **THEME_STUDIO_INSPECT_RESULT 订阅未绑定**：`preload.ts:208` 已暴露 `onInspectResult` API，`capture-store.ts:509` 有 `setInspectResult` 方法，但两者从未绑定。Studio inspect 模式下用户点击 DOM 节点后结果丢失，`liveNode` 永不更新。 | S | 1. 在 capture-store 初始化或 Studio 页面挂载时订阅 `onInspectResult`<br>2. 订阅回调调用 `useCaptureStore.getState().setInspectResult(node)`<br>3. Studio 进入 inspect 模式 → 点击目标页面元素 → Inspector 面板显示选中节点信息 | `src/ui/studio/capture-store.ts`<br>`src/preload.ts:208` |

### P1 — 主要功能缺陷（有 workaround 但体验严重受损）

| 需求ID | 描述 | 复杂度 | 验收标准 | 相关文档 |
|--------|------|--------|----------|---------|
| REQ-003 | **Studio 关闭后主窗口不刷新主题列表**：`window-manager.ts:125` 的 studio `closed` 事件仅调用 `ctx.onStudioWindowClosed?.()`（停止 CDP inspect），未触发 `refreshThemes()`。用户在 Studio 中导出主题后返回主窗口，新主题不可见，需手动刷新。 | S | 1. 在 studio `closed` 回调中调用 `useThemeStore.getState().refreshThemes()` 或等效 IPC 通知<br>2. 在 Studio 导出主题 → 关闭 Studio → 主窗口 themes 列表自动显示新主题 | `src/main/window-manager.ts:125` |
| REQ-004 | **PERFORMANCE_CDP_METRICS 主进程未发射**：`useDiagnosticsSync.ts:39` 订阅了 `onPerformanceCdpMetrics`，`preload.ts:378` 已暴露 API，但主进程（`src/main/`）无任何 `webContents.send(PERFORMANCE_CDP_METRICS)` 调用。CDP Performance HUD 的 sessionCount/reconnected 字段永远为空。 | M | 1. 主进程在 CDP 会话状态变化时发射 `PERFORMANCE_CDP_METRICS` 事件<br>2. Diagnostics 页面的 CDP Performance HUD 实时显示 sessionCount<br>3. CDP 重连时 reconnectCount 递增 | `src/ui/hooks/useDiagnosticsSync.ts:39` |
| REQ-005 | **initHealthReportSubscription 从未调用**：`useStudioStore.ts:627` 定义了 `initHealthReportSubscription`（订阅 `onThemeHealthReport` 并写入 capture-store），但整个代码库无调用点。主进程 `cdp-fanout.ts:919` 持续发射健康报告，但 Studio 诊断面板永不更新。 | XS | 1. 在 Studio 页面挂载或 useStudioStore 初始化时调用 `initHealthReportSubscription()`<br>2. Studio 诊断面板实时显示各 agent 注入健康状态 | `src/ui/studio/useStudioStore.ts:627` |
| REQ-006 | **QuickActionsCard 图片提取主题失败无反馈**：`QuickActionsCard.tsx:297` 的 catch 块仅 `console.error`，无 error toast。用户选择无效图片后无任何提示，按钮虽 disabled 但用户不知道失败原因。 | S | 1. catch 块调用 `useNotificationStore.getState().fail(error)` 或等效 toast<br>2. 用户选择非图片文件/损坏图片 → 显示 destructive toast 提示失败原因 | `src/ui/components/workspace/QuickActionsCard.tsx:297` |
| REQ-007 | **statusStore refreshStatus 超时无 toast**：`statusStore.ts:119-123` catch 块仅设置 `store.error`，不主动弹 toast。用户点击刷新后超时，仅状态栏 error 字段变化，无 toast 通知。 | S | 1. catch 块中调用 `useNotificationStore.getState().fail(err)` 或等效 toast<br>2. 刷新超时（15s）后用户看到 destructive toast 提示"状态刷新超时" | `src/ui/stores/statusStore.ts:119` |
| REQ-008 | **themeStore restoreApp wallpaper 回调静默吞失败**：`themeStore.ts:493-498` 的 `wallpaperHandlers` 循环中 catch 块为空注释。壁纸恢复失败时用户无任何提示，主题恢复成功但壁纸残留。 | XS | 1. catch 块添加 `useNotificationStore.getState().fail(err)` 或 warn 级别 toast<br>2. 恢复原生主题时若壁纸清除失败，用户看到非阻塞警告提示 | `src/ui/stores/themeStore.ts:493` |
| REQ-009 | **useThemePageController applyAll 无聚合结果 toast**：`useThemePageController.ts:195-218` 全部完成后无成功/部分失败汇总。用户点击"应用到全部"后，6 个 agent 中 2 个成功 1 个失败，仅各 agent 独立 toast，无聚合结果。 | S | 1. `handleApplyAll` 完成后统计成功/失败数<br>2. 全部成功 → success toast"已应用到 N 个应用"<br>3. 部分失败 → destructive toast"成功 N 个，失败 M 个" | `src/ui/hooks/useThemePageController.ts:195` |
| REQ-010 | **settingsStore mcpBusy 未在 UI 暴露为 loading**：`settingsStore.ts:239` 的 `mcpBusy` 状态已正确防止双击竞态，但 Settings 页面的 MCP 启动/停止按钮未绑定该状态，用户点击后无 loading 反馈，误以为未生效而重复点击。 | S | 1. Settings UI 中 MCP  toggle 按钮绑定 `mcpBusy` 状态<br>2. 点击后按钮显示 spinner/disabled 状态<br>3. 操作完成后恢复正常 | `src/ui/stores/settingsStore.ts:239` |
| REQ-011 | **environmentStore switchEnv 矛盾 toast**：`environmentStore.ts:238` 在 wallpaper 失败时先调用 `.fail()`（显示错误 toast），然后继续执行到 `showToast(switchSuccess)`（显示成功 toast），用户同时看到成功和失败两个矛盾提示。 | M | 1. 重构 toast 逻辑：wallpaper 失败时不显示 switchSuccess<br>2. 主题成功 + 壁纸失败 → 显示部分成功 toast"主题已切换，但壁纸应用失败"<br>3. 主题失败 → 不显示任何成功提示 | `src/ui/stores/environmentStore.ts:238` |

### P2 — 体验瑕疵（功能可用但反馈缺失）

| 需求ID | 描述 | 复杂度 | 验收标准 | 相关文档 |
|--------|------|--------|----------|---------|
| REQ-012 | **statusStore 模块级订阅缺少 unsubscribe**：`statusStore.ts:35` 在 `create()` 内调用 `api.onCoordinatorStatus` 但未存储 unsubscribe 函数，HMR 时可能重复注册。与 appsStore 双订阅。 | S | 1. 将 unsubscribe 函数存储在模块级变量中<br>2. 提供 cleanup 函数供 HMR dispose 或测试 teardown 调用<br>3. HMR 后无重复订阅导致的重复状态更新 | `src/ui/stores/statusStore.ts:35` |
| REQ-013 | **environmentStore createEnvironment applyNow + themeId=null 仍显示成功**：`environmentStore.ts:277` 条件 `applyNow && themeId` 在 themeId 为 null 时跳过 apply，但第 293 行仍显示"创建成功"toast。用户创建无主题环境时看到误导性成功提示。 | XS | 1. 当 `applyNow=true && themeId=null` 时，toast 改为"环境已创建（未应用主题）"或类似中性提示<br>2. 或跳过 toast 仅更新 store | `src/ui/stores/environmentStore.ts:277` |
| REQ-014 | **QuickActionsCard 下拉菜单无法通过 ESC/外部点击关闭**：`QuickActionsCard.tsx:230` 的 dropdown 仅通过点击按钮切换 `open` 状态，无 `onClickOutside` 或 `onKeyDown(ESC)` 处理。用户需再次点击按钮才能关闭。 | S | 1. 添加 `useEffect` 监听 `mousedown` 事件，点击 dropdown 外部时关闭<br>2. 添加 `keydown` 监听，ESC 键关闭 dropdown<br>3. 关闭时清理事件监听 | `src/ui/components/workspace/QuickActionsCard.tsx:230` |
| REQ-015 | **themeStore withImportLock 被锁拒绝时无用户提示**：`import-guard.ts:34` 当路径已被锁时返回 `false`，`themeStore.ts:561` 的 `confirmFileImport` 收到 `false` 后仅静默调用 `refreshThemes()`，用户双击同一文件时无任何反馈。 | S | 1. `withImportLock` 返回 `false` 时显示 info toast"该主题正在导入中，请稍候"<br>2. 或静默忽略（当前行为）但需确认这是预期 UX | `src/ui/stores/import-guard.ts:34` |
| REQ-016 | **settingsStore setRadiusScale/setDensity/setMotion 无成功 toast**：`settingsStore.ts:127-150` 这三个 UI-shell 设置变更后仅更新 localStorage 和 store，无 toast 确认。用户更改圆角/密度/动效后无反馈。 | XS | 1. 三个 setter 成功后调用 `useNotificationStore.getState().showToast(currentT().settingsSaved)`<br>2. 用户更改设置后看到"设置已保存"toast | `src/ui/stores/settingsStore.ts:127` |
| REQ-017 | **themeStore dropThemeFiles 静默跳过无反馈**：`themeStore.ts:566-572` 对不匹配 `.agenttheme|.agentskin-theme|.codex-theme` 后缀的文件直接 `continue`，无用户提示。用户拖入错误格式文件时无任何反馈。 | XS | 1. 对跳过的文件调用 `useNotificationStore.getState().showToast(...)` 提示"已跳过 N 个不支持的文件"<br>2. 或收集跳过文件数量，在拖入结束后一次性提示 | `src/ui/stores/themeStore.ts:566` |

### P3 — 低影响 / 需验证

| 需求ID | 描述 | 复杂度 | 验收标准 | 相关文档 |
|--------|------|--------|----------|---------|
| REQ-018 | **communityStore 模块级订阅缺少 _initialized 防重复注册**：`communityStore.ts:631` 的 `if (typeof window !== 'undefined' && api?.onCommunityDownloadProgress)` 无 `_initialized` 标志。HMR 时可能重复注册订阅。`disposeCommunitySubscriptions` 已导出但从未被调用。 | XS | 1. 添加 `_initialized` 模块级标志防止 HMR 重复注册<br>2. 在应用退出或 HMR dispose 时调用 `disposeCommunitySubscriptions()` | `src/ui/stores/communityStore.ts:631` |
| REQ-019 | **WorkspacePage 导入调整配置成功无 toast**：Scanner-β 报告导入调整配置后无确认 toast。需验证具体指哪个导入流程（workspace tweak import / adjustment config import）。现有 `confirmFileImport` 已有 toast，可能为边缘场景或已修复。 | S | 1. 确认"导入调整配置"具体指哪个 UI 流程<br>2. 若确实缺失，在导入成功后添加 toast 确认 | 待验证 |

---

## 优先级分布

| 优先级 | 数量 | 说明 |
|--------|------|------|
| P0 | 2 | 核心功能断裂，无 workaround |
| P1 | 9 | 主要功能缺陷，有 workaround 但体验严重受损 |
| P2 | 6 | 体验瑕疵，功能可用但反馈缺失 |
| P3 | 2 | 低影响或需验证 |

## 复杂度分布

| 复杂度 | 数量 | 说明 |
|--------|------|------|
| XS | 4 | 单行或几行修改 |
| S | 10 | 单个文件内局部修改 |
| M | 4 | 跨文件或需要新增 IPC/订阅逻辑 |
| L | 0 | — |
| XL | 0 | — |

## 实施建议

1. **P0 优先**：REQ-001 和 REQ-002 是核心功能断裂，应最先修复。REQ-002 最简单（绑定已有 API），可快速完成。
2. **P1 批量**：REQ-005 和 REQ-008 是 XS 复杂度，可顺手修复。REQ-011 需要重构 toast 逻辑，建议单独 PR。
3. **P2 集中**：REQ-012/013/016 是 store 层修改，可集中在一个 PR 中处理。
4. **P3 延后**：REQ-019 需先验证是否仍存在，REQ-018 仅影响 HMR 开发体验。
