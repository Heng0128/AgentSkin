# AgentSkin 主题规范 (v2)

## 概述

AgentSkin 主题由**调色板**（颜色变量定义）+ **共享基础 CSS**（结构性选择器）组成。
新增主题只需填写颜色变量，无需重复编写选择器逻辑。

## 文件结构

```
themes/
├── _shared/                    # 共享基础层（勿直接修改主题时改这里）
│   ├── traework.base.css       # TRAE SOLO CN 结构性规则
│   ├── workbuddy.base.css      # WorkBuddy 结构性规则
│   ├── qoderwork.base.css      # QoderWork CN 结构性规则
│   ├── doubao.base.css         # 豆包 结构性规则 (--dbx-* 251 token 覆写)
│   └── palette.css             # 调色板模板（复制用）
├── your-theme/
│   ├── manifest.json           # 主题清单
│   ├── icon.png                # 主题图标 (128×128)
│   ├── preview.png             # 预览图 (640×400)
│   ├── assets/
│   │   ├── hero.webp           # 背景图 (1920×1080, 可选)
│   │   └── css/
│   │       ├── traework.css    # = @import base + :root { 变量 }
│   │       ├── workbuddy.css
│   │       ├── qoderwork.css
│   │       └── doubao.css
```

## 变量契约

每个主题的 CSS **必须**定义以下 14 个变量（在 `:root` 中）：

| 变量 | 用途 | 暗色建议 | 亮色建议 |
|------|------|----------|----------|
| `--agentskin-accent` | 主强调色 | 中高亮度 | 中饱和度 |
| `--agentskin-secondary` | 次强调色 | 与 accent 互补 | 与 accent 互补 |
| `--agentskin-bg` | 全局背景 | 深 (≤15% 亮度) | 浅 (≥90% 亮度) |
| `--agentskin-surface` | 表面色 | 比 bg 略亮 | 接近白 |
| `--agentskin-surface-elevated` | 提升表面 | 比 surface 略亮 | 纯白 |
| `--agentskin-text` | 主文本 | 高亮度 (≥85%) | 深色 (≤30%) |
| `--agentskin-muted` | 次要文本 | 中亮度 | 中低饱和度 |
| `--agentskin-border` | 边框 | accent + alpha | accent + alpha |
| `--agentskin-code-bg` | 代码背景 | 比 bg 暗或亮 | 比 bg 略灰 |
| `--agentskin-code-fg` | 代码前景 | accent 浅化 | accent 深化 |
| `--agentskin-input-bg` | 输入框背景 | 同 surface | 纯白 |
| `--agentskin-button-bg` | 按钮底色 | accent + alpha | accent + alpha |
| `--agentskin-focus-ring` | 焦点环 | accent + 60% alpha | accent + 60% alpha |
| `--agentskin-selection` | 文本选区 | accent + 32% alpha | accent + 32% alpha |

`color-scheme` 必须与 `manifest.json` 的 `mode` 字段一致（`dark` 或 `light`）。

## @import 机制

主题 CSS 第一行用 `@import` 引入共享 base，后面跟 `:root` 变量定义：

```css
@import "../_shared/traework.base.css";

:root {
  color-scheme: dark !important;
  --agentskin-accent: #a78bfa;
  --agentskin-secondary: #f9a8d4;
  /* ... 14 个变量 ... */
}

/* 可选：主题特有覆盖 */
```

seed 时 `theme-installer` 自动将 `@import` 内联为 base CSS 内容。
- base CSS 变了 → contentHash 变化 → 自动重新 seed 所有主题
- 主题只需写 ~20 行，不用重复 300+ 行选择器

**安全限制**：只内联路径包含 `_shared/` 且以 `.base.css` 结尾的 @import，且解析路径必须在 `themes/` 根目录下。

## 新增主题步骤

1. 复制 `_shared/palette.css` 四份，分别命名 `traework.css` / `workbuddy.css` / `qoderwork.css` / `doubao.css`
2. 每个 CSS 文件顶部加 `@import "../_shared/<agent>.base.css";`
3. 填入 14 个 `--agentskin-*` 变量值
4. 编写 `manifest.json`（参考现有主题）
5. 准备 `icon.png` (128×128) + `preview.png` (640×400) + `assets/hero.webp` (可选)
6. 放入 `themes/<your-theme>/` 目录

重启 AgentSkin 即自动 seed。

## 修改全局选择器

如需修复选择器 bug 或调整布局规则，**只改 `themes/_shared/*.base.css`**。
所有主题在下次 seed 时自动应用变更（contentHash 机制触发重装）。

**不要**在单个主题的 CSS 里重复结构性选择器，那会绕过共享层导致不一致。

## 暗色 / 亮色规则

