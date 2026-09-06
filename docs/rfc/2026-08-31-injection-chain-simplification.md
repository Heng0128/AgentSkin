# RFC 2026-08-31: Injection Chain Simplification — From 7 Engines + 7 Timers to Unified Pipeline

> **状态**: DRAFT  
> **作者**: Architecture Audit  
> **日期**: 2026-08-31  
> **范围**: 整条注入链路（UI → IPC → 主进程编排 → CDP 传输 → 页面执行）  
> **动机**: 当前架构过度复杂化，7 个共享模块各成"微引擎"、6 个并发定时器、30+ 全局变量、5 层 CSS 注入顺序依赖脆弱，导致样式覆盖、闪烁、调试困难。对标 DreamWork（~700 行单文件）和 Codex-Dream-Skin（~1000 行单文件），缩减至可维护水平。

---

## 1. Executive Summary

AgentSkin 的注入系统已从"引擎"演化为"引擎的引擎的引擎"。一条 applyTheme 调用穿越 **7 层抽象**、涉及 **12+ 文件拼接**、创建 **6 个定时器**、维护 **30+ 全局变量**。对比竞品 DreamWork（1 个 injector.ts ~700 行）和 Codex-Dream-Skin（1 个 renderer-inject.js ~1000 行），我们用一个数量级更多的代码解决了同样的问题，却引入了更多的失败模式。

**目标**：将整条注入链路的代码量缩减 50-60%，定时器数量从 6 个降至 1 个，全局变量从 30+ 降至 < 10 个，消除注入顺序导致的样式覆盖缺陷。

---

## 2. Full Injection Chain Anatomy — Current State

### 2.1 链路总览

