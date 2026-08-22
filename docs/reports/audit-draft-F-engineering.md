# 工程体系与数据流污染审计报告（F 轮）

> **审计范围**: 自动化回归测试链路 · 批量 Agent 回归失败隔离 · 风险优先级分层 · 语义漂移检测开关 · 全链路数据流污染阻断  
> **审计方法**: 基于关键源文件代码证据逐项审计，禁止修改代码  
> **基准日期**: 2026-08-19  
> **引用文档**: `baseline-restore-audit-2026-08-16.md` §四/§五、`semantic-quant-final-review-2026-08-17.md`

---

## 0. 执行摘要

| 审计维度 | 风险评级 | 核心结论 |
|---------|---------|---------|
| 16(a) 单 Agent 完整回归流程 | **P1-持续性** | 流程碎片化，缺少编排层；5 个断点 |
| 16(b) 6 Agent 批量隔离 | **P1-架构性** | `analyze-structure-compare.mjs` 隔离良好；`cdp-full-extract.mjs` 串行无产物保存 |
| 17(a) 优先级分层建议 | **P2-流程** | 建议引入 P0-Functional vs P0-Quality 二维分级 |
| 17(b) 语义漂移开关 | **P1-正确性** | 完全缺失 per-Agent kill-switch |
| 18(a) 数据流污染阻断 | **P0-致命** | 残缺探测无闸，总节点缺失无拒绝，暗色/亮色切换失败被静默吞掉 |
| 18(b) 残缺产物→主题包 | **P1-持续性** | 输入校验过浅、DEFAULT_TOKENS 回退掩蔽污染 |

## 1. 全链路数据流污染阻断点图（文字拓扑）

```
Agent 窗口 ──► CDP WebSocket
    │
    ├── [B1] cdp-full-extract.mjs ── totalNodes / stylesheets.error
    │       │
    │       ▼
    │   <agent>-full-extract.json   ◄── 污染阻断点 #1（当前缺失）
    │       │
    │       ▼
    │   sync-remap-from-extract     ◄── 阻塞缺失：无污染检查
    │       │
    │       ▼
    │   语义基线采集                ◄── 阻塞缺失：无数据完整性校验
    │       │
    │       ▼
    │   baseline-validator.ts       ◄── 有降级但仅运行时触发，非批次闸
    │
    ├── [B2] DOM Snapshot ── dom-snapshot.mjs 有 truncated 标记但未被消费方检查
    │
    ├── [B3] verify-style.mjs ── styleSampling 仅在运行时生效，无批处理模式
    │
    └── [B4] build-theme-package.mjs ── 输入校验过浅，DEFAULT_TOKENS 掩蔽
            │
            ▼
        .agentskin-theme/            ◄── 污染阻断点 #2（当前缺失）
            │
            ▼
        运行时注入                    ◄── [B5] verify-style 漂移检测（软告警，不阻断）
```

**阻断点覆盖度**: 5 个候选阻断点，当前仅 B1 有部分统计字段、B2 有标记但无哨兵逻辑、B5 进入 result 但不参与 result.pass。B3/B4 完全无防护。

---

## 2. §16. 自动化回归测试链路

### 2.1 (a) 面向单 Agent 完整回归流程

**基于代码现状，完整执行步骤如下**（步骤编号对齐五层架构 §2.6 的 7 步顺序）：

| Step | 名称 | 实际代码位置 | 状态 | 断点 |
|------|------|-------------|------|------|
| S1 | 目标窗口就绪检测 | 由外部启动，引擎 `findTargets()` / `resolveDebugPorts()` 已实现 | ✅ 已实现 | — |
| S2 | CDP 提取 token | `cdp-full-extract.mjs` `extractAgent()` L790–1033 | ⚠️ 部分 | 暗色/亮色切换失败时 `domDark=null` + `rootVarsDark={}` 仍被接受为正常输出，不抛错不标记 |
| S2a | 采集语义基线 | 理论上应走 `semantic-snapshot.mjs`（Per 代码审查 §F 尚未全部落地至 scripts/） | ❌ 缺失 | 无单入口脚本从命令行采集语义基线并落盘 |
| S3 | 复刻校验 Gate | `baseline-validator.ts` `validateBaselineCss()` (L254–293) + `assessFidelity()` 纯函数 | ⚠️ 部分 | 仅主进程调用（`skin.mjs`），**无 scripts/ 入口**供离线批量校验 |
| S4 | 加载应用主题包 | `build-theme-package.mjs` 生成包；主进程 injector 注入 | ✅ 已实现 | — |
| S5 | 执行 verify 校验 | `verify-style.mjs` `assessStyleCompliance()` (L132–166) + `aggregateByRegion()` (L198–226) | ⚠️ 部分 | 仅内嵌于 `buildVerifyExpression()` 作为运行时采样片段；无独立批量命令行接口 |
| S6 | 输出完整测试报告 | 各脚本各写各的 json/md | ❌ 缺失 | 没有单一 report aggregator |

