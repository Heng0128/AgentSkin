# AgentSkin 设计系统 Token 文档

> 版本：v2.2
> 日期：2026-08-23
> 来源：`src/ui/globals.css`（唯一事实源，以 hex 值为唯一色彩格式）、`scripts/design-language.mjs`、`scripts/extended-colors.mjs`
> 说明：本文件完整记录 AgentSkin 的 Quiet Workbench 设计系统 token。所有色彩值均从 globals.css 提取（以 hex/rgba 为唯一色彩格式），dark 与 light 主题差异已标注。本文档同时记录主题层 Design Language 变量和 Extended Colors 系统。
> 变更：v2.2 以 `globals.css` 实际 hex 值为准，将全部 HSL 值替换为 hex/rgba 值，消除文档与代码之间的格式不一致。
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

AgentSkin 采用 **Quiet Workbench** 设计语言（Calm · Simple · Restrained · Clear）：

- **柔和几何**：6px 基础圆角，仅品牌/App icon 用更大圆角
- **克制用色**：中性灰阶主导，品牌红仅用于强调
- **字体层级**：Inter（UI 全文）· JetBrains Mono（标签/数据）· 系统字体（CJK）
- **网格对齐**：12 列布局网格，数据密集区用紧凑 mono
- **极简阴影**：工具用 `shadow-elev1/2/3` 极简 box-shadow 表达层级（无模糊扩散）

---

## 2. 色彩系统

### 2.1 品牌色（Brand）

| Token | Dark | Light | 用途 |
|-------|------|-------|------|
| `--brand-red` | `#ef4444` | `#dc2626` | 品牌主红 |
| `--brand-red-hover` | — | — | ⚠️ 仅文档记录，未在 globals.css 中使用 |
| `--primary` | `#dc2626` | `#dc2626` | 主强调色（按钮/激活/进度） |
| `--primary-foreground` | `#ffffff` | `#ffffff` | 主色上的前景 |
| `--ring` | `rgba(220, 38, 38, 0.4)` | `rgba(220, 38, 38, 0.35)` | 焦点环 |
| `--accent` | `rgba(220, 38, 38, 0.08)` | `rgba(220, 38, 38, 0.1)` | 强调底色（激活态背景） |
| `--accent-foreground` | `#b91c1c` | `#dc2626` | 强调前景 |

> ✅ `--brand-red` 在 dark 和 light 下均有定义，值分别为 `#ef4444` 和 `#dc2626`。

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
| `--background` | `#0f0f10` | 页面背景 |
| `--foreground` | `#fafafa` | 前景文字 |
| `--card` | `#1e1e22` | 卡片 |
| `--card-foreground` | `#fafafa` | 卡片文字 |
| `--card2` | `#1e1e22` | 卡片次级/背景块 |
| `--popover` | `#1e1e22` | 浮层 |
| `--secondary` | `#161618` | 次级表面 |
| `--muted` | `rgba(255, 255, 255, 0.04)` | 弱化表面 |
| `--muted-foreground` | `#a1a1aa` | 弱化文字 |
| `--surface` | `#161618` | 框架表面（Sidebar/TitleBar/StatusBar） |
| `--border` | `rgba(255, 255, 255, 0.1)` | 边框 |
| `--border-strong` | `rgba(255, 255, 255, 0.16)` | 强边框 |
| `--input` | `rgba(255, 255, 255, 0.1)` | 输入框边框 |
| `--destructive` | `#b91c1c` | 危险/删除 |

### 2.4 语义表面色（Light）

| Token | Light 值 |
|-------|---------|
| `--background` | `#ffffff` |
| `--foreground` | `#1a1a1a` |
| `--card` | `#ffffff` |
| `--card2` | `#ffffff` |
| `--popover` | `#ffffff` |
| `--secondary` | `#f6f6f7` |
| `--muted` | `rgba(0, 0, 0, 0.04)` |
| `--muted-foreground` | `#6b7280` |
| `--surface` | `#f6f6f7` |
| `--border` | `rgba(0, 0, 0, 0.1)` |
| `--border-strong` | `rgba(0, 0, 0, 0.16)` |
| `--destructive` | `#b91c1c` |

### 2.5 内置色引用

依赖 Radix Colors 调色板文件（`@radix-ui/colors/slate.css` 等），但当前 `:root` 与 `.light` 下的语义色均使用 hex/rgba 直接值。Radix 调色板作为基础色板导入，主题层未直接暴露 `--green-11` 等 Radix 变量至组件。`--cr-success` / `--cr-warning` / `--cr-info` 的实际值已硬编码为 hex。

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
| `--font-size-display` | 20px | `@theme inline` |
| `--font-size-title` | 16px | `@theme inline` |
| `--font-size-body-lg` | 13px | `@theme inline` |
| `--font-size-body` | 11px | `@theme inline` |
| `--font-size-caption` | 11px | `@theme inline` |
| `--font-size-label` | 10px | `@theme inline` |
| `--font-size-micro` | 9px | `@theme inline` |
| `.as-label` | 10px | utilities（`var(--font-size-label)`） |
| `.as-micro` | 9px | utilities（`var(--font-size-micro)`） |
| `.as-mono` | 10px | utilities（`var(--font-size-label)`） |
| `.as-kv` | 11px | utilities（`var(--font-size-body)`） |
| `.as-kv-key` | 10px | utilities（`var(--font-size-label)`） |

