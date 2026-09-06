# RFC：多 renderer 目标编排与统一背景（Multi-renderer Target Orchestration & Unified Background）

> 状态：`待评审`
> 日期：2026-08-18
> 分支：`（待建）`
> 范围：`src/main/cdp/{cdp-targets.ts,cdp-fanout.ts}`、`src/main/wallpaper/{target-discovery.ts,wallpaper-injector.ts}`、`src/engine/src/runtime/{injector.mjs}`、`src/engine/src/adapters/*.mjs`、`src/legacy/agentskin-core-runtime.ts`、`src/shared/injection-constants.ts`
> 上游依据：竞品 dream-work-theme（xxxhh336）分析——其 `rendererHints` 按语义序号定位正确 renderer、多 Tab「虚拟整窗背景」两处与其目标应用高度重叠的可借鉴点（AgentSkin 主线 A2 多 renderer 定位 + 统一背景）

---

## 1. 背景与目标

AgentSkin 当前存在**三套 CDP 目标发现口径**，对「哪些是最该注入的 renderer」没有一个统一的、可由适配器语义锚点决定的权威判定：

| # | 场景 | 目标发现 | 主 renderer 判定 | 缺陷 |
|---|------|----------|------------------|------|
| S1 | 主题注入（core `applyTheme`） | `findTargets` → `matchTarget` 过滤 | 无「主/次」区分，所有兼容 target 都 preflight/注入 | 多 page 时后台页/boot 页与可见主窗口被同等对待 |
| S2 | hardening fan-out | `findDomTargets` **无 matchTarget 过滤** | `firstSession` = 第一个成功的 page | 可能把 devtools/非兼容 page 也算进目标，主 renderer 判定依赖列表顺序 |
| S3 | 壁纸注入 | `resolvePageTargets` → `findAgentTargets`（matchTarget） | `resolvePageTarget` 优先 `type:page`，否则第一个 | 壁纸落在「主窗口」还是「后台页」不确定，且无共享背景机制 |

竞品 dream-work-theme 给出两个成熟可借鉴点，正好是这两个症结的解：

1. **`rendererHints` 按语义序号定位正确 renderer**：适配器可声明「主 renderer 是第几个/哪个 URL 形态的 page」，从而在多个兼容 page target 间稳定选出主窗口，杜绝「注入到后台 boot 页而可见窗口裸露」的偶发（AgentSkin 已多次踩坑，见 memory：codex avatar-overlay、doubao 多 page、WorkBuddy 多 target）。
2. **多 webview「虚拟整窗背景」**：当应用把界面拆成多个独立 webview/iframe（vscode-work 系），背景需在 `html::before` 上共享同一「虚拟整窗坐标」才连续——这正对应 AgentSkin 壁纸注入在多 webview 下背景不连续的缺口。

**目标**：

- 引入**适配器级 `rendererHints`**：让「主 renderer」的判定从「第一个 page 的偶然」变成「适配器语义锚点」。
- 统一 S1/S2/S3 三处目标发现口径：全部以「适配器 matchTarget 确认兼容 + rendererHints 定主次」为前提，hardening 不再无差别遍历全部 DOM target。
- 为支持多 webview 背景连续，引入**统一背景协调器**：为同 port 上匹配到的多个渲染表面共享一份「整窗背景」，而非各自独立注入导致接缝/错位。

**非目标**：

- 不新增适配器 / 不新增 UI 页面 / 不改 manifest 与 14-token 契约。
- 不改变 6 agent 各自的视觉输出，仅做「目标选择口径」与「背景共享机制」的收敛。
- 不做像素级还原，不动缺陷修正规则内容。
- **不为 6 个现有适配器逐个手写新 CSS**（A2 定位只管目标选择，不引入 DWT 那种手工 build*Css 适配范式）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ **是**。本次统一三处 CDP 目标发现口径、引入 rendererHints 主次判定、新增统一背景协调器，均属注入流程架构级改动。AGENTS.md 黄金规则 #4：注入架构重构需 RFC 评审。现状三套口径分散（S1/S2/S3）是由多次增量修补累积的结构性不一致，非必要即潜藏缺陷，本次为必要的收敛。
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

> 裁决：提交评审后实施。命中 §6 首项，必须走 RFC 且经评审通过后方可执行；不突破六页封顶 / 六适配器上限。

---

## 3. 现状侦察（代码锚点）

### 3.1 三套目标发现口径并存

