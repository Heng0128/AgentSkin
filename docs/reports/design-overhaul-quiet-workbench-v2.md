# AgentSkin Design Overhaul — Quiet Workbench Theme v2

> **版本**: 2.0 (完整覆盖版)  
> **日期**: 2026-08-23  
> **状态**: 方案审定 — 待执行  
> **核心理念**: 安静的自信 — 界面像空气一样存在，感知不到它，但离不开它  
> **覆盖范围**: 6 主页面 + 所有子页面/预览/对话框/抽屉 + 所有原子组件

---

## 0. 设计原则重申

### 0.1 核心关键词

- **静谧 (Calm)**: 低认知负荷，无视觉噪音，无过度装饰
- **简约 (Simple)**: 每个元素都有功能目的，无多余
- **克制 (Restrained)**: 品牌色 <8% 面积，无大面积渐变/模糊
- **清晰 (Clear)**: 信息层级靠灰阶 + 字号建立，不依赖颜色

### 0.2 绝对禁止项

| 禁止 | 原因 |
|------|------|
| `border-l-[3px]` 左边框指示器 | （历史）Swiss 风格遗存，用背景色替代 |
| `animate-ping` / `animate-card-enter` / `animate-page-enter` | 过度动效，违反静谧原则 |
| `shadow-float` 硬阴影 | 用 ring + 灰阶替代 |
| `bg-cr-success` / `bg-cr-warning` 等硬编码色 | 使用语义 token |
| `rounded-[var(--dl-radius,2px)]` 旧 token | 使用新 radius token |
| `font-display` (Space Grotesk) | 改用 Inter |
| `paddingBottom: 320px` 内联样式 | 使用 CSS 变量 |
| `bg-card2` / `bg-accent-ghost` 未定义 token | 使用新 token |

---

## 1. 完整 Token 系统

### 1.1 Dark 主题 (`:root[data-theme='dark']`)

```css
/* === 底色系统 === */
--bg-base: #0F0F10;            /* 窗口背景 */
--bg-surface: #161618;         /* 面板/侧栏/顶栏 */
--bg-elevated: #1E1E22;        /* 浮层/卡片 */
--bg-input: #0A0A0B;           /* 输入框 */
--bg-hover: rgba(255,255,255,0.04);
--bg-active: rgba(255,255,255,0.06);

/* === 文字灰阶 === */
--text-primary: #FAFAFA;
--text-secondary: #A1A1AA;
--text-tertiary: #71717A;
--text-disabled: #52525B;

/* === 边框 === */
--border-subtle: rgba(255,255,255,0.06);
--border-default: rgba(255,255,255,0.1);
--border-strong: rgba(255,255,255,0.16);

/* === 品牌色 === */
--brand: #6366F1;              /* Indigo */
--brand-hover: #818CF8;
--brand-active: #4F46E5;
--brand-subtle: rgba(99,102,241,0.08);
--brand-text: #A5B4FC;

/* === 语义色 === */
--success: #22C55E;
--success-subtle: rgba(34,197,94,0.1);
--warning: #EAB308;
--warning-subtle: rgba(234,179,8,0.1);
--danger: #EF4444;
--danger-subtle: rgba(239,68,68,0.1);
--info: #3B82F6;
--info-subtle: rgba(59,130,246,0.1);

/* === 圆角 === */
--radius-xs: 4px;
--radius-sm: 6px;
--radius-md: 8px;
--radius-lg: 10px;
--radius-xl: 14px;

/* === 间距 === */
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;

/* === 字号 === */
--text-micro: 10px;
--text-xs: 11px;
--text-sm: 12px;
--text-base: 13px;
--text-lg: 15px;
--text-xl: 18px;
--text-2xl: 24px;

/* === 字体 === */
--font-ui: "Inter Variable", "Inter", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

/* === 动效 === */
--duration-fast: 100ms;
--duration-normal: 150ms;
--duration-slow: 200ms;
--ease: cubic-bezier(0.16, 1, 0.3, 1);

/* === 阴影：极淡 === */
--shadow-sm: 0 0 0 1px var(--border-subtle);
--shadow-md: 0 0 0 1px var(--border-default), 0 4px 16px rgba(0,0,0,0.3);
```

### 1.2 Light 主题 (`:root[data-theme='light']`)

