# 审计草案 B：探测脚本与扫描逻辑审计

> Audit scope: 脚本完整性校验 (4)、DOM 与样式扫描完整性 (5)、扫描后数据理解与过滤 (6)
> 方法：纯静态代码分析，不改代码
> 覆盖文件：`scripts/cdp-full-extract.mjs`、`src/engine/src/runtime/dom-snapshot.mjs`、`src/engine/src/runtime/verify-style.mjs`、`src/engine/src/semantic-quant/semantic-snapshot.mjs`、`scripts/analyze-structure-compare.mjs`、`scripts/check-semantic-contract.mjs`，以及支撑理解所需的 `renderer-payload.mjs`、`selectivity-registry.mjs`、`semantic-filter.mjs`、`css-variable-detection.mjs`、`css-var-bridge.mjs`、`preflight.mjs`、`injector.mjs`、`taxonomy.mjs`、6 个 adapter 文件、`build-theme-package.mjs`。

---

## 4. 脚本完整性校验

### 4(a). 如何校验投递的脚本完整运行？

#### 4(a)-1. 现状：Runtime.evaluate 的异常捕获模型

| 脚本 | 入口 | 超时 | 异常处理 |
|------|------|------|----------|
| `captureDomTree` (cdp-full-extract.mjs:366-475) | `Runtime.evaluate` | 15000ms | try/catch → 返回 `{ root: { t: 'html', d: 0 }, totalNodes: 1 }` 占位 |
| `sampleComputedStyles` (cdp-full-extract.mjs:479-525) | `Runtime.evaluate` | 取决于 CdpClient 默认 10000ms | try/catch → 返回 `[]` |
| `captureAllStylesheets` (cdp-full-extract.mjs:529-575) | `Runtime.evaluate` | 取决于 CdpClient 默认 10000ms | try/catch → 返回 `[]` |
| `getRootComputedVariables` (cdp-full-extract.mjs:580-609) | `Runtime.evaluate` | 同上 | try/catch → 返回 `{}` |
| `buildDomSnapshotExpression` (dom-snapshot.mjs:13-230) | `session.evaluate` | 由调用方传入 | 无内部 try/catch（engine 注射侧） |
| `buildVerifyExpression` (renderer-payload.mjs:499-534) | `session.evaluate` | 由调用方注入 | 无内部 try/catch |
| `buildApplyExpression` (renderer-payload.mjs:166-361) | `session.evaluate` | 由调用方注入 | 无内部 try/catch |

**关键观察（风险等级：HIGH）：**

1. **脚本执行成功 ≠ 脚本逻辑完整执行**。上述捕获模型只区分「JS 抛异常/超时」与「JS 正常返回」。当宿主 CSP 拦截了 `getComputedStyle` 调用、或宿主 JS 重写了 `querySelectorAll` 返回过滤列表时，Runtime.evaluate 会"正常"返回——但返回值是残缺或伪造的，系统无法识别。

2. **`captureDomTree` 的 fallback 返回占位 DOM**：失败时返回 `{ root: { t: 'html', d: 0 }, totalNodes: 1 }`，上游 `extractAgent` 不区分"真实采到 1 个节点"与"失败占位 1 个节点"，统计会写入 `domNodes: { default: 1 }`，后续 `analyzeColorPalette` 等链式处理仍会跑完，输出有结构但无数据。

3. **`sampleComputedStyles` 的静默吞错**：catch 返回 `[]` 后，`computedDefault.length === 0`，`computeSamples.default = 0`，但输出 JSON 仍包含空数组，下游无告警。

4. **cdp-full-extract.mjs 与 engine 注射器之间存在两套独立的异常处理策略**：
   - cdp-full-extract（脚本侧）：在 `Runtime.evaluate` 外层 try/catch，失败返回空结构。
   - engine 侧 (`injector.mjs:226-231`)：`session.evaluate` 失败时 catch 后把 `result` 设为 `undefined`，由调用方 `waitForCompatibility` 处理。该路径不吞错，但对"API 被宿主污染"同样无法识别。

#### 4(a)-2. CSP 拦截识别能力

**当前能力：无法识别。**

