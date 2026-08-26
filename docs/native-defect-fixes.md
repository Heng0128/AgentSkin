# 原生硬编码视觉缺陷修正规范

> **自动生成文档 — 请勿手工编辑。** 唯一来源是 `scripts/native-defect-fixes.mjs`。
> 修改注册表后运行 `npm run gen:defect-doc` 重新生成；`npm run check` 会以
> `check:defect-doc` 校验文档新鲜度，漂移即 fail。

## 这是什么

目标应用（traework / qoderwork / workbuddy / doubao / codex / zcode）自带少量
**无法通过主题变量修改**的硬编码视觉缺陷：气泡原生方角阴影、消息列表顶/底的硬编码
渐变遮罩带、灰/实底色圆角气泡等。它们会破坏主题的艺术背景，因此必须被中和。

这些消除类规则被收敛到**单一来源** `scripts/native-defect-fixes.mjs`：
- 规则是**主题无关**的——`props` 只使用「清除值」`none` / `transparent`，绝不注入主题颜色。
- 同一注册表同时驱动 ① Node 端主题生成器、② 运行时引擎适配器。
- 生成器在产出各 agent 的 CSS 时**自动拼接**这些规则，因此：

> **创建/重建主题时，缺陷修正自动带上，你无需手写、也无需记住任何选择器。**
> 你只管在 `manifest.json` 定义 14 个语义色。

## 发现新缺陷 → 回填注册表的工作流（探针传导）

当主题在某个 agent 下出现渲染不一致（阴影、渐变带、灰底、气泡圈等），按以下流程把
探针数据传导为注册表规则：

1. **探针定位**：用 `debug-tools/` 下的 `probe-*` 探针（CDP 计算样式核对）确认
   该缺陷是**应用硬编码**、且**无法通过 `--agentskin-*` 令牌修改**的。
   - 定位元素 + 最终生效的属性来源（`getComputedStyle` 与 CSS 规则归属）。
   - 截图产物存 `assets/probe-shots/`。
2. **评估归属**：若缺陷能靠 token 覆盖或表面着色块消解，则不动注册表；只有确属
   「硬编码且需清除」时才进注册表。
3. **提炼清除类规则**：把缺陷归纳为「选择器锚点 + 清除属性」，写进
   `NATIVE_DEFECT_FIXES[agent]`。遵守约束：
   - `label`：稳定标识，如 `chat-bubble-shadow`
   - `selectors`：**host 后代选择器**，不含 host 前缀（前缀由 `nativeDefectFixCss` 自动加）
   - `props`：**只允许清除值** `none` / `transparent`（不得注入主题颜色）
4. **回写生成**：运行 `npm run gen:defect-doc` 重新生成本文档。
5. **一致性命中**：把同一条规则也镜像到 `engines/<agent>/adapter.mjs`（运行时内嵌副本），
   然后跑 `npm run check` —— `check:defect-consistency`（C8）会校验 adapter 已覆盖新规则，
   adapter 未同步会 fail。

## 各 Agent 规则清单

| Agent | host 作用域 | 独立清除类规则数 |
|-------|------------|------------------|
| TRAE Work CN (`traework`) | `html.agentskin-host-traework` | 4 |
| WorkBuddy (`workbuddy`) | `body[data-application-name="workbuddy"]` | 2 |
| 豆包 (`doubao`) | `html.agentskin-host-doubao` | 2 |
| QoderWork CN (`qoderwork`) | `html.agentskin-host-qoderwork` | 0 |
| OpenAI Codex (`codex`) | `:root.agentskin-host-codex` | 0 |
| ZCode (`zcode`) | `html.agentskin-host-zcode` | 0 |

### TRAE Work CN — `scripts/generators/traeworkCss.mjs`

#### `chat-bubble-shadow`

**修正**：kill native squared box-shadow on chat bubbles

**生效清除声明**：`box-shadow: none !important`，`outline: none !important`