**已识别断点（5 处）**:

**[BP-1] 语义基线采集入口缺失**
- `semantic-snapshot.mjs` 在 `src/engine/src/semantic-quant/` 内具备能力，但 scripts/ 目录下无批量调用入口。无法离线对全 6 Agent 执行 `buildSemanticSnapshot()` + 落盘。
- 后果：S2a 在流程图中仅是理论节点。

**[BP-2] 复刻校验 Gate 无法离线运行**
- `baseline-validator.ts` 完整实现了 `validateBaselineCss()`，但它是 ESM-TS 模块，依赖 CDP session，未提供 scripts/ 级别的 CLI 包装。
- 后果：S3 Gate 当前仅能在主进程实时注入前执行，无法作为回归套件的一环独立跑批。

**[BP-3] S2 暗色/亮色失败静默接受**
- `captureAllStylesheets()` 在 CORS 下 `sheet.cssRules` 抛错，错误字符串写入 `sheet.error`，但**不中断流程**；`setColorScheme()` 返回 false 时 `domDark = null` 仍写入 `out.dom.dark = null`。
- 后果：后续语义基线采集基于不完整的 runtime 数据仍会执行。

**[BP-4] verify-style 无批量模式**
- `assessStyleCompliance` 是纯函数，但需要 DOM 侧的 computed styles 采样数组输入。目前只在 `buildVerifyExpression` 的运行时片段中序列化到页面内执行。
- 后果：没有脚本能从 scripts/ 层面对所有 6 Agent 统一跑 verify 并汇总漂移矩阵。

**[BP-5] 聚合报告生成器缺失**
- `_extract-summary.json`（cdp-full-extract）只输出 vars/domNodes 计数；`_structure-compare-light.json`（analyze-structure-compare）只输出 drift 布尔值。两个维度从未在一个聚合器中合并输出。

### 2.2 (b) 面向 6 个 Agent 批量回归

#### 2.2.1 `analyze-structure-compare.mjs`（已有隔离）

| 特性 | 证据 |
|------|------|
| 串行 for 循环，外层 try/catch 包裹每个 adapter | `analyze-structure-compare.mjs` L2116–2149 |
| 单 Agent 失败不中断批处理 | L2138–2145：异常被记录，report 中 `runtime.ok=false`，其余继续 |
| CI 退出码三态 | L2338：`hasFailure ? 2 : hasDrift ? 1 : 0` |
| 失败产物保存 | L2240–2243：`_structure-compare.json` 含全部 reports，`runtime.ok=false` 的条目保留错误信息 |

**评价**: 该脚本的隔离设计已满足 §16(b) 的核心需求。Agent A 探测失败不影响 B–F 执行；失败产物写入 JSON 报告。

#### 2.2.2 `cdp-full-extract.mjs`（隔离缺口）

| 特性 | 缺口 |
|------|------|
| 串行 for 循环 | L1073–1075：无并行也无并发控制 |
| `extractAgent()` 返回 null | L808、L1029：失败仅 summary 中标记 `status: 'failed'`，**无失败产物保存**（不写 partial JSON） |
| CDP 超时 | `CdpClient.send()` 10s 超时（L340–345），仅 reject，无重试 |
| connect 超时 | L312：8s 超时后 reject，无回退策略 |
| 主题切换失败静默 | L877、L896：`darkOk=false` → `domDark=null` 仍被接受 |

**失败产物保存缺口**:

```
当前行为（无失败产物）:
  extractAgent() returns null
  → summary.agents[name] = { status: 'failed' }
  → 无 artifact 写入 outputDir

建议行为（最小改动，本次不改代码）:
  extractAgent() 返回部分 result {
    meta: { agent, partial: true, error },
    _partial: { stylesheets: [...], dom: defaultDomRoot },
    error: e.message
  }
  → 写 <agent>-full-extract.partial.json（供事后人工复核）
```

