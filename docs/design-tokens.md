# AgentSkin 设计系统 Token 文档

> 版本：v1.0
> 日期：2026-08-10
> 来源：`src/ui/globals.css`（唯一事实源）
> 说明：本文件完整记录 AgentSkin 的 Swiss / International Typographic Style 设计 token。所有值均从 globals.css 提取，dark 与 light 主题差异已标注。

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
10. [已知问题与建议](#10-已知问题与建议)

---

## 1. 设计原则

AgentSkin 采用 **Swiss / International Typographic Style（瑞士国际主义平面设计）**：

- **锐利几何**：2px 直角为主，无过度圆角
- **克制用色**：中性灰阶主导，品牌红仅用于强调
- **字体层级**：Space Grotesk（品牌/展示）· IBM Plex Mono（标签/数据）· 系统字体（正文/CJK）
- **网格对齐**：12 列布局网格，数据密集区用紧凑 mono
- **硬阴影**：工具用 `shadow-lg/xl` 硬阴影表达层级

---

## 2. 色彩系统

### 2.1 品牌色（Brand）

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--brand-red` | `#ff453a` | — | 品牌主红 |
| `--brand-red-hover` | `#ff6b61` | — | 主红 hover |
| `--primary` | `#ff453a` | `#e30613` | 主强调色（按钮/激活/进度） |
| `--primary-foreground` | `#ffffff` | `#ffffff` | 主色上的前景 |
| `--ring` | `#ff453a` | `#e30613` | 焦点环 |
| `--accent` | `rgba(255,69,58,.13)` | `rgba(227,6,19,.08)` | 强调底色（激活态背景） |
| `--accent-foreground` | `#ff453a` | — | 强调前景 |

> ⚠️ **注意**：`--brand-red` 只在 `:root`（dark 语境）定义，未在 light 下覆盖。light 的实际主色是 `#e30613`。这是文档发现的第一个不一致点（见 §10）。

### 2.2 中性灰阶（Gray scale，定义于 `:root`）

| Token | 值 | 语义 |
|-------|-----|------|
| `--gray-100` | `#f5f5f7` | 最浅 |
| `--gray-200` | `#e8e8ea` | 浅 |
| `--gray-300` | `#d1d1d5` | 中浅 |
| `--gray-400` | `#9ba0a8` | 中 |
| `--gray-500` | `#6e737b` | 中深 |
| `--gray-600` | `#4a4e56` | 深 |
| `--gray-700` | `#2c2f36` | 更深 |
| `--gray-800` | `#1b1b20` | 深黑 |
| `--gray-900` | `#0a0a0c` | 最黑 |

### 2.3 语义表面色（Dark 默认）

| Token | Dark 值 | 语义 |
|-------|---------|------|
| `--background` | `var(--slate-1)` ≈ `#0a0a0c` | 页面背景 |
| `--foreground` | `var(--slate-12)` ≈ `#f5f5f7` | 前景文字 |
| `--card` | `var(--slate-2)` ≈ `#141418` | 卡片 |
| `--card-foreground` | `var(--slate-12)` | 卡片文字 |
| `--card2` | `var(--slate-3)` ≈ `#1b1b20` | 卡片次级/背景块 |
| `--popover` | `var(--slate-2)` ≈ `#1b1b21` | 浮层 |
| `--secondary` | `var(--slate-3)` ≈ `#101014` | 次级表面 |
| `--muted` | `var(--slate-1)` ≈ `#0e0e11` | 弱化表面 |
| `--muted-foreground` | `var(--slate-11)` ≈ `#9ba0a8` | 弱化文字 |
| `--surface` | `var(--slate-1)` ≈ `#0e0e11` | 框架表面（Sidebar/TitleBar/StatusBar） |
| `--border` | `var(--slate-a4)` ≈ `rgba(255,255,255,.09)` | 边框 |
| `--border-strong` | `var(--slate-a5)` ≈ `rgba(255,255,255,.17)` | 强边框 |
| `--input` | `var(--slate-a5)` ≈ `rgba(255,255,255,.1)` | 输入框边框 |
| `--destructive` | `#ff453a` | 危险/删除 |

### 2.4 语义表面色（Light）

| Token | Light 值 |
|-------|---------|
| `--background` | `var(--slate-1)` ≈ `#f2f2f0` |
| `--foreground` | `var(--slate-12)` ≈ `#141416` |
| `--card` | `#ffffff` |
| `--card2` | `var(--slate-2)` ≈ `#f7f7f5` |
| `--popover` | `#ffffff` |
| `--secondary` | `var(--slate-3)` ≈ `#eaeae8` |
| `--muted` | `var(--slate-1)` ≈ `#fafaf8` |
| `--muted-foreground` | `var(--slate-11)` ≈ `#62666d` |
| `--surface` | `var(--slate-1)` ≈ `#fafaf8` |
| `--border` | `var(--slate-a4)` ≈ `rgba(10,10,12,.1)` |
| `--border-strong` | `var(--slate-a5)` ≈ `rgba(10,10,12,.22)` |
| `--destructive` | `#e30613` |

### 2.5 内置色引用

依赖 Radix Colors 调色板：slate / green / blue / amber，各有 `-dark` 与 `-alpha` 变体。通过 `--green-11`、`--amber-11`、`--blue-11` 等引用。

---

## 3. 字体系统

### 3.1 字体栈（定义于 `:root`）

| Token | 字体栈 | 用途 |
|-------|--------|------|
| `--font-display` | `"Space Grotesk Variable", "Space Grotesk", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif` | 品牌/展示/大数字 |
| `--font-ui` | `"Microsoft YaHei UI", "PingFang SC", -apple-system, "Segoe UI", system-ui, sans-serif` | 正文/界面 |
| `--font-mono` | `"IBM Plex Mono", "SFMono-Regular", Consolas, "Microsoft YaHei UI", monospace` | 标签/数据/代码 |

> CJK 用高质量系统字体（Windows YaHei / macOS PingFang），不加载 web 字体。

### 3.2 Tailwind 映射（`@theme inline`）

| 类名 | 映射 |
|------|------|
| `font-display` | `var(--font-display)` |
| `font-sans` / `font-heading` | `var(--font-ui)` |
| `font-mono` | `var(--font-mono)` |

### 3.3 字号规范（代码中使用的实际尺寸）

| 用途 | 字号 |
|------|------|
| Swiss 大数字（`.swiss-big-num` / `.bignum`） | 44px / 700 |
| 页面标题（Dashboard h1） | 22px bold |
| 卡片/区块标题 | 13px font-display bold |
| 正文（`text-sm`） | 12–12.5px |
| 次级正文（`text-xs`） | 11–11.5px |
| 数据/小标签（`text-[10px~10.5px]`） | 10–10.5px mono |
| Swiss 标签（`.swiss-label`） | 9.5px mono / 600 / 0.14em |
| Swiss 元标签（`text-[8.5px~9px]`） | 8.5–9px mono（分组标题/辅助） |

> ⚠️ 8.5–9px 用于辅助 mono 标签（侧边栏分组、卡片 meta），是刻意的 Swiss 紧凑风格，但 CRITICAL 数据正文不应低于 10px。

---

## 4. 圆角系统

### 4.1 基础

| Token | 值 |
|-------|-----|
| `--radius` | `2px` |

### 4.2 衍生（`@theme inline`，基于 `--radius` 缩放）

| Token | 计算 | 值 |
|-------|------|-----|
| `--radius-sm` | `calc(var(--radius) * .6)` | `1.2px` |
| `--radius-md` | `calc(var(--radius) * .8)` | `1.6px` |
| `--radius-lg` | `var(--radius)` | `2px` |
| `--radius-xl` | `calc(var(--radius) * 1.4)` | `2.8px` |
| `--radius-2xl` | `calc(var(--radius) * 1.8)` | `3.6px` |

> 全局 2px 直角，仅品牌/App icon 用更大圆角（如 Logo `rx=11.5`、AppMark `rounded-[22%]`）。

---

## 5. 阴影系统

### 5.1 Dark 阴影（默认）

| Token | 值 |
|-------|-----|
| `--shadow` | `0 1px 2px rgba(0,0,0,.4), 0 10px 28px rgba(0,0,0,.4)` |
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3)` |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,.4), 0 2px 8px rgba(0,0,0,.3)` |
| `--shadow-md` | `0 1px 2px rgba(0,0,0,.4), 0 10px 28px rgba(0,0,0,.4)` |
| `--shadow-lg` | `0 2px 4px rgba(0,0,0,.4), 0 20px 48px rgba(0,0,0,.5)` |
| `--shadow-xl` | `0 4px 8px rgba(0,0,0,.4), 0 30px 60px rgba(0,0,0,.6)` |

