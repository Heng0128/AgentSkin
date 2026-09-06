# RFC：apply 前置探测 + 原生模式推理与静默切换（Native Mode Inference & Silent Switch）

> 状态：`待评审`
> 日期：2026-08-17
> 分支：`（待建）`
> 范围：`src/engine/src/runtime/`、`src/main/cdp/`、`src/main/agent-engine-service.ts`、`src/main/theme-apply-flow.ts`、`src/main/theme-restore-flow.ts`、`src/main/epoch-manager.ts`、`agents-raw-data/`（规则产物）
> 上游依据：本会话《基于成熟开源项目对标后的完备方案》（Dark-Reader / codex-theme-controller / opencode-zh-desktop / Discord Injector 对标）
> 关联 RFC：`2026-08-16-baseline-restore-architecture.md`（基准真值层，本 RFC 的前置依赖之一）

---

## 1. 背景与目标

### 现状痛点

当前注入是**纯 CSS 叠加**（L0-L4 分层），从不探测、也从不切换目标应用的**原生亮/暗模式**。这意味着：

- 在浅色模式的目标应用上叠加深色主题，必须用注入 CSS **覆盖全部浅色 token**。目标应用若大量使用 `adoptedStyleSheets` 构造样式表、Tailwind `@theme-inline` 组件级变量、或 `prefers-color-scheme` 驱动的组件逻辑，覆盖会**遗漏或冲突**，产生"半明半暗"渲染。
- 已知故障（`AGENTSKIN_DOM_INCOMPATIBLE`、blob/stream 加载失败等）的相当一部分，根源是"对抗原生模式"而非"顺应原生模式"。
- Dark-Reader 的成熟做法是**先顺应站点原生暗色**：探测当前模式 → 必要时切换 → 再叠加注入。AgentSkin 缺的正是"探测 + 切换"这一环。

### 目标（可验证）

1. apply 第一步（只读、零副作用）产出 `agent-theme-meta.json`（原生模式推理 + 置信度 + 切换能力）+ `metaValidationReport.json`（元模型自校验），驱动后续注入决策。
2. 当目标主题 mode 与 `currentNativeMode` 不匹配且元模型判定 `canSilentSwitch=true` 时，能走**精确切换路径**（API 优先，其次 dataset/localStorage），不靠运行时试错。
3. 静默切换是唯一写操作，必须在卸载时**严格恢复**切换前的快照（不硬编码 light/dark），并受 epoch/ownerId 并发防护。
4. 元模型自校验失败或置信度 `low` 时，**禁止静默切换**，提前阻断不安全路径，兜底降级仅用于未知新版本/混淆打包的异常实例。

### 非目标

- 不改变 L0-L4 注入分层语义、不改变 `buildApplyExpression` 的当前 document 注入行为（对齐 `2026-08-17-engine-runtime-new-document-persistence.md` 的非目标）。
- 不新增适配器、不新增 UI 页面（不突破六页/六适配器上限）。
- 不修改 14-token 主题契约与 manifest schema。
- **规则库（Layer1）的生成与维护属"轨 A"工具链（脚本级，扩展 `analyze-structure-compare.mjs`），不触发本 RFC**；本 RFC 假设其存在并作为静态先验输入。
- 不追求"自动推导 store 路径"——store 路径探测的精确值需人工 curation（见 §4.1 约束与 §7）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ apply 流程新增「前置只读探测 + 原生模式推理 + 静默切换」步骤，属注入流程级变更
- [ ] 新增 UI 页面（突破六页封顶）
- [ ] 新增适配器（突破六适配器上限）
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

> 裁决说明：本 RFC 在 apply 流程中引入**唯一写操作**（原生模式静默切换），并新增前置探测层，属注入架构级改动，按 AGENTS.md §6 需 RFC 评审后方可合入。不突破六页封顶/六适配器上限，不修改 14-token 契约与 manifest schema。

---

## 3. 现状侦察（代码锚点）

### 3.1 已存在、可复用（本 RFC 的前置依赖，不重建）

