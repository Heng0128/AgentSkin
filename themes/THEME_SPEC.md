# AgentSkin 主题规范 (v2)

> 版本: 2.1.0（重写，对齐实际流水线）
> 本文档描述**实际生效**的主题结构与生成/校验流程。若与 `docs/` 中任何旧设计文档冲突，以本文档 + `src/main/catalog/manifest-v2.schema.json`（权威 schema）为准。

## 概述

AgentSkin 主题 = **manifest 声明颜色** + **生成器产出各 agent CSS**。作者只需在 `manifest.json` 的 `colors` 里填 14 个设计 token，流水线自动为全部 6 个引擎生成适配 CSS；结构性选择器与引擎 token 映射由生成器统一维护，主题文件里**不需要**（也不应该）重复。

一个主题覆盖 6 个 agent：`traework` / `qoderwork` / `workbuddy` / `doubao` / `codex` / `zcode`。

## 文件结构

```
themes/<your-theme>/
├── manifest.json           # 主题清单（颜色 + 元数据 + targets）
├── icon.png                # 主题图标 (128×128)
├── preview.png             # 预览图 (1280×720)
├── hero.webp               # 背景艺术图 (1920×1080，可选；manifest.hero 引用)
├── palette.css             # 【生成物】12 核心 token + -raw 派生（勿手改）
└── assets/
    └── css/
        ├── traework.css    # 【生成物】traework 完整适配 CSS
        ├── qoderwork.css   # 【生成物】qoderwork 完整适配 CSS
        ├── workbuddy.css   # 【生成物】workbuddy 完整适配 CSS
        ├── doubao.css      # 【生成物】doubao 完整适配 CSS
        ├── codex.css       # 【生成物】codex 完整适配 CSS
        └── zcode.css       # 【生成物】zcode 完整适配 CSS
```

> **没有 `_shared/` 目录、没有 `@import` 机制。** 旧文档描述的"共享 base CSS + `@import` 内联"从未在代码中实现——当前流水线是生成器直接产字面量 CSS（见下）。

## 生成与校验流水线

```
manifest.json (colors 14 token)
   │  npm run generate:palette   → scripts/build-palette.mjs
   ▼
palette.css (12 核心 token + -raw 派生)
   │  npm run generate:theme-css → scripts/generate-theme-css.mjs
   ▼
assets/css/<agent>.css × 6（每个 agent 一份完整 CSS）
   │
   ▼
打包：scripts/build-theme-package.mjs → .agentskin-theme 包
校验：loader(运行时) + scripts/check-themes.mjs(pre-commit/CI)
```

- `npm run generate:themes` = `generate:palette` + `generate:theme-css`
- `npm run check:themes`（= `scripts/check-themes.mjs`）校验：manifest schema、targets CSS 存在、**每个 agent CSS 声明全部 14 个 `--agentskin-*` token**、`color-scheme` 与 `mode` 一致。
- `npm run generate:theme-css -- --verify` 检查已生成 CSS 是否过期（staleness 门禁，含在 `npm run check` 里）。
- `art: false` 的主题（纯 CSS 无背景图）跳过生成器，手动维护 CSS。

## 变量契约（14 个 `--agentskin-*`）

每个 agent CSS 的 `:root` **必须**声明以下 14 个变量：

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

> `--agentskin-art`（背景艺术图 URL）由运行时注入，主题不写死。
> `palette.css`（生成物）只含前 12 个核心 token + `-raw` RGB 派生；`button-bg`/`input-bg` 在生成器里从 accent/surface 派生，仅存在于 agent CSS 层——`check-themes` 据此分开校验两组契约。

`color-scheme` 必须与 `manifest.json` 的 `mode` 字段一致（`dark` 或 `light`）。

## manifest.json 契约

权威 schema：**`src/main/catalog/manifest-v2.schema.json`**（可打包 import，运行时由 `manifest-validator.ts` 硬校验；`docs/manifest-v2.schema.json` 只是逐字节同步的镜像）。