#### 2.2.3 批量处理与启动时间差异

- `analyze-structure-compare.mjs` 通过 `resolveLivePort()` + `portsFromNetstat()` 双路径（L164–193 + L128–162）发现 Agent，对启动较慢的 Agent 通过 netstat 回退覆盖。本次审计确认已处理多开/多端口场景。
- `cdp-full-extract.mjs` 无此能力——端口硬编码在 `AGENT_PORTS` 对象中（L21–28），**必须 Agent 已启动且在端口监听后才能运行**。对于启动缓慢的 Agent（如 QoderWork 的 DevToolsActivePort 文件时序脆弱点），无等待/轮询逻辑。
- **批量策略缺口**：6 Agent 启动时间差异大（VS Code 系需 Electron 冷启动 5–15s），cdp-full-extract 需要外部 orchestrator 串行等待；analyze-structure-compare 的轮询已解决此问题但 port 解析逻辑独立维护。

#### 2.2.4 6 Agent 失败隔离缺口清单（待实施）

| # | 缺口 | 等级 | 影响 |
|---|------|------|------|
| G1 | cdp-full-extract 无单 Agent 失败产物持久化 | P1 | 失败无法事后诊断 |
| G2 | 端口硬编码，不支持动态发现 | P2 | 需 Agent 已在线方可提取 |
| G3 | 主题切换失败（dark/light）不会被识别为不完整提取 | P1 | 残缺数据进入下游 |
| G4 | 无 partial-write 保护：运行时异常时主题包文件只写一半 | P2 | 磁盘残留污染 |
| G5 | 无 per-Agent 重试逻辑（CDP 连接抖动） | P2 | 在 CI 环境增加 flakiness |
| G6 | retry-on-truncated 机制不存在（总节点未达 maxNodes 不触发；达 maxNodes 不标 truncated 即停止） | P0 | cdp-full-extract 与 `dom-snapshot.mjs` 语义不一致 |

---

## 3. §17. 优先级与风险定义

### 3.1 (a) 建议引入「功能阻断 P0」与「质量类 P0-Quality」二维分级

**当前问题**：`baseline-restore-audit-2026-08-16.md` §四 风险清单将 9 项风险统一以 P0/P1/P2 标注，包含：
- **S1/S3/S9 标准化 P0**：基准快照采集失败 / JS 动态修改原生样式 / 竞态条件——这些是**功能阻断型** P0，工程实践中意味着"主题根本加载不上"。
- **S5/S10 标注为 P1**：版本更新后基准失效 / 语义过滤层误判——属于**质量类风险**，不会阻断主流程，但会静默导致用户体验劣化。
- **S4「语义签名」** 被标记为 P0（§4.1 矩阵中未明确，但 §五 行动清单将语义漂移检测关联为 P0/Q 前置条件）。

**建议分级模型**:

| 等级 | 语义触发条件 | 工程语义 | 处置 SLA |
|------|-------------|---------|---------|
| **P0-Block** | 主题完全加载失败 / 注入导致目标应用崩溃 / 竞态导致页面不可用 | 主流程阻断 | 立即修复 |
| **P0-Quality** | 语义漂移、覆盖不完全、静态/运行时签名不匹配 | 静默质量风险，**不阻断**加载 | 24h 内响应 |
| **P1** | 选择器失效（dead landmark）、bridge 变量不可达 | 适配器漂移 | 版本周期内修复 |
| **P2** | 选择器精度不足（over-width）、Shadow DOM 不可达 | 视觉体验 | 排期优化 |
| **P3** | 性能（流式输出CDP开销）、风格一致性 | 锦上添花 | 长期路线图 |

**推演理由**：
- 当前报告正文描述 S3/S9 为"概率最高、影响最大"的功能级灾难，而 S5/S10 为"静默质量风险"。若两者共用 P0 标签，在 CI/CD 门禁决策时会被同等对待，导致两类告警在告警队列中不可区分，**稀释真正阻断型 P0 的响应优先级**。
- 引入 `P0-Quality` 维度后，CI exit code 可分层：exit code 2（功能阻断）vs exit code 1（质量漂移），与 `analyze-structure-compare.mjs` 已存在的 L2338 退出码三级结构天然对齐。

### 3.1 (b) 6 Agent 工程迭代中语义签名采集不稳定的开关需求

**当前状态**:

| 检测项 | 开关机制 | 状态 |
|--------|---------|------|
| check-semantic-contract 全量 | `npm run check` 内一荣俱荣、一损俱损 | ❌ 无 per-agent 开关 |
| semantic-snapshot 采集 | 直接调用函数，无 ENV flag 守卫 | ❌ 无开关 |
| analyze-structure-compare drift | `--agent <name>` 过滤 + `--baseline` 抑制已知漂移 | ⚠️ 仅 CLI 粒度，无模块级开关 |

**缺口分析**:

若某 Agent（例如 zcode，因其 DOM 节点仅 52 个，基线极不稳定）的 `semantic-snapshot` 持续产出不稳定的 signature，当前机制下：

1. `check-semantic-contract.mjs` 会因 linkage 失败而 `process.exit(1)`
2. `npm run check` 整体红掉，**阻塞全部 6 Agent 的提交**
3. 没有细粒度开关让开发者在"zcode 已知不稳定"期间临时关闭该 Agent 的语义契约检测

**建议开关矩阵（仅方案设计）**:

```
AGENTSKIN_DISABLE_SEMANTIC_CHECK__zcode=1   # 关闭 zcode 的语义契约
AGENTSKIN_DISABLE_SEMANTIC_CHECK__all=1      # 应急全关（必须 code review 配套）
AGENTSKIN_SEMANTIC_BASELINE_TOLERANCE=0.1    # 放宽采集容差
```

**设计要点**:
- 开关须有审计日志（"谁在何时关了什么"）
- `all=1` 必须配合 git hook / CI 注解触发人工 review
- 不应影响注入主流程（纯诊断维度）

---

## 4. §18. 数据流污染防护

### 4.1 (a) 残缺快照识别与拒绝——阻断点现状

#### 阻断点 A：`cdp-full-extract.mjs` totalNodes 无闸

| 字段 | 采集位置 | 是否校验 |
|------|---------|---------|
| `totalNodes` | `captureDomTree()` L452 `JSON.stringify({ root, total: count })` | ❌ 不校验下限 |
| `domNodes.dark/light` | L1001–1004 写入 stats | ❌ 不校验下限 |
| `rootVars.dark/light` 长度 | L995–998 写入 stats | ❌ 不校验下限 |

**问题本质**：若目标窗口未正确冷启动（界面未完全渲染、target 页面仍在加载中），CDP 连接成功但 `totalNodes` 可能低至个位数。当前代码 **不会拒绝此残缺快照**，仍将其写出 `<agent>-full-extract.json`。

#### 阻断点 B：`stylesheets.error` 字段无哨兵

| 字段 | 来源 | 处理方式 |
|------|------|---------|
| `sheet.error = 'CORS: ...'` | L548 | 写入 sheets 数组，`cssText=''` |
| `sheet.ruleCount = 0` | L539 跳过后不递增 | 保留 ruleCount=0 |
| downstream impact | L835 `if (sheet.cssText && !sheet.error)` | 理论上跳过 error sheets，**但** 已部分解析到内存的变量不会被回滚 |

**缺口**：无跨-sheet 的一致性检查。若 60% 的 sheet 都因 CORS 带 error，整个变量集合实质上缺了一大半但代码路径仍视为成功。

#### 阻断点 C：dom-snapshot.mjs `truncated` 标记无消费

源码证据（grep 结果）：
```
L96:   let truncated = false;
L104:  if (nodes.length >= config.maxNodes) { truncated = true; break; }
L223:  summary.truncated (included in result)
```

**结论**：dom-snapshot **正确产出 truncated 标记**，但从未在任何下游脚本中被作为拒绝条件使用。与 cdp-full-extract 的 `captureDomTree()` 不一致（后者根本没有 truncated 字段）。

#### 阻断点 D：`baseline-validator.ts` `validateBaselineCss` 降级正确但触发时机晚

源码证据（L254–293）：
```typescript
try { baseline = await probeNativeBaseline(session); }
catch (error) {
  // 任一步骤失败 → degraded=true
  return { pass: false, matchRatio: 0, degraded: true, dimensions: [] };
}
```

**正例**：`validateBaselineCss` 是 fail-fast 设计——任何 probe 失败立即降级。
**问题**：它仅在主进程实时注入前触发，**不与 scripts/ 批处理管道连接**。因此在 `cdp-full-extract` → `sync-remap` 这条路径上，baseline-validator 的保护根本不存在。

### 4.2 (b) 残缺探测产物写入主题包的路径防护