| 件 | 文件 | 现状 | 与本 RFC 的关系 |
|----|------|------|-----------------|
| 基准真值层 | `src/engine/src/runtime/baseline-snapshot.mjs` | 按 `{appId,appVersion,themeMode}` 键控缓存原生亮/暗计算样式快照，生命周期 fresh/stale/expired，版本漂移自动失效重采 | = "回滚快照 + 版本漂移降级"已有雏形；静默切换前缓存 `originalRuntimeContext` 复用此层 |
| 双轨 preflight | `src/engine/src/runtime/preflight.mjs` | `decideBaselineTrack` 判定 reuse(rebind)/recapture，应对 hash 类名漂移 | = "rule 失效自动降级"已有雏形；Layer3 加权置信度是它的上层封装 |
| 语义 fallback 链 | `src/engine/src/runtime/selectivity-registry.mjs` | `SemanticSelectorEntry` 语义名 → fallback 选择器链 | = Layer1 规则库的"fallback 链"已有形态；静态 rule JSON 是其先验来源 |
| baseline CDP 原语 | `src/main/cdp/baseline-css-capture.ts` / `baseline-css-replay.ts` / `baseline-validator.ts` | CSS 规则原文采集（含 adoptedStyleSheets 回注）+ 三硬门控校验 | Layer2 样式 AST 采集可复用 capture；Layer4 自校验可参考 validator 门控风格 |
| 并发防护 | `src/main/epoch-manager.ts` | 并发 epoch 管理，防止过期 apply 覆盖新操作 | 静默切换写操作必须挂 epoch 守卫 |
| apply/restore 编排 | `src/main/theme-apply-flow.ts` / `theme-restore-flow.ts` / `agent-engine-service.ts` | 主题应用/恢复/编排入口 | 前置探测 + 切换 + 恢复接入点 |

### 3.2 已确认的真实缺口（静态锚点）

| 编号 | 文件:行 | 现状 | 状态 |
|------|---------|------|------|
| GAP-01 | `scripts/analyze-structure-compare.mjs:224-252` | 运行时探测仅 `buildClassInventoryExpression` + `buildVarsExpression`（:root 计算样式），**不遍历 `document.styleSheets[].cssRules`，不读 `document.adoptedStyleSheets`** | **未实现** |
| GAP-02 | `scripts/analyze-structure-compare.mjs:287-317` | `probeRuntime` 仅单 target，**不枚举 iframe/worker/多 frame**，**不遍历 Shadow DOM（open/closed）** | **未实现** |
| GAP-03 | `scripts/analyze-structure-compare.mjs:644-758` | `buildCompare` 为简单 set-diff，**无指纹相似度打分、无加权置信度、无 rule 失效降级** | **未实现** |
| GAP-04 | 全局 | 无 `agent-theme-meta.json` / `metaValidationReport.json` 产物；**无原生 mode 推理（currentNativeMode）、无静默切换（canSilentSwitch/setTheme）能力** | **未实现** |
| GAP-05 | 全局 | 无静态规则库（`*.theme.rule.json`）与 `fallback.generic.theme.rule.json` | **未实现** |

> 说明：GAP-01/02/03/05 属"轨 A"工具链（脚本级，扩展 `analyze-structure-compare.mjs`），**不触发本 RFC**，仅作为前置产出。GAP-04 中「原生 mode 推理 + 静默切换进 apply 流程」才是本 RFC 的正式范围。

---

## 4. 设计方案

### 4.1 四层管线总览

