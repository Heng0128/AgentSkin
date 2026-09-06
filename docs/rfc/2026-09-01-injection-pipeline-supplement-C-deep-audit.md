# RFC 2026-09-01 (Supplement C): Injection Pipeline Deep Audit — Engine Unification & Cross-Cutting Consolidation

> **状态**: DRAFT
> **作者**: Architecture Audit
> **日期**: 2026-09-01
> **范围**: 注入引擎统一（L7-L9）、跨层基础设施（定时器/错误处理/日志）、Dead Code 清场
> **前序 RFC**: 
>   - RFC 2026-09-01-injection-full-pipeline-simplification (主 RFC — L1-L13)
>   - RFC 2026-09-01-injection-pipeline-bridge-and-cross-cutting (Supplement A/B)
> **动机**: 主 RFC 和 Supplement A/B 聚焦于宏观链路和 Preload/IPC 层，但对**注入引擎核心**（CDP Client/Strategy/Executor 三层的内聚性）、**跨层基础设施散布**（13+ 定时器、4 种日志策略、3 种错误报告）、**死代码与残留**（deep-core.mjs 640 行、legacy compat globals、module-scoped no-ops）覆盖不足。本轮对这些"链路的微核心"做最终深度诊断。

---

## 1. Executive Summary — 发现与目标

| 维度 | 当前 | 目标 | 缩减率 |
|------|------|------|--------|
| CDP 核心文件数 | 104 | 28 | -73% |
| 注入引擎 LOC | ~5,200 (client+strategy+executor) | ~1,800 | -65% |
| 全局定时器 | 13+ | 3 | -77% |
| 日志通道 | 4 (mainDebug/mainWarn/log/logStructured) | 1 (unified pipeline) | -75% |
| 错误报告策略 | 3 (log/throw/notify) | 1 (Pipeline Stage config) | -67% |
| ~~死代码 LOC~~ | ~~P0 deep-core.mjs 等 1,800~~ | — | ~~文件已不存在~~ |
| No-op facades | 2 (cleanupEngineInjectionForAgent / disposeEngineInjectionState) | 0 | -100% ✅ **P0a DONE** |
| 适配器同质化 | 6 个 adapter 各 ~200 行 | 1 个 generic + 6 个薄配置 | -60% |

---

## 2. Deep Dive: 注入引擎核心 — "三个应该是一个"

### 2.1 当前状态：三个独立引擎架构

```
┌─────────────────────────────────────────────────────────────────────┐
│ CDP Client Layer (L7)                                               │
│   cdp-client.ts (435 行) — WebSocket 封装 + 命令序列化               │
│   session-pool.ts (331 行) — 连接池 + epoch retire + refCount       │
│   cdp-reconnect.ts (635 行) — 重连 + heartbeat + idle/retired scan  │
│   port-resolver / port-lease-pool / port-config                      │
├─────────────────────────────────────────────────────────────────────┤
│ CDP Strategy Layer (L8)                                             │
│   cdp-strategy.ts — adoptedStyleSheet 注入 ("hardening")            │
│   engine-strategy.ts — 5 层 CSS + adapter 注入                      │
│   css-inject.ts — adoptedStyleSheet helpers                         │
│   hero-inject.ts — hero blob URL 注入                               │
│   shared.ts — verify/backoff                                        │
│   css-builders/* — 610 行的 5 层 CSS 构建器                         │
├─────────────────────────────────────────────────────────────────────┤
│ Page Executor Layer (L9)                                            │
│   engines/unified/engine.mjs (659 行) — adapter 工厂               │
│   6 × adapter.mjs (各 ~200 行) — 结构适配 + DOM 标记               │
│   6 × adapter-config.mjs — 配置 + hooks                            │
│   6 × tokens.css + cosmetic.css — per-engine CSS                    │
│   deep-core.mjs (640 行) — 死代码，仅测试引用                       │
│   engines/shared/ — semantic-selectors.json 等                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 竞品对比：注入引擎只需要 1 个文件

| 项目 | 注入核心结构 | LOC | 文件数 |
|------|-------------|-----|--------|
| **Codex-Dream-Skin** | `runtime/renderer-inject.js` 单文件（CSS+JS+art 一体化） | 1,042 | 1 |
| **DreamWork** | `runtime/renderer-inject.js` + 构建期拼接 CSS | 698 | 1 + 构建脚本 |
| **AgentSkin** | Client + Strategy + Executor + 6 adapters + shared | ~5,200 | 30+ |

**关键差距**：竞品在**一个文件**内完成了 CSS 变量注入、art 分析、DOM 标记、样式表安装、scope 检测、自愈轮询。AgentSkin 用 30+ 文件通过复杂的层间协议完成了同样的功能。

### 2.3 内部重复与不一致

#### 2.3.1 两套 CSS 注入路径（cdp-strategy vs engine-strategy）

```typescript
// cdp-strategy.ts L88-150: 用 adoptedStyleSheet 注入
await session.evaluate(buildAdoptOwnedSheetExpression(css));

