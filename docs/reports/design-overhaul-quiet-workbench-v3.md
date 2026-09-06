# AgentSkin Design Overhaul — Quiet Workbench Theme v3

> **版本**: 3.0 (真正完整覆盖版)  
> **日期**: 2026-08-23  
> **状态**: 方案审定 — 待执行  
> **核心理念**: 安静的自信  
> **覆盖范围**: 6 主页面 + 所有子组件/预览/对话框/抽屉 + Studio 完整组件树 + 所有原子组件

---

## 0. 设计原则

### 0.1 核心关键词

- **静谧**: 低认知负荷，无视觉噪音，无过度装饰
- **简约**: 每个元素都有功能目的
- **克制**: 品牌色 <8% 面积
- **清晰**: 信息层级靠灰阶 + 字号建立

### 0.2 目标

我们要成为 2026 年主流工具 UI 设计的**定义者**，学习并融合 Linear (纯黑 + 灰阶 + Indigo)、Figma UI3 (隐身设计)、Arc (Clean and calm)、Cursor/Windsurf (暗底沉浸) 等工具的通用设计理念，打造 AgentSkin 自己的静谧简约风格。

---

## 1. Token 系统

### 1.1 Dark 主题

```css
:root[data-theme='dark'] {
  --bg-base: #0F0F10;
  --bg-surface: #161618;
  --bg-elevated: #1E1E22;
  --bg-input: #0A0A0B;
  --bg-hover: rgba(255,255,255,0.04);
  --bg-active: rgba(255,255,255,0.06);

  --text-primary: #FAFAFA;
  --text-secondary: #A1A1AA;
  --text-tertiary: #71717A;
  --text-disabled: #52525B;

  --border-subtle: rgba(255,255,255,0.06);
  --border-default: rgba(255,255,255,0.1);
  --border-strong: rgba(255,255,255,0.16);

  --brand: #6366F1;
  --brand-hover: #818CF8;
  --brand-active: #4F46E5;
  --brand-subtle: rgba(99,102,241,0.08);
  --brand-text: #A5B4FC;

  --success: #22C55E;
  --success-subtle: rgba(34,197,94,0.1);
  --warning: #EAB308;
  --warning-subtle: rgba(234,179,8,0.1);
  --danger: #EF4444;
  --danger-subtle: rgba(239,68,68,0.1);
  --info: #3B82F6;
  --info-subtle: rgba(59,130,246,0.1);

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --text-micro: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 15px;
  --text-xl: 18px;
  --text-2xl: 24px;

  --font-ui: "Inter Variable", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 200ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  --shadow-sm: 0 0 0 1px var(--border-subtle);
  --shadow-md: 0 0 0 1px var(--border-default), 0 4px 16px rgba(0,0,0,0.3);
}
```

### 1.2 Light 主题

```css
:root[data-theme='light'] {
  --bg-base: #FFFFFF;
  --bg-surface: #F6F6F7;
  --bg-elevated: #FFFFFF;
  --bg-input: #F3F3F4;
  --bg-hover: rgba(0,0,0,0.04);
  --bg-active: rgba(0,0,0,0.06);

  --text-primary: #1A1A1A;
  --text-secondary: #6B7280;
  --text-tertiary: #9CA3AF;
  --text-disabled: #D1D5DB;

  --border-subtle: rgba(0,0,0,0.06);
  --border-default: rgba(0,0,0,0.1);
  --border-strong: rgba(0,0,0,0.16);

  --brand: #6366F1;
  --brand-hover: #4F46E5;
  --brand-active: #4338CA;
  --brand-subtle: rgba(99,102,241,0.06);
  --brand-text: #4F46E5;

  --success: #16A34A;
  --success-subtle: rgba(22,163,74,0.08);
  --warning: #CA8A04;
  --warning-subtle: rgba(202,138,4,0.08);
  --danger: #DC2626;
  --danger-subtle: rgba(220,38,38,0.08);
  --info: #2563EB;
  --info-subtle: rgba(37,99,235,0.08);

  --radius-xs: 4px;
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 14px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;

  --text-micro: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 15px;
  --text-xl: 18px;
  --text-2xl: 24px;

  --font-ui: "Inter Variable", "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 200ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  --shadow-sm: 0 0 0 1px var(--border-subtle);
  --shadow-md: 0 0 0 1px var(--border-default), 0 2px 8px rgba(0,0,0,0.06);
}
```

---

## 2. Shell 布局

### 2.1 主应用结构

