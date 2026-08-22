# 过度渲染诊断报告（2026-08-23）

> 目的：定位 AgentSkin 注入引擎在 6 个 agent 上普遍出现的「过度渲染」根因，
> 并给出基于真实 DOM（CDP 探针实证）的修复方案。
> 背景：用户希望把 `~/.agnes/codex-themes-downloaded` 的 Codex 主题包移植进项目，
> 但先决条件是修复注入引擎自身的过度渲染问题。

## 1. 问题现象

用户描述：侧边栏**外层容器**渲染是正确的（样式本来就该渲染容器），但容器
**内部的块 / div 也被渲染了**，视觉突兀。该问题在多个 agent 上普遍存在，
Codex 最严重（另有定位不准）。

## 2. 根因定位（代码级）

### 2.1 宽泛子串选择器

`scripts/theme-utils.mjs`（`shellStructureCss` / `sharedChromeRules`）、
各 `scripts/generators/*Css.mjs`、各 `engines/<agent>/adapter.mjs` 中大量使用
**宽泛子串匹配选择器** `[class*="..."]`：

| 选择器 | 实际命中范围（过度） |
|--------|---------------------|
| `[class*="item"]` | `item`、`item-wrapper`、`nav-item`、`interactive`、`itemInner`… |
| `[class*="active"]` | `active`、`reactive`、`inactive`、`activeIcon`… |
| `button[class*="primary"]` / `[class*="send"]` / `[class*="submit"]` | 所有含该子串的按钮，含内部结构 |
| `[class*="sidebar"] button` | 命中侧边栏内**每一个** button（含功能按钮） |
| `aside button` / `nav button` | 整个侧边栏所有按钮 |
| `[class*="message"]` | `message-container` 内所有含 message 的元素 |

**危害**：CSS 子串匹配无法区分「容器」与「容器内部恰好同名子串的块」，导致
**容器渲染正常、内部 div 被连带染色**——与用户描述完全吻合。

### 2.2 已知证据（代码自带注释）

`engines/codex/adapter.mjs` L139 注释自述：

> `[class*="sidebar"] matches 43 elements (items, scroll masks, resize handles)`

适配器作者已知该选择器命中 43 个元素（含滚动遮罩、调整手柄），仍在使用。
这说明问题被意识到但未解决。

### 2.3 双通道叠加放大

同一主题的 CSS 由两条通道注入：
1. 主题生成器（`themes/*/assets/css/<agent>.css`）——含宽泛选择器
2. 引擎 adapter（`engines/<agent>/adapter.mjs`）——也含宽泛选择器

两处叠加，过度渲染互相放大。

## 3. 真实 DOM 实证（CDP 探针，WorkBuddy 57556）

对运行中的 WorkBuddy 执行 CDP 探针，得到侧边栏真实 DOM：

- 侧边栏容器：`div.conversation-sidebar` → `div.conversation-list`（精确语义类名）
- 功能按钮：`button.wb-button.wb-button--ghost.wb-button--medium.wb-button--icon-only`
- 探针 `hit.sidebarBtn = true`：**这些按钮被 `[class*="sidebar"] button` 命中**

**结论**：`conversation-sidebar` 容器命中 `[class*="sidebar"]`，其下**所有**
`wb-button`（新建/搜索等顶栏功能按钮）都被 `[class*="sidebar"] button` 误染。
这正是「外部容器正常、内部按钮/块被过度渲染」的直接机制。

WorkBuddy 侧边栏实际使用精确 BEM 类（`wb-button--ghost`、`conversation-list-*`），
**不需要**任何 `[class*="item"]` 猜测。

## 4. 与官方 Codex 主题的正确做法对照

参考包 `~/.agnes/codex-themes-downloaded/github-noir`（`format: codex-theme`）：

```css
:root[data-codexthemes-theme="github-noir"] {   /* 单个精确属性选择器 */
  --ct-accent: #3fb950;                          /* 只用 CSS 变量渲染 */
}
aside.app-shell-left-panel { ... }               /* 精确语义类名 */
[role="menuitem"]:hover { ... }                  /* ARIA 角色 */
[class~="group/home-suggestion-list-item"] { ... } /* class~= 全词匹配 */
```

**官方方式**：只用 CSS 变量 + 精确属性/角色/全词匹配选择器，不做子串猜测。
**我们的方式**：宽泛 `[class*="..."]` 子串匹配，直接命中 DOM 元素。

## 5. 修复方案

### 5.1 原则

