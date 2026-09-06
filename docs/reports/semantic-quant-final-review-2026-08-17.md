# semantic-quant 最终方案核查报告（对老板落地方案的第二轮代码级审查）

> 日期：2026-08-17
> 审查对象：《semantic-quant 最终落地方案》（6 文件完整代码）
> 审查方法：逐文件对照真实代码库核查 import 路径、依赖模块、工具链约束、运行时行为
> 结论速览：**设计方向全部认可（含老板自审的 5 项 P1/P2/P3）；但"可直接复制使用"不成立——有 5 个复制即崩的 bug（A 级）+ 3 个设计回归（B 级）+ 验收标准笔误。**

---

## A. 致命级（按方案原样复制，运行即报错）

### A-1 缺失 import（两处 ReferenceError）

| 文件 | 现象 | 修复 |
|------|------|------|
| `semantic-snapshot.mjs` | 用了 `SELECTOR_REGISTRIES[agentId]` 但**未 import**（顶部只 import 了 engineVersion / TAXONOMY_SCHEMA_VERSION / COMPONENT_INDEX） | 补 `import { SELECTOR_REGISTRIES } from "./selectivity-registry.mjs";` |
| `check-semantic-contract.mjs` | `checkDeprecatedIdsUsage()`/`checkBindingsMisuse()` 用了 `COMPONENT_INDEX` 但**未 import**（只 import 了 DEPRECATED_ALIASES / TAXONOMY_SCHEMA_VERSION） | 补 `import { COMPONENT_INDEX, DEPRECATED_ALIASES, TAXONOMY_SCHEMA_VERSION } from ".../taxonomy.mjs";` |

### A-2 相对路径错误（文件树与 import 路径不一致）

方案文件树把 `semantic-resolve.mjs` / `semantic-snapshot.mjs` 放 `runtime/`、`taxonomy.mjs` 放 `semantic-quant/`，但代码里写 `./taxonomy.mjs`：

| 文件 | 实际位置 | 当前 import | 修正 |
|------|----------|-------------|------|
| semantic-resolve.mjs | runtime/ | `./taxonomy.mjs` | `../semantic-quant/taxonomy.mjs` |
| semantic-snapshot.mjs | runtime/ | `./taxonomy.mjs` | `../semantic-quant/taxonomy.mjs` |
| verify-style.mjs | runtime/ | `./semantic-quant/taxonomy.mjs` | `../semantic-quant/taxonomy.mjs` |

### A-3 `./adapter-utils.mjs` 不存在

`scripts/` 下**没有** adapter-utils.mjs（已 ls 核实）。真实适配器加载源是现成的：

```js
// 用现有模块，不要新建 adapter-utils
import { listAdapters, getAdapter } from "../src/engine/src/adapters/index.mjs";
// listAdapters() → 6 个 adapter 对象（含 verification 字段）
```

### A-4 ESLint 自定义规则无执行宿主（最关键，且影响 P1-1 修复方向）

三个事实（均已核实）：

1. **项目没有 ESLint**——工具链是 Biome（AGENTS.md：`Biome + Vitest`），根目录无任何 eslint 配置；
2. **biome.json `files.includes` 明确排除 `"!**/src/engine"`**——semantic-quant / verify-style 所在的整个 engine 目录**不在任何 linter 管辖内**；
3. 规则本体用 `module.exports`（CJS），而项目是 `"type": "module"`（ESM）——就算装了 ESLint 也会挂。

**结论**：`eslint-rules/no-future-enum.js` 这条路在当前工具链下**跑不到任何 engine 代码**。老板自审 P1-1 的修复方向（AST 解析 @future）不解决根问题——不是"规则怎么写"，是"规则在哪跑"。修正方案见 B-1。

### A-5 `resolved: registry[componentId]` 对 `message-list` 恒为 null

registry 的 key 是 camelCase `messageList`（doubao），componentId 是 kebab-case `message-list` → `registry["message-list"]` 直接 undefined。

