# RFC：引擎运行时新增 `Page.addScriptToEvaluateOnNewDocument` 重注入持久化

> 状态：`✅ 已落地（P1+P2+P3）`
> 日期：2026-08-17
> 分支：`main`
> 范围：`src/engine/src/runtime/`（injector.mjs / renderer-payload.mjs / cdp/session.mjs）、`src/engine/src/runtime/*.mjs` 相关单测
> 落地提交记录：P1 核心（注入体提炼 + 追踪 + apply/remove 注册清理 + 单测）、P2 集成验证（`npm run check` 全绿：162 文件 / 2752 测试）、P3 watchTheme 收敛（重注入职责移交持久化脚本，loadEventFired 退化为监听+上报，未追踪时回退显式重注入）

---

## 1. 背景与目标

**现状痛点**

引擎运行时（`src/engine/`，vendored `@agentskin/engine`）的 `applyTheme` 采用一次性 `Runtime.evaluate` 注入：把 `buildApplyExpression` 生成的整段 JS（含 `#agentskin-theme-style-<host>` 样式 + 自愈 MutationObserver 循环）在**当前 document** 中求值一次。当目标应用发生以下任一情况时，注入的主题随即消失：

- 页面导航（SvelteKit / Next 等路由切换或整页 reload）；
- React / Svelte root 重新挂载；
- 用户手动刷新（`Ctrl+R` / 应用内刷新按钮）；
- 二级窗口 / 弹窗重新创建。

当前唯一具备「重载后恢复」能力的是 `watchTheme`（监听 `Page.loadEventFired` 后在**同一 session** 内重注入），但它是轮询型、单 session 绑定的 watch 通道，不适用于一次性 `applyTheme` 调用，且 `removeTheme` 也无持久化清理语义。

**对照：主进程侧已有成熟实现**

`src/main/cdp/injection/engine-strategy.ts` 已实现完整的 `Page.addScriptToEvaluateOnNewDocument` 持久化机制，且经历过 P1 audit #8 的泄漏修复（脚本标识符追踪 + 显式移除）。引擎运行时缺失的是同一能力的移植，属「补齐一致性」，而非全新发明。

**目标（可验证）**

1. 引擎 `applyTheme` 后，目标页面**导航 / reload 后主题自动恢复**，无需重新调用 `applyTheme`。
2. 引擎 `removeTheme` 后，**新 document 不再重注入**，且已注册的持久化脚本被显式移除（不残留、不累积）。
3. 连续多次 `applyTheme` / `removeTheme` 切换后，目标上**无脚本堆积**（对照主进程 P1 audit #8 行为）。

**非目标**

- 不改变 L0-L4 注入分层语义、不改变 `buildApplyExpression` 的当前 document 注入行为。
- 不引入新的运行时依赖、不接入主进程 `engine-strategy.ts`（引擎保持自包含，vendored 不依赖主进程模块）。
- 不修改主进程侧已验证的 `engine-strategy.ts` 实现。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）——引擎运行时注入生命周期新增持久化层
- [ ] 新增 UI 页面（突破六页封顶）
- [ ] 新增适配器（突破六适配器上限）
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

---

## 3. 现状侦察（代码锚点）

| 文件 | 符号 / 行 | 说明 |
|------|-----------|------|
| `src/engine/src/runtime/injector.mjs` | `applyTheme` (L138-193) | 一次性 `session.evaluate(buildApplyExpression(...))`，无持久化 |
| `src/engine/src/runtime/injector.mjs` | `removeTheme` (L205-208) | 一次性 `session.evaluate(buildRemoveExpression(...))`，无持久化清理 |
| `src/engine/src/runtime/injector.mjs` | `watchTheme` (L228-297) | `Page.loadEventFired` 后重注入；轮询型、单 session 绑定 |
| `src/engine/src/runtime/renderer-payload.mjs` | `buildApplyExpression` (L156) / `buildRemoveExpression` (L353) | 应用 / 移除表达式；已含 `__agentskin_disabled__` sessionStorage 停用键 |
| `src/engine/src/cdp/session.mjs` | `CdpSession.send` (L79) / `CdpSession.on` (L73) | 原生 CDP 方法 + 事件监听能力已具备，可直发 `Page.*` 命令 |
| `src/engine/src/runtime/session-pool-runtime.mjs` | `SessionPool` | CV-08 session 复用池；持久化脚本标识符需按 target 维度归集 |
| `src/main/cdp/injection/engine-strategy.ts` | `registerEnginePersistence` (L323) / `persistenceScriptIds` (L73) / `removeEngineInjection` (L541) | **参考实现**：自包含脚本 + 标识符追踪 + 显式移除（P1 audit #8） |
| `docs/ARCHITECTURE.md` | L84 | 文档已声明「持久化：`Page.addScriptToEvaluateOnNewDocument`」为当前设计，引擎层补齐后与之对齐 |

