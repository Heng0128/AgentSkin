# 审计交叉校验修补分析（3 核心矛盾重新推演）

> **分析人**: AgentSkin 审计质量修补专家  
> **日期**: 2026-08-19  
> **输入**: audit-draft-A/B/C/D/E/F + audit-cross-validation-1/2  
> **方法**: 代码实证 + 量化推演 + 统一框架重新标定  
> **约束**: 仅做分析，不修改任何代码  

---

## 导言：本次修补分析的范围

交叉校验报告 #1 发现 3 个致命/显著矛盾（R-1/R-2/R-3），均需打回重推演。本报告对每个矛盾执行以下流程：

1. **代码证据引用**：直接读取源文件，验证事实陈述的真伪
2. **统一框架定义**：建立一致的风险分级框架
3. **重新标定结论**：基于证据给出修正后的等级
4. **对原草稿的修订建议**：明确指出各草稿需修正的具体陈述

---

## 矛盾 1：extract↔builder 管道存在性

### 1.1 矛盾陈述

| 草稿 | 陈述 | 等级 |
|------|------|------|
| **D §10(b) G10.2** | "extract 与 builder 之间不存在数据流管道——两者是独立的离线工具，共享的唯一桥梁是人工维护" | MEDIUM |
| **F §4.2(b)** | "残缺探测产物写入主题包的路径防护"——追踪 `cdp-full-extract → sync-remap → build-theme-package` 污染路径 | P0 |
| **F §1 拓扑图** | 文字拓扑中明确画出 `cdp-full-extract.mjs → <agent>-full-extract.json → sync-remap-from-extract → 语义基线采集 → baseline-validator.ts` | — |

### 1.2 代码证据

#### 证据 A：`build-theme-package.mjs` 的输入来源（L6-8 JSDoc）

```js
/**
 * Receives a {@link ThemeStudioExportRequest}-shaped payload from the renderer
 * (via `studio:export`) and writes a directory-based `.agentskin-theme` package
 */
```

**结论**：输入来自渲染进程 IPC（`studio:export`），**不是** cdp-full-extract 的输出文件。

#### 证据 B：`buildThemePackage()` 入口签名（L723-727）

```js
export async function buildThemePackage(request, outDir) {
  const agentId = String(request?.agentId || 'traework');
  const palette = deriveTokens(request?.root);
  const manifest = buildManifest(request, agentId, palette);
  const css = buildAgentCss(agentId, palette, request?.signature);
```

**结论**：函数读取 `request.agentId`、`request.root`、`request.signature`、`request.meta`——全部来自 `ThemeStudioExportRequest` IPC 载荷。**无任何文件 I/O 读取 extract JSON**。

#### 证据 C：`deriveTokens()` 的数据消费路径（L417-425）

```js
export function deriveTokens(root) {
  const tokens = { ...DEFAULT_TOKENS };
  if (root && typeof root === 'object') {
    for (const [k, val] of Object.entries(root)) {
      if (typeof k === 'string' && k.startsWith('--agentskin-') && typeof val === 'string') {
        tokens[k] = val;
      }
    }
  }
```

**结论**：仅消费 `root` 对象中 `--agentskin-*` 前缀的键值对。**不读取任何外部 JSON 文件**。

#### 证据 D：`AGENT_REMAP` 是硬编码常量（L69-191）

5 个 agent 的 remap 列表全部手写常量，不依赖运行时提取。

#### 证据 E：`sync-remap-from-extract` 文件不存在

```
glob_file_search("**/sync-remap*") → 0 files found
glob_file_search("**/extract-validate*") → 0 files found
```

**结论**：F 草稿中反复引用的 `sync-remap-from-extract` 和 `extract-validate.mjs` **在当前代码库中不存在**。F 的 P0 分析基于一个虚构的管道。

#### 证据 F：CLI 测试入口（L744-757）

```js
const dir = await buildThemePackage(
  {
    agentId: 'workbuddy',
    meta: { name: 'CLI Test', author: 'tester' },
    root: {},
    signature: { radius: '14px', shadowLevel: 'md' },
  },
  out,
);
```