```
apply 前置（本 RFC 范围，全部零副作用，不修改 DOM/Store/LocalStorage，不调用切换函数）
┌────────────────────────────────────────────────────────────┐
│ Layer1 静态规则库  agent-rules/*.theme.rule.json            │
│   （离线，人工可迭代；asar 仅生成初始模板；携带 light/dark 指纹）│
│                    ↓ 先验假设（永不当真相）                    │
│ Layer2 增强 CDP 只读探测  runtime-probe-full.json            │
│   （target 全发现 / DOM 上下文 / 样式 AST / Shadow DOM / 指纹比对）│
│                    ↓ 运行时观测                                │
│ Layer3 加权融合推理  agent-theme-meta.json                   │
│   （指纹匹配分 → confidence: high|medium|low）                │
│                    ↓                                          │
│ Layer4 元模型自校验  metaValidationReport.json               │
│   （landmark 采样 / 校验 canSilentSwitch / 校验 adoptedStyleSheet）│
└────────────────────────────────────────────────────────────┘
                    ↓ pass/ warn / fail
            分支决策（§4.5）→ 注入 或 静默切换 或 拒绝/兜底
```

依赖方向严格单向：Layer4 → Layer3 → Layer2 → Layer1。

### 4.2 Layer1：静态规则库（轨 A 产出，本 RFC 消费）

单条规则字段（**先验知识，非运行时快照**）：

```json
{
  "agentId": "workbuddy",
  "schemaVer": "1.3",
  "themePersistCandidates": [
    { "type": "dataset", "key": "data-theme" },
    { "type": "localStorage", "key": "app-theme-mode" },
    { "type": "globalStore", "path": "window.__STORE__.app.themeMode" }
  ],
  "globalApiCandidates": ["window.__bridge.setTheme"],
  "lazyRiskComponents": ["Modal", "Dropdown", "Popover"],
  "shadowDomRiskSelectors": ["radix-dropdown"],
  "themeImplMode": "mixed",
  "canSilentSwitch": true,
  "switchSideEffects": ["会同步更新 Zustand 内存 store，弹窗初始化读取 store"],
  "lightFingerprint": { "dataset": "light", "cssVars": { "--bg-primary": "#ffffff" } },
  "darkFingerprint": { "dataset": "dark", "cssVars": { "--bg-primary": "#0f0f11" } }
}
```

**硬约束**：

1. rule 是**先验假设，永远不能单独作为真相**；必须与 Layer2 运行时观测交叉校验（指纹匹配分驱动）。
2. `themePersistCandidates[].path`（如 `window.__STORE__...`）这类精确 store 路径，**asar + Terser 混淆后无法可靠推导**，必须**人工 curation**。规则库是"维护资产"（对齐 Dark-Reader 站点修复由社区手工维护），不是自动生成物。
3. 6 个固定适配器（AGENTS.md 禁止新增）→ 规则库是**有界问题**，`agent-rules/` 仅 6 份 + 1 份 `fallback.generic.theme.rule.json`，不做 web-scale 维护体系。

### 4.3 Layer2：增强 CDP 只读探测（轨 A 产出探测引擎，本 RFC 在 apply 前置调用）

五个子模块（全部 CDP 只读，`Runtime.evaluate` 隔离上下文）：

1. **Target 全发现**：`Target.getTargets` 枚举主 frame / iframe / worker，逐个 attach；递归遍历 open shadow root；closed shadow 标记 `closedShadowRisk`。
2. **DOM 上下文**：`documentElement.dataset` 完整 dump；localStorage/sessionStorage 快照；按 rule 的 `globalStore.path` **仅属性读取（不调用函数）**；`meta[name=color-scheme]`；`matchMedia("(prefers-color-scheme: dark)")`。
3. **CSS 样式 AST**：遍历 `document.styleSheets[].cssRules` + `document.adoptedStyleSheets[].cssRules`，提取 `:root` 变量集合与主题相关 class 选择器；抽样 `:root` computed 变量。**注意：大量 React-Radix / shadcn 应用使用 adoptedStyleSheets，只读 `document.styleSheets` 会漏样式（GAP-01 根因）。**
4. **Shadow DOM 增强**：对每个 open shadow host 做同等 AST 收集；closed 标记风险。
5. **指纹比对**：运行时 dataset/localStorage/:root 变量集 与 rule 的 `lightFingerprint`/`darkFingerprint` 相似度打分（0-100），输出 `matchLightScore`/`matchDarkScore`/`conflictFlags`。

### 4.4 Layer3 + Layer4：加权融合推理 + 元模型自校验

**Layer3 置信度**：

