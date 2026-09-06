# 竞品深度分析报告 — 第 10 轮（底层重构专题）

> 执行时间：2026-08-28 22:45
> 分析范围：CDP 注入底座 / 母舰级适配器抽象 / 可逆换肤运行时
> 本轮定位：**不新增功能，聚焦底层更新、优化与重构**
> 数据来源：GitHub API 实时拉取（star / forks / license / release / commits / 目录树 / 关键源码）

---

## 〇、轮换选择说明

截至本轮，`AI_SKIN_ECOSYSTEM_LANDSCAPE.md` 的 97 个项目几乎全部被历史报告引用过。本轮**换血导向**——不再追逐主题皮肤类项目，而是选择 5 个对 AgentSkin **底层架构**最有重构价值的项目：

| 选择理由 | 项目 |
|---------|------|
| 母舰级跨平台切换器（直接关联 traework/qoderwork/workbuddy/zcode/doubao 五款适配目标） | xxxhh336/dream-work-theme |
| 可逆换肤运行时（对标 agent-engine-service 编排层，含 CODEDROBE_DOM_INCOMPATIBLE 处理） | CodeDrobe/core |
| TypeScript CDP SDK 底座（对标散落的 src/main/cdp/* 20+ 文件） | ntoskrnl7/electron-cdp |
| MCP 化 AI 桥接（对标 dom-snapshot.ts 与 React 结构理解） | oussamaexe/electron-debugger |
| CDP REPL 注入机制经典范本（注入时机/脚本生命周期） | tluyben/electron-inject |

---

## 一、项目真实数据总览（GitHub API 实测）

| 项目 | Stars | Forks | License | 语言 | 最新 Release | 最近提交 | 活跃度 |
|------|-------|-------|---------|------|-------------|---------|--------|
| xxxhh336/dream-work-theme | 8 | 2 | Apache-2.0 | TS | v1.2.6 (08-26) | 08-26 | 🔥 高 |
| CodeDrobe/core | 9 | 2 | Apache-2.0 | JS | v0.6.1 (07-19) | 07-21 | 中 |
| ntoskrnl7/electron-cdp | 2 | 0 | MIT | TS | v0.4.8 (05-14) | 05-18 | 低 |
| oussamaexe/electron-debugger | 1 | 0 | 无 | TS | v3.0.0 (无 release) | 06-23 | 低 |
| tluyben/electron-inject | 0 | 0 | 无 | JS | 无 | 2025-03-15 | ❄️ 停更 |

---

## 二、深度分析

### 2.1 xxxhh336/dream-work-theme — 母舰级适配器抽象（最高价值）

**定位**：跨平台 Electron Work 应用主题切换器，单套代码覆盖 WorkBuddy / TRAE Work / Codex / QoderWork / ZCode / 豆包 / Kimi / OpenCode 等 12+ 应用。v1.2.6（2026-08-26），本轮最活跃。

**关键源码发现**（目录树 + 源码实测）：

```
electron/manager/
├── app-registry.ts          # APP_DEFINITIONS：12+ 应用的声明式注册表
├── app-profiles/workbuddy.ts # 每应用独立 profile（cdp + theme token）
├── discovery.ts             # discoverApps() 统一发现
├── cdp.ts / injector.ts / launcher.ts / watcher.ts / theme-store.ts ...
```

`app-registry.ts` 的核心——**数据声明式适配器**：

```ts
export interface AppDefinition {
  id: string; name: string;
  exeNames: string[]; installPaths: string[];
  processName: string; defaultPort: number;
  rendererHints: string[];           // 主 renderer 语义锚点
  kind: 'workbuddy' | 'codex' | 'vscode-work' | 'generic-work';  // 分类收敛
  devToolsActivePort?: string;       // DevToolsActivePort 文件路径
  windowsPathScopedKill?: boolean;
  webView2?: boolean;
  acceptsGenericThemes: boolean;     // 是否复用通用注入逻辑
  darwin?: { appBundles: string[]; executableNames: string[] };
  linux?: { executableNames: string[]; desktopFiles: string[] };
}
```

`app-profiles/workbuddy.ts` 每个应用的**主题 token 契约**声明：

```ts
theme: {
  cssVariables: ['--cb-bg-primary','--cb-bg-secondary', /* 12 个 --cb-* token */],
  shellAttr: 'data-application-name',   // shell 结构锚点属性
}
```

`discovery.ts` 的**三平台发现策略**：
- Windows：`exeNames + installPaths` 枚举 → 命中 `WindowsApps` 目录的 `OpenAI.Codex_*` → **Appx 用 PowerShell `Get-AppxPackage` 探测**（解决无传统 exe 路径的 UWP 包装）
- darwin/linux：`appBundles` / `desktopFiles` 枚举

**可借鉴点（对 AgentSkin 底层）**：

1. ⭐⭐⭐ **声明式 AppDefinition 收敛**——AgentSkin 的 `ApplicationAdapter` 接口（src/adapters/base.ts）有 ~15 个方法（detect/getPath/applyTheme/restoreTheme/discover/findTargets/findRunningPids/resolveDebugPorts/defaultPort/displayName/rendererHints…），偏重。dream-work-theme 用「纯数据 + `kind` 分类 + `acceptsGenericThemes` 标志」把 12 应用收敛到 4 类，`generic-work` 复用通用注入路径。**AgentSkin 可借鉴 `kind` 分类，让 6 适配器中结构相似的（qoderwork/zcode/doubao 均为 generic-work 型）共享通用逻辑，减少 adapter 重复**。

2. ⭐⭐⭐ **`theme.cssVariables[]` 声明式 token 契约**——把「每应用支持哪些 CSS 变量」作为数据放进 profile，而不是散落在注入代码里。对应 AgentSkin 的 14-token 契约（C2），可把 token 清单下沉到适配器声明，供 `check-themes` 守卫脚本校验。

3. ⭐⭐ **Appx PowerShell 探测**——AgentSkin 的 app-discovery.ts（41KB）可参考其「传统路径枚举 → 失败后 PowerShell `Get-AppxPackage` 兜底」的两级探测。

---

### 2.2 CodeDrobe/core — 可逆换肤运行时分层（对标编排层）

**定位**：AI 桌面应用可逆换肤运行时（CLI + 适配器 + CDP 注入 + 验证 + 商店发布）。支持 Codex/WorkBuddy/QoderWork/TRAE SOLO。

**关键源码发现**（目录树 + 源码实测）：

```
src/
├── adapters/{codex,workbuddy,qoderwork,traework}.mjs + index.mjs
├── cdp/session.mjs            # CdpSession（WebSocket 封装）
├── runtime/{injector,dom-snapshot,launcher,skin,renderer-payload}.mjs
├── theme/{package,publish,store,legacy}.mjs
├── auth/ + cli.mjs + index.mjs
schemas/theme-manifest.schema.json   # JSON Schema 验证
types/{adapters,theme}.d.ts
```

`adapters/index.mjs` 的**适配器注册表**（极简契约）：

```js
const adapters = new Map([codex, workbuddy, qoderwork, traework]
  .map(a => [a.id, a]));