**结论**：即使 CLI 测试也直接传入 `root: {}`，不读取任何 extract JSON。

### 1.3 事实判定

| 事实陈述 | 真伪 | 证据 |
|---------|------|------|
| "extract 与 builder 之间存在自动数据流管道" | **伪** | 证据 A/B/C/E/F |
| "残缺探测产物可写入主题包" | **伪**（当前代码） | 证据 B/C — deriveTokens 仅消费 IPC 载荷中的 `--agentskin-*` 键 |
| "sync-remap-from-extract 是污染路径中间件" | **伪** | 证据 E — 文件不存在 |
| "两者是独立的离线工具，共享桥梁是人工维护" | **真** | 证据 A/B/C/D |

### 1.4 重新标定

#### D 草稿 G10.2 的等级修正

D 的事实陈述**正确**，但等级 MEDIUM **偏低**。理由：

- D 将风险定义为"人工跨 Agent 复制粘贴错配"
- 但实际风险有两层：
  1. **人工维护错配**（D 所述）→ MEDIUM（可接受）
  2. **DEFAULT_TOKENS 回退掩蔽**（F §4.2(b) 所述，但根因不同）→ P1（见下文）

#### F 草稿 P0 的等级修正

F 的 P0 基于"残缺探测产物写入主题包路径"，但此路径**不存在**。然而，F 指出的 `DEFAULT_TOKENS` 回退掩蔽问题**确实存在**，只是根因不是 extract 污染，而是：

- **根因**：Studio 用户在 Theme Studio 中设计主题时，若未完整填写所有 `--agentskin-*` token，`deriveTokens()` 会回退到 `DEFAULT_TOKENS` 的紫色系硬编码值（L38-53 + L418 `const tokens = { ...DEFAULT_TOKENS }`）
- **后果**：产出的 theme CSS 中 `--agentskin-accent: #9d8bff` 等默认值覆盖了用户意图，但 Studio 不会报错
- **与 extract 的关系**：**无关**。这是 Studio UX 问题，不是 extract 污染问题

**修正后等级**：P1（质量风险，不阻断加载但导致用户主题偏差）

### 1.5 修订建议

| 草稿 | 需修订的陈述 | 修订方向 |
|------|------------|---------|
| **F §1 拓扑图** | `sync-remap-from-extract` 节点 | 删除该节点（文件不存在）；标注 `extract-validate.mjs` 为"建议新增"而非"当前缺失" |
| **F §4.2(b)** | "残缺探测产物写入主题包路径" | 重写为"Studio 用户不完整 token 输入 + DEFAULT_TOKENS 回退掩蔽"；等级从 P0 降为 P1 |
| **F §5.1 F1** | "cdp-full-extract 总节点缺失无下限闸，残缺快照可被下游消费" | 明确下游消费者是"人工或脚本"而非 build-theme-package；等级从 P0 降为 P1 |
| **F §5.1 F7** | "build-theme-package DEFAULT_TOKENS 回退掩蔽不完整提取" | 将"不完整提取"改为"不完整 Studio 输入"；等级维持 P1 |
| **D §10(b) G10.2** | 等级 MEDIUM | 可维持，但需补充说明"DEFAULT_TOKENS 回退掩蔽是独立风险，非 extract 污染" |
| **交叉验证 #1 R-1** | "管道存在性致命矛盾" | 裁定：管道不存在，D 正确，F 基于虚构管道；降级为"重要缺口"而非"致命矛盾" |

---

## 矛盾 2：truncated 风险等级

### 2.1 矛盾陈述

| 草稿 | 陈述 | 等级 |
|------|------|------|
| **A §4 F10** | "dom-snapshot.mjs 的 truncated 字段在 cdp-full-extract 路径中丢失" | P2 |
| **F §4.1 阻断点 C** | "dom-snapshot.mjs 正确产出 truncated 标记，但从未在任何下游脚本中被作为拒绝条件使用。与 cdp-full-extract 的 captureDomTree() 不一致" | P0 |
| **F §5.1 F4** | "dom-snapshot truncated 标记无消费方，cdp-full-extract 无 truncated 字段" | P0 |

