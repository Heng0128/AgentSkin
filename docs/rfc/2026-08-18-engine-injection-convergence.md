# RFC：主题注入双引擎收敛为单一引擎（Engine Injection Convergence）

> 状态：`待评审`
> 日期：2026-08-18
> 分支：`（待建）`
> 范围：`src/main/cdp/{cdp-fanout.ts,cdp-inject.ts,injection/{engine-strategy.ts,cdp-strategy.ts,css-inject.ts}}`、`src/main/theme-apply-flow.ts`、`src/engine/src/runtime/{injector.mjs,renderer-payload.mjs}`、`src/shared/injection-runtime.ts`、各`engines/<agent>/adapter.mjs`
> 上游依据：本会话“主题注入有几套流程 / 是否有冲突 / 是否闪烁”架构梳理

---

## 1. 背景与目标

用户询问：主题注入到底跑几套流程？是单一引擎还是多套并存且互相冲突？是否有闪烁问题？排查结论确认**存在结构性冗余**——同一个“主题 CSS 注入 + 持久化”关注点被**两套独立实现**重复承担：

1. **core 运行时**（`src/engine/src/runtime/injector.mjs`，经 `adapter.applyTheme` 调用）——
   注入通道是 DOM `<style>` 标签（`agentskin-theme-style-<agentId>`），持久化走一套 session 绑定的 `persistenceSessions` 脚本。
2. **hardening 引擎**（`src/main/cdp/injection/engine-strategy.ts`，经 `hardeningPass` 调用）——
   注入通道是 `adoptedStyleSheets` 五层，又维护一套 `persistenceScriptIds` 持久化脚本。

两者都会写**同一个主页面**。这带来：

- **双重注入**：同一份 theme CSS 被 `<style>` 与 `adoptedStyleSheets` 各注入一遍 → 同 selector 双规则、重复解析。
- **持久化双脚本**：两套 `Page.addScriptToEvaluateOnNewDocument` 都会在导航后执行 → 各自幂等但重复执行。
- **闪烁风险**：首帧原生 → core `<style>` 换上 → hardening adoptedStyleSheets 再盖一遍，存在两次注入过渡的时间窗，且没有任何防闪隔离。

用户明确要**治本而非治标**——不做“盖一层遮罩掩盖闪烁”的方案，要从结构上消除双轨，且要兼顾长期演进。

**目标**：

- 收敛为**单一注入引擎**，以 `adoptedStyleSheets` 为唯一注入权威，消除双写。
- 持久化注册**统一为一套**，删除双脚本与双清理路径。
- hardening 从“每次无条件二次注入”降级为 **watchdog**（仅在校验失败/被反篡改清除时兜底重注入）。
- 消除 apply 的两段注入过渡，作为闪烁的根治手段。

**非目标**：

- 不新增适配器 / 不新增 UI 页面 / 不改 manifest 与 14-token 契约。
- 不做像素级还原，不动既有缺陷修正规则内容（`native-defect-fixes.mjs` 语义不变）。
- 不改变 6 个 agent 各自的视觉输出，仅统一“注入与持久化的承担者”。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ **是**。本次收敛直接重构 L3/L4 注入层的**注入通道与持久化承担者**，属 RFC 必须范围。AGENTS.md 黄金规则 #4：注入架构重构需 RFC 评审，非必要不重构；本 RFC 论证其必要（见 §1 症状与下方“为什么必须收敛”），且收敛方案不改 L0-L2、不新增表面功能。
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

> 裁决：提交评审后实施。命中 §6 首项，必须走 RFC 且经评审通过后方可执行；不突破六页封顶 / 六适配器上限。

---

## 3. 现状侦察（代码锚点）

### 3.1 两条注入通道并存

| 维度 | core 运行时（现状主路径） | hardening 引擎（现状兜底+二次注入） |
|------|--------------------------|--------------------------------------|
| 入口 | `theme-apply-flow.ts` → `adapter.applyTheme(bundle,{launch:false})`（L431-443，同步，先执行） | `theme-apply-flow.ts` → `hardeningPass`（L529-534，后台）→ `cdp-fanout.ts` L370-555 |
| 通道 | `<style id="agentskin-theme-style-<agentId>">` DOM 标签（`renderer-payload.mjs` L231/L297） | `document.adoptedStyleSheets` 五层 palette/tokens/cosmetic/theme/custom（`engine-strategy.ts` L253-268，`css-inject.ts` L51-72） |
| 五层注入 | 分步 createStylesheet→injectPalette→injectTokens→injectCosmetic→injectTheme | `injectThemeViaEngine` 一次编排，`injectCssLayer` 逐层 adopt（`css-inject.ts`） |
| 持久化脚本 | session 绑定专用长活会话 `persistenceSessions`（`injector.mjs` L41-62） | tracked ids `persistenceScriptIds`（`engine-strategy.ts` L73/L94-102），apply/reload 前 `removeOldPersistenceScripts`（L81-92） |
| 幂等清理 | `buildClearEngineInjectionExpression` / 同名 style 移除 | adapter `CLEAR_ADAPTERS_BODY` + 禁用标记 `SESSION_DISABLED_KEY` |
| 触发条件 | 每次 apply 无条件执行 | `tryEngineInjection` 有结果则无条件；仅引擎文件缺失才回退 `injectThemeViaCdp`（`cdp-fanout.ts` L448-478） |

