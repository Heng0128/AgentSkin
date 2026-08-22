# 审计草案 C：semantic-quant 层语义漂移检测专项审计

> 审计人：AgentSkin 语义漂移检测审计专家
> 日期：2026-08-18
> 审计范围：`src/engine/src/semantic-quant/` 全量 + `runtime/verify-style.mjs` + `scripts/check-semantic-contract.mjs` + `runtime/dom-snapshot.mjs`（Shadow-Root 边界）
> 约束：**禁止修改代码，仅做分析**
> 引用证据：RFC 2026-08-17-semantic-quant-layer、semantic-quant-final-review-2026-08-17、semantic-quant-review-2026-08-17、baseline-restore-audit-2026-08-16

---

## 审计摘要

semantic-quant 层当前定位为"实验性中间产物"，提供标准枚举字典 + COMPONENT_INDEX + 双版本字段快照。本审计聚焦三个维度：**基线存储方案**、**签名比对逻辑与阈值体系**、**Shadow-Root 边界处理**。

**核心结论**：当前实现是"静态元数据层"而非"语义漂移检测系统"。基线存储、签名比对、阈值体系三大漂移检测核心能力均**不存在**或**严重缺失**。Shadow-Root 边界存在"无法校验 → 静默通过"的误判通道。6 Agent 差异化阈值配置完全空白。

---

## 7. 基线存储问题

### 7(a). 每个 Agent 各组件的基线语义签名持久化存储在哪里？

#### 现状：无持久化基线存储

**证据 A — `semantic-snapshot.mjs` 第 6-8 行（定位声明）**：

```
定位：**实验性中间产物**——仅供 CLI 调试、诊断报告、编辑器预览。
不保证向后兼容、禁止长期持久存储；按"一次性生成、随版本重跑"使用。
永不进入注入 payload（不参与 L0-L4 注入执行）。
```

**证据 B — `buildSemanticSnapshot(agentId)` 是纯函数（第 31-54 行）**：

每次调用从 `COMPONENT_INDEX`（静态索引）+ `SELECTOR_REGISTRIES`（运行时注册表）重新生成快照。快照对象包含：
- `schemaVersion: 1`（固定值，不递增）
- `engineVersion`（来自 package.json，仅备注）
- `taxonomySchemaVersion`（来自 taxonomy.mjs，用于解析判断）
- `capturedAt`（ISO 时间戳）
- `components[]`（每个 componentId 的元数据 + resolved 选择器链）

**无任何 I/O 操作**：不写文件、不写数据库、不写缓存。

**证据 C — `validateSnapshotCompatibility` 只做 schema 版本校验（第 67-92 行）**：

校验逻辑是 `taxonomySchemaVersion` 严格相等性判断：
- `< current` → incompatible（需迁移/重新生成）
- `> current` → incompatible（旧引擎不支持）
- `== current` → compatible

**这不是语义签名比对**，只是数据结构版本门禁。

**证据 D — RFC §4.7 明确禁止持久化**：

> 产物回滚：`semantic-snapshot.json` 明确定位为**实验性产物，不保证向后兼容，禁止长期持久存储**；仅作调试/诊断中间产物，按"一次性生成、随版本重跑"使用。

#### 风险等级：HIGH

**问题**：没有持久化基线，"语义漂移检测"就缺乏参照物。当前快照只能回答"当前 taxonomy 静态结构是什么"，无法回答"相对上次采集漂移了多少"。

#### 方案推演

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|------|------|------|------|------|
| **A. 独立基线 JSON 文件** | 每次 CLI dump 时写入 `baselines/<agentId>@<version>.json`，下次比对 | 简单、可审计、可回滚 | 需管理文件生命周期、版本绑定 | ✅ 推荐 |
| **B. 嵌入 adapter 配置** | 在 `engines/<agent>/adapter.mjs` 中增加 `baselineSignature` 字段 | 与 adapter 同生命周期 | adapter 是注入产物，不应承载诊断元数据；违反分层 | ❌ |
| **C. 嵌入主题包** | 在 theme manifest 中增加 `semanticBaseline` 字段 | 主题发布时固化 | 主题是视觉层，不应耦合语义检测基线；多主题共享同一基线会重复 | ❌ |

