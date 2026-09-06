# 审计草案 E — 渲染注入规约缺失与宿主动态变更风险

> **审计范围**: 渲染/注入行为规约（§14）、宿主动态变更场景（§15）  
> **审计日期**: 2026-08-18  
> **审计方法**: 静态代码分析 + 跨模块数据流追踪 + 风险矩阵评估  
> **状态**: 草案，待评审  
> **数据来源**: `src/engine/src/runtime/*.mjs`、`src/main/cdp/baseline-*.ts`、`docs/ARCHITECTURE.md`、`docs/reports/baseline-restore-audit-2026-08-16.md`

---

## 执行摘要

当前 AgentSkin 引擎在渲染/注入环节存在**规约层面的系统性缺失**：允许注入与强制跳过的 DOM 容器清单从未以规约文档形式固化；6 个适配器的语义控制配置覆盖率仅 2/6（traework、codex 有 partial 配置，其余 4 个完全缺失）；运行时探针（probe）、语义签名（semantic signature）、verify-style трёх 联机制在宿主动态改写 `:root` CSS 变量时缺少协同协议。

核心风险：**当宿主应用切换明暗模式或内置主题时，引擎无法区分"宿主原生 token 已漂移"与"主题注入失效"**，导致 verify-style 误报语义漂移（false positive），或更糟——静默接受一次注入失败而不报警。

| 发现编号 | 发现名称 | 风险等级 | 影响面 |
|----------|----------|----------|--------|
| E-01 | 允许/跳过容器清单缺失 | P1-架构性 | 6 Agent 统一影响 |
| E-02 | 透明处理 vs 过滤跳过 Condition 未文档化 | P1-正确性 | 语义过滤层 |
| E-03 | verify-style 无法区分"应跳过"与"修改失败" | P1-正确性 | 质量门禁 |
| E-04 | 宿主动态改写 CSS 变量时无 Probe-Semantic-Verify 协同协议 | P0-致命 | 运行时正确性 |
| E-05 | 基线快照不刷新导致比对误报 | P0-致命 | 基准复刻 |
| E-06 | 6 Agent 语义控制配置缺口不均 | P1-架构性 | 4 Agent 过度渲染 |

---

## §14. 渲染/注入行为规约缺失

### 14(a). 允许注入与强制跳过容器清单 —— 现状与缺口

#### 当前引擎实际执行的"注入/跳过"决策点

经代码审计，当前引擎的注入/跳过决策分散在以下三处：

**1. `selectivity-registry.mjs` —— 语义注册表（结构性白名单）**

仅定义 6 个 Agent 的 root / sidebar / workspace / composer / toolbar / messageList 等**一级语义容器**。每个容器有 `selectors`（fallback 链）、`required`、`semantic`（可选控制配置）。

**2. `semantic-filter.mjs` —— 语义过滤层（排除性标记）**

- `collectNonControlledSelectors(agentId)`: 收集 `semantic.nonControlled` 数组
- `buildExclusionSelectors()`: 为每个 nonControlled 选择器追加 `:not(.agentskin-non-controlled)`
- `buildSemanticMarkExpression()`: 运行时 DOM 标记表达式
- `NON_CONTROLLED_CLASS = "agentskin-non-controlled"` —— 标记锚点

**3. `renderer-payload.mjs` —— MutationObserver 排除集（运行时过滤）**

```javascript
exclusionSelectors = [
  '[data-agentskin-baseline]',
  '#agentskin-' + host.id + '-skin-chrome',
  '.' + nonControlledClass,
  '[data-agentskin-punched]',
  '[aria-hidden="true"]',
];
```

#### 缺失规约：完整的容器分类清单

当前**不存在**一份明确文档化的"允许注入 / 强制跳过 / 条件允许"三维分类。以下是基于代码反推的**实际行为**与**应有规约**的差距：

