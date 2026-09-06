---
version: 2.0.0
target_apps:
  - traework
  - qoderwork
  - workbuddy
  - doubao
  - codex
  - zcode
schema_version: 2
date: 2026-08-28
---

# AgentSkin 主题生成规范（AI Agent 可读）

> **版本**: 2.0.0 | **日期**: 2026-08-28
> **目标读者**: AI Agent（自动生成、验证、修复主题）
> **权威来源**: `scripts/theme-tokens.mjs`（REQUIRED_TOKENS）、`themes/THEME_SPEC.md`（文件结构/构建流水线）、`docs/design-tokens.md`（设计系统）
> **不变量**: 14-token 契约不可修改；本文档与代码实现保持同步。

---

## AGENT:START

> 以下为 Agent 可解析的结构化规则。Agent 读取本文档时必须遵守所有标记为 `[RULE]` 的条目。

---

## 1. 概述与目标

### 1.1 用途

本文档定义 AI Agent 为 AgentSkin 项目生成主题的完整规范。Agent 通过消费本文档，能够：

1. 理解 AgentSkin 的 14-token 语义契约
2. 从用户提供的图片、描述或关键词提取并映射 token
3. 按流程创建完整主题包并通过验收
4. 自动验证对比度（WCAG 2.1 AA）并修正
5. 识别并遵守禁止事项

### 1.2 与现有文档的关系

| 文档 | 定位 | 本文档差异 |
|------|------|-----------|
| `themes/THEME_SPEC.md` | 主题包结构 + 构建流水线（权威） | 本文档不重复文件结构细节，聚焦 Agent 生成工作流 |
| `docs/THEME-AI-SPEC.md` | 已有的 AI 生成规范（v1.0） | 本文档为后继版本，扩展图片映射决策树与禁止事项 |
| `docs/THEME_AUTHORING_GUIDE.md` | 手写深度适配指南 | 本文档聚焦 Agent 自动化，不要求 Agent 手写 CSS |
| `docs/design-tokens.md` | 设计系统 token 文档 | 本文档仅引用与主题生成直接相关的 token |

### 1.3 核心原则 `[RULE]`

- **最小完备集**: 14 个 token 是最小完备集，缺失任何一个都会导致某个 Agent 渲染异常
- **生成器优先**: Agent 优先使用 `npm run generate:themes` 产出 CSS，不手写 agent CSS
- **WCAG 强制**: 所有颜色组合必须满足 WCAG 2.1 AA 对比度要求
- **署名链必填**: `author.name` + `license` 为必填字段（P2 合规）

---

## 2. 14-Token 完整参考

### 2.1 Token 总览

| # | CSS 变量名 | Manifest Key | 用途 | 必填 | 默认值/推导规则 |
|---|-----------|-------------|------|------|-----------------|
| 1 | `--agentskin-bg` | `background` | 全局背景色 | **是** | 无 |
| 2 | `--agentskin-surface` | `surface` | 卡片/面板表面色 | **是** | 无 |
| 3 | `--agentskin-surface-elevated` | `surfaceElevated` | 提升层表面色 | **是** | 无 |
| 4 | `--agentskin-text` | `foreground` | 主文本色 | **是** | 无 |
| 5 | `--agentskin-muted` | `muted` | 次要文本/占位符 | 否 | `foreground` + 60% alpha |
| 6 | `--agentskin-accent` | `accent` | 主强调色 | **是** | 无 |
| 7 | `--agentskin-secondary` | `secondary` | 次强调色 | 否 | `accent` 低饱和变体 |
| 8 | `--agentskin-border` | `border` | 边框色 | 否 | `accent` + 18% alpha |
| 9 | `--agentskin-code-bg` | `codeBackground` | 代码块背景 | 否 | 等于 `background` |
| 10 | `--agentskin-code-fg` | `codeForeground` | 代码块前景 | 否 | 等于 `foreground` |
| 11 | `--agentskin-focus-ring` | `focusRing` | 焦点环色 | 否 | `accent` + 40% alpha |
| 12 | `--agentskin-selection` | `selection` | 文本选区色 | 否 | `accent` + 32% alpha |
| 13 | `--agentskin-button-bg` | `buttonBackground` | 按钮背景色 | 否 | 等于 `accent` |
| 14 | `--agentskin-input-bg` | `inputBackground` | 输入框背景色 | 否 | 等于 `surface` |