一条 `applyTheme(themeId, agentId)` 调用经过以下全链路：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: UI (renderer process)                                              │
│   Zustand Store → useThemePageController → agentSkinClient.invoke()         │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 2: IPC (renderer ↔ main)                                              │
│   theme-ipc.ts → IpcChannel.THEME_APPLY → handlers in main process         │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 3: Main Facade (AgentEngineService)                                   │
│   apply() → concurrency guard → lockAgent() → applyThemeFlow()              │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 4: Apply Flow (theme-apply-flow.ts)                                   │
│   ensureCdpReady → resolveLivePort → cachedPort/baseline → adapter.apply    │
│   → hardeningPass → injectAgentWallpaperFromApply → syncSchemeWithStability │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 5: Adapter (adapters/domestic/{agent}.ts)                             │
│   applyTheme() → findTargets → port discovery → findDomTargets              │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 6: CDP Fan-out (cdp-fanout.ts)                                        │
│   hardeningPass() → iterate ALL targets (page + webview + iframe)           │
│   ├─ page targets → tryEngineInjection → injectThemeViaEngine               │
│   └─ non-page → injectSingleSecondaryTarget → buildSecondaryInjectExpr      │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 7: CDP Client (cdp-client.ts)                                         │
│   CdpSession class + send/evaluate + WebSocket lifecycle                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 8: Session Pool (session-pool.ts)                                     │
│   CdpSessionPool + heartbeatTimer(5s) + idleScanTimer(10s)                  │
│   + retiredScanTimer → acquire/release per target (workbuddy 13+ targets)   │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 9: Engine Strategy (cdp/injection/engine-strategy.ts)                 │
│   cleanup → image blob inject → set config → CSS layers → adapter execute   │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 10: Page Execution (engines/shared/*.mjs → adapter.mjs)               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │ 7 shared modules:                                                    │   │
│   │  1. style-injector.mjs  (SheetMgr + HybridInjector + Feedback)      │   │
│   │  2. adapter-engine.mjs  (createAdapter factory + 10-step lifecycle)  │   │
│   │  3. token-discovery.mjs (token scanning + overrides)                │   │
│   │  4. self-heal.mjs       (AdaptiveMutationObserver + self-heal IV)   │   │
│   │  5. deep-core.mjs       (ShadowDOM patcher + FragmentRegistry)      │   │
│   │  6. visual-engine.mjs   (--ag-* vars + art/glass coordination)      │   │
│   │  7. verify-and-feedback (snapshot + verify level)                   │   │
│   │ + adapter-config.mjs + adapter.mjs (per-agent thin wrappers)        │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 11: CDP Strategy Fallback (cdp/injection/cdp-strategy.ts)             │
│   injectThemeViaCdp() → simple adoptedStyleSheet + verify (hardening pass)  │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 12: Wallpaper Parallel Chain (wallpaper-injector/)                    │
│   injectAgentWallpaperFromApply → injectAgentWallpaper → CDP image/video    │
│   ├─ wallpaper-self-heal.ts (failure threshold → restore)                  │
│   └─ wallpaper-server.ts (HTTP loopback for web/scene wallpapers)          │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 13: Persist (agent-engine-persist.ts)                                 │
│   PersistChain FIFO → writeJsonAtomic → state.json                         │
├─────────────────────────────────────────────────────────────────────────────┤
│ LAYER 14: Scheme Sync (scheme-sync.ts)                                      │
│   syncSchemeWithStability → light/dark mode restoration                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 资产规模

| 层 | 文件数 | 逻辑行 | 职责 |
|---|--------|--------|------|
| UI → IPC | ~15 | ~800 | Store + Client + Handlers |
| Main Facade | 1 | ~1200 | AgentEngineService 外观 |
| Apply Flow | 1 + 3 deps | ~600 | 流程编排 |
| Adapter (×6) | 6 | ~1500 | 每应用 CDP 目标选择 |
| CDP Fan-out | 1 | ~800 | 多目标注入 |
| CDP Client + Pool | 3 | ~700 | WebSocket 管理 |
| Engine Strategy | 1 + 8 subfiles | ~1500 | 多层注入协调 |
| **7 Shared Modules** | **7** | **~2200** | **页面内微引擎** |
| Page Adapter (×6) | 6 | ~800 | 每应用 Thin wrapper |
| Wallpaper Chain | ~12 | ~2000 | 壁纸注入 + 自愈 + 服务器 |
| Self-Heal / Watchdog | 4 | ~600 | 漂移检测 + 退避 + 重试 |
| Persist + Scheme | 2 | ~300 | 状态持久化 |
| **总计** | **~75** | **~13000** | **整条链路** |

对比：

| 项目 | 注入引擎 LOC | 定时器 | 全局变量 |
|------|-------------|--------|----------|
| DreamWork | ~700 | 0 | 3 |
| Codex-Dream-Skin | ~1042 | 1 | ~5 |
| **AgentSkin** | **~3900** (仅引擎) / **~13000** (全链路) | **6+** | **30+** |

---

## 3. Problem Analysis — 逐层问题

### 3.1 页面执行层（最严重）

**问题 1：7 个模块 = 7 个独立运行的"微引擎"**

每个模块都是 IIFE（Immediately Invoked Function Expression）+ 幂等守卫 + `window.__agentskin__` 命名空间写入 + Legacy bare global 兼容。它们之间通过 `window.__agentskin__` 上的松散耦合协作，本质上是一个分布式系统被硬塞进单个 CDP evaluate 调用。

**问题 2：定时器风暴**

| 定时器 | 间隔 | 触发条件 |
|--------|------|----------|
| selfHealIv | 2000ms | class + sheet 检测 |
| sheetGuardIv | 1500ms | sheet 存在性 |
| progressiveIv | 2000ms | root 检测 (maxRetry=5) |
| routeIv | 1000ms | route 轮询 |
| qualityGuard | 5000ms | token/art/glass 检测 (可选) |
| contextEngine | 1000ms | state specs 检测 (DeepCore 内) |

理论最大触发：~7.3 次/秒，每次至少 1 次 `getComputedStyle`。而竞品用 1 个 30s 巡查覆盖同样场景。

**问题 3：注入顺序导致覆盖**

```
style-injector 安装 adoptedStyleSheets setter 拦截
    ↓
visual-engine 直接写 document.adoptedStyleSheets = [...]
    ↓ (绕过拦截)
sheet-manager 的 owned[] 丢失追踪
    ↓
self-heal 在 2s 后触发 reinject → 再次覆盖
```

**问题 4：verify-and-feedback 是主进程验证的重复**

主进程已有 `verifyTheme()` 和 `waitForTheme()` 在 CDP 侧做页面内验证。7 shared modules 里的 verify 再次在页面内做相同检查 — 纯粹重复。

**问题 5：DeepCore 的攻击性过强**

`SafeAttachShadowPatcher` 全局 patch `Element.prototype.attachShadow` — 这会与宿主应用自身的 shadow DOM 代码产生不可预测的交互。根据 AGENTS.md 黄金规则 #1（除非禁止否则不新增适配器），仅在 2/6 adapter 需要时应做成可选/惰性。

### 3.2 CDP Fan-out 层

**问题 6：Session Pool 独自维护 3 个定时器**

- `heartbeatTimer` 5s 一次
- `idleScanTimer` 10s 一次
- `retiredScanTimer` (grace period)

这些与引擎内的定时器完全独立运行，没有全局协调。

**问题 7：Secondary Inject 再次在页面内做一遍 CSS 注入**

`buildSecondaryInjectExpression()` 构建的脚本在 webview/iframe 里创建自己的 `<style>` 元素、加 host class、设 CSS 变量。这与 engine-strategy 做的事情一半重复，但走了不同的代码路径。

### 3.3 Main Facade 层

**问题 8：God-object 拆分后的"委托地狱"**

`AgentEngineService` 把职责拆给 15+ 子模块，但每个子模块都有独立的 Deps 接口（ApplyFlowDeps、CdpFanoutDeps、WallpaperInjectorDeps 等）。这些 deps 接口有 ~70% 重叠（log、isEpochCurrent、adapter、resolveLivePort），但各自独立定义和维护。

**问题 9：Epoch 管理散布在 6+ 个文件**

`epoch` 参数从 applyThemeFlow 传给 hardeningPass 再传给 tryEngineInjection 再传给 wallpapar-inject。每一层都做 `isEpochCurrent(appId, epoch)` 检查。这本可以用一个统一的 CancellationToken 简化。

### 3.4 Wallpaper 并行链

**问题 10：Wallpaper 注入是独立的"影子注入系统"**

wallpaper-injector.ts 走自己的 CDP 连接、自己的 target discovery、自己的 CDP session（不通过 pool）。它与 theme injection 并行运行但完全没有协调 — 两者同时 evaluate 同一个页面，可能互相干扰。

**问题 11：Wallpaper Self-Heal 实际上在做 restore**

self-heal 触发条件是 3 次注入失败 → 调用 restoreThemeFlow。这意味着 wallpaper 链路依赖 theme restore 链路 — 循环依赖。

### 3.5 Apply Flow 编排

**问题 12：硬编码的 7 步序列**

```typescript
ensureCdpReady → resolveLivePort → adapter.apply → hardeningPass 
→ injectAgentWallpaperFromApply → syncSchemeWithStability → persist → notify
```

这 7 步中有 4 步可以在失败时跳过（hardening、wallpaper、scheme sync、notify），但当前写了大量 try/catch + best-effort 来处理。应该是一个 Pipeline + 每个 stage 的 errorPolicy。

---

## 4. Target Architecture — 目标架构

### 4.1 设计原则

1. **唯一真相源**: window.__agentskin__ 命名空间和状态合并为一个 `AgentSkin` 单例
2. **单一定时器**: 页面内只有 1 个 requestIdleCallback/setInterval 做巡查
3. **两层 CSS**: engine CSS（变量定义）+ agent CSS（主题样式）+ custom CSS。弃用 5 层
4. **Lazy DeepCore**: Shadow DOM patch 仅在检测到需要时激活
5. **统一管道**: Apply Flow 改为 Pipeline + Stage errorPolicy
6. **Wallpaper 服从 Theme**: 壁纸注入纳入同一管道，不是并行系统
7. **验证外移**: 页面内删除 verify 逻辑，全部由主进程 CDP 处理

### 4.2 目标链路

```
┌─────────────────────────────────────────────────────────────────┐
│ LAYER 1-3: 保持不变 (UI → IPC → Facade)                         │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 4: Unified Apply Pipeline (新)                            │
│   Pipeline { stages[], errorPolicy } → 串行/并行策略化         │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 5-6: CDP Apply Core                                       │
│   CdpApplyCore.connect → preflight → inject → verify → cleanup  │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 7: CDP Client (简化)                                      │
│   CdpSession 类保留，删除 SessionPool 定时器 → 外部 lifecycle    │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 8: Page Executor (~600 行单文件)                          │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  AgentSkin 单例                                          │   │
│   │  ├─ styleManager: { apply(), rebuild(), dispose() }     │   │
│   │  ├─ tokenDiscovery: { scan(), overrides }               │   │
│   │  ├─ lifecycle: { mount(), patrol(), dispose() }         │   │
│   │  ├─ shadowAdapter: { enable(), install() } (lazy)      │   │
│   │  └─ trackers: boundaries, essentials                    │   │
│   │                                                          │   │
│   │  单一 patrol 定时器 (requestIdleCallback, 5s 兜底)       │   │
│   └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 9: Wallpaper Append (统一管道 stage)                      │
│   WallpaperStage → CDP image/video/web → 不独立建连            │
├─────────────────────────────────────────────────────────────────┤
│ LAYER 10: Persist + Scheme (保持)                               │
│   直接调用，不再通过 7 个 deps interface 中转                   │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 删除/合并清单

#### 共享模块层

| 当前模块 | 操作 | 目的地 | 理由 |
|----------|------|--------|------|
| `adapter-engine.mjs` | 删除 | 逻辑拆分到 unified 单文件 | createAdapter 9 步生命周期过度设计 |
| `style-injector.mjs` SheetManager | 合并入 unified | 作为 styleManager 子集 | adoptedStyleSheets 拦截不再需要 |
| `style-injector.mjs` HybridInjector | **删除** | 由 styleManager.apply() 替代 | rAF batching 不必要 — CSS sync apply 够用 |
| `style-injector.mjs` InjectionFeedback | **删除** | 主进程 Toast 已足够 | 覆盖层是 UX 债务 |
| `token-discovery.mjs` | 合并入 unified | 作为 tokenDiscovery | 需要保留，但简化 |
| `self-heal.mjs` AdaptiveMutationObserver | 简化合并 | unified patrol 逻辑 | 1 个 MO 替代 3 个 |
| `self-heal.mjs` selfHeal coordinator | 简化合并 | unified patrol | 1 个定时器替代 6 个 |
| `deep-core.mjs` SafeAttachShadowPatcher | 简化 + lazy 加载 | unified.shadowAdapter | 仅在需要时激活 |
| `deep-core.mjs` FragmentRegistry | 简化 | unified 内部 | 仅 2/6 adapter 需要 |
| `deep-core.mjs` RouteDetector | 删除 | 由 patrol 的 DOM diff 替代 | 1000ms 轮询由 patrol 覆盖 |
| `visual-engine.mjs` --ag-* CSS 变量 | 合并入 unified | 作为静态 CSS 块注入 | 不需要运行时协调函数 |
| `visual-engine.mjs` coordinate/adapt/hotSwap | **删除** | 由 @media 覆盖 | CSS prefers-color-scheme 原生 |
| `verify-and-feedback.mjs` | **全删除** | 主进程 CDP verify | 重复实现 |

#### 主进程层

| 当前模块 | 操作 | 目的地 |
|----------|------|--------|
| `cdp-fanout.ts` | 简化 | CdpApplyCore 内部方法 |
| `session-pool.ts` | 简化 | CdpSession lifecycle 外部化 |
| `wallpaper-injector.ts` | 重构 | Pipeline WallpaperStage |
| `wallpaper-self-heal.ts` | 合并入 Pipeline | 失败计数纳入 Pipeline retry 策略 |
| `agent-engine/delegates.ts` | 合并 | Facade 方法 + Pipeline 阶段 |
| `theme-apply-flow.ts` | 重构为 Pipeline | Unified Apply Pipeline |
| `theme-restore-flow.ts` | 重构为 Pipeline | Unified Restore Pipeline |
| `services/agent-engine-persist.ts` | 保持 | — |
| `scheme-sync.ts` | Pipeline stage | — |

#### 定时器削减

| 定时器 | 当前 | 目标 |
|--------|------|------|
| selfHealIv (adapter-engine) | 2000ms | 合并入 patrol |
| sheetGuardIv (adapter-engine) | 1500ms | 删除 (patrol 覆盖) |
| progressiveIv (adapter-engine) | 2000ms | 删除 (preflight 覆盖) |
| routeIv (adapter-engine) | 1000ms | 删除 (patrol DOM diff) |
| qualityGuard (verify) | 5000ms | 删除 (主进程 verify) |
| contextEngine (deep-core) | 1000ms | 删除 |
| heartbeatTimer (session-pool) | 5000ms | 删除 (watchdog 覆盖) |
| idleScan (session-pool) | 10000ms | 删除 (外部 dispose 管理) |
| retiredScan (session-pool) | 5000ms | 删除 |
| safetyPatrol (renderer-inject.js) | 30000ms | **唯一保留 (unified patrol)** |

**从 10 个定时器减到 1 个。**

---

## 5. Migration Plan — 分批落地

### Phase 0: 准备 (无行为变更)

- [ ] 在 `engines/` 下创建 `unified/` 目录
- [ ] 新增 `engines/unified/agent-skeleton-shell.mjs` — 作为占位和回退
- [ ] 在编排层增加 feature flag `useUnifiedEngine`（默认 false 以保留回滚路径）

### Phase 1: 统一页面内执行 (P0 — 收益最高)

**目标**：用 1 个 `unified-engineer.mjs` 替代 7 shared modules

**子任务**：

1. **合并 style-injector + self-heal → unified patroller**
   - 1 个 AdaptiveMO
   - 1 个 patrol 回调（class + sheet + token 一次性检查）
   - 删除 InjectionFeedback overlay

2. **简化 token-discovery**
   - 保留 scan() + getOverrides()
   - 删除与 verify 的重叠逻辑

3. **简化 visual-engine**
   - 保留 --ag-* CSS 变量定义（静态 :root 块）
   - 删除 coordinate() / adaptAppearance() / hotSwap()（由 CSS @media 替代）

4. **Lazy DeepCore**
   - FragmentRegistry 降为 30 行内部类
   - shadowAdapter 增加 `enableIfNeeded()` 检测
   - 删除 RouteDetector（patrol 覆盖）

5. **删除 verify-and-feedback**
   - 页面内 verify 全部移除
   - 主进程 `verifyTheme()` 保留为唯一验证路径

**验收**：npm run check 全绿，全部 6 适配器手动 apply/restore 正常

### Phase 2: 简化 CDP Fan-out + Pool (P1)

**目标**：Session Pool 不再是独立定时器驱动系统

1. CdpSessionPool 改为纯缓存（无内部定时器）
2. session lifecycle 由 CdpApplyCore 管理
3. heartbeat / idle check 改为 watchdog 被动触发

### Phase 3: Wallpaper 管道化 (P2)

**目标**：壁纸注入不再走独立并行系统

1. wallpaper-injector 改为 PipelineStage
2. 注入共用主 theme 链路的 CDP session
3. self-heal 失败计数纳入 Pipeline 的 retry 策略

### Phase 4: Apply/Restore 管道统一 (P3)

**目标**：Facade + delegates 简化为 Pipeline

1. theme-apply-flow → `ApplyPipeline { stages[], retryPolicy }`
2. theme-restore-flow → `RestorePipeline { stages[] }`
3. delegates.ts 中的委托方法合并入 Pipeline stages
4. epoch → CancellationToken

### Phase 5: 删除死代码 + 文档同步 (P4)

1. 删除 7 shared modules 旧文件
2. 更新 ARCHITECTURE.md / engines/INDEX.md
3. 删除 InjectionFeedback 相关 CSS 和组件引用
4. 移除 feature flag `useUnifiedEngine`（unified 成为唯一路径）

---

## 6. Risk Assessment

| 风险 | 可能性 | 影响 | 缓解 |
|------|--------|------|------|
| DeepCore 简化破坏 workbuddy/shadow-dom-heavy 应用 | 中 | 高 | lazy enableIfNeeded；feature flag 保留 Phase 1-2 |
| 单 patrol 定时器覆盖不了所有 edge case | 低 | 中 | patrol 用 requestIdleCallback + 5s 兜底 Interval |
| 删除 InjectionFeedback 影响用户体验 | 低 | 低 | 主进程 ToastStack 已覆盖同等场景 |
| Wallpaper 管道化引入 apply-block | 中 | 中 | WallpaperStage 保持 async 不阻塞 persist |
| 测试量巨大 (4500+ tests) | — | — | 逐步迁移，每 Phase 独立验收 |

---

## 7. Success Metrics

| 指标 | 当前 | Phase 1 目标 | 最终目标 |
|------|------|-------------|----------|
| 页面内 LOC | ~3900 (7 modules) | ~600 (1 file) | ~500 |
| 页面内定时器 | 6 | 1 | 1 |
| 页面内全局变量 | 30+ | <10 | <8 |
| 注入层 CSS | 5 | 2-3 | 2 |
| 样式覆盖 bug 率 | 有报告 | 消除已知 case | 消除机制 |
| apply 到 verify 时间 | ~800ms | ~400ms | ~300ms |
| 全部链路灯文件数 | ~75 | ~60 | ~45 |

---

## 8. Open Questions

1. **Persist 脚本路径**: `Page.addScriptToEvaluateOnNewDocument` 在 unified 后如何简化？
2. **6 adapter 的特殊性**: 每个 adapter 的 heuristic override 是否都能移出 adapter-config？
3. **Baseline 缓存**: baseline-manager 的 LRU 缓存是否也应纳入 Pipeline？
4. **Secondary targets**: webview/iframe 注入是否可以走同一 unified 代码？

---

## 9. Appendix A: 关键类型树

```
AgentEngineService (Facade)
├── registry: AgentEngineRegistry
├── persist: PersistChain
├── apply() → applyThemeFlow()
│   ├── ensureCdpReady()
│   ├── adapter.applyTheme()
│   ├── hardeningPass() → cdp-fanout
│   │   ├── tryEngineInjection() → engine-strategy → CDP evaluate(adapter.mjs)
│   │   │   └── [7 shared modules execute in page]
│   │   └── injectSingleSecondaryTarget() → buildSecondaryInjectExpr
│   ├── injectAgentWallpaperFromApply() → wallpaper-injector
│   └── syncSchemeWithStability() → scheme-sync
└── restore() → restoreThemeFlow()
    ├── hardeningRemove()
    ├── removeAgentVideoWallpaper()
    └── restoreOriginalScheme()
```

## 10. Appendix B: 竞品代码映射

| 竞品 | 文件 | 大小 | 功能 |
|------|------|------|------|
| DreamWork | electron/manager/injector.ts | ~700 行 | 完整的 apply + menu + verify |
| Codex-Dream-Skin | runtime/renderer-inject.js | ~1042 行 | CSS 变量 + 图片分析 + 自愈 |
| AgentSkin (current) | engines/shared/*.mjs (7 files) | ~2200 行 | 7 个微引擎 |
| **AgentSkin (target)** | **engines/unified/engine.mjs** | **~600 行** | **统一引擎** |

---

*RFC 结束 — 待用户审核后进入 Phase 0 实施*