---

## 4. 设计方案

### 4.1 总体思路

将主进程 `engine-strategy.ts` 的「自包含持久化脚本 + 标识符追踪 + 显式移除 + sessionStorage 停用兜底」四要素移植到引擎运行时，但按引擎风格落地：

- **自包含脚本**：把 `buildApplyExpression` 的「核心注入逻辑」提炼为可被持久化脚本调用的纯函数（当前 document 注入与 new-document 重注入共用同一份注入体，避免两份逻辑漂移）。
- **标识符追踪**：引擎侧新增模块级 `persistenceScriptIds = new Map<targetKey, Set<identifier>>`，targetKey = `port:targetId`（与 SessionPool 的 key 约定一致）。
- **显式移除**：`removeTheme` 在移除当前 document 后，对每个 target 调用 `Page.removeScriptToEvaluateOnNewDocument` 清除已注册标识符；同时保留 `__agentskin_disabled__` sessionStorage 停用兜底（对齐 `buildApplyExpression` 已有的 `DISABLED_KEY`）。
- **幂等**：持久化脚本内判断 `document.getElementById('agentskin-theme-style-<host>')` 已存在则跳过（对齐 `buildRemoveExpression` 现有守卫），保证 reload 后不重复堆叠。

### 4.2 数据结构

```ts
// 模块级（引擎运行时）
const persistenceScriptIds = new Map<string, Set<string>>(); // key = `${port}:${targetId}` → 已注册脚本标识符集
```

### 4.3 时序

```
applyTheme:
  preflight → evaluate(buildApplyExpression)   // 当前 document 注入（现状不变）
  → 每个兼容 target：
      sessionStorage.removeItem('__agentskin_disabled__')   // 清停用标记（操作级会话）
      acquirePersistenceSession(target, key)                 // 打开/复用专用长生命周期会话（Page.enable）
      Page.addScriptToEvaluateOnNewDocument({ source: persistScript, runImmediately: false })  // 在该专用会话上注册
      → 记录返回的 identifier 到 persistenceScriptIds[key]
  → verify（现状不变）
  → ownedPool.dispose()   // 关闭操作级会话；专用持久化会话保持打开 → 注册存活

导航 / reload 后：
  persistence 脚本在 new document 运行：
    若 sessionStorage['__agentskin_disabled__']==='1' → 跳过
    等待 document.documentElement → 注入样式 + 启动自愈
    （幂等：style 已存在则跳过）

removeTheme:
  对每个 target：
    取专用持久化会话（persistenceSessions[key]）：
      Page.removeScriptToEvaluateOnNewDocument(identifier) 逐个清除（best-effort）
      关闭该专用会话（关闭即丢弃所有注册）
    sessionStorage.setItem('__agentskin_disabled__', '1')  // 兜底
    evaluate(buildRemoveExpression)                        // 当前 document 清理（现状不变）
  清空 persistenceScriptIds[key]
```

### 4.4 边界条件

- **target 重启 / 重建**：旧标识符随旧 target 消亡，`remove` 调用静默失败，属预期（对齐主进程注释「Identifier may be from a previous target」）。
- **⚠️ 会话绑定（实证修正，2026-08-17）**：`Page.addScriptToEvaluateOnNewDocument` 注册是**会话级**而非 target 级——关闭注册该脚本的 WebSocket 会话会**同时丢弃注册**；跨会话 `Page.removeScriptToEvaluateOnNewDocument` 会报 "Script not found (-32000)"。因此持久化注册/移除必须路由到一条**专用长生命周期会话**（`persistenceSessions`，按 `port:targetId` 持有），该会话在 apply/watch 时创建、跨 apply 存活，直到 `removeTheme` 才关闭。若沿用操作级 SessionPool 会话注册，`ownedPool.dispose()` 关闭会话后持久化即失效（实测 reload 后主题不恢复）。本结论推翻本节早先「标识符 target 级、跨 session 亦可 remove」的假设，代码与 RFC 已同步修正。
- **CSP**：CDP evaluate / new-document 脚本走注入通道，绕过页面 CSP（主进程已验证），引擎同通道不新增风险。
- **多个 host（多窗口/弹窗）**：持久化脚本按 host 注入；各 target 独立追踪。