> **Agent-only token**: #13 (`buttonBackground`) 和 #14 (`inputBackground`) 仅存在于 agent CSS 层，`palette.css` 不包含它们。

### 2.2 各 Token 详细约束与从图片取色方法 `[RULE]`

#### Token 1: `background` → `--agentskin-bg`

- **语义**: 应用最底层背景，所有其他表面的参照基准
- **亮色模式**: 相对亮度 L >= 90%
- **暗色模式**: 相对亮度 L <= 15%
- **格式**: 6 位 HEX (`#rrggbb`) 或 8 位 HEX (`#rrggbbaa`)
- **WCAG**: 与 `foreground` 的对比度必须 >= 4.5:1 (AA)
- **从图片取色**: 取图片中面积最大的暗色区域（暗色模式）或亮色区域（亮色模式）；避免取到主体物体的颜色

#### Token 2: `surface` → `--agentskin-surface`

- **语义**: 卡片、侧边栏、面板等容器表面
- **亮色模式**: 接近白色（如 `#ffffff`）
- **暗色模式**: 比 `background` 亮 3-8% 亮度
- **从图片取色**: 取图片中大面积背景区域偏亮的部分；若无合适值，暗色模式 = `background` + 5% 亮度

#### Token 3: `surfaceElevated` → `--agentskin-surface-elevated`

- **语义**: 弹窗、下拉菜单、浮层等提升层级表面
- **约束**: 必须比 `surface` 更亮（暗色模式）或更深（亮色模式）
- **从图片取色**: 暗色模式 = `surface` + 3% 亮度；通常不需要从图片直接取色，由 `surface` 推导

#### Token 4: `foreground` → `--agentskin-text`

- **语义**: 主文本、标题、正文
- **亮色模式**: 深色（L <= 30%）
- **暗色模式**: 高亮度（L >= 85%）
- **WCAG**: 与 `background` 对比度 >= 4.5:1 (AA)，>= 7:1 (AAA)
- **从图片取色**: 取图片中最亮的非白色区域；或根据模式选择：暗色模式用 `#e8eaf2` 类亮色，亮色模式用 `#1a1a2e` 类暗色

#### Token 5: `muted` → `--agentskin-muted`

- **语义**: 占位符、禁用文本、时间戳等次要信息
- **与 text 关系**: 比 `foreground` 低 30-50% 不透明度
- **WCAG**: 与 `background` 对比度 >= 3:1（大文本 AA）
- **从图片取色**: 不直接从图片取色，由 `foreground` 降低不透明度推导

#### Token 6: `accent` → `--agentskin-accent`

- **语义**: 链接、主按钮、焦点指示器、进度条
- **亮色模式**: 中饱和度（避免过亮导致对比度不足）
- **暗色模式**: 中高亮度（确保在深色背景上可辨识）
- **WCAG**: 作为按钮色时，与按钮上文字对比度 >= 4.5:1
- **从图片取色**: 取图片中**饱和度最高、面积适中**的颜色；避免取背景色或纯黑/白；优先取主体物体的品牌色或主色调

#### Token 7: `secondary` → `--agentskin-secondary`

- **语义**: 次级强调——标签、badge、辅助高亮
- **与 accent 关系**: 应与 `accent` 色相相邻或互补，饱和度可略低
- **从图片取色**: 取图片中第二显眼的彩色；或由 `accent` 色相偏移 +/- 30 度推导

#### Token 8: `border` → `--agentskin-border`

- **语义**: 分隔线、输入框边框、卡片描边
- **常见格式**: `rgba(r, g, b, alpha)` 或带 alpha 的 8 位 HEX
- **典型 alpha**: 0.12-0.24（暗色模式），0.08-0.16（亮色模式）
- **从图片取色**: 不直接从图片取色，由 `accent` + 低 alpha 推导

#### Token 9: `codeBackground` → `--agentskin-code-bg`