### 5.2 Light 阴影（`--shadow-sm/md/lg/xl` 单独定义）

| Token | Light 值 |
|-------|---------|
| `--shadow-sm` | `0 1px 2px rgba(15,15,18,.04), 0 2px 8px rgba(15,15,18,.08)` |
| `--shadow-md` | `0 1px 2px rgba(15,15,18,.04), 0 10px 28px rgba(15,15,18,.1)` |
| `--shadow-lg` | `0 2px 4px rgba(15,15,18,.04), 0 20px 48px rgba(15,15,18,.12)` |
| `--shadow-xl` | `0 4px 8px rgba(15,15,18,.04), 0 30px 60px rgba(15,15,18,.15)` |

> ⚠️ light 的 `--shadow-xs` 未单独定义（继承 dark 的 `--shadow-xs`）。这是潜在不一致（见 §10）。

---

## 6. 动效系统

### 6.1 时长（`@theme inline`）

| Token | 值 |
|-------|-----|
| `--duration-instant` | `0ms` |
| `--duration-fast` | `150ms` |
| `--duration-base` | `200ms` |
| `--duration-slow` | `300ms` |
| `--duration-slower` | `500ms` |

### 6.2 动画（`@theme`）

| Token | 定义 | 用途 |
|-------|------|------|
| `--animate-breathe` | `breathe 2s cubic-bezier(.4,0,.2,1) infinite` | 呼吸 |
| `--animate-page-enter` | `page-enter 300ms cubic-bezier(.16,1,.3,1)` | 页面进入 |
| `--animate-card-enter` | `card-enter 280ms cubic-bezier(.16,1,.3,1) both` | 卡片进入 |
| `--animate-float` | `float 3.2s ease-in-out infinite` | 浮动 |
| `--animate-blob` | `blob 20s ease-in-out infinite alternate` | 背景 blob |
| `--animate-tpflow` | `tpflow 1.4s ease-out` | 流动 |
| `--animate-tin` | `tin 280ms cubic-bezier(.16,1,.3,1)` | 滑入 |