```css
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

/* 圆角/间距/字号/字体 与 Dark 一致 */

--shadow-sm: 0 0 0 1px var(--border-subtle);
--shadow-md: 0 0 0 1px var(--border-default), 0 2px 8px rgba(0,0,0,0.06);
```

---

## 2. Shell 布局重构

### 2.1 整体结构

```
┌─ TopBar (32px) ─────────────────────────────────────────────┐
│  ≡  AgentSkin  |  Workspace  Themes  Wallpaper  Settings  🔍 │
├─ SideBar (52px) ─┬─ MainContent ────────────────────────────┤
│                   │                                          │
│  🏠               │  Page content (full bleed, no max-w)     │
│  🎨               │                                          │
│  🖼               │                                          │
│  ⚙               │                                          │
│  ─ ─ ─ ─ ─ ─ ─  │                                          │
│  ● v1.0.0        │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### 2.2 TitleBar 改造

**当前代码位置**: `src/ui/components/title-bar.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L92 | `h-[38px]` | `h-8` (32px) |
| L92 | `gap-2 px-2` | `gap-4 px-3` |
| L96-97 | `bg-[color-mix(...)]` / `bg-[var(--surface)]` | `bg-surface` |
| L105 | `font-display text-[13px] font-bold tracking-tight` | `text-base font-medium` |
| L108 | `h-3 w-px bg-border` | 去掉分隔线 |
| L109 | `text-[11px] text-muted-foreground/70` | `text-xs text-tertiary` |
| L117 | `gap-0` | `gap-1` |
| L86-87 | iconBtn: `h-7 w-7 rounded-md` | `w-7 h-7 rounded-sm` |
| L119-129 | SegmentedControl 主题切换 | 改为图标按钮 (☀/☾) |
| L134 | `mx-1 h-4 w-px bg-border` | `mx-2` |

**新结构**:
```tsx
<header className="flex h-8 items-center gap-4 px-3 bg-surface border-b border-subtle">
  <button className="icon-btn"><Menu size={16} /></button>
  <nav className="flex items-center gap-1">
    <NavItem active>Workspace</NavItem>
    <NavItem>Themes</NavItem>
    <NavItem>Wallpaper</NavItem>
    <NavItem>Settings</NavItem>
  </nav>
  <div className="flex-1" />
  <button className="icon-btn"><Search size={14} /></button>
  <button className="icon-btn"><Sun size={14} /></button>
  {/* Windows window controls */}
</header>
```

### 2.3 Sidebar 改造

**当前代码位置**: `src/ui/components/sidebar.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L90-91 | `width: collapsed ? 62 : 224` + transition | 固定 `w-[52px]`，无折叠 |
| L92 | `background: var(--surface)` | `bg-surface` |
| L99-122 | Brand button (Logo + 文字) | 去掉，仅保留 Logo 图标 |
| L125-146 | NavButton 分组列表 | 改为纯图标按钮列表 |
| L129 | `text-[11px] font-medium` 分组标签 | 去掉 |
| L35-36 | `m-[4px_8px]` | `mx-[6px] my-1` |
| L38 | `active && 'bg-accent text-foreground border-l-[3px] border-primary'` | `active && 'bg-brand-subtle text-brand-text'` |
| L46 | `text-[13px]` | 去掉文字，仅图标 |
| L149-164 | Footer (Studio 按钮) | 去掉，Studio 移入 TopBar 或二级菜单 |

**新结构**:
```tsx
<aside className="flex h-full w-[52px] flex-col border-r border-subtle bg-surface">
  <div className="flex items-center justify-center h-10 border-b border-subtle">
    <Logo className="size-5" />
  </div>
  <nav className="flex-1 flex flex-col items-center gap-1 py-2">
    <SidebarIcon icon={Home} active />
    <SidebarIcon icon={PaintBucket} />
    <SidebarIcon icon={Image} />
    <SidebarIcon icon={Settings} />
  </nav>
  <div className="flex flex-col items-center gap-1 py-2 border-t border-subtle">
    <StatusDot status="running" />
    <span className="text-micro text-tertiary">v1.0</span>
  </div>