export function getAdapter(id) { /* 未命中抛错并列出可用 id */ }
export function registerAdapter(adapter) {
  if (!adapter?.id || typeof adapter.matchTarget !== "function")
    throw new Error("An adapter requires an id and matchTarget(target) function.");
}
```

`runtime/injector.mjs` 的**注入编排核心**（直接对应 AgentSkin 两个已知故障）：

```js
// 1. 目标发现：listCdpTargets → filter(adapter.matchTarget)
export async function findTargets(adapter, port, timeoutMs = 1500) { ... }

// 2. 轮询等待目标（带 deadline，避免随机超时）
export async function waitForTargets(adapter, port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { ... await delay(350); }
  // 超时抛出结构化错误：code='CODEDROBE_TARGET_TIMEOUT' + appId + port
}

// 3. 分阶段兼容性等待：bootTimeout vs settleTimeout
async function waitForCompatibility(session, expression, settleTimeoutMs=5000, bootTimeoutMs=settleTimeoutMs) {
  // root landmark 未出现 = 还在启动(splash)，给足 boot 预算；
  // 骨架出现后，真正的 selector 不匹配在 settle 预算内快速失败，避免拖死调用方
}

// 4. 次要窗口降级
export function markSecondaryTargets(results, isPrimary) {
  // 弹出聊天/隐藏 overlay 等次要 target 合法地缺少主窗口 DOM，
  // 一旦存在 primary target，其余降级为 skipped，使 probe/verify 与 applyTheme 一致
}
```

`cdp/session.mjs` 的 **CdpSession**（~100 行，Node 22.4+ 原生 WebSocket）：

```js
class CdpSession {
  constructor(target, timeoutMs) { this.pending = new Map(); this.nextId = 1; ... }
  async open() { /* open/error 双事件 + 超时 → Runtime.enable + Page.enable */ }
  send(method, params) { /* pending Map + 每请求超时定时器，close 时统一 reject */ }
  evaluate(expression) { /* Runtime.evaluate + exceptionDetails 转错误 */ }
  close() { this.#closePending("CDP session closed."); }  // 统一清理 pending
}
```

**可借鉴点（对 AgentSkin 底层）**：

1. ⭐⭐⭐ **分阶段等待（bootTimeout vs settleTimeout）**——这是**直接修复 AgentSkin「随机 CDP 注入超时」的根因级方案**。当前 AgentSkin 在目标应用仍在 splash/loading 阶段时，DOM 骨架未就绪就探针失败，或因固定超时过长拖死。CodeDrobe 用「root landmark 是否出现」区分 boot/settle 两个预算，既给足启动时间、又不拖慢真正的 selector 不匹配。

2. ⭐⭐⭐ **次要窗口降级（markSecondaryTargets）**——直接对应 AgentSkin 已知故障 **CODEDROBE_DOM_INCOMPATIBLE**。AgentSkin 在存在多个 page target（主窗口 + 弹出的对话窗/隐藏 overlay）时，若对所有 target 做兼容性探针，次要窗口缺主窗口 DOM 会误判为「DOM 不兼容」。CodeDrobe 把「无主窗口 DOM 的次要 target」降级为 skipped，与 applyTheme 的实际行为对齐。

3. ⭐⭐ **结构化错误（error.code + appId + port + results）**——AgentSkin 的错误处理可参考其「错误码 + 上下文字段」模式，便于上层按 code 分类处理。

4. ⭐⭐ **CdpSession 的 pending Map + 超时清理**——对标 AgentSkin 的 cdp-client.ts / session-pool.ts / cdp-reconnect.ts，`send` 的 per-request 超时 + close 统一 reject 是简洁可靠的生命周期管理。

---

### 2.3 ntoskrnl7/electron-cdp — CDP SDK 底座分层（对标 CDP 层收敛）

**定位**：`electron-cdp-utils`，简化 Electron CDP 使用的 TS 库。v0.4.9，MIT。

**关键源码发现**（目录树实测，仅 9 个源文件）：

```
src/
├── session.ts          # MainSession
├── executionContext.ts # 执行上下文跟踪
├── superJSON.browser.ts# SuperJSON 复杂类型序列化
├── electron.ts / global.ts / utils.ts / index.ts
```

**可借鉴点**：

1. ⭐⭐⭐ **单一职责的 SDK 分层**——session（连接/附着）与 executionContext（上下文跟踪）分离、SuperJSON 独立处理不可序列化对象。AgentSkin 的 `src/main/cdp/` 有 20+ 文件（cdp-client/session-pool/reconnect/targets/fanout/inspect-session/port-*…），**职责重叠且分散**，可参考此「session / executionContext / serialize / utils」的四段式收敛。

2. ⭐⭐ **执行上下文跟踪**——iframe/worker 附着后执行上下文会切换，AgentSkin 的注入在多 frame 场景可能命中错误上下文，可参考其 executionContext 跟踪。

---

### 2.4 oussamaexe/electron-debugger — MCP 化 AI 桥接（对标 DOM 探测）

**定位**：面向 AI 助手（MCP）的 Electron 调试服务器，15 个 MCP 工具（DOM 快照、元素样式、截图、点击/输入、React Fiber 树遍历、控制台日志、视觉回归）。v3.0.0，TS。

**可借鉴点**：

1. ⭐⭐ **React Fiber 树遍历**——从 DOM 节点反查 React 组件（fiber → type/memoizedProps），对 AgentSkin 理解 React 应用（doubao/codex 等）的 DOM 结构、生成稳定选择器有价值，可优化 dom-snapshot.ts。

2. ⭐⭐ **稳定选择器生成**——agent-engine-service 依赖 DOM 选择器定位注入锚点，可参考其「DOM 快照 → 生成唯一稳定 selector」策略，降低注入漂移。

---

### 2.5 tluyben/electron-inject — CDP REPL 注入机制（低价值参考）

**定位**：CDP 注入 REPL 范本（交互式执行 / 脚本文件 / REST API / 命令历史）。2025-03 后停更，仅作机制参考。

**可借鉴点**：⭐ **注入脚本的加载时机选择**（`Runtime.evaluate` vs `Page.addScriptToEvaluateOnNewDocument` 的适用场景）。AgentSkin 已内化此机制，价值有限。

---

## 三、与 AgentSkin 现状精确对标

| 维度 | 竞品最佳实践 | AgentSkin 现状 | 差距 |
|------|-------------|---------------|------|
| 适配器抽象 | dream-work-theme 数据声明式 + `kind` 分类 | ApplicationAdapter 接口 ~15 方法 | 接口偏重，无 kind 收敛 |
| token 契约 | theme.cssVariables[] 声明式 | 14-token 契约（C2）但清单未下沉到适配器 | 缺声明式 token 清单 |
| 注入等待 | CodeDrobe bootTimeout/settleTimeout 分阶段 | 固定超时 | 🔴 随机 CDP 注入超时 |
| 多 target 处理 | CodeDrobe markSecondaryTargets 降级 | 全量探针 | 🔴 CODEDROBE_DOM_INCOMPATIBLE |
| CDP 层 | electron-cdp 4 文件四段式 | src/main/cdp/ 20+ 文件 | 职责重叠分散 |
| 编排层 | CodeDrobe cli/runtime/theme/auth 分层 | agent-engine-service.ts 50KB | 🔴 God Object/SRP |
| 应用发现 | dream-work-theme 两级探测 + Appx PowerShell | app-discovery.ts 41KB | 可参考两级兜底 |

---

## 四、重大更新预警

| 项目 | 更新内容 | 影响 |
|------|---------|------|
| **dream-work-theme** | v1.2.6（08-26）新增 AutoClaw / MonkeyCode 主题支持 | 高——母舰级扩张，适配器抽象仍在演进，需持续跟踪其 app-registry 变化 |
| CodeDrobe/core | v0.7.0-beta（07-21）Codex avatar-overlay 排除 + per-window probe/verify | 中——per-window 探针与 markSecondaryTargets 思路一致 |

---

## 五、底层重构建议（优先级排序，均为「优化/重构」而非新增功能）

### P0 — 直接修复两个已知故障

**P0-1：注入分阶段等待（bootTimeout vs settleTimeout）**
- 对标：CodeDrobe/core `waitForCompatibility`
- 落地：在注入编排/兼容性探针处，用「root landmark 是否出现」区分启动预算与稳定预算
- 目标文件：`src/main/cdp/` 下探针逻辑 / `src/shared/injection/orchestrator/`
- 效果：修复「随机 CDP 注入超时」

**P0-2：次要 target 降级（markSecondaryTargets）**
- 对标：CodeDrobe/core `markSecondaryTargets`
- 落地：多 page target 场景，识别主 renderer（利用 `ApplicationAdapter.rendererHints()`），次要 target 标记 skipped
- 目标文件：`src/main/cdp/cdp-targets.ts` / `src/main/cdp/session-pool.ts`
- 效果：修复「CODEDROBE_DOM_INCOMPATIBLE」

### P1 — 架构债治理（重构）

**P1-1：agent-engine-service.ts God Object 拆分**
- 对标：CodeDrobe/core 的 cli/runtime/theme/auth 分层 + dream-work-theme 的 manager 分层
- 落地：按职责抽 `AgentEngineService` 的私有依赖组（discoveryDeps/schemeSyncDeps/wallpaperDeps/fanoutDeps/restoreFlowDeps/applyFlowDeps 已具备雏形），拆出独立模块
- 目标文件：`src/main/agent-engine-service.ts`（50KB → 拆成多个 <300 行模块）

**P1-2：CDP 层收敛**
- 对标：electron-cdp 的 session/executionContext/serialize 分层 + CodeDrobe 的 CdpSession
- 落地：梳理 src/main/cdp/ 20+ 文件，合并职责重叠的连接/session 相关文件
- 目标文件：`src/main/cdp/*`

### P2 — 声明式化（增强可维护性）

**P2-1：适配器 token 契约声明式化**
- 对标：dream-work-theme `theme.cssVariables[]`
- 落地：在 ApplicationAdapter 或引擎 profile 中声明每应用支持的 token 清单，供 C2 守卫脚本校验

**P2-2：应用发现两级兜底**
- 对标：dream-work-theme `discovery.ts` Appx PowerShell 探测
- 落地：app-discovery.ts 增加「传统路径枚举失败 → PowerShell 兜底」

---

## 六、落地方案（本轮执行）

按「先低风险高价值、后大重构」顺序，本轮落地以下项（详见执行后的验证结果）：

1. **P0-1 + P0-2**：注入分阶段等待 + 次要 target 降级（直接修复两个 🔴 故障）
2. **P1-2**：CDP 层职责收敛（降低后续重构复杂度）

> 落地细节与验证结果见本报告输出后的执行记录。
