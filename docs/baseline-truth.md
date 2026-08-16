# 原生基准真值 Baseline Truth（P0 · 阶段一）

> 关联：`docs/rfc/2026-08-16-cdp-injection-performance.md` 批 6 模板引擎审计改造
> 日期：2026-08-16
> 状态：`待人工核对`（本文档为静态源码分析输出，逐项需人工打开各 Agent 复核，见 §7）
> 依据：`src/engine/src/adapters/*.mjs`、`engines/*/tokens.css`、`src/engine/src/runtime/profiles/*.mjs`

---

## 1. 目的与验收锚点

本表是模板引擎"基准真值层"的输入。目标：**自定义主题加载前，引擎必须能完整复刻每个 Agent 的原生亮主题与原生暗主题**，复刻还原度即主题包还原度的上限。

**高还原度达成线**（据此验收 P0）：

1. 载体定位正确：每个核心组件明确"外层 as 载体 / 内层 as 非受控"，0 颠倒。
2. 主要色对齐：背景/文字/边框三色组与原生快照色差 ΔE ≤ 3（非透明场景）。
3. 嵌套组件零误染：内部子控件 computedStyle 与未注入时一致。
4. 亮→暗切换：两套基准复刻后可动态切换，组件表现逻辑对齐原生。

**极限还原方向**：放弃 computedStyle 近似，改走 **CSS 规则级捕获 + 精确回注**（见 §6），ΔE 理论逼近 0。

---

## 2. 原生亮/暗主题载体真值（静态锚点）

> 载体 = 原生主题生效的 DOM 节点组。以下来自 adapter 元数据与 tokens.css 静态提炼，`可信度` 标注是否已由真实应用核对。

| Agent | 原生亮主题载体 | 原生暗主题载体 | 嵌套组件样式载体 | 主题注入宿主 | 可信度 |
|-------|---------------|---------------|-----------------|-------------|--------|
| traework  | `html[data-theme="light"]`、`:root` 原生 `--vscode-*` token | `html[data-theme="dark"]`、`:root` 原生 `--vscode-*` token | 输入框外层容器、侧边栏外层 div | `html.agentskin-host-traework body` + `.monaco-workbench` | 静态 |
| qoderwork | `[data-color-scheme="light"]`、根节点 | `[data-color-scheme="dark"]`、根节点 | 输入框外层、侧边栏外层 div | `html.agentskin-host-qoderwork` | 静态 |
| workbuddy | `--wb-theme: light`、根 CSS 变量 | `--wb-theme: dark`、根 CSS 变量 | 输入框外层、侧边栏外层 div | `html.agentskin-host-workbuddy` | 静态 |
| doubao    | `--dbx-theme: light`、根 CSS 变量（Semi：`--semi-color-*`） | `--dbx-theme: dark`、根 CSS 变量（Semi：`--semi-color-*`） | 输入框外层、侧边栏外层 div，4 处后代通配符 `*` | `html.agentskin-host-doubao:root` | 静态 |
| codex     | `:root[data-appearance="light"]` | `:root[data-appearance="dark"]` | 输入框外层、侧边栏外层 div | `<style id="agentskin-theme-style-codex">`（非 adoptedStyleSheets） | 静态 |
| zcode     | `body.theme-light` | `body.theme-dark` | 输入框外层、侧边栏外层 div | `html.agentskin-host-zcode` | 静态 |

### 2.1 关键载体验证选择器（adapter `verification.*`）

| Agent | 根 landmark（阻塞校验） | 侧边栏 | 工作区 | 输入框 |
|-------|------------------------|--------|--------|--------|
| traework  | `#root .panel-container` / `.solo-lite-layout` / `#root` | `.task-list-base` / `.task-list-panel` | `.panel-container` / `.solo-lite-layout` | `.chat-input-v2-input-box-editable[contenteditable='true']` |
| qoderwork | `#root .agents-layout-root` / `.agents-layout-root` / `#root` | `.agents-sidebar` / `[data-resizable-sidebar]` | `.agents-content-area` / `.agents-layout-body` | `.chat-input-editor-text[contenteditable='true']` |
| workbuddy | `#root > .teams-container` / `.teams-container` / `#root` | `.conversation-sidebar` / `.conversation-list` | `.teams-main-content` / `.main-content` | `[role='textbox'][contenteditable='true']` / `.wb-home-composer [contenteditable='true']` |
| doubao    | `#root` / `body` | （暂无推荐 landmark） | （暂无推荐 landmark） | （暂无推荐 landmark） |
| codex     | `main.main-surface` / `main[class*='MainContentSurface']` / `main` | `aside.app-shell-left-panel` | `main`（见根 landmark） | `.composer-surface-chrome` |
| zcode     | `#root` / `body` | `[class*='sidebar']` / `aside` | `[class*='chat']` | `[contenteditable='true']` / `textarea` |

