# RFC 2026-09-01 (Supplement B): Injection Pipeline Bridge & Cross-Cutting Concerns

> **状态**: DRAFT
> **作者**: Architecture Audit
> **日期**: 2026-09-01
> **范围**: Preload 桥接层、IPC 通道注册表、委托层、跨层关注点（定时器、错误处理、日志、Trace）
> **前序 RFC**: RFC 2026-09-01-injection-full-pipeline-simplification (主 RFC — L1-L13)
> **动机**: 主 RFC 聚焦于"注入引擎"和"Apply/Restore Flow"层间的 13 层结构，但对 **Preload Bridge**（渲染端入口）、**IPC Channel 注册表**、**委托中间层** 以及多个 **跨层重复的基础设施**（定时器、广播、类型守卫）覆盖不足。本轮对这些"链路之外但影响链路"的区域做深度诊断与缩减规划。

---

## 1. Executive Summary — 发现与目标

主 RFC 规划了 L1-L13 的注入链路简化，但遗漏了三个关键区域：

1. **Preload Bridge God-Object** — `src/preload.ts` 暴露 **~60 个扁平 API 方法**（主题、壁纸、设置、工作室、窗口控制、CSS 源码编辑、宠物、视觉分析...全部混在一个 `AgentSkinApi` 对象中），是渲染端调用主的统一入口，却因膨胀引发 API 边界模糊与类型安全风险。
2. **IPC 通道膨胀** — 主 RFC 报告 "~40 IPC handler"，实际 `IpcChannel` 对象有 **84 个通道**（其中 17 个是 main→renderer 单向事件），加上 preload.ts 中对应的 ~60 个 invoke/send 调用。每增加一个功能需要在 3 处同步变更（channel 常量 + preload 一行 + handler 一行）。
3. **跨层基础设施重复** — 定时器（13+ 个，主 RFC 报 10 个漏计了 `theme-hot-reload` 的 debounce、`withPageSession` 的 retry-backoff、`notifyStatusChanged` 的 debounce），错误报告策略（3 种：log / throw / notify），日志通道（4 个：mainDebug / mainWarn / log / logStructured）。

**目标**：

| 维度 | 当前 | 目标 |
|------|------|------|
| preload API 方法数 | ~60 (扁平) | 6 个命名空间 facade (~10 个核心方法 + 50 个领域方法分组) |
| IPC 通道数 | 84 | 32 (业务聚合 + SEND_ONLY 事件下架为 EventBus) |
| 委托层文件 | 15 个纯转发函数 | 删除；调用方直接引用 impl 模块 |
| 跨层定时器 | 13+ | 4 (Patrol CDP session / Hot-reload debounce / Background task trace / Status notify debounce) |
| 错误报告策略 | 3 种 (log/throw/notify) | 1 种统一策略 (Pipeline Stage 配置 onError) |
| 类型安全缺口 (TODO: type-guard) | 20+ 处 | 0 (zod 运行时校验) |

---

## 2. 深度审计 — 逐区域诊断

### 2.1 Preload Bridge (L1.5) — ~60 个扁平方法

#### 2.1.1 问题全景

当前 `src/preload.ts` 暴露的 `AgentSkinApi` 对象结构：

