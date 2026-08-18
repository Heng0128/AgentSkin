# static-vs-CDP gap — workbuddy

- **static version**: 5.3.14 | **CDP source**: file:///C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html
- **rootVar 来源形态**: distributed

## 统计

| 项 | 静态 asar | CDP 运行时 | 缺口 |
|----|----------|-----------|------|
| token 命名空间 | 341 | 48 | 293 |
| data-testid 锚点 | 44 | 0（命中） | 1（未验证） |

## 盲区 token 命名空间（静态有、CDP rootVars 无）— 293 个

| 命名空间 | 变量数 | 样本变量 | 成因提示 |
|---------|-------|---------|---------|
| `--td-*` | 249 | `td-brand-color-1, td-brand-color-2, td-brand-color-3, td-brand-color-4, td-brand-color-5, td-brand-color-6 …` | 脚手架/独立功能库变量——大概率未加载 chunk，非当前渲染面，CDP 看不到属预期，无需补采 |
| `--color-*` | 75 | `color, color-slider-track, color-selection, color-icon-white, color-primary, color-primary-darker …` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--base-*` | 36 | `base-menu-item-padding-left, base-button-classic-active-padding-top, base-button-height, base-menu-content-padding, base-menu-item-padding-right, base-menu-item-height …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--accent-*` | 28 | `accent-1, accent-2, accent-3, accent-4, accent-5, accent-6 …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--focus-*` | 25 | `focus-highlight-color, focus-1, focus-2, focus-3, focus-4, focus-5 …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--project-*` | 23 | `project-plan-column-accent, project-plan-subtodos-accent, project-plan-column-count, project-experts-surface, project-experts-surface-hover, project-experts-border …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--button-*` | 18 | `button-ghost-padding-x, button-ghost-padding-y, button-bg, button-hover-bg, button-border, button-active-bg …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--font-*` | 15 | `font-size-slider-thumb, font-size-slider-thumb-border, font-size-1, font-size-2, font-size-3, font-size-4 …` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--heading-*` | 15 | `heading-font-family, heading-font-size-adjust, heading-font-style, heading-leading-trim-start, heading-leading-trim-end, heading-letter-spacing …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--colleague-*` | 13 | `colleague-card-accent, colleague-card-accent-deep, colleague-card-tint, colleague-detail-online-dot-color, colleague-detail-border, colleague-status-idle-color …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--default-*` | 13 | `default, default-bg-color, default-button-size, default-icon-size, default-border-color, default-font-family …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--stp-*` | 13 | `stp-bg, stp-fg, stp-border, stp-hljs-comment, stp-hljs-keyword, stp-hljs-string …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--security-*` | 12 | `security-center-card-bg, security-center-row-bg, security-center-border, security-center-hover-bg, security-center-sandbox-switch-gap, security-center-sandbox-switch-offset-y …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--space-*` | 11 | `space, space-factor, space-1, space-2, space-3, space-4 …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--inset-*` | 11 | `inset-border-radius-calc, inset-padding-top-calc, inset-padding-right-calc, inset-padding-bottom-calc, inset-padding-left-calc, inset-padding-top …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--checkbox-*` | 11 | `checkbox-size, checkbox-indicator-size, checkbox-border-radius, checkbox-cards-item-padding-top, checkbox-cards-item-padding-bottom, checkbox-cards-item-padding-left …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--artifact-*` | 11 | `artifact-tab-strip-bg, artifact-tab-list-edge-inset, artifact-tab-idle-bg, artifact-tab-idle-border, artifact-tab-idle-foreground, artifact-tab-hover-bg …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--radius-*` | 10 | `radius-factor, radius-full, radius-thumb, radius, radius-1, radius-2 …` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--sidebar-*` | 10 | `sidebar-next-panel-motion-duration, sidebar-next-panel-motion-easing, sidebar-next-window-control-inset, sidebar-shadow, sidebar-border-color, sidebar-bg-color …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--idle-*` | 10 | `idle-cap-accent-text, idle-cap-action-text, idle-cap-action-text-disabled, idle-cap-divider, idle-cap-list-border, idle-cap-card-border …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--switch-*` | 10 | `switch-height, switch-border-radius, switch-surface-checked-active-filter, switch-disabled-blend-mode, switch-high-contrast-checked-color-overlay, switch-high-contrast-checked-active-before-filter …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--line-*` | 10 | `line-height, line-height-1, line-height-2, line-height-3, line-height-4, line-height-5 …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--letter-*` | 10 | `letter-spacing, letter-spacing-1, letter-spacing-2, letter-spacing-3, letter-spacing-4, letter-spacing-5 …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--code-*` | 10 | `code-variant-font-size-adjust, code-font-family, code-font-size-adjust, code-font-style, code-font-weight, code-letter-spacing …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scrollarea-*` | 10 | `scrollarea-scrollbar-size, scrollarea-scrollbar-border-radius, scrollarea-scrollbar-horizontal-margin-left, scrollarea-scrollbar-horizontal-margin-right, scrollarea-scrollbar-vertical-margin-top, scrollarea-scrollbar-vertical-margin-bottom …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--data-*` | 10 | `data-list-value-trim-start, data-list-value-trim-end, data-list-first-item-value-trim-start, data-list-last-item-value-trim-end, data-list-value-margin-top, data-list-value-margin-bottom …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--input-*` | 9 | `input-bg-color, input-border-color, input-hover-bg-color, input-label-color, input-focus-border-color, input-unfocused-border-color …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--select-*` | 9 | `select-trigger-height, select-trigger-ghost-padding-x, select-trigger-ghost-padding-y, select-content-padding, select-item-height, select-item-indicator-width …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--cursor-*` | 9 | `cursor-button, cursor-checkbox, cursor-disabled, cursor-link, cursor-menu-item, cursor-radio …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--tab-*` | 9 | `tab-height, tab-padding-x, tab-inner-padding-x, tab-inner-padding-y, tab-inner-border-radius, tab-active-letter-spacing …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--quota-*` | 9 | `quota-toast-bg, quota-toast-border, quota-toast-text-primary, quota-toast-text-secondary, quota-toast-text-tertiary, quota-toast-hover-bg …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--shadow-*` | 8 | `shadow-1, shadow-2, shadow-3, shadow-4, shadow-5, shadow-6 …` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--logo-*` | 8 | `logo-icon--xs, logo-text--xs, logo-icon--small, logo-text--small, logo-icon--normal, logo-text--normal …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--progress-*` | 8 | `progress-height, progress-indicator-indeterminate-animation-start, progress-indicator-indeterminate-animation-repeat, progress, progress-indicator-after-linear-gradient, progress-value …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--margin-*` | 8 | `margin-top, margin-right, margin-bottom, margin-left, margin-top-override, margin-right-override …` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--tool-*` | 8 | `tool-ui-text-primary, tool-ui-text-secondary, tool-ui-bg-primary, tool-ui-bg-secondary, tool-ui-bg-tertiary, tool-ui-border-light …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--variant-*` | 7 | `variant-outline, variant-base, variant-text, variant-dashed, variant-filled, variant-outlined …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--claw-*` | 6 | `claw-welcome-activity-title-gradient, claw-agent-chat-content-max-width, claw-sidebar-pin-tooltip-arrow-height, claw-welcome-activity-description-collapsed-height, claw-welcome-activity-accent, claw-welcome-activity-accent-hover` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--hover-*` | 6 | `hover-underline, hover-color, hover-card-content-padding, hover, hover-highlight, hover-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--skeleton-*` | 6 | `skeleton, skeleton-animation-gradient, skeleton-height-override, skeleton-radius-override, skeleton-radius, skeleton-height` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--container-*` | 6 | `container-padding-y, container-padding-x, container-1, container-2, container-3, container-4` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--settings-*` | 6 | `settings-surface, settings-border, settings-title, settings-body, settings-muted, settings-accent` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--memory-*` | 6 | `memory-modal-surface, memory-modal-card, memory-modal-field, memory-modal-divider, memory-modal-primary-button-bg, memory-modal-primary-button-fg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--radio-*` | 6 | `radio-cards-item-padding-x, radio-cards-item-padding-y, radio-cards-item-border-radius, radio-size, radio-cards-item-border-width, radio-cards-item-background-color` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--eb-*` | 6 | `eb-border, eb-bg, eb-accent, eb-retry-bg, eb-retry-text, eb-text-secondary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--card-*` | 5 | `card-padding, card-border-radius, card, card-border-width, card-background-color` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--fixed-*` | 5 | `fixed-left-last, fixed-right-first, fixed-left, fixed-right, fixed` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--icon-*` | 5 | `icon-button-ghost-padding, icon-fill-color, icon, icon-green-fill-color, icon-only` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--slider-*` | 5 | `slider-track-size, slider-range-high-contrast-background-image, slider-thumb-box-shadow, slider-thumb-size, slider-disabled-blend-mode` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--models-*` | 5 | `models-surface, models-border, models-title, models-body, models-muted` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--strong-*` | 5 | `strong-font-family, strong-font-size-adjust, strong-font-style, strong-font-weight, strong-letter-spacing` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--em-*` | 5 | `em-font-family, em-font-size-adjust, em-font-style, em-font-weight, em-letter-spacing` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--quote-*` | 5 | `quote-font-family, quote-font-size-adjust, quote-font-style, quote-font-weight, quote-letter-spacing` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--table-*` | 5 | `table-border-radius, table-cell-padding, table-cell-min-height, table-row-background-color, table-row-box-shadow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--with-*` | 4 | `with-tag, with-text, with-text-left, with-text-right` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--highlight-*` | 4 | `highlight, highlight-bg-color, highlight-selected-bg-color, highlight-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--avatar-*` | 4 | `avatar-size, avatar-fallback-one-letter-font-size, avatar-fallback-two-letters-font-size, avatar-border-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--userlist-*` | 4 | `userlist-hint-bg-color, userlist-hint-heading-color, userlist-hint-text-color, userlist-collaborators-border-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--popup-*` | 4 | `popup-secondary-bg-color, popup-text-color, popup-text-inverted-color, popup-bg-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--link-*` | 3 | `link, link-color, link-outline` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--active-*` | 3 | `active, active-start, active-end` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dropdown-*` | 3 | `dropdown-padding-top, dropdown-padding-bottom, dropdown-icon` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--animation-*` | 3 | `animation-gradient, animation-duration, animation-direction` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--spinner-*` | 3 | `spinner-color, spinner-opacity, spinner-animation-duration` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--border-*` | 3 | `border-color, border-radius-md, border-radius-lg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--preview-*` | 3 | `preview-padding, preview-fullscreen-motion-duration, preview-fullscreen-motion-easing` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--mask-*` | 3 | `mask-top, mask-bottom, mask` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--try-*` | 3 | `try-loading, try, try-standalone` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--segmented-*` | 3 | `segmented-control-border-radius, segmented-control-indicator-background-color, segmented-control-transition-duration` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--markdown-*` | 3 | `markdown-content-gap, markdown-list-padding-left, markdown-line-gap` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--create-*` | 2 | `create, create-colleague-control-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--back-*` | 2 | `back-color, back` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--tip-*` | 2 | `tip-top, tip-bottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--background-*` | 2 | `background, background-color-badge` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dialog-*` | 2 | `dialog-content-padding, dialog-border-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--overlay-*` | 2 | `overlay-bg-color, overlay` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--lg-*` | 2 | `lg-button-size, lg-icon-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scrollbar-*` | 2 | `scrollbar-thumb, scrollbar-thumb-hover` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--workbuddy-*` | 2 | `workbuddy, workbuddy-collapsed` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--closable-*` | 2 | `closable-close, closable-wrapper` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--has-*` | 2 | `has-overflow, has-overflow-bottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--image-*` | 2 | `image-preview-motion-duration, image-preview-motion-curve` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--fade-*` | 2 | `fade-right, fade-left` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--leading-*` | 2 | `leading-trim-start, leading-trim-end` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--react-*` | 2 | `react-pdf-annotation-layer, react-pdf-text-layer` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--todo-*` | 2 | `todo-delegate-head-angle, todo-delegate-head-stroke` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--automation-*` | 2 | `automation-connector-picker-bg, automation-connector-picker-selected-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--installed-*` | 2 | `installed-list-mode, installed` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--loading-*` | 1 | `loading` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ghost-*` | 1 | `ghost` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--filled-*` | 1 | `filled` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--compact-*` | 1 | `compact` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--archivable-*` | 1 | `archivable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--archived-*` | 1 | `archived` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--primary-*` | 1 | `primary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--top-*` | 1 | `top` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scrollable-*` | 1 | `scrollable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--clickable-*` | 1 | `clickable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--danger-*` | 1 | `danger` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pending-*` | 1 | `pending` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--expanded-*` | 1 | `expanded` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--completed-*` | 1 | `completed` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--selected-*` | 1 | `selected` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--outline-*` | 1 | `outline` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--solid-*` | 1 | `solid` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--info-*` | 1 | `info` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--success-*` | 1 | `success` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--warning-*` | 1 | `warning` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--error-*` | 1 | `error` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--empty-*` | 1 | `empty` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--monaco-*` | 1 | `monaco-monospace-font` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ripple-*` | 1 | `ripple-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--borderless-*` | 1 | `borderless` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--suffix-*` | 1 | `suffix` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--finish-*` | 1 | `finish` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--process-*` | 1 | `process` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--disabled-*` | 1 | `disabled` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--check-*` | 1 | `check` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dark-*` | 1 | `dark` | VS Code 可变色（inline/style 变量），CDP rootVars 收集不到——常见盲区 |
| `--checked-*` | 1 | `checked` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--break-*` | 1 | `break-line` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--auto-*` | 1 | `auto-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiple-*` | 1 | `multiple` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--more-*` | 1 | `more` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--obvious-*` | 1 | `obvious` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bordered-*` | 1 | `bordered` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--striped-*` | 1 | `striped` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--hoverable-*` | 1 | `hoverable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--editable-*` | 1 | `editable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--column-*` | 1 | `column-resizable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--plain-*` | 1 | `plain` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scroll-*` | 1 | `scroll` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--left-*` | 1 | `left` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--right-*` | 1 | `right` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bottom-*` | 1 | `bottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--fullscreen-*` | 1 | `fullscreen` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--draggable-*` | 1 | `draggable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--level-*` | 1 | `level` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--hscale-*` | 1 | `hscale` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--iconSize-*` | 1 | `iconSize` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--first-*` | 1 | `first` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--leaf-*` | 1 | `leaf` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dashed-*` | 1 | `dashed` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--timePickerPanelOffsetTop-*` | 1 | `timePickerPanelOffsetTop` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--timePickerPanelOffsetBottom-*` | 1 | `timePickerPanelOffsetBottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--required-*` | 1 | `required` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--range-*` | 1 | `range` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--additional-*` | 1 | `additional` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--item-*` | 1 | `item` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--focused-*` | 1 | `focused` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--square-*` | 1 | `square` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--keybinding-*` | 1 | `keybinding-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--padding-*` | 1 | `padding` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--no-*` | 1 | `no-focus-visible` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--list-*` | 1 | `list-border-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ui-*` | 1 | `ui-font` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--readonly-*` | 1 | `readonly` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--offset-*` | 1 | `offset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--gap-*` | 1 | `gap` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--at-*` | 1 | `at-bottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--color-*` | 1 | `ExcTextField--color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--label-color-*` | 1 | `ExcTextField--label-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--background-*` | 1 | `ExcTextField--background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--readonly--background-*` | 1 | `ExcTextField--readonly--background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--readonly--color-*` | 1 | `ExcTextField--readonly--color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--border-*` | 1 | `ExcTextField--border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--readonly--border-*` | 1 | `ExcTextField--readonly--border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--border-hover-*` | 1 | `ExcTextField--border-hover` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--border-active-*` | 1 | `ExcTextField--border-active` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ExcTextField--placeholder-*` | 1 | `ExcTextField--placeholder` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-background-*` | 1 | `RadioGroup-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-border-*` | 1 | `RadioGroup-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-color-off-*` | 1 | `RadioGroup-choice-color-off` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-color-off-hover-*` | 1 | `RadioGroup-choice-color-off-hover` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-background-off-*` | 1 | `RadioGroup-choice-background-off` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-background-off-active-*` | 1 | `RadioGroup-choice-background-off-active` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-color-on-*` | 1 | `RadioGroup-choice-color-on` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-background-on-*` | 1 | `RadioGroup-choice-background-on` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-background-on-hover-*` | 1 | `RadioGroup-choice-background-on-hover` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--RadioGroup-choice-background-on-active-*` | 1 | `RadioGroup-choice-background-on-active` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-disabled-color-*` | 1 | `Switch-disabled-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-disabled-toggled-background-*` | 1 | `Switch-disabled-toggled-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-disabled-border-*` | 1 | `Switch-disabled-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-track-background-*` | 1 | `Switch-track-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-thumb-background-*` | 1 | `Switch-thumb-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-hover-background-*` | 1 | `Switch-hover-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--Switch-active-background-*` | 1 | `Switch-active-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ImageExportModal-preview-border-*` | 1 | `ImageExportModal-preview-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--avatarList-gap-*` | 1 | `avatarList-gap` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--userList-padding-*` | 1 | `userList-padding` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--max-*` | 1 | `max-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--size-*` | 1 | `size` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--island-*` | 1 | `island-bg-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--editor-*` | 1 | `editor-container-padding` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--modal-*` | 1 | `modal-shadow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--library-*` | 1 | `library-dropdown-shadow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-canvas-*` | 1 | `zIndex-canvas` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-interactiveCanvas-*` | 1 | `zIndex-interactiveCanvas` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-svgLayer-*` | 1 | `zIndex-svgLayer` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-wysiwyg-*` | 1 | `zIndex-wysiwyg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-canvasButtons-*` | 1 | `zIndex-canvasButtons` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-layerUI-*` | 1 | `zIndex-layerUI` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-eyeDropperBackdrop-*` | 1 | `zIndex-eyeDropperBackdrop` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-eyeDropperPreview-*` | 1 | `zIndex-eyeDropperPreview` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-hyperlinkContainer-*` | 1 | `zIndex-hyperlinkContainer` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-modal-*` | 1 | `zIndex-modal` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-popup-*` | 1 | `zIndex-popup` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--zIndex-toast-*` | 1 | `zIndex-toast` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sab-*` | 1 | `sab` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sal-*` | 1 | `sal` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sar-*` | 1 | `sar` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sat-*` | 1 | `sat` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bar-*` | 1 | `bar-padding` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--secondary-*` | 1 | `secondary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--selectable-*` | 1 | `selectable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--grey-*` | 1 | `grey` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--status-*` | 1 | `status-error` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--elevated-*` | 1 | `elevated` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--outlined-*` | 1 | `outlined` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--invalid-*` | 1 | `invalid` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--indeterminate-*` | 1 | `indeterminate` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--incompatible-*` | 1 | `incompatible` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--cancellable-*` | 1 | `cancellable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--reset-*` | 1 | `reset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--connector-*` | 1 | `connector-fade-solid` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--mac-*` | 1 | `mac` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--workspace-*` | 1 | `workspace` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--confirm-*` | 1 | `confirm` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--cancel-*` | 1 | `cancel` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--user-*` | 1 | `user-menu-hover-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--nc-*` | 1 | `nc-tone` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--light-*` | 1 | `light` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--coming-*` | 1 | `coming-soon` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--muted-*` | 1 | `muted` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--delete-*` | 1 | `delete` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--approve-*` | 1 | `approve` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--cloud-*` | 1 | `cloud-assistant-child` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--batch-*` | 1 | `batch` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--medium-*` | 1 | `medium` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--small-*` | 1 | `small` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--picked-*` | 1 | `picked` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ima-*` | 1 | `ima-scroll-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sheet-*` | 1 | `sheet` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--narrow-*` | 1 | `narrow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--kbd-*` | 1 | `kbd-box-shadow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--backdrop-*` | 1 | `backdrop-filter-panel` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scaling-*` | 1 | `scaling` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--callout-*` | 1 | `callout-icon-height` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--popover-*` | 1 | `popover-content-padding` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--separator-*` | 1 | `separator-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--reject-*` | 1 | `reject` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--truncated-*` | 1 | `truncated` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--working-*` | 1 | `working` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--article-*` | 1 | `article` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--flagship-*` | 1 | `flagship` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--resizable-*` | 1 | `resizable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--action-*` | 1 | `action` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sticky-*` | 1 | `sticky` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--closeable-*` | 1 | `closeable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--name-*` | 1 | `name` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--time-*` | 1 | `time` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--close-*` | 1 | `close` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--full-*` | 1 | `full` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--current-*` | 1 | `current` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--folder-*` | 1 | `folder` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--openable-*` | 1 | `openable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--annotation-*` | 1 | `annotation-unfocused-field-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--collab-*` | 1 | `collab-active` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--running-*` | 1 | `running` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--comment-*` | 1 | `comment` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--md-*` | 1 | `md` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--test-*` | 1 | `test` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--updating-*` | 1 | `updating` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--update-*` | 1 | `update` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--skip-*` | 1 | `skip` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--upgrade-*` | 1 | `upgrade` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--exceed-*` | 1 | `exceed-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pseudo-*` | 1 | `pseudo-element-display` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--custom-*` | 1 | `custom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--static-*` | 1 | `static` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--on-*` | 1 | `on` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--menu-*` | 1 | `menu-shadow-fallback` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--allow-*` | 1 | `allow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--always-*` | 1 | `always-allow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--deny-*` | 1 | `deny` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--tree-*` | 1 | `tree` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--expert-*` | 1 | `expert-accent` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pin-*` | 1 | `pin` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pinned-*` | 1 | `pinned` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--drag-*` | 1 | `drag-clone` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--done-*` | 1 | `done` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sortable-*` | 1 | `sortable` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--editing-*` | 1 | `editing` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |

## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— 1 个

> 可能是语义锚点，但当前 CDP 快照未在 anchors 采样中暴露；需确认是否因懒加载 / 封闭 shadow root 未渲染。

```text
virtuoso-scroller
```