| 指纹匹配分 | confidence | 处理 |
|-----------|-----------|------|
| ≥ 85 | `high` | 采信 rule 业务逻辑，用运行时修正当前 mode |
| 40–84 | `medium` | 合并两者，标记风险点 |
| < 40 | `low` | **rule 失效（版本升级/混淆），丢弃静态全部业务假设，以运行时为准 + 加载通用 fallback** |

产出 `agent-theme-meta.json` 字段：`agentId / confidence / fingerprintMatchScore / ruleValid / currentNativeMode / modeSource / canSilentSwitch / switchMethod / lazyComponentRisk / closedShadowRisk / adoptedStyleSheetDetected / baselineRefs`。

**Layer4 自校验探针**（关键新增，校验"元模型本身是否对"）：

1. `currentNativeMode=dark` → 抽样 3 个 landmark 节点 computed 背景/文字色，验证符合 dark 特征；
2. `canSilentSwitch=true` → 校验 `globalApi` 函数确实存在、store 路径确实可读；
3. `adoptedStyleSheetDetected=true` → 校验运行时确实采集到构造样式表。

校验结果 `metaValidationReport`：

- `pass`：元模型可信，进入注入决策；
- `warn`：部分字段存疑，提升后续注入校验采样密度；
- `fail`：**强制 `confidence=low`，禁止静默切换，不进入常规路径**。

### 4.5 完成前置后的分支决策

| 条件 | 动作 |
|------|------|
| `pass` && `high` && 目标 mode == currentNativeMode | 直接叠加注入，**不切换、不兜底** |
| `pass` && `high` && mode 不匹配 && `canSilentSwitch=true` | 走精确切换路径（API > dataset/localStorage），**不做运行时试错** |
| `confidence=medium` | 允许切换，注入后校验采样加倍 |
| `confidence=low` / `fail` | **不尝试任何静默切换**，上报风险，上层拒绝注入或开启兜底兼容模式 |

### 4.6 静默切换（唯一写操作）的恢复与并发约束

静默切换是本 RFC 唯一"写目标应用状态"的能力，必须满足：

1. **切换前缓存 `originalRuntimeContext`**（localStorage / dataset / store 快照），复用 `baseline-snapshot.mjs` 的采集与缓存能力，**不硬编码 light/dark**。
2. **卸载时严格恢复**：`theme-restore-flow.ts` 卸载时回写缓存快照，而非"切回 light/dark 固定值"。
3. **epoch/ownerId 守卫**：写操作挂 `epoch-manager.ts`，并发 apply/restore 竞争时 `skipped-concurrent`（对齐 `2026-08-16-baseline-restore-architecture.md` §5 S9）。
4. `canSilentSwitch=true` 必须**人工审核**：每条 rule 的 `switchSideEffects` 必须文档化；`globalApi.setTheme` 是副作用最重的写路径（可能触发弹窗/组件初始化读 store），仅作**最后手段**。
5. 写操作失败（App 崩溃/进程被杀）导致目标卡在错误 mode 的风险，属 §5 风险表 R2。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | 静默切换副作用（弹窗/组件初始化读 store，导致状态不一致） | **高** | `canSilentSwitch=true` 但 `switchSideEffects` 未覆盖真实副作用 | 每条 rule 人工审核 + switchSideEffects 文档化；medium/low 不下发静默切换 | Layer4 校验 + 注入后采样加倍 |
| R2 | 切换后 App 崩溃/被强杀 → 无法 restore → 目标永久卡在错误 mode | **高** | 写操作与 restore 之间进程终止 | 切换前完整缓存 `originalRuntimeContext`；restore 幂等重试；拒绝在无快照时切换 | restore 失败上报 + 启动自愈重跑 restore |
| R3 | store 路径误读（getter 带副作用） | 中 | `globalStore.path` 指向带 getter 副作用的对象 | Layer2 仅属性读取 + try/catch；rule 路径人工 curation | Layer4 store 可读性校验 |
| R4 | closed Shadow DOM 无法读 → 漏判 currentNativeMode | 中 | 目标主题受控节点在 closed shadow 内 | 元模型标记 `closedShadowRisk`，降级为仅 Shadow Host 注入 | 指纹 conflictFlags |
| R5 | 版本漂移 rule 失效 | 低 | Agent 升级后旧指纹不匹配 | 指纹 <40 自动降级（已由 preflight/baseline 覆盖） | Layer3 指纹打分 |
| R6 | 并发 apply/restore 竞态 | 低 | 快速切换主题 | epoch/ownerId 守卫（对齐 baseline-restore §5 S9） | 并发 apply 返回 `skipped-concurrent` |
| R7 | 探测超时（CDP 注入超时为已知故障之一） | 中 | target 未就绪/多 frame 扇出慢 | 探测分模块独立超时 + 降级（缺样式 AST 仍可出 meta，置信度下调） | 各子模块超时字段 |

