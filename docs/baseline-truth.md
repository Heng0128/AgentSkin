# Baseline Truth — 主题注入现状固化（收敛前基线）

> 这不是设计文档，是**现状的唯一参照物**。作用：把收敛前“主题注入到底怎么跑、谁在写页面、谁在持久化、靠什么探测/清理”全部固定下来，作为 [RFC: 双引擎收敛](./2026-08-18-engine-injection-convergence.md) P1-P3 迁移的对照基准与回滚锚点。
>
> **变更法则**：凡改动注入通道 / 持久化承担者 / 注入标识 / 清理逻辑 / 探测锚点者，必须先更新本文件，再改代码，再跑 `npm run check`。
> 状态：`已确认`（2026-08-18 逐文件核对）

---

## 1. 链路全景

```
UI → preload → IPC → 主进程(theme-apply-flow) → 适配器 applyTheme / hardeningPass → CDP → 目标应用渲染进程
                                                      ↓
                                       src/engine/src/runtime/  (core 运行时)
                                       src/main/cdp/injection/  (hardening 引擎)
```

## 2. 适用边界与本文件覆盖范围

- 覆盖：**主题（theme）** 注入。壁纸(wallpaper)、副目标(secondary targets)、light/dark 模式同步不在本基线展开（它们在流程上附属于 apply，见 §4 时序）。
- Agent：6 个（`traework` `qoderwork` `workbuddy` `doubao` `codex` `zcode`），共享同一套双轨机制，仅 adapter.mjs/生成器差异。
- 关键结论（本文件核心）：**主题注入由两套独立机制并存承担，都写主页面，构成结构性双写。** 这是收敛 RFC 要消除的对象。

## 3. 两套注入机制现状

### 3.1 通道对比