### 3.2 二者都写主页面 → 双写达成

`hardeningPass` 遍历全部 DOM-bearing targets（`cdp-fanout.ts` L392/L405）。对 `type:'page'` 主目标，core 已注入 `<style>`，hardening 再把同一 theme CSS 经 adoptedStyleSheets 追加一遍。

### 3.3 现有并发护栏（保留不破坏）

- `applyEpoch`（`bumpEpoch`）+ `applyingTheme` 锁：防**并发** apply 互相覆盖（`theme-apply-flow.ts` L421-422）。
- `waitForTheme` 轮询校验注入是否真正生效（`engine-strategy.ts` L294-298）。

---

## 4. 设计方案

### 4.1 收敛策略：单一 `adoptedStyleSheets` 注入权威

**为什么选 adoptedStyleSheets 而不是 `<style>`**：

- 抗反篡改：绕过 Doubao 等应用对 `<style>` 的 MutationObserver 清除（这正是 hardening 存在的初衷）。
- 无 DOM 标签节点，`adoptedStyleSheets` 顺序即优先级，`replaceSync` 精确注入，独立生命周期。
- 全部 6 个 agent 均为现代 Chromium，`adoptedStyleSheets` 支持无兼容顾虑。

**目标形态**：

```
adapter.applyTheme  （顶层注入，唯一的样式承担者）
   └─ adoptedStyleSheets 五层：palette / tokens / cosmetic / theme / custom  [单一来源]
   └─ 持久化脚本：一套 notification 脚本（新 document 自动重放五层 + adapter.mjs）
hardeningPass       （降级 watchdog）
   └─ 校验已生效？是 → 什么都不做
   └─ 校验失败 / 引擎被清除 → 仅在该 tag 上重注入一次（不重复写主目标）
```

### 4.2 P0：`baseline-truth` 现状固化（文档先行）

按用户既定工作流（先文档后编码），先产出 `docs/baseline-truth.md`（或 RFC 附录）固化：
- 6 个 agent 当前注入通道、`<style>` 标签 ID、adoptedStyleSheets 层命名、持久化脚本标识。
- 当前持有的 `<style>` 清理逻辑、owner-sheet 清理逻辑清单。
- 各 agent 是否依赖 `<style>` 标签 ID 做外部探测（如 `checkThemeHealth` L553 `agentskin-theme-style-*`），收敛后必须更新探测锚点。
- **验收**：文档与 `npm run check` 通过。

### 4.3 P1：core 运行时切到 adoptedStyleSheets（去掉 `<style>` 双轨）

- 将 `injector.mjs` 的注入从 `<style>` 标签改为 `buildAdoptLayerExpression`（复用 `css-inject.ts` L51-72）逐层 adopt。
- adapter.mjs 仍为自包含字符串，通过同一套五层 appliedSheet 执行，不新增 DOM 标签。
- 保留 `buildClearEngineInjectionExpression` 作为唯一清理内核，`<style>` 相关移除逻辑退役。
- **验收**：单个 agent（建议 traework 或 workbuddy）apply 后主页面仅有一套 adoptedStyleSheets 五层，无 `<style>` 标签，样式与收敛前逐属性一致。

### 4.4 P2：持久化合并为一套 ✅（已落地 2026-08-18）

- 统一到**一套** `Page.addScriptToEvaluateOnNewDocument` 注册 + `SESSION_DISABLED_KEY` 禁用标记。
- 删除 core 侧 `persistenceSessions` 与 hardening 侧 `persistenceScriptIds` 双轨中的**重复方**（选择仅在 P0 基线后拍板，默认保留健壮性更强、会话长活的那套，另一套退化为同一共享实现）。
- 复用 `removeOldPersistenceScripts` 的“旧脚本清理”逻辑，保证多次切换不堆积。
- **验收**：apply→reload 自动恢复、remove→reload 不恢复，行为与现状 RFC（`engine-runtime-new-document-persistence`）一致，且目标上仅注册一个脚本。

