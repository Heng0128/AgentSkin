# Primer Design Token 系统分析

> **分析对象**: GitHub Primer Design System (https://primer.style)
> **分析日期**: 2025-07
> **目的**: 为 AgentSkin 设计 token 系统提供参考依据

---

## 1. Primer Token 三层结构详解

Primer 将设计 token 严格分为三层，自底向上依次为：Base、Functional、Component。

### 1.1 Base Tokens（基础层）

- **定位**: 原子值集合，直接对应一个具体的数值（颜色值、像素值、字号值）。
- **命名风格**: 类别名 + 刻度编号。
  - 色板: `blue.000` ~ `blue.900`、`gray.000` ~ `gray.900`、`green`、`red`、`yellow`、`orange`、`purple`、`pink`、`coral` 等 11 个色相，每个色相 8~10 档。
  - 字号: `text.xs` (10 / 12) / `text.sm` (12 / 16) / `text.md` (14 / 20) / `text.lg` (16 / 24) / `text.xl` (20 / 28) / `text.2xl` (24 / 32) / `text.3xl` (30 / 36) / `text.4xl` (36 / 44) / `text.5xl` (48 / 56) / `text.6xl` (64 / 72)。
  - 间距: `spacer.0` ~ `spacer.6` (0 / 4 / 8 / 16 / 24 / 32 / 48 / 64)。
  - 圆角: `radius.1` ~ `radius.4` (2 / 4 / 6 / 8)。
- **特性**: 无"用途"语义，只描述数值本身；直接可被两层引用。

### 1.2 Functional Tokens（功能 / 语义层）

- **定位**: 赋予 Base token 具体的"用途意图"；UI 开发中绝大多数情况下只使用这一层。
- **命名风格**: 区域前缀 + 语义后缀（详见第 2 节）。
- **典型示例**:
  - `fg.default`、`fg.muted`、`fg.accent`、`fg.danger`
  - `bg.default`、`bg.inset`、`bg.accent`、`bg.danger`
  - `border.default`、`border.muted`、`border.accent`
  - `shadow.resting`、`shadow.hover`
- **特性**: 不含具体色值或像素值；每个 token 在不同色彩主题下映射到不同的 Base token（详见第 3 节）。

### 1.3 Component Tokens（组件层）

- **定位**: 为单一组件的内部状态 / 变体提供最细粒度的控制；是 Functional tokens 的"子集"再命名。
- **命名风格**: 组件名 + 区域 + 状态。
- **典型示例**:
  - `Button.primary.bg`
  - `Button.outline.border.default`
  - `Button.outline.border.hover`
  - `Button.invisible.fg.default`
  - `Avatar.bg`
  - `Avatar.border`
  - `TextInput.bg.default`
  - `TextInput.bg.disabled`
  - `Popover.bg`
  - `TimelineItemBadge.bg`
- **特性**: 组件层 token 变更频率远高于功能层；组件层 token 最终仍归结到 Functional（或极少数 Base），不可能"悬空"。

### 1.4 三层之间的约束关系

| 约束 | 说明 |
|------|------|
| 单向依赖 | Component → Functional → Base；禁止反向引用 |
| 层内不可跨引用 | 同层 token 之间不互相映射（避免循环） |
| Component 必须落地 | 每个 Component token 必须有明确的 Functional（或 Base）终点 |
| Functional 应覆盖 | 同样的用途应优先复用 Functional，避免在多个 Component 中重复映射同一 Base |

---

## 2. 色彩 Token 命名规范

Primer 的色彩 token 统一使用 **"区域前缀 + 语义后缀"** 的二维命名法。

### 2.1 三个区域前缀

| 前缀 | 含义 | 作用域 |
|------|------|--------|
| `fg.` | foreground | 文本、图标等前景元素 |
| `bg.` | background | 背景填充 |
| `border.` | border | 描边、分割线 |

### 2.2 语义后缀（跨 fg/bg/border 通用）

| 后缀 | 含义 | 使用场景 |
|------|------|----------|
| `.default` | 默认 / 主要 | 主文本、主背景、主边框 |
| `.muted` | 弱化 / 次级 | 次级说明文本、弱化边框 |
| `.emphasis` | 强调 | 极少数高对比度强调文本 |
| `.accent` | 品牌强调 | 链接、品牌标识 |
| `.success` | 正向 / 成功 | 成功提示 |
| `.attention` | 注意 / 警告 | 警告状态 |
| `.danger` | 危险 / 错误 | 错误、删除、危险操作 |
| `.severe` | 严重 | 高危 / 危险加重 |
| `.done` | 完成 / 正向结果 | 已完成、合并状态 |
| `.open` | 开启 / 进行中 | 开放 Issue / PR |
| `.closed` | 关闭 / 已结束 | 关闭 Issue / PR |
| `.disabled` | 禁用 | 禁用态控件 |
| `.onEmphasis` | 强调面上的反色 | 在强调色背景上的前景 |
| `.inset` | 内嵌背景 | 页面内嵌区域、输入框背景 |

### 2.3 命名实例

```
fg.default              → 主文本色
fg.muted                → 次级文本
fg.onEmphasis           → 强调背景上的反白文本

bg.default              → 页面底色
bg.inset                → 输入框、卡片内嵌底色
bg.emphasis             → 高亮强调背景

border.default          → 主边框
border.muted            → 弱化边框
border.disabled         → 禁用边框
```

### 2.4 助记口诀

> **同前缀换后缀 = 同场景换语义；同后缀换前缀 = 同语义换场景。**

这使得 token 命名在任意场景下保持可预测：只要知道区域和语义，就能拼出准确的 token 名。

---

## 3. 暗色 / 亮色映射机制

### 3.1 核心原则

Functional token 在不同"模式 (Mode)"下映射到不同的 Base token，但 Functional token 名称不变。

### 3.2 映射表结构

Primer 内部将每个 Functional 值拆为多个"模式槽位"：

| 模式 | 用途 | 映射策略 |
|------|------|----------|
| `light` | 浅色主题 | 直接指向 Base 色板 |
| `light_high_contrast` | 浅色高对比 | 更深/更浅的 Base 值以实现 WCAG AAA |
| `light_colorblind` | 色盲友好浅色 | 替换色相（红绿色相区分） |
| `dark` | 深色主题 | 指向反转的 Base 色板 |
| `dark_dimmed` | 深色减弱版 | 比 dark 更低的对比度 |
| `dark_high_contrast` | 深色高对比 | 更亮的 Base 值 |
| `dark_colorblind` | 色盲友好深色 | 替换色相 |

### 3.3 实际映射示例

以 `fg.default` 为例:

```
light    → gray.900   (近黑)
dark     → gray.100   (近白)
light_high_contrast → gray.900
dark_high_contrast  → gray.000 (纯白)
dark_dimmed         → gray.150 (略灰)
```

以 `bg.default` 为例:

```
light    → white
dark     → gray.900
dark_dimmed         → gray.800
light_high_contrast → white
dark_high_contrast  → black
```

### 3.4 实现载体

- Primer 通过 CSS 自定义属性（CSS variables）实现映射。
- 每种模式的根类（如 `--media-color-mode: dark` 或 `.mode-dark`）下重新定义变量值。
- 组件最终只使用 Functional 模式的变量（`var(--fg-default)` 等）。
- 切换主题 = 切换根容器上的模式类，无需修改 CSS 规则。

### 3.5 关键设计决策

| 决策 | 原因 |
|------|------|
| Functional 名称跨主题不变 | 组件代码不感知主题，降低耦合 |
| Base 按 000~900 编号排序 | 同色相内数值可预测、可系统化增量 |
| 高对比 / 色盲作为独立模式而非扩展 | 改动是全局性的，独立模式便于整体覆盖 |

---

## 4. 尺度系统（Spacing / Typography /Radius）的 Token 化方式

### 4.1 Spacing（间距）

#### 4.1.1 Base 颗粒

Primer 采用 4px 数学递进序列:

```
spacer.0 = 0
spacer.1 = 4
spacer.2 = 8
spacer.3 = 16
spacer.4 = 24
spacer.5 = 32
spacer.6 = 48
spacer.7 = 64
spacer.8 = 80
spacer.9 = 96
spacer.10 = 112
spacer.11 = 128
spacer.12 = 256
```

#### 4.1.2 Functional 层

进一步抽象为语义化间距:

```
stack.padding.normal      → 16px          (表单、卡片内部)
stack.padding.condensed   → 8px           (紧凑控件)
section.padding.page      → 24 / 32       (页面级 padding)
md.padding.block          → 16px          (Markdown 块级)
```

#### 4.1.3 与 Tailwind 的关系

Primer 的 spacer 集会整体输出为 Tailwind 的 `theme.extend.spacing`，兼容 Tailwind 的 `p-*`、`m-*`、`gap-*` 等原子类。

### 4.2 Typography（排版）

#### 4.2.1 Base 层

```
text.xs      = 10px / lh 1.2  (受限使用)
text.sm      = 12px / lh 1.2  (脚注、辅助)
text.md      = 14px / lh 1.4  (正文默认)
text.lg      = 16px / lh 1.4  (大屏正文)
text.xl      = 20px / lh 1.4  (卡片标题)
text.2xl     = 24px / lh 1.4  (区域标题)
text.3xl     = 30px / lh 1.4  (页面标题)
text.4xl     = 36px / lh 1.4  (视觉大标题)
text.5xl     = 48px / lh 1.4
text.6xl     = 64px / lh 1.4
```

#### 4.2.2 字重与字体

```
font.weight.light    = 300
font.weight.normal   = 400
font.weight.medium   = 500
font.weight.semibold = 600
font.weight.bold     = 700

font.family.body     = -apple-system, 'Segoe UI', 'Noto Sans', Helvetica, Arial
font.family.mono     = ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas
```

#### 4.2.3 Functional 层（排版语义）

```
heading.xs.size      → text.sm (12)
heading.sm.size      → text.md (14)
heading.md.size      → text.lg (16)
heading.lg.size      → text.xl (20)
heading.xl.size      → text.2xl (24)
heading.2xl.size     → text.3xl (30)
heading.3xl.size     → text.4xl (36)
heading.4xl.size     → text.5xl (48)
heading.5xl.size     → text.6xl (64)

body.size.default   → text.md (14)
body.size.large     → text.lg (16)
```

### 4.3 Radius（圆角）

#### 4.3.1 Base

```
radius.1 = 2px      (极小: Tag、Badge)
radius.2 = 4px      (小: 按钮、小输入框)
radius.3 = 6px      (中: 卡片、中等控件)
radius.4 = 8px      (大: 模态框、Popover)
```

#### 4.3.2 Functional

```
Button.radius       → radius.2
Popover.radius      → radius.4
TextInput.radius    → radius.2
Avatar.radius.full  → 50% (特殊值)
border.radius.block → radius.2
```

### 4.4 设计原则总结

1. **Base 层无场景信息**——只有刻度编号。
2. **Functional 层定义"场景模式"**——按钮圆角、卡片圆角、badge 圆角等。
3. **Component 层覆盖默认值**——允许单组件偏离 Functional 既有值。
4. **所有尺度 token 严格遵循数学递进**——消除散值和随意值。

---

## 5. 对 AgentSkin 的借鉴点

### 5.1 三层结构的移植

AgentSkin 现有的 14-token theme 契约应明确对应三层映射关系:

| AgentSkin 现状 | Primer 对应 | 建议调整 |
|--------------|------------|---------|
| 颜色 token（如 `text.primary`、`bg.canvas`） | Functional 层 | ✅ 保留，但需梳理后缀规范 |
| 调色板基础值 | Base 层 | 补充 Base 色板刻度 |
| 组件专有 token（如 Button、Panel） | Component 层 | 补充组件层覆盖规则 |

### 5.2 语义后缀规范化

AgentSkin 现有后缀尚不够统一，建议向 Primer 看齐:

| 当前 AgentSkin 后缀 | 建议对齐_primer 后缀 | 变更理由 |
|--------------------|---------------------|---------|
| `text.primary` / `text.secondary` | `fg.default` / `fg.muted` | 前缀统一为 fg |
| `bg.canvas` / `bg.surface` | `bg.default` / `bg.inset` | 语义更明确 |
| `border.subtle` | `border.muted` | 对齐 Primer 语义体系 |
| `accent.primary` | `fg.accent` / `bg.accent` | 按区域拆分为 fg / bg |

### 5.3 暗色映射规范化

AgentSkin 当前的暗色实现可能存在硬编码或非线性偏差，建议:

- 定义**单一 source of truth** 的 Base 调色板。
- 亮色 / 暗色通过 Functional → Base 的映射表决定。
- 不再在组件代码中出现条件判断式 (`if (dark) return X else return Y`)。

### 5.4 尺度 token 严格化

AgentSkin 当前间距已接近 4/8/16/24/32/48 序列，建议:

- 将间距刻度输出为 Tailwind `theme.extend.spacing`，保持 Primer 的兼容性。
- 为字号、圆角、字重建立与 Primer 类似的 Functional 抽象层。
- 通过 `check-design-tokens.mjs` 强制执行已对齐的间距档位。

### 5.5 主题 Studio 输出格式优化

AgentSkin Theme Studio 最终输出的主题 JSON 应:

- 明确区分"Functional 输出"与"Base 输出"两种模式。
- 默认只用 Functional 层输出（用户写 `fg.default` 而非 `#1f2328`）。
- 高级模式才允许 Base 粒度覆盖（用户写具体色值）。

### 5.6 校验规则可复用

Primer 的架构约束可被 `check-design-tokens.mjs` 复用:

| 校验点 | Primer 规则 | AgentSkin 校验脚本 |
|--------|------------|-------------------|
| 间距档位 | 仅限 4px 网格 | ✅ C6 |
| 圆角档位 | radius.1~4 | 可扩展 C6 |
| 字号阶梯 | text.xs ~ text.6xl | 可扩展 C6 |
| 色板合规 | 每色相 8~10 档 | 可扩展 C6 |
| 三层依赖方向 | Component → Functional → Base | 可新增脚本 |

---

## 6. 不适合 AgentSKin 的部分

### 6.1 过度细分的组件层 token

Primer 为 Button / Avatar / TimelineItem / Popover 等组件各定义了完整 token 集，是为 GitHub 全站几十个产品服务的；AgentSkin 只有 6 页 UI + 6 适配器，组件层 token 过多会导致:

- 主题 JSON 冗长，CDP 注入传输量增加。
- 单组件的 token 被过度拆分，维护成本上升。

**建议**: AgentSkin 的组件层 token 只对高频 / 变体多的组件（Button、Panel、Tag）做定义，其余复用 Functional 层即可。

### 6.2 高对比 / 色盲 / Dimmed 等完整模式体系

Primer 支持 light / light_high_contrast / light_colorblind / dark / dark_dimmed / dark_high_contrast / dark_colorblind 共七种模式，是为 GitHub 的广泛用户群和法规 (ADA / WCAG) 合规准备的；

AgentSkin 是单一厂商桌面应用，用户群体集中、使用场景固定，目前 light + dark 两种模式已足够，引入 dimmed / 高对比 / 色盲模式会导致:

- Base 色板数量膨胀，映射表复杂度指数级增加。
- Theme Studio 输出 JSON 字段数翻倍。
- 维护成本显著上升。

**建议**: 仅保留 baseline light / dark 两种模式；如有合规需求，局部在 Functional 层加入对比度修正即可，不必重载全模式体系。

### 6.3 Primer 的 Base 色板粒度过细

Primer 每色相提供 8~10 档（如 `blue.000` ~ `blue.900`），11 色相共约 100 个 Base token；

AgentSkin 的目标应用是六款 AI 工作台的 CDP 注入，每个适配器的目标选择器与设计状态不同，过细的色板反而会提高注入失败的排查成本。

**建议**: AgentSkin 的 Base 色板采用"主线色相 + 有限刻度"策略:

- 主色相 (primary blue): 5 档 (100 / 300 / 500 / 700 / 900)
- 中性灰 (gray): 6 档
- 语义色 (green / red / yellow / purple): 各 3 档
- 合计约 25~30 个 Base 色，足够 Functional 层映射。

### 6.4 Primer 的国际化排版定制

Primer 针对 CJK 语言（中日韩）都有独立的字体 fallback 和行高修正；AgentSkin 的产品以中文为主，且通过 CDP 注入到目标应用中运行，目标应用自身的字体 / 行高不一定与 Primer 的 CJK 规则兼容；

**建议**: AgentSkin 在 Theme Studio 输出中保留 CJK 友好的字体候选栈，但不做多重行高规则，避免与目标应用的样式冲突。

### 6.5 Primer 的 CSS Variables 注入层

Primer 通过 `:root {--xxx: ...}` 在 CSSOM 根层面注入变量，实际样式的生效依赖"页面支持自定义属性"；

AgentSkin 通过 CDP 注入到第三方应用（如 traework、qoderwork），这些目标应用不保证 :root 可写或自定义属性生效；AgentSkin 当前使用直接的 CSS 值覆盖（value-based injection）而非 CSS variables，这是正确的路径，不应盲目模仿 Primer 的注入策略。

**建议**: 继续采用 value-based 注入，仅在目标应用确认支持 CSS variables 时才启用变量模式。

### 6.6 Primer 的设计 token 文档化体系

Primer 维护了一套完整的 token 文档站点，每个 token 提供可视化、说明、可用性和代码示例；

AgentSkin 的 token 文档目前集中在 `docs/design-tokens.md`，短期内无需独立站点；但应保持 Markdown 文档与代码同步，避免与 Primer 的"文档即代码"策略脱节。

**建议**: 在 `docs/design-tokens.md` 中引入 token 表中字段: token 名、用途、Base 映射、暗色映射、变更记录。

---

## 附: Primer Token 结构示意

```
┌─────────────────────────────────────────────────────────────┐
│  Component Tokens                                           │
│  Button.primary.bg → Button.bg.default → bg.accent          │
│  Button.outline.border.hover → border.accent                │
│  Avatar.bg → bg.default                                     │
│  Popover.bg → bg.default                                    │
│  …                                                          │
├─────────────────────────────────────────────────────────────┤
│  Functional Tokens                                          │
│  fg.default / fg.muted / fg.accent / fg.danger              │
│  bg.default / bg.inset / bg.accent / bg.danger              │
│  border.default / border.muted / border.accent              │
│  shadow.resting / shadow.hover                              │
├─────────────────────────────────────────────────────────────┤
│  Base Tokens                                                │
│  blue.000 ~ blue.900                                        │
│  gray.000 ~ gray.900                                        │
│  green.000 ~ green.900                                      │
│  spacer.0 ~ spacer.12                                       │
│  text.xs ~ text.6xl                                         │
│  radius.1 ~ radius.4                                        │
│  font.weight.light ~ font.weight.bold                       │
│  …                                                          │
└─────────────────────────────────────────────────────────────┘
```

---

*文档完。*
