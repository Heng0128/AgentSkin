# WorkBuddy `--cb-*` 变量体系与 AgentSkin 14-token 映射

> 来源: Christina121877/pink-crystal-workbuddy-skin v6.2 技术分析 + AgentSkin 工程实践
> 日期: 2026-08-30
> 关联文档: `docs/competitor-analysis/workbuddy-cb-token-reference.md`（round 21 产出）、`docs/reports/workbuddy-skin-ecosystem-research-2026-08-29.md`

---

## 一、双遮蔽源陷阱（关键）

WorkBuddy 输入框存在 **两个 CSS 变量同时影响背景**：

| 变量 | 用途 | 遮蔽层级 |
|------|------|----------|
| `--atm-surface` | 输入框表面色（第一个遮蔽源） | 直接声明在输入框容器 |
| `--atm-chat-content-bg` | 聊天内容背景（第二个遮蔽源） | 声明在聊天内容包裹层 |

**规则**: 只覆盖其一会导致输入框外观不一致——输入框表面与邻近聊天区域出现色阶断裂，必须**同时设置两者**才能保证视觉统一。

**根因**: WorkBuddy 的聊天组件分为"输入区"与"对话区"两个独立渲染层，各层都声明了自己的表面变量。CSS 继承链中后声明的变量覆盖先声明的，但如果只注入其中一个，另一个仍以原生值参与渲染。

**AgentSkin 当前状态**: `workbuddyCss.mjs` 在 `body[data-application-name="workbuddy"]` 和结构选择器（`.wb-home-composer__input-slot`、`[class*="_mainArea_"]`）上直接声明了 `background: color-mix(...)` 来绕过双遮蔽源。但未来若其他主题作者使用 `--atm-*` 变量进行适配，务必同时声明两者。

```css
/* 正确：同时覆盖双遮蔽源 */
.agentskin-theme-applied {
  --atm-surface: var(--agentskin-input-bg);
  --atm-chat-content-bg: var(--agentskin-input-bg);
}

/* 错误：只覆盖一个，另一个仍是原生色 */
.agentskin-theme-applied {
  --atm-surface: var(--agentskin-input-bg);
  /* --atm-chat-content-bg 仍是 rgb(31,31,31)，导致输入框边框与内容区有色阶 */
}
```

---

## 二、WorkBuddy 品牌强调色

WorkBuddy 使用 **`--wb-accent`** 作为原生品牌强调色（不是 `--cb-primary`，该变量在 WorkBuddy 中不存在）。

| 变量 | 角色 | AgentSkin 映射 |
|------|------|----------------|
| `--wb-accent` | 品牌强调色（按钮、链接、焦点环、滚动条） | `--agentskin-accent` |
| `--wb-secondary` | 次强调色（链接悬停、辅助渐变） | `--agentskin-secondary` |
| `--wb-surface` | 主表面色 | `--agentskin-bg` |
| `--wb-text` | 主文字色 | `--agentskin-text` |

> **注意**: Pink Crystal 项目默认 `--wb-accent: #ff4d9c`（樱花粉），这是其主题的核心识别色。在 AgentSkin 中，`--wb-accent` 由 `tokenBlock()` 从 manifest 的 `accent` 字段派生。

---

## 三、完整变量映射表

以下表格覆盖 `--cb-*` 变量（WorkBuddy 封装层）与 AgentSkin 14-token 的完整映射关系。标注：

- **[E]** Essential：视觉完整性核心
- **[R]** Recommended：影响一致性
- **[A]** Accent-only：仅跟随强调色派生

### 3.1 背景组（Backgrounds）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-bg` | `--cb-bg-primary` | 页面主背景（body 级） | `--wb-surface` 直接赋值 | **E** |
| `--agentskin-bg` | `--cb-bg-secondary` | 次级面板底色 | `--wb-surface` 94% alpha | **E** |
| `--agentskin-surface` | `--cb-bg-tertiary` | 三级面板/卡片底色 | `--wb-surface` 82% + `--wb-accent` 6% | **R** |
| `--agentskin-surface` | `--cb-bg-overlay` | 弹窗遮罩/蒙层 | `--wb-surface` 90% alpha | **R** |
| `--agentskin-surface` | `--cb-panel-bg-primary` | 主面板底色 | `--wb-surface` 88% alpha | **E** |
| `--agentskin-surface` | `--cb-panel-bg-secondary` | 嵌套面板底色 | `--wb-surface` 78% + `--wb-accent` 10% | **R** |
| `--agentskin-surface` | `--cb-team-member-card-background` | 团队成员卡片背景 | `--wb-surface` 88% alpha | **R** |

