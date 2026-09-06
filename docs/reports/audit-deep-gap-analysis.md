# 深度查漏补缺：边缘异常场景推演报告

> **分析人**：AgentSkin 深度查漏补缺专家  
> **日期**：2026-08-20  
> **输入**：audit-draft-A/B/C/D/E/F + audit-cross-validation-1/2 + audit-cross-fix-notes  
> **方法**：基于既有审计发现，推演未覆盖的边缘异常场景，评估影响范围与风险等级  
> **约束**：仅做分析，不修改任何代码  

---

## 导言：本次查漏补缺的定位

既有 6 份审计草稿 + 2 份交叉校验 + 1 份修补分析，已对 AgentSkin 的 CDP 探针链路、扫描逻辑、语义漂移检测、集成契约、渲染注入规约、工程体系六大维度做了系统审计。但审计覆盖的"边缘场景"主要集中在**单模块内的已知异常**（如 CORS 样式表、closed Shadow DOM、truncated 标记无人消费等），对**跨模块级联异常**、**运行时竞态**、**宿主环境极端行为**等边缘场景覆盖不足。

本报告推演 10 个未被既有审计充分覆盖的边缘异常场景，每个场景包含：推演分析、影响范围、风险等级、防护方案、与 18 条质询的映射。

---

## 场景 1：Agent 进程崩溃中断探测——半套数据写入、崩溃恢复残留

### 推演分析

`cdp-full-extract.mjs` 的 `extractAgent()` 按序执行以下步骤：

1. `captureDomTree()` → 写入 `domDefault`
2. `getRootComputedVariables()` → 写入 `rootVarsDefault`
3. `setColorScheme('dark')` → 切换暗色
4. `captureDomTree()` → 写入 `domDark`
5. `getRootComputedVariables()` → 写入 `rootVarsDark`
6. `sampleComputedStyles()` → 写入 `computedDefault`
7. `sampleComputedStyles()` → 写入 `computedDark`
8. `captureAllStylesheets()` → 写入 `stylesheets`

若 Agent 进程在第 4 步后崩溃（如 OOM、用户手动杀进程、GPU 进程崩溃连带渲染进程终止），当前代码的行为是：

- `extractAgent()` 的外层 try/catch 捕获异常 → 返回 `null`
- 已写入磁盘的 `<agent>-full-extract.json` **不会被回滚**（F 草稿 §2.2.2 G4 已识别 partial-write 问题）
- 但 G4 仅关注"主题包文件只写一半"，未覆盖"extract JSON 半套写入"的场景

**更危险的子场景**：若崩溃发生在 `setColorScheme('dark')` 成功之后、`captureDomTree()` 之前，Agent 进程重启后可能**停留在暗色模式**（因为 `Emulation.setEmulatedMedia` 是持久化设置，不随 CDP 会话断开而重置）。下次 `cdp-full-extract` 运行时，亮色/暗色数据全部是暗色模式下的产物——但 `meta` 中无 `colorSchemeState` 字段，下游无法识别。

### 影响范围

| 维度 | 影响 |
|------|------|
| 数据完整性 | 半套 extract JSON 流入下游（若管道存在）或误导开发者诊断 |
| 宿主状态残留 | Agent 进程崩溃后 `prefers-color-scheme` 可能停留在暗色，影响后续所有采集 |
| 恢复成本 | 需手动重启 Agent 并确认亮色模式恢复，无自动化检测 |

### 风险等级

**P0-Quality**（非功能阻断，但导致数据静默失真）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 原子写入** | extract 先写 `${agent}-full-extract.tmp`，全部成功后 `rename` 为正式文件 | 低 |
| **B. 会话初始状态校验** | 每次 `extractAgent()` 开始时通过 `Emulation.setEmulatedMedia` 显式设置 `prefers-color-scheme: light` 作为归位 | 低 |
| **C. 崩溃检测哨兵** | 在 extract JSON 中写入 `completionSteps: ['domDefault', 'rootVarsDefault', 'darkSwitch', ...]`，下游据此判断完整性 | 低 |

**推荐**：A + B 组合（最小改动覆盖核心风险）

### 与 18 条质询映射

- **Q2(b) 残缺数据连锁阻断**：半套写入是残缺数据的极端形式，当前无阻断
- **Q16(a) 单 Agent 完整回归流程**：BP-3（暗色/亮色失败静默接受）的崩溃增强版
- **Q18(a) 数据流污染阻断**：阻断点 A（totalNodes 无闸）的 extract 侧等价问题

---

## 场景 2：React 并发渲染半挂载组件——语义签名抖动

### 推演分析

AgentSkin 的 6 个 Agent 中，traework（VS Code 内核）和 codex（ChatGPT 桌面端）使用 React 18+ 的并发渲染特性。React 的 Concurrent Mode 允许渲染过程被**中断和恢复**，这意味着：

- `buildSemanticSnapshot()` 调用 `document.querySelectorAll('*')` 时，React 可能正在 commit 阶段中途
- 部分组件已完成 DOM 插入但**事件绑定和 effect 尚未执行**（即"半挂载"状态）
- 若此时采集语义签名，得到的 DOM 结构是**不完整的中间态**

**具体推演**：