**推荐方案 A 的关键设计点**：
- 基线文件路径：`baselines/<agentId>@<appVersion>.json`（绑定 Agent 应用版本，非引擎版本）
- 内容：每个 componentId 的语义签名（选择器命中状态 + 关键计算样式采样 + 子节点数量）
- 版本变更触发：`appVersion` 变化时自动标记旧基线 stale，下次采集时重建
- 存储位置：独立于引擎包，放 `~/.agentskin/diagnostics/baselines/`（用户数据目录）

---

### 7(b). 切换不同版本同一 Agent，基线是否需要更新？版本变更如何触发重新采集？

#### 现状：无版本变更触发机制

**证据 A — 快照中无 appVersion 字段**：

`buildSemanticSnapshot` 产出的快照只含 `engineVersion`（引擎包版本）和 `taxonomySchemaVersion`（数据结构版本），**不包含 Agent 应用版本**（如 traework 的 `2.4.1`、codex 的 `1.2024.100`）。

**证据 B — `validateSnapshotCompatibility` 不感知 Agent 版本**：

该校验只检查 `taxonomySchemaVersion`（当前固定为 1），不检查 Agent 应用是否升级。

**证据 C — `taxonomySchemaVersion` 递增条件极窄**：

按 taxonomy.mjs 第 12-13 行注释："TAXONOMY_SCHEMA_VERSION 仅在字段增删改时手动递增"。Agent 应用版本变化但 COMPONENT_INDEX 未变时，版本号不变。

**证据 D — baseline-restore-audit-2026-08-16 §2.2 已识别此问题**：

> 采集时机 | Agent 应用版本更新 | 是 | `appVersion` 变化触发重新采集

但该审计的"基准真值层"方案尚未实现。

#### 风险等级：HIGH

**问题**：Agent 应用版本迭代后（hash 类名变化、DOM 结构微调），旧基线不会自动失效。如果基线存储采用方案 A，可能出现"用 v2.3 的基线比对 v2.4 的 DOM"的误报。

#### 方案推演

| 触发条件 | 是否应触发重采 | 检测方式 |
|----------|---------------|----------|
| Agent 应用版本变化 | ✅ 是 | CDP `Runtime.evaluate` 读取 `navigator.userAgent` 或应用特定版本 API |
| 引擎自身版本更新 | ❌ 否 | 引擎版本变化不改变 Agent DOM 结构 |
| taxonomySchemaVersion 递增 | ✅ 是 | 静态检测，CI 脚本可覆盖 |
| 路由变化 | ❌ 否 | 同版本同主题下不重采（性能权衡，对齐 baseline-restore-audit §2.2） |
| 用户切换原生主题 | ✅ 是 | 主题模式变更意味着基线失效 |

**推荐触发机制**：
1. 基线文件命名绑定 `appVersion`（如 `traework@2.4.1.json`）
2. 每次采集前检测当前 Agent 的 `appVersion`，与基线文件名比对
3. 不匹配 → 标记 stale → 自动触发重新采集
4. 旧基线保留（不删除），供历史回溯

---

## 8. 签名比对逻辑

### 8(a). 新旧两份语义签名，严格相等还是加权相似度打分？

#### 现状：底层连续相似度 + 表层二值化判定

**证据 A — `colorDistance`：连续相似度（verify-style.mjs 第 78-84 行）**：

```js
export function colorDistance(a, b) {
  if (!a || !b) return 1;
  const dr = (a.r - b.r) / 255;
  const dg = (a.g - b.g) / 255;
  const db = (a.b - b.b) / 255;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}
```

输出 0..1 的连续值（0 = 完全一致，1 = 极端差/不可比）。

**证据 B — `matchesToken`：二值化转换（verify-style.mjs 第 97-103 行）**：

```js
export function matchesToken(actual, expected, tolerance) {
  const te = normalizeColor(expected);
  if (!te) return null;      // 期望无法解析 → 跳过
  const na = normalizeColor(actual);
  if (!na) return false;     // 实际无法解析 → 视为未命中
  return colorDistance(na, te) <= tolerance;  // 二值化
}
```

`tolerance` 默认 0.08。距离 ≤ 0.08 → true，> 0.08 → false。

**证据 C — `assessStyleCompliance`：节点级 OR 聚合（verify-style.mjs 第 132-166 行）**：