```
┌─ TopBar (32px) ──────────────────────────────────────────┐
│  ≡  AgentSkin | Workspace  Themes  Wallpaper  Settings ☾ │
├─ SideBar (52px) ─┬─ MainContent ─────────────────────────┤
│  🏠               │  Page content                        │
│  🎨               │  (no max-w constraint)                │
│  🖼               │                                      │
│  ⚙               │                                      │
│  ─ ─ ─ ─ ─ ─ ─  │                                      │
│  ● v1.0.0        │                                      │
└──────────────────┴───────────────────────────────────────┘
```

### 2.2 TitleBar 改造

| 当前 | 改造后 |
|------|--------|
| `h-[38px]` | `h-8` (32px) |
| `font-display text-[13px] font-bold` | `text-base font-medium` |
| SegmentedControl 3-mode 主题切换 | 图标按钮 ☀/☾ |
| `rounded-[var(--dl-radius,2px)]` iconBtn | `rounded-sm` |

### 2.3 Sidebar 改造

| 当前 | 改造后 |
|------|--------|
| 折叠/展开 (224px/62px) | 固定 52px |
| Brand + 分组 + 导航 | 仅图标 |
| `border-l-[3px]` 活跃 | `bg-brand-subtle` |
| Studio 按钮 | 移入 TopBar |

### 2.4 StatusBar 改造

独立 28px 条 → 融入 Sidebar 底部 (● + v1.0.0)

---

## 3. 逐页面详细改造

### 3.1 页面一: WorkspacePage (工作台)

**文件**: `src/ui/pages/WorkspacePage.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L186 | `font-display text-sm font-bold` | `text-base font-medium` |
| L187 | `as-micro` | `text-xs text-secondary` |
| L190-195 | `bg-card2` 刷新按钮 | ghost 按钮 |
| L204 | `text-[11px]` | `text-xs` |
| L215 | `text-red-500` | `text-danger` |
| L226 | `bg-green-500` | `bg-success` |
| L237 | `bg-green-500` | `bg-success` |
| L351 | `text-[12px]` | `text-xs` |
| L371 | `w-[200px]` AgentRail | `w-[180px]` |
| L384 | `border-l-[3px] border-primary` | `bg-brand-subtle` |
| L450-455 | `↶↷` Unicode | Lucide Undo2/Redo2 |

**子组件 AgentLivePreview** (`src/ui/components/workspace/AgentLivePreview.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L150 | `bg-card` | `bg-elevated` |
| L151 | `as-mono` | `text-xs text-secondary` |
| L160 | `bg-primary/30 animate-pulse` | `bg-brand/20` 无动画 |
| L165 | `bg-destructive` | `bg-danger` |
| L177,181,188 | `rounded-md` | `rounded-lg` |
| L182,189 | `text-[10px]` | `text-xs text-tertiary` |