> 注：doubao 目前 adapter 仅声明 `rootAny`，无组件级 landmark，需在 P0 阶段人工补齐（§7）。

---

## 3. 三色组（背景 / 文字 / 边框）→ 原生 token 映射

以下为各 Agent 原生 token 体系中"背景 / 文字 / 边框"三色组的**典型受控 token**，供基准复刻与自定义主题映射共用。`agentskin-*` 为引擎侧注入 token。

### 3.1 traework（VS Code token 体系）

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | `--vscode-editor-background`、`--vscode-icube-colorBg1/2/3`、`--vscode-sideBar-background` | `--agentskin-bg` / `--agentskin-surface` / `--agentskin-surface-elevated` |
| 文字 | `--vscode-foreground`、`--vscode-icube-colorDefaultText` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | `--vscode-icube-colorLine1/2`、`--vscode-icube--border-border-neutral-l1` | `--agentskin-border` / `--agentskin-accent` 混合 |
| 强调 | `--vscode-textLink-foreground`、`--vscode-button-background` | `--agentskin-accent` / `--agentskin-secondary` |

**宿主**：`html.agentskin-host-traework body`（主 token）+ `.monaco-workbench`（侧栏/面板/活动栏 re-declare）。

### 3.2 qoderwork

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | 根 `--bg-*` / `--surface-*` | `--agentskin-bg` / `--agentskin-surface` |
| 文字 | 根 `--text-*` / `--fg-*` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | 根 `--border-*` / `--line-*` | `--agentskin-border` |
| 强调 | 根 `--accent-*` / `--brand-*` | `--agentskin-accent` |

> 具体 token 名需在 P0 人工核对（见 §7）。

### 3.3 workbuddy

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | 根 `--wb-bg-*` / `--surface-*` | `--agentskin-bg` / `--agentskin-surface` |
| 文字 | 根 `--wb-text-*` / `--fg-*` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | 根 `--wb-border-*` / `--line-*` | `--agentskin-border` |
| 强调 | 根 `--wb-accent-*` / `--brand-*` | `--agentskin-accent` |

### 3.4 doubao（Semi Design token 体系，实际驱动 UI）

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | `--semi-color-bg-0/1/2/3/4`、`--s-color-bg-*` | `--agentskin-bg` / `--agentskin-surface` / `--agentskin-surface-elevated` |
| 文字 | `--semi-color-text-0/1/2/3`、`--s-color-text-*` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | `--semi-color-border`、`--s-color-border-*` | `--agentskin-border` |
| 强调 | `--semi-color-primary`、`--s-color-brand-primary-*` | `--agentskin-accent` / `--agentskin-secondary` |

> 依据 tokens.css 注释：Doubao 实际驱动 UI 的是 268 个 `--semi-*` token + 64 语义变量，`--dbx-*/--s-color-*/--ffc-*` 多为 legacy 但保留兜底。

### 3.5 codex

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | `--app-surface-*` / `--fill-*` | `--agentskin-bg` / `--agentskin-surface` |
| 文字 | `--text-*` / `--fg-*` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | `--border-*` / `--line-*` | `--agentskin-border` |
| 强调 | `--accent-*` / `--brand-*` | `--agentskin-accent` |

> codex 通过 `<style id="agentskin-theme-style-codex">` 注入，不走 adoptedStyleSheets；验证需专用探针（已实现于批 6）。

### 3.6 zcode

| 语义 | 原生 token（受控） | 引擎映射 |
|------|-------------------|----------|
| 背景 | 根 `--bg-*` / `--surface-*` | `--agentskin-bg` / `--agentskin-surface` |
| 文字 | 根 `--text-*` / `--fg-*` | `--agentskin-text` / `--agentskin-muted` |
| 边框 | 根 `--border-*` / `--line-*` | `--agentskin-border` |
| 强调 | 根 `--accent-*` / `--brand-*` | `--agentskin-accent` |

---

## 4. 组件语义（受控 vs 非受控）—— 嵌套组件内外层

> 目标：解决"本该渲染外层却渲染内层 / 反之亦然"的双层 div 模式冲突。**只渲染标记为 `isNativeThemeControlled=true` 的载体节点**，内部子控件一律跳过。

| 组件 | 原生主题载体（受控） | 内部子控件（非受控，禁止额外渲染） |
|------|---------------------|----------------------------------|
| 输入框 | 外层容器（承载背景/边框/圆角） | 文本子节点、按钮、光标、占位符、`[contenteditable]` 内层 |
| 侧边栏（双层 div） | 原生亮/暗下背景、圆角实际挂载的**那一层**（需 baselineSnapshot 判定） | 另一层 div、列表项、图标 |
| 聊天区 | 外层容器（承载背景） | 消息气泡、代码块、markdown 子节点 |