**根因**：derive-by-default 需要一个 **componentId → semanticName 显式映射步骤**，不能靠"名字恰好相等"。修正：

```js
// semantic-quant/taxonomy.mjs 增加派生映射（单一数据源）
export const COMPONENT_ID_TO_SEMANTIC_NAME = Object.freeze({
  root: "root", sidebar: "sidebar", workspace: "workspace",
  composer: "composer", toolbar: "toolbar", "message-list": "messageList",
});

// snapshot 内改为
const semanticName = COMPONENT_ID_TO_SEMANTIC_NAME[componentId];
resolved: semanticName ? registry[semanticName] ?? null : null,
```

（这也正是复核报告 §7 决策点 1 的落地：kebab-case 唯一非同名派生 `message-list → messageList`。）

## B. 设计回归（不崩，但违背 RFC 门禁拓扑）

### B-1 预留枚举守卫的执行宿主（替换 A-4 方案）

**把守卫并入 `check-semantic-contract.mjs`**（npm run check 天然执行点，也是唯一能扫 engine 源码的机制），单一数据源仍在 taxonomy：

```js
// taxonomy.mjs 新增导出（老板 P1-1 自审的"方案2"——采纳）
export const FUTURE_RESERVED_UI_AREA = [UI_AREA.OVERLAY, UI_AREA.STATUS_BAR, UI_AREA.TOAST_LAYER, UI_AREA.GLOBAL_OVERLAY];
export const FUTURE_RESERVED_COMPONENT_KIND = [COMPONENT_KIND.BUTTON, /* ...9 个预留 */];
export const FUTURE_RESERVED_COMPONENT_LAYER = [COMPONENT_LAYER.GLOBAL, COMPONENT_LAYER.DECORATION, COMPONENT_LAYER.STATE];
```

check 脚本新增规则：glob 扫 `src/engine/src/**/*.mjs`（排除 semantic-quant/ 自身、*.test.ts），正则匹配 `UI_AREA\.OVERLAY` 等成员访问与 import 说明符，命中即 error。**不依赖 AST，不依赖 ESLint，规则自动跟随 taxonomy 导出**。

### B-2 新模块放置回归：semantic-resolve / semantic-snapshot 应留在 semantic-quant/

老板方案把它们放 `runtime/`——但 `runtime/` 是注入执行目录，正是 RFC 门禁 2 的"禁止 import semantic-quant"的禁区边界。放 runtime/ 会让边界规则变糊（未来 injector 顺手 import 的物理距离更近）。**修正文件树**：

```
src/engine/src/semantic-quant/
├── taxonomy.mjs           # 枚举 + COMPONENT_INDEX + DEPRECATED_ALIASES + FUTURE_RESERVED_* + ID→语义名映射
├── semantic-resolve.mjs   # 移入 semantic-quant/（import ./taxonomy.mjs 即可）
├── semantic-snapshot.mjs  # 移入 semantic-quant/（import ./taxonomy.mjs + ../runtime/selectivity-registry.mjs）
└── index.mjs              # 统一导出
src/engine/src/runtime/
├── verify-style.mjs       # 改造（import ../semantic-quant/taxonomy.mjs —— 门禁 2 白名单内）
└── selectivity-registry.mjs  # 不动
scripts/
└── check-semantic-contract.mjs  # 修正 import + 动态根路径
```

（取消根目录 `eslint-rules/` 目录——无宿主。）

### B-3 RISK_LEVEL 的 JSDoc"分级规则"不可计算

"high：required=true…；medium：面积 > 20% 视口"——taxonomy 是**静态数据阶段，没有视口面积数据**，此规则无输入可算。riskLevel 是人工 curate 元数据（复核报告 §6 已给初始值）。建议：删 P1-3 的 `RISK_LEVEL_MAP` 的同时，把 JSDoc 伪规则改为如实表述"人工 curate，依据复核报告 §6"。

## C. 对老板自审 5 项的裁定（全部成立，2 项修正实施目标）