1. **优先用精确锚点**：真实 DOM 的精确类名（BEM）、`data-*` 属性、ARIA 角色
2. **禁止 `[class*="..."]` 子串匹配**（或仅作最后兜底且精确到最长唯一前缀）
3. **容器与内部元素分离**：只染目标容器，禁止通过后代宽泛选择器连带染内部
4. **代码与测试双更新**：生成器 + adapter 同步改，`check` 门禁全绿

### 5.2 实施步骤

1. **探测各 agent 真实 DOM**（CDP 探针）：
   - WorkBuddy ✅（已探，精确类名已确认）
   - traework / qoderwork / doubao / codex / zcode —— 需启动应用后逐个探测
2. **重写 `theme-utils.mjs` 的 `shellStructureCss` / `sharedChromeRules`**：
   - `[class*="item"]` → 按 agent 用真实精确类或 `[role="menuitem"]`
   - `[class*="active"]` → `[data-*]` 状态属性（如 `data-state="active"`）
   - `button[class*="primary"]` → 精确功能类 / `data-*`
3. **重写各 `scripts/generators/*Css.mjs`** 中同类选择器
4. **重写各 `engines/<agent>/adapter.mjs`** 中同类选择器
5. **回归验证**：`npm run check` 全绿 + CDP 注入后截图对比

### 5.3 待办

- [ ] 探测 traework 真实 DOM（应用需启动）
- [ ] 探测 qoderwork 真实 DOM
- [ ] 探测 doubao 真实 DOM
- [ ] 探测 codex 真实 DOM（问题最严重）
- [ ] 探测 zcode 真实 DOM
- [ ] 重写 `theme-utils.mjs` 共享规则
- [ ] 重写 6 个 agent 生成器 + adapter
- [ ] 回归验证 + 截图对比

## 6. 六 Agent CDP 实证（2026-08-23，全部应用运行中）

### 6.1 宽泛选择器命中数量（全文档查询）

| Agent | 端口 | `[class*="item"]` | `[class*="active"]` | `button[class*="primary"/send/submit]` | `[class*="sidebar"] button` | `[class*="message"]` |
|-------|------|-----|------|------|------|------|
| traework | 54564 | **105** | 3 | 2 | 0 | **120** |
| qoderwork | 64833 | 6 | 1 | 0 | 0 | 0 |
| workbuddy | 57556 | **31** | 2 | 0 | **62** | 0 |
| doubao | 64318 | **217** | 1 | **24** | **32** | 0 |
| codex | 59480 | **137** | 7 | **20** | **26** | 0 |
| zcode | 58728 | **139** | 7 | 0 | **29** | 5 |

**结论**：`[class*="item"]` 在 doubao 命中 **217** 个、codex **137**、zcode **139**、
traework **105**、workbuddy **31**。这些全是子串误命中——真实侧边栏项远没有这么多。

### 6.2 各 Agent 真实精确锚点（探针实证）

| Agent | 侧边栏容器 | 导航项 | 按钮 | 状态 |
|-------|-----------|--------|------|------|
| traework | `solo-*` 前缀（`solo-header-btn`、`solo-sidebar-toggle-btn`、`solo-common-button`） | `tab-*` / `task-list-*` | `iconButton-Q3VY7z tertiary-kDbrxb` | `tabActive-eQmiZY` |
| qoderwork | Tailwind 原子类 | `group/sidebar_nav_item`（若有） | `flex shrink-0 items-center justify-center rounded-full...` | — |
| workbuddy | `conversation-sidebar` / `sidebar-next` | `conversation-list` 项 | `wb-button wb-button--ghost wb-button--medium` | `conversation-*` 语义 |
| doubao | `data-testid="flow_chat_sidebar"` / `data-testid="chat_route_layout_leftside_nav"` | `group/sidebar_nav_item` | `data-testid="workspace-switch-chip"`、`data-testid="global-search-icon-entry"`、`data-testid="conversation-list-v2-*-menu-trigger"` | Tailwind `group-*` |
| codex | `app-shell-left-panel` | `button.sidebar-item` | `data-app-shell-sidebar-trigger="true"` | `data-state="closed"`（Radix）、`data-radix-collection-item` |
| zcode | `data-workspace-sidebar-panel="true"`、`data-testid="sidebar"` | — | `data-variant="ghost"`、`data-slot="button"`、`data-size="lg"` | `data-state="inactive"` |

### 6.3 结论

