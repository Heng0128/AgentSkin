# 审计草稿 A：CDP 探针链路领域审计

> 审计范围：CDP 探针链路的执行时机、残缺处理、多 Agent 时序隔离
> 审计方法：纯静态代码分析，不修改任何代码
> 证据来源：`scripts/cdp-full-extract.mjs`、`src/engine/src/runtime/*.mjs`、`src/main/cdp/*.ts`、`scripts/analyze-structure-compare.mjs`
> 审计日期：2025（基于当前代码快照）

---

## 导言：CDP 探针链路全景

AgentSkin 的 CDP 探针系统由三条子链路构成：

| 子链路 | 入口 | 用途 |
|--------|------|------|
| **样式采集探针** | `scripts/cdp-full-extract.mjs`（手动/批处理） | 离线提取 6 个 Agent 的完整 CSS 变量、DOM 结构、计算样式，供 Theme Studio 使用 |
| **运行时注入探针** | `src/engine/src/runtime/injector.mjs` → `renderer-payload.mjs` | 在线 apply/verify/remove 流程中的 DOM 兼容性探测与样式合规校验 |
| **结构对拍探针** | `scripts/analyze-structure-compare.mjs`（手动/CI） | 运行时 CDP 数据 × 安装包静态解包的漂移检测 |

三条链路共享同一套 CDP 通信原语（WebSocket 帧、`Runtime.evaluate`、`Emulation.setEmulatedMedia`），但**各自独立实现了等待、重试、降级逻辑**，没有统一的探针编排层。这是本次审计的核心发现之一。

---

## 1. 执行时机判定逻辑现状

### 1.1 样式采集探针（cdp-full-extract.mjs）

#### (a) 就绪判定方式：纯定时器

**关键代码证据：**

- **L32**: `const THEME_SWITCH_WAIT = 600; // ms to wait after theme switch`
- **L676-677** (`setColorScheme` 函数内):
  ```js
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  });
  await sleep(THEME_SWITCH_WAIT);  // 硬等 600ms
  ```
- **L626-653** (`_getRootVariablesForTheme` 内): 注入临时样式后 `await sleep(50)`。

**现状：**
- 没有任何就绪判定逻辑（无 DOM settling 检测、无 `requestAnimationFrame` 等待、无 network-idle 探测）。
- 所有等待均为硬编码 `sleep()`，且全局只有一个 `THEME_SWITCH_WAIT` 常量。
- 在 `setColorScheme('dark')` 返回后立即等待 600ms，然后直接执行 `captureDomTree` + `sampleComputedStyles`，无中间校验。

**风险：**
- 高初始化 Agent（如 workbuddy 有较长 splash screen）可能在 600ms 内未完成渲染，导致捕获残缺 DOM。
- 低初始化 Agent（如 codex）可能在 200ms 内已完成，600ms 中有 400ms 浪费，拉低批处理吞吐。

#### (b) 重试/降级/标记逻辑：无

**关键代码证据：**

- **L863-878** (`extractAgent` 内): `setColorScheme` 失败时仅 `console.log('⚠ 暗色切换失败')` 并继续，后续 DOM/计算样式直接为 `null`。
- **L854**: `captureDomTree` 执行无重试，仅 15s 超时（L460 timeout: 15000），失败回退为单节点 `{ t: 'html', d: 0 }`。
- **L827**: `captureAllStylesheets` 对 CORS 错误仅记录 `info.error = 'CORS: ' + e.message`，无重试或降级，残缺数据直接进入后续解析。
- **L858**: `sampleComputedStyles` 无容错，解析失败返回空数组 `[]`。

**结论：残缺 token 集合没有标记为「不可信」。** 输出 JSON 的 `meta` 字段(L929-933)仅含 agent 名、端口、时间戳，**无 `quality`、`confidence`、`retryCount` 等元信息**。下游 Theme Studio 无法区分「Agent 暗色模式无此变量」和「因时机过早早未拿到暗色变量」。

#### (c) 运行中动态变化的感知：不存在

`cdp-full-extract.mjs` 是一次性批处理脚本，执行完即退出，**无任何 MutationObserver / 事件监听 / 长连接机制**来感知页面后续变化。