- 根节点 root：只校验 `color vs tokens.text`（背景天然透明，跳过）
- 普通节点：`color vs tokens.text`、`bg vs tokens.surface`、`border vs tokens.border` 三个属性
- **任一属性近似命中即视为该节点通过**（OR 逻辑，非 AND）
- 节点级命中率 = `passing / judged`
- 整体 pass = `matchRatio >= minRatio`（minRatio 默认 1，即 100% 节点通过）

**证据 D — `aggregateByRegion`：按 riskLevel 分通道（verify-style.mjs 第 198-226 行）**：

- `riskLevel === HIGH` 且 pass=false → `hardErrors`（阻断 CI）
- `riskLevel === MEDIUM/LOW` 且 pass=false → `semanticWarnings`（仅提示）

#### 判定链路总结

```
colorDistance (连续 0..1)
    ↓ tolerance=0.08
matchesToken (二值 true/false/null)
    ↓ OR 逻辑（任一属性命中即节点通过）
assessStyleCompliance (节点级 pass + matchRatio)
    ↓ minRatio=1（100% 节点通过）
aggregateByRegion (按 riskLevel 分通道输出)
```

#### 风险等级：MEDIUM

**问题**：
1. **连续相似度信息被二值化丢弃**：colorDistance = 0.08 和 colorDistance = 0.5 都被判为 false，但漂移严重程度完全不同
2. **OR 逻辑过于宽松**：三个属性任一命中即通过，可能掩盖"文字色正确但背景色完全错误"的场景
3. **minRatio=1 过于严格**：要求 100% 节点通过，宿主小版本迭代导致 1 个节点变化即整体 fail

---

### 8(b). 告警阈值、严重漂移阈值如何定义？全局统一还是每 Agent/组件可单独配置？

#### 现状：全局统一固定阈值，无差异化配置

**证据 A — 硬编码默认值（verify-style.mjs 第 133-134 行）**：

```js
const tolerance = opts.tolerance ?? 0.08;
const minRatio = opts.minRatio ?? 1;
```

**无逐 Agent 覆盖、无逐组件覆盖、无配置文件读取**。

**证据 B — `aggregateByRegion` 使用 COMPONENT_INDEX 的 riskLevel 做通道分级（第 215-222 行）**：

```js
const meta = COMPONENT_INDEX[componentId];
const riskLevel = meta?.riskLevel ?? RISK_LEVEL.MEDIUM;
if (riskLevel === RISK_LEVEL.HIGH) {
  hardErrors.push(entry);
} else {
  semanticWarnings.push(entry);
}
```

riskLevel 只决定**输出通道**（阻断 vs 提示），不决定**阈值**。HIGH 组件和 MEDIUM 组件使用完全相同的 tolerance/minRatio。

**证据 C — 无"告警阈值"与"严重漂移阈值"的区分**：

当前只有 pass/fail 二元结果。没有"黄色告警"（轻微漂移，需关注）和"红色告警"（严重漂移，需立即处理）的分级。

#### 风险等级：HIGH

**问题**：
1. **6 Agent 的 DOM 复杂度差异巨大**（baseline-restore-audit §1.1：DOM 节点数 52~244），统一阈值对简单 Agent（zcode 52 节点）和复杂 Agent（doubao 244 节点）不公平
2. **宿主小版本迭代的子节点数量变动**：codex 更新后 composer 内部多了一个 button 节点 → minRatio=1 直接 fail → 阻断 CI，但实际语义未漂移
3. **无"轻微漂移"缓冲区**：colorDistance = 0.09（刚超阈值）和 colorDistance = 0.8（严重漂移）处理方式相同

#### 6 Agent 差异化阈值配置缺口

| Agent | DOM 节点数 | 组件数 | 当前阈值 | 建议差异化方向 |
|-------|-----------|--------|----------|---------------|
| traework | 136 | 5 | 全局统一 | 中等 tolerance（结构稳定） |
| codex | 98 | 4 | 全局统一 | 较宽 tolerance（hash 类名变化频繁） |
| workbuddy | 205 | 5 | 全局统一 | 较宽 minRatio（节点多，个别变动正常） |
| qoderwork | 134 | 4 | 全局统一 | 中等 tolerance（结构稳定） |
| doubao | 244 | 4 | 全局统一 | 最宽 tolerance + 较低 minRatio（节点最多） |
| zcode | 52 | 4 | 全局统一 | 最严格 tolerance（结构简单，漂移即真问题） |