### 3.2 文字组（Text）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-text` | `--cb-text-primary` | 主标题/正文 | `--wb-text` 直接赋值 | **E** |
| `--agentskin-muted` | `--cb-text-secondary` | 副标题/描述文字 | `--wb-text` 70% alpha | **E** |
| `--agentskin-muted` | `--cb-text-tertiary` | 占位符/时间戳 | `--wb-text` 50% alpha | **R** |
| `--agentskin-muted` | `--cb-text-disabled` | 禁用态文字 | `--wb-text` 42% alpha | **R** |
| `--agentskin-accent` | `--cb-text-link` | 超链接颜色 | `--wb-accent` 直接赋值 | **E** |
| `--agentskin-secondary` | `--cb-text-link-hover` | 链接悬停颜色 | `--wb-secondary` | **R** |
| `--agentskin-accent` | `--cb-text-error-active` | 错误态文字/活跃错误 | `--wb-accent` | **A** |

### 3.3 侧栏与面板组（Sidebars & Panels）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-surface` | `--cb-sidebar-bg` | 会话列表/文件树底色 | `--wb-surface` 12% alpha | **E** |
| `--agentskin-surface` | `--cb-vscode-sideBar-background` | VS Code 侧栏底色 | `--wb-surface` 15% alpha | **E** |
| `--agentskin-border` | `--cb-vscode-panel-border` | 面板边框 | `--wb-accent` 30% alpha | **R** |
| `--agentskin-surface` | `--cb-vscode-panel-background` | 面板背景 | `--wb-surface` | **E** |
| `--agentskin-muted` | `--cb-input-placeholder` | 输入框占位符文字 | `--wb-text` 50% alpha | **R** |

### 3.4 输入组（Inputs）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-input-bg` | `--cb-vscode-input-background` | 输入框底色 | `--wb-surface` 88% alpha | **E** |
| `--agentskin-input-fg` (text) | `--cb-vscode-input-foreground` | 输入框文字 | `--wb-text` | **E** |
| `--agentskin-border` | `--cb-vscode-input-border` | 输入框边框 | `--wb-accent` 18% alpha | **R** |
| `--agentskin-input-bg` | `--cb-vscode-dropdown-background` | 下拉菜单背景 | `--wb-surface` 94% alpha | **E** |
| `--agentskin-text` | `--cb-vscode-dropdown-foreground` | 下拉菜单文字 | `--wb-text` | **E** |
| `--agentskin-border` | `--cb-vscode-dropdown-border` | 下拉菜单边框 | `--wb-accent` 18% alpha | **R** |

### 3.5 按钮组（Buttons）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-accent` | `--cb-button-dark-background` | 主按钮背景 | `--wb-accent` | **E** |
| `--agentskin-button-fg` | `--cb-button-dark-foreground` | 主按钮文字 | 按 `--wb-accent` 明度选 `#fff` 或 `#000` | **E** |
| `--agentskin-accent` | `--cb-button-dark-hover-background` | 主按钮悬停 | `--wb-accent` 85% + black | **R** |
| `--agentskin-accent` | `--cb-button-ghost-hover-background` | 幽灵按钮悬停 | `--wb-accent` 16% alpha | **R** |
| `--agentskin-accent` | `--cb-vscode-button-background` | VS Code 按钮背景 | `--wb-accent` | **E** |
| `--agentskin-button-fg` | `--cb-vscode-button-foreground` | VS Code 按钮文字 | 按明度选白/黑 | **E** |
| `--agentskin-accent` | `--cb-vscode-button-hoverBackground` | VS Code 按钮悬停 | `--wb-accent` 85% + black | **R** |
| `--agentskin-surface` | `--cb-vscode-button-secondaryBackground` | 次级按钮背景 | `--wb-surface` 70% + `--wb-accent` 12% | **R** |