**P2 决策记录（本节拍板项，对应 RFC §7「人工复核项」第一项）**：

- **保留 core 侧的 `persistenceSessions`（专用长活会话），退役 hardening 侧的 `registerEnginePersistence` / `persistenceScriptIds`。**
- 依据：`Page.addScriptToEvaluateOnNewDocument` 注册是 **session-bound** 的（2026-08-17 实测：关闭注册它的 WebSocket 会话即丢弃注册）。hardening 的持久化脚本注册在**操作作用域、epoch-bound 的会话池**上（`session-pool.ts` `invalidateEpoch` 在每次 apply/restore 边界关闭会话），因此 reload 前该脚本即被丢弃——它从未真正跨导航存活，属于纯重复实现。core 的 `persistenceSessions` 则跨 apply 常驻，manual 测试 `live-reload-persistence.manual.test.ts`（走 core `adapter.applyTheme` 真机链路）已验证 R2 恢复通过。故保留 core，hardening 退役为「仅注入当前 document + 置禁用标记兜底」。
- 变更落点：`engine-strategy.ts` 移除 `persistenceScriptIds`/`registerEnginePersistence`/`removeOldPersistenceScripts`/`trackPersistenceScript`；`removeEngineInjection(session)` 去掉 `agent` 参数与 tracked 移除，保留共享禁用标记 + `buildClearEngineInjectionExpression` 清理；`cleanupEngineInjectionForAgent`/`disposeEngineInjectionState` 转为文档化 no-op（引擎不再持有持久化状态）。core 侧 `injector.mjs` / `renderer-payload.mjs` 不变。
- 副作用说明：P2 落地后，hardening 的五层 injectedStyleSheets + adapter.mjs **不再跨 reload 自恢复**（现状本就如此，因脚本随会话丢弃）；由 P3 降级 watchdog 填补恢复路径。

### 4.5 P3：hardening 降级 watchdog ✅（已落地 2026-08-18）

- `hardeningPass` 对每个主 `page` 目标先跑校验（`verifyTheme`，按 `SHEET_OWNED_FLAG` 计引擎自有 sheet 数）：
  - 校验通过（`adoptedSheetCount > 0`）→ 跳过注入（消除无条件二次写），计入 `watchdog-skip`。
  - 校验失败 / 引擎对应 adoptedStyleSheets 缺失 → 仅对该 tag 用 `tryEngineInjection`（内部即 `injectThemeViaEngine`，自带 adoption 复验）重注入一次，然后回归 watchdog 状态。
- 非 `page` 目标（webview/iframe）**保持每次无条件注入**——core 只覆盖主页面，这些目标没有其它写入方，必须在此 (re)apply。
- `injectThemeViaCdp` 遗留回退保留作为“引擎文件缺失”的最终兜底，不做常态路径。
- **验收**：6 agent 各 apply/restore/reload 全链路校验通过；日志中主目标不再出现“同一 tag 二次注入”，闪烁不再出现。

**P3 变更落点**：`cdp-fanout.ts` `hardeningPass` 每个主 `page` 目标先 `await verifyTheme(session)`，命中即 skip、未命中才走既定注入（engine/legacy）；汇总日志追加 `watchdog-skip=N`。`verifyTheme` 容错（evaluate 失败返回 null → 视为缺失 → 重注入），且会在每次注入内部复验，故无需额外轮询。

**P3 作用域边界（对应 §7 第三项「闪烁是否必须完全无过渡」的工程取舍）**：本阶段实现的是 **apply 流程内的 watchdog**（校验→跳过/重注入），它消除的是「同一次/同一 tag 的重复写入与由此引起的闪烁」。**reload 后 hardening 五层的兜底重注入**需要跨导航触发源——已通过新增 `reload-watchdog.ts`（订阅 `Page.loadEventFired` 的长活事件会话）补齐（见下「reload 导航 watchdog」）。reload 后可见主题由 core 的 `persistenceSessions` 恢复（R2），hardening 层由 reload watchdog 在文档加载后复验缺失时兜底重注入。