### 6.3 Keyframes 清单

`agentskin-breathe` / `agentskin-page-enter` / `agentskin-shimmer` / `agentskin-float` / `agentskin-card-enter` / `agentskin-drift` / `agentskin-pan` / `agentskin-led-pulse` / `agentskin-blink` / `agentskin-pop` / `agentskin-shin` / `agentskin-feed-in` / `agentskin-blob` / `agentskin-tpflow` / `agentskin-tpb` / `agentskin-wadrift` / `agentskin-tin` / `agentskin-rotate`

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

### 7.1 布局网格

- **12 列网格**：`.g12` → `display:grid; grid-template-columns:repeat(12,1fr); gap:14px`
- **页面容器**：`max-w-[1240px]`，`px-[30px] py-[22px]`
- **框架高度**：TitleBar 38px · 内容区 1fr · StatusBar 28px（`grid-rows-[38px_minmax(0,1fr)_28px]`）

### 7.2 常见间距值（代码中实际使用）

| 值 | Tailwind | 用途 |
|----|----------|------|
| 14px | `gap-3.5` | 网格间距 |
| 8px | `p-2` | 紧凑内边距 |
| 12px | `p-3` | 卡片内边距 |
| 14px | `p-3.5` | 标准卡片 |
| 22px | `py-[22px]` | 页面顶部 |
| 30px | `px-[30px]` | 页面左右 |

> 间距未定义为独立 token，直接使用 Tailwind 数值。建议未来抽为 `--space-*` token（见 §10）。

---

## 8. 语义色与状态

### 8.1 语义色

