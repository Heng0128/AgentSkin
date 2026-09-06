# static-vs-CDP gap — codex

- **static version**: 26.814.41407 | **CDP source**: 26.814.41407
- **rootVar 来源形态**: root

## 统计

| 项 | 静态 asar | CDP 运行时 | 缺口 |
|----|----------|-----------|------|
| token 命名空间 | 114 | 51 | 66 |
| data-testid 锚点 | 221 | 0（命中） | 6（未验证） |

## 盲区 token 命名空间（静态有、CDP rootVars 无）— 66 个

| 命名空间 | 变量数 | 样本变量 | 成因提示 |
|---------|-------|---------|---------|
| `--learning-*` | 16 | `learning-block-accent-surface, learning-block-color-blue, learning-block-color-green, learning-block-color-yellow, learning-block-color-orange, learning-block-color-purple …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--button-*` | 16 | `button-text-color, button-ring-color, button-background-color-active, button-background-color, button-background-color-hover, button-gutter …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--referral-*` | 9 | `referral-rate-limit-border, referral-rate-limit-check-background, referral-rate-limit-input-background, referral-rate-limit-secondary, referral-rate-limit-success-background, referral-rate-limit-success-foreground …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sidebar-*` | 9 | `sidebar-scroll-footer-fade-distance, sidebar-scroll-header-mask-distance, sidebar-footer-height, sidebar-customization-row-height, sidebar-customization-height, sidebar-scroll-footer-edge …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--activity-*` | 9 | `activity-pill-content-padding-right, activity-pill-fade-transparent-inset, activity-pill-control-size, activity-pill-control-gap, activity-pill-edge-inset, activity-pill-status-inline-padding …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--model-*` | 9 | `model-picker-power-slider-mode-transition-duration, model-picker-power-slider-tick-transform-duration, model-picker-power-slider-max-fill-mask-position, model-picker-power-slider-motion-duration, model-picker-power-slider-tick-opacity-delay, model-picker-power-slider-tick-translate-duration …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--select-*` | 8 | `select-control-radius, select-control-size, select-control-gutter, select-control-font-size, select-control-gap, select-control-background-color …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dropdown-*` | 7 | `dropdown-icon-offset, dropdown-icon-pill-offset, dropdown-icon-width, dropdown-icon-height, dropdown-chevron-icon-width, dropdown-chevron-icon-height …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bg-*` | 6 | `bg-primary, bg-secondary, bg-tertiary, bg-elevated-primary, bg-elevated-secondary, bg-tooltip` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--clear-*` | 6 | `clear-size, clear-icon-size, clear-iso-size, clear-iso-icon-size, clear-iso-offset, clear-iso-pill-offset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--border-*` | 5 | `border-light, border-medium, border-default, border-subtle, border-heavy` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--openai-*` | 5 | `openai-blossom-shimmer-highlight, openai-blossom-shimmer-base, openai-blossom-shimmer-soft, openai-blossom-shimmer-peak, openai-blossom-shimmer-tail` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--inline-*` | 4 | `inline-mention-color, inline-mention-base-color, inline-mention-dark-base-color, inline-mention-resolved-base-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--wide-*` | 4 | `wide-block-width, wide-block-container-max-width, wide-block-panel-max-width, wide-block-default-max-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--loading-*` | 4 | `loading-placeholder-peak, loading-placeholder-base, loading-results-shimmer-base, loading-results-shimmer-highlight` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--marquee-*` | 4 | `marquee-speed-em-per-second, marquee-gap, marquee-left-fade, marquee-right-fade` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--detail-*` | 4 | `detail-page-inline-inset, detail-page-section-gap, detail-property-label-width, detail-row-font-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--icon-*` | 3 | `icon-accent, icon-tertiary, icon-warning` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--indicator-*` | 3 | `indicator-size, indicator-wrapper-gap, indicator-wrapper-gutter` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--start-*` | 3 | `start-icon-size, start-icon-offset, start-icon-pill-offset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--particle-*` | 3 | `particle-x, particle-y, particle-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--quick-*` | 3 | `quick-chat-window-footer-fade-height, quick-chat-floating-inset, quick-chat-floating-radius` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--main-*` | 2 | `main-surface-secondary, main-surface-primary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--shimmer-*` | 2 | `shimmer-contrast, shimmer-text-secondary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--ready-*` | 2 | `ready-pulse-from, ready-pulse-to` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--command-*` | 2 | `command-menu-list-max-height, command-menu-max-height` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--lightningcss-*` | 2 | `lightningcss-light, lightningcss-dark` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--image-*` | 2 | `image-transparency-backdrop-primary, image-transparency-backdrop-secondary` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--alpha-*` | 2 | `alpha-05, alpha-10` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--avatar-*` | 2 | `avatar-overlay-native-corner-radius, avatar-overlay-css-material-elevation` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--scale-*` | 2 | `scale, scale-factor` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--cell-*` | 2 | `cell-size, cell-vertical-gutter` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--hotkey-*` | 2 | `hotkey-window-home-shell-radius, hotkey-window-home-shell-shadow` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--selection-*` | 2 | `selection-background-color, selection-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--contains-*` | 2 | `contains-highlight-background-color, contains-highlight-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--graphable-*` | 2 | `graphable-controls-max-height, graphable-sliders-max-height` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pocket-*` | 2 | `pocket-border-opacity, pocket-surface-opacity` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--edge-*` | 1 | `edge-fade-distance` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--mermaid-*` | 1 | `mermaid-surface-background` | 脚手架/独立功能库变量——大概率未加载 chunk，非当前渲染面，CDP 看不到属预期，无需补采 |
| `--duration-*` | 1 | `duration` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--magic-*` | 1 | `magic-edit-selection-padding-y` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--header-*` | 1 | `header-tint` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--app-*` | 1 | `app-shell-main-content-frame-top-offset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--white-*` | 1 | `white` | 色板变量——Radix 可着色基底；若出现在盲区需比对具体取值，一般已由 CDP 运行时覆盖 |
| `--black-*` | 1 | `black` | 色板变量——Radix 可着色基底；若出现在盲区需比对具体取值，一般已由 CDP 运行时覆盖 |
| `--pr-*` | 1 | `pr-status-dot-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--pricing-*` | 1 | `pricing-plan-highlight` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--rolling-*` | 1 | `rolling-number-y-offset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sectioned-*` | 1 | `sectioned-page-leading-inset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--task-*` | 1 | `task-row-trailing-inset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--turn-*` | 1 | `turn-diff-row-padding-y` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--constant-*` | 1 | `constant-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--theme-*` | 1 | `theme-user-selection-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--circular-*` | 1 | `circular-progress-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--user-*` | 1 | `user-unit` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--total-*` | 1 | `total-scale-factor` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--profile-*` | 1 | `profile-loading-shimmer-highlight` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--marker-*` | 1 | `marker-progress` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--token-*` | 1 | `token-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--subunit-*` | 1 | `subunit-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--linkage-*` | 1 | `linkage-gap` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--water-*` | 1 | `water-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--caret-*` | 1 | `caret-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--smart-*` | 1 | `smart-fence-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--whole-*` | 1 | `whole-grid-overhead` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--mature-*` | 1 | `mature-unit` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |

## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— 6 个

> 可能是语义锚点，但当前 CDP 快照未在 anchors 采样中暴露；需确认是否因懒加载 / 封闭 shadow root 未渲染。

```text
popcorn-annotation-editor
math-block-layout-content
popcorn-viewport-host
popcorn-edit-toolbar
popcorn-find-bar
popcorn-presentation-stage
```