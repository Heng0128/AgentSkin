# AgentSkin 主题系统内部审计报告

> 审计日期：2026-08-20
> 审计范围：`themes/` 目录 7 个主题 + `scripts/` 构建管线 + `scripts/generators/` 6 个适配器生成器
> 审计方法：静态文件计数 + 正则扫描 + 源码阅读，未修改任何代码

---

## 一、主题清单

### 1.1 主题总览

| 主题 ID | 显示名 | 版本 | Mode | Accent | Secondary | 是否有 hero | colorSchemes |
|---|---|---|---|---|---|---|---|
| aurora-dusk | 极光黄昏 | 1.0.0 | dark | #ff7a6b | #a8b4e6 | 否 | aurora-green / twilight-orange / glacial-violet |
| aurora-glass | 极光琉璃 | 1.0.0 | dark | #6ee7d3 | #9b8cff | 否 | polar / magma |
| demo-bridge-v2 | 桥接演示 v2 | 1.0.0 | dark | #4a90d9 | #7a8a99 | 否 | 无 |
| endland-wasteland | 终末之地 | 1.0.0 | dark | #c44536 | #d4a574 | 是 | 无 |
| github-noir | GitHub Noir | 0.1.0 | dark | #3fb950 | #8fa84a | 否 | 无 (bridged) |
| obsidian-poise | 玄曜 | 0.1.0 | dark | #c8a96b | #75b798 | 否 | 无 (bridged) |
| sweet-strawberry-code | Sweet Strawberry Code | 0.1.1 | light | #ff6b8a | #4caf7c | 否 | 无 (bridged) |

### 1.2 扩展字段支持

**结论：当前全部 7 个主题的 manifest.json 均未声明 decorations / animations / artFocalPoint 扩展字段。**

通过全仓正则扫描确认：`decorations`、`animations`、`artFocalPoint` 三个关键词在 themes/ 下的 manifest.json、palette.css、agent CSS 中均不存在。

### 1.3 扩展元数据现状

- 已使用扩展字段：`colorSchemes`（2 个主题）、`probe`（2 主题：aurora-dusk、demo-bridge-v2）、`variableBridge`（demo-bridge-v2，7 条映射）、`dynamic`（aurora-dusk: particles；aurora-glass: aurora）
- 未使用：`decorations`、`animations`、`artFocalPoint`、`extended` colors、`designLanguage`、`componentVariations`、`signature`（仅在 aurora-glass 内置隐式处理）

---

## 二、CSS 产物现状

### 2.1 文件大小（以 sweet-strawberry-code 为例，bridged 主题体积最大）

| Agent | Size (KB) | 行数 | 排名 |
|---|---|---|---|
| doubao.css | **59.3** | 1094 | #1 最大 |
| workbuddy.css | 24.2 | 526 | #2 |
| traework.css | 24.0 | 521 | #3 |
| zcode.css | 17.5 | 402 | #4 |
| qoderwork.css | 13.2 | 324 | #5 |
| codex.css | 12.0 | 298 | #6 最小 |

> 跨主题 CSS 大小高度一致（差异仅 color-mix 数值不同），表明生成器控制良好。

### 2.2 14-token 契约合规度

全量扫描 6 个 agent x 7 个主题 = 42 个 CSS 文件，逐文件检查 14 个必填 `--agentskin-*`：

| 14 Token | accent | secondary | bg | surface | surface-elevated | text | muted | border | code-bg | code-fg | input-bg | button-bg | focus-ring | selection |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 合规 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 | Y/42 |

**合规率：100%（42/42 文件均声明全部 14 tokens）。**

每个 agent CSS 还额外声明 `--agentskin-text-shadow` 及桥接变量（如 Codex 端的 `--color-token-*`），因此实际唯一变量数通常为 16，超出基础契约 2 个。

### 2.3 关键 CSS 指标

| 文件 | !important 数 | @keyframes | backdrop-filter 引用 | 裸 :root 块 |
|---|---|---|---|---|
| doubao.css | **626** | 0 | 6 | 0（使用 `html.agentskin-host-doubao`） |
| workbuddy.css | 245 | 0 | 8 | 0 |
| traework.css | 215 | 0 | 3 | 0 |
| zcode.css | 193 | 0 | 3 | 0 |
| qoderwork.css | 168 | 0 | 3 | 0 |
| codex.css | 99 | 0 | 4 | 0（使用 `:root.agentskin-host-codex`） |

> **关键发现**：CSS 中完全没有 `@keyframes`。`backdrop-filter` 仅出现在 doubao/workbuddy 的 glass 类块中（最多 8 处）。**无一文件使用裸 :root 选择器**，全部走 `:root.agentskin-host-<agent>` 命名空间，规范执行严格。

---

## 三、构建管线审计

### 3.1 当前生成链路