---

### 1.2 运行时注入探针（injector.mjs / renderer-payload.mjs）

#### (a) 就绪判定：有结构化兼容探针 + 双预算等待

**关键代码证据：**

- **injector.mjs L220-242** (`waitForCompatibility`):
  ```js
  async function waitForCompatibility(session, expression, settleTimeoutMs = 5000, bootTimeoutMs = settleTimeoutMs) {
    const start = Date.now();
    let structuredAt = null;
    let result;
    do {
      try { result = await session.evaluate(expression); } catch { result = undefined; }
      if (result?.compatible) return result;
      const now = Date.now();
      const hasRoot = Boolean(result?.rootMatches?.length);
      if (hasRoot && structuredAt === null) structuredAt = now;
      const deadline = hasRoot
        ? Math.min(start + bootTimeoutMs, structuredAt + settleTimeoutMs)
        : start + bootTimeoutMs;
      if (now >= deadline) return result;
      await delay(250);
    } while (true);
  }
  ```

**分析：**
- **双预算机制**：Root landmark 未出现时用 `bootTimeoutMs`（默认=传入的 `timeoutMs`）；Root 已出现但子节点不匹配时用 `settleTimeoutMs`（默认 5000ms）。这是比 `cdp-full-extract` 先进的设计——区分了「还在启动」和「渲染中但有残缺」。
- **轮询间隔 250ms**（L240），合理。
- 关键逻辑：`structuredAt` 记录了\"第一次看到 root landmark\"的时间点——从这一刻起切换到 settle budget，防止 boot budget 被超长启动耗尽后仍等待。

#### (b) 重试/降级逻辑：有

- **injector.mjs L277-282** (`applyTheme` 内): preflight 时 `waitForCompatibility` 使用 `Math.min(timeoutMs, 10000)` 作为 settle budget。
- **injector.mjs L286-287**: 不兼容的 target 不阻断整体 apply，而是归入 `skipped` 列表——这是「优雅降级」而非「重试」。
- **injector.mjs L327**: apply 后固定 `await delay(500)` 再做 verify——又一个硬定时器，但相比 600ms 更短。

#### (c) 动态变化感知：有，基于 MutationObserver + Page.loadEventFired

- **renderer-payload.mjs L198**: `AdaptiveMutationObserver` 类内置三层节流（throttleWindow/loopThreshold/loopMaxCycles），在 apply 成功后持续观测 DOM 变化并触发 self-heal re-apply。
- **injector.mjs L464-478** (`watchTheme` 内): 监听 `Page.loadEventFired` 事件判断是否需要重新注入。持久化脚本失败（无 tracked identifier）时设 250ms `setTimeout` 兜底重注。
- **injector.mjs L488**: watch 循环间隔 900ms，用于检测新 target 出现/旧 target 消失。

**但存在缺口：** watch 循环不感知子路由切换、不感知弹窗弹出——这些不会触发 `Page.loadEventFired`，只有 `AdaptiveMutationObserver` 能捕捉 DOM 级变化，但它的 callback 仅做 re-apply 不会重新跑 `waitForCompatibility`。

---

### 1.3 结构对拍探针（analyze-structure-compare.mjs）

**关键代码证据：**

- **L52-55**: `RUNTIME_CLASS_CAP = 1000`、`RUNTIME_VAR_CAP = 2000`、`STATIC_JS_FILE_CAP = 40`——全为硬上限，无动态截断语义。
- **L164-193** (`resolveLivePort`): 先 DevToolsActivePort 文件发现，再 netstat 回退，有双路发现逻辑。**但没有「等待 Agent 就绪」的逻辑**，拿到端口即直接探测。
- **L198**: `listCdpTargets(port, 1500)` 仅设 1.5s 超时，对高初始化 Agent 偏紧。

---

## 2. 残缺场景清单

### 2.1 天然探测残缺场景