- **语义**: 代码块、内联代码背景
- **暗色模式**: 通常比 `background` 略深或与 `background` 相同
- **亮色模式**: 通常为浅灰（如 `#f3f4f6`）
- **从图片取色**: 不直接从图片取色，使用 `background` 或略深值

#### Token 10: `codeForeground` → `--agentskin-code-fg`

- **语义**: 代码块前景色
- **与 code-bg 关系**: 对比度 >= 4.5:1
- **从图片取色**: 不直接从图片取色，使用 `foreground`

#### Token 11: `focusRing` → `--agentskin-focus-ring`

- **语义**: 键盘焦点环、选中指示
- **推导规则**: 若未提供，生成器使用 `color-mix(in srgb, accent 40%, transparent)`
- **从图片取色**: 不直接从图片取色，由 `accent` 推导

#### Token 12: `selection` → `--agentskin-selection`

- **语义**: 文本选中高亮背景
- **推导规则**: 若未提供，生成器使用 `color-mix(in srgb, accent 32%, transparent)`
- **从图片取色**: 不直接从图片取色，由 `accent` 推导

#### Token 13: `buttonBackground` → `--agentskin-button-bg`

- **语义**: 主按钮背景
- **agent-only**: 仅存在于 agent CSS 层
- **从图片取色**: 不直接从图片取色，使用 `accent`

#### Token 14: `inputBackground` → `--agentskin-input-bg`

- **语义**: 输入框、文本域背景
- **agent-only**: 仅存在于 agent CSS 层
- **从图片取色**: 不直接从图片取色，使用 `surface`

### 2.3 派生 Token（自动生成）`[RULE]`

以下 token 由构建脚本自动生成，**不需要**也不允许在 manifest 中声明：

| CSS 变量 | 生成规则 |
|----------|---------|
| `--agentskin-accent-raw` | `R, G, B` 三元组 |
| `--agentskin-secondary-raw` | `R, G, B` 三元组 |
| `--agentskin-text-raw` | `R, G, B` 三元组 |
| `--agentskin-muted-raw` | `R, G, B` 三元组 |
| `--agentskin-surface-raw` | `R, G, B` 三元组 |
| `--agentskin-surface-elevated-raw` | `R, G, B` 三元组 |
| `--agentskin-bg-raw` | `R, G, B` 三元组 |
| `--agentskin-border-raw` | `R, G, B` 三元组 |
| `--agentskin-text-shadow` | 亮/暗模式不同 |
| `--agentskin-art` | 运行时注入（引擎 Blob URL） |

> `[RULE]` **禁止**在 manifest.json 的 `colors` 对象中添加自定义键。`colors` 为 `additionalProperties: false`。

---

## 3. 图片到主题映射决策树 `[RULE]`

当用户提供图片作为主题灵感来源时，Agent 按以下决策树处理：