| 维度 | 机制 A — core 运行时 | 机制 B — hardening 引擎 |
|------|----------------------|--------------------------|
| 代码位置 | `src/engine/src/runtime/{injector.mjs,renderer-payload.mjs}` | `src/main/cdp/injection/{engine-strategy.ts,css-inject.ts}` |
| 入口 | `adapter.applyTheme`（[theme-apply-flow.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/theme-apply-flow.ts#L431-L443)） | `hardeningPass`（[cdp-fanout.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L370-L495)） |
| 触发 | 每次 apply，同步等待 | 每次 apply，后台 fire-and-forget |
| 目标 | 主 `page` 目标 | **全部** DOM target（page/webview/iframe，`findDomTargets`） |
| 写入通道 | `document.adoptedStyleSheets`，单张 owned sheet（标记 `__agentskin_theme`）承载整包 `cssText`（[renderer-payload.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L304-L316)） | `document.adoptedStyleSheets`，逐层 adopt palette/tokens/cosmetic/theme/custom（[engine-strategy.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/engine-strategy.ts#L253-L268)） |
| CSS 承担 | 单 owned sheet 承载整包 cssText | 每层一个 `CSSStyleSheet`（`injectCssLayer`） |
| 自愈 | MutationObserver + `setInterval` 5s 按需重挂（[renderer-payload.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L311-L325)） | 持久化脚本`applyLayers()`幂等重跑 |

### 3.2 共享注入原子（两套共用，勿重复定义）

定义于 [injection-runtime.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/shared/injection-runtime.ts)：

| 原子 | 说明 | 使用方 |
|------|------|--------|
| `ADOPT_LAYER_BODY` | adopt 单个具名 layer，幂等 | A 持久化脚本 `applyLayers` |
| `buildAdoptLayerExpression` | 完整 IIFE adopt 具名 layer | B `injectCssLayer`（境换） |
| `buildAdoptOwnedSheetExpression` | 无名 owned sheet（wallpaper 等） | B 相关 |
| `CLEAR_ADAPTERS_BODY` | 断连所有 adapter 标记(observer+interval) | B `injectThemeViaEngine` 清理 + `buildClearEngineInjectionExpression` |
| `buildClearEngineInjectionExpression` | 全清（owned sheets + adapters + host class + config global） | B `removeEngineInjection` |

> 共享内核已归一化“adoptedStyleSheets 操作”。**core 的 `<style>` 通道是唯一未收敛进共享内核的特殊路径**——收敛 P1 的核心动作就是把 core 切到 `adoptedStyleSheets` 复用上述原子。

## 4. Apply 固定编排时序（[theme-apply-flow.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/theme-apply-flow.ts#L425-L554)）

```
1. adapter.applyTheme(bundle, {launch:false})  ← 机制 A，同步
2. setActiveTheme + persist
3. injectSecondaryTargets(后台)                 ← 副目标 webview/iframe
4. hardeningPass(后台) → 对主页面再次写 adoptedStyleSheets ← 机制 B，构成双写
5. [hardening 完成] .then → injectAgentWallpaperFromApply
6. syncSchemeWithStability(后台)               ← light/dark 匹配
```

> 双写成立点：主 `page` 目标在步骤 1 被 core 的 owned sheet 写入，步骤 4 又被 hardening 五层 adoptedStyleSheets 写入（[cdp-fanout.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L440-L446)）。P1 起两者都走 `adoptedStyleSheets`，仅标记维度不同（core：单一 `__agentskin_theme`owned sheet；hardening：命名 layer）。

### 并发护栏（保留，收敛时勿破坏）

- `applyEpoch`（`isEpochCurrent` + `bumpEpoch`）：新 apply/restore 使旧后台任务失效（[cdp-fanout.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L407-L414)）。
- `deps.unlockAgent`（`applyingTheme` 锁）：防并发 apply 互相覆盖。
- hardening→wallpaper 链式 `.then`：确保硬化把 punch-through sheet 重排到最后后再建 wallpaper，避免顺序竞态。

## 5. 持久化双轨（核心双写之二）

两套各自注册一个 `Page.addScriptToEvaluateOnNewDocument`，**导航后都会执行**：

| 机制 | 注册函数 | 持久化脚本内容 | 跟踪 key |
|------|----------|----------------|----------|
| A | `injector.mjs` `registerPersistenceScript`（[L92-107](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/injector.mjs#L92-L107)） | `buildPersistenceScript` → `(0,eval)(APPLY_BODY)` 重放 adopted-themed-sheet 注入体（[renderer-payload.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L379-L403)） | `port:targetId` |
| B | `engine-strategy.ts` `registerEnginePersistence`（[L323-522](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/engine-strategy.ts#L323-L522)） | 内联脚本 `applyLayers()+applyHero()+applyAdapter()` 重放五层 adoptedStyleSheets | `agentId` |

- **共享禁用标记**：`sessionStorage['__agentskin_disabled__']='1'`（`SESSION_DISABLED_KEY`），restore 时置位，令两套持久化脚本在下次导航都跳过。收敛 P2 需保留此单一语义。
- **双脚本事实**：机制 A 与机制 B 各注册一个 new-document 脚本；即使各自幂等，也存在重复执行开销与双清理路径（见 §6）。这是收敛 P2 要合并的对象。

## 6. 清理双轨

| 机制 | 清理函数 | 作用 |
|------|----------|------|
| A | `renderer-payload.mjs` `buildRemoveExpression`（[L405-434](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L405-L434)） | 调 `state.cleanup()` / fallback：移除 `__agentskin_theme` owned sheet、host class、art、image vars、dataset |
| B | `engine-strategy.ts` `removeEngineInjection`（[L541-574](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/engine-strategy.ts#L541-L574)） | 移除脚本 id + 置禁用标志 + `buildClearEngineInjectionExpression`（owned sheets/adapters/host/config） |

> 收敛后应统一到单一清理内核（`buildClearEngineInjectionExpression`），core 的 `__agentskin_theme` filter 由此接管（其 sheet 也带 `__agentskin` owned 标记，故 hardening 清理同样能移除）。

## 7. 注入标识 / 常量（唯一来源 [injection-constants.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/shared/injection-constants.ts)）

| 常量 | 值 | 用途 |
|------|-----|------|
| `HOST_CLASS_PREFIX` | `agentskin-host-` | `<html>` host class |
| `RENDERER_CONFIG_GLOBAL` | `__AGENTSKIN_CONFIG__` | adapter config global |
| `SESSION_DISABLED_KEY` | `__agentskin_disabled__` | 持久化禁用标记 |
| `SHEET_OWNED_FLAG` | `__agentskin` | adoptedSheet owned 标记 |
| `SHEET_LAYER_FLAG` | `__agentskin_layer` | adoptedSheet 层名标记 |
| `ADAPTER_MARKERS` | `__agentskin_<id>_adapter__` ×6 | adapter 标记 |
| `RENDERER_SELF_HEAL_INTERVAL_MS` | 5000 | core 自愈轮询间隔 |
| `THEME_SHEET_FLAG`（engine-local） | `__agentskin_theme` | core 单张主题 owned-sheet 标记（P1 起；P1 前为 `<style>` id `agentskin-theme-style-<agentId>`，已退役） |

## 8. 探测锚点清单（P1 后状态）

P1 已把 core 从 `<style>` 迁移到 adoptedSheet：全部探测由 `getElementById('agentskin-theme-style-<id>')` 迁移为**探测 `__agentskin_theme` owned sheet 是否存在**：

| 位置 | 探测内容 |
|------|----------|
| [renderer-payload.mjs#L428-430](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L428-L430) | remove fallback：filter 移除 `__agentskin_theme` sheet |
| [renderer-payload.mjs#L510](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L510) | styleSampling：无 `__agentskin_theme` sheet → 中性 pass |
| [renderer-payload.mjs#L569](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L569) | `buildVerifyExpression.stylePresent` |
| `checkThemeHealth.themeSheetPresent`（[theme-health-check.ts#L97-118](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/theme-health-check.ts#L97-L118)） | **无需改动**：按 `s[__agentskin]` owned sheet 计数，core 新 sheet 天然计入 |
| core 自愈 interval（[renderer-payload.mjs#L336](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/renderer-payload.mjs#L336)） | 无 `__agentskin_theme` sheet → ensure() 重挂 |

> 未迁移（保持 `<style>`，独立于本收敛范围）：副目标注入 `secondary-inject.ts`（webview/iframe），其测试相应断言不变。手动测试 `live-reload-persistence` / `live-apply-all` 仍引用旧 id，但 `AGENTSKIN_MANUAL=1` 跳过，不跑在 `npm run check`；后续使用需同步更新断代。

## 9. 双写 / 闪烁风险定位（收敛动机复刻）

- **双 CSS**：主页面同时持有 core 的 owned sheet（`__agentskin_theme`，P1 起）与 hardening 的 5 层 adoptedStyleSheets → 同 selector 双规则、重复解析。
- **双持久化**：两个 new-document 脚本 → 重复执行开销、双清理路径。
- **闪烁**：apply 存在 原生首帧 → core owned sheet 换上 → hardening adoptedStyleSheets 再盖 的时间窗，无防闪隔离（两段过渡）。收敛到单引擎后此时间窗自然消除。
- **验证兜底**：hardening 里引擎缺失时走 `injectThemeViaCdp` 单 CSS legacy 回退（[cdp-fanout.ts#L461-L477](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L461-L477)）——长期作为脆弱路径最终 fallback 保留（RFC §7 项 2）。

## 10. 6 Agent 通道矩阵

6 个 agent 全部共享本节双轨机制，差异仅在 adapter.mjs 结构 CSS 与生成器（`scripts/generators/<agent>Css.mjs`），与“注入通道双轨”无关。缺陷修正规则见 `scripts/native-defect-fixes.mjs`（C8/C9 单一来源）。

| Agent | core owned sheet（`__agentskin_theme`） | hardening adoptedStyleSheets | legacy 回退可用 |
|-------|:---:|:---:|:---:|
| traework | ✓ | ✓ | ✓ |
| qoderwork | ✓ | ✓ | ✓ |
| workbuddy | ✓ | ✓ | ✓ |
| doubao | ✓ | ✓ | ✓ |
| codex | ✓ | ✓ | ✓ |
| zcode | ✓ | ✓ | ✓ |

## 11. 收敛对照（本文件的“应然”）

**P1 已完成**：core 注入通道已由 `<style>` 迁移到 adopted owned sheet（`__agentskin_theme`），主页面不再注入 `<style>` 标签；探测锚点已迁移到 sheet 探测。剩余双轨：双持久化脚本（P2）、hardening 无条件二次写（P3）。

收敛全部完成后（RFC P1-P3 全落地），本文件 §3-§8 最终应态：

- 主页面仅**一套** adoptedStyleSheets 五层（palette/tokens/cosmetic/theme/custom），无 core 独立 sheet 与 `<style>` 标签。
- 持久化**一套** new-document 脚本 + `__agentskin_disabled__` 禁用标记。
- 清理**一套** `buildClearEngineInjectionExpression` 内核。
- 探测锚点全部基于 adoptedStyleSheets 层标记，无 `agentskin-theme-style-*` 依赖。
- hardening 降级 watchdog：校验通过则跳过，失败才重注入。

> 每阶段落地时更新本文件以反映最新基线，并跑 `npm run check` 全绿。