# RFC：语义量化层（semantic-quant）— Phase 1 薄切片 + Phase 2 演进

> 状态：`待评审`
> 日期：2026-08-17
> 分支：（待定）
> 范围：`src/engine/src/semantic-quant/`（新增）、`src/engine/src/runtime/verify-style.mjs`、`scripts/check-semantic-contract.mjs`（新增）、`biome.json`、`docs/ARCHITECTURE.md`

---

## 1. 背景与目标

**现状痛点**（全部经代码侦察确认，非推演）：

1. **无标准枚举字典**：`selectivity-registry.mjs` 的 `description` 是各 agent 手写 ad-hoc 文本，无强类型约束，跨 agent 不统一。
2. **双份语义名维护**：同一批语义名（`sidebar/workspace/composer`）在 `engines/<agent>/adapter.mjs` 的 `verification.recommended` 与 `selectivity-registry.mjs` 的 `SELECTOR_REGISTRIES` 各写一份、选择器链不一致（以 traework 为证：`[".task-list-base", ".task-list-panel"]` vs 带 5 级 fallback 的完整链）。这是刻意分层（最小验证集 vs 完整图谱），但维护成本真实存在。
3. **无遗漏风险标记**：无 `riskLevel` 概念，回归校验无法按风险优先级。
4. **校验只有逐节点视角**：`verify-style.mjs` 的 `assessStyleCompliance` 是平铺 samples 比对，无"按 UI 区域聚合"视角，无法回答"某区域整体视觉是否统一、高风险组件是否漏改"。

**目标**（可验证效果）：

1. 语义元数据**独立成层**：新增 `semantic-quant/` 薄模块，`selectivity-registry.mjs` 一行不动，杜绝 God Object 膨胀。
2. 引入跨 agent 稳定主键 `componentId` + `bindings` N:M 映射，表达"一个逻辑组件 = 多套 selector 集合"。
3. 产出**可序列化** `semantic-snapshot.json`（复用 `dom-snapshot.mjs` 已跑通的序列化模式）。
4. `verify-style` 增加**区域聚合 + 双通道报告**（hardErrors 阻断 / semanticWarnings 仅提示）。
5. 全部向后兼容：存量配置零改动，关闭语义层即回退现状。

**非目标**（明确不做）：

- 不做"三级量化语义体系"式大词重构；不重构 L0-L4 注入执行层。
- 不做生产管线 AI 主题合成（独立 Future Feature，另起 RFC，见附录 B）。
- 不新增适配器（黄金规则 #1，六适配器封顶不变）。
- 不修改 `selectivity-registry.mjs` 现有字段语义。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）—— 注入执行层本体不动，但引入附加语义层属于架构演进，按 RFC 流程评审
- [ ] 新增 UI 页面（突破六页封顶）
- [ ] 新增适配器（突破六适配器上限）
- [x] 修改核心数据模型 —— 新增可选元数据字段与独立索引，不破坏现有 manifest/schema（兼容旧版本）

---

## 3. 现状侦察（代码锚点）

| 锚点 | 说明 |
|------|------|
| `src/engine/src/runtime/selectivity-registry.mjs` | `SELECTOR_REGISTRIES`（6 agent 语义名 → fallback 链）、`isGeneratedClass`、`resolveSelector`、`semantic.controlled/nonControlled`、`collectNonControlledTopology` |
| `src/engine/src/runtime/semantic-filter.mjs` | `collectNonControlledSelectors`、`buildExclusionSelectors`、`buildSemanticMarkExpression` |
| `src/engine/src/runtime/verify-style.mjs` | `assessStyleCompliance`（Node 纯函数，平铺 samples）+ `STYLE_RUNTIME_SOURCE`（**toString 序列化进页面**的 IIFE） |
| `src/engine/src/runtime/dom-snapshot.mjs` | `buildDomSnapshotExpression`：已有 `schemaVersion:1` 可序列化快照先例（appId/capturedAt/landmarks/nodes） |
| `engines/<agent>/adapter.mjs` | `verification.rootAny/recommended`（与 registry 双份语义名的来源） |
| `scripts/check-injection-contract.mjs` | 不变量脚本模式：`fail()` 收集错误 → 非零退出 → gate `npm run check` |
| `scripts/check-architecture-boundaries.mjs` | C4 分层依赖方向检查（可扩展语义层依赖规则） |
| `src/engine/package.json` | `@agentskin/engine` v5，`"type": "module"`，`.mjs` 源码 + 手写 `.d.ts`（引擎非 TS 源码） |

---

## 4. 设计方案

### 4.1 四套强类型枚举（`semantic-quant/taxonomy.mjs` + `taxonomy.d.ts`）