| 容器类型 | 当前状态 | 应有规约 | 缺口 |
|----------|----------|----------|------|
| **Tooltip**（`[role="tooltip"]`、`.ant-tooltip`、`.ant-popover` 等） | 未声明；依赖宿主自然不被主题选择器命中 | 强制跳过 —— 浮动提示层不应被主题覆盖 | 宿主若用全局变量驱动 tooltip 色值，主题注入会污染 |
| **Toast / Notification**（`[role="alert"]`、`.ant-notification`） | 未声明 | 强制跳过 —— 系统级通知 | 同上 |
| **下拉悬浮框 / Popover / Dropdown Menu** | 未声明 | 强制跳过 —— 临时浮动层 | 同上 |
| **滚动条**（::-webkit-scrollbar） | 由 `cosmetic.css` 主动渲染 | 允许注入 —— 主题化滚动条 | 已有实践，但无规约 |
| **iframe** | 未声明；CDP pierce=false 默认不进入 | 强制跳过 —— 跨源 iframe 不可控 | 同文档 iframe 可能被误渲染 |
| **原生控件**（`<input type="range">`、`<select>`、`<details>`） | 未声明 | 强制跳过 —— 操作系统级控件 | 主题注入可能破坏原生外观 |
| **Shadow DOM（open）** | 未声明；CSS 变量可穿透 open shadow root | 条件允许 —— 仅当 shadow host 受控时注入 | closed shadow root 不可穿透 |
| **Shadow DOM（closed）** | 未声明 | 强制跳过 —— 无法访问 | 当前无检测机制 |
| **宿主装饰性全屏层**（`.hero-bg`、`.ambient-glow`） | `[data-agentskin-punched]` 标记跳过 | 条件允许 —— 需显式 punch-through | 已有实践 |
| **聊天内容区白色卡片 / 代码块** | 未声明 | 条件允许 —— 仅渲染外层容器，不覆盖内容卡片 | `data-agentskin-punched` 部分覆盖 |

#### 6 Agent 语义控制配置缺口

| Agent | 有 semantic 配置 | nonControlled 子节点 | 缺口描述 |
|-------|------------------|----------------------|----------|
| **traework** | sidebar（partial） | `.task-list-divider`、`.collapse-toggle-icon` | workspace/composer/toolbar 无配置 |
| **codex** | composer（partial） | `[contenteditable]`、`textarea`、`button`、`[role='button']` | sidebar/workspace 无配置 |
| **workbuddy** | 无 | —— | 全部节点默认 `controlled=true` |
| **doubao** | 无 | —— | 全部节点默认 `controlled=true` |
| **qoderwork** | 无 | —— | 全部节点默认 `controlled=true` |
| **zcode** | 无 | —— | 全部节点默认 `controlled=true` |

**关键发现**：`isNativeThemeControlled()` 在无 `semantic` 配置时**默认返回 true**（`selectivity-registry.mjs:514-518`）。这意味着 4 个 Agent 的所有节点都被视为"受控"，主题 CSS 会覆盖这些节点——与审计 §1.2 中 CV-01（doubao 全局文本暴力继承）直接相关。

---

### 14(b). 透明处理 / 过滤跳过 / 高级视觉效果 —— 条件规则未文档化

当前三种处理模式的**实际触发条件**（反推自代码）：

#### 模式 1：CSS 变量桥接（Bridge）—— "透明处理"

**触发条件**：适配器定义了 `bridge` 数组（`adapter.bridge`），在 `buildApplyExpression` 中经 `compileBridge()` + `wrapBridgeRule()` 编译为 `html.agentskin-host-{id}:root { --native-var: var(--agentskin-role) !important; }`。

**实际行为**：宿主 CSS 规则和 JS `getComputedStyle()` 读取原生变量时，解析到 AgentSkin token 值。

**缺失规约**：
- 桥接优先级与 `!important` 覆盖的边界条件未文档化
- 宿主 JS 在读取变量后做数值运算（如 `parseFloat(getPropertyValue('--cb-bg-primary')) + 10`）的场景未覆盖
- 桥接变量与主题 token 的 alpha 混合（`color-mix`）公式未标准化

#### 模式 2：`:not()` 排除 + class 标记 —— "过滤跳过"

**触发条件**：`semantic.nonControlled` 数组非空 → `buildSemanticMarkExpression()` 在运行时标记 `agentskin-non-controlled` class → 主题 CSS 选择器追加 `:not(.agentskin-non-controlled)`。

**实际行为**：被标记节点不参与主题色值渲染。

**缺失规约**：
- 标记的**生命周期**未定义：节点从 DOM 移除后重新创建（如虚拟滚动），是否自动重新标记？当前 `ensure()` 每次执行 `markNonControlled()`，但仅在 MutationObserver 触发后 120ms debounce 执行
- 标记与 `data-agentskin-punched` 的关系未文档化：两者都导致跳过，但 punch-through 是"允许宿主样式穿透"，nonControlled 是"完全不渲染"——语义不同但效果可能重叠