### 4.5 与 `watchTheme` 的关系

`watchTheme` 的 `Page.loadEventFired` 轮询重注入与 new-document 持久化**功能重叠**。落地后 `watchTheme` 可逐步退化为「仅监听 + 事件上报」，重注入职责移交持久化脚本（分批落地，先共存后收敛，不一次性删改 watch 语义）。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | 脚本泄漏：N 次 apply/remove 循环后 target 累积 N 个脚本，全部在每次导航执行 | 高 | 未做标识符追踪或 remove 不清理 | 4.1 标识符追踪 + removeTheme 显式移除 + sessionStorage 停用兜底 | 单测：连续 3 次 apply/remove 后断言仅 0 个活动脚本；集成：CDP `Page.getScriptToEvaluateOnNewDocument` 枚举（如可用） |
| 2 | 持久化脚本在每次导航增加首帧开销（脚本体积大、含 base64 资源） | 中 | 每次 reload 都执行大脚本 | 脚本只注入差量（style 已存在则提前 return）；资源以 data URL 内联，最小化体积 | 运行时性能采样：reload 后首帧渲染时间对比 |
| 3 | `document.documentElement` 尚未出现时脚本早执行 | 中 | new document 早期 | 对齐主进程：MutationObserver 等待 `<html>` 后再注入 | 集成：目标应用启动早期导航场景手测 |
| 4 | CSP / 同源策略阻断脚本 | 低 | 目标升级收紧策略 | CDP 注入通道天然绕过（主进程已验证）；失败不影响当前 document 注入 | 现有 verification 回归 |
| 5 | 与 `watchTheme` 双通道并发重注入导致重复执行 | 低 | watch + 持久化同时存在 | 注入体幂等（style 已存在跳过）；分批计划先共存后收敛 | watch 回归测试 |

---

## 6. 分批落地计划

按「风险从低到高、收益先行」排序，每批均可独立验证、可回滚：

| 批 | 改动 | 验证方式 |
|----|------|----------|
| P1 | 提炼「注入体」纯函数：`buildApplyExpression` 与持久化脚本共用同一注入体；新增引擎侧 `persistenceScriptIds` 追踪 + `applyTheme` 注册、`removeTheme` 清理 | 单测：注入体幂等、标识符追踪增删、连续 apply/remove 无堆积；`npm run check` 全绿 |
| P2 | 运行时集成验证：对运行中 Agent 执行 apply → 手动 reload → 断言主题恢复；remove → reload → 断言不重注入 | 手工 CDP 验证 + 新增集成测试用例 |
| P3 | 收敛 `watchTheme`：重注入职责移交持久化脚本，watch 退化为监听 + 上报（先共存，观察无回归后再收敛） | watch 回归 + 全量 `npm run check` |

**落地结果（2026-08-17）**

