# AgentSkin 设计系统 Token 文档

> 版本：v2.7
> 日期：2026-09-07
> 来源：`src/ui/globals.css`（唯一事实源，以 hex 值为唯一色彩格式）、`scripts/design-language.mjs`、`scripts/extended-colors.mjs`
> 说明：本文件完整记录 AgentSkin 的设计系统 token。所有色彩值均从 globals.css 提取（以 hex/rgba 为唯一色彩格式），dark 与 light 主题差异已标注。本文档同时记录主题层 Design Language 变量和 Extended Colors 系统。
> 变更：v2.7 UI 视觉升级：`shadow-elev1/2/3` 三条 `@utility` 接线（#18，5 处卡片 hover 阴影首次生效）、`--text-title/caption/display` 接线（PageHeader 标题上阶梯 16→17px、描述去散值）、`.as-glow` 激活（消费 `--glow-*` token，选中卡/激活环境卡/InjectDock 活动态）、`.as-card-hover`/`.as-pressable` 死代码删除（#14）、`.page-enter` 补 `animation-fill-mode: backwards` 支撑列表入场 stagger。token 数值未做任何改动。
> v2.6 卫生清理（零视觉）：`--dl-radius` 同值双写合并为单 owner（#15）；mono 栈源令牌改名 `--font-stack-mono` 消除 `--font-mono` 自引用循环（#16）。token 数值未做任何改动。
> v2.5 落地命名空间收敛（§13.3 #7）：`--text-micro` 接线（#11，57 处死类转活）、四条 `@utility duration-*`（#12，86 处死类转活）、`--animate-indeterminate` 令牌 + keyframes（#13，进度条不确定态首次动画）。token 数值未做任何改动。
> v2.4 落地 §13.4 预备的三处 (B) BEM 钩子补 CSS（`pw__title-btn` / `ws-inspector__res-btn` / `ws-inspector__frame-toggle`，`layout.css`），C13 基线同步修剪；token 数值未做任何改动。
> v2.3 移除 §1 的风格流派命名与主观措辞（Quiet Workbench / Calm · Simple · Restrained · Clear / 克制 / 极简），改为对 token 构成的客观描述；**token 数值未做任何改动**。
> v2.2 以 `globals.css` 实际 hex 值为准，将全部 HSL 值替换为 hex/rgba 值，消除文档与代码之间的格式不一致。
> ⚠️ 以 `src/ui/globals.css` 的 hex 值为唯一事实源。

---

## 目录