#### 方案推演

| 方案 | 描述 | 优点 | 缺点 | 推荐 |
|------|------|------|------|------|
| **A. 全局统一阈值**（现状） | tolerance=0.08, minRatio=1 | 零配置、简单 | 无法适配 6 Agent 差异 | ❌ |
| **B. 逐 Agent 阈值** | 在 taxonomy.mjs 或独立配置中为每个 agentId 设 tolerance/minRatio | 适配 Agent 差异 | 配置维护成本；组件级差异仍无法表达 | 🟡 过渡方案 |
| **C. 逐组件 + 逐 Agent 二维阈值** | COMPONENT_INDEX 中每个组件可覆盖 tolerance/minRatio；Agent 级默认值 + 组件级覆盖 | 最精细；高风险组件可设更严阈值 | 配置量大（6×6=36 个组合）；需验证每个值的合理性 | ✅ 推荐（Phase 2） |
| **C'. 逐组件阈值 + 自适应基线** | 不硬编码阈值，而是基于历史漂移数据动态调整（统计过程控制 SPC） | 自动适配；减少人工调参 | 需要数据积累；实现复杂 | 🟡 长期方向 |

**推荐分阶段落地**：
- Phase 1（当前）：保持全局统一，但将 minRatio 从 1 放宽至 0.9（允许 10% 节点偏差），减少宿主版本迭代误报
- Phase 2：引入逐 Agent 阈值配置（6 个 Agent 各一组 tolerance/minRatio）
- Phase 3：引入逐组件覆盖（高风险组件可单独收紧）

---

## 9. Shadow-Root 边界处理

### 9(a). 遇到封闭 Shadow-Root 组件，校验链路会直接跳过？输出报告需携带什么标记？

#### 现状：完全不可见、不可计数、不可校验

**证据 A — `dom-snapshot.mjs` 第 95、98 行**：

```js
let openShadowRoots = 0;
// ...
if (element.shadowRoot) openShadowRoots += 1;
```

只计数**开放** shadow root（`attachShadow({ mode: 'open' })` 的 `element.shadowRoot` 非 null）。

**封闭** shadow root（`attachShadow({ mode: 'closed' })`）的 `element.shadowRoot` 返回 null → **不会被计数**。

**证据 B — `document.querySelectorAll('*')` 只遍历 light DOM（第 91 行）**：

```js
const elements = document.querySelectorAll('*');
```

`querySelectorAll` 不穿透 shadow boundary。封闭 shadow root 内部的元素完全不可见。

**证据 C — 输出报告 `summary.openShadowRoots` 只含开放 root（第 219-225 行）**：

```js
summary: {
  documentElements: elements.length,
  eligibleNodes,
  recordedNodes: nodes.length,
  truncated,
  openShadowRoots,  // 只含开放 root
}
```

**封闭 shadow root 的数量、内部结构、样式信息在输出报告中完全不存在**。

**证据 D — baseline-restore-audit §3.1 已声明"Shadow DOM 不可穿透"**：

> Shadow DOM 不可穿透：closed shadow root 无法访问，降级为仅对 Shadow Host 应用主题

但该审计的"降级策略"尚未实现。

#### 风险等级：HIGH

**问题**：
1. **封闭 shadow root 内部组件完全不可校验**：如果某个 componentId 对应的 DOM 节点全部在封闭 shadow root 内，`assessStyleCompliance` 的 samples 为空 → judged=0 → matchRatio=1 → **pass=true（静默通过）**
2. **输出报告无任何标记**：用户无法知道"有多少组件因封闭 shadow root 而未被校验"
3. **与"高风险组件阻断 CI"的语义矛盾**：如果一个 HIGH riskLevel 的组件恰好在封闭 shadow root 内，它会被静默判为通过，永远不会阻断 CI

#### 方案推演

**输出报告需携带的标记**：

| 标记字段 | 类型 | 含义 |
|----------|------|------|
| `closedShadowRootCount` | number | 检测到的封闭 shadow root 数量（通过 `Element.prototype.attachShadow` 的 `mode: 'closed'` 特征推断，或通过 `chrome.dom` CDP 域） |
| `unverifiableComponents` | string[] | 因封闭 shadow root 而无法采样的 componentId 列表 |
| `shadowHostSampling` | object[] | 对 shadow host 的降级采样结果（仅采集 host 节点自身样式，不穿透） |
| `verificationCoverage` | number | 可校验节点数 / 总节点数（覆盖率 < 100% 时需提示） |