```typescript
const api: AgentSkinApi = {
  // 注入核心 (8 个)
  applyTheme, restoreApp, importTheme, importThemeFromPath, importThemeBytes,
  openThemeFile, exportTheme, deleteTheme, setWallpaper, setAgentWallpaper,
  applyAgentWallpaper, applyWallpaperToAgent, removeWallpaperFromAgent, ... // 8 个

  // 设置 (8 个)
  getSettings, pickAppPath, clearAppPath, setAppPort, getCustomThemeCss, setCustomThemeCss,
  setLiveDomRefreshInterval, getMarkdownStyles, saveMarkdownStyles,

  // 目录 (1 个对象)
  catalog: { agents: { list }, themes: { list, get, search, filter } }, // 4 个

  // CSS 源码编辑 (3 个) — 不属于"注入"链路
  listStyleSheets, getStyleSheetText, applyRawCssEdit,

  // 窗口控制 (5 个) — 不属于"注入"链路
  windowMinimize, windowToggleMaximize, windowClose, windowIsMaximized, onWindowMaximizeChange,

  // 壁纸 URL 解析 (4 个)
  wallpaperVideoUrl, wallpaperWebUrl, wallpaperPreviewUrl, wallpaperStaticFrame,

  // 主题工作室 (~20 个!) — 独立产品
  snapshotThemeDom, snapshotBaseline, captureLiveDom, writeLiveDomCache, readLiveDomCache,
  exportStudioTheme, startInspect, stopInspect, openStudioWindow,
  listStudioProjects, createStudioProject, saveStudioProject, deleteStudioProject,
  importStudioProject, saveStudioSnapshot, loadStudioSnapshot, extractThemeFromImage,
  listBundles, onInspectResult,

  // 视觉分析 (~5 个)
  getVisualAnalysisTarget, listVisualAnalysisTargets, listVisualAnalysisSummaries,
  detectVisualAnalysisAgent, onVisualAnalysisProgress, exportVisualAnalysisTheme,

  // 运行时日志 (1 个)
  onRuntimeLog, onFileImported, onFileImportConfirm, onFileImportFailed, onTrayApply,
  onThemeHotReload, onStatusChanged, onBootWarnings,

  // 其他
  weDetect, extractThemeFromWallpaper, previewThemeFromWallpaper, applyThemeFromWallpaper,
  refreshStatus, setLocale, setThemeMode, getBootstrap, createBundle, installBundle,
  pushTweak, saveTweakAsCustomCss, resetTweak, showInFolder, ... // ~12 个
};
```

**核心问题**：

1. **API 边界模糊** — 注入（`applyTheme`）、窗口控制（`windowMinimize`）、CSS 编辑（`applyRawCssEdit`）放在同一层级，新人无法判断哪些属于核心链路、哪些是外围功能。

2. **Window 控制泄漏** — `windowMinimize`、`windowToggleMaximize`、`windowClose`、`windowIsMaximized`、`onWindowMaximizeChange` 5 个方法属于窗口管理功能，完全不属于 AgentSkin 的注入/定制职责。它们只是图方便贴在了 AgentSkinApi 上。

3. **类型安全缺口** — preload.ts 有 21 处 `// TODO: type-guard — 待渐进式加固` 注释，涉及 `snapshotThemeDom`、`captureLiveDom`、`listStudioProjects`、`detectVisualAnalysisAgent` 等方法。当前返回值用 `as Promise<...>` 强转，**没有运行时校验**，一旦 main 进程返回形状变化（例如重构字段名），渲染端静默拿到错误形状 → 难以追踪的 UI bug。

4. **catalog 子对象嵌套不一致** — `api.catalog.themes.list()` 嵌套了两层，而 `api.applyTheme()` 在顶层，同一 API 对象内存在两种调用约定。

#### 2.1.2 对标竞品

DreamWork 没有 preload 桥接层 — 它只有一个 `contextBridge.exposeInMainWorld('dreamWork', { discover, launch, apply, remove, status })` 5 个方法。这是因为它不做 UI 工作室、不做视觉分析。

Codex-Dream-Skin 的 preload 暴露约 15 个方法（仅做 menubar/状态/注入触发），仍是 AgentSkin 的 1/4。

AgentSkin 的功能范围确实比竞品大（Studio + Visual Analysis + CSS Editor + Tweak），但仍然可以将它们**按领域分组**而非扁平暴露。

### 2.2 IPC 通道注册表 (L2) — 84 个通道

#### 2.2.1 计数统计

```typescript
// src/shared/ipc-channels.ts 中的 IpcChannel 常量分组计数：
Core (7)
Theme (7)
Community_Theme (5)
Settings (8)
Wallpaper (13)        ← 最大组
Bundles (7)
Studio_Image (1)
Studio (11)
Environment (2)
CSS_Editor (3)        ← 应归入 Settings 或 Studio
Window (5)            ← 不属于注入链路
Main→Renderer_Events (12)
Pet (4)
Performance (5)
Deep_Link (2)
Quick_Apply (2)       ← 应归入 Theme
MCP (2)               ← 独立功能
Visual_Analysis (5)   ← 应归入 Studio
Wallpaper_Engine (1)  ← 应归入 Wallpaper
```

总计 **84 个通道**，而主 RFC 报告 "~40 个"可能仅计了 invoke 通道，遗漏了 SEND_ONLY 事件通道。

#### 2.2.2 膨胀来源分析

