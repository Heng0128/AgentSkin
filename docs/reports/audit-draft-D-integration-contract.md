# 集成点契约审计报告（D 稿）

> 审计范围：4 大集成点（AGENT_REMAP 同步、adapter.verification 与 COMPONENT_INDEX 契约、局部 token 覆写下的 verify-style 适配、cdp-full-extract 与 verify-style 闭环）。
> 方法：静态代码审计，逐条比对源文件证据，不作任何代码修改。
> 日期：2026-08-17

---

## 10. AGENT_REMAP 与 cdp-full-extract 集成

### 10(a). 脚本能力边界：仅告警发现 vs 自动完成映射

**结论：脚本缺乏明确能力边界声明，且确实无法自动完成 AGENT_REMAP 映射。**

证据链：

1. `build-theme-package.mjs` (L69-L100) 的 `AGENT_REMAP` 是一个**完全硬编码**的静态映射表——每个 agentId 对应一个手写的原生 token 数组。该脚本的 `buildAgentCss()` 函数 (L487-L514) 在构建时直接读取 `AGENT_REMAP[agentId]` 并逐条应用 `valueForToken()` 转换。

2. `cdp-full-extract.mjs` (L22-L28) 仅通过 `AGENT_PORTS` 常量提取运行时 CSS 变量，输出到 `${agentName}-full-extract.json`。但 extract 的两个核心函数 `extractVariablesFromCss()` (L145-L168) 和 `extractVariablesWithMedia()` (L205-L244) 只按主题 scheme（dark/light/neutral）分类输出，**不做原生 token → agentskin 语义角色的归类**。

3. `valueForToken()` (L343-L353) 使用启发式优先级规则数组 `TOKEN_RULES`（L244-L339）做模式匹配——基于 token 名称子串（`includes('sidebar')`、`includes('hover')` 等）。这种方法的语义归类准确性完全依赖命名约定，无法处理语义反转或命名漂移。

**契约缺口 G10.1**：`build-theme-package.mjs` 没有声明"脚本仅做告警发现"的能力边界。其 JSDoc (L4-L28) 仅描述产物格式，未提及 AGENT_REMAP 的维护模式。当新版本 Agent 应用新增/重命名 token 时，build-theme-package 既不做版本检测也不做 diff 对比——它只会静默地将未知 token 回退到 `--agentskin-bg`（L352 末行 fallback）。

**风险等级：HIGH**

- 若 traework 将 `--vscode-sideBar-background` 重命名为 `--trae-nav-bg`，`valueForToken()` 的 `includes('sidebar')` 规则将不再命中，该 token 会走 `bg/background` 泛化分支映射到 `--agentskin-bg`（不透明色），导致侧栏失去半透明 hero 透出效果。该问题在构建期无任何告警。

### 10(b). 6 Agent 场景下提取输出的隔离机制

**结论：cdp-full-extract 有进程级物理隔离，但 build-theme-package 缺乏对 extract 产物消费时的语义隔离。**

证据链：

1. `cdp-full-extract.mjs` 的 `extractAgent()` (L790-L1026) 按 agentName 写入独立文件 `${agentName}-full-extract.json`，且在 `--all` 模式逐个串行调用——**物理隔离充分**。

2. 但 `build-theme-package.mjs` 的 `buildThemePackage()` (L723-L742) 入口仅接收 `request.agentId` 字符串，并不读取任何 extract 产物。AGENT_REMAP 的 token 列表是预置的，不依赖运行时提取。因此 **extract 与 builder 之间不存在数据流管道**——两者是独立的离线工具，共享的唯一桥梁是人工维护。

3. `analyze-structure-compare.mjs` 在对比模式下 (L809-L898) 通过 `asar.listPackage()` 读取每个 Agent 的独立安装包——asar 路径由 `discoverApp()` (L800-L806) 按 adapter 解析——物理隔离同样充分。

**契约缺口 G10.2**：extract → builder 之间没有 manifest 级别的"已消费 token 清单"。如果在 6 Agent 并行提取场景中需要手动维护 AGENT_REMAP，人工跨 Agent 复制粘贴时可能将 AgentA 的 token 混入 AgentB 的列表——**唯一的防护是开发者纪律**，没有程序化校验。