- **P1 ✅**：`renderer-payload.mjs` 新增 `buildPersistenceScript`（内嵌 `buildApplyExpression` 输出，共用同一注入体）+ 导出 `SESSION_DISABLED_KEY`；`injector.mjs` 新增 `persistenceScriptIds` 追踪（key = `port:targetId`）与 `registerPersistenceScript` / `removePersistenceScripts` / `persistenceKeyFor` / `listPersistenceScriptIds`，`applyTheme` 注册 + `removeTheme` 显式清理 + sessionStorage 停用兜底。
- **P2 ✅**：新增 `persistence.test.ts`（7 用例：标识符记录、连续 apply 无累积、remove 清理、失效标识符容错、无追踪 no-op）+ `renderer-payload.test.ts` 新增 4 用例（注入体同源、停用门、documentElement 等待、`(0, eval)` 执行）。`npm run check` 全绿：**165 文件 / 2790 测试（2787 passed + 3 skipped）**，typecheck / lint / contract / themes / staleness / architecture 全部通过。（注：修复了一处既有未提交格式错误 `src/main/scene-size.verify.test.ts`，非本 RFC 引入。）
- **Manual 测试门（2026-08-17 收尾）✅**：3 个 `.manual.test.ts`（live-reload-persistence / live-apply-all / reseed-themes）此前会被 vitest `main` project 的 `src/main/**/*.test.ts` 扫入 `npm run check`，agent 在线时会真实改动全部 6 个 agent（含正在使用的 traework）并导致 `live-apply-all` 120s 超时——与文件头「NOT part of npm run check」声明相悖。现统一改为 `describe.skipIf(!MANUAL)` / `it.skipIf(!MANUAL)` 门：`npm run check` 静默跳过（3 skipped），不碰实时 agent、不超时；显式运行需 `AGENTSKIN_MANUAL=1 npx vitest run <file>`。**最终全量校验：2787 passed + 3 skipped（exit 0）。**
- **P3 ✅**：`watchTheme` 注册持久化脚本；`Page.loadEventFired` 退化为仅上报 `reloaded` 事件，仅当目标未追踪到持久化标识符时回退显式重注入（兜底不丢失主题）。
- **会话绑定修正（2026-08-17，P2 集成验证暴露）✅**：live-reload-persistence.manual.test.ts 实测发现 apply 后 reload 主题不恢复（`ran:null`）。定位到 `Page.addScriptToEvaluateOnNewDocument` 注册为**会话级**：`applyTheme` 操作级 SessionPool 在 finally `dispose()` 关闭会话后注册即被丢弃。修复：新增模块级 `persistenceSessions`（key = `port:targetId`）持有专用长生命周期会话，apply/watch 均在该专用会话注册，removeTheme 在同一会话移除并关闭之。实测 qoderwork/doubao/codex/zcode 4 个 agent `R1=1 R2-autoRestored=1 R4-absent=true` 全通过；workbuddy 因 CDP 端口发现不稳定偶发跳过（探针既有问题，非持久化缺陷）。同时为持久化脚本增加 `window.__AGENTSKIN_PERSIST_RAN__` / `__AGENTSKIN_PERSIST_ERR__` 诊断全局，便于后续排障。

---

## 7. 人工复核项

1. 引擎 `applyTheme` 的调用方（`src/legacy/agentskin-core-runtime.ts` 桥接层）是否接受「apply 后目标行为变化（reload 后自动恢复）」——确认这是期望语义而非兼容性破坏。 **→ 用户已确认（2026-08-17）：「apply 后 reload 自动恢复主题、removeTheme 才停止」为期望语义，与主进程 engine-strategy 一致。**
2. 多窗口 / 弹窗场景下，是否需要**逐个窗口**持久化，还是仅主窗口即可覆盖实际使用路径。 **→ 当前实现按 target 逐个持久化（兼容 target 即注册），多窗口天然覆盖；待实机验证后按需收敛。**
3. `removeTheme` 语义：当前是否为「完全退出主题」，若是，则「remove 后 reload 不重注入」符合预期；若存在「临时停用」需求，需另行评估（不在本 RFC 范围）。 **→ 按「完全退出」落地。**
4. 与主进程 `engine-strategy.ts` 是否需要在近期合并为单一实现（双实现并存有维护成本），还是保持引擎自包含、各自演进——需架构负责人决策。 **→ 保持引擎自包含、各自演进（与引擎 vendored 定位一致），双实现均含同一套 P1 audit #8 语义。**

---

## 8. 评审结论

- **结论：通过，已落地（P1+P2+P3 全部执行）。**
- 注入体单一来源：`buildPersistenceScript` 内嵌 `buildApplyExpression` 输出，杜绝两份逻辑漂移；
- 脚本不累积：`persistenceScriptIds` 按 `port:targetId` 追踪 + `applyTheme` 注册前先移除旧脚本 + `removeTheme` 显式清理 + sessionStorage 停用兜底，三层防线对齐主进程 P1 audit #8；
- `npm run check` 全绿（162 文件 / 2752 测试），含新增 11 个用例；无回归。