</aside>
```

### 2.4 StatusBar 改造

**当前代码位置**: `src/ui/components/status-bar.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L100 | `h-[28px]` 独立条 | 融入 Sidebar 底部 |
| L100 | `bg-[var(--surface)] px-3` | `bg-surface px-2` |
| L103 | `size-2 rounded-full` | `size-[6px] rounded-full` |
| L104 | `as-label` | `text-xs text-secondary` |
| L108-133 | 中间状态信息 | 去掉（hover tooltip 替代） |
| L137-166 | 右侧控件 | 简化为仅版本号 |

---

## 3. 逐页面详细改造方案

### 3.1 WorkspacePage

**当前代码位置**: `src/ui/pages/WorkspacePage.tsx`

#### 3.1.1 PageHeader

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L186 | `font-display text-sm font-bold tracking-tight` | `text-base font-medium text-primary` |
| L187 | `as-micro` (10px) | `text-xs text-secondary` |
| L190-195 | 刷新按钮 `bg-card2` | ghost 按钮 + RefreshCw 图标 |
| L204 | `text-[11px]` 时间戳 | `text-xs text-tertiary font-mono` |

#### 3.1.2 HealthBar

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L211 | `text-[11px]` | `text-xs` |
| L213 | `text-[10px]` | `text-xs` |
| L215 | `text-red-500` 硬编码 | `text-danger` |
| L226 | `bg-green-500` 硬编码 | `bg-success` |
| L229 | `text-[11px]` | `text-xs` |
| L237 | `bg-green-500` 硬编码 | `bg-success` |
| L244 | `text-[10px]` | `text-xs` |
| L260 | `text-[11px]` | `text-xs` |
| L264 | `text-[10px]` | `text-xs` |
| L283 | `text-[11px]` | `text-xs` |
| L286 | `text-[10px]` | `text-xs` |
| L304 | `text-[11px]` | `text-xs` |
| L311 | `text-[11px]` | `text-xs` |
| L318 | `text-[11px]` | `text-xs` |
| L341 | `text-[11px]` | `text-xs` |
| L351 | `text-[12px]` | `text-xs` |

**HealthBar 结构改造**:
```tsx
// 之前: 4个独立指标 + 彩色图标
// 之后: 单行紧凑
<div className="flex items-center gap-3 px-4 py-2 text-xs text-secondary border-b border-subtle">
  <StatusDot status={score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad'} />
  <span className="font-mono tabular-nums">{score}</span>
  <span className="text-tertiary">|</span>
  <span>{blockingCount} blocking</span>
  <span className="text-tertiary">|</span>
  <span className="font-mono text-tertiary">{agentId} @ {time}</span>
</div>
```

#### 3.1.3 AgentRail

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L371 | `w-[200px]` | `w-[180px]` |
| L384 | `border-l-[3px] border-primary` 活跃态 | `bg-brand-subtle` |
| L385 | `text-[11px]` | `text-xs` |
| L395 | `text-[10px]` | `text-xs` |
| L405 | `text-[11px]` | `text-xs` |
| L415 | `text-[10px]` | `text-xs` |
| L425 | `text-[11px]` | `text-xs` |
| L435 | `text-[10px]` | `text-xs` |

#### 3.1.4 ActionButtons

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L450-455 | undo/redo `↶↷` Unicode | Lucide `Undo2/Redo2` 图标 |
| L460 | `text-[11px]` | `text-xs` |
| L470 | `text-[10px]` | `text-xs` |
| L480 | `text-[11px]` | `text-xs` |
| L490 | `text-[10px]` | `text-xs` |

#### 3.1.5 空状态

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L510 | `text-[11px]` | `text-xs text-secondary` |
| L520 | `text-[10px]` | `text-xs text-tertiary` |

---

### 3.2 ThemesPage

**当前代码位置**: `src/ui/pages/themesPage.tsx`

#### 3.2.1 PageHeader

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L97 | `text-xs` (=12px) | `text-sm` (=12px，使用 token) |
| L101 | `text-[10px]` | `text-xs` |
| L108 | `style={{ fontSize: '11px' }}` 内联 | `text-xs` |
| L142 | `text-[10px]` | `text-xs` |

#### 3.2.2 Toolbar

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L155 | `gap-2` | `gap-1` |
| L165 | `h-7` 搜索框 | `h-8` |
| L175 | `w-[200px]` | `w-[240px]` |
| L185 | `h-7` 排序 | `h-8` |
| L195 | `h-7` 方向 | `h-8` |
| L205 | `h-7` 导入 | `h-8` |
| L215 | `bg-primary text-primary-foreground` Studio | `bg-brand text-white` |