| Token | Dark | Light | 语义 |
|-------|------|-------|------|
| `--cr-success` / `--success` | `var(--green-11)` ≈ `#2ed573` | `#149457` | 成功/运行 |
| `--cr-warning` / `--warning` | `var(--amber-11)` ≈ `#ffb020` | `#b26a00` | 警告/待机 |
| `--cr-info` / `--info` | `var(--blue-11)` ≈ `#4da3ff` | `#1d6fd6` | 信息 |
| `--destructive` | `#ff453a` | `#e30613` | 危险/删除 |

### 8.2 品牌简写（状态组件用）

| Token | Dark | Light |
|-------|------|-------|
| `--dim` | `#6e737b` | `#8a8f96` |
| `--red` / `--red2` / `--redbg` | `#ff453a` / `#ff6b61` / `rgba(255,69,58,.13)` | `#e30613` / `#b00510` / `rgba(227,6,19,.08)` |
| `--grn` / `--amb` / `--blu` | `#2ed573` / `#ffb020` / `#4da3ff` | `#149457` / `#b26a00` / `#1d6fd6` |
| `--bg2` | `#101014` | `#eaeae8` |
| `--border2` | `rgba(255,255,255,.17)` | `rgba(10,10,12,.22)` |
| `--card2` | `#1b1b20` | `#f7f7f5` |

### 8.3 图表色（`--chart-1..5`）

| Token | Dark | Light |
|-------|------|-------|
| `--chart-1` | `#ff453a` | `#e30613` |
| `--chart-2` | `#2ed573` | `#149457` |
| `--chart-3` | `#ffb020` | `#b26a00` |
| `--chart-4` | `#4da3ff` | `#1d6fd6` |
| `--chart-5` | `#ff6b61` | `#b00510` |

---

## 9. 组件级 token

### 9.1 Sidebar

| Token | Dark | Light |
|-------|------|-------|
| `--sidebar` | `#0e0e11` | `#fafaf8` |
| `--sidebar-foreground` | `#f5f5f7` | `#141416` |
| `--sidebar-primary` | `#ff453a` | `#e30613` |
| `--sidebar-primary-foreground` | `#ffffff` | `#ffffff` |
| `--sidebar-accent` | `rgba(255,69,58,.13)` | `rgba(227,6,19,.08)` |
| `--sidebar-accent-foreground` | `#ff6b61` | — |
| `--sidebar-border` | `rgba(255,255,255,.09)` | `rgba(10,10,12,.1)` |
| `--sidebar-ring` | `#ff453a` | `#e30613` |

### 9.2 品牌变体（`--cr-brand-*`）

| Token | 值 |
|-------|-----|
| `--cr-brand-violet` | `#ff453a` |
| `--cr-brand-violet-hover` | `#ff6b61` |
| `--cr-brand-amber` | `#ffb020` |

> ⚠️ 命名为「violet」但值是红色 `#ff453a`，命名与值不符（见 §10）。

---

## 10. 已知问题与建议

### 10.1 命名不一致

| # | 问题 | 位置 |
|---|------|------|
| 1 | `--cr-brand-violet` 命名为「violet（紫）」但值是红 `#ff453a` | `:root` |
| 2 | `--brand-red` 只在 dark 定义，light 未覆盖 | `:root` |
| 3 | `--shadow-xs` 在 light 未单独定义（继承 dark） | `.light` |
| 4 | `--cr-brand-amber` 命名为「amber」但值与 warning 相同 | `:root` |

### 10.2 建议

1. **颜色 token 分立**：品牌红在 dark/light 值不同（`#ff453a` vs `#e30613`），建议统一为「dark 用亮红、light 用深红」的显式两套 token，避免依赖巧合。
2. **间距 token 化**：当前间距直接用 Tailwind 数值，建议抽为 `--space-1/2/3/4` 等 token，便于统一调整。
3. **命名纠正**：`--cr-brand-violet` 应改名（值实为红），或该值改为真正的紫色。
4. **shadow-xs 补全**：light 下补 `--shadow-xs` 定义。
5. **文档订阅**：此文档应随 globals.css 变更同步更新，建议在 globals.css 头部加注释链接本文档。
6. **字号下限**：明确「CRITICAL 数据 ≥10px，辅助 mono 标签可 8.5–9px」的规范，避免新组件误用。

---

*本文档基于 `src/ui/globals.css` 当前内容生成，日期 2026-08-10。*