| # | 场景 | 影响的链路 | 代码证据 | 当前处理 |
|---|------|-----------|---------|---------|
| S1 | **懒加载组件**（路由切换后动态挂载） | 全部 | `dom-snapshot.mjs L97`: 仅遍历 `document.querySelectorAll('*')`——只能看到已存在的 DOM | 无感知，快照只反映采集时刻静态结构 |
| S2 | **延迟挂载弹窗**（Radix/Portal-based） | 全部 | 同上——弹窗未打开时不在 DOM 中 | 无感知 |
| S3 | **Closed Shadow-Root** | 全部 | `dom-snapshot.mjs L98`: `element.shadowRoot` 对 closed shadow 返回 `null`，仅计数 `openShadowRoots` | 仅计数不穿透（合理，技术上不可行）；`analyze-structure-compare.mjs L306-309` 专门注释了\"closed shadow root 无法被 JS 枚举\" |
| S4 | **adoptedStyleSheets 不可遍历**（CORS-styled Constructable Stylesheets） | `cdp-full-extract` | `captureAllStylesheets` (L535-548): 遍历 `document.styleSheets` 时 catch CORS error 并记录 `info.error`，但 **不尝试内容获取**；`analyze-structure-compare.mjs L352-358`: 也遍历 `adoptedStyleSheets`，catch 后 `continue` | 标记 error 但无替代获取手段 |
| S5 | **CORS 外部样式表**（CDN 上的 `.css`） | `cdp-full-extract` | `captureAllStylesheets` (L537-548): `sheet.cssRules` 访问受 CORS 限制，catch 仅标记 `info.error = 'CORS: ' + e.message` | 仅标记，**残缺的 CORS 表内变量完全丢失** |
| S6 | **CSS Modules / 哈希类名** | 全部 | `dom-snapshot.mjs L41-43`: `generatedClass` 函数识别并过滤掉的类名（`css-xxxxx`_hash 模式） | 正确过滤——这些确实是噪音而非残缺 |
| S7 | **prefers-color-scheme 不被 Agent 响应** | `cdp-full-extract` | L863-878: `setColorScheme` 的 `Emulation.setEmulatedMedia` 可能被 Agent 的自身主题系统覆盖，表现为切换后变量集合不变 | 无检测——暗色/亮色数据可能完全相同但无告警 |
| S8 | **Navigation 中执行上下文被销毁** | `injector` | `injector.mjs L228-230`: catch 后视为「页面未渲染」并重试——这是唯一正确处理 navigate-during-evaluate 的场景 | 有重试（但无限循环直到 deadline） |
| S9 | **Document 级 adoptedStyleSheets（运行时注入）** | `analyze-structure-compare` | L352-358: 显式遍历 `document.adoptedStyleSheets` 并在 catch 后 continue | 有处理但脆弱 |
| S10 | **WebView2/CEF 多 target 场景** | 全部 | `analyze-structure-compare.mjs L155-161`: 多开场景遍历所有匹配 PID+端口 | 有处理；但 `cdp-full-extract.mjs` 仅取第一个 `page` type target（L801） |

### 2.2 探测结果残缺后的行为

| 行为 | 是否存在 | 代码证据 |
|------|---------|---------|
| **忽略残缺直接输出** | YES | `cdp-full-extract.mjs`: `domDark?.root \|\| null`（L986）——暗色切换失败时 DOM 直接为 null，但输出仍写入 JSON，无「数据不完整」标记 |
| **记录 error 但继续解析** | YES | `captureAllStylesheets`: `info.error = 'CORS: ' + e.message`（L547），但 `extractVariablesWithMedia` 跳过 `sheet.error` 的表（L835）——CORS 表内的变量声明**静默丢失** |
| **自动重试** | 仅 injector 链路 | `waitForCompatibility` 双预算轮询；`cdp-full-extract` 无重试 |
| **阻断/降级** | 仅 injector 链路 | `injector.mjs L286-287`: 不兼容 target 归入 skipped，不阻断整体；`baseline-validator.ts L261-289`: baseline probe 失败 → `degraded=true` |
| **残缺快照当基线持久化** | **无防护** | `cdp-full-extract` 的输出被 Theme Studio 消费，JSON 无 quality 标记。如果 Theme Studio 直接拿残缺快照当「原生基准」去比对，会生成错误的 AGENT_REMAP 映射 |
| **流入 verify-style 后的阻断** | 部分 | `buildVerifyExpression` L530-531: `result.pass = result.compatible && result.installed && result.stylePresent && themeMatches && ...`——compatible=false 确实阻断 pass；但仅针对 injector 链路（apply 后的 verify），不覆盖 `cdp-full-extract` 离线采集 |
| **流入语义签名的阻断** | 不存在 | 代码中未找到 `semanticSignature` 相关逻辑（grep 无匹配），说明语义签名要么未实现要么以不同名称存在 |

