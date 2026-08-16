# semantic-quant 人工复核报告（枚举 + 绑定 + 对齐差异）

> 日期：2026-08-17
> 对应 RFC：docs/rfc/2026-08-17-semantic-quant-layer.md §7 人工复核项
> 数据来源（全部实读）：
> - `src/engine/src/runtime/selectivity-registry.mjs`（SELECTOR_REGISTRIES 全量，6 agent）
> - `src/engine/src/adapters/{workbuddy,codex,doubao,qoderwork,traework,zcode}.mjs`（verification 全量）
> - 说明：engine 侧 `src/engine/src/adapters/*.mjs` 是 `dom-snapshot.mjs` 读取 `adapter.verification` 的真实来源，与 `engines/<agent>/adapter.mjs` 为同构双份（引擎包 vs 打包产物）。

---

## 1. 语义名 × Agent 对齐矩阵

来源：`SELECTOR_REGISTRIES`（registry 完整图谱）与 `adapter.verification`（最小验证集）双列对比。

| 语义名 | registry 覆盖 | adapter.verification 覆盖 | 差异 |
|--------|---------------|---------------------------|------|
| root | 6/6 | 6/6（rootAny） | ✅ 一致 |
| sidebar | 6/6 | 5/6（缺 doubao） | 🟠 doubao 无 recommended |
| composer | 6/6 | 5/6（缺 doubao） | 🟠 同上 |
| workspace | 5/6（缺 doubao） | 3/6（workbuddy/qoderwork/traework） | 🟠 codex/zcode 只在 registry |
| toolbar | 2/6（workbuddy/traework） | 0/6 | 🟠 仅 registry |
| messageList | 1/6（doubao） | 0/6 | 🟡 仅 registry |

**结论**：符合 registry 头注释的既定分层（registry = 完整图谱，verification = 最小验证集，registry ⊇ verification）。语义层**以 registry 为派生源**（完整集），verification 差距记入"采样盲区"（见 §5）。

## 2. 四套枚举实际取值清单（覆盖核验）

### uiArea（9 值）— 当前数据用到 5 个

| 枚举值 | 中文 | 当前使用 | 绑定组件 |
|--------|------|----------|----------|
| shell | 应用外壳 | ✅ | root |
| sidebar | 侧边栏 | ✅ | sidebar |
| main-content | 主内容区 | ✅ | workspace、message-list |
| composer | 输入区 | ✅ | composer |
| top-nav | 顶部导航 | ✅ | toolbar |
| overlay | 弹窗浮层 | ⬜ 无绑定 | — |
| status-bar | 底部状态栏 | ⬜ 无绑定 | — |
| toast-layer | 消息提示层 | ⬜ 无绑定 | — |
| global-overlay | 全局蒙层 | ⬜ 无绑定 | — |

### componentKind（11 值）— 当前数据用到 2 个

| 枚举值 | 当前使用 | 绑定组件 |
|--------|----------|----------|
| container | ✅ | root、sidebar、workspace、toolbar |
| input | ✅ | composer |
| list-item | ✅ | message-list |
| button / dropdown / card / text / icon / divider / mask / scrollbar | ⬜ 预留 | — |

### componentLayer（5 值）— 全部可用

| 枚举值 | 中文 | 初始分配 |
|--------|------|----------|
| page | 页面容器层 | root、sidebar、workspace、toolbar |
| component | 功能组件层 | composer、message-list |
| global / decoration / state | 预留 | — |

### riskLevel（3 值）— 全部可用，初始分级见 §6

**覆盖结论**：当前 6 agent 真实组件全部可落入现有枚举，**无缺失值**。但如实记录：11 个 componentKind 中当前仅用到 2 个、9 个 uiArea 中用到 5 个——枚举以"加法兼容 + 预留给 overlay 家族"为主，属预期设计，非缺陷（union 可增不可删）。

## 3. componentId 初始清单（规范语义名字典）

derive-by-default 规则下，componentId == 规范语义名，6 个：