```
manifest.json ──→ build-palette.mjs ──→ palette.css
                                      ──→ palette.<scheme>.css（按 colorSchemes）
                  ──→ generate-theme-css.mjs ──→ assets/css/<agent>.css x 6
                                                ──→ assets/css/<scheme>/<agent>.css x 6（按 scheme）
```

辅助扩展接入点（已在 generate-theme-css.mjs 内部挂载）：
- `extendedColorsBlock(manifest.colors?.extended)` → 输出 `--agentskin-ext-*` 语义变量
- `designLanguageBlock(resolveDesignLanguage(manifest))` → 输出 `--agentskin-space-*/radius-*/shadow-float/duration-*`
- `loadVariations(themeDir)` + `filterByAgent` → 输出 `componentVariations` CSS
- `auroraGlassSignature`（仅 signature="aurora-glass" 主题触发，内部硬编码）

### 3.2 新扩展字段支持程度

| 扩展字段 | 当前支持 | 备注 |
|---|---|---|
| decorations | 不支持 | 三个构建脚本 + 三个扩展模块均不包含该字段处理 |
| animations | 不支持 | 同上，且当前 CSS 产物 @keyframes 数量 = 0 |
| artFocalPoint | 不支持 | 仅 `computeArtParams(t)` 在 `theme-utils.mjs` 内部以参数形式消费，但 manifest 无该字段入口 |

### 3.3 需要修改的函数（支持新字段时的改造点）

| # | 脚本/模块 | 函数/区域 | 改动难度 | 改动说明 |
|---|---|---|---|---|
| 1 | `scripts/build-palette.mjs` | `buildPaletteCss()` + `resolvePalettes()` | 中 | 需解析 manifest 新字段并输出对应 CSS 变量块，并同步 verify 路径 |
| 2 | `scripts/generate-theme-css.mjs` | 主 for-loop 内 `css += ...` 区域 | 低 | 接入新扩展块位置已规范化（第 93-109 行），按现有 extBlock/dlBlock 模式追加即可 |
| 3 | `scripts/bridge-codex-theme.mjs` | `mapPaletteToColors()` + `generateManifest()` | 中 | 桥接器需从 Codex 源数据映射 decorations/artFocalPoint，并注入 manifest |
| 4 | `scripts/theme-utils.mjs` | `buildContext()` | 低 | 需将新字段透传到 ctx 对象 |
| 5 | `scripts/extended-colors.mjs` 或新文件 | 新增 `decorationsBlock()` / `animationsBlock()` / `artFocalBlock()` | 低 | 仿照 `extendedColorsBlock` 模板，纯函数、无副作用 |
| 6 | `src/main/catalog/manifest-v2.schema.json` | schema 本身 | 高 | 权威 schema 变更需同步 manifest-validator.ts + 运行时 loader + docs 镜像（跨模块） |
| 7 | `scripts/check-themes.mjs` | 14-token 校验扩展 | 低 | 追加新字段声明校验 |

> 综合评估：**技术难度低到中**，主要是"增加新扩展块"而非"重构管线"。主要风险点是 schema 权威文件的同步一致性（AGENTS.md C1 不变量）。

---

## 四、适配器质量

### 4.1 选择器特异性策略

| Agent | 主选择器 | 特异性 | !important 总数 | 策略评价 |
|---|---|---|---|---|
| codex | `:root.agentskin-host-codex` | (0,1,1) | 99 | **克制**：token block 大量使用 !important，但组件层交互块（sidebar/nav 按钮）相对克制 |
| doubao | `html.agentskin-host-doubao` | (0,1,1) | **626** | **激进**：覆盖 251-token `--dbx-*` 系统，语义层全面 !important |
| traework | `html.agentskin-host-traework` | (0,1,1) | 215 | 中等：VS Code fork 的 `--vscode-*` + 组件覆盖 |
| workbuddy | `html.agentskin-host-workbuddy` | (0,1,1) | 245 | 中等偏高：`--cb-*` 体系覆盖+组件 |
| qoderwork | `html.agentskin-host-qoderwork` | (0,1,1) | 168 | 中等：antd `--color-*` 体系 |
| zcode | `html.agentskin-host-zcode` | (0,1,1) | 193 | 中等：与 codex 同族 token |

### 4.2 共性问题

1. **doubao.css 626 处 !important**：单文件占比超过其他任一文件 2.5x。根源在 doubaoCss.mjs 为覆盖 251 token 语义层逐一赋值，属**结构性需求**而非滥用，但仍建议后续做覆盖率审计。
2. **裸 :root 选择器**：零出现，命名空间隔离完美。
3. **过度 !important**：除 doubao 外，其他 5 个适配器的 !important 集中在 token block（theme-utils.mjs 238处模板级 !important）和 sharedChromeRules；组件层多处用了 `!important` 而非提升选择器特异性，存在优化空间但风险可控。
4. **特异性一致性**：6 个生成器的主选择器均为单一类/属性选择器 (0,1,1)，规格统一；doubao 使用 `html.` 前缀、codex 使用 `:root.` 前缀属 agent 差异性需要，非不一致。