- `captureAllStylesheets` 内层遍历 `document.styleSheets` 时，CORS 跨域样式表的 `cssRules` 访问会抛 `SecurityError`，当前代码 catch 住后设置 `info.error = 'CORS: ' + e.message`（cdp-full-extract.mjs:546-548）。问题是：
  - 这条 CORS 错误信息**只存在于单个 sheet 的 `error` 字段**，`captureAllStylesheets` 返回的数组中仍包含该 sheet 对象（ruleCount=0, cssText=''）。
  - `extractAgent` 主循环 (cdp-full-extract.mjs:834-845) 仅判断 `if (sheet.cssText && !sheet.error)` 决定是否解析变量，CORS sheet 被静默跳过，不影响流程，但**不被计入覆盖率统计**。
  - **无任何中断/告警**——CORS 屏蔽了 80% 的样式表时，脚本仍会"正常完成"，输出变量集合是残缺的。

- `buildApplyExpression` / `buildPersistenceScript` 注射路径（renderer-payload.mjs）：注射体通过 `Page.addScriptToEvaluateOnNewDocument` 注册，**该通道天然绕过页面 CSP**——这是代码注释明确写到的（renderer-payload.mjs:376）。但这个能力仅限于 persistence 脚本通道，`Runtime.evaluate` 直投的采集脚本不受此保护。

#### 4(a)-3. 宿主 API 污染识别能力

**当前能力：无法识别。**

宿主 JS 可能重写以下 API，导致采集脚本"成功返回错误数据"：

| 被污染 API | 用途 | 后果 | 是否有校验 |
|---|---|---|---|
| `document.querySelectorAll` | DOM 遍历、landmark 检测 | 返回过滤后的子集，隐藏关键节点 | 否 |
| `getComputedStyle` | 计算样式采样 | 伪造色值/尺寸，semantics drift 检测失效 | 否 |
| `element.shadowRoot` | Shadow DOM 探测 | 返回 null，open shadow 变"closed" | 否 |
| `document.styleSheets` | 样式表遍历 | 过滤跨域/注入的样式表 | 否 |
| `document.adoptedStyleSheets` | CSSOM 构造样式表遍历 | 返回空数组 | 否 |
| `CSS.escape` | 选择器转义 | 错误转义导致选择器失效 | 有 fallback（dom-snapshot.mjs:32-35） |
| `getBoundingClientRect` | 可见性判断 | 伪造尺寸使 visible 判定失真 | 否 |

代码中只有 `CSS.escape` 做了能力检测（dom-snapshot.mjs:32），其余 API 直接使用，无任何 integrity check。

#### 4(a)-4. 识别能力差距小结矩阵

| 失败模式 | 可检测？ | 检测方式 | 误报/漏报风险 |
|---|---|---|---|
| Runtime.evaluate 超时 | 是 | CdpClient 10s timeout | 可能误报慢速大页面 |
| Runtime.evaluate JS 抛异常 | 是 | result.exceptionDetails | 无 |
| CSP 阻塞脚本注入 | 否（evaluate 路径） | — | 漏报：脚本完全不执行但无信号 |
| CSP 阻塞样式表读取 | 部分 | per-sheet CORS error | 漏报：不被计入覆盖率；不中断流程 |
| 宿主重写 querySelectorAll | 否 | — | 漏报：DOM 遍历看似成功但节点缺失 |
| 宿主重写 getComputedStyle | 否 | — | 漏报：色值看似有效但被伪造 |
| 宿主重写 shadowRoot | 否 | — | 漏报：open shadow 被当作不存在 |
| 脚本部分执行（内部 catch 吞错） | 否 | — | 漏报：单节点异常跳过，结果不完整 |

### 4(b). 多 Agent 脚本分发、加载与版本管理

#### 4(b)-1. 脚本分发模型

AgentSkin 采用**统一代码基座 + adapter 参数化**的分发模型：

```
renderer-payload.mjs
  ├── buildApplyExpression({ adapter, targetTheme })
  ├── buildProbeExpression(adapter, themeVerification)
  ├── buildVerifyExpression(adapter, expectedTheme, themeVerification, targetTheme)
  ├── buildRemoveExpression(adapter)
  └── buildPersistenceScript({ adapter, targetTheme })
```

每个表达式在运行时通过 `JSON.stringify` 把 adapter 的配置（`bridge`、`verification`、`rendererProfiles`、registry selector）序列化进 IIFE 字符串。因此：

- **没有独立的"脚本文件"概念**——脚本是 adapter 配置的函数。
- **adapter 配置变化 → 脚本变化**——adapter 升级时 verification selector、bridge entries、profile runtime 都会影响脚本体。

#### 4(b)-2. 脚本版本标识机制

代码中不存在显式的"脚本版本号"字段。脚本版本隐式地由以下组合决定：