```
图片输入
  │
  ├─ 步骤 1: 判断图片类型
  │   │
  │   ├─ 干净艺术图（无文字、无 UI 元素、纯视觉）
  │   │   → 直接进入步骤 2
  │   │
  │   ├─ 带字截图（含应用界面、文字、按钮等 UI 元素）
  │   │   → 忽略文字和 UI 控件颜色，仅提取大面积背景/主体色
  │   │   → 警告用户：截图可能含版权 UI 布局
  │   │
  │   └─ 纯色图/渐变图（无明确主体）
  │       → 将主色作为 accent 候选
  │       → background/surface/foreground 按亮度规则推导
  │
  ├─ 步骤 2: 计算平均亮度 L_avg 和主色饱和度 S_main
  │   │
  │   ├─ L_avg < 0.20 → mode = dark（暗色图，用亮色文本）
  │   ├─ L_avg > 0.70 → mode = light（亮色图，用暗色文本）
  │   └─ 0.20 <= L_avg <= 0.70 → 根据饱和度判断
  │       ├─ S_main > 0.3 → mode = dark（彩色图，暗底更突出）
  │       └─ S_main <= 0.3 → mode = dark（灰度图，默认暗色）
  │
  ├─ 步骤 3: 提取调色板
  │   │
  │   ├─ background = 暗色组中频率最高的颜色（暗色模式）
  │   │             或亮色组中频率最高的颜色（亮色模式）
  │   ├─ foreground = 亮色组中频率最高的颜色（暗色模式）
  │   │             或暗色组中频率最高的颜色（亮色模式）
  │   ├─ accent = 彩色组中饱和度最高的颜色
  │   │          若彩色组为空，取与 background 互补的中性色
  │   ├─ surface = background + 5% 亮度（暗色）/ background - 5% 亮度（亮色）
  │   ├─ surfaceElevated = surface + 3% 亮度（暗色）/ surface - 3% 亮度（亮色）
  │   ├─ secondary = accent 色相 +/- 30 度或 accent 低饱和变体
  │   ├─ muted = foreground + 60% alpha
  │   ├─ border = accent + 18% alpha
  │   ├─ codeBackground = background
  │   ├─ codeForeground = foreground
  │   ├─ focusRing = accent + 40% alpha
  │   ├─ selection = accent + 32% alpha
  │   ├─ buttonBackground = accent
  │   └─ inputBackground = surface
  │
  └─ 步骤 4: 对比度验证与修正
      │
      ├─ 若 contrast(foreground, background) < 4.5:
      │   → 暗色: foreground += 5% 亮度, background -= 2% 亮度
      │   → 亮色: foreground -= 5% 亮度, background += 2% 亮度
      │   → 循环直到达标（最多 5 次迭代）
      │
      ├─ 若 contrast(accent, background) < 3.0:
      │   → 暗色: accent += 3% 亮度
      │   → 亮色: accent -= 3% 饱和度
      │   → 循环直到达标
      │
      └─ 若 contrast(muted, background) < 3.0:
          → 调整 muted 不透明度（降低 foreground 混合比例）
```

### 3.1 亮度计算公式 `[RULE]`

```
相对亮度 L = 0.2126 × R_lin + 0.7152 × G_lin + 0.0722 × B_lin

其中:
  R_lin = (R_srgb <= 0.03928) ? R_srgb/12.92 : ((R_srgb+0.055)/1.055)^2.4
  G_lin = (G_srgb <= 0.03928) ? G_srgb/12.92 : ((G_srgb+0.055)/1.055)^2.4
  B_lin = (B_srgb <= 0.03928) ? B_srgb/12.92 : ((B_srgb+0.055)/1.055)^2.4

  R_srgb = R_8bit / 255
  G_srgb = G_8bit / 255
  B_srgb = B_8bit / 255
```

### 3.2 WCAG 2.1 对比度公式 `[RULE]`

```
Contrast Ratio = (L1 + 0.05) / (L2 + 0.05)

  L1 = 较亮颜色的相对亮度
  L2 = 较暗颜色的相对亮度
  结果范围: 1:1（无对比）到 21:1（最大对比）
```

### 3.3 验收阈值 `[RULE]`

| 组合 | 最低要求 | WCAG 等级 |
|------|---------|----------|
| `foreground` on `background` | >= 4.5:1 | AA |
| `foreground` on `surface` | >= 4.5:1 | AA |
| `foreground` on `surfaceElevated` | >= 4.5:1 | AA |
| `accent` on `background` | >= 3:1 | AA UI |
| `muted` on `background` | >= 3:1 | AA Large |
| `codeForeground` on `codeBackground` | >= 4.5:1 | AA |
| `buttonForeground` on `buttonBackground` | >= 4.5:1 | AA |

---

## 4. 六个目标应用的特殊注意事项

### 4.1 概览

每个主题通过 CDP 注入为 6 个目标应用生成独立 CSS。生成器路线（路线 A）自动处理下列差异；Agent 在生成器路线上**不需要**关心每端选择器细节。但若用户要求深度适配（路线 B），Agent 必须警告用户：路线 B 超出 Agent 自动化范围，需手写 CSS。

### 4.2 各端 Token 命名空间（供参考）

