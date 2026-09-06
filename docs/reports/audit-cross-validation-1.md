# 交叉校验报告 #1 — 六份审计草稿横向一致性校验

> **校验人**: AgentSkin 交叉校验专家（横向一致性校验）  
> **日期**: 2026-08-19  
> **输入**: audit-draft-A/B/C/D/E/F  
> **校验维度**: 残缺数据阻断逻辑、6 Agent 隔离逻辑、风险等级评定、方案推演冲突  

---

## 校验方法论

- 逐维度比对同一条问题在多份草稿中的**定位、归因、方案、等级**是否互斥或矛盾。
- "矛盾"定义为：两份草稿对同一事实做出**不同事实陈述**、或给出**互斥的修复动作**、或**等级差异 ≥ 2 级且无合理情境差异**。
- "遗漏"定义为：问题链路中的关键中间节点在某份草稿中完全未提及，可能导致该草稿的方案失效。
- "逻辑缺口"定义为：草稿内部或跨草稿存在**未打通的因果链**（A 说 X→Y，B 说 Y→Z，但无人说明 X→Z 的完整路径）。

---

## 一、残缺探测数据阻断逻辑一致性校验

### 1.1 A-F：残缺数据流入 vs totalNodes 无闸

| 项 | A 草稿 (F2) | F 草稿 (F1、§18(a)阻断点A) |
|---|---|---|
| 定位 | 残缺 token 集合没有质量标记，下游 Theme Studio 无法区分"无此变量"和"未拿到变量" | `totalNodes` 无下限闸，低数量的 totality 直接写出 JSON |
| 归因 | `meta` 字段缺少 `dataQuality`、`failedSchemes`、`corsBlockedSheets`、`retryAttempts` | `captureDomTree()` 返回的 `total` 不校验下限 |
| 方案 | 输出 JSON 增加质量元数据，下游按标记过滤 | `qualityGate(result)`：低于下限写入 `quality:'insufficient'`，summary 标记 status |
| 等级 | P1 | P0 |

**一致性判定：指向同一类问题，但非同一问题。**

- A 的"残缺"是**语义层**（哪些变量来源因 CORS/切换失败/时机过早而丢失）。
- F 的"totalNodes"是**统计层**（通过节点数量探测识别失败）。
- 两层可以互补：totalNodes 低是"残缺"的必要不充分条件——totalNodes 高但 CORS 阻掉 60% 样式表仍可导致语义残缺。

**潜在矛盾：等级差异 A=P1 vs F=P0。**

F 给出了 P0 的理由：残缺快照可被下游消费 → build-theme-package → 真实用户受影响。这在 `cdp-full-extract → sync-remap → build-theme-package` 管道存在时成立。但 D 草稿 §10(b) G10.2 明确指出：

> "extract 与 builder 之间不存在数据流管道——两者是独立的离线工具，共享的唯一桥梁是人工维护。"

**结论**：F 基于"存在自动数据流管道"给出 P0，而 D 基于"不存在管道"给出 MEDIUM。两份草稿对同一架构事实的陈述**直接冲突**。需要首先确认管道是否存在，再决定适用 P0 还是 MEDIUM。

---

### 1.2 B-A：CORS 样式表静默丢失 vs 天然残缺场景清单

| 项 | B 草稿 §4(a)-2 | A 草稿 §2.1 S5 |
|---|---|---|
| 定位 | CORS 跨域样式表 sheet.cssRules 抛 SecurityError → 变量静默丢失，不被计入覆盖率 | CORS 外部样式表 catch 后仅标记 error，完全丢失变量声明 |
| 补充点 | 明确区分 evaluate 路径 vs addScriptToEvaluateOnNewDocument 路径的 CSP 免疫差异 | 仅列出场景无路径分析 |
| 覆盖率缺口 | 明确指出无 CORS 阻塞占比统计 | 只标记无统计 |

**一致性判定：互补，不矛盾。**

B 对 CORS 的分析深度超过 A，特别是§4(a)-2 指出 `Page.addScriptToEvaluateOnNewDocument` 通道天然绕过 CSP，以及 A 未覆盖的 S4（adoptedStyleSheets 不可遍历）。两草稿联合可构成完整视图。