| 维度 | 版本载体 | 当前状态 |
|---|---|---|
| 引擎构建版本 | `package.json` version（semantic-snapshot.mjs:37） | engineVersion 字段（仅备注） |
| taxonomy/选择器字典版本 | `TAXONOMY_SCHEMA_VERSION`（taxonomy.mjs:28，当前=1） | 有完整性校验（check-semantic-contract.mjs） |
| adapter 选择器配置 | adapter 文件内联 `verification` + `registry` | 无版本号 |
| bridge 映射 | adapter 文件内联 `bridge` | 无版本号 |
| profile runtime | `adapter.rendererProfiles`（仅 traework/qoderwork/codex/workbuddy 4 个有 profile） | `profileId` 作为版本标识（字符串） |
| 主题 CSS | `theme.version` | 有版本号 |

**关键问题（风险等级：MEDIUM）：**

1. **adapter 配置与脚本"版本"无显式绑定。** adapter 升级后（如 `traework.verification.rootAny` 从 `["#root"]` 改为 `["#root", "body"]`），apply 时生成的脚本体变化，但没有任何机制让采集端 `cdp-full-extract.mjs` 感知"你的基线是对旧版 adapter 采的"。`analyze-structure-compare.mjs` 的 `--baseline` 对比可以发现 DOM 漂移，但那是事后比较，不是内建的版本防护。

2. **`lastVerified` 字段不完整。** 仅 traework adapter 声明了 `lastVerified`（darwin 平台 appVersion 0.1.36 build ce5758dc），其余 5 个 adapter 未声明。没有"adapter 最后适配验证版本"与"当前运行 app 实际版本"的交叉校验。

3. **4 adapter 有 profile，2 adapter 没有.** `rendererProfiles` 仅 traework/qoderwork/codex/workbuddy 注册了 profile 文件，doubao 和 zcode 没有。这导致 doubao/zcode 的 apply/verify 表达式不含 profile runtime——但 registry 中仍有语义 selector。版本不匹配时 profile 没有降级提示。

#### 4(b)-3. 版本不匹配检测缺口

| 不匹配场景 | 当前检测方式 | 缺口 |
|---|---|---|
| adapter 选择器配置 vs 当前 live DOM | `preflight.mjs` 双轨判定 + `analyze-structure-compare` 静态对拍 | 需要显式运行工具；非内建 |
| bridge entries 中 var 名是否还有效 | `analyze-structure-compare.mjs` bridge 可达性检查 | 仅脚本；非 apply 时校验 |
| registry selector 是否与 adapter.verification 对齐 | `check-semantic-contract.mjs` 规则 1 | 静态；不校验运行时命中 |
| theme manifest 的 verification vs 当前 adapter | apply 时 `buildCompatibilityProfile` 合并两者 | 有校验；但仅在 apply 时 |
| TAXONOMY_SCHEMA_VERSION 向后兼容 | `validateSnapshotCompatibility`（semantic-snapshot.mjs:67-92） | 快+慢双向校验 |

---

## 5. DOM 与样式扫描完整性

### 5(a). 能否扫描到全部有效样式来源？

#### 5(a)-1. 样式来源覆盖矩阵

| 样式来源 | cdp-full-extract.mjs 能否覆盖 | analyze-structure-compare.mjs 能否覆盖 | engine 注射侧能否覆盖 | 缺口说明 |
|---|---|---|---|---|
| 同源 `<link>` 样式表 | 是（document.styleSheets） | 是（cssRules AST 遍历） | — | CORS 失败时有 error 标记 |
| 同源 `<style>` 内联 | 是（querySelectorAll('style')） | 是 | — | — |
| 跨域 `<link>` 样式表 | 部分（CORS 抛出后 error 标记） | 部分 | — | Sheet 列为 error；不中断；不计覆盖率 |
| `document.adoptedStyleSheets`（CSSOM 构造） | **否** | 是（显式遍历） | — | cdp-full-extract 完全遗漏此来源 |
| CSS-in-JS 运行时内存样式（不产生 CSSOM） | **否** | **否** | — | styled-components/emotion 的样式无法通过 CSSOM 读取 |
| open Shadow DOM 内部样式表 | **否** | 是（walk shadowRoot.styleSheets） | — | cdp-full-extract 只穿透 DOM 不穿透样式表 |
| closed Shadow DOM 内部样式表 | **否** | 风险标记（SHADOW_RISK_SELECTORS 当前为空数组） | — | 完全无法访问 |
| `@font-face` 规则中的字体 URL | **否** | **否** | — | 不在 CSS 变量扫描范围；字体族信息部分保留（styleFields 含 fontFamily） |
| `@keyframes` 动效 | 部分（computed style 的 animation 字段） | 部分（themeSelectors 只取名称匹配） | — | 无法完整还原关键帧定义 |
| `@property` 注册自定义属性（Houdini） | **否** | **否** | — | 完全不采集 |
| `element.style` 内联 style 属性 | **否**（仅读 computedStyle，不区分来源优先级） | **否** | — | 内联声明的 CSS 变量丢失 |
| `!important` 规则 | **否**（computedStyle 不保留 priority 信息） | **否** | — | 无法区分"用户 normal"与"用户 important"与"作者"优先级 |
| CSS `color-mix()` / `light-dark()` 等函数 | 部分（值原样保留） | 部分 | — | 值被扁平化记录，不做语义解析 |
| `prefers-contrast` / `forced-colors` 媒体查询 | **否** | 部分（THEME_RE 含 contrast） | — | 仅提取选择器名，不提取值 |
| JS 运行时动态算出的样式（如 canvas 测量后设 style） | **否** | **否** | — | computedStyle 也许能读到值，但无法溯源到变量 |