**选择器**（host 作用域自动加前缀）：
- `[class*="message-bubble"]`
- `[class*="messageBubble"]`
- `[class*="msg-bubble"]`
- `[class*="chat-bubble"]`
- `[class*="message-content"]`
- `[class*="msg-content"]`

#### `user-message-surface`

**修正**：clear native grey rounded surface on the user-message text box

**生效清除声明**：`background: transparent !important`，`background-color: transparent !important`，`background-image: none !important`，`border-color: transparent !important`

**选择器**（host 作用域自动加前缀）：
- `.user-message__text-box`
- `[class*="user-message__text-box"]`

#### `message-navigator-mask`

**修正**：remove native hardcoded fade-gradient mask over the message list

**生效清除声明**：`background-image: none !important`，`background: transparent !important`

**选择器**（host 作用域自动加前缀）：
- `[class*="user-message-navigator__mask"]`

#### `task-list-shadow`

**修正**：remove native hardcoded sticky fade-gradient shadow band under the sidebar task list (verified live: .task-list-shadow-bottom paints rgb(38,38,38) in dark)

**生效清除声明**：`background-image: none !important`，`background: transparent !important`

**选择器**（host 作用域自动加前缀）：
- `.task-list-shadow-bottom`
- `.task-list-shadow-top`

### WorkBuddy — `scripts/generators/workbuddyCss.mjs`

#### `quick-actions-shadow`

**修正**：kill native side shadows on the recommendation chips above the input

**生效清除声明**：`box-shadow: none !important`，`outline: none !important`

**选择器**（host 作用域自动加前缀）：
- `.quick-actions`
- `.quick-actions__list`
- `[class*="quick-action"]:not(.quick-actions__item)`

#### `quick-actions-shadow-desc`

**修正**：kill stacked side shadows on descendants of the quick-action chips

**生效清除声明**：`box-shadow: none !important`，`outline: none !important`

**选择器**（host 作用域自动加前缀）：
- `.quick-actions *`
- `.quick-actions__list *`

### 豆包 — `scripts/generators/doubaoCss.mjs`

#### `suggest-cards-shadow`

**修正**：kill native shadow/border effects on suggestion & topic cards

**生效清除声明**：`outline: none !important`，`box-shadow: none !important`，`border-image: none !important`

**选择器**（host 作用域自动加前缀）：
- `[class*="suggest"]`
- `[class*="recommend"]`
- `[class*="topic"]`

#### `suggest-cards-shadow-desc`

**修正**：kill stacked shadow/blur/border on suggested-card children

**生效清除声明**：`border-color: transparent !important`，`outline: none !important`，`box-shadow: none !important`，`backdrop-filter: none !important`

**选择器**（host 作用域自动加前缀）：
- `[class*="suggest"] *`
- `[class*="recommend"] *`
- `[class*="topic"] *`

### QoderWork CN — `scripts/generators/qoderworkCss.mjs`

当前无独立的清除类缺陷规则（原生缺陷由 token 覆盖 + 表面着色块消解）。此 agent 仍接入了共享注册表，今后加入新规则会自动带上。

### OpenAI Codex — `scripts/generators/codexCss.mjs`

当前无独立的清除类缺陷规则（原生缺陷由 token 覆盖 + 表面着色块消解）。此 agent 仍接入了共享注册表，今后加入新规则会自动带上。

### ZCode — `scripts/generators/zcodeCss.mjs`

当前无独立的清除类缺陷规则（原生缺陷由 token 覆盖 + 表面着色块消解）。此 agent 仍接入了共享注册表，今后加入新规则会自动带上。

## 相关链接

- 设计文档：`docs/rfc/2026-08-18-native-defect-fixes-consolidation.md`
- 收敛单一来源：`scripts/native-defect-fixes.mjs`
- 一致性守卫（C8）：`scripts/check-native-defect-consistency.mjs`
- 探针资产：`debug-tools/`（INDEX.md 声明为禁止删除的调试资产）