- `manifest.json` 的 `mode` 字段决定主题在 UI 中的分类
- CSS 的 `color-scheme` 必须与 mode 一致
- 亮色主题：`--agentskin-bg` ≥ 90% 亮度，`--agentskin-text` ≤ 30% 亮度
- 暗色主题：`--agentskin-bg` ≤ 15% 亮度，`--agentskin-text` ≥ 85% 亮度
- `--agentskin-surface` 总是比 `--agentskin-bg` 更接近文本色的反方向
- 亮色主题的 `--agentskin-surface` 通常为 `#ffffff`

## manifest.json 必填字段

```json
{
  "schemaVersion": 2,
  "id": "your-theme",
  "name": "Your Theme",
  "displayName": "中文显示名",
  "version": "1.0.0",
  "description": "主题描述",
  "mode": "dark",
  "targets": {
    "traework": { "css": "assets/css/traework.css", "verification": { ... } },
    "qoderwork": { "css": "assets/css/qoderwork.css", "verification": { ... } },
    "workbuddy": { "css": "assets/css/workbuddy.css", "verification": { ... } },
    "doubao": { "css": "assets/css/doubao.css", "verification": { ... } }
  },
  "colors": { ... },
  "preview": "preview.png",
  "icon": "icon.png",
  "supportedAgents": ["traework", "qoderwork", "workbuddy", "doubao"],
  "hero": "assets/hero.webp"
}
```

`verification` 块参考现有主题的 manifest.json。

## 探针样式契约 (Probe Style Contract)

CDP 样式探针（`buildDomSnapshotExpression`，**权威副本位于 `src/main/cdp/dom-snapshot.mjs`**，由 `scripts/sync-engine-probe.mjs` 在 dev/build 前同步进 `@codedrobe/core` 引擎）读取的样式集合，即主题**必须能被观测到**的样式全集。本契约是主题接口规范的组成部分，并机读化于 `docs/manifest-v2.schema.json` 的 `$defs.ProbeStyleContract`。

### 1. 设计 token（CSS 自定义属性）捕获

探针捕获每个 DOM 节点**相对父节点 override** 的 `--*` 变量（即主题真正落地的 token）；根节点报告其全部自身 token（无父级可去重）；继承项自动跳过，避免 payload 膨胀。

各 agent 的设计 token 命名空间：

| Agent | token 命名空间 | 落地方式 |
|-------|---------------|----------|
| AgentSkin 品牌 | `--agentskin-*` | 主题 `:root` 变量（见「变量契约」14 个） |
| WorkBuddy | `--cb-*` | `workbuddy.base.css` 由 `--agentskin-*` 映射 |
| TRAE SOLO | `--vscode-*` | `traework.base.css` 由 `--agentskin-*` 映射 |
| QoderWork | `--color-*` (antd) | `qoderwork.base.css` 由 `--agentskin-*` 映射 |
| 豆包 | `--dbx-*` | `doubao.base.css`（251 token 覆写） |

> 主题只需声明 `--agentskin-*` 14 个变量，base 层负责映射到各 agent 引擎 token；探针通过 `customProperties` 直接读取最终生效的引擎 token，从而验证主题是否真正生效。

### 2. Computed-style 字段全集（75 个）

探针对命中的可见节点读取以下 computed-style 字段（机读列表见 schema `$defs.ProbeStyleContract.computedStyleFields`）：

- **布局 / 盒模型**：display, position, zIndex, boxSizing, flexDirection, alignItems, justifyContent, gap, padding, margin, width, height, minWidth, maxWidth, minHeight, maxHeight, overflowX, overflowY, gridTemplateColumns, gridTemplateRows, flex, flexWrap, flexGrow, flexShrink, flexBasis, alignSelf, justifySelf, objectFit
- **颜色 / 背景**：color, backgroundColor, backgroundImage, background, backgroundPosition, backgroundSize, backgroundRepeat, backgroundClip, backgroundOrigin, fill, stroke
- **边框 / 描边**：border, borderRadius, borderColor, borderWidth, borderStyle, borderTopColor, borderTopWidth, borderTopStyle, borderBottomColor, outline, outlineColor, outlineWidth, outlineStyle
- **阴影 / 特效**：boxShadow, textShadow, opacity, filter, backdropFilter, mixBlendMode, appearance, contentVisibility
- **文本**：fontFamily, fontSize, fontWeight, lineHeight, textAlign, textDecoration, textTransform, letterSpacing, wordSpacing, whiteSpace
- **交互 / 其他**：cursor, transition, transform, pointerEvents, userSelect

### 3. 主题包声明

每个主题 `manifest.json` 应含 `probe` 块，声明本主题贡献的 token 命名空间并指向本契约：

```json
{
  "probe": {
    "tokenNamespaces": ["--agentskin-", "--cb-", "--vscode-", "--color-", "--dbx-"],
    "styleContract": "THEME_SPEC.md#探针样式契约"
  }
}
```

完整字段定义见 `docs/manifest-v2.schema.json`（`probe` 属性与 `$defs.ProbeStyleContract`）。