1. [设计原则](#1-设计原则)
2. [色彩系统](#2-色彩系统)
3. [字体系统](#3-字体系统)
4. [圆角系统](#4-圆角系统)
5. [阴影系统](#5-阴影系统)
6. [动效系统](#6-动效系统)
7. [间距与布局网格](#7-间距与布局网格)
8. [语义色与状态](#8-语义色与状态)
9. [组件级 token](#9-组件级-token)
10. [Design Language 系统（v2.6+）](#10-design-language-系统v26)
11. [Extended Colors 语义色（v2.6+）](#11-extended-colors-语义色v26)
12. [WCAG/APCA 对比度引擎（v2.6+）](#12-wcagapca-对比度引擎v26)
13. [已知问题与建议](#13-已知问题与建议)

---

## 1. 设计原则

AgentSkin 的设计系统不挂靠任何外部风格流派命名，以下只描述界面实际的构成方式（数值以 `src/ui/globals.css` 为准）：

- **表面分层**：5 级背景深度（`--background` / `--surface` / `--secondary` / `--card` / `--card2` / `--popover`），层级由 elevation 阴影 + hairline 边框共同承担
- **单一品牌色**：品牌色只负责 focus / active / CTA 三种职责，其余层级由中性灰阶区分
- **字体层级**：Inter（UI 全文）· JetBrains Mono（标签/数据）· 系统字体（CJK）
- **网格对齐**：12 列布局网格（`.g12`），数据密集区用紧凑 mono + `tabular-nums`
- **档位可调**：`--dl-radius` 为动态圆角根值（默认 6px），圆角、密度（`--dl-density-scale`）、动效（`--duration-multiplier`）均可在 Settings 切换，组件经 token 派生跟随
- **阴影分级**：`--shadow-elev1/2/3` + `--shadow-float` 四级，`--shadow-xs..xl` 为其别名

---

## 2. 色彩系统

### 2.1 品牌色（Brand）

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--primary` | `#e11d48` | `#e11d48` | 品牌主色（按钮/激活/进度/焦点） |
| `--primary-foreground` | `#ffffff` | `#ffffff` | 主色上的前景 |
| `--accent` | `rgba(225, 29, 72, 0.1)` | `rgba(225, 29, 72, 0.08)` | 强调底色（激活态背景） |
| `--accent-foreground` | `#fb3658` | `#e11d48` | 强调前景 |
| `--ring` | `rgba(225, 29, 72, 0.4)` | `rgba(225, 29, 72, 0.35)` | 焦点环 |
| `--destructive` | `#be123c` | `#be123c` | 危险/删除 |
| `--destructive-foreground` | `#ffffff` | `#ffffff` | 危险色上的前景 |
| `--brand-rgb` | `225 29 72` | `225 29 72` | RGB 通道，供 `rgba(var(--brand-rgb), α)` 合成 |
| `--glow-brand` | `rgba(225, 29, 72, 0.08)` | `rgba(225, 29, 72, 0.08)` | 品牌光晕（弱） |
| `--glow-brand-strong` | `rgba(225, 29, 72, 0.12)` | `rgba(225, 29, 72, 0.14)` | 品牌光晕（强） |

> 品牌色为 **Rose**：`#e11d48` = `rgb(225, 29, 72)`，dark/light 同值。
> ⚠️ 旧文档记录的 `--brand-red` / `--brand-red-hover` 在 `globals.css` 中**从未定义**，v2.3 起从本文档移除，请勿引用。

### 2.2 中性灰阶

`globals.css` **不定义** `--gray-*` 原子色板，灰阶以具体值内联在各语义 token 中：

| 语义 | Dark | Light |
|------|------|-------|
| 主前景 | `--foreground: #f5f5f7` | `--foreground: #18181b` |
| 弱化文字 | `--muted-foreground: #9ca0aa` | `--muted-foreground: #6b7280` |
| 次级文字 | `--secondary-foreground: #9ca0aa` | `--secondary-foreground: #6b7280` |

> ⚠️ 旧版 §2.2 的 `--gray-100 … --gray-900` 九档表为虚构内容（代码中不存在），v2.3 起移除。需要新灰阶时优先绑定现有语义 token，而不是新增原子色。

### 2.3 语义表面色（Dark 默认）

| Token | Dark 值 | 语义 |
|-------|---------|------|
| `--background` | `#0a0a0d` | 页面背景（最深） |
| `--foreground` | `#f5f5f7` | 前景文字 |
| `--surface` | `#0e0e12` | 框架表面（Sidebar / TitleBar） |
| `--surface-raised` | `#1a1a21` | 抬升框架表面 |
| `--secondary` | `#111115` | 次级表面 |
| `--secondary-foreground` | `#9ca0aa` | 次级表面文字 |
| `--card` | `#16161c` | 卡片 |
| `--card-foreground` | `#f5f5f7` | 卡片文字 |
| `--card2` | `#1c1c23` | 抬升卡片 / hover 底 |
| `--popover` | `#18181e` | 浮层 |
| `--popover-foreground` | `#f5f5f7` | 浮层文字 |
| `--muted` | `rgba(255, 255, 255, 0.045)` | 弱化表面 |
| `--muted-foreground` | `#9ca0aa` | 弱化文字 |
| `--border` | `rgba(255, 255, 255, 0.06)` | 边框（hairline） |
| `--border-strong` | `rgba(255, 255, 255, 0.1)` | 强边框 |
| `--input` | `rgba(255, 255, 255, 0.07)` | 输入框边框 |
| `--scrim` | `rgba(0, 0, 0, 0.5)` | 遮罩 / 裁剪外区 |
| `--destructive` | `#be123c` | 危险/删除 |

**背景深度阶梯（由暗到亮）**：
`--background #0a0a0d` → `--surface #0e0e12` → `--secondary #111115` → `--card #16161c` → `--popover #18181e` → `--surface-raised #1a1a21` → `--card2 #1c1c23`

### 2.4 语义表面色（Light）

| Token | Light 值 |
|-------|---------|
| `--background` | `#f7f7f8` |
| `--foreground` | `#18181b` |
| `--surface` | `#eeeeef` |
| `--surface-raised` | `#ffffff` |
| `--secondary` | `#f1f1f3` |
| `--secondary-foreground` | `#6b7280` |
| `--card` | `#ffffff` |
| `--card-foreground` | `#18181b` |
| `--card2` | `#ffffff` |
| `--popover` | `#ffffff` |
| `--muted` | `rgba(0, 0, 0, 0.035)` |
| `--muted-foreground` | `#6b7280` |
| `--border` | `rgba(0, 0, 0, 0.075)` |
| `--border-strong` | `rgba(0, 0, 0, 0.13)` |
| `--input` | `rgba(0, 0, 0, 0.09)` |
| `--scrim` | `rgba(0, 0, 0, 0.5)` |
| `--destructive` | `#be123c` |

> Light 下 `--card` / `--card2` / `--popover` / `--surface-raised` 同为 `#ffffff`，层级改由 `--shadow-elev*` 与 `--border` 区分。

### 2.5 色值来源

`globals.css` 的 `@import` 仅有四项：`tailwindcss`、`tw-animate-css`、`react-day-picker/style.css`、`./shadcn-tailwind.css`。**未引入任何 Radix / 第三方调色板文件**，所有语义色均为 `globals.css` 内的字面 hex / rgba。

JS 侧镜像 `src/ui/colors.ts`（v2.3 起为唯一文件，重复的 `src/ui/design/colors.ts` 已删除）存放的是 **`var()` 引用而非 hex**（如 `accent: 'var(--primary)'`），供 canvas / 图表等无法使用 class 的场景消费，因此不会与 CSS 脱同步。

> ⚠️ 旧版本节声称依赖 `@radix-ui/colors/slate.css`，与代码不符，v2.3 起更正。
> ✅ v2.3 已删除重复的 `src/ui/design/colors.ts`，`src/ui/colors.ts` 为唯一 JS 侧契约文件（当前零引用，供 canvas / 图表等无法使用 class 的场景接入时优先消费）。

---

## 3. 字体系统

### 3.1 字体栈（定义于 `:root`）

| Token | 字体栈 | 用途 |
|-------|--------|------|
| `--font-display` | `var(--font-ui)`（同 UI 字体） | 品牌/展示/大数字 |
| `--font-ui` | `"Inter Variable", "Inter", "Microsoft YaHei UI", "PingFang SC", -apple-system, "Segoe UI", system-ui, sans-serif` | 正文/界面 |
| `--font-mono` | `"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", Consolas, ui-monospace, monospace` | 标签/数据/代码 |

> CJK 用高质量系统字体（Windows YaHei / macOS PingFang），不加载 web 字体。

### 3.2 Tailwind 映射（`@theme inline`）

| 类名 | 映射 |
|------|------|
| `font-display` | `var(--font-ui)` |
| `font-sans` / `font-heading` | `var(--font-ui)` |
| `font-mono` | `var(--font-mono)` |

### 3.3 字号规范（`@theme inline` 定义 + 工具类实际值）

| Token / 用途 | 字号 | 来源 |
|--------------|------|------|
| `--font-size-display` | 22px | `@theme inline` |
| `--font-size-title` | 17px | `@theme inline` |
| `--font-size-body-lg` | 14px | `@theme inline` |
| `--font-size-ui` | 13px | `@theme inline`（v2.3 新增，接替 16 处 `text-[13px]` 字面量） |
| `--text-ui` | `var(--font-size-ui)` | `@theme inline`（Tailwind 侧映射，产出 `text-ui`） |
| `--font-size-caption` | 12px | `@theme inline` |
| `--text-caption` | `var(--font-size-caption)` | `@theme inline`（v2.7 接线，产出 `text-caption`，PageHeader 描述消费） |
| `--text-title` | `var(--font-size-title)` | `@theme inline`（v2.7 接线，产出 `text-title`，PageHeader h1 消费） |
| `--text-display` | `var(--font-size-display)` | `@theme inline`（v2.7 接线，产出 `text-display`；当前 0 消费者，为 hero 场景预留——按需生成，未用不进产物） |
| `--font-size-body` | 12px | `@theme inline` |
| `--font-size-label` | 11px | `@theme inline` |
| `--font-size-micro` | 10px | `@theme inline` |
| `.as-micro` | 10px | utilities（`var(--font-size-micro)`） |
| `.as-mono` | 11px | utilities（`var(--font-size-label)` + `tabular-nums`） |
| `.as-section-title` | 11px | utilities（`var(--font-size-label)`，`letter-spacing: -0.025em`，sentence case） |

> **已移除的 Swiss 排印原语**：`.as-label`（11px + `text-transform: uppercase` + `letter-spacing: 0.04em`）与 `.as-kv` / `.as-kv-key` / `.as-kv-val`（hairline 行表格）已从 `globals.css` 删除，零消费者。段落/区块标签统一走 sentence case + `tracking-tight` 路线（`.as-section-title`、`SectionLabel` 组件、或等价 Tailwind 组合 `text-[11px] font-medium tracking-tight text-muted-foreground`）。 Quiet Workbench 三条判据之一「无宽字距大写排印」由此在代码与文案两侧同时成立（i18n 侧的装饰性全大写与「中文 · LATIN」叠字 kicker 亦已改为 sentence case）。

> ⚠️ **命名空间陷阱（v2.3 经生产构建产物核实）**：Tailwind v4 的 `text-*` 工具类读取 `--text-*` 命名空间，**不是** `--font-size-*`。因此 `--font-size-micro` 等键只产生 CSS 变量，**不产生** `text-micro` / `text-label` / `text-body` 等工具类。
> 现状核实：`text-label` / `text-body` / `text-body-lg` 仍为全仓 **0 处引用**（待有真实用法时按同模式接线）；`text-caption` / `text-title` / `text-display` 为 v2.7 接线（`text-caption` / `text-title` 已有 PageHeader 消费，`text-display` 预留）；`text-micro` 有 57 处引用（v2.5 转活），见 §13.2 #11。
> 已正确接线的字号工具类：`text-ui`（v2.3）、`text-micro`（v2.5）、`text-caption` / `text-title` / `text-display`（v2.7）。
> 其余写死值：`text-[12px]`、`text-[11px]` 等 arbitrary 值仍在用，均在 C6 白名单内但**未 token 化**。
> 行高：`--leading-title: 1.25` / `--leading-body: 1.5`
> 字距：`--tracking-tight: -0.02em`
> CRITICAL 数据正文不应低于 10px。

---

## 4. 圆角系统

### 4.1 动态根值

| Token | 值 | 说明 |
|-------|-----|------|
| `--dl-radius` | `6px` | 圆角根值，定义于 `:root` 与 `.light`；运行时由 `App.tsx` 按 Settings 的 `radiusScale` 覆写 |
| `--radius-card` | `10px` | 卡片圆角，**不参与 `--dl-radius` 派生**，被 `.as-panel` / `.as-card` 消费 |

> ⚠️ 旧文档的 `--radius-base` 在 `globals.css` 中**不存在**（v2.3 起移除该条目）。派生档位全部以 `--dl-radius` 为根。

### 4.2 衍生（`@theme inline`，基于 `--dl-radius` 缩放）

| Token | 计算 | 默认值（`--dl-radius: 6px`） |
|-------|------|------------------------------|
| `--radius-sm` | `calc(var(--dl-radius, 2px) * 0.75)` | `4.5px` |
| `--radius-md` | `calc(var(--dl-radius, 2px) * 1)` | `6px` |
| `--radius-lg` | `calc(var(--dl-radius, 2px) * 1.25)` | `7.5px` |
| `--radius-xl` | `calc(var(--dl-radius, 2px) * 1.5)` | `9px` |
| `--radius-2xl` | `calc(var(--dl-radius, 2px) * 1.75)` | `10.5px` |
| `--radius-pill` | `9999px` | `9999px` |

### 4.3 组件圆角约定（实际用法）

| 组件 | 圆角 | 出处 |
|------|------|------|
| Button | `rounded-md`（6px） | `components/ui/button.tsx` |
| Sidebar 导航项 | `rounded-md`（6px，随 `--dl-radius` 派生） | `sidebar/SidebarMenuItem.tsx` |
| 卡片 / 面板 | `rounded-[var(--radius-card, 10px)]` | `.as-panel` / `.as-card` |
| 浮层 / Dialog | `rounded-lg`（7.5px） | `ui/dialog.tsx` 等 |
| 徽章 / 计数 | `rounded-full` | `ui/badge.tsx`、`PageHeader` |
| App icon / Logo | `rounded-[10px]`、Logo `rx=11.5`、AppMark `rounded-[22%]` | `AppMark.tsx` / `Logo.tsx` |

> C6 校验允许集：`rounded-none/sm/md/lg/full`、任意值 ≤8px、`var(--radius-*)` 系列（见 `scripts/check-design-tokens.mjs`）。

---

## 5. 阴影系统

### 5.1 Dark 阴影（默认）

| Token | 值 | 说明 |
|-------|-----|------|
| `--shadow` | `var(--shadow-elev1)` | 向后兼容别名 |
| `--shadow-xs` | `var(--shadow-elev1)` | 向后兼容别名 |
| `--shadow-sm` | `var(--shadow-elev1)` | 向后兼容别名 |
| `--shadow-md` | `var(--shadow-elev2)` | 向后兼容别名 |
| `--shadow-lg` | `var(--shadow-elev3)` | 向后兼容别名 |
| `--shadow-xl` | `var(--shadow-float)` | 向后兼容别名 |

实际 elevation 定义：
- `--shadow-elev1`: `0 1px 2px rgba(0, 0, 0, 0.2)`
- `--shadow-elev2`: `0 2px 6px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(255, 255, 255, 0.05)`
- `--shadow-elev3`: `0 4px 12px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(255, 255, 255, 0.06)`
- `--shadow-float`: `0 8px 24px rgba(0, 0, 0, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.06)`

别名映射：`--shadow` / `--shadow-xs` / `--shadow-sm` → `elev1`；`--shadow-md` → `elev2`；`--shadow-lg` → `elev3`；`--shadow-xl` → `float`。

> ⚠️ **这组别名只对「手写 CSS 里 `var(--shadow-sm)`」生效，对 Tailwind 的 `shadow-sm` 工具类完全无效。**
> `--shadow-elev*` / `--shadow-float` / `--shadow-sm..xl` 全部声明在 `:root`（dark：`globals.css:97-100` elevation + `105-110` 别名；light：`212-215` + `220-225`），**没有一个在 `@theme` 里**（`@theme inline` 块 L280-392 内 `--shadow-*` 键数为 0），因此不参与 Tailwind 的 `--shadow-*` 命名空间。产物核实：`.shadow-sm{--tw-shadow:0 1px 3px 0 var(--tw-shadow-color,#0000001a),…}` —— 是 Tailwind 的**内置默认灰影**，而非 `elev1`。
> 受影响工具类使用量（严格类名口径，已排除 `drop-shadow-md` 这类 filter 命名空间命中）：`shadow-sm` 19 次、`shadow-md` 12 次、`shadow-lg` 4 次、`shadow-xl` 2 次，共 **37 处渲染的是默认阴影而非分级 elevation**。
> 例外一：`shadow-float` 靠 `@utility shadow-float` 显式定义，产物 `.shadow-float{box-shadow:var(--shadow-float)}` 存在且正确。
> 例外二（v2.7）：`shadow-elev1/2/3` 已照 `shadow-float` 同模式补 `@utility`（`globals.css` Custom Utilities 区块），产物 `.shadow-elev2{box-shadow:var(--shadow-elev2)}` 已核实生成——原先被当类名用了 5 次却从不渲染（§13.2 #18），现 5 处卡片 hover 阴影首次生效，dark/light 值经 `var()` 运行时切换。
> ⚠️ `shadow-sm/md/lg/xl` 那 37 处默认灰影**仍在**——如需统一为分级 elevation，须另行决策（涉及面广，属独立一轮）。
>
> 📐 **本文档所有类名计数的口径**：`src/ui/**/*.tsx`，排除 `*.test.tsx`；用 `(?<![\w-])类名(?![\w-])` 而非 `\b`（否则 `drop-shadow-md`、`--shadow-md`、`--agentskin-duration-base` 会被误计）；排除注释行；含 `hover:` / `after:` / `group-data-…:` 等变体前缀命中；按出现次数计。
> 📌 **行号时效**：`globals.css` 的行号引用为 v2.3 `@source not` 注释块（L6-14）插入后的值；该块使 L6 之后所有行号整体 +10。再次增删该文件后请重新定位，勿直接信任。

### 5.2 Light 阴影

| Token | 别名 | Light 实际值 |
|-------|------|-------------|
| `--shadow-xs` | `var(--shadow-elev1)` | `0 1px 2px rgba(0, 0, 0, 0.04)` |
| `--shadow-sm` | `var(--shadow-elev1)` | `0 1px 2px rgba(0, 0, 0, 0.04)` |
| `--shadow-md` | `var(--shadow-elev2)` | `0 2px 6px rgba(0, 0, 0, 0.05), 0 0 0 1px rgba(0, 0, 0, 0.05)` |
| `--shadow-lg` | `var(--shadow-elev3)` | `0 4px 12px rgba(0, 0, 0, 0.07), 0 0 0 1px rgba(0, 0, 0, 0.06)` |
| `--shadow-xl` | `var(--shadow-float)` | `0 8px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.06)` |

> Light 与 Dark 的别名映射完全一致，仅 elevation 的 alpha 不同。
> C6 校验（`scripts/check-design-tokens.mjs`）只允许 `shadow-none/sm/md/lg/xl/float` 与 `shadow-[var(--shadow…)]`；内联 `box-shadow` 只允许 `none` 或 `var(--shadow*)`。

---

## 6. 动效系统

### 6.1 时长（`@theme inline`）

| Token | 值 |
|-------|-----|
| `--duration-instant` | `0ms` |
| `--duration-fast` | `calc(100ms * var(--duration-multiplier, 1))` |
| `--duration-base` | `calc(150ms * var(--duration-multiplier, 1))` |
| `--duration-slow` | `calc(200ms * var(--duration-multiplier, 1))` |
| `--duration-slower` | `calc(280ms * var(--duration-multiplier, 1))` |

> 默认 multiplier 为 1，故实际值为 0/100/150/200/280ms。

### 6.2 缓动（`@theme inline`）

| Token | 值 |
|-------|-----|
| `--ease-spring` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-out` | `cubic-bezier(0, 0, 0.2, 1)` |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |

> ✅ v2.3 新增 `--animate-page-enter: page-enter var(--duration-base) var(--ease-spring)`（`@theme inline`，`src/ui/globals.css:378`）。构建产物已核实为 `.animate-page-enter{animation:page-enter var(--duration-base) var(--ease-spring)}`。
> ⚠️ 但旧文档虚构的 `--animate-card-enter` / `--animate-shadow-float` 依然**不存在**——构建产物中检索这两个字符串均为 0 命中。
> （产物文件名带内容哈希，每次构建都会变，故本文档不再引用具体哈希名。）
> 动画仍以 `globals.css` 内的 keyframes + `.as-*` 工具类为主，`--animate-*` 命名空间目前仅此一枚令牌。

### 6.3 Keyframes 清单（`globals.css` 本地定义）

| Keyframes | 消费方 | 用途 |
|-----------|--------|------|
| `page-enter` | `.page-enter` / `.animate-page-enter` | 页面进入（150ms，由 `App.tsx` 的 `key={route}` 触发）；后者经 `--animate-page-enter` 令牌生成，供三处浮层消费（见本节下方说明） |
| `status-pulse` | `.animate-status-pulse` | 运行状态点 |
| `agentskin-shimmer` | `.animate-shimmer` | 骨架屏微光 |
| `skeleton-fade-in` | `.skeleton-block` | 骨架阶梯入场 |
| `slide-in-right` | `.as-slide-in-right` | 右侧详情栏进入 |
| `agentskin-slide-up-enter` | `.as-slide-up-enter` | 浮层上滑进入 |
| `agentskin-toast-enter` / `agentskin-toast-exit` | `.as-toast-enter` / `.as-toast-exit` | Toast 进出 |
| `agentskin-breathe` | `.as-breathe` | 呼吸强调 |

> ✅ v2.3 已去重：`.page-enter` 原先定义两次（`page-fade-in` 280ms 与 `page-enter` 150ms，后者按层叠胜出），现仅存 `page-enter` 一处，`page-fade-in` keyframes 随重复定义一并移除；`.as-card-hover` 原先在 `@layer utilities` 与未分层区各定义一次（`-2px` vs `-1px`，未分层版胜出），现仅存 `-1px` 版本。两处去重均**不改变计算样式**。
> ✅ 已解决：v2.3 已补 `--animate-page-enter` 令牌（§6.2），`InstallProgress.tsx`、`RenameDialog.tsx`、`ImageCropDialog.tsx` 三处浮层恢复设计意图中的 150ms 淡入 + 6px 上滑入场（产物核实：`@keyframes page-enter{0%{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}`，时长走 `--duration-base` = `calc(150ms * var(--duration-multiplier, 1))`）。这是本轮**唯一**的视觉变化，且继承 `--duration-multiplier` 与 `prefers-reduced-motion`。
> `tw-animate-css` 另提供 `animate-in` / `fade-in` / `slide-in-from-*` 等工具类，与上表无关。

### 6.4 无障碍动效

已实现 `prefers-reduced-motion: reduce`（全局降级）+ `body.no-anim`（完全禁用）：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms;
    animation-duration: 0.01ms;
  }
}
```

---

## 7. 间距与布局网格

### 7.1 框架尺寸（`App.tsx` 实际值）

| 区域 | 尺寸 | 实现 |
|------|------|------|
| TitleBar | 36px | `h-9`（`components/TitleBar.tsx`） |
| Sidebar 展开 | 192px | `--sidebar-width` → `grid-cols-[var(--sidebar-width)_1fr]` |
| Sidebar 折叠 | 56px | 同上，`transition-[grid-template-columns]` |
| 主区行 | `minmax(0,1fr)_auto` | Settings 路由降级为单行 `minmax(0,1fr)` |
| 页面容器 | `padding: 16px 20px` | `var(--space-page-y) var(--space-page-x)`，**无 `max-width` 约束** |
| 内容滚动容器 | — | `.scroll-fade-y` + `overscroll-behavior-contain` |
| InjectDock | `fixed bottom-12` 居中 | `z-index: var(--z-dock)` 90 |
| ToastStack | `fixed bottom-10` 居中 | `z-index: var(--z-toast)` 100 |
| 12 列网格 | `gap: 16px` | `.g12` |

> ⚠️ 旧文档记录的「TitleBar 38px · StatusBar 28px · `grid-rows-[38px_minmax(0,1fr)_28px]` · 页面容器 `max-w-[1240px] px-[30px] py-[22px]`」在当前代码中**均不成立**：StatusBar 早已从 `App.tsx` 摘除（职能由 Sidebar 底部 `RunningAgentList` 承担，组件文件本身已于 v2.3 删除），页面容器无宽度上限。v2.3 起更正。

### 7.2 节奏 token（`globals.css` `:root`）

| Token | 值 | 消费方 |
|-------|-----|--------|
| `--space-page-x` | 20px | 页面容器左右内边距、`--color-page-gutter` |
| `--space-page-y` | 16px | 页面容器上下内边距 |
| `--space-section` | 20px | 区块间距 |
| `--space-card-pad` | 14px | 卡片内边距 |
| `--radius-card` | 10px | `.as-panel` / `.as-card` |
| `--dl-density-scale` | 1 | 密度倍率（compact 0.85 / comfortable 1 / cozy 1.15，由 `App.tsx` 写入） |

### 7.3 常用间距值（代码中实际使用）

| 值 | Tailwind | 用途 |
|----|----------|------|
| 4px | `gap-1` | 图标与文字 |
| 8px | `gap-2` / `p-2` | 控件簇、紧凑内边距 |
| 12px | `gap-3` / `p-3` | master-detail 列间距、卡片内边距 |
| 14px | `p-3.5` / `--space-card-pad` | 标准卡片 |
| 16px | `gap-4` / `.g12` gap | 页面区块、网格 |
| 20px | `--space-page-x` / `--space-section` | 页面与区块节奏 |

> 间距档位由 `scripts/check-design-tokens.mjs`（C6）强制：Tailwind 单位白名单 + 任意值 px 白名单（2/3/4/6/8/10/12/14/16/20/22/24/28/30/32/36/38/48/64/70/72/76/80/96/100）；`w-*` / `h-*` 属布局尺寸，不受限。

---

## 8. 语义色与状态

### 8.1 语义色

| 源 Token | Tailwind 映射 | Dark | Light | 语义 |
|----------|--------------|------|-------|------|
| `--cr-success` | `--color-success` / `--color-cr-success` | `#22c55e` | `#16a34a` | 成功/运行 |
| `--cr-warning` | `--color-warning` / `--color-cr-warning` | `#eab308` | `#ca8a04` | 警告/待机 |
| `--cr-info` | `--color-info` / `--color-cr-info` | `#3b82f6` | `#2563eb` | 信息 |
| `--destructive` | `--color-destructive` | `#be123c` | `#be123c` | 危险/删除 |

> 组件请写 `text-cr-success` / `bg-cr-warning`（或 `text-success` 别名）。CSS 侧只有 `--cr-*` 一组源变量，`--success` / `--warning` / `--info` 并非自定义属性，仅存在于 Tailwind 映射层。

### 8.2 抬升表面

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--card2` | `#1c1c23` | `#ffffff` | hover 底、次级按钮、内嵌块 |

> ⚠️ 旧版 §8.2 的 `--dim` / `--red` / `--red2` / `--redbg` / `--grn` / `--amb` / `--blu` / `--bg2` / `--border2` 简写令牌在 `globals.css` 中**从未定义**（全仓库亦无引用），v2.3 起整节移除。等价语义请走 §8.1 的 `--cr-*` 与 §2.1 的品牌令牌。

### 8.3 图表色（`--chart-1..5`）

| Token | Dark | Light |
|-------|------|-------|
| `--chart-1` | `#e11d48` | `#e11d48` |
| `--chart-2` | `#22c55e` | `#16a34a` |
| `--chart-3` | `#eab308` | `#ca8a04` |
| `--chart-4` | `#3b82f6` | `#2563eb` |
| `--chart-5` | `#a855f7` | `#9333ea` |

---

## 9. 组件级 token

### 9.1 Sidebar

| Token | Dark | Light |
|-------|------|-------|
| `--sidebar` | `#0e0e12` | `#eeeeef` |
| `--sidebar-foreground` | `#f5f5f7` | `#18181b` |
| `--sidebar-primary` | `#e11d48` | `#e11d48` |
| `--sidebar-primary-foreground` | `#ffffff` | `#ffffff` |
| `--sidebar-accent` | `rgba(225, 29, 72, 0.1)` | `rgba(225, 29, 72, 0.08)` |
| `--sidebar-accent-foreground` | `#fb3658` | `#e11d48` |
| `--sidebar-border` | `rgba(255, 255, 255, 0.075)` | `rgba(0, 0, 0, 0.075)` |
| `--sidebar-ring` | `rgba(225, 29, 72, 0.4)` | `rgba(225, 29, 72, 0.35)` |

> `--sidebar` 与 `--surface` 同值（dark `#0e0e12` / light `#eeeeef`）；Sidebar 组件自 v2.8 起消费 `--sidebar-*` 全家族（不再使用 `bg-surface`），并在运行时通过 `bindSidebarSubTokens()`（`sidebar/sidebarSurface.ts`）派生以下 `--ag-sidebar-*` 子 token，全部基于 `--sidebar-*` 的 `color-mix` 计算，无需主题逐一定义。**v2.9 一画布模型**：侧栏常态表面直接取页面 `--background`、壁纸模式透明（壁纸 + scrim 透出）；标题层不承载任何视觉（`TitleBar` 仅为主列 36px 透明拖拽条），品牌页头归侧栏本体（h-12），侧栏 `border-r` 由壳层全高贯通；`--ag-sidebar-bg`（面板底色桥）随之移除：

| 子 token | 值（运行时派生） | 说明 |
|---------|----------------|------|
| `--ag-sidebar-item-hover` | 常态 `color-mix(sidebar-foreground 5%, transparent)`；壁纸模式 `8%` | 导航项 hover 底色——由表面自身亮度派生，不引入外来色相；壁纸模式 hover 直接作用于移动壁纸上，5% 会被亮色内容淹没，故加强到 8% |
| `--ag-sidebar-item-active` | `var(--sidebar-accent)` | 导航项选中底色（沿用品牌 accent） |
| `--ag-sidebar-hairline` | `color-mix(sidebar-foreground 9%, transparent)` | 分隔线/菜单内部 hairline |
| `--ag-sidebar-scroll-hover` | `color-mix(sidebar-foreground 10%, transparent)` | 导航滚动条 hover 滑轨色（globals.css `.sidebar-nav-scroll`） |
| `--ag-sidebar-hover-shift` | `3px` | 展开态导航项 hover 的横向位移（`:root` 主题级默认 + 运行时绑定） |

> 已移除：`--ag-sidebar-logo-halo`（Rail Logo hover 品牌光晕）——唯一消费者是折叠态 logo 的 hover 光晕，但 logo 在 hover 时正要让位给展开按钮（错序换装），光晕永远无法触发，属死样式；随 v2.9 头部编排清理一并移除。

> 所有 CSS 消费方均携带与上表等值的 `var()` 内联回退；`bindSidebarSubTokens()` 未运行的隔离渲染（如单测）自动退回 v2.7 外观，不会破相。

### 9.2 品牌变体（`--cr-brand-*`）— ⚠️ DEPRECATED

> 以下 token 已在当前 `globals.css` 中移除，标记为废弃。如需品牌色请使用 `--primary` / `--brand-rgb`。

| Token | 原值 | 状态 |
|-------|------|------|
| `--cr-brand-violet` | `#ff453a` | ⚠️ DEPRECATED — 已从 globals.css 移除 |
| `--cr-brand-violet-hover` | `#ff6b61` | ⚠️ DEPRECATED — 已从 globals.css 移除 |
| `--cr-brand-amber` | `#ffb020` | ⚠️ DEPRECATED — 已从 globals.css 移除 |

### 9.3 z-index 比例（dark / light 同值）

| Token | 值 | 消费方 |
|-------|-----|--------|
| `--z-bg` | 0 | `DynamicBackground` |
| `--z-content` | 10 | 主内容区 |
| `--z-overlay` | 50 | 遮罩层 |
| `--z-dock` | 90 | `InjectDock` |
| `--z-toast` | 100 | `ToastStack` |
| `--z-install` | 110 | `InstallWizard` |
| `--z-studio-stage` | 1 | Studio 舞台 |
| `--z-studio-toolbar` | 50 | Studio 浮动工具栏 |
| `--z-studio-dock` | 100 | Studio 底部 Dock |
| `--z-studio-topbar` | 110 | Studio 顶栏 |
| `--z-studio-status` | 120 | Studio 状态栏 |
| `--z-studio-dialog` | 200 | Studio 对话框 |

> ✅ v2.3 已在 `src/ui/styles/workspace.css` 补 Studio 作用域 `:root` 令牌块：`--z-topbar` / `--z-status` / `--z-toolbar` 现分别 alias 到 `--z-studio-topbar` / `--z-studio-status` / `--z-studio-toolbar`，`dock.css` 的 `.ws-dock` 也已改用 `--z-studio-dock`。

---

## 10. Design Language 系统（v2.6+）

> 来源：`scripts/design-language.mjs`（注册表 + CSS 生成）
> 注入层：L0（`tokenBlock()` 之后、Aurora Glass 签名之前）
> 设计原则：主题可声明 `designLanguageConfig` 内联配置间距/圆角/阴影/动画形态，无需引用外部 designLanguage id。

### 10.1 变量清单

| 变量 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `--agentskin-space-1` | length | 4px | 4px 网格 × density |
| `--agentskin-space-2` | length | 8px | 8px 网格 × density |
| `--agentskin-space-3` | length | 16px | 16px 网格 × density |
| `--agentskin-space-4` | length | 24px | 24px 网格 × density |
| `--agentskin-space-5` | length | 32px | 32px 网格 × density |
| `--agentskin-space-6` | length | 48px | 48px 网格 × density |
| `--agentskin-radius-sm` | length | 1px | max(0, scale-1) |
| `--agentskin-radius-md` | length | 2px | 等于 scale |
| `--agentskin-radius-lg` | length | 6px | min(8, scale+4) |
| `--agentskin-shadow-float` | shadow | `0 4px 16px rgba(0,0,0,0.12)` | 阴影档位 |
| `--agentskin-duration-fast` | duration | 100ms | 动画节奏 |
| `--agentskin-duration-normal` | duration | 200ms | fast × 2（最小 50ms） |

### 10.2 密度倍率

| density | 倍率 | 用途 |
|---------|------|------|
| compact | 0.75x | 数据密集型界面 |
| comfortable | 1x | 默认 |
| cozy | 1.25x | 宽松阅读型界面 |

### 10.3 圆角档位

| scale | radius-sm | radius-md | radius-lg |
|-------|-----------|-----------|-----------|
| 0 | 0px | 0px | 4px |
| 2 | 1px | 2px | 6px |
| 4 | 3px | 4px | 8px |
| 8 | 7px | 8px | 8px |

### 10.4 阴影档位

| elevation | 值 |
|-----------|-----|
| flat | none |
| subtle | 0 1px 3px rgba(0,0,0,0.08) |
| float | 0 4px 16px rgba(0,0,0,0.12) |

### 10.5 动画节奏

| speed | duration-fast | duration-normal |
|-------|---------------|-----------------|
| instant | 0ms | 50ms |
| fast | 100ms | 200ms |
| smooth | 200ms | 400ms |

### 10.6 预设注册表

| id | 名称 | spacing | radius | shadow | motion |
|----|------|---------|--------|--------|--------|
| default | Default | comfortable | 2 | float | fast |
| soft-rounded | Soft Rounded | cozy | 8 | subtle | smooth |
| compact-flat | Compact Flat | compact | 0 | flat | instant |

### 10.7 默认值优化

当主题的 `designLanguageConfig` 解析结果等于默认值时，`designLanguageBlock()` 返回空字符串，不生成任何 CSS 变量。这确保存量主题的 CSS 输出 byte-identical。

---

## 11. Extended Colors 语义色（v2.6+）

> 来源：`scripts/extended-colors.mjs`（语义色块 + WCAG/APCA 引擎）
> 注入层：L0（Design Language 块之前）
> 设计原则：主题可声明 `colors.extended` 自由语义色 key，引擎自动生成 `--agentskin-ext-*` + `--agentskin-ext-on-*` 变量。

### 11.1 变量命名

对于 `extended` 中的每个 `{ name: hex }` 键值对：
- `--agentskin-ext-<name>` → 存储 hex 值
- `--agentskin-ext-on-<name>` → 自动选择黑色或白色文字（luminance > 0.45 → #000000，否则 #ffffff）

### 11.2 示例

manifest.json 声明：
```json
{
  "colors": {
    "extended": {
      "error": "#ef4444",
      "success": "#22c55e",
      "warning": "#f59e0b",
      "info": "#3b82f6"
    }
  }
}
```

生成 CSS：
```css
:root {
  --agentskin-ext-error: #ef4444;
  --agentskin-ext-on-error: #ffffff;
  --agentskin-ext-success: #22c55e;
  --agentskin-ext-on-success: #ffffff;
  --agentskin-ext-warning: #f59e0b;
  --agentskin-ext-on-warning: #000000;
  --agentskin-ext-info: #3b82f6;
  --agentskin-ext-on-info: #ffffff;
}
```

### 11.3 格式校验

- 仅接受 6 位 hex（`#rrggbb`），3 位 hex 和 8 位 hex（含 alpha）被静默跳过
- 保留 key：`on`、`ext`、`raw`、`wcag` 不可作为扩展色 key（CI 阻塞级校验）

---

## 12. WCAG/APCA 对比度引擎（v2.6+）

> 来源：`scripts/extended-colors.mjs`（对比度计算）+ `scripts/wcag-apca-check.mjs`（校验）
> 校验层：`check-themes.mjs`（warn-only，不阻塞 CI）

### 12.1 WCAG 2.1 对比度

- 公式：(L1 + 0.05) / (L2 + 0.05)，其中 L 为相对亮度
- AA 阈值：≥ 4.5:1（普通文本）
- AAA 阈值：≥ 7.0:1（普通文本）

### 12.2 APCA 对比度（WCAG 3 草案）

- 简化公式：Lc = |Ys^0.56 - Yt^0.57| × 1.25 × 100
- Lc ≥ 60：普通文本可读
- Lc ≥ 90：高置信度可读
- APCA 在暗色模式下的对比度预测比 WCAG 2.x 更准确

### 12.3 校验策略

| 校验项 | 级别 | 行为 |
|--------|------|------|
| foreground/background | warn-only | 不满足 AA 时输出警告 |
| extended colors | warn-only | 不满足 AA 时输出警告 |
| `_wcag.level` | 配置 | AA / AAA / none |

### 12.4 向后兼容

- 不填写 `designLanguageConfig` 和 `extended` 的主题，CSS 输出与改动前 byte-identical
- 所有新字段均为可选

---

## 13. 已知问题与建议

### 13.1 已解决问题

| # | 原问题 | 状态 |
|---|--------|------|
| 1 | `--cr-brand-violet` 命名与值不符 | ✅ 已标记 DEPRECATED（§9.2） |
| 2 | ~~`--brand-red` 只在 dark 定义~~ | ⚠️ v2.3 更正：`--brand-red` 从未在 `globals.css` 定义，已从 §2.1 移除该虚构条目 |
| 3 | `--shadow-xs` 在 light 未定义 | ✅ 已补全（与 `--shadow-sm` 同为 `var(--shadow-elev1)`） |
| 4 | `--cr-brand-amber` 命名问题 | ✅ 已标记 DEPRECATED（§9.2） |
| 5 | `--radius` 文档值 `2px` 与代码 `6px` 不符 | ✅ 已更新文档为 `6px` |
| 6 | `--shadow` 文档值与代码 `var()` 引用不符 | ✅ 已更新文档使用 `var(--shadow-elev1)` |
| 7 | Duration 阶梯 150/200/300/500ms 与代码 100/150/200/280ms 不符 | ✅ 已更新文档 |
| 8 | `.g12` gap 14px 与代码 16px 不符 | ✅ 已更新文档 |
| 9 | `--font-ui` 缺少 Inter 字体 | ✅ 已补充 |
| 10 | 色系文档值（HSL）与代码 hex 不符 | ✅ 已全面更新为 hex |
| 11 | `--font-mono` 含 `Microsoft YaHei UI` | ✅ 已修正为 `"JetBrains Mono", "IBM Plex Mono", ...` |

### 13.2 v2.3 新发现的待处理项

| # | 问题 | 位置 | 状态 |
|---|------|------|------|
| 1 | §2–§9 数值与代码不符（品牌色 `#dc2626` vs 实际 `#e11d48`、字阶、圆角根、框架高度、阴影值） | 本文档 | ✅ v2.3 已按 `globals.css` 全量对齐 |
| 2 | 虚构 token 条目：`--gray-100..900`、`--brand-red`、`--radius-base`、`--animate-card-enter` / `--animate-shadow-float`、`--dim/--red/--grn/…` | 本文档 §2.1/§2.2/§4.1/§6.2/§8.2 | ✅ v2.3 已移除并就地标注更正原因（注：`--animate-page-enter` 不属虚构之列——v2.3 已将其真实补入 `@theme inline`，见 §6.2） |
| 3 | Studio 布局 token 断链：`--h-topbar` `--h-status` `--w-drawer` `--w-drawer-collapsed` `--w-inspector-collapsed` `--z-topbar` `--z-status` `--z-toolbar` `--dur-fast` `--dur-mid` `--space-4` `--ws-shadow-float` 全仓库无定义 | `src/ui/styles/workspace.css` | ✅ v2.3 已补 `:root` 令牌块（12 枚，尺寸与 `types/workspace.ts` 默认值对齐）；Studio 窗口的 52/200/240/24 节奏与收起态自此真正生效。注：Inspector 宽度**刻意不设 CSS 令牌**——唯一 owner 是 workspaceStore（`INSPECTOR_WIDTH_DEFAULT` 240，clamp 4–400，经内联 `width` 应用，第三列用 `auto` 跟随该内联值） |
| 4 | `.page-enter` 与 `.as-card-hover` 各定义两次且值冲突 | `globals.css` | ✅ v2.3 已去重。**但去重过程中一度引入回归**：层叠是**逐声明（per-declaration）**裁决，未分层的 `.as-card-hover:hover` 只声明 `transform`，因此只赢下 `transform`；分层副本里无人竞争的 `border-color: var(--border-strong)` 与 `box-shadow: var(--shadow-elev2)` 其实一直生效，删掉即丢失。已把这两条补回未分层规则，产物核实为 `.as-card-hover:hover{border-color:var(--border-strong);box-shadow:var(--shadow-elev2);transform:translateY(-1px)}`，计算样式与去重前一致。`.page-enter` 同理：`will-change` 仅存在于被删副本，已一并迁移。**补充更正（经子代理复核）**：`.as-card-hover` 与 `.as-pressable` 在 `src/`、`engines/`、`themes/` 中**零消费者**，故该"回归"从未对用户可见——层叠推理成立，但影响面为死代码，见 #14 |
| 5 | `src/ui/colors.ts` 与 `src/ui/design/colors.ts` 内容重复 | 两处 | ✅ v2.3 已删除 `design/colors.ts`，保留 `colors.ts` 为唯一契约文件 |
| 6 | `StatusBar.tsx` 未被任何入口挂载 | `src/ui/components/StatusBar.tsx` | ✅ v2.3 已删除（职能由 `sidebar/RunningAgentList` + Settings 版本号承担） |
| 7 | `.setp` / `.set-rail` 无 CSS 定义 | `src/ui/pages/SettingsPage.tsx` | ✅ v2.3 已移除死类名（布局由同行 Tailwind 类承担，无变化） |
| 8 | 原以 `text-[13px]` 字面量用于 TitleBar 品牌与 Sidebar 导航标签等 | 14 个文件共 16 处（现已全部为 `text-ui`） | ✅ v2.3 已解决：新增 `--font-size-ui: 13px` 并经 `--text-ui: var(--font-size-ui)` 接入 Tailwind 的 `--text-*` 命名空间，16 处 `text-[13px]` 全部迁移为 `text-ui`（产物核实 `.text-ui{font-size:var(--font-size-ui)}`；`src/` 下 `text-[13px]` 现为 0 处——产物中仍残留一枚 `.text-\[13px\]{font-size:13px}` 规则，系 Tailwind 扫描到 `scripts/check-design-tokens.mjs:694`（`PROJECT_FONT_TW_MAP` 映射表，`:688-704` 整表另贡献十余枚幻影类）里的字符串字面量所致，非 UI 引用），计算值仍 13px，零视觉变化。（注：修复过程中产物曾残留一枚 `.text-\[13px\]{font-size:13px}`，系 Tailwind 扫到 `scripts/check-design-tokens.mjs:697` 的 `13: 'text-[13px]'` 字面量所致；该残留已由 #20 的 `@source not "../../scripts"` 一并清除，当前产物 0 命中。） |
| 9 | `animate-page-enter` 类被 3 个组件使用，但当时 `@theme` 无 `--animate-page-enter` → 该类不生成任何 CSS | `InstallProgress.tsx`、`RenameDialog.tsx`、`ImageCropDialog.tsx` | ✅ v2.3 已解决（补令牌方案，见 §6.3） |
| 10 | `dock.css` 的 `.ws-dock` 曾引用主窗口的 `--z-dock`(90) | `src/ui/styles/workspace/dock.css` | ✅ v2.3 已改用 `--z-studio-dock`(100)，Studio 内部相对层序不变 |
| 11 | Tailwind v4 的 `text-*` 工具类读取 `--text-*` 命名空间而非 `--font-size-*`，故 `--font-size-micro` 等键不生成 `text-micro`；而 `text-micro` 在 `src/ui` 下有 **57 处引用（14 个文件）**，一直是死类名——这些元素实际继承父级字号而非 10px（产物核实：`.text-micro{` 0 命中） | `src/ui/globals.css` `@theme inline` + 14 个消费文件（13 个 `components/studio/*` + `components/apps/AppDetailsDrawer.tsx`） | ✅ v2.5 已接线：`@theme inline` 补 `--text-micro: var(--font-size-micro)`，产物核实 `.text-micro{font-size:var(--font-size-micro)}` 生成。视觉影响：57 处标签从继承字号（多为 12/13px，两处裸 `<button>` 为 UA 16px）落到**设计意图的 10px**；`text-label/caption/body/body-lg/title/display` 全仓 0 引用故仍不接线。经用户批准（"继续推进"） |
| 12 | **同类命名空间陷阱（影响面最大）**：`--duration-*` 键不生成 `duration-*` 工具类，产物中**没有** `.duration-base` / `.duration-fast` / `.duration-slow` / `.duration-slower`（0 命中）。严格类名口径下这四个类在 `src/ui/**/*.tsx` 共被使用 **86 次**（62 / 12 / 7 / 5，已排除 `--agentskin-duration-base` 模板串与注释行），分布在 **46 个文件**（`duration-base` 单独占 36 个）。实际后果分两种：同行有 `transition-*` 工具类时回落到 Tailwind `--default-transition-duration` = 150ms（`duration-base` 巧合正确，`fast`/`slow`/`slower` 共 **24 处时长偏离意图**）；同行**没有** `transition-*` 时该元素根本没有过渡（反例 `dropdown-menu.tsx:43`）。两种情况下 86 处**一律不受 Settings 运动倍率 `--duration-multiplier` 控制** | `src/ui/globals.css` `@theme inline` + 46 个消费文件 | ✅ v2.5 已接线：`globals.css` 新增四条 `@utility duration-base/fast/slow/slower { --tw-duration: var(--duration-*); transition-duration: var(--duration-*); }`（`duration-instant` 全仓 0 引用，不映射）。关键在 `--tw-duration`：Tailwind 的 `transition-*` 工具类经 `var(--tw-duration, default)` 解析时长，仅设 `transition-duration` 会被同行 `transition-*` 覆盖。产物核实四条规则生成。视觉影响：86 处首次生效设计时长（24 处 150ms→100/200/280ms）并首次受 `--duration-multiplier` 与 `prefers-reduced-motion` 控制。经用户批准（"继续推进"） |
| 13 | `animate-indeterminate` 被使用但 `@theme` 无对应 `--animate-indeterminate`，产物 0 命中 → 进度条不确定态从不动画 | `src/ui/components/ui/progress.tsx:49` | ✅ v2.5 已接线：`@theme inline` 补 `--animate-indeterminate: agentskin-indeterminate 1.6s ease-in-out infinite` + 同名 keyframes（translateX(-100%→300%)，`w-1/3` 条在 overflow-hidden 轨道内恰为一个完整扫掠）。**刻意固定时长**：marquee 属环境反馈非过渡，不随 `--duration-multiplier` 缩放。reduced-motion 需定向规则而非依赖全局兜底——全局覆盖会把动画冻结在 100% 末帧（translateX(300%)，条完全滑出轨道 = 空轨道），故补 `@media (prefers-reduced-motion: reduce) { .animate-indeterminate { animation: none } }` 回到改动前的静止三分布条。产物核实两条规则均生成。经用户批准（"继续推进"） |
| 14 | `.as-card-hover` 与 `.as-pressable` 两条工具类**全仓零消费者**（`src/`、`engines/`、`themes/` 均无），但注释曾声称"用于交互卡片 / 按钮" | `globals.css` `.as-card-hover` / `.as-pressable:active` | ✅ v2.7 已删除：取证 `themes/` 与 `engines/` 对两个类名 0 引用（对外契约不存在），连同 `prefers-reduced-motion` 覆盖块中的选择器一并移除，产物核实 0 命中。零视觉变化 |
| 15 | `--dl-radius: 6px` 同值双写：`:root`（L39）与 light 块（L167）各一份 | `src/ui/globals.css` | ✅ v2.6 已合并：删除 light 块副本，`:root` 为唯一 owner。取证：全仓仅 App.tsx `setProperty('--dl-radius', …)` 一处运行时覆写（内联样式不论特异性均胜出）；静态回退场景 light 经层叠落回 `:root` 同值。产物核实 `--dl-radius:6px` 声明 2→1，零视觉变化 |
| 16 | `@theme inline` 中 `--font-mono: var(--font-mono)`（L285）自引用，向 theme 层输出一条循环声明，仅因未分层 `:root`（块 L37、声明 L45）逐声明获胜才无害 | `src/ui/globals.css:285` | ✅ v2.6 已改名：源令牌 `:root --font-mono` → `--font-stack-mono`（改名前取证 `--font-stack` 前缀全仓零消费），`@theme inline` 改为 `--font-mono: var(--font-stack-mono)`，循环声明消除。消费者核验：`var(--font-mono)`（`.as-mono`）与 `font-mono` 工具类产物均完好。零视觉变化 |
| 17 | **重复选择器普查（更正 v2.3 早先"仅 2 处"的结论——该结论受扫描正则限制，只匹配了 `.`/`#` 开头的选择器，漏掉元素与通配选择器）**：`:root`(L37 vs L52)、`*`(L398/L407/L552/L1255)、`html`(L404/L421/L1174)、`body`(L436/L1175)、`*::before`+`*::after`(L408-409 vs L1256-1257)、`.as-particle`(L1130/L1147) 共 6 组语义重复。其中 `*` L552 的 `scrollbar-width`/`scrollbar-color`、`html` L421 的字体渲染族、`.as-particle` L1130 的 `will-change`、`.page-enter` L1213 的 `will-change` 均为**单副本独占**——任何"顺手合并重复"都会静默丢属性 | `src/ui/globals.css` | ⬜ 未处理（高危重构区，动前必读本行）。另 `*` L407-411 与 `*::before/::after` L408-409 被 L1255-1257 逐属性全赢，属**可安全删除的死副本** |
| 18 | `shadow-elev2` 被当 Tailwind 类名使用，但 `--shadow-elev*` 声明在 `:root` 而非 `@theme` → 不生成（产物 `.shadow-elev2{` 0 命中） | 类名口径 **5 处**：`SidebarTooltip.tsx:37`（裸）、`CommunityThemeCard.tsx:88`、`ThemeCard.tsx:49`、`WallpaperCard.tsx:149`、`EnvironmentCard.tsx:125`（后四处为 `hover:shadow-elev2`）。第 6 处 `SidebarTooltip.tsx:11` 是注释，不计 | ✅ v2.7 已接线：`globals.css` Custom Utilities 区块补 `@utility shadow-elev1/2/3` 三条（照 `shadow-float` 既有模式，未用的 elev1/elev3 因 @utility 按需生成而不进产物），产物核实 `.shadow-elev2{box-shadow:var(--shadow-elev2)}` 与 `hover:` 变体均生成，C13 基线修剪 `shadow-elev2` / `hover:shadow-elev2` 两条。视觉影响：5 处卡片 hover / Tooltip 阴影首次生效（light 模式收益最大——light 下卡片层级全靠阴影区分）。经用户批准（P0–P3 全做） |
| 19 | `bg-cr-primary` 引用了一个**从未定义**的颜色令牌（`--color-cr-primary` 全仓 0 定义）→ 保存按钮 modified 态无底色（白字浮在透明底上） | `src/ui/components/settings/MarkdownStyleSettings.tsx:304` | ✅ v2.3 已修复：改为 `bg-primary text-white hover:bg-primary/90`。产物核实 `hover:bg-primary/90` 命中 2 次（改前该类为 0 规则），`bg-cr-primary` 在 `src/` 下已 0 引用 |
| 20 | `globals.css` 原 L6-8 注释声称 `@source` 已把 Tailwind 扫描「限制在源码树」，但 `@source` 是**加法**指令，且 `@source "!../../node_modules"` 的 bang 前缀根本不是 v4 排除语法 → 自动检测仍扫 `docs/` 与 `scripts/`，把文档代码块与脚本映射表里的字符串当类名编进产物 | `src/ui/globals.css` L6-20（修复后为说明注释 + 6 条 `@source not`）；来源：`scripts/check-design-tokens.mjs:697`（`13: 'text-[13px]'`）与 `PROJECT_FONT_TW_MAP`（`:692-707`）、`docs/reports/design-overhaul-quiet-workbench-v2/v3.md`、6 个 `docs/apps/*/architecture.md` | ✅ v2.3 已解决：改用 `@source not` 真排除语法（实测 Tailwind 4.3.3 支持，构建通过）。**同口径比对**（朴素提取器，改前快照 vs 改后产物）：类名 **1536 → 1319，removed 217 / added 0**；守卫算法口径下当前产物 globals-only 1287、含 studio 并集 1335。⚠️ 跨算法比对无效——朴素提取器抓不到 `*:data-[…]`、`[&>svg]:…` 这类含 `*`/`[`/`'` 的选择器却会过捕小数（`15s`、`013`），混用会凭空造出"24 个新增类"的假象。被删类数按提取器口径为 **203–217**。 |
| 21 | `overscroll-behavior-contain` **不是 Tailwind 类名**（正确名是 `overscroll-contain`）→ 5 个文件的滚动链隔离从未生效，滚到边界会穿透父级 | `App.tsx:275`、`components/DetailPanel.tsx:325`、`components/themes/VirtualThemeGrid.tsx:118`、`components/wallpaper/InjectResultsPanel.tsx:128`、`pages/WallpaperEnginePage.tsx:205`（5 处 / 5 文件） | ✅ v2.3 已修复：5 处全部改为 `overscroll-contain`。产物核实新增 `.overscroll-contain{overscroll-behavior:contain}`（改前 0 条 overscroll 规则）。合法性取证：`tailwindcss@4.3.3/dist/lib.mjs` 注册为 `` t(`overscroll-${o}`,[["overscroll-behavior",o]]) ``，o ∈ auto/contain/none，**不存在** `overscroll-behavior-*`。逐点风险评估：`App.tsx:275` 是顶层唯一 scroller（父级 overflow-hidden，无链可穿）→ 实质 no-op；`DetailPanel`/`InjectResultsPanel` 为真实行为修复（滚到底不再带动背后页面）；`VirtualThemeGrid` 只管边界传播，不影响 wheel/onScroll 与虚拟化逻辑。全仓无任何容器"靠穿透滚动手感才对" |
| 22 | `bg-surfaceElevated` 引用了**不存在的令牌**（真实键为 `--color-surface-raised`，camelCase 写法永不匹配）→ 该模板卡片无背景色 | `src/ui/components/studio/TemplatePicker.tsx:221` | ✅ v2.3 已修复：改为 `bg-surface-raised`。产物核实新增 `.bg-surface-raised{background-color:var(--surface-raised)}`。令牌取证：`globals.css:308` 在 `@theme inline` 中定义 `--color-surface-raised: var(--surface-raised)`（暗 `#1a1a21` / 亮 `#ffffff`）；**不存在** `--color-surface-elevated`——`surfaceElevated` 只是主题数据层 TS 字段名，camelCase 永不匹配颜色命名空间。视觉影响：该模板卡片由「透明底透出对话框 `bg-surface`」变为「卡片浮起」，属**已批准的视觉修复** |
| 23 | `origin-top-center` 在 Tailwind 4.3.3 下不生成规则（同一条字符串里的 `h-[var(--radix-navigation-menu-viewport-height)]` 已生成，证明该文件确被扫描，非漏扫）。合法性取证：`origin` 工具类 `staticValues` 实测仅 9 个（center/top/top-right/right/bottom-right/bottom/bottom-left/left/top-left），**无 top-center**——shadcn 模板历史笔误，v3/v4 均无效 | `src/ui/components/ui/navigation-menu.tsx:111` | ✅ v2.3 已修复：改为 `origin-top`（CSS `transform-origin: top` ≡ `50% 0`，正是作者想要的"上中"），产物核实新增 `.origin-top{transform-origin:top}`。**实际视觉影响为零**，两层原因：(a) 该元素动画只有 `fade-in-0`/`fade-out-0`（纯 opacity，无 zoom/scale），transform-origin 本就是空设置；(b) 全 `src/` **无任何文件 import 此组件**（grep `NavigationMenu` 仅命中定义文件本身），是未使用的 shadcn 遗留件 |
| 24 | **BEM 钩子只被使用、从无定义**，共 3 族 9 个类名（C13 守卫把 cva 多行体纳入扫描后**新浮出的**，此前人工与旧扫描都未发现）。经三条独立只读调查逐个判定，全部排除「历史遗留」——`git log --all -S <name> -- '*.css'` 对 9 个类名**全部 0 命中**，是生来的空头钩子，无原文可找回 | `components/studio/PreviewWindow.tsx:180,210`、`pages/WallpaperEnginePage.tsx:150,205`、`components/wallpaper/RenderSettingsPanel.tsx:56,65,88,102,124,164`、`components/studio/StudioInspector.tsx:103,113,125` | ✅ **6 个判 (A) 死类名，已删除（零视觉变化）**：`we-app`/`we-grid`/`we-prow`×5/`we-range`（每个元素同行都带完整 Tailwind 类，如 `we-range` 的滑块样式全由 `h-[4px] appearance-none [&::-webkit-slider-thumb]:…` 提供）、`pw__iframe`（尺寸由后代选择器 `layout.css:363` `.pw__body iframe` 完全覆盖）、`ws-inspector__resolution`（同行 `flex items-center gap-1 border-b border-border p-1` 五类全部已编译）。⚠️ 删除 `ws-inspector__resolution` 有**测试连带**：`__tests__/StudioInspector.test.tsx:136` 曾断言该类名，已同步改为断言真实分辨率数字 `1920`（更有意义的行为检查）。✅ **3 个判 (B) 真缺样式，已按 §13.4 补齐 CSS**（`layout.css` 无条件渲染；产物核实三钩子规则全部生成；C13 基线已修剪对应 3 条）——详见 §13.4 |
| 25 | 上述 #11–#24 这类「命名空间错配 → 类名编译为空」的问题，人眼与 C6 都发现不了 | 新增 **C13 守卫** `scripts/check-css-classes.mjs` + 基线 `scripts/css-classes.baseline.json` | ✅ v2.3 已落地：以构建产物为真相源反查死类名 + 普查重复选择器（正则覆盖 `:root`/`*`/元素选择器，修正了早先只匹配 `.`/`#` 的盲区）；已接线 `check-suite.mjs` 与 `npm run check:css-classes`；**已用合成死类做正反向测试**（能开火 exit=1、还原后转绿）；基线只可缩减——**棘轮比较的是「引用文件数」**，故同一死类被**新文件**引用会立刻失败（实测 `duration-base` 第 30 个文件即报错），但在既有文件内追加第 N 处引用不会开火，这是有意的口径选择。**v2.3 另修掉一个自身缺陷**：开发期间出现过「`npm run build` 失败但守卫拿上一次产物报绿」，故新增 `--require-artifact` 与**产物陈旧检测**（比对 `src/**` 最新 mtime 与产物最旧 mtime）——陈旧时普通模式打 ⚠ 仍给结果、`--require-artifact` 退出 1、`--update` **拒绝写基线**（防止用旧产物污染基线），四种行为均已实测。`npm run check:css-classes` 已改为 build 后带 `--require-artifact`，是 CI 应调用的入口。**v2.6 补丁（提取器 off-by-one）**：`namesInSelector` 的游标 `i = j` 会停在 NAME_END 字符之后，对复合选择器（`.status-dot.good`）意味着跳过了第二段的起始 `.`，**第二段类名永远提取不到**——真实使用 `status-dot good` / `status-dot brand` 时即误报死类；修正为 `i = j - 1`（停在 NAME_END 上，由外层 `i += 1` 推进），产物类名计数 1354→1360，基线自动修剪 `idle` 过期条目 |

> ✅ 已排除的假阳性：`icon-sm` 在产物中 0 命中，但它是 `ui/button.tsx:36` / `input-group.tsx:94` 里 cva 的 **variant 键名**（`'icon-sm': 'size-7 rounded-md …'`），不是 CSS 类，工作正常，勿再当死类上报。同理 `default` / `sm` / `md` / `xs` / `lg` 等。
> 🔎 本节 #11–#13 的判定方法可复现：以构建产物 `out/renderer/assets/globals-*.css` 为真相源，对每个 tsx 中出现的类名做「产物里是否存在该 `.类名{` 规则」的反查；只有「源码用了 + 产物没有」才算死类，再排除 cva variant 键。切勿凭 Tailwind 文档或源码字符串计数推断命名空间（实测 `--ease-` 在 dist 里 0 命中却确实生成 `.ease-spring`）。

> 🛡️ **#20 的独立安全复核（不共用 C13 的第二条管线）**：203 个被删类**全部可溯源到 `docs/`、`scripts/`、`tests/`、`agent-rules/`**——文档占位符（`p-[Npx]`、`text-[9px~11px]`）、脚本 console 标签（`[regen:dry]`、`[build-palette:verify]`）、`PROJECT_FONT_TW_MAP` 建议表、以及 `scripts/anchors/index.mjs:135` 里 zcode **目标应用**的 DOM 探针；`src/`、`engines/`、`themes/`、根 `index.html`/`studio.html` **零真实消费者**，无样式丢失。把排除 `themes/`、`engines/` 从"看起来合理"升级为**已取证**的关键事实：`themes/**/*.css` 共 9376 个类 token 中 **Tailwind 形态 0 个**，`engines/**/*.mjs` 中 `class=` **0 次**（DOM 类操作仅 `classList.add(HOST_CLASS)` 命名空间常量），两目录 `@apply`/`@extend` 均为 0——主题包与适配器完全走自有 CSS 变量体系，不依赖本包工具类。附带发现：`globals.css:38` 注释描述的 `rounded-[var(--dl-radius,2px)]` 全仓无人以类名使用（注释陈旧，非样式丢失；`--dl-radius` 本身经 `@theme` 驱动派生档位，产物 35 处健在）。

### 13.3 建议

1. **文档订阅**：`globals.css` 头部已声明本文档由其派生；建议再加一条 CI 校验，比对本文档表格中的 hex 与 `globals.css` 实际值，防止再次漂移。
2. **字号下限**：维持「CRITICAL 数据 ≥10px」规范（当前最小 token 为 `--font-size-micro` 10px）。
3. **消费 componentVariations 字段**：v2.5 schema 已定义组件形态变体注册表，建议后续与 `designLanguageConfig` 对齐。
4. **Studio UI 可视化面板**：为 `designLanguageConfig` 提供图形化调节。
5. **收敛重复事实源**：✅ v2.3 已完成——删除 `design/colors.ts` 与孤儿 `StatusBar.tsx`，移除 `.setp` / `.set-rail` 死类名。
6. **Studio 收起态选择器**：`layout.css` 现同时匹配 `.ws-root[data-*-collapsed]` 与 `:has(> .ws-*(data-collapsed))` 两种宿主；若后续把状态属性统一上移到 `.ws-root`，可删掉 `:has()` 分支。
7. **令牌命名空间统一**：✅ v2.5 已执行——`--text-micro`（#11）与 duration 侧四条 `@utility`（#12）全部接线，工具类与令牌同源；`--text-label/caption/body/body-lg/title/display` 因全仓 0 引用继续不接线（待有真实用法时按同模式补）。

### 13.4 三处 (B) 真缺样式 — ✅ v2.4 已补齐

§13.2 #24 判定 9 个空头 BEM 钩子中 6 个为死类名（已删，零变化），以下 **3 个是真缺样式**，已按本节预备的方案在 `src/ui/styles/workspace/layout.css` 落地。三者缺陷的共同根因是两条已被取证的事实：

1. **Tailwind v4 preflight 不再给 `button` 设 `cursor: pointer`**（v3 有；实测 `node_modules/tailwindcss/preflight.css` 已无此规则）→ 裸 `<button>` 手型缺失。
2. **`text-micro` 是惰性类**（#11：`--text-micro` 从未进 `@theme`），且全 bundle 无任何 base `font-size` → 按钮经 preflight `font:inherit` 落到 **UA 16px**，而同面板所有兄弟都是 10px。

三者都在 `src/ui/styles/workspace/layout.css` 补规则，且**无条件渲染**（`studio.tsx → StudioApp.tsx:106 → StudioPage.tsx:66-75`，无 feature flag），用户每次打开 Studio 都看得到。

| 钩子 | 当前缺陷 | 建议规则（参照同族成员） |
|---|---|---|
| `pw__title-btn`<br>`PreviewWindow.tsx:180` | 标题栏选择按钮：无手型、无 hover；button 为 inline-block → `.pw__app-mark` 的 14×14 与 `.pw__title` 的 ellipsis **双双失效**；无 `min-width:0` → 长标题把全屏/关闭按钮挤出 header | 参照 `.pw__icon-btn`（`layout.css:337`）：`display:flex; align-items:center; gap:4px; min-width:0; max-width:100%; padding:0 4px; border:none; border-radius:var(--radius-sm); background:transparent; color:var(--foreground); cursor:pointer` + `:hover{background:var(--card2)}`，插在 `.pw__spacer`(:335) 之后 |
| `ws-inspector__res-btn`<br>`StudioInspector.tsx:113` | 分段按钮组：JSX 写了 `data-active={resolution===key?'true':undefined}` 但**全仓无任何对应规则** → 选中的 1920 与未选中的 1280/1440/2560 **视觉完全相同**；字号 16px；无手型 | 参照 `.ws-inspector__tab`（`layout.css:458`）：`height:18px; border:none; background:transparent; font-family:var(--font-ui); font-size:10px; font-weight:500; line-height:1; color:var(--muted-foreground); cursor:pointer; transition:background/color var(--dur-fast)` + `:hover{background:var(--card2);color:var(--foreground)}` + `[data-active="true"]{background:var(--primary);color:var(--primary-foreground)}` |
| `ws-inspector__frame-toggle`<br>`StudioInspector.tsx:125` | 设备框开关：`data-active` 同样无规则 → **开/关状态完全不可见**（唯一反馈是 title 提示）；🖥 字形以 16px 渲染，比同族兄弟大 60%；无手型无 hover | 参照 `.pw__icon-btn`：`width:18px;height:18px;display:flex;align-items:center;justify-content:center;border:none;border-radius:var(--radius-sm);background:transparent;font-size:10px;line-height:1;color:var(--muted-foreground);cursor:pointer;transition:…` + `:hover{…}` + `[data-active="true"]{color:var(--primary)}` |

**刻意不写的属性**（避免与已编译的 Tailwind 打架；家族内 `__tabs` 与 Tailwind 并存时也是这么让位的）：`padding`、`border-radius`、`margin`（`__res-btn` 已有 `rounded-md px-1 py-0`、`__frame-toggle` 已有 `ml-auto`）；`flex-shrink`（已定义的兄弟 `__tabs`/`__win-bar` 同样没写，保持一致）。

**状态语义的两种既有惯例**：分段控件用**底色** `--primary` 强调当前项（对齐 `.ws-inspector__tab`），图标开关用**着色** `--primary` 点亮（对齐 `.pw[data-active]`）。

**落地后需同步（✅ v2.4 已完成）**：已跑 `node scripts/check-css-classes.mjs --update`（基线修剪 `pw__title-btn` / `ws-inspector__res-btn` / `ws-inspector__frame-toggle` 3 条，产物核实三钩子规则全部生成：`pw__title-btn` 2 处、`ws-inspector__res-btn` 3 处、`ws-inspector__frame-toggle` 3 处命中），§13.2 #24 的 ⬜ 已改为 ✅。`StudioInspector.test.tsx` 的两条断言只检查类名存在，不受补 CSS 影响，实测通过。

---

*本文档数值以 `src/ui/globals.css` 为准：v2.2（2026-08-23）全面同步为 hex；v2.3 调整 §1 措辞并按代码实际值对齐 §2–§9，同时移除从未存在的虚构 token 条目。*

*v2.3 的改动清单：① 新增 `--font-size-ui` / `--text-ui` / `--animate-page-enter` 三枚令牌（前两者零视觉，第三者使三处浮层恢复入场动效）；② `@source` 改用真排除语法，产物裁掉 203–217 条从未被引用的幻影规则（零视觉，已经两条独立管线交叉验证无真实消费者）；③ 修复 `bg-cr-primary` → `bg-primary`（保存按钮 modified 态首次出现底色）；④ 新增 C13 守卫 `scripts/check-css-classes.mjs` + 基线，接线 `npm run check`（现 19 项）与 `npm run check:css-classes`，并加固 `--require-artifact` + 产物陈旧检测；⑤ §5 补「别名对工具类无效」警告、§13.2 扩至 25 项、新增 §13.4；⑥ **修复三个「写错名字即完全失效」的类名**：`overscroll-behavior-contain`→`overscroll-contain`（5 文件）、`bg-surfaceElevated`→`bg-surface-raised`、`origin-top-center`→`origin-top`，产物已核实三条规则首次生成；⑦ 删除 6 个空头 BEM 钩子（`we-app`/`we-grid`/`we-prow`/`we-range`/`pw__iframe`/`ws-inspector__resolution`，零视觉变化，含一处测试断言同步改为行为断言）。*

*v2.4 的改动清单：**落地 §13.4**——`layout.css` 新增 `pw__title-btn`（+hover）、`ws-inspector__res-btn`（+hover+`[data-active]` 主色底）、`ws-inspector__frame-toggle`（+hover+`[data-active]` 主色着字）三组规则，补齐标题按钮手型/ellipsis/防挤出、分辨率分段选中态、设备框开关可见性；C13 基线修剪 3 条死类条目并复跑全绿；§13.2 #24 的 (B) 部分转 ✅。这是 v2.4 全部的视觉变化，均在 Studio 窗口内。*

*v2.5 的改动清单：**命名空间收敛（§13.3 #7）**——① `@theme inline` 补 `--text-micro: var(--font-size-micro)`，57 处死类转活（视觉：标签落到设计意图的 10px，两处裸 `<button>` 从 UA 16px 收到 10px）；② 新增 `@utility duration-fast/base/slow/slower` 四条（`--tw-duration` + `transition-duration` 双写，86 处死类转活，24 处时长从 150ms 默认值纠正为设计值并首次受 `--duration-multiplier` 控制）；③ 新增 `--animate-indeterminate` 令牌 + `agentskin-indeterminate` keyframes，进度条不确定态首次有 marquee 动画（固定 1.6s，刻意不随运动倍率缩放；reduced-motion 定向 `animation: none` 回到静止条，避免全局兜底冻结在末帧导致空轨道）；④ C13 基线同步修剪转活条目并复跑全绿。*

*v2.6 的改动清单：**卫生清理（零视觉）**——① `--dl-radius` 同值双写合并（#15）：light 块副本删除，`:root` 唯一 owner，产物核实声明 2→1；② mono 栈源令牌改名 `--font-stack-mono`（#16）：`@theme inline` 的 `--font-mono: var(--font-mono)` 自引用循环消除，`.as-mono` 与 `font-mono` 工具类产物核验完好；③ `:root` 注释同步（radius 单 owner 说明 + mono 消费约定：走 `var(--font-mono)` / `font-mono`，勿直接用 `var(--font-stack-mono)`）。*

*v2.7 的改动清单：**UI 视觉升级（用户批准 P0–P3 全档）**——① `@utility shadow-elev1/2/3` 三条接线（#18 转活，照 `shadow-float` 模式）：5 处卡片 hover / SidebarTooltip 阴影首次渲染，C13 基线修剪 2 条；② `@theme inline` 补 `--text-caption` / `--text-title` / `--text-display` 三键（text-display 当前 0 消费者、按需生成）：PageHeader h1 由脱阶梯的 `text-base`（16px）上到 `text-title`（17px），描述由散值 `text-[12px]` 转 `text-caption`，四个页面（Themes/Wallpaper/Settings/Community）经 PageHeader 一处生效；③ `.as-glow` 重写并激活（此前零消费者）：消费 `--glow-*` token 族，`0 0 0 2px rgba(var(--brand-rgb),0.3)`（等值替换旧 `ring-2 ring-primary/30`）+ `20px→28px` hover 加深光晕，消费点 ThemeCard / CommunityThemeCard / WallpaperCard 选中态、EnvironmentCard 激活态、InjectDock 活动态；④ `.page-enter` 补 `animation-fill-mode: backwards`：支撑 VirtualThemeGrid 行级（前 4 行 × 60ms）与 WallpaperGrid 卡级（前 9 张 × 50ms）入场 stagger——虚拟化滚动挂载的行/卡 0 延迟淡入不迟滞；⑤ InjectDock 底部胶囊改 `as-glass` 毛玻璃常驻（替代实色 `bg-popover`，浮层惯例 + 呼应产品自身注入能力；TitleBar 已有 `hasWallpaper` 条件 as-glass，本轮不动）；⑥ 删除 `.as-card-hover` / `.as-pressable`（#14，零视觉）。除 PageHeader 字号 16→17px 外未改动任何 token 数值。*

*已获批准的视觉变化累计：v2.3 的入场动效、保存按钮底色、模板卡片底色与滚动链隔离；v2.4 的三处 BEM 钩子补样式；v2.5 的 #11/#12/#13 命名空间接线；v2.7 的 #18 阴影转活、PageHeader 字阶上移、as-glow 光晕、入场 stagger 与 InjectDock 毛玻璃（批准方式：用户在 AskUserQuestion 中选择"P0–P3 全部"）。除此之外未改动任何 token 数值。§13.2 共 25 项，24 项 ✅ 已解决、余下 ⬜ 仅 #17 重复选择器（高危重构区，动前必读该行"单副本独占"清单；v2.3 曾在"安全去重"上引入回归，需独立一轮）。*