### 2.3 最高风险缺口：残缺数据无质量标记

`cdp-full-extract.mjs` 输出的 JSON（L928-1016）的 `meta` 字段：

```js
meta: {
  agent: agentName,
  port: port,
  extractedAt: new Date().toISOString(),
  wsDebugUrl,
}
```

**缺失字段：**
- `dataQuality`: 完整 / partial / degraded
- `failedSchemes`: `['dark']`（暗色切换失败时）
- `truncated` —— 实际上 `dom-snapshot.mjs` 的节点级 `truncated` 字段（L96/L105/L223）存在，但 `cdp-full-extract.mjs` 的 `captureDomTree` 输出格式走的是另一条路径（L366-475），**不包含 truncated 信息**
- `corsBlockedSheets`: CORS 被阻止的样式表数量
- `retryAttempts`: 重试次数

---

## 3. 多 Agent 时序隔离现状

### 3.1 探针等待/重试策略：全局统一，无 Agent 级配置

#### cdp-full-extract.mjs

| 维度 | 值 | 代码位置 |
|------|---|---------|
| `THEME_SWITCH_WAIT` | 600ms | L32 |
| `DEFAULT_MAX_DOM_NODES` | 2000 | L30 |
| `DEFAULT_MAX_DEPTH` | 12 | L31 |
| WS 连接超时 | 8000ms | L313 |
| CDP 命令超时 | 10000ms | L345 |
| DOM evaluate 超时 | 15000ms | L460 |

**全部硬编码在脚本顶部常量区**，6 个 Agent 共用同一套值。无任何 per-Agent 覆盖机制。

L21-28 的 `AGENT_PORTS` 也是硬编码端口映射：

```js
const AGENT_PORTS = {
  codex: 58360,
  doubao: 61607,
  qoderwork: 61996,
  traework: 54676,
  workbuddy: 52743,
  zcode: 65142,
};
```

批处理入口 L1073-1075 串行执行 6 个 Agent：

```js
for (const [name, port] of Object.entries(agentsToExtract)) {
  results[name] = await extractAgent(port, name, resolvedOut);
}
```

**串行而非并行**，所以 A Agent 的超时不会并发冲击 B Agent，但会导致总耗时 = 6 × 单 Agent 耗时（估算 3-5 分钟全程）。

#### injector.mjs

| 维度 | 默认值 | 代码位置 |
|------|--------|---------|
| `timeoutMs` (waitForTargets) | 30000ms | L141 |
| `timeoutMs` (applyTheme) | 30000ms | L264 |
| `settleTimeoutMs` (waitForCompatibility) | 5000ms | L220 |
| `sessionTimeoutMs` (withSessions) | 10000ms | L163 |
| `INCOMPATIBLE_RETRY_MS` (watchTheme) | 15000ms | L415 |
| `delay` between watch polls | 900ms | L488 |

**同样全局统一**，无 per-Agent 配置。但 injector 的 `timeoutMs` 是参数化的（由调用方传入），理论上调用方可传入不同值——但审计未发现任何调用方传入了 Agent-specific 值。

### 3.2 隔离机制分析

| 隔离维度 | 现状 | 风险 |
|---------|------|------|
| **端口隔离** | 每个 Agent 独立端口（`AGENT_PORTS`） | 无风险——端口天然隔离 |
| **串行 vs 并行** | `cdp-full-extract` 串行；`injector` 的 `withSessions` 串行遍历 targets | 串行避免了并发冲击，但 `cdp-full-extract` 串行意味着一个 Agent 的 8s WS 超时阻塞后续 5 个 Agent |
| **超时隔离** | 无——一个 Agent 的 30s timeout 会完整消耗 | P2：串行链路上单 Agent 故障会线性放大总耗时 |
| **错误隔离** | `cdp-full-extract`: `extractAgent` 失败返回 `null`，不阻断其他 Agent（L1028-1029） | 有基本隔离 |
| **状态隔离** | `injector.mjs` 的 `persistenceScriptIds` 和 `persistenceSessions` 是模块级 Map，key 含 port 和 targetId | 有隔离——不同 Agent 的持久化脚本不会串 |
| **SessionPool 隔离** | `session-pool-runtime.mjs`: key 为 `target.id \|\| webSocketDebuggerUrl` | 有隔离 |