### 2.2 代码证据

#### 证据 A：`dom-snapshot.mjs` truncated 字段存在（L96, L104-106, L223）

```js
let truncated = false;                    // L96
if (nodes.length >= config.maxNodes) {    // L104
  truncated = true;                       // L105
  break;                                  // L106
}
// ...
summary: {
  documentElements: elements.length,
  eligibleNodes,
  recordedNodes: nodes.length,
  truncated,                              // L223 — 输出到 summary
  openShadowRoots,
}
```

**结论**：`dom-snapshot.mjs` 正确产出 `summary.truncated` 布尔字段。

#### 证据 B：`cdp-full-extract.mjs` `captureDomTree()` 无 truncated 字段（L366-475）

```js
// L374-375 walk 函数内：
if (count >= maxNodes || depth > maxDepth) return null;
// 没有设置任何 truncated 标志

// L452 返回：
return JSON.stringify({ root, total: count });
// 仅返回 root 和 total，无 truncated

// L466 解析：
return { root: parsed.root, totalNodes: parsed.total || 0 };
// 无 truncated
```

**结论**：`captureDomTree()` 在达到 maxNodes 时静默停止遍历，**不产出 truncated 字段**。

#### 证据 C：下游消费检查

```
grep "truncated" in scripts/ and src/:
  - dom-snapshot.mjs L96, L104-106, L223 — 产出
  - cdp-full-extract.mjs — 无此字段
  - 其他文件 — 无消费 truncated 的代码
```

**结论**：`truncated` 字段在 `dom-snapshot.mjs` 产出后，**无任何下游脚本将其作为拒绝条件**。A 的"无人消费"判断正确。

### 2.3 统一风险分级框架

为消除 A（P2）与 F（P0）的 2 级差异，先建立统一框架：

| 等级 | 语义触发条件 | 工程语义 | 处置 SLA |
|------|-------------|---------|---------|
| **P0-Block** | 主题完全加载失败 / 注入导致目标应用崩溃 / 竞态导致页面不可用 | 主流程阻断 | 立即修复 |
| **P0-Quality** | 语义漂移、覆盖不完全、静态/运行时签名不匹配 | 静默质量风险，不阻断加载 | 24h 内响应 |
| **P1** | 选择器失效（dead landmark）、bridge 变量不可达、数据契约不一致导致开发者误判 | 适配器漂移 / 工具链可靠性 | 版本周期内修复 |
| **P2** | 选择器精度不足、Shadow DOM 不可达 | 视觉体验 | 排期优化 |
| **P3** | 性能开销、风格一致性 | 锦上添花 | 长期路线图 |

### 2.4 重新标定

#### truncated 不一致的定性分析

| 维度 | 评估 |
|------|------|
| 是否导致功能阻断？ | 否 — 不影响主题加载、注入、验证 |
| 是否导致静默质量劣化？ | 否 — 不影响最终用户的视觉体验 |
| 是否导致开发者误判？ | **是** — 开发者无法区分"dom-snapshot 报告 truncated=true"与"cdp-full-extract 无此信息"的语义差异 |
| 是否破坏数据契约？ | **部分** — 两个模块对"完整性"的定义不一致，但无下游依赖此契约 |

#### 等级裁定：**P1**

**理由**：

1. **不是 P0-Block**：不影响主题加载和注入主流程
2. **不是 P0-Quality**：不影响最终用户的视觉质量
3. **是 P1**：属于"数据契约不一致导致开发者误判"——当开发者在两个模块间切换时，会因 truncated 字段存在/不存在而产生困惑，可能误判采集完整性
4. **不是 P2**：P2 定义为"视觉体验"问题，而 truncated 不一致是工具链可靠性问题，比 P2 更影响工程效率

#### A 草稿的修正

A 评 P2 的理由是"无人消费"，但忽略了**开发者作为消费者**的事实。truncated 字段是开发者诊断采集完整性的关键信号，两模块不一致会导致诊断结论不可靠。**P2 偏低**，应上调至 P1。

#### F 草稿的修正