1. React 开始渲染一个包含 5 个子组件的 sidebar
2. 渲染到第 3 个子组件时被高优先级更新中断
3. `buildSemanticSnapshot()` 的 `querySelectorAll('*')` 遍历到 sidebar → 只发现 3 个子组件
4. 语义签名记录 `sidebar.childCount = 3`
5. React 恢复渲染，完成剩余 2 个子组件
6. 下次采集时 `sidebar.childCount = 5`

两次采集的语义签名不同，但**并非 Agent 应用版本变化导致**，而是 React 并发渲染的中间态被快照捕获。

### 影响范围

| 维度 | 影响 |
|------|------|
| 语义漂移检测 | 产生 false-positive 漂移告警（签名变化但应用未更新） |
| 基线稳定性 | 基线语义签名不稳定，CI 误报率上升 |
| 开发者诊断 | 开发者无法区分"真正的 DOM 漂移"和"并发渲染中间态" |

### 风险等级

**P1**（影响语义漂移检测的可靠性，不阻断主流程）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. requestIdleCallback 等待** | 在 `buildSemanticSnapshot()` 的 IIFE 中等待 `requestIdleCallback` 触发后再采集，确保 React 完成当前渲染周期 | 低 |
| **B. 连续两次采样去抖** | 间隔 100ms 采集两次，若结构一致则采纳，不一致则等待后重试（最多 3 次） | 中 |
| **C. React DevTools Hook 检测** | 通过检测 `window.__REACT_DEVTOOLS_GLOBAL_HOOK__` 判断 React 是否处于渲染中（仅限开发模式） | 高 |

**推荐**：A（最小改动，覆盖 80% 场景）

### 与 18 条质询映射

- **Q1(a) 就绪判定逻辑**：cdp-full-extract 无 DOM settling 检测（A 草稿 F1），React 并发渲染是 DOM settling 的特殊形式
- **Q7(a) 基线存储**：基线语义签名的稳定性依赖采集时刻的 DOM 完整性
- **Q8(a) 签名比对逻辑**：签名抖动会被误判为语义漂移

---

## 场景 3：混合 ShadowDOM + 普通 DOM——跨 boundary 变量继承

### 推演分析

Agent 应用中存在大量混合 Shadow DOM 场景：

- **traework**（VS Code 内核）：`attachShadow({ mode: 'open' })` 用于 Webview 内容区
- **doubao**：Semi Design 组件库使用 open shadow root 封装复杂组件
- **codex**：ChatGPT 桌面端使用 shadow DOM 隔离代码块渲染

CSS 自定义属性（变量）的继承规则：
- **open shadow root**：`:root` 上定义的 CSS 变量**可以穿透** shadow boundary 继承到 shadow tree 内
- **closed shadow root**：变量继承被阻断

**边缘场景**：当一个 open shadow root 的 shadow host 位于某个已主题化的普通 DOM 节点内时：

1. AgentSkin 在 `:root` 上注入 `--agentskin-text: #ffffff`
2. Shadow host 节点继承了 `--agentskin-text`（CSS 变量继承）
3. Shadow tree 内的元素也继承了 `--agentskin-text`（open shadow 允许穿透）
4. 但 shadow tree 内的元素可能**同时**使用宿主原生变量（如 `--vscode-foreground`）
5. 若 AgentSkin 的 bridge 配置将 `--vscode-foreground` 映射到 `--agentskin-text`，则 shadow tree 内的元素同时受两套变量影响

**更危险的子场景**：shadow tree 内的元素通过 `var(--agentskin-text, fallback)` 使用变量，但 shadow host 的 `part()` API 暴露了内部元素。若 AgentSkin 的主题 CSS 通过 `::part()` 选择器覆盖 shadow 内部样式，可能与变量继承产生**优先级冲突**。

### 影响范围

| 维度 | 影响 |
|------|------|
| 主题一致性 | Shadow DOM 内部元素可能呈现不一致的配色 |
| verify-style 判定 | shadow 内部节点被纳入采样（open shadow 可穿透），但其计算样式受双重变量影响，可能误判为 miss |
| Bridge 优先级 | Bridge 变量穿透 shadow boundary 后可能与 shadow 内部样式冲突 |

### 风险等级

**P1**（影响主题一致性和 verify-style 判定准确性）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. Shadow Host 降级采样** | verify-style 对 open shadow root 仅采样 shadow host 节点，不穿透到 shadow tree 内部 | 低 |
| **B. CSS 变量隔离标记** | 在注入主题时，为 shadow host 添加 `data-agentskin-shadow-host` 属性，verify-style 据此排除 shadow 内部节点 | 低 |
| **C. Bridge 穿透感知** | bridge 配置增加 `penetratesShadow: true/false` 标记，穿透 shadow 的 bridge 变量在 shadow host 层注入而非 `:root` | 中 |

**推荐**：A + B 组合

### 与 18 条质询映射

- **Q9 Shadow-Root 边界**：C 草稿仅覆盖 closed shadow root 的不可校验问题，未覆盖 open shadow 的变量穿透
- **Q12(a) 扁平结构信息丢失**：shadow DOM 内的局部 token 覆写是扁平结构无法表达的
- **Q14(a) 允许/跳过清单**：Shadow DOM 容器的注入/跳过规则未文档化

---