### 3.6 焦点与选区组（Focus & Selection）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-focus-ring` | `--cb-vscode-focusBorder` | 全局焦点边框/环 | `--wb-accent` 40-55% alpha | **E** |
| `--agentskin-surface` | `--cb-vscode-list-hoverBackground` | 列表/侧栏行悬停 | `--wb-accent` 16% alpha | **R** |
| `--agentskin-text` | `--cb-vscode-list-activeSelectionForeground` | 列表选中项文字 | `--wb-text` | **R** |
| `--agentskin-surface` | `--cb-vscode-list-inactiveSelectionBackground` | 非活跃选中项背景 | `--wb-accent` 10% alpha | **R** |
| `--agentskin-surface` | `--cb-vscode-toolbar-hoverBackground` | 工具栏按钮悬停 | `--wb-accent` 16% alpha | **R** |
| `--agentskin-surface` | `--cb-vscode-scrollbarSlider-background` | 滚动条滑块 | `--wb-accent` 30% alpha | **R** |
| `--agentskin-surface` | `--cb-vscode-scrollbarSlider-hoverBackground` | 滚动条悬停 | `--wb-accent` 50% alpha | **R** |

### 3.7 VS Code Editor 组（Workbench Chrome）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-surface` | `--cb-vscode-editor-background` | 编辑器/视口底色 | `--wb-surface` | **E** |
| `--agentskin-text` | `--cb-vscode-foreground` | 全局前景色 | `--wb-text` | **E** |
| `--agentskin-text` | `--cb-vscode-editor-foreground` | 编辑器文字 | `--wb-text` | **E** |
| `--agentskin-muted` | `--cb-vscode-descriptionForeground` | 描述/提示文字 | `--wb-text` 70% alpha | **R** |
| `--agentskin-accent` | `--cb-vscode-titleBar-activeBackground` | 活动标题栏 | `transparent`（引擎中设为透明以显示 art 层） | **A** |
| `--agentskin-text` | `--cb-vscode-titleBar-activeForeground` | 活动标题栏文字 | `--wb-text` | **A** |
| `--agentskin-surface` | `--cb-vscode-titleBar-inactiveBackground` | 非活动标题栏 | `transparent` | **A** |
| `--agentskin-surface` | `--cb-titlebar-control-hover-background` | 标题栏控件悬停 | `--wb-accent` 16% alpha | **A** |

### 3.8 边框与分隔线组（Strokes）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-border` | `--cb-stroke-secondary` | 次级边框/分隔线 | `--wb-accent` 45% alpha | **R** |
| `--agentskin-border` | `--cb-markdown-hr-border-color` | Markdown 分隔线 | `--wb-accent` 30% alpha | **R** |
| `--agentskin-border` | `--cb-vscode-widget-border` | 浮层边框 | `--wb-accent` 45% alpha | **R** |
| `--agentskin-border` | `--cb-vscode-panel-border` | 面板分隔线 | `--wb-accent` 30% alpha | **R** |

### 3.9 聊天与对话组（Chat / Conversation）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| — | `--cb-chat-bg` | 聊天区背景 | `transparent`（显示 art 层） | **E** |
| `--agentskin-surface` | `--cb-chat-input-bg` | 输入框背景 | `color-mix(surface 80% + accent 20%) 48%` | **E** |
| `--agentskin-accent` | `--cb-chat-input-border` | 输入框边框 | `--wb-accent` 20% alpha | **R** |
| `--agentskin-text` | `--cb-chat-input-text` | 输入框文字 | `--wb-text` | **E** |
| `--agentskin-muted` | `--cb-chat-input-placeholder` | 输入框占位符 | `--wb-text` 50% alpha | **R** |
| `--agentskin-surface` | `--cb-chat-message-bg` | 消息气泡背景 | `surface 25% alpha` | **E** |
| `--agentskin-accent` | `--cb-chat-message-user-bg` | 用户消息背景 | `accent 12% alpha` | **E** |
| `--agentskin-text` | `--cb-chat-message-text` | 消息文字 | `--wb-text` | **E** |
| `--agentskin-muted` | `--cb-chat-timestamp` | 时间戳文字 | `--wb-text` 45% alpha | **R** |