#### 5(a)-2. 核心盲区详析

**盲区 1：adoptedStyleSheets（CSSOM 构造样式表）—— 风险等级 HIGH**

Electron 应用中大量使用 `document.adoptedStyleSheets`（CSSStyleSheet API）替代 `<style>` 标签注入样式。`cdp-full-extract.mjs:531-563` 仅遍历 `document.styleSheets` + inline `<style>`，**不遍历 `document.adoptedStyleSheets`**。

官方注释在 cdp-full-extract.mjs:974 提到 "Electron apps often use document.adoptedStyleSheets"——已经意识到问题，但实际代码仍未采集 adoptedSheets 的 :root 变量声明。

`analyze-structure-compare.mjs:317-363` 的 `buildStyleAstExpression` 覆盖了 `document.adoptedStyleSheets`，但那是独立的静态分析脚本，不是 cdp-full-extract 管线的一部分。

**盲区 2：CSS-in-JS 内存样式 —— 风险等级 HIGH**

styled-components / emotion / goo 等 CSS-in-JS 框架在运行时动态创建 `<style>` 节点，但以下内容无法通过 CSSOM 访问：
- 未实际注入 DOM 的"待使用"样式
- 由于哈希类名导致的"同一语义多份样式"难以去重
- interpolation 函数里的条件色值

**盲区 3：closed Shadow DOM —— 风险等级 MEDIUM**

`analyze-structure-compare.mjs:306-309` 直接声明：`SHADOW_RISK_SELECTORS = []`（空数组）。注释写道"当前 rule 库未建，默认空"。意味着 6 个 Advisor 中已知的 closed-shadow 风险组件（如果有的话）完全依赖人工 curate 规则库。当前状态是**零检测**。

**盲区 4：`!important` 优先级识别 —— 风险等级 MEDIUM**

`getComputedStyle` 只返回最终生效值。当 AgentSkin 的 `--agentskin-text` 被宿主 `!important` 规则覆盖时，computedStyle 返回的是宿主值，verify-style.mjs 的 colorDistance 比对会判定 themeMatches=false——这是能检测到的。但系统无法区分"主题未注入"与"主题被更高优先级覆盖"，无法给出可操作的修复建议。

### 5(b). 扫描覆盖率指标

**现状：未引入。**

- `cdp-full-extract.mjs` 的输出 JSON 中，stylesheets 数组每个 sheet 有 `hasError: !!s.error` 布尔，但没有：
  - "本次扫描总样式表数 vs 成功读取数"
  - "CORS 阻塞占比"
  - "覆盖的样式来源类型枚举"
  - "adoptedSheets 采集成功/失败/不支持"

- `analyze-structure-compare.mjs` 有更强的覆盖信息（styleSheets/adoptedSheets/cssRules/adoptedCssRules 计数器，buildStyleAstExpression 返回的 `out.errors`），但输出也是"采集到的结构"而非"采集能力覆盖度"。

- engine 侧 `verifyTheme` 的返回值有 `stylePresent` 和 `styleDrift`，但只表达"注入的 theme style 是否 visible"，不表达"宿主样式被完整采集了"。

---

## 6. 扫描后数据理解与过滤

### 6(a). 有效业务 Token vs 无效噪声变量的区分

#### 6(a)-1. cdp-full-extract.mjs 的 `categorizeVars` 函数（行 706-764）

分类逻辑：基于**变量名**的正则模式匹配，**不看变量值**。

