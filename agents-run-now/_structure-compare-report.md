# AgentSkin 适配器结构漂移修订清单

> 生成时间：2026-08-17T06:49:45.100Z ｜ 共 6 个 Agent

## 基线对拍摘要

- 新增漂移：**0**（基线 OK → 当前出现，需修订）
- 已恢复：**2**（基线漂移 → 当前 OK）
- 持续漂移：**0**（基线、当前均有，已知问题不重复告警）

## OpenAI Codex（codex）

- 运行状态：**OK**
- CDP：ok @:58554（类名 404 / :root 变量 1290）
- 样式 AST：styleSheets=11（630 条）｜ adoptedStyleSheets=5（52 条）｜ :root 声明 49｜主题选择器 35
- Shadow DOM：open host 0｜内部元素 0｜shadow 内 adoptedStyleSheets 0
- 静态解包：asar（类名 53 / CSS 变量 1463）

### diff 摘要
- 类名：shared=37 onlyStatic=16 onlyRuntime=367（覆盖率 0.698）
- 变量：shared=1205 onlyStatic=258 onlyRuntime=85（覆盖率 0.824）

### 高频运行时独有类名（Top-N，静态抓不到）
- `no-drag` ×33
- `border` ×31
- `focus-visible:ring-2` ×27
- `focus-visible:ring-ring` ×27
- `disabled:cursor-not-allowed` ×27
- `border-transparent` ×27
- `whitespace-nowrap` ×26
- `focus:outline-none` ×24
- `focus-visible:ring-offset-0` ×23
- `disabled:opacity-40` ×23
- `px-2` ×18
- `py-0` ×18
- `aspect-square` ×16
- `!px-0` ×16
- `enabled:hover:bg-primary-ghost-hover` ×15
- `data-[state=open]:bg-primary-ghost-hover` ×15
- `overflow-hidden` ×15
- `rounded-lg` ×14
- `leading-[18px]` ×12
- `hover:bg-primary-ghost-hover` ×11
- `justify-end` ×11
- `rounded-full` ×10
- `focus-visible:outline-2` ×10
- `h-token-button-composer` ×9
- `outline-none` ×9

## 豆包（doubao）

- 运行状态：**OK**
- CDP：ok @:61055（类名 484 / :root 变量 1236）
- 样式 AST：styleSheets=73（34202 条）｜ adoptedStyleSheets=5（58 条）｜ :root 声明 753｜主题选择器 200
- Shadow DOM：open host 0｜内部元素 0｜shadow 内 adoptedStyleSheets 0
  - ⚠️ closed shadow 风险：`input[type="file"]`（host: input，matches=1）
- 静态解包：cef（类名 32 / CSS 变量 0）

### diff 摘要
- 类名：shared=0 onlyStatic=32 onlyRuntime=484（覆盖率 0.000）
- 变量：shared=0 onlyStatic=0 onlyRuntime=1236（覆盖率 null）

### 高频运行时独有类名（Top-N，静态抓不到）
- `flex` ×232
- `items-center` ×176
- `min-w-0` ×175
- `relative` ×158
- `shrink-0` ×124
- `cursor-pointer` ×95
- `justify-center` ×93
- `truncate` ×91
- `hover:bg-dbx-fill-trans-10-hover` ×88
- `whitespace-nowrap` ×84
- `block` ×82
- `w-full` ×79
- `absolute` ×79
- `select-none` ×71
- `bg-transparent` ×64
- `overflow-hidden` ×63
- `rounded-dbx-lg` ×63
- `ease-out` ×59
- `font-[400]` ×58
- `[&_svg]:shrink-0` ×58
- `transition-colors` ×58
- `duration-150` ×58
- `[&:is(:where(:is([aria-haspopup="dialog"],[aria-haspopup="menu"])[data-state="open"]:not([data-slot="alert-dialog-trigger"])),:where(:is([aria-haspopup="dialog"],[aria-haspopup="menu"])[data-state="open"]:not([data-slot="alert-dialog-trigger"])_*))]:bg-dbx-fill-trans-10-hover` ×57
- `container-fBOrXO` ×56
- `opacity-0` ×54