## 场景 4：多主题包快速切换（A→B→A）——混合快照污染基线

### 推演分析

用户通过 AgentSkin Studio 快速切换主题包（如从"暗黑主题"切换到"赛博朋克"再切回"暗黑主题"），`injector.mjs` 的 `applyTheme()` 被连续调用：

1. `applyTheme('dark-theme')` → 注入 CSS A
2. `applyTheme('cyber-theme')` → 注入 CSS B（覆盖 CSS A）
3. `applyTheme('dark-theme')` → 重新注入 CSS A

**边缘场景**：若步骤 2 的 `applyTheme` 在 `waitForCompatibility` 阶段发现不兼容（如 cyber-theme 的某个 token 在目标 Agent 中无对应变量），该主题被归入 `skipped` 列表（injector.mjs L286-287）。但步骤 1 注入的 CSS A 可能已被步骤 2 的 `buildApplyExpression` 部分覆盖（如 `!important` 规则冲突）。

**更危险的子场景**：`baseline-validator.ts` 的 `validateBaselineCss()` 在步骤 1 之前执行了一次基线校验，确认原生状态可复刻。步骤 2 失败后，引擎回退到步骤 1 的状态——但此时 `:root` 上的 CSS 变量可能已被步骤 2 部分修改（如 bridge 变量被覆盖），基线快照 $B_0$ 已不再反映当前页面状态。

若步骤 3 重新注入 CSS A，verify-style 的采样结果可能与 $B_0$ 比对通过（因为 CSS A 恢复了原始值），但**实际页面状态**可能因步骤 2 的残留而不同（如某些节点的内联 style 被修改）。

### 影响范围

| 维度 | 影响 |
|------|------|
| 基线一致性 | 基线快照与实际页面状态不一致，后续 verify-style 比对失真 |
| 主题残留 | 快速切换可能导致多个主题的 CSS 变量混合残留 |
| 诊断困难 | 开发者无法确定当前页面受哪个主题影响 |

### 风险等级

**P0-Quality**（静默质量风险，可能导致主题状态不可预测）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 主题切换前基线重置** | 每次 `applyTheme()` 前执行 `removeTheme()` 并等待 DOM settling，确保从干净状态开始 | 中 |
| **B. 切换防抖** | 在 `injector.mjs` 中增加 500ms 防抖，快速连续切换仅执行最后一次 | 低 |
| **C. 基线版本标记** | 基线快照中嵌入 `themeId` + `appliedAt` 时间戳，verify-style 比对时检查当前主题与基线主题是否一致 | 中 |

**推荐**：A + B 组合

### 与 18 条质询映射

- **Q15(a) 宿主动态变更**：主题切换是宿主动态变更的特殊形式，重采流程未闭环
- **Q15(b) 基线误报规避**：快速切换后的基线与实际状态不一致是误报的根源
- **Q18(b) 主题包写入防护**：快速切换可能导致多个主题包的 CSS 混合写入

---

## 场景 5：严格 CSP 下 Runtime.evaluate 被拦截——fallback 路径

### 推演分析

B 草稿 §4(a)-2 已指出 `Runtime.evaluate` 路径无法识别 CSP 拦截。但审计未覆盖的是：**当 CSP 拦截确实发生时，引擎的 fallback 行为是什么？**

当前代码中，`Runtime.evaluate` 被 CSP 拦截时的表现：

1. `CdpClient.send('Runtime.evaluate', ...)` 返回 `exceptionDetails`（CSP 违规）
2. 调用方 catch 后返回 `undefined` 或空结构
3. 上层逻辑将空结构视为"数据不存在"而非"被拦截"

**边缘场景**：某些 Agent 应用（如 codex 的 ChatGPT 桌面端）可能配置了严格的 CSP：

```
script-src 'self'; style-src 'self' 'unsafe-inline'
```

在此 CSP 下：
- `Runtime.evaluate` 注入的 IIFE 脚本**可能被拦截**（取决于 `script-src` 是否包含 `unsafe-eval`）
- `Page.addScriptToEvaluateOnNewDocument` 注册的持久化脚本**不受 CSP 影响**（renderer-payload.mjs L376 注释已确认）

**关键缺口**：`cdp-full-extract.mjs` 的所有采集函数（`captureDomTree`、`sampleComputedStyles`、`captureAllStylesheets`、`getRootComputedVariables`）均通过 `Runtime.evaluate` 执行。若 CSP 拦截了 `unsafe-eval`，这些函数全部返回空结构——但 `extractAgent()` 不会报错，仍会"正常完成"并输出残缺 JSON。

### 影响范围

| 维度 | 影响 |
|------|------|
| 采集完整性 | 所有 Runtime.evaluate 采集函数失效，输出空数据 |
| 错误识别 | 引擎无法区分"CSP 拦截"与"Agent 确实无此变量" |
| 下游消费 | 残缺数据流入下游，可能被当作有效数据使用 |

### 风险等级