| componentId | uiArea | componentKind | componentLayer | riskLevel |
|-------------|--------|---------------|----------------|-----------|
| root | shell | container | page | high |
| sidebar | sidebar | container | page | high |
| workspace | main-content | container | page | medium |
| composer | composer | input | component | high |
| toolbar | top-nav | container | page | medium |
| message-list | main-content | container | component | high |

（说明：`messageList` registry 语义名 → componentId 命名为 kebab-case `message-list`，与其余 camel 语义名不同——见 §5 发现 3。）

## 4. N:M 例外绑定清单

**当前数据：0 个真例外。** 逐一核对 6 agent × registry 条目后确认：每个 `(agentId, semanticName)` 与 componentId 均为 1:1（componentId == semanticName），**derive-by-default 覆盖 100%，手写例外面为空**。

> 含义：Phase 1 维护成本面 = 0（无手写 bindings）。bindings N:M 机制是为未来（一个逻辑组件跨多语义名、版本分裂）预留，当前不产生维护负担。这是对"维护成本内部转移"质询的最强回应：**成本没有转移到手写面，因为手写面为空**。

## 5. 对齐差异发现（需决策或记录）

| # | 发现 | 等级 | 建议 |
|---|------|------|------|
| 1 | **doubao adapter 无任何 recommended**（仅 rootAny），registry 却有 sidebar/messageList/composer | 🟠 | 语义层照常派生（以 registry 为源）；但 doubao 非 root 组件**永远不会被采样** → 在 verify 报告标注"采样盲区"，或后续给 doubao 补 recommended |
| 2 | **codex/zcode 的 workspace 只存在于 registry**，不在 verification | 🟡 | 同上，记录采样盲区即可 |
| 3 | **`messageList` 命名风格不一致**（registry 为 camelCase，其余语义名亦 camelCase；componentId 建议 kebab-case） | 🟡 | 决策点：registry 语义名保持不动（兼容），componentId 统一 kebab-case；`message-list` 为唯一非同名派生 |
| 4 | **overlay 家族（modal/mask/toast/status-bar）在 6 agent 中均无语义名登记** | 🟠 | 当前弹层只能靠 bridge token 级覆盖，无组件级锚点；uiArea 枚举已预留，COMPONENT_INDEX 暂空绑定 → 记为 Phase 2 候选（需逐 agent 补 registry 语义名） |
| 5 | **registry 的 `semantic.nonControlled` 拓扑（codex composer 的 inner input/button、traework sidebar 的 divider/hover）是"单→多发散"原型，但归属 registry 不动** | ✅ | 边界确认：nonControlled 是选择器匹配行为，留 registry；四枚举元数据进 semantic-quant，职责不交叉 |

## 6. riskLevel 初始分级（人工粗分，可迭代）

| componentId | 初分级 | 理由 |
|-------------|--------|------|
| root | high | 缺失即注入整体失败（阻塞预检） |
| sidebar | high | 大面积可见表面 + 导航项/hover 态多，改漏视觉破坏明显 |
| composer | high | 输入区最常被 tweak，且带 nonControlled 内部件，最易漏 |
| message-list | high | 消息气泡为主视觉面，改色遗漏最显眼 |
| workspace | medium | 面积大但多为容器继承色 |
| toolbar | medium | 可见但元素少、结构简单 |

## 7. 待人工确认项（进入评审前的最终决策点）

1. componentId 命名：确认统一 kebab-case（`message-list` 为唯一非同名派生；registry 语义名不动）。
2. doubao 采样盲区：接受（仅提示）还是补 recommended（需要真实 DOM 验证）？
3. overlay 家族：确认记为 Phase 2 候选，Phase 1 不建空绑定。
4. riskLevel 初分级：确认按 §6，还是调整某几项。
5. componentKind 预留值：确认保留 9 个未用值（加法兼容），不删。

---

## 复核结论

**§7 复核完成度**：1（枚举覆盖）、2（N:M 绑定）、4（componentId 命名对齐）已核验完毕且**无阻塞问题**；3（riskLevel）、5（overlay 家族范围）给出初始建议，待老板拍板 5 个决策点后即可进入评审（RFC §8）。