**风险等级：MEDIUM**

- 实际风险受开发者流程约束。但如果未来引入自动化 AGENT_REMAP 生成（如从 extract 产物自动推导），缺乏 triple 校验将导致静默错配。

### 方案推演（G10.1 / G10.2）

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. 静态快照校验 | 在 `npm run check` 中新增一步：对比 cdp-full-extract 输出与 AGENT_REMAP 的覆盖率差异，diff 超阈值告警 | 中——需持久化基线 JSON | 推荐 |
| B. manifest 内嵌提取指纹 | 在 `manifest.json` 的 `probe` 字段记录 AGENT_REMAP 哈希，应用运行时校验 | 低——仅增加元数据 | 辅助 |
| C. 完全从 extract 生成 AGENT_REMAP | 去除硬编码，每次 studio export 前强制跑 cdp-full-extract 自动归类 | 高——需解决语义归类准确性 | 不推荐（Phase 1 不可行） |

---

## 11. adapter.verification 与 COMPONENT_INDEX 契约校验

### 11(a). 语义名拼写错误 / 未登记组件名是否阻断构建

**结论：`check-semantic-contract.mjs` 的校验失败（`fail()` + `process.exit(1)`）会阻断 `npm run check`，间接阻断构建流水线。但组件名未登记仅影响 verify-style 的风险分级，不直接阻断。**

证据链：

1. `check-semantic-contract.mjs` 的 `fail()` (L51-L53) 将错误累积到 `errors[]`，最终 `process.exit(1)` (L303)。脚本文档 (L6) 明确声明 "Exits non-zero on violation so it can gate `npm run check`"。

2. 校验规则 [1] (L62-L85) `checkSemanticNameAlignment()`：遍历每个 adapter 的 `verification.recommended`，检查 name 是否存在于 `SELECTOR_REGISTRIES`——**缺失即 fail**。举例：若 `traework.mjs` 的 verification 出现 `{ name: "sidebár", any: [...] }`（拼写错误），而 registry 仅登记 `"sidebar"`，则 `fail('[1] traework.verification.recommended.sidebar 在 registry 中不存在')`。

3. 校验规则 [2] (L91-L114) `checkBidirectionalConsistency()`：registry 的每个 semanticName 必须被 `SEMANTIC_NAME_TO_COMPONENT_ID`（派生自 `COMPONENT_ID_TO_SEMANTIC_NAME`）覆盖。**但注意跳过 `root`** (L95 `if (semanticName === 'root') continue`)。若 registry 中出现 COMPONENT_INDEX 未登记的组件名（如某 Agent 独有的 `"command-palette"`），会在此处 fail。

4. 未登记组件名在 verify-style 中的表现见 `aggregateByRegion()` (verify-style.mjs L212-L225)：当 componentId 无法在 `COMPONENT_INDEX` 中找到 meta 时，回退 `riskLevel = RISK_LEVEL.MEDIUM` (L216)。这意味着**未登记组件永远无法产生 hardError**——即使该组件的视觉破坏度本应评为 HIGH。

**契约缺口 G11.1**：`check-semantic-contract.mjs` 仅校验 verification.recommended 与 registry 的对齐，但**不校验 verification 内联的 `any` 选择器字符串是否在运行时实际可达**。拼写错误在 `name` 字段层面可被检出，但 `any` 数组中的选择器错误只能依赖 `analyze-structure-compare.mjs` 的运行时 probe 发现——而该脚本默认不在 `npm run check` 中运行（需实时 CDP 连接）。

**风险等级：MEDIUM**

- 安全网覆盖 name 但不覆盖选择器字符串。若 `.task-list-base` 因 TRAE 更新变成 `.task-panel-base`，仅在 name 层面对齐的校验不会发现问题。

### 11(b). COMPONENT_INDEX 是否支持每 Agent 扩展自定义组件

