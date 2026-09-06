# AgentSkin AI 主题生成规范

> **版本**: 1.0.0 | **创建日期**: 2026-08-28
> **目标读者**: AI Agent（自动消费本文档以生成、验证、修复主题）
> **权威来源**: `scripts/theme-tokens.mjs`、`scripts/build-palette.mjs`、`docs/THEME-SPEC.md`
> **不变量**: 14-token 契约不可修改；本文档与代码实现保持同步。

---

## 目录

1. [文档用途与范围](#1-文档用途与范围)
2. [14-Token 完整语义定义](#2-14-token-完整语义定义)
3. [Manifest 字段规范](#3-manifest-字段规范)
4. [亮/暗色适配决策树](#4-亮暗色适配决策树)
5. [WCAG 2.1 AA 对比度验收标准](#5-wcag-21-aa-对比度验收标准)
6. [常见主题风格模板](#6-常见主题风格模板)
7. [Agent 生成主题完整工作流](#7-agent-生成主题完整工作流)
8. [验收清单（Agent 自验证）](#8-验收清单agent-自验证)
9. [错误处理与修复指南](#9-错误处理与修复指南)
10. [附录](#10-附录)

---

## 1. 文档用途与范围

本文档面向 AI Agent，提供消费级结构化规范，使 Agent 能够：

- 从用户描述、参考图片或风格关键词自动生成合规主题
- 自主验证生成结果是否满足 14-token 契约和 WCAG 对比度要求
- 在验证失败时自动修复并重新验证
- 输出可直接被 AgentSkin 引擎加载的主题包

**与现有文档的关系**:

| 文档 | 定位 | 本文档差异 |
|------|------|-----------|
| `docs/THEME_SPEC.md` | 主题包结构规范（目录/manifest/校验规则） | 本文档聚焦 AI 生成工作流与决策树 |
| `docs/THEME_AUTHORING_GUIDE.md` | 开发者手写适配指南（六端选择器/深度适配技法） | 本文档聚焦 Agent 自动化生成 |
| `docs/THEME-SPEC.md` | 14-Token 契约规范（已有 AI 读者定位） | 本文档扩展：风格模板 + 决策树 + 工作流 + 验收 |

---

## 2. 14-Token 完整语义定义

### 2.1 Token 总览

| # | CSS 变量名 | Manifest Key | 用途 | 必填 | 默认值/推导规则 |
|---|-----------|-------------|------|------|-----------------|
| 1 | `--agentskin-bg` | `background` | 全局背景色 | **是** | 无 |
| 2 | `--agentskin-surface` | `surface` | 卡片/面板表面色 | **是** | 无 |
| 3 | `--agentskin-surface-elevated` | `surfaceElevated` | 提升层表面色（弹窗/浮层） | **是** | 无 |
| 4 | `--agentskin-text` | `foreground` | 主文本色 | **是** | 无 |
| 5 | `--agentskin-muted` | `muted` | 次要文本/占位符色 | 否 | `foreground` + 60% 不透明度 |
| 6 | `--agentskin-accent` | `accent` | 主强调色（链接/按钮/焦点） | **是** | 无 |
| 7 | `--agentskin-secondary` | `secondary` | 次强调色（badge/标签） | 否 | `accent` 低饱和变体 |
| 8 | `--agentskin-border` | `border` | 边框色 | 否 | `accent` + 18% alpha |
| 9 | `--agentskin-code-bg` | `codeBackground` | 代码块背景 | 否 | 等于 `background` |
| 10 | `--agentskin-code-fg` | `codeForeground` | 代码块前景 | 否 | 等于 `foreground` |
| 11 | `--agentskin-focus-ring` | `focusRing` | 焦点环色 | 否 | `accent` + 40% alpha |
| 12 | `--agentskin-selection` | `selection` | 文本选区色 | 否 | `accent` + 32% alpha |
| 13 | `--agentskin-button-bg` | `buttonBackground` | 按钮背景色 | 否 | 等于 `accent` |
| 14 | `--agentskin-input-bg` | `inputBackground` | 输入框背景色 | 否 | 等于 `surface` |

> **注意**: Token 13-14 是 agent-only token，仅存在于 agent CSS 层，`palette.css` 不包含它们。

### 2.2 各 Token 详细约束

#### Token 1: `background` → `--agentskin-bg`

- **语义**: 应用最底层背景，所有其他表面的参照基准
- **亮色模式**: 相对亮度 L >= 90%（如 `#f5f5f5`、`#ffffff`）
- **暗色模式**: 相对亮度 L <= 15%（如 `#0a0a10`、`#121212`）
- **格式**: 6 位 HEX（`#rrggbb`）或 8 位 HEX（`#rrggbbaa`）
- **WCAG**: 与 `foreground` 的对比度必须 >= 4.5:1（AA）

#### Token 2: `surface` → `--agentskin-surface`

- **语义**: 卡片、侧边栏、面板等容器表面
- **亮色模式**: 接近白色（如 `#ffffff`、`#f8f9fa`）
- **暗色模式**: 比 `background` 略亮（如 `#16161c`、`#1e1e24`）
- **与 bg 关系**: 暗色模式下比 bg 亮 3-8% 亮度；亮色模式下比 bg 深 3-8% 亮度

#### Token 3: `surfaceElevated` → `--agentskin-surface-elevated`

- **语义**: 弹窗、下拉菜单、浮层等提升层级表面
- **与 surface 关系**: 必须比 `surface` 更亮（暗色模式）或更深（亮色模式）
- **典型值**: 暗色模式比 `surface` 高 3-5% 亮度

#### Token 4: `foreground` → `--agentskin-text`

- **语义**: 主文本、标题、正文
- **亮色模式**: 深色（L <= 30%，如 `#1a1a2e`）
- **暗色模式**: 高亮度（L >= 85%，如 `#e8eaf2`）
- **WCAG**: 与 `background` 对比度 >= 4.5:1（AA），>= 7:1（AAA）

#### Token 5: `muted` → `--agentskin-muted`

- **语义**: 占位符、禁用文本、时间戳等次要信息
- **与 text 关系**: 比 `foreground` 低 30-50% 不透明度
- **WCAG**: 与 `background` 对比度 >= 3:1（大文本 AA）

#### Token 6: `accent` → `--agentskin-accent`

- **语义**: 链接、主按钮、焦点指示器、进度条
- **亮色模式**: 中饱和度（避免过亮导致对比度不足）
- **暗色模式**: 中高亮度（确保在深色背景上可辨识）
- **WCAG**: 作为按钮色时，与 `buttonBackground` 上文字对比度 >= 4.5:1

#### Token 7: `secondary` → `--agentskin-secondary`

- **语义**: 次级强调——标签、badge、辅助高亮
- **与 accent 关系**: 应与 `accent` 色相相邻或互补，饱和度可略低
- **典型策略**: `accent` 的低饱和变体或类比色（色相 +/- 30 度）

#### Token 8: `border` → `--agentskin-border`

- **语义**: 分隔线、输入框边框、卡片描边
- **常见格式**: `rgba(r, g, b, alpha)` 或带 alpha 的 8 位 HEX
- **典型 alpha**: 0.12 - 0.24（暗色模式），0.08 - 0.16（亮色模式）
- **推导**: 通常为 `accent` + 低 alpha

#### Token 9: `codeBackground` → `--agentskin-code-bg`

- **语义**: 代码块、内联代码背景
- **暗色模式**: 通常比 `background` 略深或与 `background` 相同
- **亮色模式**: 通常为浅灰（如 `#f3f4f6`）

#### Token 10: `codeForeground` → `--agentskin-code-fg`

- **语义**: 代码块前景色
- **与 code-bg 关系**: 对比度 >= 4.5:1

#### Token 11: `focusRing` → `--agentskin-focus-ring`

- **语义**: 键盘焦点环、选中指示
- **推导规则**: 若未提供，生成器使用 `color-mix(in srgb, accent 40%, transparent)`
- **典型格式**: `accent` + 40-60% alpha

#### Token 12: `selection` → `--agentskin-selection`

- **语义**: 文本选中高亮背景
- **推导规则**: 若未提供，生成器使用 `color-mix(in srgb, accent 32%, transparent)`
- **典型格式**: `accent` + 32% alpha

#### Token 13: `buttonBackground` → `--agentskin-button-bg`

- **语义**: 主按钮背景
- **agent-only**: 仅存在于 agent CSS 层
- **推导**: 在 agent CSS 中通常等于 `accent` 或 `accent` + alpha

#### Token 14: `inputBackground` → `--agentskin-input-bg`

- **语义**: 输入框、文本域背景
- **agent-only**: 仅存在于 agent CSS 层
- **推导**: 在 agent CSS 中通过 `color-mix` 从 `surface` + `accent` 派生

### 2.3 派生 Token（自动生成，非 manifest 字段）

以下 token 由构建脚本自动生成，**不需要**在 manifest 中声明：

| CSS 变量 | 生成规则 | 来源 |
|----------|---------|------|
| `--agentskin-accent-raw` | `R, G, B` 三元组 | `toRgbTriple(accent)` |
| `--agentskin-secondary-raw` | `R, G, B` 三元组 | `toRgbTriple(secondary)` |
| `--agentskin-text-raw` | `R, G, B` 三元组 | `toRgbTriple(foreground)` |
| `--agentskin-muted-raw` | `R, G, B` 三元组 | `toRgbTriple(muted)` |
| `--agentskin-surface-raw` | `R, G, B` 三元组 | `toRgbTriple(surface)` |
| `--agentskin-surface-elevated-raw` | `R, G, B` 三元组 | `toRgbTriple(surfaceElevated)` |
| `--agentskin-bg-raw` | `R, G, B` 三元组 | `toRgbTriple(background)` |
| `--agentskin-border-raw` | `R, G, B` 三元组 | `toRgbTriple(border \|\| accent)` |
| `--agentskin-text-shadow` | 亮/暗模式不同 | `tokenBlock()` 函数 |
| `--agentskin-art` | 运行时注入 | 引擎 Blob URL |

---

## 3. Manifest 字段规范

### 3.1 必需字段

```json
{
  "id": "my-theme-id",
  "name": "My Theme",
  "version": "1.0.0",
  "mode": "dark",
  "colors": {
    "background": "#0a0a10",
    "foreground": "#e8eaf2",
    "accent": "#7C9CFF"
  }
}
```

| 字段 | 约束 |
|------|------|
| `id` | 小写字母+数字+连字符，与目录名一致，匹配 `^[a-z0-9][a-z0-9_-]*$` |
| `name` | 1-64 字符 |
| `version` | 语义化版本（semver），如 `"1.0.0"` |
| `mode` | `"dark"` / `"light"` / `"auto"` |
| `colors.background` | 必需，有效 CSS 颜色 |
| `colors.foreground` | 必需，有效 CSS 颜色 |
| `colors.accent` | 必需，有效 CSS 颜色 |

### 3.2 署名链必填字段

| 字段 | 约束 |
|------|------|
| `author.name` | 非空字符串 |
| `author.url` | 可选，必须是 http/https/mailto URL |
| `license` | SPDX 标识符（如 `"MPL-2.0"`、`"MIT"`、`"CC-BY-NC-SA-4.0"`） |

### 3.3 推荐字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `displayName` | string | 本地化显示名 |
| `description` | string | >= 20 字符 |
| `icon` | string | 图标路径（128x128） |
| `preview` | string | 预览图路径（1280x720） |
| `hero` | string | Hero 背景图路径（1920x1080） |
| `category` | string | cyberpunk / minimal / anime / nature / retro / professional / creative / dark / light |
| `tags` | string[] | 最多 10 个 |
| `supportedAgents` | string[] | 6 个 agent id 的子集 |
| `targets` | object | 各 agent CSS 路径 + 验证锚点 |

### 3.4 颜色格式约束

- 支持格式: `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgba(r, g, b, a)`
- `colors` 对象为 `additionalProperties: false`——不能添加自定义键
- 自定义调色板变量只能写进 agent CSS 的 `:root` 块

---

## 4. 亮/暗色适配决策树

Agent 根据用户输入选择亮/暗模式的决策流程：

```
开始
  │
  ├─ 用户是否显式指定 mode？
  │   ├─ 是 → 使用指定值（dark / light）
  │   └─ 否 → 继续
  │
  ├─ 是否有背景图？
  │   ├─ 否 → 默认 dark（AgentSkin 默认暗色优先）
  │   └─ 是 → 计算背景图平均亮度 L
  │       │
  │       ├─ L < 0.20 → dark（暗色图，用亮色文本）
  │       ├─ L > 0.70 → light（亮色图，用暗色文本）
  │       └─ 0.20 <= L <= 0.70 → 根据主色调饱和度判断
  │           │
  │           ├─ 饱和度 > 0.3 → dark（彩色图，暗底更突出）
  │           └─ 饱和度 <= 0.3 → dark（灰度图，默认暗色）
  │
  └─ 确定 mode 后:
      ├─ dark: bg 亮度 <= 15%, text 亮度 >= 85%
      └─ light: bg 亮度 >= 90%, text 亮度 <= 30%
```

### 4.1 亮度计算公式

```
相对亮度 L = 0.2126 * R_lin + 0.7152 * G_lin + 0.0722 * B_lin

其中:
  R_lin = (R_srgb <= 0.03928) ? R_srgb/12.92 : ((R_srgb+0.055)/1.055)^2.4
  G_lin = (G_srgb <= 0.03928) ? G_srgb/12.92 : ((G_srgb+0.055)/1.055)^2.4
  B_lin = (B_srgb <= 0.03928) ? B_srgb/12.92 : ((B_srgb+0.055)/1.055)^2.4

  R_srgb = R_8bit / 255
  G_srgb = G_8bit / 255
  B_srgb = B_8bit / 255
```

### 4.2 饱和度计算公式

```
Max = max(R_srgb, G_srgb, B_srgb)
Min = min(R_srgb, G_srgb, B_srgb)
Delta = Max - Min

饱和度 S = (Max === 0) ? 0 : Delta / Max
```

### 4.3 亮/暗模式配色参考范围

| Token | 暗色模式范围 | 亮色模式范围 |
|-------|------------|------------|
| `background` | `#000000` - `#2a2a2a` (L: 0-15%) | `#e0e0e0` - `#ffffff` (L: 90-100%) |
| `surface` | bg + 3-8% 亮度 | bg - 3-8% 亮度 |
| `surfaceElevated` | surface + 3-5% 亮度 | surface - 3-5% 亮度 |
| `foreground` | L: 85-95% | L: 10-30% |
| `accent` | 中高亮度（L: 45-70%） | 中饱和度（L: 35-55%） |
| `muted` | `foreground` 的 50-70% 不透明度 | `foreground` 的 50-70% 不透明度 |
| `border` | `accent` + 12-24% alpha | `accent` + 8-16% alpha |
| `codeBackground` | 等于或略深于 `background` | 浅灰 `#f0f0f0` - `#f8f8f8` |
| `focusRing` | `accent` + 40-60% alpha | `accent` + 40-60% alpha |

---

## 5. WCAG 2.1 AA 对比度验收标准

### 5.1 对比度计算

WCAG 2.1 对比度公式：

```
Contrast Ratio = (L1 + 0.05) / (L2 + 0.05)

其中:
  L1 = 较亮颜色的相对亮度
  L2 = 较暗颜色的相对亮度
  结果范围: 1:1（无对比）到 21:1（最大对比）
```

### 5.2 验收阈值

| 组合 | 最低要求 | WCAG 等级 | 适用场景 |
|------|---------|----------|---------|
| `foreground` on `background` | >= 4.5:1 | AA | 正常文本（<18pt 或 <14pt bold） |
| `foreground` on `background` | >= 7:1 | AAA | 正常文本（增强） |
| `foreground` on `surface` | >= 4.5:1 | AA | 卡片/面板内文本 |
| `foreground` on `surfaceElevated` | >= 4.5:1 | AA | 弹窗/浮层内文本 |
| `muted` on `background` | >= 3:1 | AA Large | 大文本（>=18pt 或 >=14pt bold） |
| `muted` on `surface` | >= 3:1 | AA Large | 大文本次要信息 |
| `accent` on `background` | >= 3:1 | AA UI | UI 组件（按钮/图标） |
| `buttonForeground` on `buttonBackground` | >= 4.5:1 | AA | 按钮文本 |
| `codeForeground` on `codeBackground` | >= 4.5:1 | AA | 代码块文本 |
| `accent` on `surface` | >= 3:1 | AA UI | 表面上的强调元素 |

### 5.3 自动修正算法

当对比度不满足要求时，Agent 执行以下修正：

```
修正 foreground/background 对比度:
  while (contrast(foreground, background) < 4.5):
    if mode == dark:
      foreground = lighten(foreground, 5%)
      background = darken(background, 2%)
    else:
      foreground = darken(foreground, 5%)
      background = lighten(background, 2%)

修正 accent 对比度:
  while (contrast(accent, background) < 3.0):
    if mode == dark:
      accent = lighten(accent, 3%)
    else:
      accent = darken(accent, 3%)

修正 muted 对比度:
  while (contrast(muted, background) < 3.0):
    if mode == dark:
      muted = lighten(muted, 5%)
    else:
      muted = darken(muted, 5%)
```

### 5.4 常见对比度陷阱

| 陷阱 | 描述 | 修复方法 |
|------|------|---------|
| 高饱和 accent 在亮色底上 | 亮色模式下高饱和色可能对比度不足 | 降低饱和度或增加亮度差 |
| muted 太接近 background | 次要文本几乎不可见 | 增大 `muted` 与 `background` 的亮度差 |
| surface 与 background 太接近 | 卡片与背景无法区分 | 确保 surface 与 background 亮度差 >= 3% |
| border 太透明 | 边框几乎不可见 | 增加 alpha 至 >= 0.12 |

---

## 6. 常见主题风格模板

### 6.1 赛博朋克（Cyberpunk）

**特征**: 霓虹色、深黑背景、高对比、科技感

```json
{
  "mode": "dark",
  "colors": {
    "accent": "#00f0ff",
    "secondary": "#ff00aa",
    "background": "#0a0a10",
    "foreground": "#e0e0ff",
    "muted": "#7a7a9a",
    "surface": "#12122a",
    "surfaceElevated": "#1a1a3a",
    "border": "#00f0ff2e",
    "codeBackground": "#050510",
    "codeForeground": "#c0c0e0",
    "inputBackground": "#1a1a3a",
    "buttonBackground": "#00f0ff",
    "buttonForeground": "#0a0a10",
    "focusRing": "#00f0ff60"
  }
}
```

**WCAG 验证要点**:
- `foreground` (#e0e0ff) on `background` (#0a0a10): ~14:1 ✅
- `accent` (#00f0ff) on `background` (#0a0a10): ~12:1 ✅
- `muted` (#7a7a9a) on `background` (#0a0a10): ~4.8:1 ✅

### 6.2 极简（Minimal）

**特征**: 低饱和、中性灰、干净利落

```json
{
  "mode": "dark",
  "colors": {
    "accent": "#4a90d9",
    "secondary": "#7a8a99",
    "background": "#121212",
    "foreground": "#e0e0e0",
    "muted": "#888888",
    "surface": "#1e1e1e",
    "surfaceElevated": "#2a2a2a",
    "border": "#4a90d92e",
    "codeBackground": "#161616",
    "codeForeground": "#cdd6e0",
    "inputBackground": "#2a2a2a",
    "buttonBackground": "#4a90d918",
    "buttonForeground": "#4a90d9",
    "focusRing": "#4a90d960"
  }
}
```

### 6.3 自然（Nature）

**特征**: 绿色调、温暖、有机感

```json
{
  "mode": "dark",
  "colors": {
    "accent": "#6ab04c",
    "secondary": "#a3cc7a",
    "background": "#0a1a0a",
    "foreground": "#e8f0e0",
    "muted": "#7a9a7a",
    "surface": "#142814",
    "surfaceElevated": "#1e381e",
    "border": "#6ab04c2e",
    "codeBackground": "#081408",
    "codeForeground": "#c8d8c0",
    "inputBackground": "#1e381e",
    "buttonBackground": "#6ab04c",
    "buttonForeground": "#ffffff",
    "focusRing": "#6ab04c60"
  }
}
```

### 6.4 暗色极光（Dark Aurora）

**特征**: 蓝紫渐变、冰蓝高光、深邃夜空

```json
{
  "mode": "dark",
  "colors": {
    "accent": "#7C9CFF",
    "secondary": "#aabfff",
    "background": "#0a0a10",
    "foreground": "#e8eaf2",
    "muted": "#84858c",
    "surface": "#16161c",
    "surfaceElevated": "#232328",
    "border": "#7C9CFF2e",
    "codeBackground": "#07070a",
    "codeForeground": "#c9d0e1",
    "inputBackground": "#1f1f25",
    "buttonBackground": "#7C9CFF18",
    "buttonForeground": "#7C9CFF",
    "focusRing": "#7C9CFF60"
  }
}
```

### 6.5 暖色复古（Warm Retro）

**特征**: 暖橙/棕色调、怀旧感、低饱和

```json
{
  "mode": "dark",
  "colors": {
    "accent": "#d4a574",
    "secondary": "#c4956a",
    "background": "#1a1410",
    "foreground": "#f0e8e0",
    "muted": "#9a8a7a",
    "surface": "#282018",
    "surfaceElevated": "#342a20",
    "border": "#d4a5742e",
    "codeBackground": "#14100c",
    "codeForeground": "#d8d0c8",
    "inputBackground": "#342a20",
    "buttonBackground": "#d4a574",
    "buttonForeground": "#1a1410",
    "focusRing": "#d4a57460"
  }
}
```

### 6.6 亮色晨雾（Light Mist）

**特征**: 柔和蓝灰、淡雅清新、高可读

```json
{
  "mode": "light",
  "colors": {
    "accent": "#4a6cf7",
    "secondary": "#7c8db5",
    "background": "#f5f6fa",
    "foreground": "#1a1a2e",
    "muted": "#6b7280",
    "surface": "#ffffff",
    "surfaceElevated": "#ffffff",
    "border": "#4a6cf724",
    "codeBackground": "#f3f4f6",
    "codeForeground": "#2d3748",
    "inputBackground": "#ffffff",
    "buttonBackground": "#4a6cf7",
    "buttonForeground": "#ffffff",
    "focusRing": "#4a6cf750"
  }
}
```

### 6.7 风格模板选择决策树

```
用户描述/关键词
  │
  ├─ 含"霓虹"/"赛博"/"科技"/"未来" → 赛博朋克模板
  ├─ 含"极简"/"简洁"/"干净"/"朴素" → 极简模板
  ├─ 含"自然"/"森林"/"植物"/"清新" → 自然模板
  ├─ 含"夜空"/"极光"/"深邃"/"宇宙" → 暗色极光模板
  ├─ 含"复古"/"怀旧"/"暖色"/"咖啡" → 暖色复古模板
  ├─ 含"明亮"/"白色"/"清新"/"晨" → 亮色晨雾模板
  ├─ 含图片 → 从图片提取调色板（见第 7 节）
  └─ 无明确偏好 → 默认暗色极光模板
```

---

## 7. Agent 生成主题完整工作流

### 7.1 输入

Agent 接收以下一种或多种输入：

| 输入类型 | 格式 | 示例 |
|---------|------|------|
| 文本描述 | 自然语言 | "一个赛博朋克风格的主题，霓虹蓝紫色" |
| 风格关键词 | 字符串 | "cyberpunk", "minimal", "nature" |
| 参考图片 | 图片文件/URL | 背景图、截图、艺术作品 |
| 基础色 | HEX 颜色 | accent: "#00f0ff" |
| 完整 manifest | JSON | 用户提供部分或完整 manifest |

### 7.2 处理流程

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent 主题生成工作流                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌────────┐ │
│  │ 1. 解析   │ →  │ 2. 决策   │ →  │ 3. 生成   │ →  │ 4. 验证 │ │
│  │    输入   │    │    模式   │    │   调色板  │    │    修正 │ │
│  └──────────┘    └──────────┘    └──────────┘    └────────┘ │
│       │               │               │               │      │
│       ▼               ▼               ▼               ▼      │
│  提取:            确定:           产出:           检查:     │
│  - 关键词         - dark/light    - 14 tokens     - 完整性  │
  - 图片           - 风格模板      - manifest      - 对比度  │
  - 颜色           - 目标 Agent    - 资源文件      - 格式    │
                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 详细步骤

#### 步骤 1: 解析输入

```
IF 输入包含图片:
  → 计算图片平均亮度和饱和度
  → 按第 4 节决策树确定 mode
  → 从图片提取主色调作为 accent 候选
  → 从图片提取暗色作为 background 候选
  → 从图片提取亮色作为 foreground 候选

IF 输入包含风格关键词:
  → 按第 6.7 节决策树选择模板
  → 以模板为基础，根据用户描述微调

IF 输入包含基础色:
  → 以基础色为 accent，推导完整调色板

IF 输入包含文本描述:
  → 提取颜色词（"蓝色"、"暗"、"霓虹"等）
  → 提取风格词（"赛博"、"极简"等）
  → 综合判断生成策略
```

#### 步骤 2: 确定模式与目标

```
确定 mode:
  - 用户指定 → 使用指定值
  - 图片输入 → 按亮度决策树
  - 文本描述含"亮"/"白"/"light" → light
  - 文本描述含"暗"/"黑"/"dark" → dark
  - 默认 → dark

确定目标 Agent:
  - 用户指定 → 使用指定子集
  - 默认 → 全部 6 个 (traework, qoderwork, workbuddy, doubao, codex, zcode)
```

#### 步骤 3: 生成调色板

```
按优先级填充 14 个 token:

1. background ← 用户指定 / 图片暗色 / 模板值
2. foreground ← 用户指定 / 图片亮色 / 模板值
3. accent ← 用户指定 / 图片主色 / 模板值
4. surface ← background + 5% 亮度（暗色）/ background - 5% 亮度（亮色）
5. surfaceElevated ← surface + 3% 亮度（暗色）/ surface - 3% 亮度（亮色）
6. muted ← foreground + 60% 不透明度
7. secondary ← accent 低饱和变体或类比色
8. border ← accent + 18% alpha
9. codeBackground ← background 或略深
10. codeForeground ← foreground
11. focusRing ← accent + 40% alpha
12. selection ← accent + 32% alpha
13. buttonBackground ← accent
14. inputBackground ← surface
```

#### 步骤 4: 验证与修正

```
按第 8 节验收清单逐项检查:
  → 14 token 齐全？
  → 对比度满足 WCAG AA？
  → manifest 格式正确？
  → 资源文件存在？

若检查失败:
  → 按第 5.3 节自动修正算法调整
  → 重新验证
  → 最多 3 次修正循环
```

### 7.4 输出

Agent 最终产出：

```
themes/<theme-id>/
├── manifest.json          ← 主题元数据 + 14 token
├── icon.png               ← 128x128 图标
├── preview.png            ← 1280x720 预览图
├── hero.webp              ← 1920x1080 背景艺术图（可选）
├── palette.css            ← 生成物（12 核心 token + raw 派生）
└── assets/css/
    ├── traework.css       ← 生成物（14 token + 原生 token 覆写）
    ├── qoderwork.css      ← 生成物
    ├── workbuddy.css      ← 生成物
    ├── doubao.css         ← 生成物
    ├── codex.css          ← 生成物
    └── zcode.css          ← 生成物
```

---

## 8. 验收清单（Agent 自验证）

Agent 生成主题后，必须逐项自验证。每个检查项标注了 [PASS] / [FAIL] 判定标准。

### 8.1 结构检查

| # | 检查项 | 命令/方法 | 判定标准 |
|---|--------|----------|---------|
| S1 | manifest.json 存在且为合法 JSON | `JSON.parse(readFileSync(...))` | 无语法错误 → [PASS] |
| S2 | `manifest.id` 与目录名一致 | 字符串相等 | 相等 → [PASS] |
| S3 | `manifest.id` 匹配 `^[a-z0-9][a-z0-9_-]*$` | 正则匹配 | 匹配 → [PASS] |
| S4 | `manifest.colors.background` 存在 | `m.colors.background !== undefined` | 存在 → [PASS] |
| S5 | `manifest.colors.foreground` 存在 | `m.colors.foreground !== undefined` | 存在 → [PASS] |
| S6 | `manifest.colors.accent` 存在 | `m.colors.accent !== undefined` | 存在 → [PASS] |
| S7 | `manifest.mode` 为 dark/light/auto | `['dark','light','auto'].includes(m.mode)` | 包含 → [PASS] |
| S8 | `manifest.author.name` 非空 | `m.author?.name?.length > 0` | 非空 → [PASS] |
| S9 | `manifest.license` 为已知 SPDX | 见附录 A | 已知 → [PASS] |
| S10 | `manifest.version` 匹配 semver | `/^\d+\.\d+\.\d+/.test(m.version)` | 匹配 → [PASS] |

### 8.2 14-Token 完整性检查

| # | 检查项 | 判定标准 |
|---|--------|---------|
| T1 | `colors.background` 已声明 | [PASS] if present |
| T2 | `colors.foreground` 已声明 | [PASS] if present |
| T3 | `colors.accent` 已声明 | [PASS] if present |
| T4 | `colors.surface` 已声明 | [PASS] if present |
| T5 | `colors.surfaceElevated` 已声明 | [PASS] if present |
| T6 | `colors.muted` 已声明 | [PASS] if present |
| T7 | `colors.secondary` 已声明 | [PASS] if present |
| T8 | `colors.border` 已声明 | [PASS] if present |
| T9 | `colors.codeBackground` 已声明 | [PASS] if present |
| T10 | `colors.codeForeground` 已声明 | [PASS] if present |
| T11 | `colors.inputBackground` 已声明 | [PASS] if present |
| T12 | `colors.buttonBackground` 已声明 | [PASS] if present |
| T13 | `colors.buttonForeground` 已声明 | [PASS] if present |
| T14 | `colors.focusRing` 已声明 | [PASS] if present |

### 8.3 WCAG 对比度检查

| # | 检查项 | 最低要求 | 判定标准 |
|---|--------|---------|---------|
| W1 | `foreground` on `background` | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W2 | `foreground` on `surface` | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W3 | `foreground` on `surfaceElevated` | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W4 | `accent` on `background` | >= 3:1 | ratio >= 3.0 → [PASS] |
| W5 | `muted` on `background` | >= 3:1 | ratio >= 3.0 → [PASS] |
| W6 | `codeForeground` on `codeBackground` | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W7 | `buttonForeground` on `buttonBackground` | >= 4.5:1 | ratio >= 4.5 → [PASS] |

### 8.4 生成物检查

| # | 检查项 | 判定标准 |
|---|--------|---------|
| G1 | `palette.css` 存在 | 文件存在 → [PASS] |
| G2 | `palette.css` 包含 12 个核心 token | token 数量 == 12 → [PASS] |
| G3 | `palette.css` 包含 8 个 `-raw` RGB 派生 | raw 数量 == 8 → [PASS] |
| G4 | 每个 agent CSS 存在（6 个） | 文件数量 == 6 → [PASS] |
| G5 | 每个 agent CSS 包含全部 14 个 `--agentskin-*` token | token 数量 == 14 → [PASS] |
| G6 | 每个 agent CSS 的 `color-scheme` 与 `manifest.mode` 一致 | 一致 → [PASS] |

### 8.5 资源文件检查

| # | 检查项 | 判定标准 |
|---|--------|---------|
| R1 | `icon.png` 存在（128x128） | 文件存在 → [PASS] |
| R2 | `preview.png` 存在（1280x720） | 文件存在 → [PASS] |
| R3 | `hero.webp` 存在（1920x1080，可选） | 文件存在或标记可选 → [PASS] |
| R4 | 所有资源路径不逃逸包根目录 | 无 `../` → [PASS] |

### 8.6 验证命令速查

```bash
# 1. 生成 palette + agent CSS
npm run generate:themes

# 2. 运行完整主题校验
npm run check:themes

# 3. 检查 palette 是否过期
npm run check:theme-staleness

# 4. 全量校验（含主题检查）
npm run check
```

---

## 9. 错误处理与修复指南

### 9.1 常见错误与修复

| 错误类型 | 表现 | 修复方法 |
|---------|------|---------|
| Token 缺失 | `check:themes` 报告缺少 token | 补充缺失 token，使用推导规则 |
| 对比度不足 | WCAG 检查失败 | 按第 5.3 节算法调整 |
| 颜色格式错误 | 校验器拒绝 | 转换为 6 位 HEX 或有效 rgba |
| manifest 格式错误 | JSON 解析失败 | 修正 JSON 语法 |
| 资源文件缺失 | icon/preview 不存在 | 生成占位图或提示用户提供 |
| color-scheme 不一致 | agent CSS 与 manifest.mode 不符 | 重新生成 CSS |

### 9.2 Agent 修复循环

```
验证失败
  │
  ├─ Token 缺失?
  │   └─ 是 → 使用推导规则补充 → 重新验证
  │
  ├─ 对比度不足?
  │   └─ 是 → 调整 foreground/background/accent → 重新验证
  │
  ├─ 格式错误?
  │   └─ 是 → 修正格式 → 重新验证
  │
  ├─ 资源缺失?
  │   └─ 是 → 生成占位资源 → 重新验证
  │
  └─ 超过 3 次修正仍失败?
      └─ 报告具体错误，请求用户介入
```

---

## 10. 附录

### 附录 A: 已知 SPDX 许可证标识符

```
MPL-2.0, MIT, Apache-2.0, GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0,
BSD-2-Clause, BSD-3-Clause, CC-BY-4.0, CC-BY-SA-4.0, CC-BY-NC-4.0,
CC-BY-NC-SA-4.0, CC-BY-ND-4.0, CC-BY-NC-ND-4.0, CC0-1.0, Unlicense, Proprietary
```

### 附录 B: 6 个目标 Agent ID

```
traework, qoderwork, workbuddy, doubao, codex, zcode
```

### 附录 C: Agent 原生 Token 命名空间速查

| Agent | 作用域选择器 | 原生 Token 前缀 |
|-------|------------|----------------|
| traework | `html.agentskin-host-traework body` | `--vscode-*`, `--vscode-icube-*` |
| qoderwork | `html.agentskin-host-qoderwork:root` | `--color-*` |
| workbuddy | `body[data-application-name="workbuddy"]` | `--cb-*` |
| doubao | `html.agentskin-host-doubao:root` | `--dbx-*` |
| codex | `html.agentskin-host-codex` | `--color-token-*` |
| zcode | `html.agentskin-host-zcode` | `--color-token-*` |

### 附录 D: 构建命令速查

| 命令 | 用途 |
|------|------|
| `npm run generate:palette` | 从 manifest 生成 palette.css |
| `npm run generate:theme-css` | 生成 6 个 agent CSS |
| `npm run generate:themes` | 上述两个命令的合集 |
| `npm run check:themes` | 校验 14-token 契约 + 对比度 + 署名链 |
| `npm run check:theme-staleness` | 检查 palette CSS 是否过期 |
| `npm run check` | 全量校验（含主题检查） |

### 附录 E: 完整生成示例

以下是一个 Agent 从用户描述到产出主题的完整示例：

**用户输入**: "帮我做一个赛博朋克风格的主题，主色调用霓虹蓝"

**Agent 处理**:

1. 解析关键词: "赛博朋克" + "霓虹蓝"
2. 选择模板: 赛博朋克模板（第 6.1 节）
3. 调整 accent: 将 accent 调整为霓虹蓝 `#00f0ff`
4. 确定 mode: dark（赛博朋克默认暗色）
5. 生成完整 manifest（含 14 token）
6. 验证对比度: 全部通过
7. 生成资源文件: icon/preview/hero
8. 运行 `npm run generate:themes`
9. 运行 `npm run check:themes` → 全绿

**产出 manifest.json**:

```json
{
  "$schema": "https://agentskin.dev/schema/manifest-v2.json",
  "schemaVersion": 2,
  "id": "cyberpunk-neon-blue",
  "name": "Cyberpunk Neon Blue",
  "displayName": "赛博霓虹蓝",
  "version": "1.0.0",
  "description": "霓虹蓝赛博朋克风格主题，深邃夜空背景搭配冰蓝高光。",
  "author": { "name": "AI Agent" },
  "mode": "dark",
  "category": "cyberpunk",
  "tags": ["cyberpunk", "neon", "blue", "dark", "sci-fi"],
  "icon": "icon.png",
  "preview": "preview.png",
  "hero": "hero.webp",
  "colors": {
    "accent": "#00f0ff",
    "secondary": "#ff00aa",
    "background": "#0a0a10",
    "foreground": "#e0e0ff",
    "muted": "#7a7a9a",
    "surface": "#12122a",
    "surfaceElevated": "#1a1a3a",
    "border": "#00f0ff2e",
    "codeBackground": "#050510",
    "codeForeground": "#c0c0e0",
    "inputBackground": "#1a1a3a",
    "buttonBackground": "#00f0ff",
    "buttonForeground": "#0a0a10",
    "focusRing": "#00f0ff60"
  },
  "supportedAgents": ["traework", "qoderwork", "workbuddy", "doubao", "codex", "zcode"],
  "license": "MPL-2.0",
  "minAppVersion": "1.0.0"
}
```

---

> **文档维护**: 本文档与 `scripts/theme-tokens.mjs`、`scripts/build-palette.mjs`、`scripts/check-themes.mjs` 保持同步。若核心 token 集合变更，需同步更新本文档。