```json
{
  "$schema": "https://agentskin.dev/schema/manifest-v2.json",
  "schemaVersion": 2,
  "id": "your-theme",
  "name": "Your Theme",
  "displayName": "中文显示名",
  "version": "1.0.0",
  "description": "主题描述（必填，≥20 字）",
  "mode": "dark",
  "targets": {
    "traework":    { "css": "assets/css/traework.css" },
    "qoderwork":   { "css": "assets/css/qoderwork.css" },
    "workbuddy":   { "css": "assets/css/workbuddy.css" },
    "doubao":      { "css": "assets/css/doubao.css" },
    "codex":       { "css": "assets/css/codex.css" },
    "zcode":       { "css": "assets/css/zcode.css" }
  },
  "supportedAgents": ["traework", "qoderwork", "workbuddy", "doubao", "codex", "zcode"],
  "colors": {
    "accent": "#a78bfa",
    "secondary": "#f9a8d4",
    "background": "#0a0a14",
    "foreground": "#e8d5d5",
    "muted": "#7a6b75",
    "surface": "#222230",
    "surfaceElevated": "#2c2c3c",
    "border": "rgba(167, 139, 250, 0.18)",
    "codeBackground": "#0a0a14",
    "codeForeground": "#e8d5d5",
    "inputBackground": "#222230",
    "buttonBackground": "rgba(167, 139, 250, 0.2)",
    "buttonForeground": "#ffffff",
    "focusRing": "#a78bfa60"
  },
  "icon": "icon.png",
  "preview": "preview.png",
  "hero": "hero.webp",
  "author": { "name": "你" },
  "category": "minimal",
  "tags": ["dark", "minimal"],
  "license": "MPL-2.0",
  "probe": {
    "tokenNamespaces": ["--agentskin-", "--vscode-", "--color-", "--cb-", "--dbx-"],
    "styleContract": "THEME_SPEC.md#探针样式契约"
  }
}
```

### 校验规则（强制，错误带 JSON path）

1. **schema**（`manifest-validator.ts` 硬校验）：type/enum/required/pattern/oneOf/additionalProperties 等；`colors` 必须含 `background` + `foreground`。
2. **跨字段（SPEC-3）**：`targets` 键与 `supportedAgents` 条目必须是已知 agent id（6 个 active + experimental 适配器）——拼错即拒绝，防止"主题加载了但一个 agent 都没生效"。
3. **资源**（loader）：icon/preview/hero 必须存在且路径不逃逸包根。
4. **生成物**（`check-themes.mjs`）：targets CSS 存在 + 14 token 齐全 + color-scheme 与 mode 一致。

## 新增主题步骤

1. `mkdir themes/<your-theme>`，写 `manifest.json`（colors 填 14 token）——参考 `themes/naruto-tobi/manifest.json`。
2. 准备 `icon.png` (128×128) + `preview.png` (1280×720) + `hero.webp` (可选)。
3. `npm run generate:themes` → 生成 `palette.css` + 6 份 agent CSS。
4. `npm run check:themes` 本地自检，全部通过。
5. 重启 AgentSkin 即自动 seed（loader 硬校验后再入库）。

## 暗色 / 亮色规则

- `manifest.mode` 决定 UI 分类；agent CSS 的 `color-scheme` 必须一致（否则 agent 原生 UI 控件如滚动条、表单、shadow DOM 表面不跟随主题）。
- 亮色：`--agentskin-bg` ≥ 90% 亮度，`--agentskin-text` ≤ 30% 亮度，surface 常为 `#ffffff`。
- 暗色：`--agentskin-bg` ≤ 15% 亮度，`--agentskin-text` ≥ 85% 亮度。

## 探针样式契约 (Probe Style Contract)

CDP 样式探针读取的样式集合，即主题**必须能被观测到**的样式全集。机读化于 `src/main/catalog/manifest-v2.schema.json` 的 `$defs.ProbeStyleContract`。

### 1. 设计 token（CSS 自定义属性）捕获

探针捕获每个 DOM 节点**相对父节点 override** 的 `--*` 变量；根节点报告其全部自身 token；继承项自动跳过，避免 payload 膨胀。

各 agent 的设计 token 命名空间（由生成器在 agent CSS 里从 `--agentskin-*` 映射）：

| Agent | token 命名空间 | 说明 |
|-------|---------------|------|
| AgentSkin 品牌 | `--agentskin-*` | 主题 `:root` 变量（14 个契约） |
| TRAE Work | `--vscode-*` | VS Code fork |
| QoderWork | `--color-*` (antd) | antd 体系 |
| WorkBuddy | `--cb-*` | 腾讯体系 |
| 豆包 | `--dbx-*` | 251-token 语义层（`--semi-color-*` 为遗留，勿用于新主题） |
| Codex / ZCode | `--color-*` | 与 QoderWork 同族 |

### 2. Computed-style 字段全集（75 个）

探针对命中的可见节点读取的 computed-style 字段（机读列表见 schema `$defs.ProbeStyleContract.computedStyleFields`）：