> 行高：`--leading-title: 1.25` / `--leading-body: 1.5`
> 字距：`--tracking-tight: -0.02em`
> CRITICAL 数据正文不应低于 10px。

---

## 4. 圆角系统

### 4.1 基础

| Token | 值 |
|-------|-----|
| `--radius-base` | `6px` | AgentSkin 6px 基准 |

### 4.2 衍生（`@theme inline`，基于 `--radius-base` 缩放）

| Token | 计算 | 值 |
|-------|------|-----|
| `--radius-sm` | `var(--radius-base)` | `6px` |
| `--radius-md` | `var(--radius-base)` | `6px` |
| `--radius-lg` | `calc(var(--radius-base) * 1.25)` | `7.5px` |
| `--radius-xl` | `calc(var(--radius-base) * 1.75)` | `10.5px` |
| `--radius-2xl` | `calc(var(--radius-base) * 2.5)` | `15px` |
| `--radius-pill` | `9999px` | `9999px` |

> 全局 6px 基础圆角，仅品牌/App icon 用更大圆角（如 Logo `rx=11.5`、AppMark `rounded-[22%]`）。

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
- `--shadow-elev1`: `0 0 0 1px rgba(255, 255, 255, 0.06)`
- `--shadow-elev2`: `0 0 0 1px rgba(255, 255, 255, 0.1), 0 4px 16px rgba(0, 0, 0, 0.3)`
- `--shadow-elev3`: `0 0 0 1px rgba(255, 255, 255, 0.1), 0 8px 32px rgba(0, 0, 0, 0.4)`
- `--shadow-float`: `0 0 0 1px rgba(255, 255, 255, 0.1), 0 16px 48px rgba(0, 0, 0, 0.5)`

### 5.2 Light 阴影

| Token | 别名 | Light 实际值 |
|-------|------|-------------|
| `--shadow-xs` | `var(--shadow-elev1)` | `0 0 0 1px rgba(0, 0, 0, 0.06)` |
| `--shadow-sm` | `var(--shadow-elev1)` | `0 0 0 1px rgba(0, 0, 0, 0.06)` |
| `--shadow-md` | `var(--shadow-elev2)` | `0 0 0 1px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.06)` |
| `--shadow-lg` | `var(--shadow-elev3)` | `0 0 0 1px rgba(0, 0, 0, 0.1), 0 8px 24px rgba(0, 0, 0, 0.08)` |
| `--shadow-xl` | `var(--shadow-float)` | `0 0 0 1px rgba(0, 0, 0, 0.1), 0 16px 48px rgba(0, 0, 0, 0.1)` |

> ✅ light 的 `--shadow-xs` 已单独定义（与 `--shadow-sm` 同为 `var(--shadow-elev1)`）。

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

### 6.2 动画（`@theme`）

| Token | 定义 | 用途 |
|-------|------|------|
| `--animate-page-enter` | `agentskin-page-enter 280ms cubic-bezier(.16,1,.3,1)` | 页面进入 |
| `--animate-card-enter` | `agentskin-card-enter 260ms cubic-bezier(.16,1,.3,1) both` | 卡片进入 |
| `--animate-shadow-float` | `shadow-float 4s ease-in-out infinite` | 浮动 |

### 6.3 Keyframes 清单

`agentskin-page-enter` / `agentskin-card-enter` / `shadow-float`

> 其他 keyframes（`agentskin-breathe` / `agentskin-shimmer` 等）由 `tw-animate-css` 导入提供，非 `globals.css` 本地定义。

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

- **12 列网格**：`.g12` → `display:grid; grid-template-columns:repeat(12,1fr); gap:16px`
- **页面容器**：`max-w-[1240px]`，`px-[30px] py-[22px]`
- **框架高度**：TitleBar 38px · 内容区 1fr · StatusBar 28px（`grid-rows-[38px_minmax(0,1fr)_28px]`）

### 7.2 常见间距值（代码中实际使用）

| 值 | Tailwind | 用途 |
|----|----------|------|
| 16px | `gap-4` | 网格间距（`.g12`） |
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
| `--cr-success` / `--success` | `#22c55e` | `#16a34a` | 成功/运行 |
| `--cr-warning` / `--warning` | `#eab308` | `#ca8a04` | 警告/待机 |
| `--cr-info` / `--info` | `#3b82f6` | `#2563eb` | 信息 |
| `--destructive` | `#b91c1c` | `#b91c1c` | 危险/删除 |

### 8.2 品牌简写（状态组件用）