F 评 P0 的理由是"数据契约破坏"，但夸大了影响面：
- "契约破坏"需有下游依赖方，而当前无代码消费 truncated
- 真正受影响的是开发者人工判断，不是自动化流程
- **P0 过高**，应下调至 P1

### 2.5 修订建议

| 草稿 | 需修订的陈述 | 修订方向 |
|------|------------|---------|
| **A §4 F10** | 等级 P2 | 上调至 P1；补充理由"开发者诊断工具链不一致" |
| **A §8.2 优先行动项** | 无 truncated 相关项 | 增加 P1 行动："统一 dom-snapshot 与 cdp-full-extract 的 truncated 语义" |
| **F §4.1 阻断点 C** | "truncated 标记无消费" | 明确"无自动化消费，但影响开发者人工诊断"；等级从 P0 降为 P1 |
| **F §5.1 F4** | 等级 P0 | 降为 P1；删除"阻断点"定位，改为"工具链一致性缺口" |
| **交叉验证 #1 R-2** | "truncated 等级（A=P2 vs F=P0）" | 裁定：双方均不准确，统一为 P1 |

---

## 矛盾 3：全局阈值等级差异

### 3.1 矛盾陈述

| 草稿 | 陈述 | 等级 |
|------|------|------|
| **C §8(b) F-3** | "全局统一固定阈值，无逐 Agent/组件差异化" — 6 Agent DOM 节点 52~244 差异大，统一阈值不公平 | HIGH |
| **E §14(a)/(c)** | "4/6 Agent 无 semantic 配置 → isNativeThemeControlled 默认 true → 全量采样" + "verify-style 无法区分应跳过与修改失败" | P1（E-03）+ P1（E-06） |
| **E R-10** | "per-Agent verify-style tolerance 配置规约" | P2 |
| **交叉验证 #1 §2.3** | "C 和 E 均未量化'4 Agent 缺配置时 minRatio=1 导致的 CI 误报实际概率'" | — |

### 3.2 代码证据

#### 证据 A：全局硬编码阈值（verify-style.mjs L133-134）

```js
const tolerance = opts.tolerance ?? 0.08;
const minRatio = opts.minRatio ?? 1;
```

**结论**：tolerance 和 minRatio 均为硬编码默认值，无 per-Agent 覆盖机制。

#### 证据 B：`isNativeThemeControlled()` 默认返回 true（selectivity-registry.mjs L514-518）

E §14(a) 已确认：当 Agent 无 `semantic` 配置时，`isNativeThemeControlled()` 默认返回 `true`。

#### 证据 C：4 Agent 缺配置（E §14(a) 表）

| Agent | semantic 配置 | 后果 |
|-------|--------------|------|
| traework | sidebar（partial） | 部分节点被正确排除 |
| codex | composer（partial） | 部分节点被正确排除 |
| workbuddy | **无** | 全部节点参与采样 |
| doubao | **无** | 全部节点参与采样 |
| qoderwork | **无** | 全部节点参与采样 |
| zcode | **无** | 全部节点参与采样 |

#### 证据 D：`assessStyleCompliance()` 的"空采样通过"逻辑（verify-style.mjs L164-165）

```js
const matchRatio = judged > 0 ? passing / judged : 1;
return { pass: matchRatio >= minRatio, matchRatio, judged, misses };
```

**结论**：当 `minRatio=1` 时，要求 100% 节点通过。任何单个节点 miss 即整体 fail。

### 3.3 量化联合误报率推导

#### 假设与参数

| 参数 | 值 | 来源 |
|------|---|------|
| minRatio | 1（100%） | verify-style.mjs L134 |
| 4 Agent 缺配置 | workbuddy, doubao, qoderwork, zcode | E §14(a) |
| isNativeThemeControlled 默认 | true | selectivity-registry.mjs L514-518 |
| DOM 节点数 | 52~244 | C §8(b) |
| nonControlled 合理占比 | 15%~25% | 业界经验值（input/button/tooltip/divider 等） |

#### 推导过程

对于无 semantic 配置的 Agent，`buildStyleSamplingSnippet()` 将所有节点纳入采样。其中 nonControlled 节点（input、button、tooltip 等）的计算样式**不匹配**主题 token（因为这些节点本就应保持原貌）。