#### 模式 3：Renderer Profile —— "高级视觉效果"

**触发条件**：`targetTheme.options.rendererProfile` 非空 → `resolveRendererProfile()` 查找 `adapter.rendererProfiles[profileId]`。

**实际行为**：调用 `profile.runtime({ theme, imageDataUrls, ... })` 返回 `profileRuntime`，其 `ensure()` 和 `cleanup()` 由注入循环管理。

**缺失规约**：
- Profile 的**能力边界**未文档化：profile 能做什么、不能做什么？
- 多个 profile 的**组合规则**未定义
- Profile 与 bridge、nonControlled 的**交互优先级**未定义

#### 隐式行为汇总

以上三种模式的触发条件、优先级、交互规则**全部是隐式行为**——散落在 `renderer-payload.mjs`、`semantic-filter.mjs`、`css-var-bridge.mjs` 的实现代码中，没有一份规约文档定义：

1. 什么条件下对节点做桥接而非直接覆盖
2. 什么条件下标记 nonControlled 而非依赖 CSS 选择器自然不命中
3. 什么条件下启用 renderer profile 而非纯 CSS 注入
4. 三者同时适用时的优先级顺序

---

### 14(c). verify-style 如何区分"应跳过"与"修改失败"

#### 当前 verify-style 的判定逻辑

`buildStyleSamplingSnippet()`（`renderer-payload.mjs:449-497`）的采样流程：

1. 列出所有 `isNativeThemeControlled(adapter.id, name) === true` 的语义节点
2. 对每个节点调用 `visibleSample(selectors)` 取第一个可见匹配的计算样式
3. 以 `assessStyleCompliance(samples, tokens, { tolerance: 0.08, minRatio: 1 })` 判定

**关键问题**：`isNativeThemeControlled()` 默认返回 `true`，因此：

- 对于**无 semantic 配置的 4 个 Agent**（workbuddy、doubao、qoderwork、zcode），所有节点都参与样式判定
- 若某节点**本应跳过**（如内部 input、装饰性分隔线），但因未配置 `nonControlled` 而被纳入采样，其计算样式自然**不匹配**主题 token
- `assessStyleCompliance` 返回 `pass: false`，`styleDrift: true`——但引擎无法区分这是"主题注入失败"还是"该节点本就应跳过"

#### 每 Agent 单独调整的支持情况

| 能力 | 当前状态 | 缺口 |
|------|----------|------|
| 每 Agent 独立配置 `semantic.controlled` | 支持（`selectivity-registry.mjs` 按 agentId 分键） | 仅 2/6 Agent 有配置 |
| 每 Agent 独立配置 `nonControlled` 子节点 | 支持 | 仅 2/6 Agent 有配置 |
| 每 Agent 独立 tolerance/minRatio | **不支持** | `assessStyleCompliance` 硬编码 `tolerance: 0.08, minRatio: 1` |
| 每 Agent 独立排除特定语义节点 | **不支持** | `buildStyleSamplingSnippet` 只排除 `controlled=false` 的节点 |
| 每 Agent 独立定义"应跳过"规则 | **不支持** | 无 per-Agent skip-pattern 配置层 |

---

## §15. 宿主动态变更场景

### 15(a). 宿主运行时 JS 动态改写 `:root` CSS 变量 —— 当前处理流程

#### 场景描述

宿主应用（6 个 Agent）在用户切换明暗模式、切换内置主题时，会通过 JS 动态改写 `:root` 上的 CSS 变量：

- **traework**（VS Code 内核）：切换 `workbench.colorTheme` → 批量重写 `--vscode-*` 变量
- **codex**（ChatGPT 桌面端）：切换亮/暗模式 → 重写 `--text-*` / `--bg-*` 变量
- **workbuddy**：切换主题 → 重写 `--cb-*` 变量
- **doubao**：切换主题 → 重写 `--semi-color-*` / `--dbx-*` 变量
- **qoderwork**：切换主题 → 重写 `--color-*` 变量
- **zcode**：切换主题 → 重写 `--color-*` 变量

#### 当前引擎对这类变更的响应链