| 项 | 裁定 | 实施修正 |
|----|------|----------|
| P1-1 ESLint 硬编码成员 | ✅ 认，但修复目标是**换宿主**（见 A-4/B-1），不是改规则写法 | 守卫并入 check-semantic-contract + taxonomy 导出 FUTURE_RESERVED_* |
| P1-2 快照缺 `>` 分支 | ✅ 完全认，标准实践（Zustand/TanStack persist 迁移） | 补分支，且明确 `>` 为"旧引擎读新快照，拒绝"（A 级必修） |
| P1-3 RISK_LEVEL_MAP 冗余 | ✅ 认，删 | 连 JSDoc 伪规则一起改为人工 curate 表述 |
| P2-4 废弃 id 只扫 bindings | ✅ 认 | check 脚本 glob 扫源码字符串命中 `listDeprecatedIds()` |
| P2-5 缺单测清单 | ✅ 认 | 见 §E |
| P3-1 硬编码 import 路径 | ✅ 认 | 照 check-injection-contract 的 `join(dirname(fileURLToPath(import.meta.url)), '..')` 动态根 |
| P3-2 assessStyleCompliance 缺 JSDoc | ✅ 认 | 补签名注释（原函数已有部分注释，需补入参约束） |

## D. 老板方案里做对了的点（不重复审查，直接保留）

1. 双版本字段（engineVersion 仅备注 / taxonomySchemaVersion 用于解析）——正确修复"版本号语义混淆"；
2. `resolveComponentId` 契约消费骨架——正确修复"契约空壳化"，弃用表与消费代码成对；
3. check 脚本"语义名对齐、不校验选择器字符串"——正确去噪，避免虚假警告；
4. bindings 非空即 error（Phase 1 禁止）——正确防误用。

## E. 最小单元测试清单（P2-5 落地，新增至验收标准）

| # | 模块 | Case | 期望 |
|---|------|------|------|
| 1 | resolveComponentId | 正常 id "sidebar" | `{id:"sidebar", deprecated:false}` |
| 2 | resolveComponentId | 弃用 id（注入 DEPRECATED_ALIASES 后） | `{id:新id, deprecated:true, replacedBy:新id}` + warn 输出 |
| 3 | resolveComponentId | 不存在 id | 原样返回 `{id, deprecated:false}`（不抛错） |
| 4 | isDeprecated / listDeprecatedIds | 空表初始态 | false / [] |
| 5 | buildSemanticSnapshot | 正常 agentId | 含 engineVersion + taxonomySchemaVersion + 6 组件；`message-list.resolved` 非 null（回归 A-5） |
| 6 | buildSemanticSnapshot | 不存在 agentId | 返回 null |
| 7 | validateSnapshotCompatibility | snapshotVersion < current | incompatible + reason |
| 8 | validateSnapshotCompatibility | snapshotVersion == current | compatible |
| 9 | validateSnapshotCompatibility | snapshotVersion > current | incompatible + reason（回归 P1-2） |
| 10 | check-semantic-contract | bindings 非空 | 退出码 1 |
| 11 | check-semantic-contract | verification.recommended 引用 registry 不存在的 name | 退出码 1 |
| 12 | 未来枚举守卫 | 源码引用 `UI_AREA.OVERLAY` | error；引用 `UI_AREA.SIDEBAR` 不报 |

（10-12 为脚本级测试：vitest 内 `spawnSync(node script)` 断言退出码 + 输出。）

## F. 验收标准勘误（老板方案 §五）

- 第 2 项：`semantic-resnapshot.mjs` 拼写错误 → `semantic-snapshot.mjs`；
- 第 2 项路径与 B-2 修正后的文件树对齐。

## G. 结论

老板方案的**设计骨架是好的，自审的 5 项也全部正确**；但落地前必须修 5 个 A 级 bug（缺失 import ×2、路径 ×3、adapter-utils 不存在、ESLint 无宿主、message-list 恒 null）+ 3 个 B 级回归（守卫宿主、模块放置、伪规则 JSDoc）。**修完即达"可直接落地"标准。** 按 B-2 文件树 + E 清单执行即可。