**结论：COMPONENT_INDEX 是全局固定集合——不支持每 Agent 扩展。registry 允许每 Agent 拥有独有组件名，但这些独有名字必须回退到 COMPONENT_INDEX 的全局定义才能参与 verify-style 分级。**

证据链：

1. `taxonomy.mjs` (L182-L225) 的 `COMPONENT_INDEX` 是 `Object.freeze()` 的硬编码对象，仅 6 条（root / sidebar / workspace / composer / toolbar / message-list）。没有 merge 或 extend 机制。

2. `COMPONENT_ID_TO_SEMANTIC_NAME` (L234-L241) 定义 componentId → registry 语义名的映射，同样是冻结的静态对象。

3. 在 registry（selectivity-registry.mjs L47-L329）中，不同 Agent 拥有不同的组件集合：
   - `traework`: root, sidebar, workspace, composer, toolbar（5 个）
   - `codex`: root, sidebar, composer, workspace（4 个）
   - `doubao`: root, sidebar, messageList, composer（4 个）
   - `workbuddy`: root, sidebar, workspace, composer, toolbar（5 个）
   - `qoderwork`: root, sidebar, workspace, composer（4 个）
   - `zcode`: root, sidebar, composer, workspace（4 个）

   其中 `messageList` 仅存在于 doubao 的 registry，但 ` COMPONENT_INDEX` 中登记的是 `'message-list'`（kebab-case）。

4. 当 registry 中出现 COMPONENT_INDEX 未覆盖的组件名时（假设某 Agent 新增 `"command-palette"`），`checkSemanticContract` 的规则 [2] 将在 `npm run check` 中 fail——阻止新增，除非同步修改 taxonomy.mjs。

**契约缺口 G11.2**：每 Agent 无法在不修改全局 `taxonomy.mjs` 的前提下引入自定义风险组件。如果 workbuddy 的 `"toolbar"` 需要设为 HIGH（因其包含核心导航），而 traework 的 `"toolbar"` 仅为 MEDIUM，目前架构无法区分——它们共享同一个 componentId `"toolbar"` 和同一份 COMPONENT_INDEX 记录。

**风险等级：MEDIUM**

- Phase 1 下影响有限（6 个组件覆盖当前需求），但未来 Phase 2 Agent 差异化的组件风险评级需求将直接撞上这个全局约束。

### 方案推演（G11.1 / G11.2）

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. 选择器存活校验 | 在 `analyze-structure-compare.mjs` 增加 `--ci` 模式，作为 `npm run check` 的可选子步骤（CDP 可用时执行） | 中——需 CI 环境 Agent 应用安装 | 推荐（Phase 2） |
| B. Agent 级 riskLevel 覆盖 | COMPONENT_INDEX 改为支持 per-agent override 的合并结构：`{ componentId: { default: 'high', overrides: { traework: 'medium' } } }` | 低——纯数据结构改动 | 推荐 |
| C. registry 风险标注 | 在 selectivity-registry 的 entry 中增加 `riskLevel` 字段，覆盖 COMPONENT_INDEX 全局值 | 低——但增加维护面 | 不推荐（duplicate source of truth） |

---

## 12. verify-style tokens 来源与局部 token 覆写场景

### 12(a). 扁平 tokens 结构是否会丢失局部覆写信息

**结论：是的——`assessStyleCompliance()` 的输入结构 `{key, color, bg, border}` 仅做扁平采样，完全丢失组件局部 token 覆写信息。仅比较全局 `:root` 期望 token 与运行时计算样式。**

证据链：

1. `verify-style.mjs` (L132-L166) `assessStyleCompliance()` 的签名：
   ```
   samples: { key, color?, bg?, border? }[]
   tokens: { text?, surface?, border? }
   ```
   其中 `tokens` 是期望的全局 palette 值（从主题 manifest 的 `colors` 字段派生的 text/surface/border），`samples` 是运行时采样的计算样式。