#### 3.2.3 FilterRow

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L235 | SegmentedControl `bordered` | Chip pill 样式 |
| L245 | SegmentedControl `bordered` | Chip pill 样式 |
| L255 | 自定义按钮 + `animate-ping` | 静态指示点，无动画 |
| L265 | Badge `variant="red"` | Badge `variant="brand"` |

#### 3.2.4 空状态

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L285 | `text-[11px]` | `text-xs text-secondary` |
| L295 | `text-[13px]` | `text-base text-secondary` |

#### 3.2.5 拖拽覆盖层

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L328 | `backdropFilter: 'blur(20px) saturate(1.5)'` | 去掉毛玻璃，改用 `bg-base/80` |
| L333 | `boxShadow: 'var(--shadow, 0 10px 28px rgba(0,0,0,0.4))'` | 去掉阴影 |

---

### 3.3 ThemeCard 组件

**当前代码位置**: `src/ui/components/themes/ThemeCard.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L34 | `rounded-md` | `rounded-lg` |
| L34 | `bg-card` | `bg-elevated` |
| L35-37 | `border-l-[3px] border-primary` 选中态 | `ring-1 ring-brand` |
| L53 | `bg-card2` (未定义 token) | `bg-surface` |
| L58 | `text-sm font-medium opacity-20` | `text-base text-tertiary` |
| L66 | `bg-cr-success/90` 硬编码 | `bg-success` |
| L72 | `bg-popover/90` | `bg-elevated` |
| L83-88 | `bg-gray-900/80 text-gray-300` 硬编码 | `bg-surface text-secondary` |
| L84 | `bg-muted text-foreground` | `bg-surface text-primary` |
| L102 | `border-white/10 bg-background/70` | `border-subtle bg-surface` |
| L109-113 | `animate-ping` 动态指示 | 去掉动画，静态点 |
| L109 | `bg-card2` | `bg-surface` |
| L110 | `bg-white/60` | `bg-brand` |
| L112 | `bg-white` | `bg-brand` |
| L123 | `text-[13px] font-medium tracking-[-0.01em]` | `text-base` |
| L125 | `text-[10px] tabular-nums text-muted-foreground/50` | `text-xs text-tertiary font-mono` |
| L132 | `font-mono text-[10px] text-muted-foreground/60` | `font-mono text-xs text-tertiary` |
| L136 | `bg-muted-foreground/30` | `bg-tertiary` |
| L150 | `bg-cr-success/15` 硬编码 | `bg-success-subtle` |
| L151 | `ring-1 ring-border` | `ring-1 ring-border-subtle` |
| L165 | Badge `variant="outline"` | Badge `variant="subtle"` |

---

### 3.4 VirtualThemeGrid 组件

**当前代码位置**: `src/ui/components/themes/VirtualThemeGrid.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L119 | `animate-page-enter` | 去掉 |
| L119 | `p-4` | `p-3` |
| L40 | `GAP = 10` | `GAP = 8` |

---

### 3.5 WallpaperEnginePage

**当前代码位置**: `src/ui/pages/WallpaperEnginePage.tsx`

#### 3.5.1 Toolbar

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L105 | `gap-2` | `gap-1` |
| L115 | `h-7` 搜索 | `h-8` |
| L125 | `w-[200px]` | `w-[240px]` |
| L135 | `h-7` 排序 | `h-8` |
| L145 | `h-7` 类型 | `h-8` |
| L155 | `h-7` 导入 | `h-8` |
| L165 | 开关 + 文字 | 仅 Switch + tooltip |

#### 3.5.2 网格

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L185 | `gap-2` | `gap-3` |
| L195 | `grid-cols-2 sm:grid-cols-3 ...` | 保持响应式，统一 gap |

---

### 3.6 WallpaperCard 组件

