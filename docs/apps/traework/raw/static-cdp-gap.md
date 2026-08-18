# static-vs-CDP gap — traework

- **static version**: 1.107.1 | **CDP source**: vscode-file://vscode-app/c:/Users/snowb/AppData/Local/Programs/TRAE%20SOLO%20CN/resources/app/out/vs/code/electron-browser/solo/solo-lite.html
- **rootVar 来源形态**: root

## 统计

| 项 | 静态 asar | CDP 运行时 | 缺口 |
|----|----------|-----------|------|
| token 命名空间 | 26 | 42 | 18 |
| data-testid 锚点 | 1 | 0（命中） | 0（未验证） |

## 盲区 token 命名空间（静态有、CDP rootVars 无）— 18 个

| 命名空间 | 变量数 | 样本变量 | 成因提示 |
|---------|-------|---------|---------|
| `--input-*` | 4 | `input-padding-vertical, input-padding-horizontal, input-margin-vertical, input-margin-horizontal` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--dropdown-*` | 2 | `dropdown-padding-top, dropdown-padding-bottom` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--color-*` | 2 | `color-icon-rect, color-icon-path` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--DarkMode-Line-line-1-*` | 1 | `DarkMode-Line-line-1` | VS Code 可变色（inline/style 变量），CDP rootVars 收集不到——常见盲区 |
| `--DarkMode-Bg-bg-tr-1-*` | 1 | `DarkMode-Bg-bg-tr-1` | VS Code 可变色（inline/style 变量），CDP rootVars 收集不到——常见盲区 |
| `--duplicate-*` | 1 | `duplicate` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-family-*` | 1 | `multiEdit-family` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-background-*` | 1 | `multiEdit-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-border-*` | 1 | `multiEdit-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-button-border-*` | 1 | `multiEdit-button-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-button-background-*` | 1 | `multiEdit-button-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-icon-hover-background-*` | 1 | `multiEdit-icon-hover-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-icon-line-border-*` | 1 | `multiEdit-icon-line-border` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-hint-background-*` | 1 | `multiEdit-hint-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--multiEdit-card-item-hover-background-*` | 1 | `multiEdit-card-item-hover-background` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--expanded-*` | 1 | `expanded-width` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--container-*` | 1 | `container-paddding` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--subtle-*` | 1 | `subtle-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |

## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— 0 个

_无_