### 3.3 防止 A Agent 时序配置影响其余 5 个的机制

**结论：不存在显式机制，依赖隐式隔离（串行执行 + 独立端口）。**

- `cdp-full-extract.mjs` 的串行循环中，每个 `extractAgent` 调用创建独立的 `CdpClient` 实例（L816），调用完毕后 `client.close()`（L1031）。无跨 Agent 状态泄漏。
- 但**全局常量共享**意味着：如果 codex 需要 800ms 而 workbuddy 需要 1200ms，两者都用 600ms——对 codex 足够，对 workbuddy 可能不够。
- 没有「Agent A 探测超时后自动延长 Agent B 的等待」这种负面耦合（这是好事），但也没有「Agent A 快速就绪后缩短 Agent B 等待」的正面协同。

---

## 4. 风险等级矩阵

| # | 发现 | 风险等级 | 影响面 | 触发概率 |
|---|------|---------|--------|---------|
| F1 | `cdp-full-extract` 使用硬定时器（600ms）判定就绪，无 DOM settling 检测 | **P1** | 离线采集数据质量 | 高——高初始化 Agent 必然触发 |
| F2 | 残缺 token 集合无质量标记，下游 Theme Studio 无法区分「无此变量」和「未拿到变量」 | **P1** | Theme Studio 数据可靠性 | 高 |
| F3 | CORS 样式表内的变量声明静默丢失，无告警无降级 | **P1** | 离线采集完整性 | 中——取决于 Agent 是否用 CDN CSS |
| F4 | `cdp-full-extract` 串行执行，单 Agent WS 超时（8s）阻塞后续全部 | **P2** | 批处理总耗时 | 中 |
| F5 | `setColorScheme` 切换失败时无重试，暗色/亮色数据直接为 null | **P2** | 双主题数据完整性 | 中 |
| F6 | `watchTheme` 不感知子路由切换和弹窗弹出（仅 `loadEventFired` + MutationObserver） | **P2** | 运行时主题持久化 | 中 |
| F7 | 全局统一时序常量，无 per-Agent 配置能力 | **P2** | 跨 Agent 适配灵活性 | 高 |
| F8 | `analyze-structure-compare` 的 `listCdpTargets(port, 1500)` 超时偏紧 | **P3** | 结构对拍成功率 | 低 |
| F9 | `cdp-full-extract` 仅取第一个 `page` type target，多 WebView 场景遗漏 | **P2** | 多窗口 Agent 覆盖度 | 低 |
| F10 | `dom-snapshot.mjs` 的 `truncated` 字段在 `cdp-full-extract` 路径中丢失 | **P2** | 快照质量可见性 | 高 |
| F11 | `captureDomTree` 失败回退为单节点 `{ t: 'html', d: 0 }` 但无标记 | **P2** | DOM 数据质量 | 低 |
| F12 | `analyze-structure-compare` 的 closed shadow root 检测依赖未建的 rule 库 | **P3** | 结构对拍完整性 | 高（rule 库未建） |

---

## 5. 方案推演

### 5.1 针对 F1/F2：执行时机与数据质量标记

#### 方案 A：CDP 原生生命周期事件 + requestAnimationFrame 轮询

**描述：** 在 `cdp-full-extract.mjs` 中，`setColorScheme` 后不直接 `sleep(600)`，而是：
1. 监听 `Page.frameNavigated` + `Page.loadEventFired` 事件。
2. 注入一段 `requestAnimationFrame` 轮询脚本，检测 `document.readyState === 'complete'` 且连续 3 帧（约 50ms）内 `document.querySelectorAll('*').length` 变化 < 1%。
3. 设置兜底超时（如 5000ms），超时后标记 `dataQuality: 'timeout-settled'`。