> ⚠️ 双层侧边栏"外层 or 内层"必须在 baselineSnapshot 采集后由 `computedStyle` 判定（原生亮/暗下背景/圆角挂在哪层就渲染哪层），静态无法定论——见 §7 人工复核。

### 4.1 doubao 特化风险

`doubao` 被指存在 4 处后代通配符 `*` 强制渲染子节点，导致内部子控件被误清样式。落地时：
- 语义过滤层必须将输入框/侧边栏内部子节点标记为非受控并跳过；
- 通配符 `*` 命中范围收敛为"受控载体的直接子代"或全部移除。

---

## 5. 现存渲染故障锚点（对照审计报告）

| 故障 | 涉及 Agent | 代码锚点 | 处理归属 |
|------|-----------|----------|----------|
| 过度渲染 | 全部 | `adapters.mjs` 无差别遍历 DOM | P2 语义过滤层 |
| 嵌套组件错染 | doubao/workbuddy/codex/zcode | 输入框/侧边栏内外层颠倒 | P0 本表 §4 + P2 |
| 配色冲突 | 全部 | 自定义主题直接叠加原生样式无基准对照 | P0 基准真值 + P3 映射 |
| `color-scheme: dark !important` | 全部 6 个 tokens.css | `engines/*/tokens.css` 首行 | P0 修复（动态切换） |
| 自愈循环对抗用户撤销 | doubao 等 | renderer-payload / doubao adapter | P0 加 sessionStorage 禁用检查 |

---

## 6. 极限还原策略：CSS 规则级捕获 + 精确回注

**原则**：不复刻 computedStyle（丢失 var()/calc()/渐变/媒体查询上下文），改为通过 CDP 捕获定义原生主题的**原始 CSS 规则文本**，复刻时精确回注。

采集：
1. `CSS.getStyleSheetText(styleSheetId)` 获取样式表原文；
2. `CSS.getMatchedStylesForNode(nodeId)` 定位核心组件受控节点的匹配规则；
3. 递归解析 var() 引用链，捕获变量定义；
4. 按 `origin==='regular'` 过滤第三方库，仅留存 Agent 自带样式；
5. 采集前 `Debugger.setJavaScriptEnabled(false)` 暂停 JS，防动态篡改。

复刻：
1. 构造 `CSSStyleSheet`，`replaceSync(capturedText)`；
2. `document.adoptedStyleSheets` 注入；
3. 亮/暗切换 = 替换 styleSheet 内容。

**还原度预期**：核心规则 ΔE≈0；唯一不可还原项为系统字体渲染差异与 Houdini paint worklet（极少）。

**回滚语义**：复刻基准失败 → 禁止加载自定义主题，触发降级（回退 landmark 级快照或直接禁用）。

---

## 7. 人工复核项（P0 后续必做）

下列项静态代码无法判定，需打开各 Agent DevTools Elements / Computed 面板逐项核对，核对后回填本表：

1. **每个 Agent 原生亮/暗主题实际视觉效果** 是否与 §2 表一致（尤其 doubao、zcode 的组件 landmark 需补齐）。
2. **双层侧边栏背景/圆角实际挂载层**（外层 or 内层）——用 `computedStyle` 在原生亮/暗两态下实测。
3. **输入框内部控件**清单（按钮/光标/占位/`contenteditable` 内层）逐项确认非受控。
4. **三色组 token 名**（qoderwork/workbuddy/codex/zcode 的 `--bg-*`/`--text-*`/`--border-*` 具体名）需在真实 computedStyle 中反查确认。
5. **基准快照采集性能开销**：在低配设备实测超时（现设 5s 降级阈值）。
6. **版本更新后 DOM 变化范围**：跟踪各 Agent 更新日志，评估旧基准失效节奏。

---

## 8. 落地次序（P0 阶段）

| 序 | 事项 | 产出 |
|----|------|------|
| 1 | 本表人工核对（§7） | `baseline-truth.md` 回填为已验证 |
| 2 | 修复 `color-scheme` 强制暗问题 | 6 个 `tokens.css` 支持动态切换 |
| 3 | 自愈循环加 sessionStorage 禁用检查 | renderer-payload / doubao adapter |
| 4 | 新增 `baseline-css-capture.ts`（规则级采集） | CDP 采集 demo，验证 6 Agent 可行性 |
| 5 | 新增 `baseline-css-replay.ts`（精确回注） | 回注后截图与原生对比验收 |