**轻微矛盾**：A §2.1 表中 S5 说"CORS 表内变量完全丢失"，B §6(a)-1 指出"categorizeVars 基于变量名正则匹配而非值"——这意味着即使 CORS 丢掉 sheet.cssRules，如果该变量名已被从其他同源 sheet 中采集到，变量不会"完全丢失"。两份草稿对"丢失范围"的界定存在粒度差异。

---

### 1.3 C-E：Shadow-Root 不可校验组件静默通过 vs verify-style 无法区分跳过与失败

| 项 | C 草稿 F-5/F-7 | E 草稿 E-03 |
|---|---|---|
| 定位 | closed shadow root 内组件：judged=0 → matchRatio=1 → pass=true → 不进入任何报告通道 → 静默通过 | verify-style 无法区分"应跳过"(nonControlled) 与"修改失败"，都输出 pass=false |
| 归因 | `assessStyleCompliance` 中 `if (judged === 0) continue` + `matchRatio = passing/judged \|\| 1` | `isNativeThemeControlled()` 默认 true → 4 Agent 全部节点参与采样 |
| 方案 | 三态判定 (PASS/FAIL/UNVERIFIABLE) + unverifiableWarnings 新通道 | 补齐 4 Agent 的 semantic.nullControlled 配置 + nonControlled 拓扑透传 |
| 等级 | HIGH | P1-正确性 |

**一致性判定：同一问题的不同面，等级存在差异但可调和。**

- C 关注 **"judged=0 → pass"这一中性判定的语义错误**——这是数学层面的 bug。
- E 关注 **"verify-style 不知道节点应被跳过"**——这是配置层面的 gap。

**关键冲突**：E 方案说"补齐配置 + 非受控拓扑透传到 verify-style"，C 方案说"三态判定永不阻断"。如果 E 先补齐了 4 Agent 的 nonControlled 配置，这些节点不再进入 verify-style 采样（被排除），则 C 的"judged=0"路径对**已配置** Agent 不再触发。但 E 的计划是 6 Agent 中只有 2 个（traework、codex）当前有 partial 配置，预计补齐其余 4 个需要工作量。

**版本序矛盾**：E 方案（补齐配置）实施后，C 的 HIGH 级风险（closed shadow root 静默通过）仅对**未来新增、尚未加入 nonControlled 清单**的组件生效。但 C 草稿未讨论"如果 nonControlled 已显式排除所有已知非受控节点后，closed shadow root 还有多少残余风险量级"。C 的草稿假设了"当前状态"下 HIGH 的判断，E 方案实施后等级会动态降低——C 应说明这一点。

---

## 二、6 Agent 隔离逻辑一致性校验

### 2.1 A-F：AGENT_PORTS 硬编码 + 串行执行 vs 端口硬编码 + 无 Retry

| 项 | A 草稿 F4、F7、§6.1 | F 草稿 G2、G5、§2.2.2 |
|---|---|---|
| 端口硬编码 | ✅ 一致确认 | ✅ 一致确认 |
| 串行执行 | ✅ 一致确认，A 强调"串行链路上单 Agent 故障线性放大" | ✅ 一致确认 |
| 超时隔离 | A: "无全局超时熔断机制" (§6.2) | F: "CDP 仅 reject 无重试" (§2.2.2) |
| 等级 | F4=P2, F7=P2 | G2=P2, G5=P2 |

**一致性判定：高度一致，无矛盾。**

两份草稿从各自维度（A: 探针链路时序；F: 批量工程隔离）得出相同结论，且等级相同。F 补充了 A 未覆盖的 G4（partial-write 磁盘污染）、G6（truncated 语义不一致）两项缺口。

**遗漏**：A 发现 G6 对应的"truncated 语义不一致"（§6.5 脚注：`dom-snapshot.mjs` 有 truncated 但 cdp-full-extract 路径无此字段）但在 F1 表中标记了 P0——A 草稿自身未将 truncated 列为独立风险项，仅在 §2.1 表 S10 中作为信息提及。**A 在风险矩阵（§4）中遗漏了 truncated 这一 P0 问题**，仅做了 scenario listing 未做评级。

---

### 2.2 B-D：categorizeVars 全局一套正则 vs AGENT_REMAP 硬编码