**复杂度：** 中。需要改造 `CdpClient` 支持事件订阅（当前仅支持 `on(event, handler)` 但 `cdp-full-extract` 未使用）。

**优点：** 精确判定页面稳定态，消除定时器盲等。

**缺点：** 对「页面永远不稳定」（持续动画、WebSocket 推送更新）的场景需要额外启发式。

#### 方案 B：双阶段采集 + 质量元数据注入

**描述：** 不改变等待策略，而是在输出 JSON 中注入质量元数据：
- 在 `captureDomTree` 前后各执行一次 `document.querySelectorAll('*').length` 快照，差值 > 5% 标记 `dataQuality: 'unstable'`。
- 在 `setColorScheme` 前后各执行一次 `getRootComputedVariables`，变量集合变化率 < 10% 标记 `schemeSwitch: 'unresponsive'`。
- CORS 被阻的样式表数量写入 `meta.corsBlockedSheets`。

**复杂度：** 低。仅增加 2-3 次额外的 `Runtime.evaluate` 调用和元数据字段。

**优点：** 不改核心逻辑，仅增加可观测性。下游 Theme Studio 可据此过滤低质量数据。

**缺点：** 不解决「采集时机过早」问题，仅让问题可见。

#### 方案 C：Agent 级时序配置表

**描述：** 在 `AGENT_PORTS` 旁增加 `AGENT_TIMING` 配置：

```js
const AGENT_TIMING = {
  codex:    { themeSwitchWait: 400, maxDomWait: 3000 },
  workbuddy:{ themeSwitchWait: 1000, maxDomWait: 8000 },
  // ...
};
```

**复杂度：** 低。仅扩展配置区 + 在 `extractAgent` 中读取。

**优点：** 最小改动解决 per-Agent 差异化。

**缺点：** 需要人工维护配置，Agent 版本更新后配置可能过时。

**推荐：** B + C 组合。B 提供可观测性，C 解决已知差异，A 作为长期演进方向。

---

### 5.2 针对 F3/F5：残缺数据处理

#### 方案 A：CORS 样式表回退到 CSSOM `getComputedStyle`

**描述：** 对 CORS 被阻的样式表，不尝试读取 `cssRules`，改为在页面内执行 `getComputedStyle(document.documentElement)` 遍历所有 CSS 属性——至少能拿到最终生效的变量值（虽然丢失了声明结构）。

**复杂度：** 低。`getRootComputedVariables` 已存在（L580-609），只需在 CORS 路径中调用。

**优点：** 不丢失变量值，仅丢失声明来源。

**缺点：** 无法区分「暗色变量」和「亮色变量」——因为 `getComputedStyle` 只返回当前生效值。

#### 方案 B：残缺数据标记 + 阻断下游消费

**描述：** 在输出 JSON 中增加 `meta.dataQuality` 枚举：`complete` / `partial-scheme` / `partial-cors` / `degraded`。Theme Studio 消费时过滤 `degraded` 数据。

**复杂度：** 低。仅增加元数据字段 + 下游消费逻辑。

**优点：** 防止残缺数据污染 Theme Studio 的 AGENT_REMAP 映射。

**缺点：** 需要 Theme Studio 侧配合改造。

**推荐：** A + B 组合。

---

### 5.3 针对 F6：运行中动态变化感知

#### 方案 A：扩展 `watchTheme` 增加子路由/弹窗检测

**描述：** 在 `watchTheme` 的 900ms 轮询中增加：
- `location.pathname` 变化检测（子路由切换）。
- `document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')` 检测（弹窗出现）。
- 检测到变化时触发 `onEvent({ type: 'route-changed' })` 并重新执行 `applyCompatible`。

**复杂度：** 中。需要在 watch 循环中增加额外的 `Runtime.evaluate` 调用。

**优点：** 覆盖子路由和弹窗场景。

**缺点：** 900ms 轮询间隔意味着最多 900ms 延迟感知。

#### 方案 B：注入 MutationObserver 监听路由容器

**描述：** 在持久化脚本中注入一个 MutationObserver 监听 `#root` / `[data-router]` 容器的 childList 变化，变化时通过 `Runtime.evaluate` 回调主进程。