### 3.10 Markdown / 代码组

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-code-bg` | `--cb-markdown-code-bg` | 行内代码背景 | `agentskin-code-bg` | **E** |
| `--agentskin-code-fg` | `--cb-markdown-code-text` | 行内代码文字 | `agentskin-code-fg` | **E** |
| `--agentskin-code-bg` | `--cb-markdown-codeblock-bg` | 代码块背景 | `agentskin-code-bg` | **E** |
| `--agentskin-surface` | `--cb-markdown-codeblock-header-bg` | 代码块头部背景 | `surface 95% + bg` | **R** |
| `--agentskin-accent` | `--cb-markdown-codeblock-border` | 代码块边框 | `accent 14% alpha` | **R** |
| `--agentskin-code-bg` | `--cb-markdown-inline-code-bg` | 行内代码背景 | `surface 85% + bg` | **R** |
| `--agentskin-code-fg` | `--cb-markdown-inline-code-text` | 行内代码文字 | `agentskin-code-fg` | **R** |
| `--agentskin-accent` | `--cb-markdown-link` | Markdown 链接 | `--wb-accent` | **E** |
| `--agentskin-accent` | `--cb-markdown-link-hover` | 链接悬停 | `accent 80% + white` | **R** |
| `--agentskin-accent` | `--cb-markdown-blockquote-border` | 引用块边框 | `accent 40% alpha` | **R** |
| `--agentskin-surface` | `--cb-markdown-blockquote-bg` | 引用块背景 | `surface 40% alpha` | **R** |
| `--agentskin-border` | `--cb-markdown-table-border` | 表格边框 | `border 60% alpha` | **R** |
| `--agentskin-surface` | `--cb-markdown-table-header-bg` | 表头背景 | `surface 70% alpha` | **R** |

### 3.11 输入/编辑器组（Input / Editor）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-input-bg` | `--cb-input-bg` | 通用输入框背景 | `surface 88% alpha` | **E** |
| `--agentskin-border` | `--cb-input-border` | 输入框边框 | `accent 25% alpha` | **R** |
| `--agentskin-accent` | `--cb-input-focus-border` | 焦点边框 | `--wb-accent` | **R** |
| `--agentskin-text` | `--cb-input-text` | 输入框文字 | `--wb-text` | **E** |
| `--agentskin-muted` | `--cb-input-placeholder` | 占位符 | `--wb-text` 50% alpha | **R** |
| `--agentskin-bg` | `--cb-editor-bg` | 编辑器背景 | `--wb-surface` | **E** |
| `--agentskin-text` | `--cb-editor-fg` | 编辑器前景 | `--wb-text` | **E** |
| `--agentskin-accent` | `--cb-editor-line-highlight` | 当前行高亮 | `accent 6% alpha` | **R** |
| `--agentskin-accent` | `--cb-editor-selection` | 选区背景 | `accent 25% alpha` | **E** |

### 3.12 侧栏详细组（Sidebar）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-surface` | `--cb-sidebar-bg` | 侧栏背景 | `surface 12% alpha` | **E** |
| `--agentskin-surface` | `--cb-sidebar-item-hover` | 侧栏项悬停 | `accent 10% alpha` | **R** |
| `--agentskin-accent` | `--cb-sidebar-item-active` | 侧栏项选中 | `accent 16% alpha` | **R** |
| `--agentskin-muted` | `--cb-sidebar-section-header` | 分区标题 | `--wb-text` 60% alpha | **R** |
| `--agentskin-border` | `--cb-sidebar-border` | 侧栏边框 | `border 40% alpha` | **R** |

### 3.13 通知与徽标组（Notification / Badge）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-accent` | `--cb-badge-bg` | 徽标背景 | `--wb-accent` | **E** |
| `--agentskin-button-fg` | `--cb-badge-fg` | 徽标文字 | `#ffffff` | **E** |
| `--agentskin-surface-elevated` | `--cb-notification-bg` | 通知卡片背景 | `surface-elevated 94% alpha` | **R** |
| `--agentskin-accent` | `--cb-notification-border` | 通知边框 | `accent 30% alpha` | **R** |