| 分类 | 通道数 | 说明 | 归属建议 |
|------|--------|------|---------|
| Wallpaper | 13 | 含 VIDEO_URL / WEB_URL / PREVIEW_URL / STATIC_FRAME / EXTRACT_THEME 独立通道 | 合并为 `wallpaper:media` batch 通道 |
| Studio | 11 | SNAPSHOT_SAVE/LOAD, PROJECT_*, LIVE_DOM_CACHE_* | 保留（独立产品） |
| CSS Editor | 3 | CSS_LIST / CSS_GET_TEXT / CSS_APPLY_EDIT | 合并入 Settings |
| Quick Apply | 2 | QUICK_APPLY / QUICK_APPLY_CANCEL | 合并入 Theme |
| Window | 5 | WINDOW_* | 独立 Bridge 文件 |
| Pet | 4 | PET_SHOW / HIDE / MOVE / SET | 独立 Bridge 文件 |
| Performance | 5 | PERFORMANCE_GET / GET_TIMEOUTS / CLEAR_TIMEOUTS / GET_MEMORY / NEW_TRACE | 合并入 Diagnostics |
| Main→Renderer Events | 12 | STATUS_CHANGED / THEME_HOT_RELOAD / RUNTIME_LOG / FILE_IMPORTED / ... | 9→IpcEventBus |

#### 2.2.3 三层维护负担

每增加一个 IPC 功能（例如 `regenTheme`），必须在 3 处同步修改：

```
1. src/shared/ipc-channels.ts       → 添加 `REGEN_THEME: 'regen:theme'`
2. src/preload.ts                   → 添加 `regenTheme: (req) => ipcInvoke(REGEN_THEME, req)`
3. src/main/ipc/core-ipc.ts          → 添加 `ipcMain.handle(REGEN_THEME, handler)`
```

三个文件 + 顺序依赖（先定义 channel → 在 preload 引用 → 在 handler 注册）是 IPC 维护的主要 BUG 来源。

### 2.3 委托中间层 (L2.5) — 15+ 个纯转发函数

#### 2.3.1 位置与作用

`src/main/agent-engine/delegates.ts` 包含 **15 个一行转发函数**：

```typescript
// 7 个 discovery 转发
export async function reconcileZombiePorts(...) { return reconcileZombiePortsImpl(...) }
export async function resolveLivePort(...) { return resolveLivePortImpl(...) }
export async function ensureCdpReady(...) { return ensureCdpReadyImpl(...) }
export async function probeAppStatus(...) { return probeAppStatusImpl(...) }
export async function inferRestartReason(...) { return inferRestartReasonImpl(...) }

// 2 个 scheme 转发
export async function syncSchemeWithStability(...) { return syncSchemeWithStabilityImpl(...) }
export async function restoreOriginalScheme(...) { return restoreOriginalSchemeImpl(...) }

// 2 个 CDP fan-out 转发
export async function hardeningPass(...) { return hardeningPassImpl(...) }
export async function hardeningRemove(...) { return hardeningRemoveImpl(...) }

// 1 个 engine 转发
export async function tryEngineInjection(...) { return tryEngineInjectionImpl(...) }

// 2 个 wallpaper 转发
export async function injectAgentWallpaperFromApply(...) { return injectAgentWallpaperFromApplyImpl(...) }
export async function removeAgentVideoWallpaper(...) { return removeAgentVideoWallpaperImpl(...) }
```

**唯一例外** — `withPageSession` 包含真正的逻辑（CDP 重试循环 + stable-wait 集成）。

#### 2.3.2 为何是反模式

1. **调用栈深度无意义增加** — `AgentEngineService.ensureCdpReady()` → `delegates.ensureCdpReady()` → `app-discovery.ensureCdpReady()`。中间层没有做任何事（不检查、不转换、不缓存），纯粹增加调用栈层级。

2. **测试 mock 路径分裂** — 测试若想 mock `ensureCdpReady`，需要决定 mock `delegates.ts` 还是 `app-discovery.ts`。文档文件里说 "vitest resolves mocks by absolute file path" → 两个路径 mock 同一 impl 的混乱。

3. **包浆理由已失效** — delegates.ts 头部注释说 "without this file the ~15 delegating private methods and their ~6 deps factories bloat the facade by ~240 lines"。但 god-object 已拆尽（apply/wallpaper/restore/discover/scheme 都已独立），剩余 facade 只有 ~40 个方法，不再构成 bloat 威胁。

### 2.4 跨层重复基础设施 (L0 — Foundation)

#### 2.4.1 定时器全景 (13+ 个)

主 RFC 列出了 10 个定时器 + 目标削减到 1 个。但漏计了 **3 个中间层定时器**：