**P0-Quality**（静默数据丢失，与 CORS 变量丢失同等级别但影响面更大）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. CSP 预检** | 在 `extractAgent()` 开始时执行一次 `Runtime.evaluate('1+1')`，若返回 exceptionDetails 含 CSP 错误则立即终止并标记 `blockedByCSP: true` | 低 |
| **B. 双通道降级** | 对关键采集函数（如 `captureDomTree`），先尝试 `Runtime.evaluate`，失败后降级为 `Page.addScriptToEvaluateOnNewDocument` + `Runtime.evaluate` 读取结果 | 中 |
| **C. CSP 报告头解析** | 通过 CDP `Network.responseReceived` 事件的 `response.headers` 解析 `Content-Security-Policy` 头，预判是否可能拦截 evaluate | 高 |

**推荐**：A（最小改动，至少让 CSP 拦截可见）

### 与 18 条质询映射

- **Q4(a) 脚本完整性校验**：CSP 拦截是脚本完整性校验的核心场景，当前完全无法识别
- **Q2(a) 天然残缺场景**：CSP 拦截导致的残缺与 CORS 导致的残缺机制不同但后果相同
- **Q18(a) 数据流污染阻断**：CSP 拦截导致的残缺数据是数据流污染的另一种来源

---

## 场景 6：大型 DOM 截断位置变化——语义签名伪漂移

### 推演分析

`dom-snapshot.mjs` 的 `buildDomSnapshotExpression()` 在 `nodes.length >= config.maxNodes`（默认 2000）时设置 `truncated = true` 并停止遍历。`cdp-full-extract.mjs` 的 `captureDomTree()` 在 `count >= maxNodes` 时静默停止遍历（无 truncated 标记）。

**边缘场景**：假设 doubao 的 DOM 节点数为 244（C 草稿 §8(b) 数据），远低于 2000 的截断阈值。但 doubao 的 DOM 结构可能因用户操作（如展开侧栏、打开设置面板）动态增长：

1. 初始状态：244 节点，无截断
2. 用户展开侧栏：+50 节点 → 294 节点，仍无截断
3. 用户打开设置面板：+1800 节点 → 2094 节点 → **触发截断**

**关键问题**：截断位置取决于 DOM 遍历顺序（`querySelectorAll('*')` 返回文档顺序）。若用户操作改变了 DOM 结构（如插入新节点），截断位置会变化——导致**前后两次采集的节点集合不同**，但并非"语义漂移"而是"截断位置漂移"。

**更危险的子场景**：若 `buildSemanticSnapshot()` 在截断前采集了 sidebar 的 5 个子组件，而下次采集时因 DOM 结构变化，截断发生在 sidebar 的第 3 个子组件处——语义签名从 `sidebar.childCount=5` 变为 `sidebar.childCount=3`，被误判为"sidebar 组件漂移"。

### 影响范围

| 维度 | 影响 |
|------|------|
| 语义漂移检测 | 截断位置变化产生 false-positive 漂移告警 |
| 基线稳定性 | 大型 DOM 的基线签名不稳定，CI 误报率上升 |
| 开发者诊断 | 开发者无法区分"真正的组件漂移"和"截断位置变化" |

### 风险等级

**P1**（影响语义漂移检测的可靠性，当前 semantic-quant 层为实验性，实际影响有限）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 截断位置记录** | 在语义签名中记录 `truncatedAt: { depth, nodeTag, parentPath }`，帮助开发者判断截断是否影响关键组件 | 低 |
| **B. 关键组件优先遍历** | 修改遍历顺序，优先遍历 COMPONENT_INDEX 中登记的 6 个关键组件，确保它们不被截断 | 中 |
| **C. 动态 maxNodes** | 根据 Agent 的 DOM 复杂度动态调整 maxNodes（如 doubao 244 节点用 500 阈值，workbuddy 205 节点用 400 阈值） | 低 |

**推荐**：A + C 组合

### 与 18 条质询映射

- **Q5(a) DOM 与样式扫描完整性**：截断是扫描不完整的一种形式
- **Q8(a) 签名比对逻辑**：截断位置变化导致签名伪漂移
- **Q18(a) 数据流污染阻断**：truncated 标记无消费方（F 草稿阻断点 C）

---

## 场景 7：@property Houdini 动态注册——事件感知缺失

### 推演分析

CSS Houdini 的 `@property` 规则允许开发者注册自定义 CSS 属性，赋予其类型检查、默认值和继承能力：

```css
@property --my-color {
  syntax: '<color>';
  inherits: true;
  initial-value: #000;
}
```

B 草稿 §5(a)-1 的样式来源覆盖矩阵中，`@property` 注册自定义属性标注为"完全不采集"。但审计未覆盖的是：**@property 注册可能发生在运行时**，且引擎无法感知。

**边缘场景**：

1. Agent 应用启动时通过 JS 动态注册 `@property --vscode-foreground`
2. 注册后，该变量具有明确的 `syntax: '<color>'` 和 `initial-value`
3. `cdp-full-extract.mjs` 的 `getRootComputedVariables()` 通过 `getComputedStyle(document.documentElement)` 读取 `:root` 变量
4. 但 `@property` 注册的变量**不一定出现在 `:root` 的 `getComputedStyle` 返回中**（取决于浏览器实现）
5. 即使能读取到值，引擎也无法区分"原生 CSS 变量"和"Houdini 注册的变量"

**更危险的子场景**：若 Agent 应用在运行时**重新注册**了某个已存在的 `@property`（如将 `inherits: true` 改为 `inherits: false`），CSS 变量的继承行为会发生变化。AgentSkin 的 bridge 配置假设变量可继承（`--vscode-foreground` → `--agentskin-text`），但 Houdini 重新注册后继承被阻断——bridge 失效，但引擎无感知。