## WorkBuddy（workbuddy）

- 运行状态：**OK**
- 基线对拍：**已恢复**（基线漂移 → 当前 OK）
  - ✅ 恢复 bridge 缺失 15 个（--cb-bg-primary, --cb-bg-secondary, --cb-panel-bg-primary, --cb-text-primary, --cb-text-secondary, --cb-text-disabled, --cb-text-link, --cb-vscode-editor-background, --cb-vscode-foreground, --cb-vscode-focusBorder, --cb-vscode-button-background, --cb-vscode-button-foreground, --cb-vscode-panel-border, --cb-input-placeholder, --cb-sidebar-bg）
- CDP：ok @:57440（类名 267 / :root 变量 0）
- 样式 AST：styleSheets=84（25567 条）｜ adoptedStyleSheets=5（81 条）｜ :root 声明 3847｜主题选择器 200
- Shadow DOM：open host 1｜内部元素 11｜shadow 内 adoptedStyleSheets 0
  - ⚠️ closed shadow 风险：`video`（host: video，matches=1）
- 静态解包：asar（类名 91 / CSS 变量 5080）

### diff 摘要
- 类名：shared=4 onlyStatic=87 onlyRuntime=263（覆盖率 0.044）
- 变量：shared=0 onlyStatic=5080 onlyRuntime=0（覆盖率 0.000）

### 高频运行时独有类名（Top-N，静态抓不到）
- `fixed-action-button` ×16
- `_icon_981i8_1` ×9
- `wb-button` ×8
- `wb-button--ghost` ×8
- `wb-button--icon-only` ×8
- `wb-button__icon` ×8
- `wb-button__icon--left` ×8
- `conversation-item` ×8
- `_card_11ei8_1` ×8
- `conversation-agent-card` ×8
- `_title_11ei8_23` ×8
- `_time_11ei8_231` ×8
- `agent-card-more-button` ×8
- `_small_981i8_27` ×8
- `quick-actions__item` ×8
- `quick-actions__item-icon` ×8
- `conversation-list-tab-button` ×7
- `conversation-list-tab-button-box` ×6
- `conversation-agent-card--standalone` ×5
- `collapsible-section` ×5
- `collapsible-section-header` ×5
- `collapsible-section-title` ×5
- `collapsible-section-icon` ×5
- `_title_fpw7i_48` ×5
- `collapsible-section-label` ×5

## QoderWork CN（qoderwork）

- 运行状态：**OK**
- 基线对拍：**已恢复**（基线漂移 → 当前 OK）
  - ✅ 恢复 bridge 缺失 12 个（--color-primary, --color-text, --color-text-secondary, --color-text-tertiary, --color-muted, --color-text-on-primary, --color-bg-elevated, --color-popover, --color-border, --color-border-secondary, --color-fill, --color-link）
- CDP：ok @:53137（类名 271 / :root 变量 0）
- 样式 AST：styleSheets=8（773 条）｜ adoptedStyleSheets=5（47 条）｜ :root 声明 126｜主题选择器 97
- Shadow DOM：open host 0｜内部元素 0｜shadow 内 adoptedStyleSheets 0
- 静态解包：asar（类名 621 / CSS 变量 353）

### diff 摘要
- 类名：shared=156 onlyStatic=465 onlyRuntime=115（覆盖率 0.251）
- 变量：shared=0 onlyStatic=353 onlyRuntime=0（覆盖率 0.000）

### 高频运行时独有类名（Top-N，静态抓不到）
- `hover:text-text` ×27
- `py-[5px]` ×24
- `focus-visible:outline` ×24
- `focus-visible:outline-2` ×24
- `focus-visible:outline-ring/70` ×24
- `text-[13px]` ×24
- `leading-[22px]` ×24
- `gap-2.5` ×21
- `focus:outline-none` ×19
- `active:scale-[0.97]` ×19
- `gap-0.5` ×19
- `size-3.5` ×18
- `text-text-secondary/80` ×17
- `hover:text-foreground` ×17
- `active:text-foreground` ×17
- `transition-[opacity,transform,color]` ×17
- `group-hover:opacity-100` ×17
- `group-hover:scale-100` ×17
- `group-hover:pointer-events-auto` ×17
- `focus-visible:ring-2` ×14
- `p-1.5` ×13
- `transition-[color,background-color,border-color,box-shadow,opacity]` ×12
- `motion-reduce:transition-none` ×12
- `focus-visible:outline-none` ×12
- `focus-visible:ring-[var(--color-primary-border)]` ×12