- **布局 / 盒模型**：display, position, zIndex, boxSizing, flexDirection, alignItems, justifyContent, gap, padding, margin, width, height, minWidth, maxWidth, minHeight, maxHeight, overflowX, overflowY, gridTemplateColumns, gridTemplateRows, flex, flexWrap, flexGrow, flexShrink, flexBasis, alignSelf, justifySelf, objectFit
- **颜色 / 背景**：color, backgroundColor, backgroundImage, background, backgroundPosition, backgroundSize, backgroundRepeat, backgroundClip, backgroundOrigin, fill, stroke
- **边框 / 描边**：border, borderRadius, borderColor, borderWidth, borderStyle, borderTopColor, borderTopWidth, borderTopStyle, borderBottomColor, outline, outlineColor, outlineWidth, outlineStyle
- **阴影 / 特效**：boxShadow, textShadow, opacity, filter, backdropFilter, mixBlendMode, appearance, contentVisibility
- **文本**：fontFamily, fontSize, fontWeight, lineHeight, textAlign, textDecoration, textTransform, letterSpacing, wordSpacing, whiteSpace
- **交互 / 其他**：cursor, transition, transform, pointerEvents, userSelect

### 3. 主题包声明

每个主题 `manifest.json` 应含 `probe` 块，声明本主题贡献的 token 命名空间并指向本契约（见上方示例 manifest）。

---

## 深度适配指南（手写 CSS，路线 B）

> 生成器路线（A）只做"14 token 重映射 + 通用形态旋钮"，**无法**产出背景纹理、主视觉大图、品牌点缀、每应用差异化表面质感。要做"自己的" distinctive 主题，须走本节的**手写深度适配**——它本质是"基座生成 → 反复雕琢/多版本迭代 → 高精度、高适配、深度定制"的结果，而非逐字符手敲。
> 本节合并自 `docs/THEME_AUTHORING_GUIDE.md` 第 4/5 节（消除文档源分裂）。技法示例以 WorkBuddy 端为范本，去 IP 化。

### A. 四步技法

1. **集中声明私有调色板**（每端 CSS 顶部 `:root`）：先声明你自己的语义色，后面全引用它，方便统一调：

```css
:root.agentskin-host-workbuddy {
  --my-ink: #163f4b;
  --my-teal: #16bfc4;
  --my-pink: #ff8fc8;
  --my-line: rgba(22,191,196,.24);
  --my-shadow: rgba(12,105,119,.12);
}
```

2. **覆写应用原生 token**（按端命名空间，见下方速查表）——"真正生效"的关键，目标应用自有一套设计 token，须在更高优先级作用域覆盖：

```css
html.agentskin-host-workbuddy body[data-application-name="workbuddy"] {
  --cb-bg-primary: var(--my-surface) !important;
  --cb-text-primary: var(--my-ink) !important;
  --cb-vscode-button-background: var(--my-teal) !important;
}
```

3. **铺背景**（hero + 纹理 + 点缀层）：

```css
/* hero：运行时注入的 --agentskin-art（单图，Blob URL） */
html.agentskin-host-workbuddy body {
  background:
    linear-gradient(rgba(10,14,26,.86), rgba(10,14,26,.92)),
    var(--agentskin-art) center / cover no-repeat !important;
}

/* 纹理：AgentSkin 无原生纹理变量；方案 a 把纹理 bake 进 hero，方案 b 自造 data-url 变量 */
html.agentskin-host-workbuddy body {
  --my-texture: url("data:image/png;base64,iVBOR..."); /* 小图平铺 */
  background-image: var(--my-texture), var(--agentskin-art) !important;
  background-size: 360px auto, cover !important;
  background-repeat: repeat, no-repeat !important;
}

/* 点缀层：::before 光斑/网点（pointer-events:none，z-index 压低） */
html.agentskin-host-workbuddy body::before {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(circle at 86% 8%, rgba(255,255,255,.5) 0 2px, transparent 3px);
  background-size: 83px 83px; opacity: .35;
}
```

4. **每表面精修**（对稳定表面单独调质感：毛玻璃、阴影、圆角、品牌描边）：

```css
html.agentskin-host-workbuddy .conversation-sidebar {
  background: linear-gradient(180deg, rgba(...,.95), rgba(...,.92)),
              var(--my-texture) center / 590px auto repeat !important;
  border-right: 1px solid var(--my-line) !important;
  box-shadow: 12px 0 32px var(--my-shadow) !important;
  backdrop-filter: blur(18px) saturate(1.06) !important;
}
```

### B. 作用域约定（避免"写了不生效"）

优先级不够 = 主题不生效的头号原因。目标应用的 token 常写在 `:root` / `body` / `[data-theme=...]` 上，必须用**更高优先级且带 host 作用域**的选择器：