2. 判定逻辑 (L139-L163)：对每个 sample 的每个属性调用 `matchesToken(actual, expected, tolerance)`——其中 `expected` 永远来自全局 `tokens`。如果某组件在局部覆写了 `--vscode-xxx` 变量（如将 `--vscode-sideBar-background` 覆写为不透明色以表示"激活状态"），该覆写后的运行时值将与 `tokens.surface`（半透明 hero 期望值）比较，判定为 miss。

3. `aggregateByRegion()` (L198-L226) 按 componentId 聚合 samples。通过 `SEMANTIC_NAME_TO_COMPONENT_ID[sample.key]` 将运行时 key 映射到 componentId。但**映射过程仅做 key→componentId 转换，不携带任何局部 token 上下文**。

4. 浏览器内注入的 `STYLE_RUNTIME_SOURCE` (L233-L241) 仅是 Node 侧纯函数的 `toString()` 序列化副本——同样不携带局部 token 上下文。

**契约缺口 G12.1**：当 Agent 应用存在组件级 CSS 变量覆写（如 JetBrains Rider 的 `@theme-inline` 模式，或 VS Code 的 `--vscode-list-activeSelectionBackground` 在特定状态下被局部覆写），verify-style 将其误判为"主题未生效"——产生 false-positive hardError / semanticWarning。

实际案例：`traework.mjs` 的 `bridge` 配置 (L97-L112) 中 `--vscode-sideBar-background` 被设为 `alpha: 0.15` 透明混合。如果 TRAE 在侧栏激活状态局部将该变量覆写为 `alpha: 1.0` 不透明色，verify-style 将永远将该侧栏节点计入 miss。

**风险等级：HIGH**

- 当前 6 个 Agent 中，`workbuddy` 和 `traework` 在 bridge 配置中大量使用 `alpha` 修饰，局部覆写的误判风险最高。

### 12(b). 如何区分"全局主题不生效"与"组件局部覆写"

**结论：当前 verify-style 的机制完全无法区分这两种情况。它仅输出"miss 属性列表"，不包含"miss 原因"维度。**

证据链：

1. `assessStyleCompliance()` 的返回结构 (L126-L131) 仅包含 `{pass, matchRatio, judged, misses: {key, props}[]}`。`misses` 数组只记录 {采样key, 未命中属性名}——**无分类维度（全局未生效 vs 局部覆写）**。

2. `aggregateByRegion()` 进一步将 miss 映射到 `{componentId, riskLevel, pass, matchRatio, judged, misses}` 条目，按 `riskLevel` 分流进 `hardErrors` / `semanticWarnings`——但分流依据仅是 COMPONENT_INDEX 中预标的 riskLevel，**与 miss 的实际语义原因无关**。

3. `selectivity-registry.mjs` 中的 `SemanticControlConfig` (L23-L29) 定义了 `nonControlled` 字段（不应被主题覆盖的子选择器），但该字段仅在本注册表层面标记"哪些子节点应被排除"——**不向 verify-style 传达**。verify-style 不导入 selectivity-registry。

**契约缺口 G12.2**：`nonControlled` 信息停留在 selectivity-registry，verify-style 不知道哪些节点有意不跟随主题。因此 verify-style 无法区分：
   - 主题注入器未到达该节点（bug 或选择器失效）
   - 该节点被 `nonControlled` 标记故意排除（预期行为）
   - 该节点被 Agent 运行时局部覆写（动态状态）

三种语义被合并为同一种 `miss` 输出。

**风险等级：MEDIUM**

- 对 CI 门禁影响有限（依赖人工审核语义），但增加故障诊断成本——开发者需人工判断每条 miss 是"真问题"还是"预期行为"。

### 方案推演（G12.1 / G12.2）

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. nonControlled 透传 | 在 verify-style 的 componentId 解析后，查询 selectivity-registry 的 `nonControlled` 拓扑，自动排除标注节点 | 低——跨模块查询已有先例 | 推荐 |
| B. 原因分类 miss | 在 assessStyleCompliance 返回中增加 `missReason` 维度（`notApplied` / `locallyOverridden` / `nonControlled`），依赖 componentId 上下文判定 | 中——需预构建非受控节点集合 | 推荐 |
| C. 容差区分策略 | 为"已知可被覆写的组件"使用更宽松的 tolerance，而非统一 0.08 | 低——可能掩盖真问题 | 不推荐（护栏失效） |