| Agent | 作用域选择器 | 原生 Token 前缀 | 特殊说明 |
|-------|------------|----------------|---------|
| traework | `html.agentskin-host-traework body` | `--vscode-*`, `--vscode-icube-*` | VS Code fork，壳层 token 写在 body 上 |
| qoderwork | `html.agentskin-host-qoderwork:root` | `--color-*` | antd 体系 |
| workbuddy | `body[data-application-name="workbuddy"]` | `--cb-*` | 腾讯体系，需用 `body[data-application-name]` 提升优先级 |
| doubao | `html.agentskin-host-doubao:root` | `--dbx-*`, `--semi-color-*` | 251-token 语义封装层，`--dbx-` 与 `--semi-color-` 并存 |
| codex | `html.agentskin-host-codex` | `--color-token-*` | 与 QoderWork 同族 |
| zcode | `html.agentskin-host-zcode` | `--color-token-*` | Codex 派生壳，可复用 codex.css |

### 4.3 稳定表面（供深度适配参考）

| Agent | 稳定表面选择器 |
|-------|--------------|
| workbuddy | `.conversation-sidebar`, `.conversation-list`, `.chat-container`, `.wb-home-page`, `.wb-home-composer` |
| traework | `.task-list-base`, `.solo-lite-panel-border`, `.panel-content`, `.solo-lite-chat-panel-container` |
| qoderwork | `.agents-layout-root`, `.agents-sidebar`, `.agents-content-area`, `.agents-parchment-paper-surface` |
| codex/zcode | `aside.app-shell-left-panel`, `main.main-surface`, `header.app-header-tint`, `.composer-surface-chrome` |
| doubao | `.chat-container`, `.dbx-*` 语义容器 |

### 4.4 各端注意事项 `[RULE]`

- **traework**: VS Code fork，原生 token 覆盖面广；生成器路线可覆盖大部分场景
- **qoderwork**: antd 的 `--color-*` 体系 token 数量多；生成器路线通常足够
- **workbuddy**: `--cb-*` 体系，CSS 作用域必须用 `body[data-application-name="workbuddy"]` 提升优先级
- **doubao**: 最复杂的一端，251 个 `--dbx-*` token + `--semi-color-*` 并存；若生成器路线效果不佳，提示用户可能需要手动补充
- **codex/zcode**: 同族体系，ZCode 可复用 Codex CSS 再核对差异；`--color-token-*` 命名空间

---

## 5. 主题创建流程 `[RULE]`

### 5.1 输入类型

Agent 接收以下一种或多种输入：

| 输入类型 | 格式 | 处理方式 |
|---------|------|---------|
| 文本描述 | 自然语言 | 提取风格关键词 + 颜色词 |
| 风格关键词 | 字符串 | 匹配风格模板（见 5.3） |
| 参考图片 | 图片文件/URL | 提取调色板（见第 3 节） |
| 基础色 | HEX 颜色 | 以该色为 accent 推导完整调色板 |
| 完整 manifest | JSON | 验证并补充缺失字段 |

### 5.2 风格模板决策树

```
用户描述/关键词
  │
  ├─ 含"霓虹"/"赛博"/"科技"/"未来" → 赛博朋克模板
  ├─ 含"极简"/"简洁"/"干净"/"朴素" → 极简模板
  ├─ 含"自然"/"森林"/"植物"/"清新" → 自然模板
  ├─ 含"夜空"/"极光"/"深邃"/"宇宙" → 暗色极光模板
  ├─ 含"复古"/"怀旧"/"暖色"/"咖啡" → 暖色复古模板
  ├─ 含"明亮"/"白色"/"清新"/"晨" → 亮色晨雾模板
  ├─ 含图片 → 从图片提取调色板（第 3 节）
  └─ 无明确偏好 → 默认暗色极光模板
```

### 5.3 风格模板速查

#### 赛博朋克（Cyberpunk）

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

#### 极简（Minimal）

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

#### 暗色极光（Dark Aurora）

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

#### 亮色晨雾（Light Mist）

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

### 5.4 创建步骤 `[RULE]`

Agent 按以下顺序执行：

#### 步骤 1: 解析输入
- 提取关键词、颜色、图片调色板
- 按 5.2 决策树选择策略

