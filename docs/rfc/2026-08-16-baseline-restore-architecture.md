# RFC：基准复刻导向注入架构（Baseline Restore Architecture）

> 状态：`待评审`
> 日期：2026-08-16
> 分支：`（待建）`
> 范围：`src/engine/src/runtime/`、`src/engine/src/runtime/profiles/`、`src/main/cdp/`、`engines/{traework,qoderwork,workbuddy,doubao,codex,zcode}/`
> 上游依据：`docs/reports/baseline-restore-audit-2026-08-16.md`

---

## 1. 背景与目标

当前注入引擎具备基本主题注入能力，但缺少**基准真值层**、**语义过滤层**与**基准复刻校验**。审计（9 子 Agent 流水线）确认 4 项真实缺陷（CV-01/03/04/05），并排除 3 项误判（侧边栏双层结构/输入框过度渲染/双架构并存均为有意设计）。

**核心诉求（来自用户）**：不强求像素级一致，但**尽量接近无限还原**；能真实体现主题包还原度。审计结论对应 P0 最高前置——「加载任何自定义主题前，引擎必须能先精确复刻该 Agent 的原生亮/暗主题」。

**目标**：

- 新增**基准真值层**：原生亮/暗主题计算样式快照 + 版本绑定 + 失效定义。
- 新增**语义过滤层**：`isNativeThemeControlled` 标记，只对主题受控节点渲染，杜绝过度渲染。
- 新增**复刻校验 Gate**：自定义主题注入前，回注基准 CSS → 采样对比 → 通过率 ≥95% 放行，否则降级。
- 修复 CV-01（doubao 全局文本继承）、CV-03（observer 排除集 + 条件 ensure）、CV-05（verify 样式值对比）。

**非目标**：

- 不追求像素级一致（允许色差 ≤2、透明度 ≤0.05）。
- 不穿透 closed Shadow Root（降级为仅对 Shadow Host 应用主题）。
- 不改造 CDP 协议层（`cdp/session.mjs` 无缺陷，不改）。
- 不新增适配器、不新增 UI 页面。
- 不改 `skin.mjs` 调度与 `update.mjs` 更新逻辑。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ 新增基准真值层（前置）+ 语义过滤层（内核对 CSS 匹配后处理）
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）→ 不涉及 manifest/14-token，仅扩充引擎 runtime 内部结构

> 裁决说明：本 RFC 涉及注入架构级改动，按 AGENTS.md §6 需 RFC 评审后方可合入。不突破六页封顶/六适配器上限，不修改 14-token 主题契约与 manifest schema。

---

## 3. 现状侦察（代码锚点）

### 3.1 已确认真实缺陷（静态锚点）

| 编号 | 文件:行 | 现状 | 状态 |
|------|---------|------|------|
| CV-01 | `engines/doubao/adapter.mjs:106-128` | 全局文本颜色暴力继承，覆盖 `--dbx-* / --semi-*` 全族，破坏子组件层级 | **未修复** |
| CV-03 | `renderer-payload.mjs:250` | MutationObserver 监听 `document.documentElement`，`{childList:true, subtree:true}`，无排除集 | **未修复** |
| CV-03 | `renderer-payload.mjs:251-254` | 5s `setInterval` 无条件 `ensure()`，DOM 无变化也执行 | **部分**（序3 已加 `disabled()` 短路，未做条件 ensure） |
| CV-04 | `selectivity-registry.mjs:22-26` | `SemanticSelectorEntry` 仅 `selectors/required/description`，缺 `semantic` 配置与 `isNativeThemeControlled` | **未修复** |
| CV-05 | `renderer-payload.mjs:325-355` | `buildVerifyExpression` 仅校验 `compatible/installed/stylePresent/themeMatches`，缺样式值对比 | **未修复** |

### 3.2 §8 已落地件（序 2-6，MAIN 侧）

| 件 | 文件 | 职责 | 状态 |
|----|------|------|------|
| baseline 采集 | `src/main/cdp/baseline-css-capture.ts` | CSS 规则原文采集（rule 级，origin 过滤 + var 依赖递归） | ✅ 已实现+测试 |
| baseline 回注 | `src/main/cdp/baseline-css-replay.ts` | 精确回注入 adoptedStyleSheets + 撤销 + 截图 | ✅ 已实现+测试 |
| baseline 校验 | `src/main/cdp/baseline-validator.ts` | `assessFidelity` 三硬门控 + `validateBaselineCss` 编排降级 | ✅ 已实现+测试 |