### 3.14 标签页组（Tabs）

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-surface` | `--cb-tab-active-bg` | 活动标签页背景 | `surface 80% alpha` | **E** |
| — | `--cb-tab-inactive-bg` | 非活动标签页背景 | `transparent` | **R** |
| `--agentskin-accent` | `--cb-tab-hover-bg` | 标签页悬停 | `accent 8% alpha` | **R** |
| `--agentskin-accent` | `--cb-tab-active-border` | 活动标签页底部强调条 | `--wb-accent` | **E** |
| `--agentskin-text` | `--cb-tab-text` | 标签页文字 | `--wb-text` | **E** |
| `--agentskin-muted` | `--cb-tab-inactive-text` | 非活动标签页文字 | `--wb-text` 60% alpha | **R** |

### 3.15 图标按钮组

| AgentSkin 14-token | WorkBuddy `--cb-*` 变量 | 用途 | 派生公式 | 优先级 |
|--------------------|------------------------|------|----------|--------|
| `--agentskin-surface` | `--cb-icon-button-hover-background` | 图标按钮悬停背景 | `accent 12% alpha` | **R** |

---

## 四、WorkBuddy 原生 vs CodeX 变量对比

| 维度 | WorkBuddy | CodeX |
|------|-----------|-------|
| 封装层变量前缀 | `--cb-*`（466 个） | `--codex-*`（或无统一前缀） |
| workbench 层变量 | `--vscode-*`（867 个，VS Code 原生） | `--vscode-*`（部分继承自 VS Code） |
| 品牌强调色 | `--wb-accent`（注入层） | `--codex-accent` 或 `--wb-accent` |
| 输入框遮蔽源 | `--atm-surface` + `--atm-chat-content-bg`（双遮蔽） | 无此问题 |
| host 选择器 | `body[data-application-name="workbuddy"]` | `html.agentskin-host-codex` |
| 深浅色切换 | `data-vscode-theme-kind` 属性 | `color-scheme` + `data-theme-kind` |

WorkBuddy 与 CodeX 共享 VS Code 架构的 `--vscode-*` workbench 层，但 WorkBuddy 额外封装了 `--cb-*` 层用于自家聊生日用组件。CodeX（OpenAI Codex CLI 桌面端）则直接使用 VS Code 原生 workbench，没有独立的封装层。

---

## 五、注入注意事项

### 5.1 必须同时覆盖双遮蔽源

注入 CSS 时必须声明 `--atm-surface` 和 `--atm-chat-content-bg` 两个变量，否则输入框表面色与聊天内容背景色不一致。

### 5.2 使用 var(--wb-accent) 而非自己声明强调色

若主题作者直接在注入 CSS 中声明按钮背景色（如 `background: #ff4d9c`），而 WorkBuddy 内部组件通过 `var(--wb-accent)` 读取值，将导致按钮色与链接/焦点环色不一致。**所有强调色引用都应通过 `--wb-accent`**。

### 5.3 12 项致命坑摘要（从 Pink Crystal SKILL.md 提炼）

| # | 坑 | 影响 | 解决 |
|---|-----|------|------|
| 1 | 输入框双遮蔽源不同时覆盖 | 表面色不一致 | 同时声明 `--atm-surface` 和 `--atm-chat-content-bg` |
| 2 | 透明度口径混淆（见 §5.4） | 颜色过透/过实 | 明确 `opacity` 与"透明百分比"的换算 |
| 3 | 未声明 `color-scheme` | 系统控件（滚动条/选择框）显示原生色 | 在 `:root` 声明 `color-scheme: dark/light` |
| 4 | `body` 背景不透明覆盖 art 层 | hero/纹理图不可见 | `body { background: transparent !important; }` |
| 5 | `.teams-container` 不透明底色 | 遮挡背景 | `background: transparent !important` |
| 6 | 未锁定 `html/body` 视口高度 | 文档级滚动条溢出 | `height: 100vh; overflow: hidden;` |
| 7 | 未覆盖 `--sc-ui-*` 组件库 | 独立 UI 组件仍为原生色 | 添加 24 个 `--sc-ui-*` 变量映射 |
| 8 | 未覆盖 `--vscode-*` workbench 层 | editor/sidebar 仍为原生色 | 添加 78 个精选 `--vscode-*` 变量 |
| 9 | `[data-view-id]` 容器残留不透明底色 | 布局断层的色块 | `[data-view-id] { background: transparent; }` |
| 10 | 明度选择按钮文字色错误 | 暗色按钮上暗文字不可读 | 按 accent 明度动态选 `#fff`/`#000` |
| 11 | macOS codesign 重签失败 | 注入后应用无法启动 | 重新签名 `codesign --force --deep` |
| 12 | Windows Program Files 写入权限 | 应用升级还原需管理员权限 | 以管理员运行或用户数据目录写入 |