引擎为 `.mjs` + `.d.ts` 模式，因此"强类型"= 运行时 `Object.freeze` 常量 + `.d.ts` union，ad-hoc 字符串编译期即失败。

```ts
// taxonomy.d.ts（示意）
export type UiArea =
  | "top-nav" | "sidebar" | "main-content" | "composer"
  | "overlay" | "status-bar" | "toast-layer" | "global-overlay" | "shell";

export type ComponentKind =
  | "container" | "button" | "input" | "dropdown" | "card"
  | "text" | "icon" | "divider" | "mask" | "scrollbar" | "list-item";

export type ComponentLayer =
  | "global" | "page" | "component" | "decoration" | "state";

export type RiskLevel = "high" | "medium" | "low";
```

`taxonomy.mjs` 侧为同名 `Object.freeze` 常量对象，作为运行时单源。

### 4.2 `componentId` 稳定性契约（必须，防快照产物隐性损坏）

1. **跟随「UI 业务语义概念」，不跟随 DOM 结构**。DOM 因版本漂移/重构变化（hash 类名变化正是 `selectivity-registry` fallback 链存在的意义）而业务概念不变时，`componentId` **不变**。例：traework 侧边栏 DOM 大规模重构，`componentId: "sidebar"` 保持不变。
2. **一旦发布（进入任何 snapshot 产物）即视为稳定标识**。重命名 = 破坏性变更。
3. **改名必须走弃用流程**：旧 `componentId` 保留为 alias（`deprecatedAliases: { oldId → newId }`），快照 `schemaVersion` 递增，消费方显式收到 deprecated 提示，≥ 2 个版本周期后移除。
4. snapshot 产物**必须携带 `schemaVersion`**（镜像 `dom-snapshot.mjs` 的 `schemaVersion:1` 模式）。

### 4.3 `COMPONENT_INDEX`（`semantic-quant/taxonomy.mjs` 内）

以 `componentId` 为主键，`bindings` 表达与 registry 条目的 N:M 映射：

```js
// 示意
export const COMPONENT_INDEX = {
  composer: {
    uiArea: "composer",
    componentKind: "input",
    componentLayer: "component",
    riskLevel: "high",
    bindings: [
      { agentId: "traework",  semanticName: "composer" },
      { agentId: "codex",     semanticName: "composer" },
    ],
  },
  // ...
};
```

**防维护成本转移的关键设计（derive-by-default）**：`semanticName` 本身已是稳定语义标识，因此**默认绑定自动派生**——凡 registry 中语义名命中规范语义名字典（`root/sidebar/workspace/composer/toolbar/messageList`…）者，自动生成 `componentId == semanticName` 的绑定；`COMPONENT_INDEX` **手写面仅限真正的 N:M 例外**（一个逻辑组件跨多个语义名、或一个语义名拆多个组件）。手写绑定面从"全部"收缩到"例外集"，漂移风险面同步收缩。

### 4.4 `buildSemanticSnapshot(agentId)` 纯函数（`semantic-quant/snapshot.mjs`）

- Node/CLI 侧**纯函数**：读 `COMPONENT_INDEX` + `SELECTOR_REGISTRIES`，产出可序列化 `semantic-snapshot.json`。
- 复用 `dom-snapshot.mjs` 的序列化模式（`schemaVersion` / `appId` / 时间戳 / 结构化数据）。
- **定位：实验性中间产物**（见 4.7），仅供 CLI 调试、诊断报告、编辑器预览。
- **永不进入注入 payload**：不内嵌 `STYLE_RUNTIME_SOURCE`，不参与 L0-L4 注入执行。

### 4.5 `verify-style` 改造：双通道报告（hardErrors / semanticWarnings）

**硬约束：`assessStyleCompliance` 与 `STYLE_RUNTIME_SOURCE` 一行不动。** 页面内采样逻辑保持原样（它会被 toString 序列化进页面，绝不能引入 semantic-quant 依赖）。

新增**主进程侧纯函数** `aggregateByRegion(samples, semanticSnapshot)`，返回：

```ts
{
  hardErrors: BlockingSampleFailure[];   // 来自真实 DOM 采样（assessStyleCompliance 结果）→ 阻断 CI
  semanticWarnings: CoverageWarning[];   // 来自 COMPONENT_INDEX 覆盖分析 → 仅提示，永不阻断 CI
}
```

**分级原则**：
- `hardErrors` = DOM 采样硬校验失败（注入后样式不达标）→ 阻断。
- `semanticWarnings` = 语义索引覆盖缺口（如 DOM 有组件但 COMPONENT_INDEX 未登记）→ **仅提示**。因为 Phase 1 元数据为人工 curate，索引落后于 DOM 是预期内状态，语义告警一律不得提升为 CI 错误，避免虚假告警干扰。