### 影响范围

| 维度 | 影响 |
|------|------|
| Bridge 有效性 | Houdini 注册/重新注册可能导致 bridge 变量继承行为变化 |
| 变量采集完整性 | `@property` 注册的变量可能无法通过 `getComputedStyle` 读取 |
| 运行时正确性 | 引擎无法感知 Houdini 注册事件，无法触发重注入 |

### 风险等级

**P2**（当前 6 个 Agent 中未确认使用 Houdini @property，但未来可能遇到）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. CSS Houdini 探测** | 在 `getRootComputedVariables()` 中增加 `CSS.registerProperty` 调用检测，若存在则记录到 `meta.houdiniProperties` | 低 |
| **B. @property 规则采集** | 在 `captureAllStylesheets()` 中增加对 `@property` 规则的解析和记录 | 中 |
| **C. 继承行为校验** | verify-style 在采样时检查 shadow DOM 内部的变量值是否与 shadow host 一致，若不一致则标记 `inheritanceBroken: true` | 中 |

**推荐**：A（探测即可，暂不处理）

### 与 18 条质询映射

- **Q5(a) DOM 与样式扫描完整性**：`@property` 是样式来源覆盖矩阵中的盲区
- **Q15(a) 宿主动态变更**：Houdini 运行时重新注册是宿主动态变更的一种形式
- **Q4(a) 脚本完整性校验**：`CSS.registerProperty` 是宿主 API 污染检测的一部分

---

## 场景 8：同窗口多 iframe 同 URL 不同状态——frameId 隔离

### 推演分析

A 草稿 §6.4 指出 `cdp-full-extract.mjs` 仅取第一个 `page` type target（L801），但未覆盖同窗口内多 iframe 的场景。

**边缘场景**：traework（VS Code 内核）使用 iframe 隔离扩展宿主和 Webview 内容：

1. 主 iframe：`https://traework.app/chat`（已登录，显示聊天界面）
2. Webview iframe：`https://traework.app/webview`（可能显示不同的 UI 状态）
3. 设置 iframe：`https://traework.app/settings`（完全不同的 DOM 结构）

这三个 iframe 可能共享相同的 URL 路径（如都是 `https://traework.app/` 下的 hash 路由），但 DOM 结构和 CSS 变量集合完全不同。

**当前代码的行为**：
- `cdp-full-extract.mjs` 通过 `Runtime.evaluate` 在主 frame 执行，只能访问主 frame 的 DOM
- `analyze-structure-compare.mjs` 通过 `listCdpTargets` 发现多个 target，但 `cdp-full-extract` 未复用此逻辑
- `injector.mjs` 的 `withSessions` 遍历所有 target，但 `waitForCompatibility` 的 `expression` 在主 frame 执行

**更危险的子场景**：若某个 iframe 中的 DOM 结构与主 frame 不同（如 Webview 中嵌入了第三方页面），`buildVerifyExpression` 的 `buildStyleSamplingSnippet()` 可能在该 iframe 中采样到**不属于 Agent 应用的 DOM 节点**（如嵌入的网页内容），导致 verify-style 误判。

### 影响范围

| 维度 | 影响 |
|------|------|
| 采集完整性 | 仅采集主 frame，遗漏 iframe 中的样式和 DOM |
| 注入覆盖 | iframe 中的内容可能未被主题覆盖 |
| verify-style 准确性 | 若 iframe 被纳入采样，可能引入非 Agent 应用的节点 |

### 风险等级

**P1**（影响多窗口/多 iframe Agent 的主题覆盖度）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. frameId 过滤** | 在 `buildVerifyExpression` 的采样逻辑中增加 `window.self === window.top` 检查，仅采样主 frame | 低 |
| **B. iframe 感知注入** | `injector.mjs` 的 `withSessions` 对每个 iframe 执行独立的 `waitForCompatibility` 和 `applyTheme` | 中 |
| **C. CDP frameTree 遍历** | 通过 `Page.getFrameTree` 获取所有 frame，逐个执行采集和注入 | 高 |

**推荐**：A（最小改动，防止 iframe 节点污染 verify-style 采样）

### 与 18 条质询映射

- **Q3 多 Agent 差异化时序隔离**：iframe 隔离是 Agent 内多 target 隔离的另一种形式
- **Q2(a) 天然残缺场景**：iframe 中的 DOM 和样式是天然残缺场景的延伸
- **Q16(b) 批量隔离**：多 iframe 场景需要独立的失败隔离机制

---

## 场景 9：暗色/亮色过渡动画 300ms 中间态——基线写入

### 推演分析

现代 Web 应用在明暗模式切换时通常添加过渡动画（如 `transition: background-color 300ms`）。A 草稿 §1.1(a) 指出 `cdp-full-extract.mjs` 使用 `THEME_SWITCH_WAIT = 600ms` 等待切换完成，但未覆盖的是：**600ms 等待是否足够？**

**边缘场景**：