```
宿主 JS 改写 :root 变量
  │
  ├─→ [路径 A] MutationObserver 触发
  │     AdaptiveMutationObserver._handleMutations()
  │       → isExcludedNode() 检查
  │       → 若非排除节点 → 120ms debounce → ensure()
  │       → ensure() 重新注入 theme <style>（但 CSS 变量值不变）
  │
  ├─→ [路径 B] 5s setInterval 轮询
  │     → 检查 style 元素是否存在 → 存在则跳过
  │     → 不检测 CSS 变量值是否变化
  │
  ├─→ [路径 C] CSS 变量桥接（仅已桥接变量）
  │     → 宿主读取 --native-var 时解析到 var(--agentskin-role)
  │     → 若 AgentSkin 主题未变，桥接值不变
  │     → 若宿主切换了主题模式但 AgentSkin 未重新 apply，桥接值与宿主预期不一致
  │
  └─→ [路径 D] verify-style 校验
        → 采样计算样式 vs 当前主题 token
        → 宿主切换后，计算样式反映新宿主主题，与旧 AgentSkin token 不匹配
        → 返回 styleDrift: true（误报）
```

#### 缺失协同协议

**当前不存在**以下任何机制：

1. **宿主变更检测器**：没有 `MutationObserver` 专门监听 `:root` 的 `style` 属性变化（`attributeFilter: ['style']`）
2. **基线自动失效**：`BaselineStore.invalidate()` 需要外部调用，没有与宿主主题切换事件联动
3. **语义签名重算**：`semanticNodes` 的 `isNativeThemeControlled` 判定依赖 baseline 快照，但 baseline 不自动重采
4. **verify-style 误报抑制**：没有"已知宿主变更中"的标志位来临时放宽或跳过样式比对

#### `baseline-validator.ts` 的 `validateBaselineCss` 行为

`validateBaselineCss()` 在**每次自定义主题加载前**执行一次：

1. `probeNativeBaseline(session)` —— 探针当前页面（原生状态）
2. `replayBaseline(session, capture)` —— 回注采集到的原生规则
3. 再次探针
4. `assessFidelity(baseline, replayed, opts)` —— 判定还原度
5. `finally { stopReplay(session) }` —— 撤销回注

**关键限制**：这是一次性校验，不订阅宿主的后续变更。一旦校验通过并加载了自定义主题，引擎**不再监控**宿主是否改写了 `:root` 变量。

#### `renderer-payload.mjs` 中无 `watchTheme` 机制

代码搜索确认：`renderer-payload.mjs` 中不存在 `watchTheme` 函数或类似命名的导出。运行时对宿主主题切换的响应完全依赖通用的 `AdaptiveMutationObserver` + 5s `setInterval`，两者都不感知 CSS 变量值的变化。

---

### 15(b). 不刷新基线导致误报的规避方案推演

#### 问题形式化

设：
- $B_0$ = 宿主亮色模式下的基线快照（`themeMode: "light"`）
- $B_1$ = 宿主暗色模式下的基线快照（`themeMode: "dark"`）
- $T$ = 当前 AgentSkin 自定义主题 token
- $S$ = verify-style 采样结果

当宿主从亮色切换到暗色时：
- 若引擎仍持有 $B_0$ 且未采集 $B_1$：$S$ 反映暗色计算样式，与 $T$（基于 $B_0$ 的映射）不匹配 → **误报**
- 若 verify-style 的 `style-not-present` 分支被触发（style 元素被宿主移除）：返回 `pass: true` → **漏报**

#### 方案推演

| 方案 | 描述 | 复杂度 | 收益 | 风险 |
|------|------|--------|------|------|
| **A. 宿主变更事件订阅** | 通过 CDP `MutationObserver` 监听 `:root` style 属性变化，检测 CSS 变量值变化 → 触发基线重采 | 中 | 根治 | 性能开销；需区分 AgentSkin 自身变更与宿主变更 |
| **B. 双基线缓存** | 始终同时持有亮/暗两份基线快照，verify-style 时根据当前 `prefers-color-scheme` 选择比对基准 | 低 | 覆盖 80% 场景 | 宿主内置主题不止亮/暗两套时不覆盖 |
| **C. 桥接层自感知** | CSS 变量桥接层增加"当前实际值"读取能力，当检测到桥接变量值与预期不符时触发重注入 | 中 | 精准 | 仅覆盖已桥接变量 |
| **D. verify-style 增加"宿主变更中"标志** | 当检测到 `:root` style 属性变化时，设置 `hostMutating=true`，期间 verify-style 返回 `pass: true, reason: 'host-mutating'` | 低 | 消除误报 | 可能掩盖真实注入失败 |
| **E. 完全放弃运行时 verify** | 仅在注入瞬间做一次 verify，后续不再校验 | 低 | 简单 | 丧失运行时保护 |