**复杂度：** 高。需要 CDP `Runtime.addBinding` 或 `Runtime.evaluate` + 轮询结合。

**优点：** 实时感知，无轮询延迟。

**缺点：** 增加运行时开销，可能与现有 `AdaptiveMutationObserver` 冲突。

**推荐：** A（短期）→ B（长期，需评估性能影响）。

---

### 5.4 针对 F7/F9：多 Agent 时序隔离

#### 方案 A：并行采集 + 独立超时

**描述：** 将 `cdp-full-extract.mjs` 的串行循环改为 `Promise.allSettled`，每个 Agent 独立超时、独立重试。

**复杂度：** 低。仅改 L1073-1075 的循环结构。

**优点：** 总耗时从 6× 降到 1×（受限于最慢 Agent）。

**缺点：** 6 个 Agent 同时 CDP 连接可能触发目标应用性能问题（每个 Agent 的渲染进程被密集 evaluate）。

#### 方案 B：并发度限制（MAX_CONCURRENCY）

**描述：** 引入 `MAX_CONCURRENCY = 2` 或 `3`，使用 `p-limit` 或手写信号量控制并行度。

**复杂度：** 低。

**优点：** 平衡吞吐与目标应用负载。

**缺点：** 需要引入并发控制依赖或手写。

#### 方案 C：Agent 级配置 + 并行采集

**描述：** 组合方案：`AGENT_TIMING` 配置表 + `MAX_CONCURRENCY` 并行。

**复杂度：** 中。

**推荐：** C。

---

## 6. 6 Agent 隔离缺口

### 6.1 端口硬编码缺口

`AGENT_PORTS` 硬编码了 6 个端口（L21-28），但：
- 端口可能因 Agent 版本更新而变化。
- 多开场景下同一 Agent 可能有多个端口。
- `analyze-structure-compare.mjs` 的 `resolveLivePort`（L164-193）已实现 DevToolsActivePort + netstat 双路发现，但 `cdp-full-extract.mjs` 未复用此逻辑。

**缺口：** `cdp-full-extract.mjs` 的端口发现能力落后于 `analyze-structure-compare.mjs`。

### 6.2 串行链路中的级联阻塞

`cdp-full-extract.mjs` 串行执行 6 个 Agent，无并发度控制也无 per-Agent 超时隔离。一个 Agent 的 8s WS 超时 + 10s CDP 超时 + 15s DOM evaluate 超时 = 单 Agent 最大 33s 阻塞。

**缺口：** 无全局超时熔断机制。

### 6.3 共享常量导致的「一刀切」

`THEME_SWITCH_WAIT = 600ms` 对 codex（快）过多、对 workbuddy（慢）可能不足。

**缺口：** 无 per-Agent 时序配置。

### 6.4 多 WebView 覆盖不全

`cdp-full-extract.mjs` L801 仅取第一个 `page` type target：

```js
const pageTarget = targets.find((t) => t.type === 'page');
```

workbuddy 等 Agent 可能有多个 WebView（主窗口 + 弹出窗口），仅探测主窗口会遗漏弹出窗口的样式差异。

**缺口：** 多 WebView 场景覆盖不全。

### 6.5 跨链路状态不共享

`cdp-full-extract` 采集的「暗色/亮色变量集合」与 `injector` 的 `baseline-css-capture` 采集的基准数据**不共享、不互验**。如果两者数据不一致（因采集时机不同），无法自动发现。

**缺口：** 离线采集与在线采集的数据一致性无校验。

### 6.6 持久化脚本的跨 Agent 泄漏风险

`injector.mjs` 的 `persistenceScriptIds` 和 `persistenceSessions` 是模块级 Map，key 为 `${port}:${targetId}`。理论上不同 Agent 的 port 不同，不会串。但如果 Agent 重启后端口变化（从 `AGENT_PORTS` 硬编码值变为新端口），旧 port 的 session 不会被清理——`persistenceSessions` Map 会积累 stale entries。

**缺口：** 无 stale session 清理机制（仅依赖 `acquirePersistenceSession` 内的 closed 检测 L54-55，但 stale 不等于 closed）。