### 5.4 透明度口径

在 Pink Crystal 的设计中，"70% 透明" = **0.30 不透明度**（不是 0.70）。这是设计软件（Figma/Sketch）与 CSS `opacity` 的语义差异导致的。设计稿上的"透明度"指"光线穿过"的比例，而 CSS `opacity: 0.7` 指"不透明度 70%"（只透 30% 光线）。

| 设计稿表达 | CSS opacity | color-mix alpha |
|-----------|-------------|-----------------|
| 30% 透明 | 0.70 | 70% |
| 50% 透明 | 0.50 | 50% |
| 70% 透明 | 0.30 | 30% |
| 88% 透明 | 0.12 | 12% |

> **AgentSkin 内部约定**: 使用 `color-mix(in srgb, var(--wb-surface) X%, transparent)` 时，X 即不透明度百分比（与 CSS opacity 同义），与 Figma "透明度" 数值不同，需换算。

---

## 六、Animated WebP 注入模式

Pink Crystal 采用 **模板 + base64 分离** 管理动态背景资产：

```
pink-crystal-workbuddy-skin/
├── assets/
│   ├── dynamic/              # 动态模式（animated WebP）
│   │   ├── skin.css          # 成品 CSS（含 base64 背景）
│   │   ├── skin.template.css # 样式模板（__PINK_CRYSTAL_BG_B64__ 占位）
│   │   └── bg.b64.txt        # 背景资产纯 base64（121 帧 / 1280x720 / 24fps）
│   └── static/               # 静态模式（JPEG 单帧）
│       ├── skin.css
│       ├── skin.template.css
│       └── bg.b64.txt
└── tools/
    ├── build_skin.py         # 模板 + base64 → 重建 skin.css
    └── extract_bg.py         # 从 asar 抽取当前背景 base64
```

**设计要点**:

1. **模板文件** (`skin.template.css`) 只含样式结构和 `__PINK_CRYSTAL_BG_B64__` 占位符，不含实际资产
2. **资产文件** (`bg.b64.txt`) 独立存储 base64 编码的 WebP/JPEG
3. **构建脚本** (`build_skin.py`) 将占位符替换为 base64 内容，生成成品 `skin.css`
4. **抽取脚本** (`extract_bg.py`) 可从已注入的 asar 中抽出当前背景 base64 用于复用

**对 AgentSkin 的启示**: AgentSkin 当前主题包采用静态 CSS + 图片文件模式，如需支持 animated WebP 动态背景，可借鉴"模板 + 资产解耦"思路——模板文件保持纯 CSS 结构，动态资产独立管理，构建时合并注入。

---

## 七、AgentSkin 适配器注入伪代码

### 7.1 正确注入模板

```css
/* === 同时覆盖双遮蔽源 + 桥接 --wb-* === */
html.agentskin-host-workbuddy body[data-application-name="workbuddy"],
html.agentskin-host-workbuddy .agentskin-theme-applied {
  /* 输入框双遮蔽源——必须同时声明 */
  --atm-surface: color-mix(in srgb, var(--agentskin-input-bg) 88%, transparent);
  --atm-chat-content-bg: color-mix(in srgb, var(--agentskin-input-bg) 88%, transparent);

  /* 品牌强调色（使用 var(--wb-accent) 确保内部组件一致读取） */
  --wb-accent: var(--agentskin-accent);
  --wb-secondary: var(--agentskin-secondary);
  --wb-surface: var(--agentskin-surface);
  --wb-text: var(--agentskin-text);

  /* --cb-* 派生层 */
  --cb-bg-primary: var(--wb-surface);
  --cb-bg-secondary: color-mix(in srgb, var(--wb-surface) 94%, transparent);
  --cb-panel-bg-primary: color-mix(in srgb, var(--wb-surface) 88%, transparent);

  --cb-text-primary: var(--wb-text);
  --cb-text-secondary: color-mix(in srgb, var(--wb-text) 70%, transparent);
  --cb-text-link: var(--wb-accent);

  /* 按钮和焦点 */
  --cb-button-dark-background: var(--wb-accent);
  --cb-button-dark-foreground: #ffffff; /* 需按 accent 明度动态选择 */
  --cb-vscode-button-background: var(--wb-accent);
  --cb-vscode-focusBorder: color-mix(in srgb, var(--wb-accent) 40%, transparent);

  /* 透明度口径："70% 透明" = 0.30 不透明度 */
  /* color-mix 中 30% = 不透明白，等价于设计稿 "70% 透明" */
  --cb-bg-overlay: color-mix(in srgb, var(--wb-surface) 30%, transparent);
}
```