| 项 | B 草稿 §6(c) | D 草稿 §10(a) |
|---|---|---|
| categorizeVars 全局正则 | 识别为 MEDIUM | 未直接提及，但 §10(a) G10.1 指出 AGENT_REMAP 是"人工硬编码" |
| AGENT_REMAP 人工维护 | 承认 per-agent 覆盖机制存在，认为"实际影响面可控" | 给出 HIGH（token 重命名导致侧栏失半透效果，构建期无告警） |
| extract↔builder 耦合度 | "cdp-full-extract 输出当下游消费"（暗示有数据流） | "两者是独立离线工具，不存在数据流管道"（明确否认管道） |

**一致性判定：存在核心矛盾。**

- D §10(b) G10.2："extract ↔ builder 之间不存在数据流管道" → 意指 AGENT_REMAP 不受 extract 残缺影响。
- F §18(b)："残缺探测产物写入主题包的路径防护" → 意指 cdp-full-extract 输出可被 `ThemeStudioExportRequest.root` 注入。
- B §6(b)："valueForToken 的噪声变量 fallback 到 bg" + "AGENT_REMAP 是人工 curate" → 意指 AGENT_REMAP 静态，但 valueForToken 是 build-time 函数。

**管道存在性三段论**：
- D 说"无管道"→ 等级 MEDIUM
- F 说"有管道(Default 回退)" → 等级 P0
- B 假设有消费但分类角度不同 → 等级 MEDIUM

**此矛盾需打回重推演**。如果管道存在，F 的 P0 正确，D 仍正确但等级须上调；如果管道不存在，F 的 P0 应降级为 P1 或 P2，D 维持 MEDIUM。

---

### 2.3 C-E：4/6 Agent 缺失 semantic 配置 vs 全局统一阈值

| 项 | C 草稿 §8(b) F-3 | E 草稿 §14(a)、E-06 |
|---|---|---|
| 差异化配置 | 当前无 per-agent tolerance/minRatio → 全局统一阈值 BUG | 4/6 Agent 无 semantic 配置 → isNativeThemeControlled 默认 true 影响采样 |
| 方案方向 | Phase 1 放宽 minRatio → 0.9；Phase 2 引 per-agent 阈值 | 补齐 4 Agent 的 semantic 配置文档先行 |
| 等级 | F-3 HIGH | E-06 P1 |
| 影响面 | DOM 节点 52~244 差异大，统一阈值不公平 | 4 Agent 所有节点被当作 controlled 全量采样 |

**一致性判定：互补但存在分级逻辑缺口。**

C 的"全局阈值"问题和 E 的"4 Agent 缺配置"问题**构成因果链**：
- 缺配置 (E) → isNativeThemeControlled 默认 true → verify-style 采样包含不应渲染节点 → 其中部分节点 miss → matchRatio 下降 → 全局 minRatio=1 直接触发 false（C 的 minRatio=1 告警）。

但两份草稿的评级未统一：
- C 视"4 Agent 缺配置"为背景事实，主风险是"全局统一阈值"（HIGH）。
- E 视"缺配置"为主要风险（P1），"阈值不差异化"是次级风险（R-10 P2）。

**逻辑缺口**：C 和 E 均未量化"4 Agent 缺配置时，minRatio=1 导致的 CI 误报实际概率"。需补充数据：以 doubao（244 节点）为例，假设 nonControlled 合理占比 20%（约 49 节点），这些节点采样 miss 后 matchRatio 最高 0.796，必然 < 1，CI 必然阻断——实际误报率 100%，远高于 C 预估。需重推演等级。

---

## 三、风险等级评定一致性

### 3.1 同一问题跨草稿等级对照表

| 问题要点 | A | B | C | D | E | F | 离散度 |
|---|---|---|---|---|---|---|---|
| CORS 变量丢失 | P1 | MEDIUM | — | — | — | — | 1级（可接受） |
| totalNodes 无闸 | — | — | — | — | — | P0 | 仅F评级 |
| truncated 无人消费 | P2(S10) | — | — | — | — | P0(F4) | **2级，显著矛盾** |
| 全局阈值 | — | MEDIUM | HIGH | — | P2(R-10) | — | **2级，显著矛盾** |
| closed shadow 静默通过 | — | MEDIUM | HIGH | — | P1(E-03) | — | 2级，可调和 |
| 端口硬编码 | P2 | — | — | — | — | P2(G2) | 一致 |
| verify 被跳过 vs 失败 | — | — | HIGH(F-7) | — | P1(E-03) | — | 1级（视角差异） |
| DEFAULT_TOKENS 回退掩蔽 | — | — | — | — | — | P1(F7) | 仅F评级 |