#### 路径分析

```
cdp-full-extract.mjs
  → <agent>-full-extract.json
      → (人工或脚本消费)
          → build-theme-package.mjs 的 ThemeStudioExportRequest
              → deriveTokens(request?.root)
                  → buildAgentCss(agentId, palette, signature)
                      → writeFileSync assets/css/<agentId>.css
```

#### 输入校验现状（build-theme-package.mjs）

| 校验点 | 代码位置 | 强度 |
|--------|---------|------|
| `agentId` 非空 | L724 `String(request?.agentId \|\| 'traework')` | 仅回退，不拒绝 |
| `root` 字段类型检查 | L419 `if (root && typeof root === 'object')` | 仅跳 entry，不拒绝 |
| tokens 合法性 | L421 `k.startsWith('--agentskin-') && typeof val === 'string'` | 仅过滤不匹配 |
| 缺 token 不补 | L418 `const tokens = { ...DEFAULT_TOKENS }` | **DEFAULT 回退掩蔽污染** |

**核心污染风险**:

`deriveTokens()` 的传播语义是"DEFAULT 作为缺省回退"。这意味着：

- 若 extract 产出残缺（例如只有 dark 无 light，root Vars 中 90% 缺失），缺失的 token 会回退到 `DEFAULT_TOKENS` 的紫色系硬编码值，**看起来"跑通了"**；
- 用户得到的 theme CSS 中硬性覆盖了 `--agentskin-accent: #9d8bff` 等默认色，而非来自残缺提取的变量；
- Studio 不会报错（仅 warn），导出产物被污染仍写入磁盘。

**建议防护点（仅方案）**:

```
[防护层 1] extract-validate.mjs (scripts/ 新增)
  → 输入: <agent>-full-extract.json
  → 规则:
    - totalNodes.dark < MIN(50)  → reject
    - totalNodes.light < MIN(50) → reject  
    - rootVars.dark.keys < 5      → reject
    - stylesheets.errorRate > 0.6 → warn-only
  → 输出: <agent>-validated.json + 退出码

[防护层 2] build-theme-package.mjs deriveTokens() 严格模式
  → 输入: 提取物的 token map
  → 新增 parity check: 至少 10 个 --agentskin-* 匹配 extract.palette 中的值
  → 不匹配时 throw（而非静默 fall back to DEFAULT）

[防护层 3] build-agent-css 双料比对
  → remap 的 AGENT_REMAP[agentId] 与 extract 中实际声明的变量做交集
  → 警告 "bridge 变量 X 在 extract 中未找到，remap 可能悬空"
```

---

## 5. 风险分级与方案推演（审计结论汇总）

### 5.1 本次审计发现的风险清单

| ID | 风险描述 | 等级 | 代码证据 | 缺口归属 |
|----|---------|------|---------|---------|
| F1 | cdp-full-extract 总节点缺失无下限闸，残缺快照可被下游消费 | **P0** | L854 `domDefault.totalNodes` 不校验下限 | §18(a) |
| F2 | 暗色/亮色主题切换失败后输出空 rootVars/dom 不触发终止 | **P1** | L868 `if (darkOk)` 分支内才赋值，否则 `null/{}` | §16(a) BP-3 |
| F3 | analyze-structure-compare 6 Agent 隔离已实现；cdp-full-extract 失败无产物保存 | **P1** | L1029 return null，无 partial 文件 | §16(b) G1 |
| F4 | dom-snapshot truncated 标记无消费方，cdp-full-extract 无 truncated 字段 | **P0** | 两模块不一致 | §18(a) BC |
| F5 | semantic-quant contract check 无 per-agent 开关，单 Agent 不稳定拖垮 npm run check | **P1** | check-semantic-contract.mjs L300–304 process.exit(1) | §17(b) |
| F6 | verify-style 采样不通过时进入 result.styleDrift 但 result.pass 未纳入判定 | **P1** | renderer-payload.mjs L525 `styleDrift: !styleSampling.pass`，需确认 result.pass 定义 | §16(a) BP-5 |
| F7 | build-theme-package DEFAULT_TOKENS 回退掩蔽不完整提取 | **P1** | build-theme-package.mjs L38–53 DEFAULT_TOKENS | §18(b) |
| F8 | 语义漂移 detection 与功能阻断 P0 混淆优先级 | **P2** | baseline-restore-audit §4.1 | §17(a) |
| F9 | 全量回归聚合报告器缺失，5 个断点无法自动化观测 | **P1** | scripts/ 无 cross-aggregator | §16(a) BP-5 |
| F10 | 端口硬编码，不支持启动中轮询等待 | **P2** | cdp-full-extract L21–28 AGENT_PORTS | §16(b) G2 |