### 3.3 其他已落地（序 2-3）

- `engines/*/tokens.css`：移除 `color-scheme: dark !important`，解除亮色锁定。
- `renderer-payload.mjs:212-215,246,252`：自愈循环增加 `sessionStorage.__agentskin_disabled__` 禁用短路。

---

## 4. 设计方案

### 4.1 五层架构（对齐审计 §2.1）

```
⑤ 整合调度层 skin.mjs → applySkin/restoreSkin（7 步固定顺序）
④ 独特模板层 runtime/profiles/{agent}-theme-v1.mjs（每 Agent 语义配置 isNativeThemeControlled）
③ 内核层 renderer-payload / injector / selectivity-registry（语义过滤 + observer 排除集）
② 增强探针层 baseline-snapshot.mjs（新增）+ dom-snapshot.mjs（扩展 semanticNodes）
① 基准真值层 baseline ground truth（原生亮/暗快照 · 版本绑定 · 复刻校验 gate）
```

依赖方向严格单向：⑤→④→③→②→①。

### 4.2 基准真值层（新增，最高前置）

- **数据结构**：`BaselineSnapshot`（schemaVersion/appId/appVersion/themeMode/route/viewport/nodes[{selector,tag,depth,rect,styles,customProperties}]/rootCustomProperties）。
- **采集时机**：首次检测到目标窗口（亮+暗两套）；用户切原生主题；`appVersion` 变更；引擎 schemaVersion 升级。路由变化不重采。
- **生命周期**：`fresh(≤30min) → stale(≤24h) → expired(>24h)`；失效条件 = `{appId,appVersion,themeMode}` 三元组不匹配 ∨ 超 24h ∨ 用户重置 ∨ schema 升级。
- **复刻校验 Gate**：注入复刻 CSS（仅用快照选择器+色值）→ 逐节点对比 `|Δ色|≤2`、`|Δ透明度|≤0.05` → 通过率 ≥95% 放行，否则降级禁止加载自定义主题。
- **与 §8 复用**：`baseline-css-capture/replay/validator` 提供该层的 CDP 原语；引擎 runtime 侧新增 `baseline-snapshot.mjs` 生成采集脚本 + 维护真值缓存。

### 4.3 语义过滤层（CV-04 根因修复）

- **过滤规则**：CSS 选择器匹配后 → 查 `isNativeThemeControlled` → `true` 应用主题色值；`false` 跳过保留原生。
- **实现方式**：为 `false` 节点加 `agentskin-non-controlled` class；CSS 选择器附加 `:not(.agentskin-non-controlled)` 排除。
- **isNativeThemeControlled 判定优先级**（审计 §2.3）：显式标记 > 背景色差法(>30) > 文本色差法(>30) > CSS变量关联法 > 标签+角色启发法。
- **注册表扩展示例**（对齐审计 §2.5）：`SemanticSelectorEntry` 增 `semantic:{controlled,controllingSelector,...,nonControlled:[]}`。

### 4.4 内核自愈修正（CV-03）

- **observer 排除集**：
  ```javascript
  excludeSelectors: [
    '[data-agentskin-baseline]',
    '#agentskin-{id}-skin-chrome',
    '.agentskin-non-controlled',
    '[aria-hidden="true"]',
  ]
  ```
- **条件 ensure**：5s interval 仅在 `!document.getElementById(styleId)` 时重注，消除无条件回注。

### 4.5 verify 样式值对比（CV-05）

- `buildVerifyExpression` 增加「关键受控节点样式采样」：对 `root` 背景/文字色 + 每 `isNativeThemeControlled=true` 语义节点做 computed 采样，与生效主题期望值比对，纳入 `result.pass`（对齐审计 D3/D6）。

### 4.6 调度：7 步固定流程（对齐审计 §2.6）

| Step | 名称 | 输出 |
|------|------|------|
| 1 | 目标窗口就绪检测 | `targets[]` |
| 2 | 探针采集基线（缓存→未命中→双 scheme→semanticNodes） | `ProbeResult` |
| 3 | 复刻校验 Gate | pass/fail |
| 4 | 识别 Agent（root 必须 isNativeThemeControlled） | adapter+兼容性 |
| 5 | 语义过滤渲染（非受控加 class → CSS `:not()` 排除 → 注入） | 注入结果 |
| 6 | 轻探针校验（含样式值对比） | verify 结果 |
| 7 | 版本变更重采基线（失效→重走 2-6） | — |

