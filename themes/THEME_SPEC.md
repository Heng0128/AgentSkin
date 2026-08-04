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
    "tokenNamespaces": ["--agentskin-", "--vscode-", "--color-", "--cb-", "--semi-color-"],
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
| 豆包 | `--semi-color-*` | Semi Design（`--dbx-*` 为历史死 token，勿依赖） |
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