### 5.2 方案推演层次

**方案 A（最小阻断，推荐）**:
1. 在 cdp-full-extract 的 `extractAgent()` 末尾增加 `qualityGate(result)`：若 `domNodes.default < 50 || domNodes.dark < 50 || domNodes.light < 50`，在 result.meta 中写入 `quality: 'insufficient'` 并在 summary 中标记 `status: 'insufficient'` 而非 `'ok'`。
2. 在 build-theme-package.mjs 新增 `--strict` 模式：当 `deriveTokens()` 发现缺失 token（vs DEFAULT 未 override）超过 3 个时抛异常而非静默写出。
3. 在 check-semantic-contract.mjs 中增加 `AGENTSKIN_DISABLE_SEMANTIC_CHECK__<agent>=1` 环境变量开关，跳过单个 Agent 检测。

**方案 B（保守静态门禁，中成本）**:
- 新增 scripts/extract-validate.mjs，消费 cdp-full-extract 输出，执行 qualityGate + truncat 检查，退出码管控下游。
- npm run check 挂载 extract-validate + check-semantic-contract + analyze-structure-compare --ci 三件套。

**方案 C（完整工程化，高成本）**:
- 新增 orchestrator 脚本 scripts/regression-suite.mjs，串行（或并行受控）执行：cdp-full-extract → extract-validate → sync-remap → semantic-snapshot → baseline-validate（离线重构）→ build-theme → verify-style（CDP 运行）→ aggregate-report。
- 适配 npm run regress 或 npm run ci:full。
- per-Agent 失败隔离 + 重试（最多 2 次）+ 失败产物保存 + 总体退出码 0/1/2 三态。

**推荐**: 短期方案 A（1–2 天），中期方案 B（1 周），方案 C 作为 RFC 提交突破六页/六适配器限制以外的工程扩展评审。

---

## 6. 最终结论

1. **自动化回归链路**从脚本层看是碎片化的：cdp-full-extract 采集、analyze-structure-compare 对拍、verify-style 校验各自独立运行，缺少编排层与聚合报告器。完整单 Agent 回归需要在外部调用 4–5 个步骤。

2. **批量失败隔离**在 analyze-structure-compare.mjs 已实现（单 Agent 失败不中断批处理、失败产物写入 JSON、CI 退出码三态）。**cdp-full-extract.mjs 是主要短板**——串行、无失败产物、端口硬编码、无重试。

3. **风险优先级**当前所有阻断型与质量型风险共用 P0/P1/P2 标度，建议引入 P0-Quality 维度以便 CI 门禁作出正确响应分级。

4. **语义漂移检测开关**完全缺失。当前 check-semantic-contract 与 verify-style 均无 per-agent kill-switch 或 toleration flag。在 Agent 签名采集不稳定期间会拖垮全量 npm run check。

5. **数据流污染**有 5 个候选阻断点，仅 baseline-validator.ts（运行时层）有正确降级逻辑。脚本层（cdp-full-extract → sync-remap → theme package）全线缺闸：总节点无下限、error 率无上限、DEFAULT 回退掩蔽残缺、truncated 标记无人消费。

**6 Agent 失败隔离缺口**: G1（产物持久化）、G3（暗色/亮色失败识别）、G6（truncated 语义不一致）为 P0/P1 级优先修复项。

---

**文档版本**: 1.0（审计草稿 F 轮，仅供分析，禁止作为实现依据未经评审）  
**审计人**: AgentSkin Engineering Audit Agent  
**基于文件**:
- `scripts/cdp-full-extract.mjs`
- `scripts/analyze-structure-compare.mjs` (全量 2345 行)
- `scripts/check-semantic-contract.mjs`
- `scripts/build-theme-package.mjs`
- `src/engine/src/runtime/verify-style.mjs`
- `src/engine/src/runtime/dom-snapshot.mjs`
- `src/engine/src/runtime/renderer-payload.mjs` (grep partial)
- `src/main/cdp/baseline-validator.ts`
- `docs/reports/baseline-restore-audit-2026-08-16.md`
- `docs/reports/semantic-quant-final-review-2026-08-17.md`