#### 步骤 2: 确定模式与目标
- mode: 用户指定 > 图片亮度 > 文本描述 > 默认 dark
- 目标 Agent: 默认全部 6 个；用户可指定子集

#### 步骤 3: 生成调色板
- 按 5.3 模板或图片提取结果填充 14 个 token
- 必填 3 个（background, foreground, accent）不可缺失
- 可选 11 个使用推导规则计算

#### 步骤 4: 对比度验证与修正
- 按 3.3 验收阈值逐项检查
- 不满足时按 3.1/3.2 算法修正
- 最多 3 次修正循环

#### 步骤 5: 写入 manifest.json
- 创建 `themes/<theme-id>/` 目录
- 写入完整 manifest.json（含 colors + 元数据）
- 确保 `colors` 含 14 个 token

#### 步骤 6: 准备资源文件
- `icon.png` (128x128)
- `preview.png` (1280x720)
- `hero.webp` (1920x1080，可选)
- 若用户未提供，Agent 应使用代码生成占位图（纯色 + 主题名文字）

#### 步骤 7: 生成 CSS
```bash
npm run generate:themes
```

#### 步骤 8: 运行校验
```bash
npm run check:themes
```

#### 步骤 9: 最终确认
- `check:themes` 全绿
- 6 个 agent CSS 文件存在
- `palette.css` 包含 12 个核心 token
- `git status` 仅显示预期文件

### 5.5 输出结构

```
themes/<theme-id>/
├── manifest.json           # 主题元数据 + 14 token
├── icon.png                # 128x128
├── preview.png             # 1280x720
├── hero.webp               # 1920x1080（可选）
├── palette.css             # 【生成物】12 核心 token + raw 派生
└── assets/css/
    ├── traework.css        # 【生成物】
    ├── qoderwork.css       # 【生成物】
    ├── workbuddy.css       # 【生成物】
    ├── doubao.css          # 【生成物】
    ├── codex.css           # 【生成物】
    └── zcode.css           # 【生成物】
```

---

## 6. 禁止事项（红线）`[RULE]`

以下行为被严格禁止，Agent 在任何情况下都不得违反：

### 6.1 Token 与契约

| # | 禁止行为 | 后果 |
|---|---------|------|
| P1 | 修改 REQUIRED_TOKENS 列表（增减 token） | 破坏 14-token 契约 |
| P2 | 在 manifest.json 的 `colors` 中添加自定义键 | 校验器拒绝（additionalProperties: false） |
| P3 | 省略必填 token（background / foreground / accent） | 主题无法生成 |
| P4 | 使用无效 CSS 颜色格式（如 `red`、`rgb()` 不带 `#`） | 校验失败 |

### 6.2 安全与合规

| # | 禁止行为 | 后果 |
|---|---------|------|
| P5 | 省略 `author.name` 或 `license` | P2 合规失败 |
| P6 | 在主题文件中嵌入未经授权的图片素材 | 版权风险 |
| P7 | 从截图中提取并复制目标应用的 UI 布局 | 版权风险 |

### 6.3 生成与校验

| # | 禁止行为 | 后果 |
|---|---------|------|
| P8 | 跳过 `npm run check:themes` 直接交付 | 未验证主题可能渲染异常 |
| P9 | `check:themes` 失败时伪造通过 | 破坏 CI 门禁 |
| P10 | 手写 agent CSS 冒充生成物 | 与生成器产出不一致，维护困难 |
| P11 | 修改 `palette.css`（生成物标记文件） | 下次生成时被覆盖 |

### 6.4 文件与路径

| # | 禁止行为 | 后果 |
|---|---------|------|
| P12 | 在 `themes/<id>/` 下创建不属于主题包结构的文件 | 违反路径卫生规范（AGENTS.md §10） |
| P13 | 资源路径使用 `../` 逃逸包根目录 | loader 拒绝加载 |
| P14 | 将命令输出重定向到 `.txt` 文件 | 路径污染 |

### 6.5 架构

| # | 禁止行为 | 后果 |
|---|---------|------|
| P15 | Agent 自行决定新增适配器（突破 6 上限） | 违反黄金规则 #1，需 RFC |
| P16 | Agent 自行决定修改注入架构 | 违反黄金规则 #4，需 RFC |
| P17 | 引入新的第三方颜色库而未说明必要性 | 违反依赖管理规则 |