**推荐降级策略**：
1. 检测到封闭 shadow root 时，不穿透，但对 shadow host 节点做降级采样
2. 输出报告增加 `unverifiableComponents` 字段，列出所有无法校验的 componentId
3. 如果 unverifiableComponents 包含 HIGH riskLevel 组件 → 输出 `semanticWarnings`（不阻断 CI，但提示人工确认）

---

### 9(b). 不可校验的组件是否会被误统计到 COMPONENT_INDEX 风险等级中？如何区分"校验失败"和"无法校验"？

#### 现状：COMPONENT_INDEX 是静态 curate，不依赖运行时；但判定逻辑存在"无法校验 → 静默通过"漏洞

**证据 A — COMPONENT_INDEX 是静态数据（taxonomy.mjs 第 182-225 行）**：

6 条记录（root, sidebar, workspace, composer, toolbar, message-list），每条包含 uiArea/componentKind/componentLayer/riskLevel/bindings。**不依赖运行时 DOM 采集**。

**证据 B — `assessStyleCompliance` 的"空采样通过"逻辑（verify-style.mjs 第 158-164 行）**：

```js
if (usableProps === 0) continue;  // 无可用属性 → 跳过该节点
// ...
if (judged === 0) continue;      // 无参与判定节点 → 跳过该组件
// ...
const matchRatio = judged > 0 ? passing / judged : 1;  // 无判定时取 1（中性）
return { pass: matchRatio >= minRatio, matchRatio, judged, misses };
```

如果一个组件的所有采样节点都在封闭 shadow root 内：
- samples 为空 → 循环不执行 → judged=0 → matchRatio=1 → pass=true

**证据 C — `aggregateByRegion` 只处理 pass=false 的组件（verify-style.mjs 第 213-214 行）**：

```js
const result = assessStyleCompliance(componentSamples, tokens, opts);
if (result.pass) continue;  // pass=true → 不进入任何报告通道
```

**静默通过 = 不进入 hardErrors 也不进入 semanticWarnings**。

#### 风险等级：HIGH

**问题**：
1. **"无法校验"与"校验通过"在输出中完全无法区分**：两者都是 pass=true，不进入任何报告通道
2. **COMPONENT_INDEX 的 riskLevel 不参与"无法校验"场景**：HIGH riskLevel 的组件如果无法校验，不会产生任何提示
3. **与 RFC §4.5 的"semanticWarnings 仅提示"语义矛盾**：RFC 说"索引漏登记 → semanticWarnings"，但"索引已登记但无法校验"连 semanticWarnings 都没有

#### 方案推演

**三态判定模型**：

| 状态 | 含义 | 判定条件 | 报告通道 |
|------|------|----------|----------|
| `PASS` | 校验通过 | samples 非空 且 matchRatio >= minRatio | 不报告 |
| `FAIL` | 校验失败 | samples 非空 且 matchRatio < minRatio | hardErrors（HIGH）/ semanticWarnings（MEDIUM/LOW） |
| `UNVERIFIABLE` | 无法校验 | samples 为空 或 所有节点不可访问 | unverifiableWarnings（新通道，永不阻断 CI） |

**推荐实现**：
1. `assessStyleCompliance` 返回值增加 `verifiable: boolean` 字段（judged > 0 时为 true）
2. `aggregateByRegion` 增加第三输出通道 `unverifiableWarnings`
3. 如果 unverifiableWarnings 包含 HIGH riskLevel 组件 → 在报告中用醒目样式提示

---

## 综合风险矩阵