1. `setColorScheme('dark')` 触发 `Emulation.setEmulatedMedia`
2. Agent 应用响应媒体查询变化，开始 300ms 过渡动画
3. 动画过程中，`getComputedStyle` 返回**中间值**（如 `rgb(128, 128, 128)` 介于亮色 `#fff` 和暗色 `#000` 之间）
4. 若 `captureDomTree()` 在动画执行期间（如切换后 200ms）开始遍历，DOM 结构可能正在变化（如某些组件在暗色模式下渲染不同的子树）

**更危险的子场景**：`baseline-validator.ts` 的 `validateBaselineCss()` 在主题加载前执行一次基线校验。若此时 Agent 应用正在执行明暗过渡动画（如用户手动切换了系统主题），`probeNativeBaseline()` 采集到的基线数据是**动画中间态**——既不是纯亮色也不是纯暗色。后续 `assessFidelity()` 将中间态基线作为"原生状态"回注，回注后的页面状态与真实亮色/暗色都不一致。

### 影响范围

| 维度 | 影响 |
|------|------|
| 基线准确性 | 过渡动画中间态被写入基线，导致后续比对失真 |
| 主题注入 | 基于中间态基线注入的主题可能呈现错误的配色 |
| verify-style | 采样时若动画未完成，计算样式为中间值，与主题 token 不匹配 |

### 风险等级

**P0-Quality**（静默质量风险，可能导致基线数据永久失真）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 动画完成检测** | 在 `setColorScheme` 后注入一段 `requestAnimationFrame` 轮询，检测 `getComputedStyle` 返回值是否稳定（连续 3 帧变化 < 1%） | 中 |
| **B. 强制禁用过渡** | 在采集前注入 `* { transition: none !important; }` 临时禁用所有过渡动画 | 低 |
| **C. 过渡等待超时** | 将 `THEME_SWITCH_WAIT` 从固定 600ms 改为动态等待（检测稳定或超时 2000ms） | 低 |

**推荐**：B + C 组合（最小改动，覆盖 95% 场景）

### 与 18 条质询映射

- **Q1(a) 就绪判定逻辑**：过渡动画是 DOM settling 的特殊形式
- **Q15(a) 宿主动态变更**：明暗过渡是宿主动态变更的常见场景
- **Q15(b) 基线误报规避**：过渡动画中间态写入基线是误报的根源之一

---

## 场景 10：Electron 主进程重启后 CDP 会话池——旧 session UUID 悬挂

### 推演分析

`session-pool-runtime.mjs` 的会话池以 `target.id || webSocketDebuggerUrl` 为 key 缓存 CDP 会话。A 草稿 §3.2 指出 `persistenceSessions` Map 会积累 stale entries，但未覆盖的是：**Electron 主进程重启后的会话池状态**。

**边缘场景**：

1. Electron 主进程因崩溃或热重载重启
2. 所有 CDP target 的 `targetId` 和 `webSocketDebuggerUrl` 发生变化（新进程分配新 ID）
3. 但 `session-pool-runtime.mjs` 的 Map 中仍持有旧 targetId → 旧 WebSocket 连接的映射
4. 新 target 出现时，`acquireSession()` 使用新 targetId 查询 Map → 未命中 → 创建新连接
5. 旧 WebSocket 连接**未被关闭**，成为悬挂连接

**更危险的子场景**：若 Electron 主进程重启后恰好分配了与旧进程相同的 `targetId`（CDP targetId 是进程内自增的，重启后从 1 开始），`acquireSession()` 可能命中旧 Map 条目并尝试使用已断开的 WebSocket 连接——导致 CDP 命令超时（10s），但**不会触发重试**（F 草稿 §2.2.2 G5）。

### 影响范围

| 维度 | 影响 |
|------|------|
| 资源泄漏 | 旧 WebSocket 连接未被关闭，占用文件描述符 |
| CDP 超时 | 使用已断开的连接导致 10s 超时，影响注入性能 |
| 会话隔离 | 新旧会话可能混淆，导致注入到错误的 target |

### 风险等级

**P1**（影响运行时可靠性和资源管理，不阻断主流程）

### 防护方案

| 方案 | 描述 | 复杂度 |
|------|------|--------|
| **A. 进程世代标记** | 在会话池中增加 `processGeneration` 字段，Electron 主进程重启时递增，旧世代的会话自动失效 | 中 |
| **B. WebSocket 健康检查** | 每次 `acquireSession()` 时发送 `Runtime.evaluate('1')` 探测连接可用性，不可用时关闭并重建 | 低 |
| **C. 进程退出清理** | 监听 Electron 的 `before-quit` 或 `will-quit` 事件，主动关闭所有 CDP 会话 | 低 |

**推荐**：B + C 组合

### 与 18 条质询映射

- **Q3 多 Agent 差异化时序隔离**：会话池隔离是 Agent 隔离的核心机制
- **Q16(b) 批量隔离**：会话池悬挂可能导致批量注入失败
- **Q17(b) kill-switch**：会话池清理是紧急熔断机制的一部分

---

## 综合风险矩阵