**当前代码位置**: `src/ui/components/wallpaper/WallpaperCard.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L133 | `animationDelay: ...` + `animate-card-enter` | 去掉入场动画 |
| L135 | `rounded-md` | `rounded-lg` |
| L135 | `bg-card` | `bg-elevated` |
| L136 | `hover:border-primary/40 hover:bg-card2` | `hover:border-default hover:bg-surface` |
| L137 | `border-primary/60` 选中 | `ring-1 ring-brand` |
| L171 | `bg-black/60` 硬编码 | `bg-black/40` (更淡) |
| L172 | `text-popover-foreground/90` | `text-primary` |
| L186-193 | `bg-primary/85`, `bg-cr-info/85`, `bg-success/85`, `bg-cr-warning/85` | 统一使用 `bg-brand`, `bg-info`, `bg-success`, `bg-warning` |
| L211 | `bg-primary` | `bg-brand` |
| L217 | `bg-cr-warning` | `bg-warning` |
| L223 | `bg-muted` | `bg-surface` |
| L231 | `font-display text-[11px] font-bold` | `text-xs font-medium` |
| L232 | `font-mono text-[10px]` | `font-mono text-xs text-tertiary` |
| L251 | `text-destructive` | `text-danger` |
| L261 | `text-muted-foreground` | `text-tertiary` |
| L273 | `text-muted-foreground` → `hover:text-destructive` | `text-tertiary` → `hover:text-danger` |

---

### 3.7 SettingsPage

**当前代码位置**: `src/ui/pages/SettingsPage.tsx`

#### 3.7.1 SectionRail

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L45 | `w-[180px]` | `w-[160px]` |
| L55 | 返回按钮 | 去掉 |
| L61 | `text-[11px]` 标题 | 去掉标题 |
| L63 | `text-[10px]` 描述 | 去掉描述 |
| L75 | `border-l-[3px] border-primary` 活跃 | `bg-brand-subtle text-brand-text` |
| L85 | `text-[11px]` | `text-xs` |
| L95 | `text-[10px]` | `text-xs` |

#### 3.7.2 SettingRow

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L113 | `text-[13px]` | `text-base` |
| L114 | `text-[10px]` | `text-xs` |
| L131 | `text-[11px]` | `text-xs` |
| L161 | `text-[11px]` | `text-xs` |
| L166 | `text-[11px]` | `text-xs` |
| L286 | `gap-[3px]` | `gap-1` |
| L291 | `text-[11px]` | `text-xs` |
| L297 | `text-[11px]` | `text-xs` |
| L325 | `text-[11px]` | `text-xs` |
| L346 | `text-[13px]` | `text-base` |
| L354 | `text-[11px]` | `text-xs` |
| L369 | `text-[11px]` | `text-xs` |
| L374 | `text-[11px]` | `text-xs` |
| L423 | `text-[10px]` | `text-xs` |
| L433 | `text-[11px]` | `text-xs` |
| L443 | `text-[11px]` | `text-xs` |
| L448 | `text-[11px]` | `text-xs` |

**SettingRow 结构改造**:
```tsx
// 之前: color-mix 背景 + 圆角卡片感
// 之后: 纯分隔线，无背景
<div className="flex items-center justify-between gap-4 py-3 px-2 border-b border-subtle last:border-0">
  <div>
    <p className="text-base text-primary">{title}</p>
    {description && <p className="text-xs text-secondary mt-0.5">{description}</p>}
  </div>
  {children}