---

## 13. cdp-full-extract 与 verify-style 闭环

### 13(a). 如何保证 extract 产物、manifest 配置、adapter 三者严格一一对应

**结论：当前缺乏严格的一一对应保证。三者的关联依赖人工维护的 agentId 字符串匹配，没有程序化 triple 校验。**

证据链：

1. **extract 产物**：`cdp-full-extract.mjs` 输出文件名 `${agentName}-full-extract.json`，meta 字段含 `agent: agentName` 和 `port` (L929-L933)。产物仅做信息性归档——**不与任何 manifest 或 adapter 配置做 build-time 交叉校验**。

2. **manifest 配置**：`build-theme-package.mjs` 的 `buildManifest()` (L632-L678) 生成 manifest 时，通过 `supportedAgents: [agentId]` (L664) 和 `targets: { [agentId]: { css, verification } }` (L653-L656) 绑定到单一 agentId。但 `agentId` 仅来自 `request.agentId` 字符串输入（L724）——**任何字符串均可传入**，没有验证该 agentId 是否在 adapters 注册表中存在。

3. **adapter 配置**：`adapters/index.mjs` 通过 `Map<adapter.id, adapter>` 注册表管理 6 个 adapter。`getAdapter(id)` (L14-L19) 在未知 id 时抛错——但这只在 apply 时触发，不在 theme package 构建时触发。

4. **关键断点**：
   - `build-theme-package.mjs` 不调用 `listAdapters()` 或 `getAdapter()` 验证 agentId 合法性。
   - `build-theme-package.mjs` 不读取 `adapter.verification` 来构建 manifest 的 verification 字段——它使用自己的 `VERIFICATION` 常量 (L194-L200)。
   - `adapter.verification` (如 traework L113-L125) 与 `VERIFICATION` (L195: `{ name: 'solo-shell', any: ['.panel-container', '.solo-lite-lite-layout'] }`) 的 selector 字符串不完全一致——**adapter 的选择器是运行时 probe 的权威源，VERIFICATION 是 manifest 级别的简化版**，两者无人校验一致性。
   - extract 产物 (`*-full-extract.json`) 中的运行时 CSS 变量清单 **不与 manifest 的 `AGENT_REMAP` 做自动 diff**。

**契约缺口 G13.1**：
- 如果使用 `build-theme-package.mjs` 时传入 `agentId: "træework"`（拼写错），脚本不会报错——它仅会走 `HOST_SELECTOR[agentId]` 回退到 `html.agentskin-host-træework body` (L499) 的通用选择器，且 `AGENT_REMAP[agentId]` 返回空数组 (L500 `|| []`)——最终产出的主题包不含任何原生 token remap，将是一个"空白主题"被安装到错误位置。
- extract → adapter 的 bridge variables 一致性依赖 `analyze-structure-compare.mjs` 的 `bridgeMissing` 检测 (L1106-L1119)，但该脚本需实时 CDP + 静态 asar 双源输入，无法在 `npm run check` 中默认运行。

**风险等级：HIGH**

- 数据错配可能在以下链路发生：人工维护 AGENT_REMAP 漏掉某 token → 构建出不含该 token 的主题包 → 安装到 Agent 后该 token 保持原色 → 主题不完整但 verify-style 在 tolerance 0.08 范围内可能不报错（若原色恰好在 tolerance 范围内）。

**跨 Agent 数据错配风险矩阵**：