| 定时器 | 位置 | 间隔 | 用途 | 是否应删除 |
|--------|------|------|------|------------|
| `selfHealIv` (engine) | engine.mjs L?-? | L?-? | 引擎自愈巡检 | ✅ 删除 |
| `sheetGuardIv` (engine) | | | sheet 防护 | ✅ 删除 |
| `progressiveIv` (engine) | | | 渐进式注入 | ✅ 删除 |
| `routeIv` (engine) | | | SPA 路由探测 | ✅ 删除 |
| `qualityGuard` (engine) | | L?-? | 质量防护 | ✅ 删除 |
| `contextEngine` (deep-core) | | L?-? | deep-core 上下文 | ✅ 删除 |
| `heartbeatTimer` (pool) | | L?-? | ping 检测 | ✅ 删除 |
| **`idleScanTimer` (pool)** | | L?-? | 空闲清理 | ✅ 删除 |
| **`retiredScanTimer` (pool)** | | L?-? | 淘汰清理 | ✅ 删除 |
| `patrol` (engine) | | L?-? | 注入状态巡检 | 🔵 唯一保留 |
| **`hotReloadDebounce` (theme-hot-reload.ts)** | L?-? | 50ms | 热重载合并 | ✅ 合并入 StatusNotify |
| **`retryBackoff` (withPageSession)** | L?-? | 指数退避 | CDP 连接重试 | ✅ 删除 (新 CDP client 已内置 retry) |
| **`notifyDebounce` (main-context.ts: notifyStatusChanged)** | L?-? | 50ms | 状态广播合并 | ✅ 合并入统一 debounce |

**合计 13 个定时器**（主 RFC 报 10 个漏了 3 个），目标 **1 个 Patrol** + **1 个统一 Debounce**（合并 hot-reload / status-changed / notify）= **2 个**。

#### 2.4.2 错误报告策略不一致 (3 种)

当前链路中有 3 种错误处理策略共存：

| 策略 | 场景 | 问题 |
|------|------|------|
| `throw` | engine injection failure、CDP connect timeout | IPC handler 捕获后映射为 ApplyResponse.error |
| `log + best-continue` | hardening pass fail、scheme sync fail、wallpaper inject fail | 用户只能从日志里发现失败 |
| `notifyHotReload` + `notifyBackgroundTaskFailure` | 后台任务失败推送给 renderer 显示 toast | 是"log + notify UI"的双通道策略 |

结果：一个 apply 操作可能在 3 个不同位置产生 3 种不同的错误信号（response.error + main process log + renderer toast），新人无法判断"这个操作到底成功没有"。

#### 2.4.3 日志通道泛滥 (4 个)

| 通道 | 位置 | 用途 |
|------|------|------|
| `mainDebug(channel, msg)` | logger.ts | DEBUG 级别，DevTools 输出 |
| `mainWarn(channel, msg)` | logger.ts | WARN 级别，DevTools 输出 |
| `log: LogCallback` | ApplyFlowDeps/CdpFanoutDeps | PRODUCT 级别，写入 boot.log |
| `logStructured: (event) => void` | ApplyFlowDeps | 结构化事件，推给 renderer 渲染进度条 |

4 个日志通道对应 4 种格式、4 种去向。注入链路的每一个阶段（cdpDiscovery → applyTheme → hardening → wallpaper → schemeSync → persist）都必须同时往 2-3 个通道写（例如既写 `log` 又写 `logStructured`），日志写入路径与业务逻辑强耦合。

#### 2.4.4 广播 fan-out 散布 (3 处独立实现)

```typescript
// 1. main-context.ts — STATUS_CHANGED 事件
mainWindow?.webContents.send(IpcChannel.STATUS_CHANGED);
studioWindow?.webContents.send(IpcChannel.STATUS_CHANGED);

// 2. theme-hot-reload.ts — THEME_HOT_RELOAD 事件
mainWindow?.webContents.send(IpcChannel.THEME_HOT_RELOAD, payload);
studioWindow?.webContents.send(IpcChannel.THEME_HOT_RELOAD, payload);

// 3. cdp-fanout.ts — THEME_HEALTH_REPORT + THEME_ENGINE_INJECT_FAILURE 事件
deps.mainWindow?.webContents.send(IpcChannel.THEME_HEALTH_REPORT, health);
deps.studioWindow?.webContents.send(IpcChannel.THEME_HEALTH_REPORT, health);
```