</div>
```

---

### 3.8 AppsPage

**当前代码位置**: `src/ui/pages/AppsPage.tsx`

#### 3.8.1 PageHeader

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L165 | `max-w-[1240px] px-8 py-6` | 去掉 max-w，`px-4 py-4` |
| L165 | `paddingBottom: '320px'` 内联 | 使用 CSS 变量 `--drawer-height` |
| L169 | `font-display text-sm font-bold tracking-tight` | `text-base font-medium` |
| L172 | `as-micro` | `text-xs text-secondary` |
| L176 | Button `variant="outline"` | ghost 按钮 |

#### 3.8.2 Category Tabs

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L186 | `gap-2 border-b border-border pb-2` | `gap-1` |
| L193 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L193 | `px-3 py-1.5 text-[12px]` | `px-2.5 py-1 text-xs` |
| L195 | `bg-accent text-foreground` | `bg-brand-subtle text-brand-text` |
| L196 | `text-muted-foreground hover:bg-muted` | `text-secondary hover:bg-hover` |
| L202 | `font-mono text-[10px]` | `font-mono text-xs` |
| L203 | `text-foreground/70` / `text-muted-foreground/50` | `text-primary/70` / `text-tertiary` |

#### 3.8.3 Progress Bar

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L215 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L220 | `bg-cr-primary` | `bg-brand` |

#### 3.8.4 Error Banner

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L230 | `rounded-md bg-destructive/10` | `rounded-md bg-danger-subtle` |
| L232 | `text-[12px] text-destructive` | `text-xs text-danger` |

#### 3.8.5 Status Legend

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L242 | `as-micro` | `text-xs text-secondary` |
| L244 | `bg-cr-success` | `bg-success` |
| L248 | `bg-[var(--muted-foreground)] opacity-25` | `bg-tertiary` |
| L252 | `bg-cr-warning` | `bg-warning` |

#### 3.8.6 Empty State

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L280 | `font-mono text-[11px]` | `font-mono text-xs text-secondary` |
| L289 | `text-[13px]` | `text-base text-secondary` |

#### 3.8.7 Manual Add

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L295 | Button `variant="ghost"` | ghost 按钮 (保持) |
| L296 | `text-muted-foreground/50` | `text-tertiary` |

---

### 3.9 AppCard 组件

**当前代码位置**: `src/ui/components/apps/AppCard.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L62 | `bg-cr-success` | `bg-success` |
| L63 | `bg-cr-warning` | `bg-warning` |
| L64 | `bg-[var(--muted-foreground)] opacity-25` | `bg-tertiary` |
| L99 | `rounded-md p-2` | `rounded-lg p-2` |
| L100 | `duration-base` | `duration-fast` |
| L101 | `hover:bg-muted/40` | `hover:bg-hover` |
| L102 | `hover:bg-accent/50` | `hover:bg-brand-subtle` |
| L103 | `active:bg-accent/70` | `active:bg-active` |
| L103 | `ring-2 ring-cr-success/50` | `ring-1 ring-success` |
| L118 | `font-display text-[22px] font-bold` | `text-xl font-medium text-tertiary` |
| L125 | `bg-background` | `bg-base` |
| L133 | `font-display text-[13px] font-bold tracking-[-.01em]` | `text-base font-medium` |
| L137 | `font-mono text-[10px] tabular-nums text-muted-foreground/60` | `font-mono text-xs text-tertiary` |

---

### 3.10 AppDetailsDrawer 组件

**当前代码位置**: `src/ui/components/apps/AppDetailsDrawer.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L57 | `h-[300px] border-t border-border-strong bg-card shadow-float` | `h-[280px] border-t border-default bg-elevated` (无阴影) |
| L67 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L75 | `as-mono` | `text-xs text-secondary` |
| L84 | `font-display text-[22px] font-bold` | `text-xl font-medium text-tertiary` |
| L88 | `font-display text-[12px] font-bold` | `text-sm font-medium` |
| L103 | `bg-cr-success` | `bg-success` |
| L108 | `bg-[var(--muted-foreground)] opacity-25` | `bg-tertiary` |
| L127 | Button `variant="primary"` | `variant="brand"` |
| L136 | Button `variant="outline"` | `variant="ghost"` |
| L169 | `font-mono text-[10px] uppercase tracking-wider` | `font-mono text-xs uppercase tracking-wider text-tertiary` |
| L173 | `text-[11px]` | `text-xs` |

---

### 3.11 AgentLivePreview 组件

**当前代码位置**: `src/ui/components/workspace/AgentLivePreview.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L150 | `rounded-md bg-card` | `rounded-lg bg-elevated` |
| L151 | `as-mono` | `text-xs text-secondary` |
| L160 | `bg-primary/30 animate-pulse` | `bg-brand/20` (无动画) |
| L165 | `bg-destructive` | `bg-danger` |
| L177 | `rounded-md` | `rounded-lg` |
| L179 | `bg-[var(--border-subtle)]` | `bg-border-subtle` |
| L181 | `bg-[var(--surface)]` | `bg-surface` |
| L182 | `font-mono text-[10px]` | `font-mono text-xs text-tertiary` |
| L188 | `bg-[var(--surface)]` | `bg-surface` |
| L189 | `font-mono text-[10px]` | `font-mono text-xs text-tertiary` |
| L201 | `rounded-md` | `rounded-lg` |

---

### 3.12 TweakPanel 组件

**当前代码位置**: `src/ui/components/workspace/TweakPanel.tsx`

