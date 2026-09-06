# RFC 2026-09-01: Injection Full-Pipeline Simplification — 整条注入链路的深度缩减与重构

> **状态**: ACCEPTED
> **作者**: Architecture Audit  
> **日期**: 2026-09-01  
> **范围**: 整条注入链路（UI → IPC → Main Facade → Apply/Restore Flow → CDP Client → Engine Strategy → Page Executor → Wallpaper → Baseline/Preflight → Scheme Sync → Persist）  
> **前序 RFC**: RFC 2026-08-31-Injection-Chain-Simplification (v2) — 本轮在其基础上大幅扩展覆盖面  
> **动机**: 前一轮 RFC 仅覆盖了"注入引擎"这一层（L7-L10），覆盖面不足。用户反馈——注入引擎只是整条链路的一条链路中的一层。本轮对整个注入系统做端到端的深度审计，发现并规划了从 UI Store 到页面内执行、从壁纸通道到持久化同步的所有层的缩减、重构与优化。对标 DreamWork（~4,500 LOC 全项目）和 Codex-Dream-Skin（~5,200 LOC 全项目），全链路缩减 50-60%。

---

## 1. Executive Summary

一条 `applyTheme(themeId, agentId)` 调用穿越 **10+ 层抽象**、涉及 **130+ 文件**、创建 **10+ 定时器**、维护 **30+ 全局变量**。对比竞品 DreamWork（1 个 injector.ts ~700 行）和 Codex-Dream-Skin（1 个 renderer-inject.js ~1042 行），我们用一个数量级更多的代码解决了同样甚至更复杂的问题，却引入了更多的失败模式、样式覆盖缺陷和维护负担。

**目标**：

1. 整条链路代码量缩减 50-60%（从 ~18,000 行降至 ~8,000 行）
2. 定时器数量从 10+ 降至 1-2 个
3. CDP 模块文件数从 104 个降至 ~35 个
4. 消除注入顺序导致的样式覆盖缺陷
5. 建立统一的 Pipeline 抽象，替代当前散布的 try/catch best-effort 模式
6. 壁纸通道并入主管道，不再有独立 CDPsession 路径
7. Baseline / Preflight / Audit 三个独立审计系统合并为单一预检管道

---

## 2. Full Injection Pipeline Anatomy — 当前状态