| 维度 | core 主题注入（S1） | hardening fan-out（S2） | 壁纸注入（S3） |
|------|--------------------|--------------------------|----------------|
| 入口 | [injector.mjs `findTargets`](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/runtime/injector.mjs#L136-L139)（`targets.filter(t => adapter.matchTarget(t))`） | [cdp-fanout.ts `hardeningPass`](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L238)（`findDomTargets(port)`，page/webview/iframe 全部） | [target-discovery.ts `resolvePageTargets`](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/target-discovery.ts#L110-L124)（`findAgentTargets` → `filterForCdpConnectivity`） |
| matchTarget 过滤 | ✅ 是 | ❌ 否 | ✅ 是 |
| 主 renderer 判定 | 无主次，全注入 | `firstSession`（第一个成功 page，[L350](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L350)） | `resolvePageTarget` 优先 `type:'page'` 否则第一个（[target-discovery.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/target-discovery.ts#L61-L93)） |
| 定位自身判定 | `pickPageTarget`（[cdp-targets.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-targets.ts#L108-L122)） | `primaryPage` = `domTargets.find(t => t.type==='page')`（[L432](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/cdp-fanout.ts#L432)） | — |

### 3.2 适配器契约现状

- [types/index.d.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/types/index.d.ts#L119)：`matchTarget(target: CdpTarget): boolean` 为**唯一**目标筛选契约，无「主/次/URL 形态序号」概念。
- 各适配器 `matchTarget`（codex/工作 joyce 多 page、doubao 多 page）均基于 `type/title/url` 正则判断是否本应用，不表达「哪个是可见主窗口」。

### 3.3 背景注入现状（无共享机制）

- 壁纸逐 target 调用 [injectImageWallpaper/video/web](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/wallpaper/image-injector.ts) 各自 `position:fixed;inset:0` 铺满自身 viewport。
- 多 webview（vscode-work 系把编辑器/树/面板拆成独立 webContents）时各 viewport 彼此独立，背景在接缝处可能错位/不连续；尚无「多表面共享同一整窗背景坐标」的机制。

### 3.4 竞品参考（来源：GitHub /app-registry

- `rendererHints: I(--app.renderer)[] | (target)=>number`——按语义序号/URL 形态标记 renderer 优先级，注入时按该序号稳定选主 renderer。
- 多 Tab 场景用 `html::before` 上承载「整窗背景」+ 位移偏移，使多个 tab 共享同一背景坐标系，视觉连续。

---

## 4. 设计方案

### 4.1 `rendererHints`：适配器级主 renderer 语义锚点

在 `AppAdapter` 增加可选字段，用于在多个兼容 `page` target 中判定主 renderer：

```ts
/** 选主 renderer 的语义锚点（可选）。缺省时保持现状（第一个 page target）。 */
rendererHints?: {
  /** 按序尝试的 URL 形态匹配（含 URL 片段、query 标记）。首个命中即为主 renderer。 */
  preferredUrlPatterns?: string[];
  /** 主 renderer 判定回调：返回正值表示该 target 为主 renderer 的优先级（越高越优先）。 */
  score?: (target: CdpTarget) => number;
  /** 明确判为「次 renderer」（后台页/boot/浮层），不参与主窗口注入。 */
  secondaryPatterns?: string[];
};
```

实现（新增 `src/main/cdp/renderer-rank.ts`，被三处复用）：

```ts
export interface RendererHint {
  rank: number;        // 0 = 主 renderer；>0 = 次，不参与主窗口注入
  matchedPattern?: string;
}
export function rankRenderer(hints, target): RendererHint { ... }
export function pickPrimaryRenderer(hints, targets): CdpTarget | undefined { ... }
```

**采集锚点**：渲染侧 payload 已在 `renderer-payload.mjs` 注入 `window.__AGENTSKIN__`（含 hosts），可在主 renderer 上辅以语义 DOM 探针（`buildProbeExpression` 的 `rootAny`），但本 RFC 的 rendererHints 以**CDP target 元数据（url/title/type）为准**，不依赖运行时 DOM，避免脏读。

### 4.2 统一三处目标发现口径

新增 `resolveAgentRenderers(appId, port)`（基于 `findAgentTargets` 的 matchTarget 结果 + rendererHints），返回 `{ primary, secondaries }`，三处共用：

- **S1 core**：`applyTheme` 仍用 `findTargets`（matchTarget 全兼容集），但按 rendererHints 把 primary 优先注入并做 DOM health check，secondaries 按序兜底。
- **S2 hardening**：`hardeningPass` 从 `findDomTargets` 改为「matchTarget 兼容集 + rendererHints 排序」——非兼容 page 不再被注入；`firstSession` 由 `pickPrimaryRenderer` 决定而非列表顺序。
- **S3 壁纸**：`resolvePageTarget` 用 rendererHints 选主；`resolvePageTargets` 保留全量（壁纸仍铺所有表面），但主窗口成败决定整体 `ok`（维持 CDP-5 primary-target-wins 语义）。

### 4.3 统一背景协调器（multi-surface 共享整窗背景）

背景只需要在「主坐标系」上铺一次，其余表面通过分享同一背景容器定位来对齐。方案：

- 新增 `wallpaper/unified-background.ts`：维护 per-port/per-agent 的「整窗背景状态」，首次在主 renderer 上注入容器（`WALLPAPER_CONTAINER_ID` 全视口定位）；对每个 secondary 表面注入一段 `html::before` 说明该表面相对主窗口的偏移（复用 dream-work-theme 的多 tab 偏移思路），背景本体不重复铺。
- 依赖注入沿用 [WallpaperInjectorDeps](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/injector-types.ts#L152-L161) 的 `findAgentTargets`/`resolvePageTargets` 已暴露的能力；冲突风险极低，因壁纸容器 ID（`WALLPAPER_CONTAINER_ID`）在当前架构已是唯一。
- 保持「壁纸整体成败由 primary 决定」（CDP-5）不变。

边界条件：

- 单 renderer 应用不进入共享路径（行为退化为现状）。
- `filterForCdpConnectivity` 对 iframe/webview loopback 目标的过滤继续生效，避免对不可连接目标误注入。

### 4.4 数据流

```
apply/restore → resolveAgentRenderers(appId,port)
                     ├─ primary   ← rendererHints 语义锚点（优先）
                     └─ secondaries ← 兼容但非主（boot/后台/浮层）
applyTheme(inject primary+secondaries)   [S1]
hardeningPass(verify primary, inject watchdog起补) [S2]
wallpaper(primary 决定成败，全表面共享统一背景)         [S3]
```

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | rendererHints 判定错了主 renderer | 中 | 适配器 URL 形态变化/新形态未列 | hints 为增量：未命中任何 pattern 时回退「第一个 page」现状；hints 只做排序不打乱 matchTarget 兼容集 | 单测覆盖 hints 未命中回退路径 |
| R2 | 统一口径后 hardening 不再遍历 non-compatible page，导致某表面漏注入 | 中 | 某应用存在 matchTarget 漏网的真实可见 page | matchTarget 是 S1 已用且 proven 的兼容契约；统一到同一集不会比当前更差，且 rendererHints 覆盖面回归由 live 测试兜底 | `npm run check` + `live-apply-all.manual.test.ts` |
| R3 | 统一背景在多 webview 偏移计算错误 → 背景错位 | 中 | vscode-work 系 webview 布局复杂 | 仅对「主坐标系」注入一次背景，secondary 只做偏移声明，本体不重复铺；偏移失败时回退为各自独立注入（与现状一致） | 视觉手动验证 + focused 壁纸注入单测 |
| R4 | rendererHints/scoring 增加适配器契约 → 类型/校验脚本不兼容 | 低 | 类型未同步 | rendererHints 为可选字段，缺省零行为变更；`check-architecture-boundaries`、`check-store-contracts` 不受影响（不触碰 Store） | `npm run check` |

---

## 6. 分批落地计划

| 批次 | 内容 | 改动范围 | 验证 |
|------|------|----------|------|
| P0 | `rendererHints` 契约 + `renderer-rank.ts`（rank/pickPrimary）+ 单测 | `src/engine/types`、`src/main/cdp/renderer-rank.ts` | 单测；缺省回退路径 |
| P1 | 统一三处口径：resolveAgentRenderers 接入 S1（core）/S3（壁纸主判） | `injector.mjs`、`wallpaper/target-discovery.ts`、`resolvePageTarget`/`resolvePageTargets` | 现有壁纸/target 单测回归 |
| P2 | hardening 改用统一口径 + rendererHints 定 firstSession | `cdp-fanout.ts`、`cdp-targets.ts` | `cdp-fanout.test.ts`、`wallpaper-primary-wins.test.ts` 回归 |
| P3 | 统一背景协调器 + secondary 偏移注入 | `wallpaper/unified-background.ts`、`image/video/web-injector` | 新增 focused 单测 + live 视觉验证 |
| P4 | 6 适配器按需补 rendererHints（仅确有多个兼容 page 的：codex/doubao/workbuddy 优先） | `src/engine/src/adapters/*.mjs` | `npm run check` 全绿 |

---

## 7. 人工复核项

- 需要确认：codex / doubao / workbuddy 的确切多 page URL 形态（codex avatar-overlay、doubao boot 页）是否能在**不依赖运行时 DOM**的前提下由 url/title 可靠区分主次？若不能，rendererHints 的 `score` 是否需引入极轻量的语义探针？——需实际启动应用观察 /json/list 输出确认，静态判不了。
- 需确认：混合多 webview（traework/qoderwork 的 vscode-work 布局）中「统一背景」的偏移是否可仅用 CDP target 的 URL/标题推断，还是必须注入后读 `getBoundingClientRect` 换算——倾向后者（以注入后的实际矩形为准），需人工放行。

---

## 8. 评审结论

（评审意见汇总，由评审人填写）