```
colorPattern  → /color|bg|background|fill|stroke|surface|.../i
textPattern   → /text|foreground|fg|label|muted|placeholder/i
borderPattern → /border|separator|divider/i
accentPattern → /accent|primary|brand|theme|focus|selection/i
spacingPattern→ /spacing|gap|margin|padding|size|width|height|radius|space/i
shadowPattern → /shadow/i
fontPattern   → /font|family/i
buttonPattern → /button|btn/i
inputPattern  → /input|editor|field/i
```

优先级：colorPattern 最先命中，内部再按 text > border > accent > font > button > input > color 子排序；未命中 colorPattern 才检查 spacing/shadow/other。

**问题（风险等级：MEDIUM）：**

1. **单维度命名启发式，无语义上下文。** 例如 `--color-accent-disabled` —— accentPattern 命中、colorPattern 命中、disabled 看似 muted 不命中（因为 textPattern 不含 disabled），最终归入 accent。但某些应用 `--color-accent-disabled` 实际是 surface 色。
2. **正则存在重叠冲突。** `--vscode-panel-border` 同时命中 borderPattern（border）和 surfacePattern（panel），代码的 hit-first 优先级把 border 排在 panel 之前 → 归入 border。但 panel 选择器（sidebar背景）在实际 UI 中可能更本质。
3. **全局一套规则，不区分 Agent。** workbuddy 的 `--cb-` 命名空间、doubao 的 `--dbx-`/`--semi-` 命名空间共享同一套正则。`--dbx-bg-float` 按 bg 归入最终 fallback，但其真实语义是 surface-elevated。
4. **不识别非标准命名。** tailwind v4 的 `--color-amber-500`、Radix 的 `--accent-9`、vscode 的 `--vscode-icube-colorBg2` 这种带序号/命名空间的变量，可能被误归入 `other`。
5. **只看变量名，不看变量值。** 值为 `none`、`transparent`、`0px` 的占位变量与实际色值变量一视同仁。

#### 6(a)-2. `css-variable-detection.mjs` 的变量域匹配（`matchesThemeDomain`）

这是 engine 内的"是否为受控域变量"判定（S10，审计 §5）：

```js
DEFAULT_THEME_DOMAINS = [
  "--agentskin-", "--cb-", "--semi-", "--ant-", "--antd-", "--app-"
];
```

```
风险等级：LOW
```

仅做前缀匹配。`--agent-*`（agent 自身注入的非主题变量）、`--animation-*`、`--z-index-*` 等均不在列表中——这部分设计是合理的（避免误报）。但 `--app-` 是过于宽泛的前缀，某些 Agent SDK 用它命名非主题工具变量。

#### 6(a)-3. `semantic-filter.mjs` 的 `collectNonControlledSelectors`

基于 registry 显式配置的非受控子节点选择器（`semantic.nonControlled`），在运行时标记 `agentskin-non-controlled` class。这是**基于配置**的过滤，不是基于扫描结果的过滤。

### 6(b). 噪声变量如何进入 AGENT_REMAP

`build-theme-package.mjs` 的 `AGENT_REMAP` 是**人工硬编码**常量（行 69-191），不来自扫描输出。5 个 agent（traework / qoderwork / workbuddy / doubao / codex）各有一个显式 var 名列表。

**进入路径分析：**

| 进入路径 | 是否可能 | 说明 |
|---|---|---|
| 误将噪声变量写入 AGENT_REMAP 代码 | 低风险 | 人工 curate；但 `--vscode-icube-bg`/`--vscode-icube-fg`（traework AGENT_REMAP :96-97）在不同版本中可能含义变化 |
| valueForToken 分类错误导致错误映射 | 中风险 | TOKEN_RULES 是命名启发式；`--vscode-icube-colorBg2` 命中 bg 模式 → 映射到 `--agentskin-bg`（不透明），但该值实际可能是半透明 surface |
| 新变量未在 AGENT_REMAP 中列出 | 中风险 | 新增 agent 版本引入的新 token 不会被自动 remap，主题效果缺失，但不会"错误渲染" |
| HOST_SELECTOR 匹配范围过大 | 中风险 | traework 用 `html.agentskin-host-traework body *`（全 body 子节点），codex 用 `:root:root:root...*`——通配符导致主题覆盖到原本应排除的节点 |

**潜在泄漏路径（风险等级：MEDIUM）：**