### 2.1 链路分层总览

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: UI (renderer) — Zustan Store + Custom Hooks                              │
│   useThemePageController / useWallpaperPageController → agentSkinClient.invoke() │
│   12 Store × ~2000 行 + 14 Hooks × ~1500 行                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 2: IPC Bridge (renderer ↔ main)                                            │
│   theme-ipc.ts + wallpaper-ipc.ts + bundle-ipc.ts + studio-ipc × ~12 handlers   │
│   preload.ts (contextBridge 暴露 ~40 个方法)                                     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 3: Main Facade (AgentEngineService God-Object)                              │
│   12+ 子模块委托、ApplyFlowDeps / RestoreFlowDeps / CdpFanoutDeps × ~70% 重叠    │
│   registry / persist-coordinator / options / performance-logger                  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 4: Apply Flow (theme-apply-flow.ts ~752 行)                                │
│   Fast path + Full-init path + 7 步硬编码序列 + Pipeline 雏形（未完全利用）     │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 5: Adapter (adapters/domestic/{trae,qoder,workbuddy,doubao,codex,zcode}.ts)│
│   6 个适配器 × ~1500 行 — 每个都直接调用 @agentskin/engine runtime              │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 6: CDP Fan-out (cdp-fanout.ts ~1048 行 — 全仓库最大文件)                   │
│   hardeningPass/hardeningRemove/secondary inject/ReloadWatchdog/timeouts         │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 7: CDP Client & Session Pool (cdp-client.ts + session-pool.ts)             │
│   CdpSession (435 行) + CdpSocketCore + CdpSessionPool (331 行) + reconnect      │
│   cdp-reconnect.ts (635 行) + heartbeatTimer + idleScanTimer + retiredScanTimer  │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 8: Engine Strategy (engine-strategy.ts + cdp-strategy.ts + css-inject)     │
│   5 层 CSS 注入 + adapter-JS evaluate + landmark preflight + verification        │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 9: Page Executor (engines/unified/engine.mjs ~659 行 + 6 adapter wrappers) │
│   1 个 Unified Engine 替代 7 旧模块 + 6 个 adapter.mjs + adapter-config.mjs     │
│   含：SheetMgr + AMO + TokenDiscovery + VisualCSS + PersistScript               │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 10: Wallpaper Channel (独立于 Theme 的"影子注入系统")                       │
│   image-injector/video-injector/web-injector/shared (共 ~1013 行)                │
│   wallpaper-self-heal.ts (229 行) — 失败 3 次 → 调用 restoreThemeFlow (循环依赖) │
│   HTTP loopback 服务器 — 用于 web/scene 壁纸                                      │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 11: Baseline + Preflight + Audit (三个互相交叉的审计系统)                   │
│   baseline-manager.ts (1088 行) + preflight.ts (412 行) + css-builders/* (610 行)│
│   audit-runner.ts + check-defs/* (879 行) — 部分功能是生产代码，部分仅测试使用   │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 12: Scheme Sync + Persist + Fan-out                                        │
│   scheme-sync.ts (265 行) + agent-engine-persist.ts (172 行) + cdp-fanout       │
│   notifyStatusChanged 双窗口 fan-out + IPC events                                │
├──────────────────────────────────────────────────────────────────────────────────┤
│ LAYER 13: Dead Code & Residues (深埋的死代码)                                    │
│   deep-core.mjs (640 行) — 仅测试引用；css-service.ts 部分方法 orphaned          │
│   CLEAR_ADAPTERS_BODY/CLEAR_HOST_BODY legacy compat; module-scoped no-ops        │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 资产规模统计（量化基线）

| 层 | 文件数 | 估算 LOC | 核心问题 |
|----|--------|---------|---------|
| L1: UI Store + Hooks | ~40 | ~3500 | Store 之间循环依赖（themeStore ↔ wallpaperStore ↔ settingsStore） |
| L2: IPC Bridge | ~20 | ~1200 | 40+ IPC handlers，许多仅做透传 |
| L3: Main Facade | ~12 services × 23 文件 | ~2500 | God-Object 委托地狱，70% deps 重叠 |
| L4: Apply Flow | 1 + 7 deps | ~752 | 7 步硬编码序列，errorPolicy 未统一 |
| L5: Adapter | 9 (6 domestic + 3 shared) | ~1500 | 同质化代码——6 个 adapter 结构几乎一致 |
| L6: CDP Fan-out | 1 巨型文件 | ~1048 | 多职责（注入 + watchdog + secondary + retry） |
| L7: CDP Client + Pool | 5 (client/pool/reconnect/...) | ~1400 | 3 个独立定时器 + 复杂的 retire/idle/heartbeat |
| L8: Engine Strategy | 10 (含 css-builders) | ~1044 | 5 层 CSS + 2 个策略路径（simple vs engine） |
| L9: Page Executor | 21 .mjs (unified + 6 adapters) | ~2800 | unified 659 行 + deep-core 640 行死代码 |
| L10: Wallpaper Channel | ~10 | ~1242 | 独立并行系统，与主题注入无协调 |
| L11: Baseline+Preflight+Audit | ~20 | ~2979 | 三个审计系统功能交叉 |
| L12: Scheme+Persist+Fan-out | ~5 | ~700 | IPC fan-out 散布在多处 |
| L13: Dead Code | ~5 | ~1200 | deep-core.mjs + 各种 legacy compat |
| **合计** | **~170** | **~20,900** | — |

**对比基线**：

| 项目 | 全项目 LOC | 注入核心 LOC | 定时器 | 全局变量 | 适配器数 |
|------|-----------|-------------|--------|---------|---------|
| DreamWork | ~4,500 | ~700 | 0 | 3 | 2 |
| Codex-Dream-Skin | ~5,200 | ~1,042 | 1 | 5 | 1 |
| Deluze | ~3,800 | ~300 | 0 | 2 | 0 |
| **AgentSkin** | **~35,000** | **~20,900** | **10+** | **30+** | **6** |

即使按适配器数归一化（DreamWork ×3 适配器），AgentSkin 的注入核心仍是竞品的 **6-9 倍**。

---

## 3. Problem Analysis — 逐层深度诊断

### 3.1 UI 层（L1）— 9 个 Store 维护同一份注入状态

**问题 1：注入状态在 9 个 Store 中重复**

| Store | 维护的注入状态 |
|-------|--------------|
| `agentStore` | `installing / currentTheme` |
| `statusStore` | `status: idle / injecting / applied / ...` |
| `themeStore` | `appliedThemes: Record<agentId, themeId>` |
| `wallpaperStore` | `appliedWallpapers / selfHealCount` |
| `installFlowStore` | `flowState: detect / inject / verify` |
| `diagnosticsStore` | `applyHistory / driftReports` |
| `notificationStore` | `applyResult toast` |
| `dialogStore` | `confirmRestart dialog` |
| `environmentStore` | `detectedPath / port` |

这 9 个 store 各自维护着 apply 操作不同侧面的状态，但在用户视角这是**一个**操作。结果是 UI 组件需要在 3-4 个 store 间编排才能渲染正确的 apply 按钮状态。

**问题 2：14 个 Custom Hooks 中 6 个仅做 Store→组件透传**

`useThemeApply`, `useWallpaperApply`, `useSchemeSwitch`, `useAgentStatus`, `useInjectionProgress`, `useApplyGuard` — 这些 hooks 没有独立逻辑，只是从 2-3 个 store 读取字段后用 useMemo 组合。它们增加了调用栈深度但没有封装变化。

### 3.2 IPC Bridge（L2）— 40+ 方法维护负担

**问题 3：IPC handler 数量膨胀**

当前 preload.ts 暴露 ~40 个方法，许多是单次调用的 getter：`detectApp`, `getThemeList`, `getWallpaperList`, `getStatus`, `getAgentStatus`, ... 每个方法需要 preload.ts 一行 + main IPC handler 一行 + renderer client 一行 = 3 处维护。

竞品 DreamWork 只有 `discover-apps`, `launch-app`, `apply-theme`, `get-status`, `remove-skin` 5 个 IPC handler。

### 3.3 Main Facade（L3）— Deps 接口的 70% 重复

**问题 4：ApplyFlowDeps / CdpFanoutDeps / WallpaperInjectorDeps 的 70% 字段重复**

统计发现，这些 Deps 接口共享以下字段但各自重新声明：`log`, `isEpochCurrent`, `adapter()`, `bumpEpoch()`, `setActiveTheme()`, `persist()`, `status()`, `displayName()`。维护三份相同签名是重构的低值负担。

**问题 5：epoch 管理散布在 6+ 文件**

`epoch` 的概念是好的（并发取消），但当前它以原始 `number` 在 apply/restore/wallpaper/hardening/secondary 之间逐层传递。每一层都做 `isEpochCurrent(appId, captured)` 检查。这本质上是 `CancellationToken` 模式——用现成的抽象替代手动 epoch + isCurrent 函数对。

### 3.4 Apply Flow（L4）— Pipeline 雏形未被充分利用

**问题 6: `src/shared/injection-pipeline.ts` 已存在但被当作串行 enumerate 使用**

`Pipeline` 和 `Stage` 类已定义 `deps / policy / maxRetries / run` 等完整语义，但 `theme-apply-flow.ts` 并未使用 `Pipeline.exec()`。7 步 apply 序列以硬编码顺序执行 + 内联 try/catch，Stage 错误策略（`continue` / `fail-fast` / `retry`）不能在声明层表达。

### 3.5 Adapter（L5）— 6 个近乎同构的适配器

**问题 7：6 个适配器有 ~80% 同构代码**

每个 `adapters/domestic/{codex,doubao,trae,qoder,workbuddy,zcode}.ts` 都包含：
- `discover()` — 调用 `discoverApplication`
- `findTargets()` — 调用 `findDebugTargets`
- `findRunningPids()` — 调用 `findRunningProcesses`
- `resolveDebugPorts()` — 调用 `resolveDebugPortsFor`
- `defaultPort()` — 返回常量

仅 `rendererHints()` / `windowHints()` / `installHints` 是差异点。当前模式是 boilerplate × 6。

### 3.6 CDP Fan-out（L6）— 全仓库最大文件

**问题 8：`cdp-fanout.ts` 1048 行，4 个职责**

1. `connectWithRetry()` — CDP 连接重试（应在 client 层）
2. `hardeningPass()` — page target 的多层注入
3. `injectSingleSecondaryTarget()` — webview/iframe 的 CSS-only 注入
4. ReloadWatchdog 调用 — 页面重载守护

这 4 个职责共享 target-iteration 逻辑，但彼此的 session 管理策略不同（pooled vs one-shot vs long-lived）。

### 3.7 CDP Client + Pool（L7）— 3 个定时器 + 复杂生命周期

**问题 9：SessionPool 独自驱动 3 个独立定时器**

| 定时器 | 间隔 | 用途 |
|--------|------|------|
| `heartbeatTimer` | 5000ms | ping 检测 session 活性 |
| `idleScanTimer` | 10000ms | 清理空闲 session |
| `retiredScanTimer` | 5000ms | 淘汰 retired session |

这些定时器与引擎内定时器 + session-pool 的引用计数 + 外部 watchdog 完全没有协调。

**问题 10：`cdp-reconnect.ts` 635 行 — 过度工程的重连策略**

多达 6 种重连策略模式（固定间隔 / 指数退避 / 斐波那契 / 抖动 / 最大次数放弃 / 条件重连），每种都有独立配置。竞品 DreamWork 用 `connectWithRetry(url, openMs=4000, attempts=3, delays=[500,1500])` 一行搞定。

### 3.8 Engine Strategy（L8）— 两套注入策略共存

**问题 11：`cdp-strategy.ts` 和 `engine-strategy.ts` 的"Hardening"路径**

`cdp-strategy.ts` 的注释说明它是"hardening pass AFTER @agentskin/engine's applyTheme"。当前两者都作为实际注入路径存在：adapter.apply 走 @agentskin/engine，然后 hardening pass 再走一遍 engine-strategy 或 core-runtime 的 adoptStep。注入实际执行了**两次**——第一次被第二次覆盖，必然导致闪烁。

### 3.9 Page Executor（L9）— deep-core 已死但未埋葬

**问题 12：`deep-core.mjs` 640 行仍然存在于 engines/shared/**

在 engines/unified/engine.mjs 吸收 DeepCore 功能后，`engines/shared/deep-core.mjs` 仅被测试文件 `deep-core.test.mjs` 引用。生产代码的 orchestrator.ts 仅加载 `engines/unified/engine.mjs`。然而 deep-core.mjs 仍参与构建、误导新开发者、占用 640 行可维护资产。

### 3.10 Wallpaper Channel（L10）— 独立的影子注入系统

**问题 13：壁纸注入使用独立的 CDP session**

`wallpaper-injector.ts` 不走 `session-pool`，自行管理 CDP 连接。这导致 applyTheme 操作时同一页面被两个无协调的 CDP session 并发注入——可能互相覆盖。

**问题 14：`wallpaper-self-heal.ts` 反向依赖 restoreThemeFlow**

SelfHeal 触发条件是 3 次注入失败 → 调用主题恢复链路 → 主题恢复又可能触发壁纸清理。这是循环依赖。

### 3.11 Baseline + Preflight + Audit（L11）— 三个审计系统的功能交叉

**问题 15：`baseline-manager.ts` 1088 行合并了 5 个子模块**

虽然名义上"合并"，但 captureBaselineCss / replayBaseline / assessFidelity / validateBaselineCss / evaluateReplicationGate 五个功能仍然在同一个文件中以独立函数集的形式存在。合并文件只是移动了边界，没有减少逻辑。

**问题 16：`css-builders/*` 7 个文件 — 6 个 + index**

每个 agent 一个 CSS Builder（codex-css-builder, doubao-css-builder, ...），每个仅 50-90 行。这些 builder 的差异仅在于"哪些选择器应插入哪个 token 值"——本质上是数据，不是逻辑。用 JSON 配置 + 统一 Builder 替代 6 个 Builder 类。

**问题 17：`audit/*` 系统 — check-defs 定义与渲染逻辑耦合**

audit/check-defs/{composer,hover,pages,settings}.ts 定义审计检查项，audit-runner 执行它们。这套系统目前仅测试使用（验证注入后不破坏 composaer/hover 等 UI）。但它增加了 879 行纯测试辅助代码到生产目录。

### 3.12 Scheme + Persist + Fan-out（L12）— 状态同步散布

**问题 18：`scheme-sync.ts` 稳定性窗口 = 3 次独立 CDP probe**

`syncSchemeWithStability` 在初始 probe 后还有 `2s/5s/10s` 三次 re-check。这是因为早期的注入覆盖率不稳定，需要多次 probe 确认。当前注入已稳定，3 次 probe 是过防御。

### 3.13 Dead Code 残留（L13）— 640 行深埋死代码

**问题 19：deep-core.mjs 被 unified engine 彻底替代**

文件头部的注释仍说"DEEP-CORE.MJS — DeepCore Shared Runtime"，但 unified engine 已经吸收了其全部功能（FragmentRegistry, SafeAttachShadowPatcher, RouteDetector, ContextAwareEngine）。文件未标记 `@deprecated`，仍参与 `npm run build`。

---

## 4. Target Architecture — 目标架构

### 4.1 设计原则

1. **唯一注入 Pipeline**：apply / restore / scheme-switch 统一走声明式 Pipeline + Stage errorPolicy
2. **单一定时器**：页面内 1 个 patrol（requestIdleCallback + 5s fallback），主进程 0 个定期器（watchdog 被动触发）
3. **CDP Session 统一所有权**：session-pool 是唯一 session 来源，壁纸 + theme + secondary 共享
4. **Facade 去 God-Object**：AgentEngineService 瘦身为 pure deps wiring，所有业务逻辑在 Pipeline Stages
5. **选择器驱动**：6 个 Builder 类 → 1 JSON 配置 + 1 Builder
6. **Adapter 同质化**：boilerplate 上提到 shared adapter 基类，差异点由 JSON 配置声明
7. **Pipeline Stage 即测试单元**：每个 Stage 可独立注入 mock deps，Pipeline.exec() 独立验证排序

### 4.2 目标链路

```
┌──────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: UI — 合并为 InjectStatusStore (单 store 管理 apply 状态)       │
│   9 Store → 1 InjectStatusStore + 3 领域 Store (theme/wallpaper/env)    │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 2: IPC — 合并为 6 个核心 handler + 1 batch handler                │
│   discover / launch / apply / restore / status / batch                  │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 3: Main Facade — 瘦身为 PureDepsWiring                            │
│   PipelineFactory.buildApplyPipeline() + buildRestorePipeline()         │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 4: Apply/Restore Pipeline — 声明式 Stage[] 序列                    │
│   Pipeline { stages: [cdp-ready, apply-core, hardening, wallpaper,       │
│                       scheme-sync, persist, notify] }                    │
│   每 Stage: { name, deps, policy, maxRetries, run }                     │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 5: Adapter Base — 上提 boilerplate                                 │
│   BaseDomesticAdapter 处理 discover/findTargets/findRunningPids          │
│   6 个 adapter 仅声明差异: installHints, rendererHints, windowHints     │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 6: CDP Apply Core — 统一注入协调                                   │
│   CdpApplyCore { connect, preflight, apply, verify, dispose }           │
│   替代 cdp-fanout.ts (注入+watchdog+secondary 拆分)                      │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 7: CDP Client + Pool — 纯缓存，无定时器                           │
│   CdpSession 类保留; SessionPool 无外部定时器(被动 dispose)              │
│   cdp-reconnect 简化为 connectWithRetry(openMs, attempts) 一行          │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 8: Engine Strategy — 单一注入路径                                  │
│   删除 hardening-pass 双重注入; engine-strategy.ts 不再有 fallback      │
│   cdp-strategy.ts 删除或变为纯备份(不主动执行)                          │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 9: Page Executor — 瘦身至 ~400 行                                  │
│   删除 deep-core.mjs 引用; 删除 legacy bare globals                     │
│   删除 InjectionFeedback overlay; patrol 单一定时器                      │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 10: Wallpaper Stage — 并入主管道                                   │
│   wallpaper 注入作为 Pipeline 的一个 Stage，共享 CDP session            │
│   self-heal 纳入 Pipeline Stage retry policy                            │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 11: Pre-Flight Pipeline — 三合一                                   │
│   preflight → baseline capture → inject → verify 一管道完成             │
│   css-builders 由 JSON + BuilderFactory 替代                             │
│   audit/check-defs 移入 tests/ 目录                                     │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 12: Scheme + Persist — 简化                                        │
│   scheme-sync 单次 probe (稳定性窗口由 Patrol 覆盖)                     │
│   IPC fan-out 改由 EventBus 集中                                         │
├──────────────────────────────────────────────────────────────────────────┤
│ LAYER 13: 零死代码                                                        │
│   删除 deep-core.mjs 及其测试; 清理 bare globals; 标记 compat 为删除     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 4.3 删除 / 合并 / 重建清单

#### Layer 1: UI Store

| 当前 | 操作 | 目的地 |
|------|------|--------|
| `installFlowStore` | 合并入 `InjectStatusStore` | 消除：flow 是 apply 的子视角 |
| `diagnosticsStore.applyHistory` | 合并入 `InjectStatusStore` | 消除重复的 apply 状态 |
| `dialogStore` (confirmRestart 部分) | 合并入 `InjectStatusStore` | Dialog 逻辑可由 Status 推导 |
| `notificationStore` (apply result 部分) | 合并入 `InjectStatusStore` | Apply 结果是 Status 的子产物 |
| 6 个透传 hooks | 移除 | 组件直接读取 Store |

#### Layer 2: IPC

| 当前 | 操作 |
|------|------|
| ~40 preload methods | 合并为 6 个核心 + 1 batch invoke |
| theme-ipc / wallpaper-ipc / bundle-ipc / studio-ipc | 统一为 `invoke(channel, payload)` + 类型路由 |

#### Layer 3: Main Facade

| 当前 | 操作 |
|------|------|
| `ApplyFlowDeps` / `CdpFanoutDeps` / `WallpaperInjectorDeps` | 合并为 `PipelineDeps` |
| `AgentEngineService` apply/restore/wallpaper/scheme | 重构为 `PipelineFactory.build*()` |
| `agent-engine-options.ts` | 合并入 settingsService |
| `persistent-cdp-manager.ts` | 独立保留（启动层逻辑，不属于注入核心链路） |

#### Layer 4-6: Flow + Adapter + Fan-out

| 当前 | 操作 |
|------|------|
| `theme-apply-flow.ts` (752 行) | 重构为 `ApplyPipelineFactory` + Stage[] |
| `theme-restore-flow.ts` (293 行) | 重构为 `RestorePipelineFactory` + Stage[] |
| `cdp-fanout.ts` (1048 行) | 拆解为 `CdpApplyCore` + `SecondaryInjectStage` + `ReloadStage` |
| 6 个 `adapters/domestic/*.ts` | 上提 Boilerplate 到 `BaseDomesticAdapter`，差异声明化 |

#### Layer 7: CDP Client + Pool

| 当前 | 操作 |
|------|------|
| `session-pool.ts` 3 个定时器 | 删除；改为外部 dispose + lazy retire |
| `cdp-reconnect.ts` 635 行 | 简化为 `connectWithRetry(url, timeout, attempts)` 的一行函数 |
| `cdp-fanout.ts connectWithRetry` | 合并入简化后的 reconnect |
| `inspect-session.ts` | 合并入 `cdp-client.ts` 的 event session view |
| `cdp-fingerprint.ts` | 删除（baseline-manager 已覆盖 fingerprint 功能） |

#### Layer 8: Engine Strategy

| 当前 | 操作 |
|------|------|
| `cdp-strategy.ts` | 删除（hardening pass 是历史产物，注入已稳定） |
| `css-inject.ts` adoptedStyleSheets 双层 | 合并为单一 style 元素（已部分完成于 RFC 2026-08-31） |
| `hero-inject.ts` 464 行 | 合并入 engine-strategy 的工具函数（非独立策略） |
| `theme-auto-repair.ts` 630 行 | 合并入 page executor 的 patrol 逻辑 |

#### Layer 9: Page Executor

| 当前 | 操作 |
|------|------|
| `engines/shared/deep-core.mjs` (640 行) | 删除 + deep-core.test.mjs |
| `engines/shared/` 目录本身 | 删除（清空后） |
| `engine.mjs` legacy bare globals | 删除 (`__agentskin_unified_engine__`, `__agentskin_shared_engine__`, `__agentskin_sheet_manager__` 等) |
| `engine.mjs` verify-and-feedback 残留 | 删除（主进程 CDP verify 是唯一路径） |
| `adapter-config.mjs` 6 个 | 合并为 1 个 shared config + per-agent JSON diff |

#### Layer 10: Wallpaper

| 当前 | 操作 |
|------|------|
| `wallpaper/image-injector.ts` | 变为 Pipeline `WallpaperStage` |
| `wallpaper/video-injector.ts` | 同上 |
| `wallpaper/web-injector.ts` | 同上 |
| `wallpaper/shared.ts` 工具函数 | 保留，改为 Stage 的 helper |
| `wallpaper-self-heal.ts` 229 行 | 删除（self-heal 纳入 Pipeline retry） |
| HTTP loopback 服务器 | 删除外部依赖，改为 CDP evaluate 注入 |

#### Layer 11: Baseline + Preflight + Audit

| 当前 | 操作 |
|------|------|
| `baseline-manager.ts` 1088 行 | 拆分为: Pipeline `CaptureStage` + `ValidateStage`（~300 行）+ 删除 fidelity/replication gate（测试辅助代码） |
| `css-builders/*` 7 文件 610 行 | 替换为 `selectors.json` + ~80 行 BuilderFactory |
| `audit/*` 879 行 | 移至 `tests/injection-audit/` |
| `preflight.ts` 412 行 | 简化为 Pipeline Stage（~120 行），multi-window classification 合并入 fan-out |

#### Layer 12: Scheme + Persist

| 当前 | 操作 |
|------|------|
| `scheme-sync.ts` 稳定性窗口 (3 probe) | 简化为单次 probe + Patrol 补充 |
| `agent-engine-persist.ts` | 保留（已实现良好） |
| IPC fan-out (notifyStatusChanged 等) | 集中至 `IpcEventBus` 单一广播模块 |

#### 定时器削减总览

| 定时器 | 层 | 当前间隔 | 目标 |
|--------|-----|---------|------|
| selfHealIv (engine) | L9 | 2000ms | 删除，合并入 patrol |
| sheetGuardIv (engine) | L9 | 1500ms | 删除 |
| progressiveIv (engine) | L9 | 2000ms | 删除 (preflight 替代) |
| routeIv (engine) | L9 | 1000ms | 删除 (patrol DOM diff) |
| qualityGuard (engine) | L9 | 5000ms | 删除 |
| contextEngine (deep-core) | L9 | 1000ms | 删除 (deep-core 已死) |
| heartbeatTimer (pool) | L7 | 5000ms | 删除 |
| idleScanTimer (pool) | L7 | 10000ms | 删除 |
| retiredScanTimer (pool) | L7 | 5000ms | 删除 |
| patrol (engine) | L9 | 5000ms | **唯一保留** |

**从 10 个定时器减到 1 个。**

---

## 5. Migration Plan — 分批落地

### Phase 0: 基础设施准备 (3 天)

- [ ] 确认 `src/shared/injection-pipeline.ts` 可扩展为跨层通用 Pipeline
- [ ] 标记 `deep-core.mjs` + `cdp-strategy.ts` + `self-heal.ts` 为 `@deprecated`
- [ ] 建立 feature flag `usePipelineApply`（默认 false，灰度路径保留）
- [ ] 新建 `docs/reports/INJECTION_PIPELINE_BASELINE_2026-09-01.md` 记录当前行为快照

### Phase 1: Pipeline 抽象统一 (5 天) — P0 最高 ROI

**目标**: 用 Pipeline + Stage 替代 apply-flow 硬编码 + fan-out try/catch

**子任务**:

1. **承认并利用 `Pipeline` 类** — `theme-apply-flow.ts` 重写为 `ApplyPipelineFactory`:
   ```typescript
   export function buildApplyPipeline(deps: PipelineDeps): Pipeline {
     return new Pipeline()
       .add({ name: 'ensureCdpReady', policy: 'fail-fast', run: ... })
       .add({ name: 'applyCore', deps: ['ensureCdpReady'], policy: 'fail-fast', run: ... })
       .add({ name: 'hardening', deps: ['applyCore'], policy: 'continue', run: ... })
       .add({ name: 'wallpaper', deps: ['applyCore'], policy: 'continue', run: ... })
       .add({ name: 'schemeSync', deps: ['applyCore'], policy: 'continue', run: ... })
       .add({ name: 'persist', deps: ['applyCore'], policy: 'fail-fast', run: ... })
       .add({ name: 'notify', deps: ['persist', 'schemeSync'], policy: 'continue', run: ... });
   }
   ```

2. **Deps 接口合并** — `ApplyFlowDeps + CdpFanoutDeps + WallpaperInjectorDeps` → 单一 `PipelineDeps`

3. **CancellationToken 替代 epoch** — `epoch: number` → `signal: AbortSignal`，`isEpochCurrent(appId, n)` → `signal.aborted`

**验收**: npm test 全绿；applyTheme/restoreTheme 行为一致

### Phase 2: 注入引擎瘦身 (4 天) — P0

**目标**: 删除 dead code，统一注入路径

**子任务**:

1. **删除 `deep-core.mjs` + 测试** — 640 行 dead code 清除
2. **删除 `engines/shared/` 目录**
3. **删除 `cdp-strategy.ts`** — hardening pass 历史产物
4. **简化 `engine-strategy.ts`** — 删除 `registerAdapterPersistScripts` (session-bound 约束，生产未用)
5. **清理 `unified/engine.mjs`** — 删除 legacy bare globals + verify-and-feedback 残留

### Phase 3: CDP Client/Pool 重构 (4 天) — P1

**目标**: SessionPool 无定时器，reconnect 简化

**子任务**:

1. **SessionPool 删除 3 定时器** — 改为外部 watchdog 按需 dispose
2. **Reconnect 简化为一行** — `export async function connectWithRetry(url, timeout=4000, attempts=3) { ... }` 移至 cdp-client.ts
3. **删除 `cdp-reconnect.ts` 独立模块**
4. **删除 `inspect-session.ts`** — 合并入 cdp-client
5. **删除 `cdp-fingerprint.ts`** — 由 baseline-manager 覆盖

**验收**: WorkBuddy 13 targets 并发注入正常；apply latency < 1s

### Phase 4: Baseline + Pre-Audit 合并 (4 天) — P1

**目标**: 三审计系统 → 单一 pre-flight pipeline

**子任务**:

1. **`baseline-manager.ts` 拆解** — 生产代码 captureBaseline + probeThemeLive 保留为 Pipeline Stage；fidelity/replication 移入 tests/
2. **`css-builders/*` → JSON** — 6 个 Builder 类 → 1 `selectors.json` + 80 行 BuilderFactory
3. **`audit/*` 迁移** — `src/main/cdp/injection/audit/` → `tests/injection-audit/`
4. **`preflight.ts` 简化** — 合并为 Pipeline PreFlightStage（~120 行）

**验收**: 6 agent 注入覆盖率不下降；validation 逻辑零丢失

### Phase 5: Wallpaper 管道化 (3 天) — P2

**目标**: 壁纸不再是独立并行系统

**子任务**:

1. **Wallpaper 注入改为 Pipeline Stage** — 共享 Theme 链路的 CDP session
2. **删除 `wallpaper-self-heal.ts`** — 自愈纳入 Pipeline retry policy (`maxRetries: 3`)
3. **简化 `scheme-sync.ts`** — 单次 probe + Patrol 兜底，删除稳定性窗口 3 次 re-check
4. **HTTP loopback 服务器评估** — 如无 web scene 活跃用户，一并删除

### Phase 6: 状态同步 + IPC 精简 (3 天) — P2

**目标**:

1. **IPC handler 合并为 6 个** — 客户端统一 `invoke()` 封装
2. **`notifyStatusChanged` 集中** — 散布在 5+ 文件的 fan-out 统一入 `IpcEventBus`
3. **UI InjectStatusStore** — 9 → 1 Store 管理 apply 状态（最终目标，可分多 PR）

### Phase 7: 退出条件与文档 (2 天) — P3

**目标**:

1. **更新 `docs/ARCHITECTURE.md`** — 整条链路新图
2. **更新 `engines/INDEX.md`** — 仅保留 unified + 6 adapter 结构
3. **更新 `docs/reports/`** — 记录本轮缩减最终报告
4. **删除 feature flag `usePipelineApply`** — Pipeline 成为唯一路径

---

## 6. 定量目标 — Success Metrics

| 指标 | 当前 | Phase 1-2 | Phase 3-4 | 最终 |
|------|------|-----------|-----------|------|
| 主进程注入链路 LOC | ~20,900 | ~14,000 | ~10,000 | **~8,000** |
| 主进程 CDP 文件数 | 104 | 70 | 45 | **~35** |
| 页面内 LOC | ~2,800 (incl 640 dead) | ~1,800 | ~1,500 | **~1,200** |
| 页面内定时器 | 10 | 1 | 1 | **1** |
| 页面内全局变量 | 30+ | <10 | <8 | **<6** |
| IPC handler 数量 | ~40 | 20 | 8 | **6** |
| Adapter 重复行率 | 80% | 50% | 30% | **<15%** |
| CSS 注入层 | 5 | 3 | 2-3 | **2** |
| apply 到 verify 完成 | ~800ms | ~500ms | ~350ms | **~250ms** |
| npm 测试通过率 | baseline | 全绿 | 全绿 | **全绿** |
| 样式覆盖 bug 率 | 有报告 | 消除已知 case | 消除机制 | **零报告** |

---

## 7. Risk Assessment

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Pipeline 化引入性能回退（stage 调度开销） | 低 | 中 | Stage 调度 < 1ms；pipeline exec 比当前 try/catch 更快 |
| 删除 cdp-strategy.ts 导致"无 hardening 路径" | 中 | 中 | 确认 @agentskin/engine 覆盖率 100% 后再删；可保留但不调用 |
| Baseline 拆解破坏测试基线契约 | 中 | 高 | Stage 输出保持 BaselineSnapshot 形状；测试 fixture 不变 |
| Wallpaper 管道化引入 apply-block | 低 | 中 | WallpaperStage policy: 'continue'，不阻塞 persist |
| CSS Builder → JSON 丢失选择器特异性 | 低 | 高 | BuilderFactory 输出 CSS 与当前 6 Builder 做 snapshot 对比 |
| 删除 session-pool 定时器后 session 泄漏 | 低 | 中 | 外部 dispose 改由 apply/restore lifecycle 显式触发 |
| 9 Store 合并 UI apply 按钮闪烁 | 低 | 低 | InjectStatusStore 单一原子更新；可推迟到 Phase 6 |

---

## 8. Open Questions

1. **@agentskin/engine 的依赖关系**: hardening pass 是否真的 100% 被 engine 覆盖？需要一次 injection-contract 全覆盖审计（C1 校验脚本增强版）。

2. **workbuddy 13 targets 的注入一致性**: CDP fan-out 合并后，是否所有 13 target 都能正确继承 theme？（当前走不同的 page-engine vs secondary-CSS 两条路径）

3. **scheme-sync 稳定性窗口删除的影响**: 早期覆盖不稳定→需要 3 re-checks。当前是否真的不再需要？是否应该保留 1 次 re-check 而非 3 次？

4. **CSS Builder JSON 格式**: 应使用 Codex-Dream-Skin 的 `selectors.json`（已验证 8+ 版本）格式还是自建？遵循事实标准有助于社区主题转换。

5. **IPC 合并与 preload 反向兼容**: 如果从 40 个 handler 合并为 6 个，是否需要考虑 OTA 升级用户的 preload 缓存？

6. **Store 合并的范围**: 仅合并 apply 相关状态还是更大范围的 Store 合并？本轮建议仅合并 apply 子集。

7. **audit 移入 tests/ 的发布影响**: tests/ 不包含在 npm package 中——audit 代码移除后，谁来做注入合规检查？是否需要独立的 `@agentskin/audit` CLI 工具？

---

## 9. Appendix A: 关键类型树（目标态）

```
AgentEngineService (Facade — 瘦身为 PipelineDepsWiring)
├── registry: AgentEngineRegistry
├── deps: PipelineDeps (合并后单一接口)
├── applyPipeline: Pipeline (由 ApplyPipelineFactory 构建)
│   ├── Stage "ensureCdpReady"          [fail-fast]
│   ├── Stage "applyCore"               [fail-fast] → adapter.applyTheme
│   ├── Stage "hardening"               [continue]  → CdpApplyCore.injectAll
│   ├── Stage "secondary"               [continue]  → webview/iframe CSS-only
│   ├── Stage "wallpaper"               [continue]  → WallpaperStage (shared session)
│   ├── Stage "schemeSync"              [continue]  → 单次 probe + Patrol
│   ├── Stage "persist"                 [fail-fast] → PersistChain
│   └── Stage "notify"                  [continue]  → IpcEventBus.broadcast
├── restorePipeline: Pipeline (由 RestorePipelineFactory 构建)
│   ├── Stage "ensureCdpReady"          [fail-fast]
│   ├── Stage "restoreCore"             [fail-fast] → adapter.restoreTheme
│   ├── Stage "removeHardening"         [continue]  → CdpApplyCore.removeAll
│   ├── Stage "removeWallpaper"         [continue]  → 共享 session
│   ├── Stage "restoreScheme"           [continue]  → 单次 probe
│   └── Stage "persist"                 [fail-fast]
└── pipelineDeps: PipelineDeps
    ├── adapter (appId) → ApplicationAdapter
    ├── cdpApply: CdpApplyCore
    ├── isApplyingTheme / lockAgent / unlockAgent
    ├── ensureCdpReady / resolveLivePort / cachedPort
    ├── baselineGet / baselinePut / baselineInvalidate
    ├── findTheme / setActiveTheme / persist
    ├── log / logStructured
    └── cancellationToken (替代 epoch)
```

## 10. Appendix B: 文件增删清单（预期净变化）

**净删除 ~95 个文件，净添加 ~15 个文件（Stage 定义 + JSON 配置 + 文档）。**

### 删除清单 (95)

```
engines/shared/deep-core.mjs                       (-640 LOC)
engines/shared/deep-core.test.mjs                  (-test, ~200 LOC)
engines/shared/                                   (目录删除)
src/main/cdp/cdp-strategy.ts                       (-185 LOC) [hardening 删除]
src/main/cdp/injection/css-builders/* (7 files)    (-610 LOC) [→ JSON + BuilderFactory]
src/main/cdp/injection/audit/* (7 files)           (-879 LOC) [→ tests/]
src/main/cdp/injection/theme-auto-repair.ts        (-630 LOC) [→ patrol]
src/main/cdp/cdp-reconnect.ts                      (-635 LOC) [→ 一行 connectWithRetry]
src/main/cdp/inspect-session.ts                    (-merged into client)
src/main/cdp/cdp-fingerprint.ts                    (-duplicate)
src/main/cdp/preflight.ts                          (-412 LOC → ~120 LOC Stage)
src/main/cdp/baseline-manager.ts                   (-1088 LOC → ~300 LOC 2 Stages)
src/main/cdp/wallpaper/self-heal.ts                (-229 LOC)
src/main/wallpaper-self-heal.ts                    (-229 IPC)
src/main/scheme-sync.ts                            (-265 LOC → ~80 LOC)
src/main/services/agent-engine-options.ts          (-58 LOC, merged to settings)
adapters/domestic/{codex,doubao,trae,qoder,workbuddy,zcode}.ts (-1500 LOC → ~300 LOC 6 adapters)
```

### 添加清单 (15)

```
src/main/pipeline/apply-pipeline-factory.ts        (+~120 LOC)
src/main/pipeline/restore-pipeline-factory.ts      (+~80 LOC)
src/main/pipeline/pipeline-deps.ts                 (+~60 LOC, 合并 3 deps)
src/main/pipeline/stages/cdp-ready-stage.ts        (+~40 LOC)
src/main/pipeline/stages/apply-core-stage.ts       (+~30 LOC)
src/main/pipeline/stages/hardening-stage.ts        (+~80 LOC)
src/main/pipeline/stages/wallpaper-stage.ts        (+~80 LOC)
src/main/pipeline/stages/scheme-sync-stage.ts      (+~30 LOC)
src/main/pipeline/stages/persist-stage.ts          (+~20 LOC)
src/main/pipeline/stages/notify-stage.ts           (+~30 LOC)
src/main/cdp/cdp-apply-core.ts                     (+~300 LOC, 替代 cdp-fanout)
src/main/ipc/ipc-event-bus.ts                      (+~60 LOC, 集中 fan-out)
engines/selectors.json                             (+~200 LOC JSON, 替代 css-builders)
adapters/domestic/base-domestic-adapter.ts         (+~150 LOC, boilerplate 上提)
docs/reports/INJECTION_PIPELINE_BASELINE_2026-09-01.md (基线快照)
docs/reports/INJECTION_PIPELINE_FINAL_2026-09-01.md    (最终报告)
```

---

*RFC v3 结束 — 覆盖整条注入链路 (L1-L13), 待用户审核后进入 Phase 0 实施。本 RFC 替代并大幅扩展 RFC 2026-08-31-Injection-Chain-Simplification v2 的覆盖范围。*