#### 推荐方案

**短期（P1）**：方案 D + 方案 B 组合——双基线缓存覆盖明暗切换，"宿主变更中"标志消除切换瞬态误报。

**中期（P2）**：方案 A + 方案 C 组合——宿主变更事件订阅驱动基线重采，桥接层自感知驱动精准重注入。

---

## 风险矩阵

| 编号 | 发现 | 概率 | 影响 | 风险等级 | 检测难度 |
|------|------|------|------|----------|----------|
| E-01 | 允许/跳过容器清单缺失 | 确定 | 中 | **P1-架构性** | 低 |
| E-02 | 透明/跳过/高级效果 Condition 未文档化 | 确定 | 中 | **P1-正确性** | 中 |
| E-03 | verify-style 无法区分"应跳过"与"修改失败" | 高 | 高 | **P1-正确性** | 高 |
| E-04 | 宿主动态改写 CSS 变量无协同协议 | 高 | 高 | **P0-致命** | 高 |
| E-05 | 基线快照不刷新导致比对误报 | 高 | 高 | **P0-致命** | 中 |
| E-06 | 6 Agent 语义控制配置缺口不均 | 确定 | 中 | **P1-架构性** | 低 |

---

## 6 Agent 差异化跳过规则缺口

### 缺口对比矩阵

| 跳过规则维度 | traework | codex | workbuddy | doubao | qoderwork | zcode |
|-------------|----------|-------|-----------|--------|-----------|-------|
| 侧边栏内部分隔线 | 已配置 | N/A | 未配置 | 未配置 | 未配置 | 未配置 |
| 侧边栏折叠图标 | 已配置 | N/A | 未配置 | 未配置 | 未配置 | 未配置 |
| 输入框内部 editable | N/A | 已配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| 输入框内部 button | N/A | 已配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| Tooltip / Popover | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| Toast / Alert | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| 滚动条 | cosmetic 处理 | cosmetic 处理 | cosmetic 处理 | cosmetic 处理 | cosmetic 处理 | cosmetic 处理 |
| iframe | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| Shadow DOM | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| 原生控件 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 | 未配置 |
| 装饰性全屏层 | punched | punched | punched | punched | punched | punched |

### 差异化缺口分析

1. **traework**：侧边栏有 partial 配置，但 workspace/composer/toolbar 完全缺失。VS Code 内核的 `--vscode-*` 变量族庞大，桥接覆盖不全时易产生"部分变量已桥接、部分未桥接"的中间状态。

2. **codex**：composer 有配置，但 sidebar/workspace 缺失。ChatGPT 桌面端更新频繁（审计 §4.2 S5），hash 类名变化可能导致 fallback 链命中非预期节点。

3. **workbuddy**：完全无 semantic 配置。`--cb-*` 变量族与 VSCode 变量并存，bridge 配置若覆盖不全，verify-style 会将"未桥接变量导致的样式不匹配"误判为注入失败。

4. **doubao**：完全无 semantic 配置。审计 §1.2 CV-01 已确认存在"全局文本颜色暴力继承"问题——根因正是 `isNativeThemeControlled` 默认 true 导致所有节点（包括不应渲染的文本节点）被主题覆盖。

5. **qoderwork**：完全无 semantic 配置。header 通配复合选择器过度命中（CV-02）是已知问题。

6. **zcode**：完全无 semantic 配置。`aside, nav` 全局选择器（CV-06）和输入框未限定域（CV-07）是已知问题。

---

## 规约缺失清单（汇总）