| 行号 | 当前 | 改造后 |
|------|------|--------|
| L259 | `h-8 w-32 rounded-md text-[13px]` | `h-8 w-[140px] rounded-md text-base` |
| L264 | `text-[13px]` | `text-base` |
| L308 | `text-[11px] font-medium tracking-tight` | `text-xs font-medium` |
| L350 | `rounded-[var(--dl-radius,2px)]` | `rounded-sm` |
| L351 | `bg-[var(--accent-ghost)] ring-1 ring-[var(--accent)]` | `bg-brand-subtle ring-1 ring-brand` |
| L357 | `bg-[var(--accent)]` | `bg-brand` |
| L360 | `text-[11px] tracking-tight` | `text-xs` |
| L366 | `rounded-[var(--radius-sm)]` | `rounded-sm` |
| L366 | `text-muted-foreground hover:text-foreground hover:bg-[var(--surface)]` | `text-secondary hover:text-primary hover:bg-hover` |
| L406 | `h-7 rounded-md px-2 font-mono text-[11px]` | `h-8 rounded-md px-2 font-mono text-xs` |

---

### 3.13 DetailPanel (主题预览对话框)

**当前代码位置**: `src/ui/components/detail-panel.tsx`

> 注: 需要读取此文件后补充具体行号

**改造方向**:
- 对话框内容区去掉 `shadow-float`
- 预览 iframe 区域 `rounded-md` → `rounded-lg`
- 信息区域字号统一为新阶梯
- 操作按钮区样式统一

---

### 3.14 StudioPage

**当前代码位置**: `src/ui/StudioApp.tsx` + `src/ui/pages/StudioPage.tsx`

> 注: Studio 是独立窗口，但视觉语言需统一

**改造方向**:
- 顶栏高度 32px
- 侧栏 52px
- 所有组件使用新 token
- 创作型 UI (颜色选择器、画布) 可以更丰富，但框架元素统一

---

## 4. 原子组件改造

### 4.1 Button

**当前代码位置**: `src/ui/components/ui/button.tsx`

| 当前 | 改造后 |
|------|--------|
| `px-[10px]` 任意值 | `px-2.5` (10px 标准档) |
| `text-[11px]` | `text-xs` |
| `rounded-md` (6px) | `rounded-md` (8px，token 变更) |
| `shadow-float` (dialog 内) | 去掉阴影 |

**新 Button Token**:
```css
.btn {
  height: 32px;
  padding: 0 12px;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: 500;
  transition: background-color var(--duration-fast) var(--ease);
}
.btn-primary { background: var(--brand); color: #fff; }
.btn-primary:hover { background: var(--brand-hover); }
.btn-ghost { background: transparent; color: var(--text-secondary); }
.btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }
```

### 4.2 Input

**当前代码位置**: `src/ui/components/ui/input.tsx`

| 当前 | 改造后 |
|------|--------|
| `text-base` (16px，不在阶梯) | `text-base` (13px token) |
| `rounded-md` | `rounded-md` (8px) |

### 4.3 Badge

**当前代码位置**: `src/ui/components/ui/badge.tsx`

| 当前 | 改造后 |
|------|--------|
| `text-[9.5px]` 突破下限 | `text-xs` (10px) |
| `rounded-md` | `rounded-sm` |

### 4.4 Dialog

**当前代码位置**: `src/ui/components/ui/dialog.tsx`

| 当前 | 改造后 |
|------|--------|
| `text-lg` (18px，不在阶梯) | `text-lg` (15px token) |
| `shadow-float` | `shadow-md` (新 token) |
| `rounded-md` | `rounded-xl` |

### 4.5 SegmentedControl

**当前代码位置**: `src/ui/components/ui/segmented-control.tsx`

| 当前 | 改造后 |
|------|--------|
| `rounded-md` | `rounded-md` (8px) |
| `bordered` variant | 去掉边框，用背景色区分 |

### 4.6 Select

| 当前 | 改造后 |
|------|--------|
| `h-7` (28px) | `h-8` (32px) |
| `rounded-md` | `rounded-md` (8px) |
| `border-border` | `border-default` |
| `bg-muted` | `bg-input` |

### 4.7 Switch

| 当前 | 改造后 |
|------|--------|
| 保持 | 保持 (Radix 组件，样式已合理) |