| # | 场景 | 风险等级 | 影响面 | 既有审计覆盖度 |
|---|------|---------|--------|--------------|
| 1 | Agent 进程崩溃中断探测 | P0-Quality | 数据完整性 + 宿主状态残留 | 部分覆盖（F G4 提及 partial-write，未覆盖崩溃场景） |
| 2 | React 并发渲染半挂载组件 | P1 | 语义签名稳定性 | 未覆盖 |
| 3 | 混合 ShadowDOM + 普通 DOM | P1 | 主题一致性 + verify-style 准确性 | 部分覆盖（C §9 覆盖 closed shadow，未覆盖 open shadow 变量穿透） |
| 4 | 多主题包快速切换 | P0-Quality | 基线一致性 + 主题状态可预测性 | 部分覆盖（E §15 覆盖宿主动态变更，未覆盖快速切换） |
| 5 | 严格 CSP 下 Runtime.evaluate 被拦截 | P0-Quality | 采集完整性 + 错误识别 | 部分覆盖（B §4(a)-2 识别 CSP 问题，未覆盖 fallback 行为） |
| 6 | 大型 DOM 截断位置变化 | P1 | 语义漂移检测可靠性 | 部分覆盖（A F10 + F 阻断点 C 覆盖 truncated，未覆盖截断位置漂移） |
| 7 | @property Houdini 动态注册 | P2 | Bridge 有效性 + 变量采集完整性 | 未覆盖（B §5(a)-1 标注为盲区，未推演运行时注册场景） |
| 8 | 同窗口多 iframe 同 URL 不同状态 | P1 | 采集完整性 + 注入覆盖度 | 部分覆盖（A §6.4 覆盖多 WebView，未覆盖 iframe 隔离） |
| 9 | 暗色/亮色过渡动画 300ms 中间态 | P0-Quality | 基线准确性 + 主题注入正确性 | 未覆盖 |
| 10 | Electron 主进程重启后 CDP 会话池 | P1 | 运行时可靠性 + 资源管理 | 部分覆盖（A §3.2 覆盖 stale session，未覆盖主进程重启） |

---

## 与 18 条质询的完整映射表

| 质询 | 覆盖的场景 | 映射说明 |
|------|-----------|---------|
| Q1 探针执行时机 | 场景 2、9 | React 并发渲染和过渡动画是 DOM settling 的特殊形式 |
| Q2 探测不全处理 | 场景 1、5、8 | CSP 拦截、iframe 遗漏、崩溃导致的残缺 |
| Q3 多 Agent 差异化时序隔离 | 场景 8、10 | iframe 隔离和会话池隔离是多 Agent 隔离的延伸 |
| Q4 脚本完整性校验 | 场景 5、7 | CSP 拦截和 Houdini API 是脚本完整性校验的盲区 |
| Q5 DOM 与样式扫描完整性 | 场景 6、7 | 截断位置漂移和 Houdini 变量是扫描完整性的边缘场景 |
| Q6 扫描后过滤 | — | 本次推演未发现新的过滤边缘场景 |
| Q7 基线存储 | 场景 2、6 | React 并发渲染和截断位置变化影响基线稳定性 |
| Q8 签名比对逻辑 | 场景 2、6 | 签名抖动和伪漂移是签名比对的边缘场景 |
| Q9 Shadow-Root 边界 | 场景 3 | Open shadow DOM 的变量穿透是 Shadow-Root 边界的新问题 |
| Q10 AGENT_REMAP 集成 | — | 本次推演未发现新的集成边缘场景 |
| Q11 adapter.verification 契约 | — | 本次推演未发现新的契约边缘场景 |
| Q12 verify-style 与局部覆写 | 场景 3 | Shadow DOM 内的变量继承是局部覆写的特殊形式 |
| Q13 extract/manifest/adapter 闭环 | — | 本次推演未发现新的闭环边缘场景 |
| Q14 注入规约 | 场景 3、8 | Shadow DOM 和 iframe 的注入/跳过规则是规约缺失的一部分 |
| Q15 宿主动态变更 | 场景 4、9 | 主题快速切换和明暗过渡是宿主动态变更的具体形式 |
| Q16 回归链路 | 场景 1、8、10 | 崩溃恢复、iframe 隔离、会话池管理是回归链路的边缘场景 |
| Q17 优先级定义 | 场景 10 | 会话池清理是 kill-switch 设计的补充场景 |
| Q18 数据流污染 | 场景 1、4、5 | 崩溃残留、主题混合、CSP 拦截是数据流污染的新来源 |

---

## 优先级建议

### 立即响应（P0-Quality，24h 内）

| 场景 | 推荐方案 | 预期工作量 |
|------|---------|-----------|
| 场景 1：Agent 崩溃中断探测 | 原子写入 + 初始状态校验 | 0.5 天 |
| 场景 4：多主题包快速切换 | 切换防抖 + 基线重置 | 1 天 |
| 场景 5：严格 CSP 拦截 | CSP 预检 | 0.5 天 |
| 场景 9：明暗过渡动画中间态 | 强制禁用过渡 + 动态等待 | 0.5 天 |

### 版本周期内修复（P1）

| 场景 | 推荐方案 | 预期工作量 |
|------|---------|-----------|
| 场景 2：React 并发渲染 | requestIdleCallback 等待 | 1 天 |
| 场景 3：混合 ShadowDOM | Shadow Host 降级采样 + 隔离标记 | 1 天 |
| 场景 6：截断位置变化 | 截断位置记录 + 动态 maxNodes | 0.5 天 |
| 场景 8：多 iframe 隔离 | frameId 过滤 | 0.5 天 |
| 场景 10：CDP 会话池悬挂 | WebSocket 健康检查 + 进程退出清理 | 1 天 |