`valueForToken` 的 fallback 策略：如果变量名不匹配任何 pattern，最终 fallback 到 `--agentskin-bg`（build-theme-package.mjs:352）。这意味着：
- 噪声变量名（如 `--some-lib-internal-var`）最终被归入 bg 角色，产生一个虚构的 remap 条目。
- 由于 AGENT_REMAP 是静态的，噪声变量名只有人工写进列表才会被 remap，所以实际影响面可控。但`valueForToken` 的 fallback 是**无差别映射**：不认识的变量统一映射到 bg，无任何日志/warning，容易被 Studio 作者误以为"一切正常"。

### 6(c). 6 Agent 的噪声变量过滤是否为全局一套

**结论：全局一套。在 engine 注射侧有一个维度的 per-agent 差异；在 cdp-full-extract 侧完全没有 per-agent 差异。**

全局一套的机制：

| 模块 | 过滤/分类逻辑 | 是否 per-agent |
|---|---|---|
| `categorizeVars` (cdp-full-extract.mjs) | 单一正则集合，对所有 6 agent 相同 | 否 |
| `TOKEN_RULES` (build-theme-package.mjs) | 单一 pattern 数组，对所有 agent 通用 | 否 |
| `valueForToken` (build-theme-package.mjs) | 通用命名启发式 | 否 |
| `AGENT_REMAP` (build-theme-package.mjs) | per-agent 显式列表 | 是 |
| `HOST_SELECTOR` (build-theme-package.mjs) | per-agent 选择器 | 是 |
| `VERIFICATION` (build-theme-package.mjs) | per-agent landmark | 是 |
| `DEFAULT_THEME_DOMAINS` (css-variable-detection.mjs) | 全局 | 否 |
| `selectivity-registry.mjs` | per-agent 条目 | 是 |
| `collectNonControlledSelectors` (semantic-filter.mjs) | per-agent 拓扑读取 | 是 |
| `isGeneratedClass` (selectivity-registry.mjs) | 全局 | 否 |

**缺口（风险等级：MEDIUM）：**

`categorizeVars` 的全局统一正则没有办法区分：
- workbuddy 的 `--cb-*` 命名空间（具体业务 token）
- doubao 的 `--dbx-*` 与 `--semi-*` 两套命名空间共存
- codex 的 `--text-*` / `--bg-*` 极简命名（容易误分类）
- traework 的 `--vscode-*` 超长命名空间（含大量非主题内部 token）
- zcode 的 `--color-*` / `--color-foreground-*` 扁平命名

例如：`--vscode-sash-hoverBorder` 按当前正则归入 border（borderPattern 命中），但实际是 sash 悬停色，不属于主题色板中的 border 角色。

---

## 7. 6 Agent 隔离缺口汇总

| 缺口 | 涉及 Agent | 风险等级 | 说明 |
|---|---|---|---|
| **adoptedSheets 盲区** | 所有 6 个 | HIGH | Electron 应用大量使用；cdp-full-extract 完全不扫描 |
| **closed Shadow DOM 零检测** | 所有 6 个 | MEDIUM | SHADOW_RISK_SELECTORS=[]；依赖人工 curate |
| **CSS-in-JS 内存样式不可见** | codex/doubao/workbuddy (推测) | HIGH | styled-components 框架类名随机化——DOM 中可见类名，但样式规则难溯源 |
| **全局 `categorizeVars` 无 per-agent 适配** | 所有 6 个 | MEDIUM | traework 的 `--vscode-*` 有超大量非主题 token；当前正则无法精确区分 |
| **无脚本完整性校验** | 所有 6 个 | HIGH | API 污染/CORS 不完整性不被识别 |
| **噪声变量无告警** | 所有 6 个 | MEDIUM | `valueForToken` fallback 到 bg 静默进行 |
| **profile 缺失（doubao、zcode）** | doubao、zcode | LOW | 这 2 个 adapter 无 rendererProfile；verify 路径不含 profile 校验 |
| **lastVerified 空缺** | qoderwork/workbuddy/codex/doubao/zcode | MEDIUM | 仅 traework 有 appVersion/build 的 lastVerified 记录 |
| **`--cb-*` 变量语义漂移** | workbuddy | MEDIUM | cb 前缀来自旧 codebase 命名；新 label 可能不再匹配 |
| **`--semi-*` 与 `--dbx-*` 双命名空间** | doubao | MEDIUM | AGENT_REMAP 仅映射了一部分；未映射的 semi-* 变量无 fallback |
| **doubao 无 profile 且 bridge 较少** | doubao | LOW | 仅有 16 条 bridge，大量 `--semi-*` 变量未 remap |
| **`HOST_SELECTOR` 覆盖过广** | traework / codex | MEDIUM | `body *` 通配符导致主题注入到非目标节点 |
| **registry selector 可能含 hash 类名** | traework（.task-list-base 等） | MEDIUM | hash 类名随版本变化；rebind 机制存在但依赖 preflight 正确执行 |

