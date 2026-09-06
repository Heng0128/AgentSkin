# static-vs-CDP gap — zcode

- **static version**: 3.7.7 | **CDP source**: file:///C:/Program%20Files/ZCode/resources/app.asar/out/renderer/index.html?restoreSession=true&supportsSettings=true&zcodeLaunchMarks=%7B%22createdAt%22%3A1787041642532.9%2C%22mainStart%22%3A1787041644219%2C%22appReady%22%3A1787041645039%2C%22loadUrl%22%3A1787041647384%7D
- **rootVar 来源形态**: root

## 统计

| 项 | 静态 asar | CDP 运行时 | 缺口 |
|----|----------|-----------|------|
| token 命名空间 | 22 | 17 | 7 |
| data-testid 锚点 | 363 | 0（命中） | 3（未验证） |

## 盲区 token 命名空间（静态有、CDP rootVars 无）— 7 个

| 命名空间 | 变量数 | 样本变量 | 成因提示 |
|---------|-------|---------|---------|
| `--highlight-*` | 2 | `highlight-bg-color, highlight-selected-bg-color` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--markdown-*` | 2 | `markdown-table-layout-left-inset, markdown-table-layout-right-inset` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--react-*` | 1 | `react-pdf-text-layer` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--spacing-*` | 1 | `spacing` | 结构类 design-token（字级/圆角/间距/尺寸，非颜色主题）——Tailwind @theme 生成于 :root, :host 规则，CDP rootVars 可能因聚合提前返回漏采；不纳入注入作用域，可收敛 |
| `--attachment-*` | 1 | `attachment-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |
| `--bg-*` | 1 | `bg` | design-token 可能走 distributed/component-inline，非 :root 暴露——需核是否在核心渲染面 |
| `--side-*` | 1 | `side-pane-tab-bg` | 静态声明但其命名空间未见 CDP rootVars——可能来自未加载 chunk、封闭 shadow root、CORS 或 CSS-in-JS |

## 未验证 data-testid 锚点（静态有、CDP anchors 未见）— 3 个

> 可能是语义锚点，但当前 CDP 快照未在 anchors 采样中暴露；需确认是否因懒加载 / 封闭 shadow root 未渲染。

```text
chat-input
docx-editor-viewer
chat-view
```