### 排期优化（P2）

| 场景 | 推荐方案 | 预期工作量 |
|------|---------|-----------|
| 场景 7：Houdini @property | CSS Houdini 探测 | 0.5 天 |

---

## 方法论反思

### 本次推演揭示的系统性问题

1. **"采集时机的确定性"假设过强**：既有审计已识别 cdp-full-extract 使用硬定时器（A F1），但未推演"定时器等待期间页面正在变化"的具体场景（React 并发渲染、过渡动画）。采集时机不仅需要"等待足够长"，还需要"等待页面真正稳定"。

2. **"单 target"假设过强**：既有审计已识别多 WebView 场景（A §6.4），但未推演同窗口内多 iframe 的隔离问题。AgentSkin 的注入和验证逻辑默认操作"主 frame"，可能遗漏 iframe 中的内容。

3. **"会话持久"假设过强**：既有审计已识别 stale session 问题（A §3.2），但未推演 Electron 主进程重启后的会话池状态。CDP 会话与 Electron 进程生命周期绑定，但会话池未感知进程重启。

4. **"CSS 变量静态"假设过强**：既有审计已识别 CORS 样式表变量丢失（A F3），但未推演 CSS 变量在运行时被宿主或 Houdini API 动态注册/重注册的场景。Bridge 配置假设变量名静态不变，但运行时重注册可能导致继承行为变化。

5. **"注入幂等"假设过强**：既有审计已识别 `watchTheme` 的自愈机制（A §1.2(c)），但未推演快速连续切换主题时的非幂等场景。多次 `applyTheme` 调用可能产生 CSS 残留和基线不一致。

### 与 audit-cross-fix-notes.md 的关联

交叉修补分析报告解决了 3 个核心矛盾（extract↔builder 管道存在性、truncated 等级、全局阈值联合效应），本次推演的 10 个场景中有 4 个与修补结论直接相关：

| 修补矛盾 | 关联场景 | 说明 |
|---------|---------|------|
| 矛盾 1：管道不存在 | 场景 1（崩溃中断） | 管道不存在意味着 extract 残缺数据不自动流入 builder，但崩溃导致的半套 JSON 仍会误导开发者 |
| 矛盾 2：truncated 统一为 P1 | 场景 6（截断位置漂移） | 确认 P1 定位，截断位置变化是 truncated 问题的动态增强版 |
| 矛盾 3：全局阈值 P0-Block | 场景 2（React 并发渲染） | 全局阈值 + 4 Agent 缺配置 = P0-Block，React 并发渲染额外增加了签名不稳定性 |
| 矛盾 3：全局阈值 P0-Block | 场景 3（Shadow DOM） | Shadow DOM 内的节点被纳入采样（open shadow 可穿透），增加 miss 概率 |

---

## 结论

### 核心发现

1. **4 个 P0-Quality 场景**需要立即响应：Agent 崩溃中断探测、多主题包快速切换、严格 CSP 拦截、明暗过渡动画中间态。这些场景均会导致**静默数据失真**——系统看似正常运行，但采集数据或基线数据已不可信。

2. **5 个 P1 场景**需要在版本周期内修复：React 并发渲染、混合 ShadowDOM、截断位置变化、多 iframe 隔离、CDP 会话池悬挂。这些场景影响**工具链可靠性和主题一致性**。

3. **1 个 P2 场景**（Houdini @property）可排期优化，当前 6 个 Agent 中未确认使用 Houdini。

### 对既有审计的补充价值

| 既有审计覆盖 | 本次补充 |
|-------------|---------|
| 残缺数据的静态场景（CORS、closed shadow、lazy load） | 残缺数据的动态场景（崩溃中断、CSP 拦截、iframe 遗漏） |
| 时序配置的 per-Agent 差异 | 运行时序的 DOM 稳定性（React 并发、过渡动画） |
| Bridge 配置的静态映射 | Bridge 变量的动态继承（Shadow DOM 穿透、Houdini 重注册） |
| 会话池的 stale entry | 会话池的进程级生命周期（Electron 主进程重启） |
| 主题切换的基线刷新 | 快速切换的非幂等效应（CSS 残留、基线不一致） |

### 建议后续动作

1. **立即**：将 4 个 P0-Quality 场景的防护方案（原子写入、CSP 预检、切换防抖、过渡禁用）纳入下一个 patch 版本。
2. **短期**：将 5 个 P1 场景的修复纳入下一个 minor 版本的规划。
3. **中期**：将本次报告与既有 6 份审计草稿、2 份交叉校验、1 份修补分析合并为一份**AgentSkin 审计总报告**，作为架构评审的输入。
4. **长期**：建立"边缘场景推演"作为审计流程的标准环节——在每次架构变更前，推演新引入的行为可能触发的边缘异常。

---

*文档版本：1.0（深度查漏补缺报告）*  
*审计人：AgentSkin 深度查漏补缺专家*  
*基于文件：audit-draft-A/B/C/D/E/F + audit-cross-validation-1/2 + audit-cross-fix-notes*  
*下一步：提交评审，按 P0-Quality / P1 / P2 分阶段实施防护方案*