---

## 7. 验收清单 `[RULE]`

Agent 完成主题生成后，必须逐项自验证。每个检查项标注 `[PASS]` / `[FAIL]`。

### 7.1 结构检查

| # | 检查项 | 方法 | 判定 |
|---|--------|------|------|
| S1 | manifest.json 存在且为合法 JSON | JSON.parse() | 无语法错误 → [PASS] |
| S2 | `manifest.id` 与目录名一致 | 字符串相等 | 相等 → [PASS] |
| S3 | `manifest.id` 匹配 `^[a-z0-9][a-z0-9_-]*$` | 正则 | 匹配 → [PASS] |
| S4 | `manifest.colors.background` 存在 | !== undefined | 存在 → [PASS] |
| S5 | `manifest.colors.foreground` 存在 | !== undefined | 存在 → [PASS] |
| S6 | `manifest.colors.accent` 存在 | !== undefined | 存在 → [PASS] |
| S7 | `manifest.mode` 为 dark/light/auto | includes() | 包含 → [PASS] |
| S8 | `manifest.author.name` 非空 | length > 0 | 非空 → [PASS] |
| S9 | `manifest.license` 为已知 SPDX | 见附录 A | 已知 → [PASS] |
| S10 | `manifest.version` 匹配 semver | `/^\d+\.\d+\.\d+/` | 匹配 → [PASS] |

### 7.2 14-Token 完整性检查

| # | 检查项 | 判定 |
|---|--------|------|
| T1-T14 | manifest.colors 包含全部 14 个 key | 每个存在 → [PASS] |

### 7.3 WCAG 对比度检查

| # | 检查项 | 最低要求 | 判定 |
|---|--------|---------|------|
| W1 | foreground on background | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W2 | foreground on surface | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W3 | foreground on surfaceElevated | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W4 | accent on background | >= 3:1 | ratio >= 3.0 → [PASS] |
| W5 | muted on background | >= 3:1 | ratio >= 3.0 → [PASS] |
| W6 | codeForeground on codeBackground | >= 4.5:1 | ratio >= 4.5 → [PASS] |
| W7 | buttonForeground on buttonBackground | >= 4.5:1 | ratio >= 4.5 → [PASS] |

### 7.4 生成物检查

| # | 检查项 | 判定 |
|---|--------|------|
| G1 | palette.css 存在 | 存在 → [PASS] |
| G2 | palette.css 包含 12 个核心 token | count == 12 → [PASS] |
| G3 | palette.css 包含 8 个 -raw RGB 派生 | count == 8 → [PASS] |
| G4 | 6 个 agent CSS 存在 | count == 6 → [PASS] |
| G5 | 每个 agent CSS 包含全部 14 个 --agentskin-* token | count == 14 → [PASS] |
| G6 | 每个 agent CSS 的 color-scheme 与 manifest.mode 一致 | 一致 → [PASS] |

### 7.5 资源文件检查

| # | 检查项 | 判定 |
|---|--------|------|
| R1 | icon.png 存在（128x128） | 存在 → [PASS] |
| R2 | preview.png 存在（1280x720） | 存在 → [PASS] |
| R3 | hero.webp 存在（1920x1080，可选） | 存在或标记可选 → [PASS] |
| R4 | 所有资源路径不逃逸包根目录 | 无 `../` → [PASS] |

---

## 8. 完整示例：从一张图片创建主题

### 8.1 场景

**用户输入**: "请根据这张夜空星云的图片帮我做一个主题。"

（假设图片特征：深蓝紫色背景 L_avg=0.08，主要星云为蓝紫色 S=0.45，有少量亮白恒星）

### 8.2 Agent 处理过程

**步骤 1: 判断图片类型** → 干净艺术图（无文字/UI）→ 进入步骤 2

**步骤 2: 计算亮度** → L_avg=0.08 < 0.20 → mode = **dark**

**步骤 3: 提取调色板**