### 4.3 大小与 !important 排名

- **大小排名**：doubao (59KB) >> workbuddy ≈ traework (24KB) > zcode (17KB) > qoderwork (13KB) > codex (12KB)
- **!important 排名**：doubao (626) >> workbuddy (245) > traework (215) > zcode (193) > qoderwork (168) > codex (99)

---

## 五、GitHub 参考项目跟踪

### 5.1 状态总览

| # | 项目 | AgentSkin 落地状态 | 说明 |
|---|---|---|---|
| 1 | Material Color Utilities (@material/material-color-utilities) | **待落地** | 当前 color-utils.mjs 仅实现基础 hex→RGB + WCAG 亮度，缺少 HCT/Scheme/Tonal Spot 等 Material You 特色能力 |
| 2 | Panda CSS | **不适合** | Panda 是 build-time CSS-in-JS 框架，与 AgentSkin 纯 CDP 注入架构冲突；可借鉴其 token 分类思想，不可直接移植 |
| 3 | Obsidian Style Settings | **待落地** | 插件设置面板模式与 Theme Studio preview 相近，但其 JS 代码不适合直接移植，可在 UX 层借鉴 |
| 4 | Dark Reader | **部分已落地** | 当前 color-utils.mjs autoOnColor 与 Dark Reader 的自动前景色算法思路一致；完整算法未移植 |
| 5 | themer (@themer/core) | **待落地** | 主题格式化输出能力与 AgentSkin palette.css 生成模式相似，未移植；可借鉴多 theme target 输出 |
| 6 | @nousantx/color-generator | **待落地** | 轻量色板生成；当前无对应模块，`extended-colors.mjs` 的 autoOnColor / contrastRatio 属自研 |
| 7 | Primer CSS | **部分已落地** | Primer 的 color token 层级（scale/semantic/bg/fg）结构与 AgentSkin 的 dual-layer（agentskin-* + native token）思路一致；未直接移植代码 |
| 8 | ColorTranslator (@DocBrown13/ColorTranslator) | **部分已落地** | 当前 extended-colors.mjs 自研了 WCAG 2.1 contrastRatio + 简化 APCA + autoOnColor；完整色空间转换未移植 |

### 5.2 已自研的等效能力

| 模块 | 路径 | 等效于 | 功能 |
|---|---|---|---|
| `hexToRgb` | `scripts/utils/color-utils.mjs:24` | ColorTranslator | 十六进制转 RGB |
| `luminance` | `scripts/utils/color-utils.mjs` | WCAG / Dark Reader | WCAG 2.1 相对亮度 |
| `contrastRatio` | `scripts/extended-colors.mjs:40` | WCAG 2.1 §1.4.3 | 对比度 |
| `apcaContrast` | `scripts/extended-colors.mjs:65` | APCA | 简化 APCA 对比度 |
| `autoOnColor` | `scripts/extended-colors.mjs:96` | Dark Reader / Material | 自动前景色 |
| `extendedColorsBlock` | `scripts/extended-colors.mjs:151` | Primer CSS token 层级 | 语义颜色块输出 |
| `designLanguageBlock` | `scripts/design-language.mjs:186` | Panda CSS token 分类 | 间距/圆角/阴影/动画 token |

### 5.3 关键缺失（与参考项目的差距）

- **缺少 HCT/OKLCH 色空间**：Material Color Utilities 的核心是 HCT 色相-色度-色调空间，当前 build-palette.mjs 仅支持 hex/rgb，无法生成 tonal palette（0-100 阶亮度档）。
- **缺少动态主题变异**：themer 的"一源多输出"能力（一份 palette → 多平台 CSS/JSON/XML）在 AgentSkin 仅部分实现（palette → 6 agent CSS），无法导出到非平台。
- **缺少 settings 面板**：Obsidian Style Settings 的实时调整（色相滑块 + 预览）对应 Theme Studio 的设计方向，当前只沉淀在管理层 store，未在主题层打通。

---

## 附：审计样本与覆盖度

- manifest.json 已读：7/7（100%）
- agent CSS 已抽样深读：aurora-dusk + endland-wasteland + sweet-strawberry-code 共 18 个（42.9%）
- 脚本全文已读：build-palette.mjs / generate-theme-css.mjs / bridge-codex-theme.mjs / variations-loader.mjs / color-utils.mjs / extended-colors.mjs / design-language.mjs / theme-generators.mjs
- 适配器生成器已扫描全部 6 个（codex / doubao / qoderwork / traework / workbuddy / zcode）
- 统计方法：PowerShell 正则扫描（`[regex]::Matches` 计数），跨平台兼容已验证