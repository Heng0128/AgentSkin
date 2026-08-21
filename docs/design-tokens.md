# AgentSkin 设计系统 Token 文档

> 版本：v2.0
> 日期：2026-08-21
> 来源：`src/ui/globals.css`（唯一事实源）、`scripts/design-language.mjs`、`scripts/extended-colors.mjs`
> 说明：本文件完整记录 AgentSkin 的 Swiss / International Typographic Style 设计 token。所有值均从 globals.css 提取，dark 与 light 主题差异已标注。本文档同时记录主题层 Design Language 变量和 Extended Colors 系统。

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
| swiss-default | Swiss Default | comfortable | 2 | float | fast |
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

### 13.1 命名不一致

| # | 问题 | 位置 |
|---|------|------|
| 1 | `--cr-brand-violet` 命名为「violet（紫）」但值是红 `#ff453a` | `:root` |
| 2 | `--brand-red` 只在 dark 定义，light 未覆盖 | `:root` |
| 3 | `--shadow-xs` 在 light 未单独定义（继承 dark） | `.light` |
| 4 | `--cr-brand-amber` 命名为「amber」但值与 warning 相同 | `:root` |

### 13.2 建议

1. **颜色 token 分立**：品牌红在 dark/light 值不同（`#ff453a` vs `#e30613`），建议统一为「dark 用亮红、light 用深红」的显式两套 token，避免依赖巧合。
2. **间距 token 化**：✅ 已解决（v2.6 Design Language 系统）。当前间距已通过 `--agentskin-space-1..6` token化，支持密度倍率缩放。
3. **命名纠正**：`--cr-brand-violet` 应改名（值实为红），或该值改为真正的紫色。
4. **shadow-xs 补全**：light 下补 `--shadow-xs` 定义。
5. **文档订阅**：此文档应随 globals.css 变更同步更新，建议在 globals.css 头部加注释链接本文档。
6. **字号下限**：明确「CRITICAL 数据 ≥10px，辅助 mono 标签可 8.5–9px」的规范，避免新组件误用。
7. **消费 componentVariations 字段**：v2.5 schema 已定义组件形态变体注册表，建议后续与 designLanguageConfig 对齐。
8. **Studio UI 可视化面板**：为 designLanguageConfig 提供图形化调节。

---

*本文档基于 `src/ui/globals.css` 当前内容生成，日期 2026-08-21。*