| 场景 | 触发条件 | 后果 | 检测机制 |
|------|---------|------|---------|
| agentId 拼写错误 | 传入不存在的 agentId | 空白 remap / 错误 host selector | 无——build-theme-package 不做合法性校验 |
| AGENT_REMAP 跨 Agent 污染 | 手工复制时混入其他 Agent 的 token | 主题包声明不存在的 CSS 变量（静默失效） | 无——CSS 引擎忽略未知变量 |
| adapter.verification 与 manifest VERIFICATION 漂移 | adapter 选择器更新但 VERIFICATION 未同步 | manifest verification 永远 pass 但实际样式未生效 | 无——两者独立维护 |
| extract → AGENT_REMAP 未跟随更新 | Agent 版本升级移除 token | 主题包声明已被移除的变量（静默失效） | analyze-structure-compare 检测 bridgeMissing |
| registry semanticName 与 COMPONENT_INDEX 非同步扩展 | Agent 新组件名只在 registry 不在 COMPONENT_INDEX | verify-style 对未登记组件只能给 MEDIUM（语义警告），无法提级为 HIGH | check-semantic-contract 规则 [2] 会阻断 registry 拓展 |

### 方案推演（G13.1）

| 方案 | 描述 | 复杂度 | 推荐 |
|------|------|--------|------|
| A. agentId 合法性校验 | `buildManifest()` 入口调用 `getAdapter(agentId)` 校验，未知 id 直接 fail | 低——一行代码 | 强烈推荐 |
| B. adapter.verification 与 manifest VERIFICATION 合并为单一源 | manifest 的 verification 直接引用 adapter.verification 而非独立常量 | 低——修改 buildManifest 引用 | 推荐 |
| C. 引入 triple hash 校验 | 构建时将 adapter.verification hash + AGENT_REMAP hash + adapter.id 写入 manifest，运行时校验一致性 | 中——需 manifest schema 扩展 | 推荐（Phase 2） |
| D. extract 产物消费证明 | 在 build-theme-package 中可选消费 extract JSON 做 diff 对比，输出"未覆盖 token 清单" | 中——需提取产物常可用 | 推荐（作为诊断工具） |

---

## 综合契约缺口清单

| 编号 | 集成点 | 缺口描述 | 风险 | 紧急度 |
|------|--------|---------|------|--------|
| G10.1 | AGENT_REMAP | 脚本无能力边界声明；token 重命名/新增时静默回退无告警 | HIGH | Phase 1 |
| G10.2 | AGENT_REMAP | extract ↔ builder 无数据流管道；人工维护跨 Agent 可能错配 | MEDIUM | Phase 2 |
| G11.1 | verification↔COMPONENT_INDEX | name 对齐有校验但选择器字符串可达性无校验 | MEDIUM | Phase 2 |
| G11.2 | COMPONENT_INDEX | 不支持 per-agent riskLevel override；新组件需改全局 | MEDIUM | Phase 2 |
| G12.1 | verify-style 输入结构 | 扁平 samples 不携带局部 token 上下文；局部覆写被误判为 miss | HIGH | Phase 1 |
| G12.2 | verify-style 风险分级 | 无法区分"全局未生效"与"局部覆写"——miss 输出无原因分类 | MEDIUM | Phase 2 |
| G13.1 | extract↔manifest↔adapter triple | 无程序化 triple 校验；agentId 拼写错误无拦截；adapter.verification 与 manifest VERIFICATION 独立维护 | HIGH | Phase 1 |

---

## 推荐修复优先级

**Phase 1（立即）**：
1. **G13.1-A**：`build-theme-package.mjs` 入口调用 `getAdapter(agentId)` 做合法性校验——一行代码阻断最高风险。
2. **G10.1-A**：在 `npm run check` 中增加 AGENT_REMAP 覆盖率静态校验脚本，对比 extract 产物与硬编码映射的 diff。
3. **G12.1-A**：verify-style 在解析 componentId 后查询 selectivity-registry 的 `nonControlled` 拓扑，从采样比对中排除——避免将预期行为误判为 miss。

**Phase 2（架构扩展）**：
4. **G11.2-B**：COMPONENT_INDEX 增加 per-agent riskLevel override 能力。
5. **G11.1-A**：`analyze-structure-compare.mjs --ci` 模式进入 `npm run check` 流水线（CDP 可用时）。
6. **G12.1-B**：verify-style miss 输出增加原因分类维度（notApplied / locallyOverridden / nonControlled）。

---

*审计方法：静态文件阅读 + 调用链追踪 + 契约边界分析。未修改任何代码。*