设 Agent 总节点数为 $N$，nonControlled 节点占比为 $p$：

$$\text{matchRatio} = \frac{N - pN}{N} = 1 - p$$

当 $p > 0$ 时，$\text{matchRatio} < 1 = \text{minRatio}$ → **必然 FAIL**

#### 逐 Agent 误报率计算

| Agent | 节点数 $N$ | nonControlled 占比 $p$（保守估计） | matchRatio | minRatio=1 结果 | 误报率 |
|-------|-----------|-----------------------------------|-----------|-----------------|--------|
| doubao | 244 | 20% (~49 节点) | 0.80 | FAIL | **100%** |
| workbuddy | 205 | 18% (~37 节点) | 0.82 | FAIL | **100%** |
| qoderwork | 134 | 15% (~20 节点) | 0.85 | FAIL | **100%** |
| zcode | 52 | 12% (~6 节点) | 0.88 | FAIL | **100%** |

#### 联合误报率

$$P(\text{至少 1 Agent 误报}) = 1 - \prod_{i=1}^{4}(1 - P_i) = 1 - 0 = 100\%$$

**结论**：4 个缺配置 Agent 的 verify-style 结果**必然 FAIL**，与主题质量无关。

#### CI 影响分析

当前 verify-style 在 CI 中的使用方式：
- F §2.1(a) BP-5 指出"verify-style 无批量模式"——当前 CI 不直接运行 verify-style
- 但 `analyze-structure-compare.mjs` 的 CI 退出码三态（L2338）已存在
- 若未来将 verify-style 纳入 CI（E §14(c) 方案实施后），4 Agent 将**永久阻断 CI**

### 3.4 重新标定

#### 等级裁定：**P0-Block**

**理由**：

1. **功能阻断**：verify-style 是主题质量门禁的核心机制，当前对 4/6 Agent 完全失效
2. **CI 必然误报**：一旦 verify-style 被纳入 CI（或开发者手动运行），4 Agent 的 CI 必然红掉
3. **复合效应**：这是两个独立问题的叠加——
   - 问题 1：4 Agent 缺 nonControlled 配置（E 的发现）
   - 问题 2：全局 minRatio=1 无差异化（C 的发现）
   - 两者单独存在时影响有限，组合后导致 CI 100% 误报

#### C 草稿的修正

C 评 HIGH 的方向正确，但未明确区分：
- "全局统一阈值"本身是一个 P1 问题（有缓冲空间时可接受）
- "全局统一阈值 + 4 Agent 缺配置"组合后才是 P0-Block
- 建议 C 补充"联合效应"分析，将 F-3 从 HIGH 上调至 P0-Block

#### E 草稿的修正

E 将"4 Agent 缺配置"标为 P1（E-06），将"per-Agent tolerance 配置"标为 P2（R-10），**均偏低**：
- E-06 的 P1 未考虑与 minRatio=1 的联合效应
- R-10 的 P2 未考虑"当前 minRatio=1 对 4 Agent 等同于永久阻断"
- 建议 E 将 E-06 上调至 P0-Block（联合效应），R-10 上调至 P1

### 3.5 修订建议

| 草稿 | 需修订的陈述 | 修订方向 |
|------|------------|---------|
| **C §8(b) F-3** | 等级 HIGH | 上调至 P0-Block；补充"与 4 Agent 缺配置联合导致 CI 100% 误报"的量化推导 |
| **C §10 审计结论** | "P1 — 差异化阈值" | 拆分为：P0-Block（联合效应）+ P1（长期差异化方案） |
| **E §14(a) E-06** | 等级 P1-架构性 | 上调至 P0-Block；补充"与 minRatio=1 联合导致 4 Agent 永久 FAIL" |
| **E R-10** | 等级 P2 | 上调至 P1；明确"在 4 Agent 缺配置修复前，minRatio=1 等同于 CI 阻断" |
| **E §14(c)** | "verify-style 无法区分应跳过与修改失败" | 补充量化：以 doubao 244 节点为例，20% nonControlled → matchRatio=0.80 → 必然 FAIL |
| **交叉验证 #1 R-3** | "全局阈值等级（C=HIGH vs E=P2）" | 裁定：双方均不准确；联合效应为 P0-Block，单独阈值问题为 P1 |