| Token | Dark | Light |
|-------|------|-------|
| `--dim` | `#a1a1aa` | `#6b7280` |
| `--red` | `#ef4444` | `#dc2626` |
| `--red2` | `#dc2626` | `#b91c1c` |
| `--redbg` | `rgba(239, 68, 68, 0.12)` | `rgba(220, 38, 38, 0.08)` |
| `--grn` | `#22c55e` | `#16a34a` |
| `--amb` | `#eab308` | `#ca8a04` |
| `--blu` | `#3b82f6` | `#2563eb` |
| `--bg2` | `#161618` | `#f6f6f7` |
| `--border2` | `rgba(255, 255, 255, 0.2)` | `rgba(0, 0, 0, 0.2)` |
| `--card2` | `#1e1e22` | `#ffffff` |

### 8.3 图表色（`--chart-1..5`）

| Token | Dark | Light |
|-------|------|-------|
| `--chart-1` | `#dc2626` | `#dc2626` |
| `--chart-2` | `#22c55e` | `#16a34a` |
| `--chart-3` | `#eab308` | `#ca8a04` |
| `--chart-4` | `#3b82f6` | `#2563eb` |
| `--chart-5` | `#a855f7` | `#9333ea` |

---

## 9. 组件级 token

### 9.1 Sidebar

| Token | Dark | Light |
|-------|------|-------|
| `--sidebar` | `#161618` | `#f6f6f7` |
| `--sidebar-foreground` | `#fafafa` | `#1a1a1a` |
| `--sidebar-primary` | `#dc2626` | `#dc2626` |
| `--sidebar-primary-foreground` | `#ffffff` | `#ffffff` |
| `--sidebar-accent` | `rgba(220, 38, 38, 0.08)` | `rgba(220, 38, 38, 0.1)` |
| `--sidebar-accent-foreground` | `#b91c1c` | `#dc2626` |
| `--sidebar-border` | `rgba(255, 255, 255, 0.1)` | `rgba(0, 0, 0, 0.1)` |
| `--sidebar-ring` | `rgba(220, 38, 38, 0.4)` | `rgba(220, 38, 38, 0.35)` |

### 9.2 品牌变体（`--cr-brand-*`）— ⚠️ DEPRECATED

> 以下 token 已在当前 `globals.css` 中移除，标记为废弃。如需品牌色请使用 `--brand-red` / `--primary`。

| Token | 原值 | 状态 |
|-------|------|------|
| `--cr-brand-violet` | `#ff453a` | ⚠️ DEPRECATED — 已从 globals.css 移除 |
| `--cr-brand-violet-hover` | `#ff6b61` | ⚠️ DEPRECATED — 已从 globals.css 移除 |
| `--cr-brand-amber` | `#ffb020` | ⚠️ DEPRECATED — 已从 globals.css 移除 |

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
| 2 | `--brand-red` 只在 dark 定义 | ✅ 已补全 light 值 `#dc2626` |
| 3 | `--shadow-xs` 在 light 未定义 | ✅ 已补全（与 `--shadow-sm` 同为 `var(--shadow-elev1)`） |
| 4 | `--cr-brand-amber` 命名问题 | ✅ 已标记 DEPRECATED（§9.2） |
| 5 | `--radius` 文档值 `2px` 与代码 `6px` 不符 | ✅ 已更新文档为 `6px` |
| 6 | `--shadow` 文档值与代码 `var()` 引用不符 | ✅ 已更新文档使用 `var(--shadow-elev1)` |
| 7 | Duration 阶梯 150/200/300/500ms 与代码 100/150/200/280ms 不符 | ✅ 已更新文档 |
| 8 | `.g12` gap 14px 与代码 16px 不符 | ✅ 已更新文档 |
| 9 | `--font-ui` 缺少 Inter 字体 | ✅ 已补充 |
| 10 | 色系文档值（HSL）与代码 hex 不符 | ✅ 已全面更新为 hex |
| 11 | `--font-mono` 含 `Microsoft YaHei UI` | ✅ 已修正为 `"JetBrains Mono", "IBM Plex Mono", ...` |

### 13.2 建议

1. **颜色 token 分立**：✅ 已解决。品牌红在 dark/light 已显式分立（`#ef4444` / `#dc2626`），所有语义色均提供双主题值。
2. **间距 token 化**：✅ 已解决（v2.6 Design Language 系统）。当前间距已通过 `--agentskin-space-1..6` token化，支持密度倍率缩放。
3. **命名纠正**：`--cr-brand-violet` / `--cr-brand-amber` ✅ 已标记 DEPRECATED（§9.2），不再使用。
4. **shadow-xs 补全**：✅ 已解决。light 下 `--shadow-xs` 已定义为 `var(--shadow-elev1)`。
5. **文档订阅**：此文档应随 globals.css 变更同步更新，建议在 globals.css 头部加注释链接本文档。
6. **字号下限**：明确「CRITICAL 数据 ≥10px」的规范（当前 mono 标签最小 10px），避免新组件误用。
7. **消费 componentVariations 字段**：v2.5 schema 已定义组件形态变体注册表，建议后续与 designLanguageConfig 对齐。
8. **Studio UI 可视化面板**：为 designLanguageConfig 提供图形化调节。

---

*本文档基于 `src/ui/globals.css` 当前内容生成，日期 2026-08-23（v2.2 全面同步为 hex 值）。*