---

## 8. 方案推演

### 问题 1：脚本完整性校验缺失（4(a)）

**方案 A：执行指纹校验**
- 描述：探测脚本尾部追加指纹对象 `{ integrity: { apiOk: { querySelectorAll: boolean, getComputedStyle: boolean, adoptedStyleSheets: boolean }, cspBlocked: false, shadowRootCount: N } }`。脚本开头用 `typeof` 检测浏览器 API 是否为原生（对比 `Function.prototype.toString()` 与已知 native signature），发现被污染时整段拒绝执行。
- 优点：能识别 API 污染；实现轻量（只加几行探测代码）。
- 缺点：`Function.prototype.toString()` 检测可被绕过（宿主可重写 toString）；CSP 检测需要额外的受限资源请求来触发。
- 复杂度：低；纯前端检测。

**方案 B：CDP DOM API 双通道交叉校验**
- 描述：对同一节点同时通过 `Runtime.evaluate` 读 computedStyle 和通过 CDP 的 `CSS.getComputedStyleForNode` 读，比对两者是否一致。差异 > 阈值即标记污染。
- 优点：利用 CDP 的独立通道；不依赖页面内 API 可信度。
- 缺点：CDP `CSS.getComputedStyleForNode` 只返回有限属性子集；性能开销 2 倍；部分 Electron 应用未开启 CSS domain。
- 复杂度：中；需改 CdpClient 适配双通道。

**推荐方案：A + B 组合**——运行时用 A 做快速污染检测，对关键节点用 B 做抽样审计。

### 问题 2：adoptedSheets 盲区（5(a)）

**方案 A：在 cdp-full-extract 中补 adoptedSheets 遍历**
- 描述：在 `captureAllStylesheets` 的 IIFE 中加入 `document.adoptedStyleSheets` 遍历，与 styleSheets 合并输出。
- 优点：改动小；与现有 { href, type, ruleCount, cssText, error } 结构兼容。
- 缺点：adoptedSheets 同样有 CORS 限制（同域策略）；对 CSS-in-JS 内存样式仍无效。
- 复杂度：低。

**方案 B：启用 CDP `CSS.getMatchedStylesForNode`**
- 描述：通过 CDP CSS domain 的 `CSS.getMatchedStylesForNode` 直接获取节点匹配的所有规则，无需遍历 CSSOM。
- 优点：能覆盖所有来源（含 adoptedSheets）；返回 `inherited` / `cssStyleSheetId` 元数据。
- 缺点：需启用 CSS domain（开销大）；每个节点一次调用；需要 `CSS.styleSheetId` 反查文本。
- 复杂度：高；需大改 CdpClient。

**推荐方案：A 先行（最小改动覆盖 80% 场景），B 作为后续增强路径。**

### 问题 3：全局 categorizeVars 无 per-agent 差异（6(c)）

**方案 A：per-agent 命名空间白名单**
- 描述：给每个 agent 定义一组"已知业务 token 前缀"（如 traework 的 `--vscode-*`、workbuddy 的 `--cb-*`），分类时优先按前缀精确匹配，未命中再走全局正则。
- 优点：解决 80% 的误分类；改动受限于 categorizeVars。
- 缺点：前缀集合需要维护；agent 版本更新时前缀可能变化。
- 复杂度：低-中。

**方案 B：变量值语义分类替代命名分类**
- 描述：不看变量名，改为看变量值的"色彩特征"（是否有色值、是否为长度、是否为 shadow 语法），结合值的相似度聚类。
- 优点：命名误分类彻底消除；适配未知命名规范。
- 缺点：不能区分语义角色（surface vs bg 在值上可能相同）；计算开销大；需要参考色板。
- 复杂度：高；需要引入色彩空间距离计算 + 聚类算法。

**推荐方案：A 先行（最小可行），在 per-agent 前缀之上叠加 cross-agent 通用正则作为 fallback。**

### 问题 4：覆盖率指标缺失（5(b)）