| 端 | 推荐作用域选择器（实测） |
|----|--------------------------|
| workbuddy | `body[data-application-name="workbuddy"]` |
| traework | `html.agentskin-host-traework body` / `html.agentskin-host-traework .类名` |
| qoderwork | `html.agentskin-host-qoderwork:root` |
| codex | `html.agentskin-host-codex` |
| zcode | `html.agentskin-host-zcode` |
| doubao | `html.agentskin-host-doubao:root` |

> 规则：**不要裸 `:root{...}`**（会被应用自身 `:root[data-theme]` 反超）。一律加 `html.agentskin-host-<agent>` 或 `body[data-application-name=...]` 前缀，并对关键覆写加 `!important`。

### C. 六端 token 命名空间 + 稳定表面速查表

> "稳定表面"指 DOM 结构改动较少、可放心挂背景/阴影的容器。来源：参考主题 verification 选择器 + `themes/aurora-glass/assets/css/*.css` 实测。

**WorkBuddy（`--cb-*` 体系，腾讯）**
- 作用域：`body[data-application-name="workbuddy"]`
- 原生 token：`--cb-bg-primary` / `--cb-text-primary` / `--cb-vscode-button-background` / `--cb-vscode-titleBar-*` / `--cb-vscode-scrollbarSlider-*` / `--cb-button-dark-*` / `--cb-markdown-hr-border-color` / `--cb-stroke-secondary`
- 稳定表面：`.conversation-sidebar`、`.conversation-list`、`.chat-container`、`.wb-home-page`、`.wb-home-composer`、`.cb-markdown`、`.workbuddy-topbar`
- 参考：aurora-glass `workbuddy.css` 顶部 90 行

**TRAE Work（`--vscode-*` + `--vscode-icube-*` 体系，VS Code fork）**
- 作用域：`html.agentskin-host-traework body`（壳层 token 写在 `body` 上）
- 原生 token：`--vscode-foreground`、`--vscode-editor-background`、`--vscode-button-background`、`--vscode-focusBorder`、`--vscode-list-hoverBackground`、`--vscode-icube-colorBg1/2/3`、`--vscode-icube-colorLine1/2`、`--vscode-icube-colorBrand`、`--vscode-icube--bg-bg-overlay-l2/l3`
- 稳定表面：`.task-list-base`（侧栏）、`.solo-lite-panel-border`、`.panel-content`、`.solo-lite-chat-panel-container`、`.solo-lite`（壳层 body class）

**QoderWork（`--color-*` 体系，antd）**
- 作用域：`html.agentskin-host-qoderwork:root`
- 原生 token：`--color-primary`、`--color-primary-bg(-hover)`、`--color-text(-base/-secondary/-tertiary/-quaternary)`、`--color-border(-secondary/-tertiary)`、`--color-fill(-secondary/-tertiary/-quaternary)`、`--color-bg-container` / `--color-bg-elevated` / `--color-bg-layout` / `--color-bg-base`、`--color-link`
- 稳定表面：`.agents-layout-root`、`.agents-sidebar`、`.agents-content-area`、`.agents-parchment-paper-surface`、`.sidebar-section-title`

**Codex / ZCode（`--color-token-*` 体系，与 QoderWork 同族）**
- 作用域：`html.agentskin-host-codex` / `html.agentskin-host-zcode`
- 原生 token：`--color-token-bg-primary` / `-bg-secondary` / `-main-surface-primary` / `-side-bar-background` / `-foreground` / `-text-primary/-secondary/-tertiary` / `-input-background` / `-button-background` / `-border(-default/-heavy/-light)` / `-list-hover-background` / `-focus-border` / `-scrollbar-slider-background` / `-text-preformat-*`
- 稳定表面：`aside.app-shell-left-panel`、`main.main-surface`、`header.app-header-tint`、`.composer-surface-chrome`
- ZCode 是 Codex 派生壳，建议直接复用 codex.css 再核对差异（命名空间同族）。

**豆包 Doubao（`--dbx-*` 体系，251-token，不是 `--semi-color-*`）**
- 作用域：`html.agentskin-host-doubao:root`
- 原生 token：`--dbx-bg-body-web` / `-bg-base-web` / `-bg-base-2/5` / `-bg-float` / `-bg-mask` / `-bg-blur-md` / `--dbx-text-primary/-secondary/-tertiary/-disable` / `--dbx-fill-*` / `--dbx-line-*`
- 稳定表面：`.chat-container`、`.dbx-*` 语义容器（建议用 DevTools 实测当前版本类名）
- 参考：aurora-glass `doubao.css`（`--dbx-` 为主，`--semi-color-` 为遗留）——本表与上文「探针样式契约」token 命名空间表一致。