3 处独立实现"向 mainWindow + studioWindow 广播"逻辑，每处各自判断 `win.isDestroyed()`、各自 try/catch。一旦要加第三个窗口（例如 Studio 子窗口），需要在 3 处同步修改。

---

## 3. 目标架构 — Bridge 与基础设施重构

### 3.1 Preload Bridge 重构 — 6 个 Facade

```
preload.ts (薄壳 — 仅 export 6 个 facade 引用)
├── injection.facade.ts    — apply / restore / import / export / delete
├── wallpaper.facade.ts    — list / set / import / delete / applyToAgent / removeFromAgent
├── settings.facade.ts     — get / pickAppPath / clearAppPath / setAppPort / customCss / markdown / cssEditor
├── studio.facade.ts       — snapshot / liveDom / inspect / projects / bundles / extractFromImage
├── window.facade.ts       — minimize / maximize / close / is Maximized / onMaximizeChange  ← 迁出 AgentSkinApi
└── eventBus.facade.ts     — onStatusChanged / onHotReload / onFileImported / onRuntimeLog / onDeepLink
```

调用方不变（渲染端仍然访问 `window.agentSkin.xxx`），但内部组织更清晰。

### 3.2 IPC 通道聚合规则

- 同一资源（如 Wallpaper）的 5 个操作合并为 1 个 batch 通道 + 命令分发器
- 单向事件统一走 `IpcEventBus`（不单独注册 channel）
- Quick Apply、CSS Editor、Performance 归入母域（Theme / Settings / Diagnostics）
- Window / Pet 独立 Bridge，不参与 IPC 通道注册表

### 3.3 委托层删除策略

delegates.ts 文件整体删除（仅保留 `withPageSession` 这一个确实包含逻辑的函数，将其移入 `cdp-client.ts` 或独立成 `cdp-retry-session.ts`）。

其余 14 个纯转发函数由调用方（agent-engine-service.ts）直接引用 impl 模块。

### 3.4 跨层基础设施统一

| 基础设施 | 统一方式 |
|---------|---------|
| 定时器 | 全局 `TimerRegistry` 单例，统一管理 Patrol + Debounce；其他定时器全部删除 |
| 错误报告 | Pipeline Stage 配置 `onError: 'log' \| 'throw' \| 'notify'` 三选一 |
| 日志通道 | 统一为 1 个 `Logger.write(entry)` → 内部路由至 boot.log / DevTools / renderer progress |
| 广播 fan-out | 统一为 `IpcEventBus.broadcast(event, payload)` — 遍历所有存活窗口 |

---

## 4. 定量目标 (本 RFC)

| 指标 | 当前 | Phase B1 | Phase B2 | 最终 |
|------|------|----------|----------|------|
| preload API 方法数 | ~60 扁平 | ~6 domain facade | ~6 domain facade | 6 facade + 分组方法 |
| IPC 通道数 | 84 | 56 | 40 | **32** |
| 委托层文件 | 1 (14 纯转发) | 仅保留 withPageSession | 删除 delegates.ts | **0** |
| 跨层定时器 | 13 | 6 (合并 3 个 debounce) | 3 | **2** |
| 错误策略 | 3 种 | 2 种 | 1 种 | **1** |
| 日志通道 | 4 个 | 2 个 | 1 个 | **1** |
| 广播 fan-out | 3 处 | 2 处 | 1 处 (IpcEventBus) | **1** |

---

## 5. 与主 RFC 2026-09-01 的关系

本 RFC (Supplement B) 是对主 RFC 的**第 14 层覆盖**：

```
主 RFC (L1-L13):  注入引擎 + 状态同步 + 恢复链路 + 自愈
本 RFC (L14):     Preload Bridge + IPC Channel + Delegation + Cross-cutting
```

两者**并行独立实施**，互不阻塞：
- 主 RFC 的 Phase 1-7 聚焦 inject engine / wallpaper / baseline
- 本 RFC 的 Phase B1-B3 聚焦 bridge / IPC / delegation / infrastructure

唯一交叉点：**Phase 6 的 IpcEventBus** 同时依赖主 RFC 完成 Stage 通知通道简化。

---

## 6. Migration Plan — B1/B2/B3

### Phase B1: Preload Bridge 拆分 (3 天) — P1

**目标**: 将 ~60 个扁平 API 组织为 6 domain facade