**方案 A：输出 `_extract-summary.json` 增加 `coverage` 段**
- 描述：在现有 summary JSON 中追加 `coverage: { totalSheets: N, corsFailedSheets: M, adoptedSheetsSupported: bool, adoptedSheetsCount: K, shadowRoots: { open: N, closedRisk: M }, apiIntegrity: { querySelectorAll: 'ok'|'tampered' } }`。不改变采集逻辑，只统计已有返回值。
- 优点：最小改动；向后兼容。
- 缺点：apiIntegrity 仍为 unknown（需污染检测）；adoptedSheets 仍为 0。
- 复杂度：低。

**方案 B：独立 coverage 审计脚本**
- 描述：新建 `scripts/coverage-audit.mjs`，专门探知运行时能力（API 完整性、样式表来源类型），输出 coverage profile，与 extract 结果关联。
- 优点：与 extract 解耦；coverage 可独立演进。
- 缺点：新增维护面；需要 Agent 在线执行。
- 复杂度：中。

**推荐方案：A 先行（在现有 _extract-summary.json 里加 coverage 字段），B 中后期独立建设。**

### 问题 5：valueForToken 噪声变量静默 fallback（6(b)）

**方案 A：unknown category 显式报告**
- 描述：`valueForToken` 碰到不匹配任何 pattern 的 token 时，不再 fallback 到 bg，而是在 CSS 注释中标记 `/* agentskin:unknown: <var> */` 并跳过该 remap。Studio 导出日志中列出未映射 token 列表。
- 优点：噪声不进入最终产物；未映射 token 可视化。
- 缺点：Studio 导出 CSS 变多注释；需要 Studio UI 展示"未映射"。
- 复杂度：低。

**方案 B：per-agent remap 完备性校验**
- 描述：在 `buildAgentCss` 中对比 agent bridge 中的 var 集合与 AGENT_REMAP 中的 var 集合，bridge 有但 AGENT_REMAP 没有的 token 在构建时 warning。
- 优点：在构建时发现问题（而非运行时）。
- 缺点：bridge 与 AGENT_REMAP 不是 1:1 对应（bridge 有 role，remap 只是 var→var 替换）。
- 复杂度：中。

**推荐方案：A 先做（最小改动），边界 case 用 B 兜底。**

---

## 附录 A：审计覆盖源文件清单

| 文件 | 行数（约） | 审计用途 |
|---|---|---|
| scripts/cdp-full-extract.mjs | 1106 | 4(a)/5(a)/6(a)/6(c) |
| src/engine/src/runtime/dom-snapshot.mjs | 230 | 4(a) |
| src/engine/src/runtime/verify-style.mjs | 241 | 4(a) |
| src/engine/src/semantic-quant/semantic-snapshot.mjs | 93 | 4(b) |
| scripts/analyze-structure-compare.mjs | 93.8KB | 5(a) |
| scripts/check-semantic-contract.mjs | 307 | 4(b) |
| src/engine/src/runtime/renderer-payload.mjs | 535 | 4(a)/4(b) |
| src/engine/src/runtime/selectivity-registry.mjs | 546 | 4(b)/6(a) |
| src/engine/src/runtime/semantic-filter.mjs | 105 | 6(a) |
| src/engine/src/runtime/css-variable-detection.mjs | 150 | 6(a) |
| src/engine/src/runtime/css-var-bridge.mjs | 201 | 6(b) |
| src/engine/src/runtime/preflight.mjs | 186 | 4(b) |
| src/engine/src/runtime/injector.mjs | 497 | 4(a) |
| src/engine/src/semantic-quant/taxonomy.mjs | 299 | 4(b)/附录 |
| src/engine/src/adapters/{traework,qoderwork,workbuddy,codex,doubao,zcode}.mjs | 各 80-130 行 | 4(b)/6(b)/6(c) |
| scripts/build-theme-package.mjs | 758 | 6(b) |

## 附录 B：风险等级定义

| 等级 | 含义 | 响应窗口 |
|---|---|---|
| HIGH | 可能导致主题错误注入、盲区、静默失效 | 必须在下一版本前处理 |
| MEDIUM | 可能导致部分功能降级、分类不准 | 应纳入 1-2 个迭代内修复 |
| LOW | 已知的 minor 缺口或不影响主流程的局限 | 计划性修复或接受 |

## 附录 C：缩写与引用

| 缩写 | 全称 |
|---|---|
| CDP | Chrome DevTools Protocol |
| CSP | Content Security Policy |
| IIFE | Immediately Invoked Function Expression |
| CSSOM | CSS Object Model |
| AST | Abstract Syntax Tree |
| RFC | Request for Comment (内部设计稿) |

行号引用对应审计时的代码版本；如代码有更新请以最新代码为准。