---

## 综合修订矩阵

### 4.1 风险等级修正汇总

| 风险项 | 原等级（分歧） | 修正等级 | 核心理由 |
|--------|--------------|---------|---------|
| extract↔builder 管道污染 | D=MEDIUM / F=P0 | **P1** | 管道不存在（D 正确）；但 DEFAULT_TOKENS 回退掩蔽是独立 P1 风险（F 的观察，错误的根因） |
| truncated 语义不一致 | A=P2 / F=P0 | **P1** | 不影响功能但影响开发者诊断；双方均偏离 |
| 全局阈值 + 4 Agent 缺配置联合效应 | C=HIGH / E=P2 | **P0-Block** | 量化推导：4 Agent CI 误报率 100% |

### 4.2 各草稿需修订章节索引

| 草稿 | 需修订章节 | 修订类型 |
|------|-----------|---------|
| **A** | §4 F10（P2→P1）、§8.2 优先行动项（增加 truncated 统一） | 等级上调 + 补充行动 |
| **C** | §8(b) F-3（HIGH→P0-Block）、§10 审计结论（拆分联合效应） | 等级上调 + 量化补充 |
| **D** | §10(b) G10.2（补充 DEFAULT_TOKENS 独立风险说明） | 补充说明 |
| **E** | §14(a) E-06（P1→P0-Block）、R-10（P2→P1）、§14(c)（补充量化推导） | 等级上调 + 量化补充 |
| **F** | §1 拓扑图（删除 sync-remap-from-extract）、§4.2(b)（重写污染路径）、§5.1 F1/F4（P0→P1） | 事实修正 + 等级下调 |

### 4.3 统一风险分级框架（最终版）

基于本次推演，建议全项目采用以下五级框架：

| 等级 | 语义触发条件 | 工程语义 | 处置 SLA | 本次适用案例 |
|------|-------------|---------|---------|-------------|
| **P0-Block** | 主题加载失败 / CI 必然误报 / 注入崩溃 | 主流程阻断 | 立即修复 | 矛盾 3 联合效应 |
| **P0-Quality** | 语义漂移 / 覆盖不完全 / 签名不匹配 | 静默质量风险 | 24h 响应 | — |
| **P1** | 选择器失效 / 数据契约不一致 / DEFAULT 回退掩蔽 | 工具链可靠性 | 版本周期内 | 矛盾 1（DEFAULT 掩蔽）、矛盾 2（truncated） |
| **P2** | 选择器精度不足 / Shadow DOM 不可达 | 视觉体验 | 排期优化 | — |
| **P3** | 性能开销 / 风格一致性 | 锦上添花 | 长期路线图 | — |

---

## 方法论反思

### 本次推演揭示的系统性问题

1. **事实陈述未经代码验证**：F 草稿引用了不存在的文件（`sync-remap-from-extract`），导致整个 P0 分析建立在虚构基础上。**教训**：所有架构拓扑图必须以 `glob_file_search` 或 `grep` 验证为前提。

2. **等级框架不统一导致虚假矛盾**：A 用 P1-P3，C/D/E 用 HIGH/MEDIUM/LOW，F 用 P0-P2。同一问题在不同框架下自然产生不同等级。**教训**：交叉校验前应先对齐分级框架。

3. **联合效应被忽视**：矛盾 3 中，C 和 E 各自发现了独立问题（全局阈值 / 缺配置），但均未量化两者组合后的放大效应。**教训**：交叉校验应显式检查"因果链组合后的非线性放大"。

4. **根因混淆**：矛盾 1 中，F 观察到了真实问题（DEFAULT_TOKENS 回退掩蔽），但错误归因到 extract 污染路径。**教训**：方案推演必须区分"问题存在"与"根因正确"。

---

*分析完成。本报告不替代各草稿的独立评审，仅提供基于代码实证的重新标定结论。*