**reload 导航 watchdog（跨导航兜底重注入，✅ 已落地 2026-08-18）**：新增 `src/main/cdp/reload-watchdog.ts`，保持目标为**主 page 目标**的长活事件会话订阅 `Page.loadEventFired`（复用 `connectEventCdp` 的 `session-survives-navigation` 性质，与 core 的 persistence 同源）。每次完整文档加载后 debounce（600ms）复验引擎自有 `adoptedStyleSheets`（`SHEET_OWNED_FLAG`，经 `verifyTheme`）：命中即保持待命，未命中则对该 tag 以 `tryEngineInjection` 重注入一次后回归待命。生命周期接线：`hardeningPass` 末尾对主 page 目标 `attachReloadWatchdog`（幂等，同 epoch 刷新 payload、新 epoch 先拆除）；`hardeningRemove` 前置 `detachReloadWatchdog`（remove→reload 保持干净，R4）；`AgentEngineService.dispose` 调用 `disposeReloadWatchdogs`。保费机制：重注入仅当引擎自有 sheet 缺失**且** epoch 仍当前，不触发导航故无重注入死循环，每次导航至多重注入一次。

### 4.6 P4：全量复验与回归

- 6 agent 逐一：apply → validate（色彩 / 语义节点 / 缺陷修正）→ 刷新 reload 自动恢复 → remove → 再 reload 不恢复。
- `npm run check` 全绿（含 C1-C9 不变量）。
- 实测首帧/apply 过程无肉眼闪烁（截图对比 + ΔE 抽查）。
- **验收**：`npm run check` 全绿；P0-P3 验收项全达成。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | 切到 adoptedStyleSheets 后某 agent 反篡改命中（adoptedStyleSheets 被清） | 高 | Doubao/WorkBuddy 类强反篡改运行中 | hardening watchdog 校验失败自动重注入；`CHECK` 兜底触发重注入 | `waitForTheme` + `checkThemeHealth` 轮询 |
| 2 | 持久化合并选错保留方，reload 后主题不恢复 | 高 | P2 拍板时机/条件 | P1 先验证迁通；保留一个持久化脚本；`git revert` P2 单阶段回退 | apply→reload 自动恢复手动 smoke |
| 3 | 收敛初期双轨 + 新单轨过渡窗口有残留 `<style>`/旧脚本 | 中 | P1-P2 迁移中间态 | 统一 `buildClearEngineInjectionExpression` + `CLEAR_ADAPTERS_BODY` 兜底清理 | checkThemeHealth 检测残留 style 标签/脚本数 |
| 4 | 收敛改动触及 12+ 文件引入回归 | 中 | 批量迁移 | P0 文档先行、P1 单 agent 先行；每阶段独立评审/回退；共享函数仅抽取不改语义 | `npm run check` 全绿 + 人工 smoke |
| 5 | `checkThemeHealth` 等外部探测依赖 `<style>` 标签 ID | 中 | P1 移除标签后 | P0 基线把探测锚点一并改为 adoptedStyleSheets 层名探测 | 探测锚点更新后跑 health check |

---

## 6. 分批落地计划

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | 产出 `docs/baseline-truth.md` 现状固化（通道、清理、探测锚点、标签 ID） | 文档 + `npm run check` 绿 |
| **P1** | core 运行时切到 `adoptedStyleSheets`，退役 `<style>` 注入；先行单个 agent 验证 | 主页面仅一套五层 adoptedStyleSheets，样式语义不变 |
| **P2** | 持久化合并为一套脚本 + 禁用标记；删除双持久化路径的一方 | apply→reload 恢复 / remove→reload 不恢复，目标仅一个脚本 |
| **P3** | hardening 降级 watchdog：校验通过则跳过，失败才重注入 | 主目标不再二次注入，闪烁消除 |
| **P4** | 6 agent 全量复验 + `npm run check` + 闪烁实测 | 全绿，验收项全达成 |

每阶段独立评审/回退；P0 先行以最小代价验证可行性，P1 先单 agent 解剖。

---

## 7. 人工复核项

- P2 保留哪一侧持久化实现（core `persistenceSessions` 长活会话 vs hardening tracked ids）——取决于实机 reload 稳定性数据，需评审确认。
- 是否允许在收敛完成后保留 `injectThemeViaCdp` 作为长期 legacy 兜底（推荐保留，作为引擎文件缺失的脆弱路径最终 fallback）。
- 闪烁是否必须做到“完全无过渡”，还是接受单次平滑过渡（adoptedStyleSheets 单写后不存在二次过渡，首帧原生→主题仍是一次切换，需确认可接受）。
- `checkThemeHealth` 探测锚点从 `<style>` 标签 ID 迁移到 adoptedStyleSheets 层名的具体断代方式。

---

## 8. 评审结论

（评审意见汇总，由评审人填写）