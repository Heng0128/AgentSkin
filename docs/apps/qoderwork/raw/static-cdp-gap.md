# static-vs-CDP gap — qoderwork

- **static version**: 0.9.12 | **CDP source**: file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html
- **rootVar 来源形态**: distributed

## 统计

| 项 | 静态 asar | CDP 运行时 | 缺口 |
|----|----------|-----------|------|
| token 命名空间 | 31 | 9 | 25 |
| data-testid 锚点 | 5 | 0（命中） | 0（未验证） |

## 盲区 token 命名空间（静态有、CDP rootVars 无）— 25 个

| 命名空间 | 变量数 | 样本变量 | 成因提示 |
|---------|-------|---------|---------|
| `--text-*` | 14 | `text-xs, text-xs--line-height, text-sm, text-sm--line-height, text-base, text-base--line-height …` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--container-*` | 9 | `container-xs, container-sm, container-md, container-lg, container-xl, container-2xl …` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--mobile-*` | 7 | `mobile-app-star-size, mobile-app-star-duration, mobile-app-star-delay, mobile-app-star-origin-right, mobile-app-star-origin-bottom, mobile-app-star-x …` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--radius-*` | 6 | `radius-sm, radius-md, radius-lg, radius-xl, radius-2xl, radius` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--tracking-*` | 5 | `tracking-tight, tracking-normal, tracking-wide, tracking-wider, tracking-widest` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--default-*` | 4 | `default-transition-duration, default-transition-timing-function, default-font-family, default-mono-font-family` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--leading-*` | 3 | `leading-tight, leading-snug, leading-relaxed` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--ease-*` | 3 | `ease-in, ease-out, ease-in-out` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--blur-*` | 3 | `blur-sm, blur-md, blur-xl` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--normal-*` | 3 | `normal-bg, normal-text, normal-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--success-*` | 3 | `success-bg, success-border, success-text` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--info-*` | 3 | `info-bg, info-border, info-text` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--warning-*` | 3 | `warning-bg, warning-border, warning-text` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--error-*` | 3 | `error-bg, error-border, error-text` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--animate-*` | 2 | `animate-spin, animate-pulse` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--base-*` | 2 | `base-color, base-gradient-color` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |
| `--diff-*` | 2 | `diff-font-size--, diff-line-height--` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--spacing-*` | 1 | `spacing` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--drop-*` | 1 | `drop-shadow-lg` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--aspect-*` | 1 | `aspect-video` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bg-*` | 1 | `bg` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--cell-*` | 1 | `cell-size` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--sidebar-*` | 1 | `sidebar-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--border-*` | 1 | `border-radius` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--size-*` | 1 | `size` | Radix(.rt-)结构/尺寸 token——定义在组件规则内、非 :root 暴露；其可着色基底（--gray-/--black-/--white-）已在运行时 rootVars，结构 token 不纳入注入作用域，无需补采 |

## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— 0 个

_无_