**所有 6 个 agent 都提供精确锚点**（精确 BEM 类、`data-testid`、`data-*` 属性、
Tailwind `group/*` 标记、ARIA 角色）。**没有任何 agent 需要 `[class*="..."]` 子串猜测。**

过度渲染 = 宽泛子串选择器命中容器内部元素。修复 = 用上表精确锚点重写。

## 7. 修复实施与验证（2026-08-23 完成）

### 7.1 修复内容

| 文件 | 变更 |
|------|------|
| `scripts/theme-utils.mjs` | `shellStructureCss` 增加 `agent` 参数：codex→`.app-shell-left-panel`/`button.sidebar-item`，zcode→`data-workspace-sidebar-panel`/`data-slot="button"`；移除 `[class*="item"]`/`[class*="active"]`/`button[class*="primary"]`；composer 用 host-scoped 精确锚点；popover/message 改为 role-scoped |
| `scripts/generators/codexCss.mjs` | 交互层只用 `button.sidebar-item` + `data-app-action-sidebar-thread-selected="true"` 等精确状态属性 |
| `scripts/generators/doubaoCss.mjs` | 透明穿透/侧边栏/气泡/active/按钮全部改用 `data-testid="flow_chat_sidebar"`、`group/sidebar_nav_item`、`data-active="true"`、`data-dbx-name="button"`、`data-testid="send_btn"` |
| `scripts/generators/traeworkCss.mjs` | 任务项用 `.task-list-new-task-item`（精确），tab 用 `button[role="tab"][aria-selected="true"]`，按钮用 `.solo-common-button`，message 用 `[role="log"]` |
| `scripts/generators/workbuddyCss.mjs` | 按钮用 `.wb-button`，会话项用 `.conversation-sidebar .conversation-list` |
| `scripts/generators/qoderworkCss.mjs` | 导航项用 `button[class~="group/extensions-nav"]`，active 用 `data-active="true"` |
| `scripts/generators/zcodeCss.mjs` | `shellStructureCss(host, t, 'zcode')` 精确锚点 |
| `engines/codex/adapter.mjs` | 移除 `[class*="sidebar"]`（43 命中）/`button[class*="primary"]`（6 工具按钮误染），改用精确锚点 |
| `engines/traework/adapter.mjs` | 任务项/气泡/mode-switcher 全部精确化 |
| `engines/qoderwork/adapter.mjs` | 侧边栏项/active 精确化 |

### 7.2 CDP 注入验证（修复前后命中数对比）

| Agent | 修复前误命中 | 修复后精确命中 |
|-------|------------|--------------|
| codex | `[class*="item"]`=137, `[class*="sidebar"] button`=26, primary=20 | `button.sidebar-item`=4, `.app-shell-left-panel`=1 |
| doubao | `[class*="item"]`=217, sidebarBtn=32, primary=24 | sidebarRoot=1, navItem=7, activeAttr=1 |
| traework | `[class*="item"]`=105, `[class*="message"]`=120 | taskItems=4, tabRole=3, tabActive=1, sendBtn=1 |
| workbuddy | `[class*="item"]`=31, sidebarBtn=62 | wbBtn=8, convSidebar=1, convItems=13 |
| qoderwork | item=6（较温和） | group/extensions-nav + data-active 精确锚点 |
| zcode | item=139, sidebarBtn=29 | data-workspace-sidebar-panel 精确锚点 |

**结论**：全部 6 个 agent 的宽泛子串选择器已替换为探针实证的精确锚点，
`npm run check` 全绿（含 C6 设计 token、C3 palette↔CSS staleness、C8 原生缺陷一致性）。

### 7.3 遗留

- `scripts/native-defect-fixes.mjs` 中 `[class*="bubble"]` 保留（C8 注册表，
  仅移除原生阴影、不染色，且被 8 个 adapter 副本一致性校验约束）
- TRAE 端口 2026-08-23 更新后变为 51223（原 54564）；探针已按新端口验证

## 8. 附：真实 DOM 探针脚本

- `debug-tools/_probe-agent-dom.mjs`（通用，按 agent 名 + 端口探测）
- `debug-tools/_probe-workbuddy-dom.mjs` / `_probe-codex-*.mjs` / `_probe-doubao-*.mjs` /
  `_probe-traework-*.mjs` / `_probe-zcode-*.mjs` / `_probe-qoderwork-*.mjs`（各 agent 精确锚点）
- `debug-tools/_verify-<agent>-fix.mjs`（注入修复后 CSS 验证命中数）

用法：`node debug-tools/_probe-agent-dom.mjs <name> <port>`