---

## 6. 分批落地计划

按"风险从低到高、收益先行"排序，每批独立评审、独立合入。

| 批次 | 内容 | 触发 | 验证 |
|------|------|------|------|
| **批 A（轨 A，无 RFC）** | 扩展 `analyze-structure-compare.mjs`：adoptedStyleSheets + Shadow DOM 探测（GAP-01/02）、rule 库模板生成 + 指纹比对（GAP-03/05） | 无 | 脚本对 6 Agent 实跑，产物 `*.rule.json` + `runtime-probe-full.json` |
| **批 B（P0）** | `meta-inference`（Layer3 加权融合）+ `meta-validator`（Layer4 自校验）抽为纯函数模块 | 无（纯逻辑） | 单测覆盖 85/40 阈值与 fail 降级 |
| **批 C（P0）** | apply 前置接入：只读探测 → 产出 meta + report，**不切换**，仅打日志/上报 | 注入流程（只读） | 6 Agent apply 前置实跑，meta 正确性抽样 |
| **批 D（P1）** | 静默切换 + restore-on-unload + epoch 守卫（写操作） | 注入流程（写） | 切换→注入→卸载→恢复全链路；并发竞态单测 |
| **批 E（P1）** | 兜底降级路径：confidence=low / fail 时的拒绝与兼容模式 | 注入流程 | 版本漂移演练（改 rule 指纹触发 low） |
| **批 F（P2）** | 全量 6 Agent 版本漂移 + 异常实例演练 + `npm run check` 全绿 | — | CI + 手工 |

> 批 C 之前的落地均零副作用；批 D 是本 RFC 中唯一引入写操作的批次，合入前需单独确认 §7 人工复核项 1/2/3。

---

## 7. 人工复核项

静态无法判定、需实际运行确认的业务假设：

1. **6 个 Agent 是否真有可靠的 `globalApi.setTheme`？** workbuddy 的 `full-extract`/`profile` 已见 themeMode 相关痕迹，其余 5 个待逐个人工确认。**若多数 Agent 无原生切换 API，静默切换价值大幅缩水，需收缩范围到"仅具备切换能力的 Agent"。**
2. **静默切换的真实副作用清单**：哪些弹窗/组件在初始化时读取 theme store，切换是否会触发可见跳变。
3. **restore-on-unload 在目标 App 崩溃场景的可靠性**：进程被强杀时无法执行 restore，目标是否永久卡在错误 mode（R2）——这是否可接受，或需启动自愈。
4. **6 App 的 store 路径人工 curation 工作量**：`themePersistCandidates` 的 `globalStore.path` 需逐个 App 人工填，是否值得为"纯 CSS 叠加已可用的 App"投入。
5. **是否所有 Agent 都需要 mode 切换**：对纯 CSS 叠加已稳定的 App，强制引入"探测→切换"链路是否过度设计（对齐"兜底仅用于异常实例"的目标，避免把切换当常规路径）。
6. **Layer2 样式 AST 采集在 6 Agent 的体积/耗时**：`cssRules` 全量遍历可能大，需确认采样与超时上限。

---

## 8. 评审结论

（评审意见汇总，由评审人填写）