### 4.6 自动化防护（三道硬门禁 + 一致性校验）

**门禁 1｜双向一致性校验（新增 `scripts/check-semantic-contract.mjs`）**

复用 `check-injection-contract.mjs` 模式（`fail()` 收集 → 非零退出 → gate `npm run check`），断言：

- **正向**：`SELECTOR_REGISTRIES` 中每个 `(agentId, semanticName)` 必须被 ≥1 个 `componentId` 绑定（防"registry 加了条目但索引没登记"）。
- **反向**：`COMPONENT_INDEX.bindings` 引用的 `(agentId, semanticName)` 必须存在于 `SELECTOR_REGISTRIES`（防悬空引用）。
- **孤儿**：每个 `componentId` 必须 ≥1 个绑定（防空组件）。
- **key 白名单**：registry 每条 entry 仅允许 `{selectors, required, description, semantic}`（防 God Object 从字段层面复活）。

说明：**不复用 `check-injection-contract` 本体**——它断言的是 C1"AgentId 四源一致"这一不同不变量；新脚本遵循同一模式、同挂 `npm run check`，各自独立。

**门禁 2｜import 禁入规则（biome `noRestrictedImports`）**

- 禁止：注入执行层（`src/engine/src/runtime/` 下除 verify-style 外的模块、`adapters/`、`cdp/`、`injector/launcher/renderer-payload/skin/adaptive-observer/session-pool-runtime/css-var-bridge/preflight/baseline-snapshot/meta-*`）import `semantic-quant/*`。
- 白名单：`verify-style`、`scripts/` 工具、未来 Studio 消费层。

**门禁 3｜分层依赖方向（扩展 `check-architecture-boundaries.mjs` / C4）**

新增依赖方向规则：`semantic-quant` 只能被「报告消费层 / 工具层 / 编辑器层」依赖，注入执行层禁止反向依赖，违者 CI 红。

> 注：devDependencies 隔离方案**不适用**——`semantic-quant` 是 `@agentskin/engine` 内部模块，engine 整体被 vendored 进应用，无独立依赖边界可切。故采用门禁 2/3 的组合。

### 4.7 兼容与回滚

- **代码回滚**：删除 `semantic-quant/` 目录 + 回退 `verify-style` 新增函数 → 恢复原状，registry 无任何残留字段。
- **产物回滚**：`semantic-snapshot.json` 明确定位为**实验性产物，不保证向后兼容，禁止长期持久存储**；仅作调试/诊断中间产物，按"一次性生成、随版本重跑"使用；`schemaVersion` 随格式演进递增。
- **兼容开关**：语义层关闭时，注入管线行为与现状完全一致（因为注入执行层本就零依赖）。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | COMPONENT_INDEX 与 registry 配置漂移（registry 改了语义名/增删条目，索引未同步） | 🔴 | 任何 registry 变更后 | 门禁 1 双向一致性校验 | `check-semantic-contract.mjs`（CI 阻断） |
| 2 | 主管线隐性依赖 semantic-quant，关闭开关后崩溃 | 🟠 | 业务侧擅自 import | 门禁 2/3：禁入规则 + 分层方向 | Biome noRestrictedImports + boundaries 检查（CI 阻断） |
| 3 | 语义告警误导（索引漏登记 → 报"高风险缺失"但实际正常） | 🟠 | COMPONENT_INDEX 覆盖不全 | 双通道分级：semanticWarnings 永不阻断 CI | 报告通道独立输出（非阻断） |
| 4 | componentId 随意改名 → 旧快照/外部诊断脚本隐性损坏 | 🟠 | 迭代中改名 | 4.2 稳定性契约：弃用 alias 流程 + schemaVersion | 契约写入 RFC；review 强制项 |
| 5 | Phase 2 真实需求推翻 Phase 1 字段 shape | 🟡 | 未来消费者落地 | 元数据在独立文件，改 taxonomy 不触发 RFC#4 核心模型 | — |
| 6 | 枚举值覆盖不全（6 agent 真实组件超出枚举） | 🟡 | 首版 curate 后 | 枚举可增不可删（union 加法兼容）；附录 C 人工复核 | 人工复核项 7.1 |

---

## 6. 分批落地计划

| 批次 | 内容 | 验证方式 |
|------|------|----------|
| 1 | 四套枚举 + `taxonomy.mjs`/`taxonomy.d.ts` 骨架 + `check-semantic-contract.mjs`（含 key 白名单） | vitest 单测 + `npm run check` 绿 |
| 2 | `COMPONENT_INDEX` 首版（derive-by-default 派生 + 仅 N:M 例外手写）+ `buildSemanticSnapshot` + CLI dump 工具 | 快照产物人工抽查 + 一致性脚本通过 |
| 3 | `verify-style` 新增 `aggregateByRegion`（hardErrors/semanticWarnings 双通道）+ 报告输出 | 构造"索引漏登记"与"样式失效"两组 fixture 单测 |
| 4 | biome noRestrictedImports + boundaries 扩展 + ARCHITECTURE.md 更新 | 全量 `npm run check` 绿 + CI 冒烟 |