| Token | 取值 | 来源 |
|-------|------|------|
| background | `#0a0a1a` | 图片最暗区域（星空背景） |
| foreground | `#e8e8f0` | 亮白恒星色 + 星云高光 |
| surface | `#14142a` | background + 5% 亮度 |
| surfaceElevated | `#1e1e3a` | surface + 3% 亮度 |
| accent | `#7C7FFF` | 星云主色调（蓝紫，饱和度最高） |
| secondary | `#A87CFF` | accent 色相 +30 度（偏紫） |
| muted | `#8888a0` | foreground 60% alpha |
| border | `#7C7FFF2e` | accent + 18% alpha |
| codeBackground | `#050510` | background 略深 |
| codeForeground | `#c8c8e0` | foreground 浅化 |
| focusRing | `#7C7FFF60` | accent + 60% alpha |
| selection | `#7C7FFF32` | accent + 32% alpha |
| buttonBackground | `#7C7FFF18` | accent + alpha |
| inputBackground | `#1e1e3a` | surfaceElevated |

**步骤 4: 对比度验证**

- foreground (#e8e8f0) on background (#0a0a1a): ~15:1 ✅
- accent (#7C7FFF) on background (#0a0a1a): ~8:1 ✅
- muted (#8888a0) on background (#0a0a1a): ~5:1 ✅
- 全部达标，无需修正

**步骤 5: 写入 manifest.json**

```json
{
  "$schema": "https://agentskin.dev/schema/manifest-v2.json",
  "schemaVersion": 2,
  "id": "nebula-dreams",
  "name": "Nebula Dreams",
  "displayName": "星云梦境",
  "version": "1.0.0",
  "description": "深邃星云与冰蓝高光的宇宙主题，灵感来自深空摄影。",
  "author": { "name": "AI Agent" },
  "mode": "dark",
  "category": "creative",
  "tags": ["dark", "space", "nebula", "blue", "purple"],
  "icon": "icon.png",
  "preview": "preview.png",
  "hero": "hero.webp",
  "colors": {
    "accent": "#7C7FFF",
    "secondary": "#A87CFF",
    "background": "#0a0a1a",
    "foreground": "#e8e8f0",
    "muted": "#8888a0",
    "surface": "#14142a",
    "surfaceElevated": "#1e1e3a",
    "border": "#7C7FFF2e",
    "codeBackground": "#050510",
    "codeForeground": "#c8c8e0",
    "inputBackground": "#1e1e3a",
    "buttonBackground": "#7C7FFF18",
    "buttonForeground": "#7C7FFF",
    "focusRing": "#7C7FFF60"
  },
  "supportedAgents": ["traework", "qoderwork", "workbuddy", "doubao", "codex", "zcode"],
  "license": "MPL-2.0"
}
```

**步骤 6-9**: 准备资源 → `npm run generate:themes` → `npm run check:themes` → 全绿

---

## 附录 A: 已知 SPDX 许可证标识符

```
MPL-2.0, MIT, Apache-2.0, GPL-2.0, GPL-3.0, LGPL-2.1, LGPL-3.0,
BSD-2-Clause, BSD-3-Clause, CC-BY-4.0, CC-BY-SA-4.0, CC-BY-NC-4.0,
CC-BY-NC-SA-4.0, CC-BY-ND-4.0, CC-BY-NC-ND-4.0, CC0-1.0, Unlicense, Proprietary
```

## 附录 B: 构建命令速查

| 命令 | 用途 |
|------|------|
| `npm run generate:palette` | 从 manifest 生成 palette.css |
| `npm run generate:theme-css` | 生成 6 个 agent CSS |
| `npm run generate:themes` | 上述两个命令的合集 |
| `npm run check:themes` | 校验 14-token 契约 + 对比度 + 署名链 |
| `npm run check:theme-staleness` | 检查 palette CSS 是否过期 |
| `npm run check` | 全量校验（含主题检查） |

---

## AGENT:END

---

> **文档维护**: 本文档与 `scripts/theme-tokens.mjs`、`themes/THEME_SPEC.md`、`scripts/check-themes.mjs` 保持同步。若核心 token 集合变更，需同步更新本文档。