**子任务**:
1. 新建 `src/preload/facets/` 目录，按 `injection.facade.ts` / `wallpaper.facade.ts` / `settings.facade.ts` / `studio.facade.ts` / `window.facade.ts` / `eventBus.facade.ts` 拆分
2. `src/preload.ts` 变为纯 re-export 壳
3. Window 控制方法 (`windowMinimize` 等) 迁入 `window.facade.ts`，渲染端 `window.agentSkin.window.xxx` 访问路径变更（或保持 `window.agentSkinMinimize()` 语法糖兼容）

**渲染端适配**:
- 若渲染端使用 `window.agentSkin.applyTheme(...)` → 无影响
- 若渲染端使用 `window.agentSkin.windowMinimize()` → 需改为 `window.agentSkin.window.minimize()` 或新兼容包装

### Phase B2: IPC Channel 聚合 (4 天) — P1

**目标**: 84 → 32 通道

**子任务**:
1. Wallpaper 13 通道 → 3 通道 (list/set/media)
2. CSS Editor 3 通道合并入 Settings
3. Quick Apply 2 通道合并入 Theme
4. Performance 5 通道合并入 Diagnostics
5. 单向事件 12 通道 → IpcEventBus.dynamicChannel()（不预注册，运行时按需）
6. SEND_ONLY 注释 + 注册表校验脚本 (`check-ipc-channel-sync.mjs`)

### Phase B3: 委托层删除 + 跨层统一 (4 天) — P2

**目标**: 删除 delegates.ts，统一跨层基础设施

**子任务**:
1. **删除 delegates.ts** — 14 个纯转发函数内联到 agent-engine-service.ts（或直接让 facade 引用 impl 模块）
2. **withPageSession 保留但搬迁** → 迁入 `cdp-retry-session.ts`（独立 util，供需要 CDP 重试的场景使用）
3. **TimerRegistry 单例** — 统一管理 Patrol + Status Debounce + HotReload Debounce
4. **Logger 单通道** — `Logger.write(level, channel, data) → boot.log + DevTools + renderer progress`
5. **IpcEventBus 广播中心** — 替换 main-context / theme-hot-reload / cdp-fanout 各自的 fan-out 实现
6. **类型守卫补全** — preload 的 21 处 `TODO: type-guard` 替换为 zod schema 校验（仅生产代码路径）

---

## 7. Risk Assessment

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| Preload 拆分导致渲染端大量 import 路径变更 | 高 | 低 | 保持顶层语法糖 (`window.agentSkin.applyTheme`) 由原 preload.ts re-export，仅需更新内部文件结构 |
| IPC 通道聚合破坏现有 message listener | 中 | 中 | 每个旧 channel 保留 deprecated 别名 1 个版本周期；channel-consistency 校验脚本 guard |
| 委托层删除导致 facade 膨胀 | 低 | 低 | agent-engine-service 当前 3800+ 行已 God-Object 化；14 个直接 import impl 不改变代码总量，仅减少 call stack depth |
| Logger 单通道后 dev 调试困难 | 低 | 低 | Logger.write 内部仍根据 level 路由至 DevTools；DEBUG 级别默认生产不写 boot.log |

---

## 8. Open Questions

1. **Preload 拆分是否应在主 RFC Phase 1 之前完成？** — 推荐是，因为主 RFC 的 Stage 重构会影响 IPC handler 注册；IPC handler 稳定后再拆分 preload 可减少来回改动。

2. **Window 控制是否应在 AgentSkinApi 中保留？** — 推荐迁至 `window.facade.ts` 并在 preload 文档中明确声明边界。理由：AgentSkin 是"注入引擎"，窗口控制是 Electron 壳层级关注，不应混入注入引擎 API。

3. **Pet / Performance / Visual Analysis 的 IPC 通道是否也需聚合？** — 推荐本轮不处理（它们不在注入链路核心路径），但作为后续 Phase B4 的低优先级项。

4. **delegates.ts 删除后测试 mock 路径是否分裂？** — 需全局搜索 `vi.mock('./agent-engine/delegates')` 并全部替换为对应 impl 路径（app-discovery / scheme-sync / wallpaper-injector）。

5. **withPageSession 搬迁是否会引入新的循环依赖？** — 需谨慎分析：withPageSession 依赖 `resolveLivePort` (app-discovery)、`connectCdp` (cdp-client)、`waitForRendererStable` (renderer-stable-wait)，搬迁到 `cdp-retry-session.ts` 后需确认无循环。

---

*Supplement B RFC v1 结束 — 覆盖注入链路之外的 Preload Bridge / IPC Channel / Delegation Layer / Cross-cutting 基础设施，与主 RFC 同步实施。*