### 3.2 P0/P1 分级标准不统一证据

**证据 1**：truncated 语义不一致
- A 在 §4 风险矩阵中列 F10=P2（high 影响面但 low 发生概率）。这基于：`dom-snapshot.mjs` 的 truncated 字段在 `cdp-full-extract` 路径中丢失，但 A 认为"下游无消费者，所以不影响功能"。
- F 在 §18(a) 阻断点 C 和风险表 F4=P0 中认为：两模块（dom-snapshot vs cdp-full-extract）返回不一致的 truncated 语义，**破坏数据契约**，导致下游无法信任 ANY 模块的 truncated 字段。
- **矛盾根源**：A 以"usage"定义等级（无人用则低），F 以"consistency contract"定义等级（契约破坏则高）。两份草稿的 P0 定义不统一。

**证据 2**：语义检测被跳过 vs 失败
- C 将 "UNVERIFIABLE=PASS" 定为 HIGH + P0 推证（§10 审计结论要求 P0 三态判定）。
- E 将同类问题定 P1（正确性影响）。
- 差异原因：C 以"High riskLevel 组件如果恰好在 closed shadow 内将静默通过、永不阻断 CI"判定为功能性阻断，E 仅视为"报告可读性问题"。

### 3.3 建议统一标准

推荐采用 F 草稿 §3.1(a) 的二维分级：

| 等级 | 语义 |
|---|---|
| **P0-Block** | 主题加载失败/注入崩溃/竞态不可用 |
| **P0-Qual** | 静默质量风险（残缺通过、语义漂移、报告失真），不阻断加载但需 24h 响应 |
| **P1** | 适配器漂移、选择器失效 |
| **P2** | Visual 精度、性能 |

在此框架下：
- truncated 不一致应为 P0-Quality（当前两份草稿均未区分 Block/Quality，导致 P0/P2 两极）
- closed shadow 静默通过应为 P0-Quality（C 正确但需标记为 Quality 非 Block）
- totalNodes 无闸应为 P0-Block（F 的正确判断）

---

## 四、方案推演冲突检查

### 4.1 核心冲突清单

| 编号 | 冲突描述 | 来源 | 严重度 |
|---|---|---|---|
| **C-1** | D 称"extract↔builder 无数据流管道" vs F 称"存在管道且 DEFAULT 回退掩蔽" | D§10(b) vs F§18(b) | **致命**——影响 3 个风险项的等级 |
| **C-2** | B adoptedSheets 盲区缓解（补遍历）vs F adoptedSheets 盲区在 extract-validate 中无对应校验 | B§5(a)盲区1 vs F§4.2(a) | **重要**——C-2 实施后 adoptedSheets 被 extract 覆盖但 extract-validate 不感知 adopted 类型，仍会报 insufficient |
| **C-3** | E 方案（补齐 4 Agent nonControlled 配置）vs C 方案（三态判定）优先级冲突 | E§14(c) vs C§9(b) | **重要**——E 方案可消除 C 方案的部分触发场景 |
| **C-4** | F 方案 partial-write 保护（不写半文件）与 A 方案 partial.json（写残文件保存证据）方向相反 | F§2.2.2 vs A§2.2 | **可调和**——实际生产应 combo：写 partial.json 但 status='insufficient'，下游拒绝消费 |
| **C-5** | A 方案 B（双阶段采集、质量元数据）优先 vs F 方案 A（qualityGate + status='insufficient'）优先 | A§5.1 推荐 B vs F§5.2 推荐 A | **可调和**——B 先采集数据，A 再判定质量，两者可串行组合 |
| **C-6** | cdp-full-extract truncated 字段丢失 (A) vs dom-snapshot truncated 正确输出（C 引.dom-snapshot.mjs L223）——两套脚本对"完整"定义不同，统一方案需对齐 | A§2.1 vs C§9(a) | **重要**——任何 truncated 治理需同时改两套脚本 |