### 7.2 深浅色切换逻辑

```javascript
// 明度阈值判定（来自 cdredfox/workbuddy-skin-studio 的启发）
function computeThemeMode(surfaceColor) {
  const luma = computeLuminance(surfaceColor); // 0-255
  if (luma > 140) {
    document.documentElement.setAttribute('data-vscode-theme-kind', 'vscode-light');
    document.documentElement.style.colorScheme = 'light';
  } else {
    document.documentElement.setAttribute('data-vscode-theme-kind', 'vscode-dark');
    document.documentElement.style.colorScheme = 'dark';
  }
}
```

### 7.3 agentSkin 注入器正确顺序

```
1. 声明 --wb-accent / --wb-secondary / --wb-surface / --wb-text
   ↓
2. 同时声明 --atm-surface 和 --atm-chat-content-bg
   ↓
3. 派生 --cb-* 变量组（背景、文字、按钮、边框）
   ↓
4. 派生 --vscode-* workbench 层变量（78 个精选）
   ↓
5. 派生 --sc-ui-* 组件库变量（24 个）
   ↓
6. 设置 body/.teams-container background: transparent（透出 art 层）
   ↓
7. 设置 color-scheme / data-vscode-theme-kind
```

---

## 八、变量统计

| 类别 | 变量数 | 来源文件 |
|------|--------|----------|
| `--wb-*` 基础变量 | 4 | `workbuddyCss.mjs`、`tokens.css` |
| `--cb-*` bg 组 | 7 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` text 组 | 7 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` vscode 封装组 | 15 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` button 组 | 8 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` stroke 组 | 4 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` focus 组 | 2 | `tokens.css`、`workbuddyCss.mjs` |
| `--cb-*` chat 组 | 9 | `tokens.css` |
| `--cb-*` markdown 组 | 13 | `tokens.css` |
| `--cb-*` input/editor 组 | 9 | `tokens.css` |
| `--cb-*` sidebar 组 | 5 | `tokens.css` |
| `--cb-*` notification/badge 组 | 4 | `tokens.css` |
| `--cb-*` tab 组 | 6 | `tokens.css` |
| `--cb-*` icon button 组 | 1 | `tokens.css` |
| `--vscode-*` 原生层 | 78 | `tokens.css`、`workbuddyCss.mjs` |
| `--sc-ui-*` 组件库 | 24 | `tokens.css`、`workbuddyCss.mjs` |
| `--atm-*` 双遮蔽源 | 2 | 来自 Pink Crystal 分析 |
| **合计** | **198** | — |

---

## 九、参考资源

| 资源 | 说明 |
|------|------|
| `engines/workbuddy/tokens.css` | AgentSkin 引擎 L0 token 注入（197 个变量） |
| `scripts/generators/workbuddyCss.mjs` | 主题层 CSS 生成器（166 定义 + 结构层） |
| `src/engine/src/adapters/workbuddy.mjs` | 适配器 bridge 映射（16 cb + 28 vscode） |
| `src/engine/src/runtime/css-var-bridge.mjs` | 语义角色路由（surface/text/bg/accent 等 11 角色） |
| `docs/apps/workbuddy/ADAPTATION.md` | 适配策略与实测结论 |
| `docs/competitor-analysis/workbuddy-cb-token-reference.md` | round 21 产出（`--wb-*` 与 14-token 派生关系） |
| Christina121877/pink-crystal-workbuddy-skin (GitHub) | v6.2，双遮蔽源 + animated WebP + asar 注入 |
| cdredfox/workbuddy-skin-studio (GitHub) | 170 stars，AI 优先极简方案 |

---

## 十、更新记录

| 日期 | 变更 |
|------|------|
| 2026-08-30 | 初版：整合 Christina121877 v6.2 发现、AgentSkin 三层覆盖、双遮蔽源、12 项致命坑摘要 |