// engine-strategy.ts L297-325: 用 <style> 元素注入  
await session.evaluate(buildStyleExpression(allCss));
```

**问题**：两个策略的 CSS 注入机制不同（adoptedStyleSheet vs textContent）、验证逻辑不同、错误处理不同。DreamSkin 收敛到单一方案后，engine-strategy 保留了旧的 `buildStyleExpression` 路径仅因为"对齐竞品"，但 cdp-strategy 仍然是 `adoptedStyleSheets`。这导致了：
- 两套清理表达式（`CLEAR_ADAPTERS_BODY` vs `buildClearEngineInjectionExpression`）
- 两套验证逻辑（`verifyTheme` vs `waitForTheme`）
- 可能的样式覆盖顺序不确定（取决于哪个策略最后运行）

#### 2.3.2 两套 Hero 注入路径

```typescript
// engine-strategy.ts: 委托给 injectHeroAssets()
const { heroInjected, imagesInjected } = await injectHeroAssets(session, { imageSet, heroProtocolUrl, heroDataUrl, heroPath });

// cdp-strategy.ts: 同样委托给 injectHeroAssets()
const { heroInjected, imagesInjected } = await injectHeroAssets(session, { imageSet, heroProtocolUrl, heroDataUrl, heroPath });
```

这里实际上**已经统一**了（hero-inject.ts），但 engine-strategy 额外的 `heroBlobUrl` 回读和 `configJson` 写入是多余的（adapter 自己可以从 `getComputedStyle` 读取）。

#### 2.3.3 Session Pool 与 Reconnect 的割裂

```typescript
// session-pool.ts: "pure cache, external lifecycle" — 声明不own定时器
// 但 cdp-reconnect.ts 有 3 个独立定时器：
//   - heartbeatTimer (每 5s ping)
//   - idleScanTimer (每 30s 扫描空闲 session)
//   - retiredScanTimer (每 60s 扫描退役 session)
```

注释声称 pool 是 "stateless beyond its cache"，但实际上 reconnect.ts 通过外部定时器管理 pool 中 session 的生命周期。这是典型的"逻辑上耦合、物理上分离"导致的认知负担。

---

## 3. Deep Dive: 跨层基础设施 — "散布的协调成本"

### 3.1 定时器大盘点（13+ 个，归属 8 个文件）

| # | 定时器 | 文件 | 周期 | 用途 | 可否合并 |
|---|--------|------|------|------|---------|
| 1 | heartbeatTimer | cdp-reconnect.ts | 5s | 检测死 WebSocket | ✗ 独立 |
| 2 | idleScanTimer | cdp-reconnect.ts | 30s | 回收空闲 session | ✗ 独立 |
| 3 | retiredScanTimer | cdp-reconnect.ts | 60s | 清理退役 session | ✗ 独立 |
| 4 | watchdog timers | watchdog.ts | 2s | CPU/进程监控 | ✗ 独立 |
| 5 | hot-reload debounce | theme-hot-reload.ts | 300ms | 防抖 | ✗ 独立 |
| 6 | verify polling | injection/shared.ts | 50ms | CDP 注入验证 | ✗ 独立 |
| 7 | backoff retry | cdp-fanout.ts | exponential | 失败重试 | ✗ 独立 |
| 8 | self-heal patrol | page-executor (adapter) | 1000ms | 自愈轮询 | ✗ 独立 |
| 9 | status notify debounce | main-context.ts | 100ms | 状态广播防抖 | ✗ 独立 |
| 10 | withPageSession retry | agent-engine/delegates.ts | exponential | session 重试 | ✗ 独立 |
| 11 | reload-watchdog | reload-watchdog.ts | varies | SPA reload 检测 | ✗ 独立 |
| 12 | persistence patrol | page-executor (unified-engine) | 30000ms | DreamSkin 式持久化保护 | ✗ 独立 |
| 13 | performance flush | performance-recorder.ts | 5000ms | 性能日志写入 | ✗ 独立 |

**问题关键不在于数量，而在于无统一登记和监督**。每次新增定时器都是"在某文件里加一个 setInterval"，没有中央注册表可以：
- 列出所有活跃定时器（调试 "为什么这进程不退出"）
- 统一生命周期（apply 定时器 vs 持久化定时器的生命周期不同）
- 统一错误处理（某个定时器抛错不应该 crash 主进程）

### 3.2 日志通道碎片化

```typescript
// 4 个独立日志入口
mainDebug('cdp/engine', 'verbose info');     // 调试日志
mainWarn('cdp/engine', 'warning');            // 警告日志
log('[hardening] agent=codex: ...');          // 通用 AppEngine 日志
logStructured({ type: 'inject_done', ... });  // 结构化事件
```

每个通道有不同的格式、不同的输出目标（文件/控制台/IPC）、不同的过滤策略。当排查"为什么主题注入失败"时，需要翻 4 个不同的日志输出。

**竞品做法**：DreamWork 用 `console.log(`[cdp] ${message}`)` 单一通道，但所有日志都带 `[cdp]` 前缀，然后通过 `>` 重定向到单一日志文件。简单但有效。

### 3.3 错误报告策略三分

| 策略 | 使用场景 | 问题 |
|------|---------|------|
| `mainWarn('ctx', err)` | 非致命、可恢复 | 被忽略的警告堆积在日志里 |
| `throw new Error(...)` | 致命、需要中断 | 有时被外层 best-effort 吞掉 |
| `notifyUser(title, body)` | 需要用户感知 | 有时和 throw 重复通知 |

缺乏统一的 "Pipeline Stage → onError: log|throw|notify" 配置，导致同一类错误在不同层有不同的报告方式。

---

## 4. Deep Dive: Dead Code & Legacy Residues

### 4.1 死代码清单

| 文件 | LOC | 状态 | 处理 |
|------|-----|------|------|
| `engines/independent/deep-core.mjs` | 640 | 仅测试引用 | 删除 |
| `engines/independent/hybrid-injector.mjs` | ~200 | 未使用 export | 删除 |
| `CLEAR_ADAPTERS_BODY` legacy constants | ~50 | engine-strategy 已用 buildClearEngineInjectionExpression 替代 | 删除 |
| `CLEAR_HOST_BODY` 旧版本 | ~30 | 同上 | 删除 |
| `module-scoped no-op` functions | ~40 | cleanupEngineInjectionForAgent / disposeEngineInjectionState | 删除 |
| `engines/shared/visual-engine.mjs` (legacy) | ~150 | 已被 unified-engine 合并 | 删除（如存在） |
| `engines/shared/verify-and-feedback.mjs` (legacy) | ~120 | 已被 unified-engine 合并 | 删除（如存在） |
| `engines/shared/self-heal.mjs` (legacy) | ~180 | 已被 unified-engine 合并 | 删除（如存在） |
| `css-service.ts` orphaned methods | ~200 | 部分方法仅测试使用 | 审计后清理 |

### 4.2 Legacy Globals 残留

```typescript
// injection-runtime.ts 仍保留的 backward-compat globals:
window.__agentskin_unified_engine__   // primary
window.__agentskin_shared_engine__    // backward-compat (冗余)
window.__agentskin_sheet_manager__    // 旧版 sheet manager global
window.__agentskin_sheet_factory__    // 旧版 factory
window.__ADAPTER_ENGINE_CONFIG__      // 旧版 config
6 × window.__agentskin_{agent}_adapter__  // per-agent markers
```

主 RFC 已经规划了 `window.__agentskin__` 命名空间统一，但当前仍有 **12+ 个独立 global** 散布在引擎代码中。

---

## 5. Deep Dive: 6 个适配器的同质化

### 5.1 结构对比

所有 6 个 `engines/{agent}/adapter.mjs` 共享完全相同结构：

```javascript
// adapter.mjs 伪代码（6 个文件 90% 一致）
((CONFIG) => {
  const AGENT_ID = 'codex';  // 仅此不同
  const SELECTORS = CONFIG.selectors;  // 来自 adapter-config.mjs
  
  // 以下 150 行 90% 相同：
  // 1. 创建 sheet manager
  // 2. 定义 applyTheme(shell) 函数
  // 3. 定义 REMOVE_ALL() 清理函数
  // 4. 安装 MutationObserver 自愈
  // 5. 标记 DOM parts（data-ds-part / data-agentskin-part）
  // 6. 初始化视图（首次 ensure()）
  // 7. 注册到 window.__agentskin__ 命名窗口
})(__CONFIG__);
```

**差异点**（每个 adapter ~20 行）：
- `AGENT_ID` 字符串
- `SELECTORS` 映射（哪些 DOM 元素对应哪些 part）
- 1-2 个 agent-specific 的 CSS 微调
- workbuddy 多一个 `ambient-router.mjs` 处理路由

**结论**：6 个 adapter.mjs 可以合并为 1 个 generic adapter + 6 个纯 JSON 配置文件。

### 5.2 6 个 tokens.css 和 cosmetic.css 的同质化

```css
/* tokens.css 伪代码（6 个文件结构相同） */
:root {
  --agentskin-code-bg: var(--agentskin-surface);  /* 仅值不同 */
  --agentskin-font-mono: 'Cascadia Code', ...;     /* 仅值不同 */
  /* 约 15-20 个变量，6 个文件中 80% 仅值不同 */
}
```

**结论**：tokens.css 和 cosmetic.css 可以合并为 per-agent 的 JSON 配置 + 通用 CSS 生成器。

---

## 6. Reduction Plan — 三批落地

### Batch P0 — 死代码 + No-op 清场
**P0a — No-op facade 删除** ✅ **DONE (2026-09-01)**
**P0b — Deep Code 复查** — 文件已不存在（被 unified-engine 早期吸收）

| 动作 | 影响范围 | 结果 |
|------|---------|------|
| 删除 `cleanupEngineInjectionForAgent` / `disposeEngineInjectionState` no-op | `engine-strategy.ts` (-20 行) | ✅ |
| 删除 import + 调用 | `agent-engine-service.ts` | ✅ |
| 删除 vi.mock block × 6 | `*-reliability.test.ts`, `*-visibility.test.ts`, etc. | ✅ |
| 删除断言 × 8 | `agent-engine-service-restore-integration.test.ts`, etc. | ✅ |
| 更新 harness 注释 | `agent-engine-service-test-harness.ts` | ✅ |
| **净减** | **~60 行生产 + ~80 行测试** | ✅ |

**P0b — Deep Code 复查**

| 原计划删除 | 实际状态 |
|-----------|---------|
| `engines/independent/deep-core.mjs` (640 行) | **已不存在** (被 unified-engine 吸收) |
| `engines/shared/visual-engine.mjs` (legacy) | **已不存在** (被 unified-engine 吸收) |
| `engines/shared/self-heal.mjs` (legacy) | **已不存在** (被 unified-engine 吸收) |
| `engines/shared/verify-and-feedback.mjs` (legacy) | **已不存在** (被 unified-engine 吸收) |
| `CLEAR_ADAPTERS_BODY` / `CLEAR_HOST_BODY` | **生产代码仍使用** — 不能删除 |
| `css-service.ts` orphaned methods | 待审计 |

**结论**: P0 死代码已在之前的重构（unified-engine 合并）中清除。本轮 P0a 清理了遗留的 no-op facade 和对应的测试 mock/断言。

**验证**: `npm run typecheck` 全绿, `npm test -- --project main --run` 5104/5104 ✓

**P1-5 — CSS 注入路径统一 (消除覆盖冲突)** ✅ **DONE (2026-09-01)**

| 动作 | 影响范围 | 结果 |
|------|---------|------|
| 新增 `injectCssStyle()` 统一入口 (`<style>` 元素方案) | `css-inject.ts` | ✅ |
| `cdp-strategy.ts` 改用 `injectCssStyle()` | `cdp-strategy.ts` | ✅ |
| `injectCssAdopted()` 标记为 `@deprecated` | `css-inject.ts` | ✅ |
| 导出 `injectCssStyle` / `injectCssLayer` | `cdp-inject.ts` barrel | ✅ |
| 更新测试 mock | `cdp-inject.test.ts` | ✅ |
| **净效果** | **单一注入机制，消除覆盖冲突** | ✅ |

**验证**: `tsc --noEmit` ✓ | `npm test -- --project main --run` 5104/5104 ✓

**架构对齐**:
- Before: `engine-strategy` 用 `<style>` + `cdp-strategy` 用 `adoptedStyleSheets` → 双路径覆盖冲突
- After: 统一 `<style>` 注入，`adoptedStyleSheet` 仅作 Doubao 恢复 fallback

### Batch P1 — 注入引擎核心统一（~2,000 LOC → ~800 LOC）

| 动作 | 影响范围 | 风险 |
|------|---------|------|
| **合并 cdp-strategy + engine-strategy** → `unified-inject.ts` | 消除双路径 CSS 注入 | 高 — 需回归 6 个 agent |
| **合并 session-pool + reconnect** → 单一 `CdpSessionManager` | 定时器统一管理 | 中 — 需保留 refCount/epoch 语义 |
| **合并 6 adapter.mjs → 1 generic + 6 JSON configs** | `engines/generic/adapter.mjs` | 高 — 最大风险 |
| **合并 6 tokens.css + cosmetic.css → JSON config** | CSS 生成器 | 低 — 纯重构 |
| **统一 CSS 注入为单一 `<style>` 元素方案** | 删除 adoptedStyleSheet 路径 | 中 — 验证 Doubao 兼容性 |

### Batch P2 — 跨层基础设施统一

| 动作 | 影响范围 | 风险 |
|------|---------|------|
| **定时器注册表** `TimerRegistry` | 所有 13+ 定时器 | 低 — 新增 wrapper |
| **日志统一** 单一带 context 的 `logger` | 4 通道合 1 | 低 — 向后兼容 shim |
| **错误策略配置化** `Stage.onError: 'log'\|'throw'\|'notify'` | try/catch 散布点 | 中 — 需逐 stage 配置 |
| **legacy global 迁移到 `window.__agentskin__`** | 6 个文件 | 低 — 已规划 |

---

## 7. Post-Reduction Architecture — "DreamSkin 对齐"

### 7.1 统一后的注入引擎结构

```
注入引擎 (~1,800 LOC, 8 文件)