### 4.2 假设破坏检查

| # | A 推荐会破坏 B 假设？ | 验证 |
|---|---|---|
| A1 | A§5.1 方案 A（RAF readyState）要求 CdpClient 支持事件订阅，B§4(a) 表未评估事件订阅路径的完整性 | **潜在破坏**——A 的假设"CDP 事件通道可信"在 B 的 CSP/API 污染分析中未排除。B 指出 API 可被污染但事件通道同样可被 stub |
| A2 | A§5.1 方案 C（AGENT_TIMING per-agent）与 E§14(c) "per-Agent tolerance 不支持"是否冲突？ | **不冲突**：A 的 AGENT_TIMING 是采集阶段（cdp-full-extract），E 的 tolerance 是验证阶段（verify-style），两份配置独立 |
| A3 | B§8 问题 3 方案 A（per-agent 命名空间白名单）与 D§11(b) G11.2（per-agent riskLevel override是否为同一维度的 per-agent 差异化）是否存在概念混淆？ | **混淆风险**：B 在 extract 侧推 per-agent 命名空间，D 在 verify 侧推 per-agent riskLevel，两个"per-agent"关注维度不同但名称相同。建议文档中明确标注"per-agent-extraction"与"per-agent-verification" |

### 4.3 隐式依赖缺口

- E§15(a) 方案 A（MutationObserver 监听 :root style 属性变化）→ 依赖 `MutationObserver` 能感知 CSS 变量改写。但 B§4(a)-3 指出"宿主可能重写 API" → MutationObserver 回调可能被 **stub**。E 的宿主动态变更方案（P0）**依赖未被验证的"宿主不会 stub MutationObserver"假设**。
- F§5.2 方案 C（regression-orchestrator）→ 依赖所有 scripts 都有 CLI 入口，但 C 草稿已指出 `semantic-snapshot.mjs` 当前无 scripts/ 入口（BP-1）。F 的计划未回应这一缺口。
- D§13(a) 方案 B（adapter.verification 与 manifest VERIFICATION 合并为单一源）→ 依赖 adapter.mjs 文件公开暴露 verification 字段，但 B§4(b)-2 指"lastVerified 字段不完整，5 adapter 未声明"。D 未评估合并后 version drift 风险。

---

## 五、遗漏点清单

### 5.1 各草稿未覆盖区域互审

| 缺口 | A | B | C | D | E | F |
|---|---|---|---|---|---|---|
| adoptedStyleSheets 盲区 | §2.1 S4 提及但**无等级** | §5(a) 盲区1 HIGH | — | — | — | F1 不涉及 |
| CSS-in-JS 内存样式 | 未覆盖 | §5(a) 盲区2 HIGH | — | — | — | — |
| lastVerified 字段空缺 | 未覆盖 | §4(b)-2 MEDIUM | — | — | — | — |
| partial-write 磁盘污染 | 未覆盖 | — | — | — | — | §2.2.2 G4 |
| AGENT_TIMING per-agent | §5.1 方案 C 提议 | — | — | — | — | 未推演 |

### 5.2 跨草稿因果链完全缺失

**完整因果链**（草稿中无人完整端到端描述）：

```
cdp-full-extract 残缺（A P1）
  → 写入 <agent>-full-extract.json（无 quality 标记）
    → [管道存在性未定：D 否认 vs F 假设]
      → 若管道存在：sync-remap 消费残缺数据（F P0）
        → build-theme-package DEFAULT_TOKENS 回退掩蔽（F P1）
          → 主题 CSS 写入磁盘
            → injector 注入残缺主题
              → verify-style 采样（E P1）
                → 4 Agent 缺 nonControlled 配置（E P1）
                  → 不应渲染节点参与判定
                    → minRatio=1 全局阈值（C HIGH）
                      → CI 误报阻断
```

此因果链横跨 A→F→F→E→C 五份草稿，但**没有任何一份草稿完整描述全链**。每份草稿只看到自己负责的 1-2 个环节。

---

## 六、需要打回重推演的具体问题列表

### 6.1 必须打回（致命矛盾）