| 编号 | 发现 | 等级 | 影响范围 | 当前状态 |
|------|------|------|----------|----------|
| F-1 | 无持久化基线存储，漂移检测缺乏参照物 | 🔴 HIGH | 全系统 | 未实现 |
| F-2 | 无版本变更触发重新采集机制 | 🔴 HIGH | 基线时效性 | 未实现 |
| F-3 | 全局统一固定阈值，无逐 Agent/组件差异化 | 🔴 HIGH | 6 Agent 适配 | 未实现 |
| F-4 | 无"告警阈值"与"严重漂移阈值"区分 | 🟠 MEDIUM | 报告精度 | 未实现 |
| F-5 | 封闭 Shadow-Root 静默通过，无法校验 = 通过 | 🔴 HIGH | 高风险组件 | 设计缺陷 |
| F-6 | 输出报告无 Shadow-Root 不可达标记 | 🟠 MEDIUM | 可观测性 | 未实现 |
| F-7 | "无法校验"与"校验通过"无法区分 | 🔴 HIGH | 报告可信度 | 设计缺陷 |
| F-8 | 连续相似度信息被二值化丢弃 | 🟠 MEDIUM | 漂移严重度评估 | 设计局限 |
| F-9 | OR 逻辑过于宽松（任一属性命中即通过） | 🟠 MEDIUM | 节点级判定 | 设计选择 |
| F-10 | minRatio=1 对多节点 Agent 过于严格 | 🟠 MEDIUM | CI 误报 | 默认值 |

---

## 与既有审计/报告的关联

| 本审计发现 | 关联报告 | 关联章节 |
|-----------|----------|----------|
| F-1 无持久化基线 | baseline-restore-audit-2026-08-16 | §2.2 基准真值层（已识别，未落地） |
| F-2 无版本触发 | baseline-restore-audit-2026-08-16 | §2.2 采集时机表 |
| F-5/F-6 Shadow-Root | baseline-restore-audit-2026-08-16 | §3.1 技术边界（已声明不可穿透，未给降级方案） |
| F-3/F-4 阈值体系 | semantic-quant-review-2026-08-17 | §6 riskLevel 初始分级（只分级，未给差异化阈值） |
| F-1 实验性定位 | semantic-quant-final-review-2026-08-17 | §A-5 message-list 恒 null（已修复） |

---

## 审计结论

semantic-quant 层当前是**静态元数据注册层**，不是**语义漂移检测系统**。其设计定位（实验性中间产物、禁止持久化、永不进入注入 payload）与"漂移检测"的功能期望存在根本性落差。

**如果要真正实现语义漂移检测**，需要补充的能力按优先级：

1. **P0 — 基线持久化 + 版本绑定**：独立基线 JSON + appVersion 触发重采
2. **P0 — Shadow-Root 降级 + 三态判定**：区分 PASS / FAIL / UNVERIFIABLE
3. **P1 — 差异化阈值**：逐 Agent 的 tolerance/minRatio 配置
4. **P1 — 漂移严重度分级**：利用 colorDistance 连续值输出"轻微/中度/严重"三级告警
5. **P2 — 自适应阈值**：基于历史数据的统计过程控制（SPC）

**当前不矛盾的声明**：RFC §4.7 已明确 semantic-quant 是"实验性中间产物"。本审计的结论不是"实现有 bug"，而是"如果目标是语义漂移检测，当前能力覆盖不足 30%"。建议要么调整定位声明（明确"本层不负责漂移检测"），要么按 P0/P1/P2 路线图补齐能力。

---

## 附录：关键代码锚点索引

| 锚点 | 文件 | 行号 | 用途 |
|------|------|------|------|
| 实验性定位声明 | semantic-snapshot.mjs | 6-8 | 禁止持久化、永不注入 |
| buildSemanticSnapshot | semantic-snapshot.mjs | 31-54 | 纯函数、无 I/O |
| validateSnapshotCompatibility | semantic-snapshot.mjs | 67-92 | schema 版本相等性校验 |
| normalizeColor | verify-style.mjs | 33-69 | CSS 颜色解析 |
| colorDistance | verify-style.mjs | 78-84 | RGB 欧几里得距离 |
| matchesToken | verify-style.mjs | 97-103 | 二值化判定 |
| assessStyleCompliance | verify-style.mjs | 132-166 | 节点级 OR 聚合 |
| aggregateByRegion | verify-style.mjs | 198-226 | riskLevel 分通道 |
| openShadowRoots 计数 | dom-snapshot.mjs | 95, 98 | 只计开放 root |
| querySelectorAll('*') | dom-snapshot.mjs | 91 | 不穿透 shadow |
| COMPONENT_INDEX | taxonomy.mjs | 182-225 | 静态 6 条 curate |
| TAXONOMY_SCHEMA_VERSION | taxonomy.mjs | 28 | 固定为 1 |
| 空采样通过逻辑 | verify-style.mjs | 158-164 | judged=0 → matchRatio=1 |