## TRAE Work CN（traework）

- 运行状态：**OK**
- CDP：ok @:56211（类名 300 / :root 变量 2000）
- 样式 AST：styleSheets=38（46181 条）｜ adoptedStyleSheets=5（66 条）｜ :root 声明 4003｜主题选择器 200
- Shadow DOM：open host 0｜内部元素 0｜shadow 内 adoptedStyleSheets 0
  - ⚠️ closed shadow 风险：`input[type="file"]`（host: input，matches=1）
- 静态解包：unpacked（类名 29 / CSS 变量 47）

### diff 摘要
- 类名：shared=0 onlyStatic=29 onlyRuntime=300（覆盖率 0.000）
- 变量：shared=19 onlyStatic=28 onlyRuntime=1981（覆盖率 0.404）

### 高频运行时独有类名（Top-N，静态抓不到）
- `trigger-RljaZJ` ×75
- `iconButton-Q3VY7z` ×45
- `icon-_l_X9w` ×45
- `tertiary-kDbrxb` ×43
- `user-message-query-line` ×35
- `default-FjFsr_` ×29
- `taskIconBtn` ×28
- `user-message-query-text` ×23
- `wrapper-xSbnEu` ×19
- `small-OBA1vF` ×16
- `task-list-row-wrapper` ×14
- `taskItemWrapper` ×14
- `taskItem` ×14
- `taskItemGrouped` ×14
- `taskPinArea` ×14
- `taskPinAreaGrouped` ×14
- `pinIconDefault` ×14
- `taskText` ×14
- `taskRight` ×14
- `taskActions` ×14
- `taskMoreBtn` ×14
- `taskTreeBtn` ×14
- `taskTreeBtnCode` ×14
- `core-expandable-section` ×12
- `solo-common-button` ×11

## ZCode（zcode）

- 运行状态：**OK**
- CDP：ok @:55435（类名 402 / :root 变量 432）
- 样式 AST：styleSheets=5（639 条）｜ adoptedStyleSheets=5（40 条）｜ :root 声明 1｜主题选择器 5
- Shadow DOM：open host 0｜内部元素 0｜shadow 内 adoptedStyleSheets 0
  - ⚠️ closed shadow 风险：`input[type="file"]`（host: input，matches=1）
  - ⚠️ closed shadow 风险：`select`（host: select，matches=2）
- 静态解包：asar（类名 58 / CSS 变量 465）

### diff 摘要
- 类名：shared=36 onlyStatic=22 onlyRuntime=366（覆盖率 0.621）
- 变量：shared=376 onlyStatic=89 onlyRuntime=56（覆盖率 0.809）

### 高频运行时独有类名（Top-N，静态抓不到）
- `whitespace-nowrap` ×49
- `transition-colors` ×45
- `inline-flex` ×44
- `outline-none` ×43
- `hover:text-foreground` ×42
- `border` ×42
- `border-transparent` ×39
- `disabled:opacity-50` ×39
- `[&_svg]:pointer-events-none` ×39
- `[&_svg]:shrink-0` ×39
- `select-none` ×37
- `disabled:pointer-events-none` ×37
- `aria-invalid:border-destructive` ×37
- `aria-invalid:ring-2` ×37
- `aria-invalid:ring-destructive/20` ×37
- `dark:aria-invalid:border-destructive/50` ×37
- `dark:aria-invalid:ring-destructive/40` ×37
- `group/button` ×35
- `bg-clip-padding` ×35
- `aria-expanded:text-foreground` ×35
- `aria-expanded:bg-hover` ×34
- `overflow-hidden` ×29
- `text-ui-base/relaxed` ×27
- `hover:bg-hover` ×26
- `hover:bg-surface-hover` ×22