| 编号 | 缺失规约 | 影响模块 | 优先级 |
|------|----------|----------|--------|
| R-01 | DOM 容器注入/跳过三维分类规约（允许 / 强制跳过 / 条件允许） | selectivity-registry, semantic-filter | P0 |
| R-02 | 透明处理（Bridge）触发条件与边界规约 | css-var-bridge, renderer-payload | P1 |
| R-03 | 过滤跳过（nonControlled）生命周期与重标记规约 | semantic-filter, renderer-payload | P1 |
| R-04 | Renderer Profile 能力边界与组合规约 | renderer-payload | P2 |
| R-05 | 三种模式交互优先级规约 | 跨模块 | P1 |
| R-06 | verify-style "应跳过" vs "修改失败" 区分规约 | verify-style, renderer-payload | P0 |
| R-07 | 宿主动态变更检测与响应协同协议 | renderer-payload, baseline-validator | P0 |
| R-08 | 基线快照与宿主主题模式联动失效规约 | baseline-snapshot, baseline-gate | P0 |
| R-09 | 6 Agent 统一语义控制配置规范 | selectivity-registry | P1 |
| R-10 | per-Agent verify-style tolerance 配置规约 | verify-style | P2 |

---

## 方案推演

### 方案 A：文档先行 + 最小代码变更

**描述**：先编写《渲染注入行为规约》文档（`docs/specs/injection-behavior-spec.md`），明确上述 R-01~R-10。代码层面仅补全 4 个 Agent 的 `semantic` 配置。

**优点**：风险最低，不改架构。
**缺点**：不解决宿主动态变更的运行时检测问题。

### 方案 B：运行时感知 + 双基线

**描述**：在方案 A 基础上，增加 `:root` style 属性 MutationObserver 检测宿主变更，实现双基线缓存（亮/暗各一份），verify-style 根据当前模式选择比对基准。

**优点**：覆盖 80% 宿主变更场景。
**缺点**：宿主内置主题不止亮/暗两套时不覆盖。

### 方案 C：全链路协同协议

**描述**：在方案 B 基础上，建立 Probe → Semantic → Verify 三方协同协议：
- Probe 检测到宿主变更 → 发布 `host-theme-mutating` 事件
- Semantic 层暂停标记 → 等待重采完成
- Verify 层返回 `host-mutating` 中性结果 → 不阻断也不放行

**优点**：根治运行时误报。
**缺点**：架构改动大，需 RFC 评审。

### 推荐

**短期执行方案 A + 方案 B 的文档部分**（本次审计的输出即第一步），**中期执行方案 B 的代码部分**，**长期执行方案 C**（需独立 RFC）。

---

## 附录：关键代码引用索引

| 文件 | 关键函数/行 | 用途 |
|------|-------------|------|
| `src/engine/src/runtime/selectivity-registry.mjs:514-518` | `isNativeThemeControlled()` | 默认 true 的判定逻辑 |
| `src/engine/src/runtime/selectivity-registry.mjs:532-545` | `collectNonControlledTopology()` | 收集 nonControlled 拓扑 |
| `src/engine/src/runtime/semantic-filter.mjs:41-54` | `collectNonControlledSelectors()` | 收集 nonControlled 选择器 |
| `src/engine/src/runtime/semantic-filter.mjs:67-71` | `buildExclusionSelectors()` | 构建排除选择器 |
| `src/engine/src/runtime/renderer-payload.mjs:265-271` | `exclusionSelectors` | MutationObserver 排除集 |
| `src/engine/src/runtime/renderer-payload.mjs:281-307` | `ensure()` | 注入确保逻辑 |
| `src/engine/src/runtime/renderer-payload.mjs:310-317` | `AdaptiveMutationObserver` 回调 | 自愈循环 |
| `src/engine/src/runtime/renderer-payload.mjs:449-497` | `buildStyleSamplingSnippet()` | verify-style 采样 |
| `src/engine/src/runtime/verify-style.mjs:132-166` | `assessStyleCompliance()` | 样式合规判定 |
| `src/engine/src/runtime/css-var-bridge.mjs:91-101` | `compileBridge()` | 桥接编译 |
| `src/engine/src/runtime/baseline-snapshot.mjs:84-93` | `isBaselineValid()` | 基线有效性判定 |
| `src/main/cdp/baseline-validator.ts:254-293` | `validateBaselineCss()` | 基准复刻校验编排 |
| `src/main/cdp/baseline-gate.ts:89-121` | `assessBaselineGate()` | 复刻校验 Gate 判定 |
| `src/main/cdp/baseline-css-capture.ts:170-291` | `captureBaselineCss()` | 基准 CSS 采集 |

---

**文档版本**: 1.0 (草案)  
**审计人**: AgentSkin 审计 Agent  
**下一步**: 提交 RFC 评审，按 P0/P1 分阶段实施规约补全与运行时感知增强