| # | 问题 | 打回原因 | 负责草稿 |
|---|---|---|---|
| **R-1** | extract↔builder 管道存在性 | D 与 F 事实陈述直接冲突，影响 3 项风险等级 | D、F |
| **R-2** | truncated 等级（A=P2 vs F=P0） | 分级标准不统一，需先对齐 P0 定义 | A、F |
| **R-3** | 全局阈值等级（C=HIGH vs E=P2） | 因果链未量化，实际误报率未知 | C、E |

### 6.2 建议打回（重要缺口）

| # | 问题 | 打回原因 | 负责草稿 |
|---|---|---|---|
| **R-4** | adoptedSheets 盲区无等级 | A 仅 scenario listing 未评级，B 评 HIGH 但 A 未响应 | A |
| **R-5** | 4 Agent 缺 semantic 配置的实际影响量化 | C 和 E 均未给出"minRatio=1 + 4 Agent 缺配置"的联合误报率 | C、E |
| **R-6** | 宿主动态变更方案对 MutationObserver 可 stub 的脆弱性 | E 的 P0 方案依赖未验证假设 | E |
| **R-7** | extract-validate 对 adoptedSheets 类型无感知 | F 方案实施后，B 的 adoptedSheets 补全仍会被 validate 报 insufficient | B、F |
| **R-8** | per-agent 差异化命名（B）vs per-agent riskLevel（D）概念混淆 | 两份草稿使用相同术语指代不同维度 | B、D |

### 6.3 建议补充（非打回，完善性）

| # | 问题 | 建议 | 负责草稿 |
|---|---|---|---|
| **S-1** | 全链路因果链端到端描述 | 指定一份草稿（建议 F）补全跨模块因果链图 | F |
| **S-2** | P0-Block / P0-Quality 二维分级统一 | 所有草稿对齐 F§3.1(a) 的分级模型 | A、B、C、D、E |
| **S-3** | 方案优先级排序 | 明确 C-3（E 方案 vs C 方案）的实施顺序 | C、E |
| **S-4** | partial-write 与 partial.json 组合方案 | 明确 F 的"不写半文件"与 A 的"写残文件保存证据"如何共存 | A、F |

---

## 七、综合结论

### 7.1 一致性评分

| 维度 | 评分 | 说明 |
|---|---|---|
| 残缺数据阻断逻辑 | **7/10** | 核心矛盾 1 处（管道存在性），等级差异 2 处，但多数场景互补 |
| 6 Agent 隔离逻辑 | **8/10** | 高度一致，仅 per-agent 差异化维度存在概念混淆 |
| 风险等级评定 | **5/10** | P0/P1 标准不统一，truncated 和全局阈值存在 2 级差异 |
| 方案推演冲突 | **6/10** | 1 致命冲突 + 2 重要冲突 + 3 可调和冲突 |

### 7.2 总体评价

六份草稿在**事实发现层面高度一致**（同一问题被多份草稿独立确认），但在**分级标准、方案优先级、管道假设**三个层面存在系统性不一致。核心原因是：

1. **分级框架不统一**：A/B 用 P1-P3，C/D/E 用 HIGH/MEDIUM/LOW，F 用 P0-P2 + 二维分级。同一问题在不同框架下自然产生不同等级。
2. **管道存在性未定**：D 和 F 对"extract ↔ builder 是否存在自动数据流"的事实陈述直接矛盾，这是本次校验发现的**最严重问题**，影响 3 项风险等级。
3. **因果链碎片化**：每份草稿只看到自己模块内的 1-2 个环节，无人端到端描述"残缺数据从采集到最终 CI 误报"的完整链路。

### 7.3 建议后续动作

1. **立即**：召开对齐会，确认 extract↔builder 管道存在性（R-1），统一分级框架（S-2）。
2. **短期**：打回 R-1~R-8 对应草稿，补充量化数据后重推演。
3. **中期**：指定 F 草稿补全端到端因果链图（S-1），作为后续所有方案推演的基线。
4. **长期**：建立跨草稿的"问题-方案-等级"追踪表，确保同一问题在多份草稿中的处理一致。

---

*交叉校验完成。本报告不替代各草稿的独立评审，仅揭示跨草稿一致性问题。*