### 4.8 ScrollArea

| 当前 | 改造后 |
|------|--------|
| 滚动条样式 | 4px 宽，hover 显示，`bg-tertiary` |

---

## 5. 全局样式改造

### 5.1 globals.css

**需要修改**:

| 行号范围 | 当前 | 改造后 |
|----------|------|--------|
| `:root` 变量块 | 旧（历史）Swiss token | 新 Quiet Workbench token |
| `@theme inline` | 旧映射 | 新映射 |
| `.as-label` | `11px 500 0.02em` | `text-xs` |
| `.as-micro` | `10px` | `text-micro` |
| `.as-mono` | `11px` | `text-xs font-mono` |
| `.as-kv-key` | `12px` | `text-sm` |
| `.as-big-num` | `48px font-display` | `text-2xl` |
| `.tag` | `11px` | `text-xs` |
| `.ring-box` | `14px` | `text-base` |
| `.sw::after` | `box-shadow` | 去掉或替换 |
| `body.no-anim` | `transition: none` | 保持 |
| `html.theming` | `0.3s` | `var(--duration-slow)` |
| `animate-page-enter` | 4px 位移 | 去掉或仅 opacity |
| `shadow-float` | 硬阴影 | 替换为 `shadow-md` |

### 5.2 shadcn-tailwind.css

| 当前 | 改造后 |
|------|--------|
| `--radius-base: 6px` | `--radius-base: 8px` |
| `--radius-sm/md/lg` | 与新 token 一致 |
| `--accordion-panel-height` | 去掉 (未使用) |

---

## 6. 迁移执行计划

### Phase 1: Token 系统 (2 天)
1. 替换 `globals.css` 中所有 CSS 变量为新 Token
2. 更新 `@theme inline` 映射
3. 更新 `shadcn-tailwind.css` 中的变量引用
4. 删除旧 token (`--dl-radius`, `--radius-sm/md/lg` 旧值)
5. 验证 Dark/Light 切换正常

### Phase 2: Shell 布局 (2 天)
1. TitleBar 改造 (32px + 导航合并)
2. Sidebar 改造 (52px 仅图标)
3. StatusBar 融入 Sidebar
4. App.tsx 布局调整 (去掉 max-w 约束, 去掉 CommandPalette)
5. 去掉所有 `animate-page-enter` / `animate-card-enter`

### Phase 3: 逐页面改造 (4 天)
1. WorkspacePage + AgentLivePreview + TweakPanel
2. ThemesPage + ThemeCard + VirtualThemeGrid
3. WallpaperEnginePage + WallpaperCard
4. SettingsPage
5. AppsPage + AppCard + AppDetailsDrawer

### Phase 4: 组件统一 (1 天)
1. Button / Input / Badge / Dialog 样式统一
2. SegmentedControl / Select 样式统一
3. 焦点环样式统一 (`ring-2 ring-brand`)
4. 滚动条样式统一

### Phase 5: 测试验证 (1 天)
1. `npm run check` 全绿
2. `npm test` 全通过
3. 暗色/亮色手动走查
4. 六款 Agent 注入兼容性验证

---

## 7. 验收标准

- [ ] 双主题 (Dark/Light) 完整可用
- [ ] 品牌色 <8% 面积
- [ ] 无硬阴影（仅 Ring + 极淡浮层）
- [ ] 圆角 8px 基础
- [ ] 所有字号在 10/11/12/13/15/18/24 阶梯内
- [ ] 所有间距在 4/8/12/16/24/32 序列内
- [ ] 无 `text-[` 任意值绕过
- [ ] 无 `gap-[` 任意值绕过
- [ ] 无 `rounded-[` 任意值绕过
- [ ] 无 `border-l-[3px]` 左边框指示器
- [ ] 无 `animate-ping` / `animate-card-enter` / `animate-page-enter`
- [ ] 无 `shadow-float` 硬阴影
- [ ] 无 `bg-cr-success` 等硬编码色
- [ ] 无 `font-display` (Space Grotesk)
- [ ] 六款 Agent 注入后视觉和谐
- [ ] Electron 中 60fps 稳定
- [ ] 一眼不像（历史）Swiss、不像暖色 Claude
- [ ] 像 2025-2026 年的主流工具

---

*文档结束 — 待用户审定后进入执行阶段*