**子组件 TweakPanel** (`src/ui/components/workspace/TweakPanel.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L259 | `h-8 w-32 text-[13px]` | `h-8 w-[140px] text-base` |
| L308 | `text-[11px] font-medium` | `text-xs font-medium` |
| L350 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L351 | `bg-[var(--accent-ghost)] ring-1 ring-[var(--accent)]` | `bg-brand-subtle ring-1 ring-brand` |
| L357 | `bg-[var(--accent)]` | `bg-brand` |
| L360 | `text-[11px]` | `text-xs` |
| L366 | `rounded-[var(--radius-sm)]` | `rounded-sm` |
| L406 | `h-7 ... text-[11px]` | `h-8 ... text-xs` |

---

### 3.2 页面二: AppsPage (应用)

**文件**: `src/ui/pages/AppsPage.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L165 | `max-w-[1240px] px-8 py-6` | `px-4 py-4` (去掉 max-w) |
| L165 | `paddingBottom: '320px'` 内联 | CSS 变量 `--drawer-height` |
| L169 | `font-display text-sm font-bold` | `text-base font-medium` |
| L172 | `as-micro` | `text-xs text-secondary` |
| L176 | Button `variant="outline"` | ghost 按钮 |
| L186 | `gap-2 border-b border-border pb-2` | `gap-1` |
| L193 | `rounded-[var(--dl-radius,2px)] px-3 py-1.5 text-[12px]` | `rounded-sm px-2.5 py-1 text-xs` |
| L195 | `bg-accent text-foreground` | `bg-brand-subtle text-brand-text` |
| L220 | `bg-cr-primary` | `bg-brand` |
| L230 | `bg-destructive/10` | `bg-danger-subtle` |
| L244 | `bg-cr-success` | `bg-success` |
| L248 | `bg-[var(--muted-foreground)] opacity-25` | `bg-tertiary` |
| L252 | `bg-cr-warning` | `bg-warning` |

**子组件 AppCard** (`src/ui/components/apps/AppCard.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L62-64 | `bg-cr-success` / `bg-cr-warning` / `bg-muted...` | `bg-success` / `bg-warning` / `bg-tertiary` |
| L100 | `duration-base` | `duration-fast` |
| L101 | `hover:bg-muted/40` | `hover:bg-hover` |
| L102 | `hover:bg-accent/50` | `hover:bg-brand-subtle` |
| L103 | `ring-2 ring-cr-success/50` | `ring-1 ring-success` |
| L118 | `font-display text-[22px] font-bold` | `text-xl font-medium text-tertiary` |
| L133 | `font-display text-[13px] font-bold` | `text-base font-medium` |
| L137 | `text-[10px]` | `text-xs text-tertiary` |

**子组件 AppDetailsDrawer** (`src/ui/components/apps/AppDetailsDrawer.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L57 | `h-[300px] shadow-float` | `h-[280px]` 无阴影 |
| L67 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L84 | `font-display text-[22px] font-bold` | `text-xl font-medium text-tertiary` |
| L88 | `font-display text-[12px] font-bold` | `text-sm font-medium` |
| L103,108 | `bg-cr-success` / `bg-[var(--muted-foreground)]` | `bg-success` / `bg-tertiary` |
| L169 | `text-[10px] uppercase tracking-wider` | `text-xs ... text-tertiary` |
| L173 | `text-[11px]` | `text-xs` |

---

### 3.3 页面三: ThemesPage (主题)

**文件**: `src/ui/pages/ThemesPage.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L97 | `text-xs` (=12px) | `text-sm` |
| L101 | `text-[10px]` | `text-xs` |
| L108 | `style={{ fontSize: '11px' }}` | `text-xs` |
| L142 | `text-[10px]` | `text-xs` |
| L165 | `gap-2` | `gap-1` |
| L175 | `w-[200px]` 搜索 | `w-[240px]` |
| L185 | Studio 按钮 `bg-primary` | `bg-brand` |
| L235-255 | SegmentedControl → Chip | Chip pill |
| L255 | `animate-ping` | 静态点 |
| L328 | `blur(20px) saturate(1.5)` | `bg-base/80` 无模糊 |
| L333 | `boxShadow` 内联 | 去掉 |

**子组件 ThemeCard** (`src/ui/components/themes/ThemeCard.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L34 | `rounded-md bg-card` | `rounded-lg bg-elevated` |
| L35-37 | `border-l-[3px] border-primary` | `ring-1 ring-brand` |
| L53 | `bg-card2` (未定义) | `bg-surface` |
| L66 | `bg-cr-success/90` | `bg-success` |
| L72 | `bg-popover/90` | `bg-elevated` |
| L83 | `bg-gray-900/80 text-gray-300` | `bg-surface text-secondary` |
| L84 | `bg-muted text-foreground` | `bg-surface text-primary` |
| L102 | `border-white/10 bg-background/70` | `border-subtle bg-surface` |
| L109-113 | `animate-ping` + `bg-white` | 静态 `bg-brand` 点 |
| L123 | `text-[13px] font-medium tracking-[-0.01em]` | `text-base` |
| L125 | `text-[10px] tabular-nums text-muted-foreground/50` | `text-xs text-tertiary font-mono` |
| L132 | `font-mono text-[10px]` | `font-mono text-xs text-tertiary` |
| L150 | `bg-cr-success/15` | `bg-success-subtle` |
| L151 | `ring-1 ring-border` | `ring-1 ring-border-subtle` |

**子组件 VirtualThemeGrid** (`src/ui/components/themes/VirtualThemeGrid.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L119 | `animate-page-enter` | 去掉 |
| L119 | `p-4` | `p-3` |
| L40 | `GAP = 10` | `GAP = 8` |

---

### 3.4 页面四: WallpaperEnginePage (壁纸)

**文件**: `src/ui/pages/WallpaperEnginePage.tsx`

| 当前 | 改造后 |
|------|--------|
| `gap-2` 工具栏 | `gap-1` |
| `h-7` 搜索/排序/类型 | `h-8` |
| SegmentedControl 类型 | Chip pill |
| Switch + 文字 | 仅 Switch + tooltip |

**子组件 WallpaperCard** (`src/ui/components/wallpaper/WallpaperCard.tsx`):

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L133-135 | `animate-card-enter` + `animationDelay` | 去掉 |
| L135 | `rounded-md bg-card` | `rounded-lg bg-elevated` |
| L136 | `hover:border-primary/40 hover:bg-card2` | `hover:border-default hover:bg-surface` |
| L137 | `border-primary/60` | `ring-1 ring-brand` |
| L171 | `bg-black/60` | `bg-black/40` |
| L186-193 | `bg-primary/85`, `bg-cr-info/85`, `bg-success/85`, `bg-cr-warning/85` | `bg-brand`, `bg-info`, `bg-success`, `bg-warning` |
| L211 | `bg-primary` | `bg-brand` |
| L217 | `bg-cr-warning` | `bg-warning` |
| L223 | `bg-muted` | `bg-surface` |
| L231 | `font-display text-[11px] font-bold` | `text-xs font-medium` |
| L251 | `text-destructive` | `text-danger` |

---

### 3.5 页面五: SettingsPage (设置)

**文件**: `src/ui/pages/SettingsPage.tsx`

| 当前 | 改造后 |
|------|--------|
| `w-[180px]` Rail | `w-[160px]` |
| 返回按钮 | 去掉 (用 TopBar 替代) |
| `border-l-[3px] border-primary` | `bg-brand-subtle text-brand-text` |
| SettingRow `color-mix` 背景 | `border-b border-subtle` 无背景 |
| `text-[10px]` / `text-[11px]` 散落 | 统一 `text-xs` |
| SegmentedControl | 统一为 h-7 |

---

### 3.6 页面六: StudioPage (工作室) — 独立窗口

**文件**: `src/ui/StudioApp.tsx` + `src/ui/pages/StudioPage.tsx` + `src/ui/components/studio/*.tsx`

> **关键差异**: Studio 使用独立的 CSS 系统 (`src/ui/styles/workspace/`)，有自己的 token 命名 (`--bg-0~4`, `--fg-0~3`, `--r-micro~xl`, `--accent`, `--accent-ghost`, `--cr-ok`, `--shadow-float`)。

#### 改造策略

有两种方案：

**方案 A (推荐)**: 将 Studio 的 workspace CSS 变量**映射**到新的全局 token，保留 Studio 的独立布局结构 (Drawer/Stage/Inspector/Dock)。

**方案 B**: 将 Studio 完全迁移到全局 token 系统。

推荐方案 A，因为：
- Studio 的布局结构复杂 (Dock 拖拽、Drawer 折叠、Inspector 收起)，重构风险高
- 映射方式改动最小，风险可控
- Studio 作为创作型 UI，可以保留一定的视觉差异性

#### Token 映射

| Studio Token (workspace/tokens.css) | 新全局 Token |
|-------------------------------------|-------------|
| `--bg-0` | `var(--bg-base)` |
| `--bg-1` | `var(--bg-input)` |
| `--bg-2` | `var(--bg-surface)` |
| `--bg-3` | `var(--bg-hover)` |
| `--bg-4` | `var(--bg-active)` |
| `--fg-0` | `var(--text-primary)` |
| `--fg-1` | `var(--text-secondary)` |
| `--fg-2` | `var(--text-tertiary)` |
| `--fg-3` | `var(--text-disabled)` |
| `--border-subtle` | `var(--border-subtle)` |
| `--accent` | `var(--brand)` |
| `--accent-ghost` | `var(--brand-subtle)` |
| `--cr-ok` | `var(--success)` |
| `--shadow-float` | `var(--shadow-md)` |
| `--r-micro` | `var(--radius-xs)` |
| `--r-xs` | `var(--radius-sm)` |
| `--r-md` | `var(--radius-md)` |
| `--r-lg` | `var(--radius-lg)` |
| `--r-xl` | `var(--radius-xl)` |
| `--space-1` | `var(--space-1)` |
| `--space-2` | `var(--space-2)` |
| `--space-3` | `var(--space-3)` |
| `--space-4` | `var(--space-4)` |

#### StudioTitleBar 改造 (`StudioTitleBar.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L51 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L58 | `h-8` | 保持 (已经是 32px) |
| L59 | `bg-[var(--surface)]` | `bg-surface` |
| L66 | `font-display text-sm font-bold` | `text-base` |
| L67 | `font-mono text-[11px]` | `font-mono text-xs` |
| L73 | `font-mono text-[10px]` | `font-mono text-xs text-tertiary` |
| L110 | `hover:bg-[var(--brand-red)]` | `hover:bg-danger` |

#### StudioTopBar 改造 (`StudioTopBar.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L60-65 | `badge-beta` + inline style | `bg-brand-subtle text-brand-text` |
| L86,111,130 | `background: var(--bg-3)` | `bg-hover` |

#### StudioDrawer 改造 (`StudioDrawer.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L144,186 | `bg-[var(--bg-1)]`, `border-[var(--bg-3)]` | `bg-input`, `border-hover` |
| L150,157,261 | `text-[length:11px]` / `text-[length:10px]` | `text-xs` |
| L258 | `rounded-[var(--r-micro)]` | `rounded-xs` |
| L260-263 | inline style `borderColor`, `background` | `data-[active=true]:bg-brand-subtle` |
| L269 | `.ws-badge--success` | `bg-success-subtle text-success` |
| L296,301,315,328,333,344,357 | `text-[length:10px]` | `text-xs` |
| L390,425,438,444,448 | `text-[length:10px]` / `var(--cr-ok)` | `text-xs` / `success` |
| L456 | `rounded-[var(--dl-radius,2px)]` | `rounded-xs` |
| L458 | `var(--cr-ok)` / `var(--fg-3)` | `success` / `tertiary` |
| L476 | `text-[length:10px]` | `text-xs` |

#### StudioStage 改造 (`StudioStage.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L45 | `--fg-3` | `text-tertiary` |

#### PreviewWindow 改造 (`PreviewWindow.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L54-58 | `bg-green-500` / `bg-yellow-500` / `bg-red-500` / `bg-blue-500` / `bg-gray-500` | `bg-success` / `bg-warning` / `bg-danger` / `bg-info` / `bg-tertiary` |
| L178,184,190 | `text-[length:10px]` | `text-xs` |
| L190 | `rounded-[var(--dl-radius,2px)]` | `rounded-xs` |
| L219 | `shadow-[var(--shadow-float)]` | `shadow-md` |
| L228 | `rounded-[var(--r-micro)]` | `rounded-xs` |
| L230-231 | inline style `var(--accent-ghost)` / `var(--accent)` | `bg-brand-subtle` / `text-brand` |

#### StudioInspector 改造 (`StudioInspector.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L46 | `text-[10px]` | `text-xs text-tertiary` |

#### StudioStatusBar 改造 (`StudioStatusBar.tsx`)

保持简洁，已经是 24px 极简。

#### StudioDock 改造 (`StudioDock.tsx`)

保持结构和功能，仅更新 token 引用。

#### InspectorProfile 改造 (`InspectorProfile.tsx`)

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L37 | `rounded-[var(--r-xs)]` | `rounded-xs` |
| L39 | `text-[10px]` | `text-xs` |
| L52,54 | `border-[var(--border-subtle)]`, `bg-[var(--bg-3)]` | `border-subtle`, `bg-hover` |
| L58,61,70 | `text-[10px]` | `text-xs` |
| L62 | `bg-[var(--accent)]` | `bg-brand` |
| L76 | `bg-[var(--bg-4)]` | `bg-active` |
| L84 | `bg-[var(--accent)]` | `bg-brand` |
| L103 | `rounded-[var(--dl-radius,2px)]` `animate-pulse` | `rounded-xs` 无动画 |
| L105,113,114 | `bg-[var(--bg-4)]` / `border-[var(--border-subtle)]` | `bg-active` / `border-subtle` |
| L124 | `text-[var(--accent)]` | `text-brand` |
| L131 | `text-[10px]` | `text-xs` |

---

## 4. 原子组件改造

### 4.1 Button

| 当前 | 改造后 |
|------|--------|
| `px-[10px]` | `px-2.5` |
| `text-[11px]` | `text-xs` |
| `rounded-md` (6px) | `rounded-md` (8px via token) |
| `shadow-float` (dialog) | 去掉 |

### 4.2 Input

| 当前 | 改造后 |
|------|--------|
| `text-base` (16px) | `text-base` (13px via token) |
| `rounded-md` | `rounded-md` (8px via token) |

### 4.3 Badge

| 当前 | 改造后 |
|------|--------|
| `text-[9.5px]` 突破下限 | `text-xs` (10px) |
| `rounded-md` | `rounded-sm` |

### 4.4 Dialog

| 当前 | 改造后 |
|------|--------|
| `text-lg` (18px) | `text-lg` (15px via token) |
| `shadow-float` | `shadow-md` token |
| `rounded-md` | `rounded-xl` |

### 4.5 SegmentedControl

| 当前 | 改造后 |
|------|--------|
| `rounded-md` | `rounded-md` (8px via token) |
| `bordered` variant | 去掉边框 |

### 4.6 Select

| 当前 | 改造后 |
|------|--------|
| `h-7` | `h-8` |
| `rounded-md` | `rounded-md` (8px) |
| `border-border` | `border-default` |
| `bg-muted` | `bg-input` |

---

## 5. 全局样式改造

### 5.1 globals.css

| 工具类 | 当前 | 改造后 |
|--------|------|--------|
| `.as-label` | `11px 500 0.02em` | `text-xs` |
| `.as-micro` | `10px` | `text-micro` |
| `.as-mono` | `11px` | `text-xs font-mono` |
| `.as-kv-key` | `12px` | `text-sm` |
| `.as-big-num` | `48px font-display` | `text-2xl` |
| `.tag` | `11px` | `text-xs` |
| `.ring-box` | `14px` | `text-base` |
| `animate-page-enter` | 4px 位移 | 去掉或仅 opacity |
| `shadow-float` | 硬阴影 | `shadow-md` token |
| `html.theming` | `0.3s` | `var(--duration-slow)` |

### 5.2 shadcn-tailwind.css

| 当前 | 改造后 |
|------|--------|
| `--radius-base: 6px` | `--radius-base: 8px` |
| `--accordion-panel-height` | 去掉 (未使用) |

---

## 6. 迁移执行计划

### Phase 1: Token 系统 (2 天)
1. `globals.css` 全量替换 CSS 变量
2. 更新 `@theme inline` 映射
3. `shadcn-tailwind.css` 变量更新
4. Dark/Light 切换验证

### Phase 2: Workspace CSS 映射 (0.5 天)
1. `workspace/tokens.css` 映射到新 token
2. 验证 Studio 布局无异常

### Phase 3: Shell 布局 (2 天)
1. TitleBar 改造 (32px + 导航合并)
2. Sidebar 改造 (52px 仅图标)
3. StatusBar 融入 Sidebar
4. App.tsx 布局调整 (去掉 max-w, 去掉 CommandPalette)

### Phase 4: 主应用页面 (3 天)
1. WorkspacePage + AgentLivePreview + TweakPanel
2. ThemesPage + ThemeCard + VirtualThemeGrid
3. WallpaperEnginePage + WallpaperCard
4. SettingsPage
5. AppsPage + AppCard + AppDetailsDrawer

### Phase 5: Studio 页面 (1.5 天)
1. StudioTitleBar + StudioTopBar
2. StudioDrawer
3. StudioStage + PreviewWindow
4. StudioInspector + InspectorProfile
5. StudioStatusBar + StudioDock

### Phase 6: 组件统一 (1 天)
1. Button / Input / Badge / Dialog
2. SegmentedControl / Select
3. 焦点环统一 `ring-2 ring-brand`
4. 滚动条统一

### Phase 7: 测试验证 (1 天)
1. `npm run check` 全绿
2. `npm test` 全通过
3. 暗色/亮色手动走查
4. 六款 Agent 注入兼容性

---

## 7. 验收标准

| # | 标准 |
|---|------|
| 1 | 双主题 (Dark/Light) 完整可用 |
| 2 | 品牌色 <8% 面积 |
| 3 | 无硬阴影 |
| 4 | 圆角 8px 基础 |
| 5 | 字号在 10/11/12/13/15/18/24 阶梯 |
| 6 | 间距在 4/8/12/16/24/32 序列 |
| 7 | 无 `text-[` / `gap-[` / `rounded-[` 任意值 |
| 8 | 无 `border-l-[3px]` 左边框 |
| 9 | 无 `animate-ping` / `animate-card-enter` / `animate-page-enter` |
| 10 | 无 `shadow-float` |
| 11 | 无 `bg-cr-*` 硬编码色 |
| 12 | 无 `font-display` (Space Grotesk) |
| 13 | Studio 布局功能完整 (Drawer/Stage/Inspector/Dock) |
| 14 | 六款 Agent 注入兼容 |
| 15 | Electron 60fps 稳定 |

---

*文档结束 — 待用户审定后进入执行阶段*
