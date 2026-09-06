# 渲染 / 注入行为规约（Rendering & Injection Behavior Spec）

> 审计项：A-19（审计报告《解包操作与 CDP 探针关联审视报告》Q14 / R-10）
> 状态：已落地。本文档为**唯一的**渲染/注入行为事实来源，代码行为以本规约为准。
> 关联实现：`src/engine/src/runtime/selectivity-registry.mjs` · `semantic-filter.mjs` ·
> `renderer-payload.mjs` · `diagnostics-kill-switch.mjs`

## 1. 目的

将此前**隐式**的渲染/注入判定（哪些节点允许改、哪些跳过、哪些透明处理、如何挂载高级
效果）显式化，供全部 6 适配器（codex / doubao / workbuddy / qoderwork / traework / zcode）
共享，并作为 verify-style 区分"应当跳过"与"主题失效"的依据。

核心不变量：**只动"受控语义节点"，其余一律不碰**。语义过滤不是可选优化，而是**正确性的
硬门槛**——无配置的 Agent 不得全量默认受控（见 §2）。

---

## 2. 三层判定体系

对任意 DOM 元素，注入前按以下顺序判定归属。优先级从高到低：**排除 → 非受控 → 受控**。

| 层 | 判定 | 结果 | 代码依据 |
|----|------|------|---------|
| ① 排除集 | 命中 Observer 排除选择器 | **永不改**（连内部子级也不监听） | `buildApplyExpression` 的 `EXCLUSION` 集（见 §3） |
| ② 非受控 | 命中 `semantic.nonControlled` 子选择器或根 | **主题跳过**，但运行时打 `agentskin-non-controlled` 标记 | `semantic-filter.mjs` `collectNonControlledSelectors` |
| ③ 受控 | `isNativeThemeControlled(agentId, semanticName)` 为真 | **主题可挂载**；采样优先取 `controllingSelector` | `selectivity-registry.mjs` |

> **A-01 校正**：`isNativeThemeControlled` 对**未登记** Agent **不得**默认返回 `true`。
> 无 semantic 配置的 Agent，其节点不得被全量视为受控（否则 verify-style 会将合法差异
> 全判为漂移）。回归历史 bug：workbuddy/doubao/qoderwork/zcode 曾因缺配置被 100% 误报。

---

## 3. 排除集（Observer 永不触碰）

`renderer-payload.mjs` 的 AdaptiveMutationObserver 从监听中排除以下容器及其内部，防止
引擎自我循环、宿主骨架被误动：

```
[data-agentskin-baseline]   —— 已打标的基线层
skin-chrome                 —— AgentSkin 自身 UI 骨架
agentskin-non-controlled    —— 已标记的非受控节点（见 §2 ②）
[data-agentskin-punched]    —— 已穿透禁止再动的区域
[aria-hidden="true"]        —— 无障碍隐藏节点（通常非主题目标）
```

以上集合由 `getExclusionSelector()` 产出并内嵌进每个 apply/persistence 表达式。

---

## 4. 允许 / 跳过 / 透明处理

### 4.1 允许（受控语义节点挂载主题）

- 仅登记于 `SELECTOR_REGISTRIES` 且 `semantic.nonControlled` 之外的语义节点。
- 若组件声明 `controllingSelector`（独立受控壳体），主题与其采样**优先命中壳体**，
  而非 fallback 链首项（首项可能是输入框/按钮等非受控锚点）。
- 典型场景：codex composer 用 `.composer-surface-chrome` 壳体承载主题。

### 4.2 跳过（非受控子选择器）

- 输入/按钮/分隔线/提示框等内层控件：选择器命中但属于 `nonControlled` → 主题不覆盖，
  运行时标记 `agentskin-non-controlled`，并被 observer 排除集与 verify-style 采样共同剔除。
- **编码约定**：新增受控组件必须在 adapter 配 semantic；缺配的 Agent 视为全部跳过
  （延续 A-01/A-03 语义）。

### 4.3 透明/不采样

- 根节点 `--agentskin-*` 背景归「艺术层」（hero/wallpaper）→ 不作为受控比对对象
  （verify-style 对 root 背景透明不判漂移）。
- zcode 的 `--color-background / --color-surface / --bg-primary / --bg-base / --bg-canvas`
  等 **art 透明变量不进 bridge**，避免冲掉 hero/壁纸展示（桥接层的刻意留空）。

---

## 5. 样式采样（verify-style 诊断，非硬门禁）

- `buildStyleSamplingSnippet` 只采样「受控壳体」与根节点，剔除命中 nonControlled 的锚点
  （A-03）。
- `styleSampling.pass` 仅作为 `styleDrift` 诊断输出，**不参与 `result.pass`**（合法透明 /
  currentColor 不误拦正常应用）。
- per-Agent 预算：`resolveStyleSamplingOpts(adapter.id)`（默认 tolerance=0.08，
  minRatio=0.85，A-02），可从 `STYLE_SAMPLING_POLICY` 收紧。

---

## 6. 诊断开关（A-18 kill-switch）

- `DIAGNOSTICS_KILL_SWITCH`（`diagnostics-kill-switch.mjs`）按 Agent（或 feature）关闭
  不稳定诊断，如 `styleSampling`。关闭后该 Agent 产出中性 pass（`reason:
  'diagnostics-kill-switched'`）。
- 影响范围**仅诊断**，不触碰注入主流程。任何写入须带注释（谁/何时/为何）。

---

## 7. 桥接层（bridge 约定）

- adapter 声明 `bridge[]`，由 `compileBridge` 编译为
  `html.agentskin-host-<id>:root` 规则，把宿主原生 CSS 变量映射到 `--agentskin-*`
  （text/surface/accent/border…）。
- `alpha < 1` 用 `color-mix(in srgb, var(--agentskin-<role>) <pct>%, transparent)` 表达透
  明度，对齐 tokens.css。
- 无 bridge / 空 bridge 的 adapter 不追加 `<:root>` 桥接规则。

---

## 8. 持久化与移除（P1/P2/P3 语义）

- 应用：`buildPersistenceScript` + `Page.addScriptToEvaluateOnNewDocument`（长会话
  `persistenceSessions`）→ **apply 后 reload 自动恢复**。
- 移除：`removeTheme` 写入 sessionStorage 禁用标记 → **R4 remove + reload 不再恢复**。
- 幂等：apply body 内 `ensure()` 在 `<style>` 已存在时跳过，重复执行不叠加。

---

## 9. 回归与验收（对应审计 A-20 → `scripts/regression-runner.mjs`）

| 检查 | 命令 | 通过标准 |
|------|------|---------|
| 全局 | `npm run check` | 全绿（2820+ 通过，3 手动跳过） |
| 语义契约 | `npm run check:semantic-contract` | 无 violation，exit 0 |
| 批量回归 | `npm run regression` | 各 Agent 阶段通过数、隔离失败、聚合报告 |
| 结构对比 | `npm run analyze:structure` | 见 analyze-structure-compare 输出 |

---

*本文档随代码同步维护。修改渲染/注入判定行为时，应先更新本规约再改代码。*