---

## 7. 审计方法说明

### 7.1 证据来源

| 文件 | 行数 | 审计重点 |
|------|------|---------|
| `scripts/cdp-full-extract.mjs` | 1107 | 执行时机、残缺处理、多 Agent 串行策略 |
| `src/engine/src/runtime/dom-snapshot.mjs` | 231 | DOM 快照表达式构建、truncated 字段 |
| `src/engine/src/runtime/injector.mjs` | 497 | 注入编排、waitForCompatibility 双预算、watchTheme |
| `src/engine/src/runtime/session-pool-runtime.mjs` | 133 | 会话池 TTL、per-target key |
| `src/engine/src/runtime/renderer-payload.mjs` | 535 | buildVerifyExpression、buildProbeExpression、AdaptiveMutationObserver |
| `src/main/cdp/baseline-validator.ts` | 294 | 基准校验器、assessFidelity 纯函数 |
| `src/main/cdp/cdp-ready.ts` | 122 | 统一 CDP 就绪判定 |
| `src/main/cdp/injection/shared.ts` | 129 | waitForTheme 轮询、backoffDelay |
| `src/main/cdp/injection/engine-strategy.ts` | 150+ | 主进程注入编排 |
| `scripts/analyze-structure-compare.mjs` | 93.8KB | 结构对拍、端口发现、closed shadow 检测 |

### 7.2 未覆盖区域

- `src/main/cdp/baseline-css-capture.ts` 和 `baseline-css-replay.ts`：基准采集与回注的具体实现细节未深入。
- `src/main/cdp/injection/css-inject.ts`：CSS 层注入的 CDP 协议级细节未审计。
- `src/main/cdp/cdp-fanout.ts`：多 target 扇出逻辑未审计。
- 6 个适配器的 `verification` 配置（`adapter.verification`）未逐一审计。

### 7.3 局限性

- 纯静态分析，未在运行态验证时序假设。
- 未量化各 Agent 的实际初始化时长分布。
- 未测试 CORS 样式表在 6 个 Agent 中的实际占比。

---

## 8. 总结

### 8.1 核心发现

1. **三条探针链路各自为战**：`cdp-full-extract`（离线）、`injector`（在线）、`analyze-structure-compare`（CI）各自实现了独立的等待/重试/降级逻辑，无统一编排层。其中 `cdp-full-extract` 最为薄弱（纯定时器、无重试、无质量标记）。

2. **运行时注入链路设计完善**：`waitForCompatibility` 的双预算机制、`AdaptiveMutationObserver` 的三层节流、`watchTheme` 的 `loadEventFired` 感知——这些是成熟的设计。但子路由切换和弹窗弹出的感知仍有缺口。

3. **离线采集链路需要可观测性补课**：`cdp-full-extract` 的输出 JSON 缺少质量元数据，下游 Theme Studio 无法区分「数据完整」和「数据残缺」。

4. **多 Agent 隔离依赖隐式机制**：串行执行 + 独立端口提供了基本隔离，但全局共享时序常量导致无法适配 6 个 Agent 的差异化初始化特征。

### 8.2 优先行动项

| 优先级 | 行动 | 预期收益 |
|--------|------|---------|
| P0 | `cdp-full-extract` 输出 JSON 增加 `meta.dataQuality` 字段 | 阻断残缺数据流入 Theme Studio |
| P1 | `cdp-full-extract` 增加 CORS 被阻样式表计数 + 暗色切换响应检测 | 让残缺可见 |
| P1 | 引入 `AGENT_TIMING` per-Agent 时序配置表 | 解决 workbuddy 等高初始化 Agent 的采集质量问题 |
| P2 | `cdp-full-extract` 改为 `MAX_CONCURRENCY` 并行采集 | 批处理耗时从 6× 降到 2-3× |
| P2 | `watchTheme` 增加子路由/弹窗检测 | 覆盖运行中动态变化场景 |
| P3 | 统一三条链路的探针编排层（长期架构） | 消除重复逻辑，统一质量标准 |

---

*审计人：AgentSkin CDP 审计 Agent*
*状态：草稿，待用户确认后进入正式评审*