每批独立可合并主分支，互不阻塞。

---

## 7. 人工复核项

1. 枚举值是否覆盖 6 agent 实际组件（需人工过一遍 6 份 `adapter.mjs` + registry 全量条目）。
2. N:M 例外绑定清单人工确认（derive-by-default 覆盖不到的才手写）。
3. `riskLevel` 初始分级合理性（先按"改漏后视觉破坏度"粗分，后续迭代校准）。
4. `componentId` 初始命名与规范语义名字典对齐确认（避免发布后改名）。

---

## 8. 评审结论

（待评审人填写）

---

## 附录 A：Phase 2 触发条件（全部客观可机器检测）

| 信号 | 定义 | 检测方式 |
|------|------|----------|
| A | 非选择器消费者 import 原始 `SELECTOR_REGISTRIES` 对象 | import 扫描脚本 |
| B1 | 单条 `componentId` 的 bindings 数 ≥ 8（N:M 复杂度爆炸） | 静态计数 |
| B2 | `COMPONENT_INDEX` 条目数相对基线增长 > 50% 或绝对值 > 30 | 静态计数 |
| B3 | 连续 3 个版本语义告警覆盖率缺口率 > 20% | verify 报告聚合 |

（原草案"entry 变更理由类别 ≥ 5"为人工定性指标、不可自动化，**作废**，由 B1-B3 取代。）

## 附录 B：Future Scope（Phase 2 内容）

1. 薄模块晋升完整 `semantic-quant` 子系统，接入：Theme-Studio 语义快照可视化、本地诊断/报告工具（**明确：本地确定性工具，非 AI 合成**）。
2. 独立 Future RFC（不在本 RFC）：生产管线 AI 主题合成——当前主题管线为确定性 14-token 构建（`build-palette → generate-theme-css`），无 AI 合成步骤，若立项需单独评审。

## 附录 C：引用案例核验结论（供评审知悉）

### 第一轮引用（辩论阶段，全部失效）

| 引用 | 核验结果 |
|------|----------|
| blendcn | **真实存在**（curatedcode/blendcn），但为 shadcn token 映射器，不处理 DOM 选择器；原描述"DOM 选择器/元描述/风险拆分"系曲解 |
| uikit-theme-playground | **不存在**，引用作废 |
| mantine-theme | **不存在**（真实 mantinedev/mantine 的 Styles API 为组件内元素命名 + CSS 变量覆盖），引用作废 |
| tanstack/form 一致性 lint | 检索未证实到具体实现，但"中心化索引 + CI 一致性 lint"原则已被门禁 1 采纳，不依赖该引用成立 |

### 第二轮引用（自检后补充，2026-08-17 实检）

| 引用 | 仓库真实性 | 具体行为核验 | 判定 |
|------|-----------|--------------|------|
| grafana/grafana + `scripts/check-component-exports.ts` | 真实（`@grafana/ui` 组件库） | `check-component-exports.ts` 检索不到；仅 `packages/grafana-ui` 组件库本体可核实 | ❌ 行为编造 |
| radix-ui/primitives | 真实 | 弃用模式真实（as→asChild、props 弃用、breaking 大版本 + 迁移指南）；"组件 DOM 标识保留别名过渡"检索不到 | 🟡 部分成立 |
| vuejs/core + `.eslintrc-base.js` no-restricted-imports | 真实 | vuejs/core 自身配置检索不到；no-restricted-imports 模块边界为生态通用模式（他项目在用） | ❌ 行为编造 |
| microsoft/vscode experimental 快照 | 真实 | "experimental 快照 JSON + schemaVersion + 不持久存储"零命中（仅 enableExperiments 遥测机制） | ❌ 行为编造 |
| tailwindlabs/tailwindcss error vs warn | 真实 | v4 区分致命 error（Unknown utility → critical，阻断构建）与可忽略警告；"元数据不全不升级"系演绎 | ✅ 基本成立 |

### 核验结论

1. 两轮引用均**不影响本 RFC 设计成立**：三道门禁（双向一致性校验 / import 禁入 / 分层方向）全部复用项目自身 `check-*` 不变量体系（C1-C7）与 Biome 既有能力，不依赖任何外部仓库引用。
2. 教训已记录：技术辩论中"论点合理"与"论据真实"必须分开核验；引用外部项目前必须检索确认「仓库 + 文件路径 + 具体行为」三者俱全。后续引用一律先检索、再采用。