顺序约束：Step 2→3→5 不可颠倒。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | S1 基准快照采集失败（全杀） | **致命** | QoderWork ephemeral port / DevToolsActivePort 时序 | 缺失禁止加载闸；单 scheme 宽容降级 | 采集错误字段 + 时序探针 |
| 2 | S3 JS 运行时修改原生样式 | **致命** | Agent 非 CSS 动态算样式 | CSS 变量桥接层（P2）+ 语义过滤双模式 | verify 样式对比 |
| 3 | S9 快速切换主题竞态 | **致命** | observer/debounce/闭包交互 | `ownerId` 版本守卫 + Promise 链串行化 | 并发 apply 返回 `skipped-concurrent` |
| 4 | S5 版本更新基准失效 | 高 | codex 等 hash 类名更新频繁 | 双轨 preflight+fallback；版本范围 manifest | Step7 版本监听重采 |
| 5 | S10 语义过滤误判 | 高 | 新抽象固有 | CSS 变量引用检测(80%+准确率)；per-Agent controlledManifest | 增量 controlled 检测 + 人工复核 |
| 6 | muted Shadow DOM | 中 | closed shadow root | 仅 Shadow Host 应用 | 探针标注无法穿透节点 |

---

## 6. 分批落地计划

> 已落地块（§8 序2-6）不重复计；以下为剩余增量，按风险/收益排序。每批独立评审、独立合入。

| 批次 | 内容 | 对应缺陷 | 预估改动 | 验证 |
|------|------|----------|----------|------|
| **批 A（P0）** | `isNativeThemeControlled` 标记 + 语义过滤层（registry 扩展 + `:not()` 排除 + `agentskin-non-controlled`） | CV-04 | engine runtime + profiles | runtime/registry 单测 |
| **批 B（P0）** | 基准真值层引擎落地：`baseline-snapshot.mjs` + 真值缓存 + 失效定义（复用 §8 main 侧原语） | S1/审计 §2.2 | 新增 engine 模块 | baseline-snapshot 单测 |
| **批 C（P0）** | 复刻校验 Gate 接入 apply 前置（Step3）+ 缺失禁止加载闸 | S1 | 编排层 | main 编排单测 |
| **批 D（P1）** | observer 排除集 + 条件 ensure + verify 样式值对比 | CV-03/CV-05 | renderer-payload.mjs | payload 单测 |
| **批 E（P1）** | doubao 全局文本继承修正（限定语义域，取消全族暴力继承） | CV-01 | engines/doubao/adapter.mjs | doubao 回归单测 |
| **批 F（P1）** | 竞态 ownerId 守卫 + 双轨 preflight/fallback | S9/S5 | 编排层 | 并发单测 |
| **批 G（P2）** | CSS 变量桥接层 + zcode 选择器域限定 + CDP Session 复用 | S3/CV-06,07,08 | engine + adapter | 集成单测 |
| **批 H（P3）** | 全量 6 Agent 亮/暗基准复刻 + 自定义主题 + 版本变更验证 | 全部 | 测试 | `npm run check` |

每批独立评审、独立合入，避免单次大爆炸。

---

## 7. 人工复核项

以下为静态无法判定、需实际运行确认的业务假设（对齐审计 §六 MAN）:

1. 6 个 Agent 的 root 挂载策略（`:root` vs `body .monaco-workbench`）的 cascade 实际优先级。
2. `adoptedStyleSheets` vs `<style>` 标签的层叠竞争（数组顺序/DOM 位置）。
3. `color-mix(in srgb,...)` 在老旧 Electron/Chromium 的回退行为（MAN-03）。
4. `data-agentskin-punched` 通用 punch-through 是否误伤聊天内容区白色卡片/弹窗（MAN-04）。
5. `sessionStorage.__agentskin_disabled__` 在 navigate/reload 的持久化边界（MAN-05）。
6. WorkBuddy 13 个 CDP target 是否每个都需注入（部分可能为隐藏 webview/service worker）。

---

## 8. 评审结论

（待评审人填写）