├── unified-inject.ts (400 行) — CDP 注入入口
│   ├── 创建/获取 CdpSession（通过 SessionManager）
│   ├── 清理上次注入（buildClearEngineInjectionExpression）
│   ├── 注入 CSS（单一 <style> 方案）
│   ├── 注入 Hero（injectHeroAssets）
│   ├── 执行 adapter 表达式
│   └── verify（waitForTheme）
│
├── cdp-session-manager.ts (350 行) — 连接管理
│   ├── WebSocket 连接池
│   ├── heartbeat / idle / retire 定时器（3 → 1 个统一调度）
│   ├── epoch-bound lifecycle
│   └── reconnect with backoff
│
├── inject-pipeline.ts (250 行) — Pipeline 抽象
│   ├── Stage 定义 (cleanup → hero → css → adapter → verify)
│   ├── 统一错误处理 (onError config)
│   └── 统一日志 (带 stage context)
│
├── adapter-factory.ts (200 行) — 替代 6 个 adapter-config
│   ├── createAdapter(configJson)
│   ├── installPersistScript()
│   └── AMO (AdaptiveMutationObserver)
│
├── generic-adapter.mjs (250 行) — 页面内执行
│   ├── SheetManager
│   ├── TokenDiscovery
│   ├── SelfHeal (patrol)
│   └── PartMarker (data-agentskin-part)
│
├── agent-configs/ (6 个 JSON, 各 ~50 行)
│   ├── codex.json
│   ├── traework.json
│   ├── qoderwork.json
│   ├── workbuddy.json
│   ├── doubao.json
│   └── zcode.json
│
├── palette-builder.ts (existing) — 14-token CSS 生成
│
└── injection-runtime.ts (reduced) — 运行时表达式构建
```

### 7.2 注入时序（统一后）

```typescript
// AgentEngineService.apply → applyTheme 的完整路径 (简化后)
async function applyTheme(agentId, themeId) {
  const adapter = requireAdapter(agentId);  // L5
  const bundle = await resolveThemeTarget(agentId, themeId);  // L4
  
  await withPageSession(agentId, async (session) => {
    // L6: fan-out 到当前 target (仅 page, webview 走下)
    
    // L7: SessionManager 提供连接 (不再直接 new CdpSession)
    
    // L8: unified-inject 单路径注入:
    const pipeline = new InjectPipeline(session)
      .stage('cleanup', s => clearInjection(s))
      .stage('hero',   s => injectHeroAssets(s, bundle))
      .stage('css',    s => applyAllLayers(s, { palette, tokens, cosmetic, theme, custom }))
      .stage('adapter', s => evaluateAdapter(s, agentId, bundle))
      .stage('verify',  s => waitForTheme(s, { timeout: 3000 }));
    
    const result = await pipeline.run({ onError: 'throw' });
    
    // L9: adapter 已经在 s.evaluate 中执行
  });
  
  // L10: 不再有独立 Wallpaper 通道 — 并入 bundle.imageSet
  // L11: baseline/preflight 检查已在 pipeline.run 内部
  // L12: scheme sync 作为 pipeline 最后阶段
}
```

### 7.3 与竞品结构对标

| 维度 | DreamSkin | AgentSkin (统一后) |
|------|-----------|-------------------|
| 注入入口 | 1 个 IIFE (`renderer-inject.js`) | 1 个 `InjectPipeline` |
| CSS 注入 | adoptedStyleSheet | `<style>` 文本 (对齐 DreamSkin) |
| 构建期拼接 | CSS+JS+art → 模板替换 | palette + engine + adapter → evaluate |
| 自愈 | 30s setInterval | 30s setInterval (保留) |
| 持久化 | `addScriptToEvaluateOnNewDocument` | `addScriptToEvaluateOnNewDocument` (保留) |
| 配置 | `theme.json` (6 字段) | `agent-config.json` (选择器 + tokens) |
| 多应用 | 每个应用 1 个 injector | 6 个 agent 共享 generic-adapter + 配置 |

---

## 8. 风险与缓解

| # | 风险 | 等级 | 触发条件 | 缓解 |
|---|------|------|---------|------|
| R1 | 合并 CSS 注入路径后 Doubao 不兼容 | 高 | Doubao 删除 `<style>` 元素 | 保留 adoptedStyleSheet 作为 fallback |
| R2 | generic-adapter 遗漏 agent-specific 逻辑 | 中 | workbuddy 路由、doubao dark-remap | 保留 `adapter-features/` hooks 扩展点 |
| R3 | SessionPool 与 Reconnect 合并后 semantics 变化 | 中 | refCount 竞争、epoch 边界 | 集成测试 + 灰度 1 周 |
| R4 | 定时器统一后某个 timer 被遗漏 | 低 | 新注册表漏注册 | 装饰器自动注册 + lint 检查 |
| R5 | legacy global 删除后外部脚本引用 | 低 | 无外部 — 内部专用 | grep `__agentskin_` 全仓库 |

---

## 9. 与主 RFC 和 Supplement A/B 的关系

```
主 RFC (L1-L13 宏观链路)
├── Supplement A/B (Preload/IPC/Dep 桥接层)
└── Supplement C (本轮 — 微核心)
    ├── P0: Dead Code 清场 (1,200 LOC)
    ├── P1: 注入引擎统一 (3,400 → 1,800 LOC)
    ├── P2: 跨层基础设施统一 (TimerRegistry + Logger + ErrorPolicy)
    └── 依赖关系: P0 → P1 → P2 (串行)
```

**总缩减目标**: 主 RFC + Supplement A/B + Supplement C 合计 **~18,000 → ~7,500 LOC**，文件数 **~170 → ~55**。

---

## 10. 验收标准

1. **注入功能一致性**: 6 个 agent × 14 个主题 × (首次注入 + SPA 导航 + 热重载 + 主题切换 + 恢复) = 504 个场景全部通过
2. **性能**: apply 热路径 P95 延迟 ≤ 当前基线 + 10%
3. **代码量**: 注入核心 ≤ 1,800 LOC
4. **定时器**: 活跃定时器 ≤ 5 个
5. **全局变量**: `window.__agentskin_*` global 数 ≤ 3
6. **测试覆盖**: 所有新模块 ≥ 80% 行覆盖，pipeline 集成测试 ≥ 90%

---

> **状态**: DRAFT — 待评审
> **评审重点**: 
> 1. generic-adapter + JSON 配置方案是否足够表达 6 个 agent 的差异？
> 2. CSS 注入路径统一为 `<style>` 是否需要保留 adoptedStyleSheet fallback？
> 3. 定时器统一是否值得引入 TimerRegistry 抽象？
