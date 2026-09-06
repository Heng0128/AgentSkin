# AgentSkin Design Overhaul — Quiet Workbench Theme

> **版本**: 1.0  
> **日期**: 2026-08-23  
> **状态**: 方案审定 — 待执行  
> **核心理念**: 安静的自信 — 界面像空气一样存在，感知不到它，但离不开它

---

## 1. 设计原则

### 1.1 核心关键词

- **静谧 (Calm)**: 低认知负荷，无视觉噪音，无过度装饰
- **简约 (Simple)**: 每个元素都有功能目的，无多余
- **克制 (Restrained)**: 品牌色 <8% 面积，无大面积渐变/模糊
- **清晰 (Clear)**: 信息层级靠灰阶 + 字号建立，不依赖颜色

### 1.2 与（历史）Swiss 风格的本质区别

| Swiss (旧，历史) | Quiet Workbench (新) |
|------------|---------------------|
| 锐角 6px | 8px 柔和圆角 |
| 硬阴影 | 无阴影，靠边框 + 灰阶 |
| 纯冷灰底 | 中性灰底（暖黑 / 纯白） |
| 品牌红仅信号 | 品牌蓝 Indigo 融入交互 |
| Space Grotesk 声明式 | Inter 隐形式 |
| 禁止一切装饰 | 允许微妙的层级装饰 |

### 1.3 双主题策略

- **Dark**: 深灰偏暖黑底 + 12 级灰阶 — 沉浸、专业、不刺眼
- **Light**: 纯白底 + 12 级灰阶 — 通透、清爽、适合白天
- **品牌色一致**: Indigo #6366F1 在两种主题中保持相同色值
- **灰阶对称**: Dark 的灰阶从黑到白，Light 从白到黑，逻辑镜像

---

## 2. 完整 Token 系统

### 2.1 Dark 主题

```css
:root[data-theme='dark'] {
  /* === 底色系统 === */
  --bg-base: #0F0F10;           /* 最底层 — 窗口背景 */
  --bg-surface: #161618;        /* 面板/侧栏/顶栏底 */
  --bg-elevated: #1E1E22;       /* 浮层/卡片底 */
  --bg-input: #0A0A0B;          /* 输入框底 */
  --bg-hover: rgba(255,255,255,0.04);  /* hover 态 */
  --bg-active: rgba(255,255,255,0.06); /* 激活态 */

  /* === 文字灰阶 (12级，这里列出关键5级) === */
  --text-primary: #FAFAFA;      /* 主文字 — 标题/重要信息 */
  --text-secondary: #A1A1AA;    /* 次级 — 描述/标签 */
  --text-tertiary: #71717A;     /* 辅助 — 占位符/禁用 */
  --text-disabled: #52525B;     /* 禁用 */

  /* === 边框 === */
  --border-subtle: rgba(255,255,255,0.06);   /* 几乎不可见 — 内部分隔 */
  --border-default: rgba(255,255,255,0.1);   /* 默认 — 输入框/卡片 */
  --border-strong: rgba(255,255,255,0.16);   /* 强调 — 焦点态 */

  /* === 品牌色 === */
  --brand: #6366F1;             /* Indigo — Linear 同款 */
  --brand-hover: #818CF8;       /* hover */
  --brand-active: #4F46E5;      /* active */
  --brand-subtle: rgba(99,102,241,0.08);  /* 淡蓝底 */
  --brand-text: #A5B4FC;        /* 品牌文字 */

  /* === 语义色 === */
  --success: #22C55E;
  --success-subtle: rgba(34,197,94,0.1);
  --warning: #EAB308;
  --warning-subtle: rgba(234,179,8,0.1);
  --danger: #EF4444;
  --danger-subtle: rgba(239,68,68,0.1);
  --info: #3B82F6;

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
  --space-7: 48px;

  /* === 字号 === */
  --text-micro: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-lg: 15px;
  --text-xl: 18px;
  --text-2xl: 24px;

  /* === 字体 === */
  --font-ui: "Inter Variable", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "JetBrains Mono", "IBM Plex Mono", ui-monospace, monospace;

  /* === 动效 === */
  --duration-fast: 100ms;
  --duration-normal: 150ms;
  --duration-slow: 200ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  /* === 阴影：极淡或不用 === */
  --shadow-sm: 0 0 0 1px var(--border-subtle);
  --shadow-md: 0 0 0 1px var(--border-default), 0 4px 16px rgba(0,0,0,0.3);
  --shadow-lg: 0 0 0 1px var(--border-default), 0 8px 32px rgba(0,0,0,0.4);
}
```

### 2.2 Light 主题

```css
:root[data-theme='light'] {
  /* === 底色系统 === */
  --bg-base: #FFFFFF;            /* 纯白底 */
  --bg-surface: #F6F6F7;         /* 面板/侧栏/顶栏底 */
  --bg-elevated: #FFFFFF;        /* 浮层/卡片底 */
  --bg-input: #F3F3F4;           /* 输入框底 */
  --bg-hover: rgba(0,0,0,0.04);  /* hover 态 */
  --bg-active: rgba(0,0,0,0.06); /* 激活态 */

  /* === 文字灰阶 === */
  --text-primary: #1A1A1A;      /* 主文字 */
  --text-secondary: #6B7280;    /* 次级 */
  --text-tertiary: #9CA3AF;     /* 辅助 */
  --text-disabled: #D1D5DB;     /* 禁用 */

  /* === 边框 === */
  --border-subtle: rgba(0,0,0,0.06);
  --border-default: rgba(0,0,0,0.1);
  --border-strong: rgba(0,0,0,0.16);

  /* === 品牌色 (与 Dark 一致) === */
  --brand: #6366F1;
  --brand-hover: #4F46E5;
  --brand-active: #4338CA;
  --brand-subtle: rgba(99,102,241,0.06);
  --brand-text: #4F46E5;

  /* === 语义色 === */
  --success: #16A34A;
  --success-subtle: rgba(22,163,74,0.08);
  --warning: #CA8A04;
  --warning-subtle: rgba(202,138,4,0.08);
  --danger: #DC2626;
  --danger-subtle: rgba(220,38,38,0.08);
  --info: #2563EB;

  /* === 圆角/间距/字号/字体 与 Dark 一致 === */

  /* === 阴影：Light 下更淡 === */
  --shadow-sm: 0 0 0 1px var(--border-subtle);
  --shadow-md: 0 0 0 1px var(--border-default), 0 2px 8px rgba(0,0,0,0.06);
  --shadow-lg: 0 0 0 1px var(--border-default), 0 8px 24px rgba(0,0,0,0.08);
}
```

### 2.3 Tailwind v4 @theme 映射

```css
@theme inline {
  /* Colors */
  --color-background: var(--bg-base);
  --color-foreground: var(--text-primary);
  --color-surface: var(--bg-surface);
  --color-card: var(--bg-elevated);
  --color-card-foreground: var(--text-primary);
  --color-popover: var(--bg-elevated);
  --color-popover-foreground: var(--text-primary);
  --color-muted: var(--bg-hover);
  --color-muted-foreground: var(--text-secondary);
  --color-border: var(--border-default);
  --color-input: var(--border-default);
  --color-ring: var(--brand);
  --color-primary: var(--brand);
  --color-primary-foreground: #FFFFFF;
  --color-destructive: var(--danger);
  --color-destructive-foreground: #FFFFFF;
  --color-accent: var(--brand-subtle);
  --color-accent-foreground: var(--brand-text);

  /* Radius */
  --radius-sm: var(--radius-sm);
  --radius-md: var(--radius-md);
  --radius-lg: var(--radius-lg);

  /* Shadow */
  --shadow-float: var(--shadow-md);
}
```

---

## 3. Shell 布局重构

### 3.1 整体结构

```
┌─ TopBar (32px) ─────────────────────────────────────────────┐
│  ≡  Brand  NavItems ................. Search [+]  Theme  ●  │
├─ SideBar ─┬─ MainContent ───────────────────────────────────┤
│           │                                                  │
│   52px    │  Page content                                    │
│   Icons   │  (no max-w constraint, full bleed)               │
│   only    │                                                  │
│           │                                                  │
│  ─ ─ ─ ─  │                                                  │
│  Status   │                                                  │
│  (inline) │                                                  │
└───────────┴──────────────────────────────────────────────────┘
```

**关键变化**:
- TopBar: 38px → 32px（更紧凑）
- Sidebar: 224px/62px → 52px（仅图标，Arc 风格）
- StatusBar: 不再独立占位，融入 Sidebar 底部
- Content: 去掉 max-w-[1240px] 约束，全宽内容区
- 去掉 CommandPalette（用户明确不要）

### 3.2 TitleBar 改造

**当前**: 38px，左侧 brand + 页面名，右侧主题切换 + 窗口控制  
**改造后**: 32px，极简

```
┌──────────────────────────────────────────────────────────────┐
│ ≡  AgentSkin  |  Workspace  Themes  Wallpaper  Settings  🔍 │
└──────────────────────────────────────────────────────────────┘
```

**变化**:
- 高度 38px → 32px
- 去掉左侧 brand 独立区域，与导航合并
- 导航项直接放在标题栏内（替代 Sidebar 的部分功能）
- 搜索图标按钮（不展开命令面板，仅聚焦搜索框）
- 主题切换改为图标按钮（☀/☾），去掉 SegmentedControl
- 窗口控制按钮保持不变

**新组件结构**:
```tsx
<header className="flex h-8 items-center gap-4 px-3 bg-surface border-b border-subtle">
  {/* Left: menu toggle + nav */}
  <button className="icon-btn"><Menu size={16} /></button>
  <nav className="flex items-center gap-1">
    <NavItem active>Workspace</NavItem>
    <NavItem>Themes</NavItem>
    <NavItem>Wallpaper</NavItem>
    <NavItem>Settings</NavItem>
  </nav>
  
  {/* Spacer */}
  <div className="flex-1" />
  
  {/* Right: search + theme + window controls */}
  <button className="icon-btn"><Search size={14} /></button>
  <button className="icon-btn"><Sun size={14} /></button>
  {/* window controls (Windows) */}
</header>
```

### 3.3 Sidebar 改造

**当前**: 224px/62px，分组导航 + brand + Studio 按钮  
**改造后**: 52px，仅图标栏 + 底部状态

```
┌────┐
│ 🏠 │  ← 20px icon in 36px touch target
│ 🎨 │
│ 🖼 │
│ ⚙ │
│    │
│ ─ ─│  ← 分隔线
│ ●  │  ← 状态 LED
└────┘
```

**变化**:
- 宽度固定 52px（不再折叠/展开）
- 去掉分组标签、brand、Studio 按钮
- 仅保留核心导航图标（4-5 个）
- 底部集成状态 LED + 版本号
- 导航功能部分移入 TopBar

### 3.4 StatusBar 改造

**当前**: 28px 独立条，左 LED + 中状态 + 右时钟/版本  
**改造后**: 融入 Sidebar 底部，不再独立占位

```
Sidebar 底部:
┌────┐
│ ●  │  ← 3px LED + 状态文字（hover 展开详情）
│ v1 │  ← 版本号（hover 可点击复制）
└────┘
```

---

## 4. 逐页面改造方案

### 4.1 WorkspacePage

**当前结构**:
```
TopBar (标题 + 刷新按钮)
HealthBar (诊断信息条，4个指标)
Body: [200px AgentRail | Preview + TweakPanel]
```

**改造后结构**:
```
(无独立 TopBar — 由 Shell 的 TopBar 统一处理)
PageHeader: "Workspace" + 刷新图标按钮
HealthBar: 简化为单行紧凑条
Body: [180px AgentRail | Preview + TweakPanel]
```

**具体改造点**:

| 区域 | 当前 | 改造后 |
|------|------|--------|
| PageHeader | `font-display text-sm font-bold` + 独立刷新按钮 | `text-base font-medium text-primary` + 16px 图标按钮 |
| HealthBar | 4 个指标 + 彩色圆点 + 边框卡片 | 单行：分数 + 状态点 + 时间戳，无边框，纯灰阶 |
| AgentRail | 200px 宽，含 AppMark + 端口 + 活跃点 | 180px 宽，更紧凑，活跃态用背景色而非左边框 |
| AgentCard | `border-l-[3px] border-primary` 活跃态 | `bg-brand-subtle` 背景色替代左边框 |
| TweakPanel | 分组卡片 + 标签 | 保持功能，简化视觉：去掉卡片边框，用分隔线 |
| ActionButtons | 保存/丢弃/undo/redo/导出/导入 | 保持功能，按钮样式统一为 ghost + 13px |
| 空状态 | `text-[11px] text-muted-foreground` | 保持，增加引导图标 |

**HealthBar 改造细节**:
```tsx
// 之前: 4个独立指标 + 彩色图标
// 之后: 单行紧凑
<div className="flex items-center gap-3 px-4 py-2 text-xs text-secondary">
  <StatusDot status={healthReport.score >= 80 ? 'good' : healthReport.score >= 50 ? 'warn' : 'bad'} />
  <span className="font-mono tabular-nums">{healthReport.score}</span>
  <span className="text-tertiary">|</span>
  <span>{healthReport.blockingCount} blocking</span>
  <span className="text-tertiary">|</span>
  <span className="font-mono text-tertiary">{agentId} @ {time}</span>
</div>
```

**AgentRail 改造细节**:
```tsx
// 之前: border-l-[3px] border-primary 活跃态
// 之后: 背景色 + 左边 2px brand 条
<button className={cn(
  "flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
  active ? "bg-brand-subtle border-l-2 border-primary" : "hover:bg-hover"
)}>
```

---

### 4.2 ThemesPage

**当前结构**:
```
PageHeader: 标题 + 计数 + 分类
Toolbar: 计数 + 搜索 + 排序 + 方向 + 导入 + Studio
FilterRow: 分类 + 模式 + 动态 + 统计徽章
Grid: VirtualThemeGrid
DragOverlay: 拖拽导入
```

**改造后结构**:
```
(无独立 PageHeader)
Toolbar: 搜索(左) + 视图切换 + 导入 + Studio(右)
FilterRow: 分类 chip + 模式 chip + 动态开关
Grid: VirtualThemeGrid (卡片样式更新)
```

**具体改造点**:

| 区域 | 当前 | 改造后 |
|------|------|--------|
| PageHeader | 独立标题 + 计数徽章 | 去掉，标题融入 Toolbar |
| 搜索框 | InputGroup + 200px 宽 | 统一搜索框样式，240px，h-8 |
| 排序 | Select 下拉 | 图标按钮 + 下拉菜单 |
| 方向切换 | 独立小按钮 | 整合进排序下拉 |
| 导入按钮 | Button variant="ghost" + Package 图标 | 统一为 16px 图标 + ghost 按钮 |
| Studio 按钮 | `bg-primary text-primary-foreground` | 保持，但改为 h-8 |
| 分类过滤 | SegmentedControl bordered | Chip 样式（圆角 pill，选中=brand-subtle） |
| 模式过滤 | SegmentedControl bordered | Chip 样式 |
| 动态过滤 | 自定义按钮 + ping 动画 | 简化：chip + 静态指示点 |
| 统计徽章 | Badge variant="red" | 简化：纯文字 + 灰阶 |
| 空状态 | ◉ 大图标 + 文案 | 保持，减小图标尺寸 |
| 拖拽覆盖层 | `blur(20px) saturate(1.5)` | 去掉毛玻璃，改用 `bg-base/80` 实色 |

**卡片 (ThemeCard) 改造**:
```tsx
// 之前: 圆角 + 边框 + 阴影
// 之后: 圆角 + 极淡边框，无阴影
<div className="rounded-lg border border-subtle bg-card overflow-hidden hover:border-default transition-colors">
  {/* 预览图 */}
  <div className="aspect-video bg-muted" />
  {/* 信息 */}
  <div className="p-3">
    <h3 className="text-base font-medium truncate">{name}</h3>
    <p className="text-xs text-secondary">{author}</p>
  </div>
</div>
```

---

### 4.3 WallpaperEnginePage

**当前结构**:
```
Toolbar: 搜索 + 排序 + 类型过滤 + 导入 + 开关
Body: [Grid | DetailPanel(桌面)]
Mobile: Sheet 底部抽屉
```

**改造后结构**:
```
Toolbar: 搜索(左) + 类型 chip + 排序 + 导入(右)
Body: [Grid | DetailPanel]
(保持桌面/移动响应式)
```

**具体改造点**:

| 区域 | 当前 | 改造后 |
|------|------|--------|
| 搜索框 | `h-7 rounded-md border-input bg-card2` | `h-8 rounded-md border-default bg-input` |
| 排序 | `<select>` 原生 | 统一 Select 组件 |
| 类型过滤 | SegmentedControl | Chip pill 样式 |
| 导入按钮 | `bg-card2` + Download 图标 | ghost 按钮 + 16px 图标 |
| 开关 | 文字 + Switch | 仅 Switch + tooltip |
| 网格卡片 | 保持 | 圆角 8px + 极淡边框 |
| DetailPanel | 右侧栏 | 保持，简化内部卡片样式 |

---

### 4.4 SettingsPage

**当前结构**:
```
Grid: [180px SectionRail | Content]
Rail: 返回 + 标题 + 5 个 section 按钮
Content: 面包屑 + 设置行 (SettingRow 组件)
```

**改造后结构**:
```
Grid: [160px SectionRail | Content]
Rail: 5 个 section 按钮（无返回按钮，无标题）
Content: 分组设置行
```

**具体改造点**:

| 区域 | 当前 | 改造后 |
|------|------|--------|
| SectionRail | 180px，含返回 + 标题 + 按钮 | 160px，仅按钮列表 |
| 返回按钮 | 独立按钮 | 去掉（用 TopBar 导航替代） |
| Section 按钮 | `border-l-[3px] border-primary` 活跃态 | `bg-brand-subtle text-brand-text` 背景色 |
| SettingRow | `p-4 py-2 rounded-md` + `color-mix` 背景 | `py-3 px-2` + 分隔线，无背景 |
| 标题 | `text-[11px] text-muted-foreground` | `text-xs text-tertiary` |
| 描述 | `text-[10px] text-muted-foreground/70` | `text-xs text-tertiary` |
| Select | `h-7 w-[140px] rounded-md border-border bg-muted` | `h-8 w-[160px] rounded-md border-default bg-input` |
| SegmentedControl | 保持 | 保持，但缩小为 h-7 |
| 日志区 | `bg-card p-2 font-mono text-[11px]` | `bg-surface p-3 font-mono text-xs` |
| Accordion | 保持 | 保持，简化触发器样式 |
| 移动端 | Select 替换 Rail | 保持 |

**SettingRow 改造**:
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

### 4.5 AppsPage

**当前结构**: (从 App.tsx 路由推断)  
**改造方向**: 与 ThemesPage 统一风格

- 卡片网格布局
- 统一的 Chip 过滤
- 统一的搜索框样式
- 去掉彩色徽章，改用灰阶 + 品牌色点缀

---

### 4.6 StudioPage

**当前结构**: 独立窗口 (StudioApp.tsx)  
**改造方向**:

- 保持独立窗口模式
- 视觉语言与主应用统一
- 创作型 UI 可以更丰富（颜色选择器、画布等）
- 但框架元素（顶栏、侧栏）与主应用保持一致

---

## 5. 组件级规范

### 5.1 Button

```css
/* Primary */
.btn-primary {
  background: var(--brand);
  color: #fff;
  border-radius: var(--radius-md);
  height: 32px;
  padding: 0 12px;
  font-size: var(--text-base);
  font-weight: 500;
}
.btn-primary:hover { background: var(--brand-hover); }
.btn-primary:active { background: var(--brand-active); }

/* Ghost */
.btn-ghost {
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  height: 32px;
  padding: 0 12px;
  font-size: var(--text-base);
  font-weight: 500;
}
.btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

/* Icon Button */
.icon-btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  border: 1px solid transparent;
}
.icon-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
```

### 5.2 Input

```css
.input {
  height: 32px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-default);
  background: var(--bg-input);
  padding: 0 12px;
  font-size: var(--text-base);
  color: var(--text-primary);
}
.input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px var(--brand-subtle);
}
.input::placeholder { color: var(--text-tertiary); }
```

### 5.3 Card

```css
.card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
  background: var(--bg-elevated);
  /* 无阴影 */
}
.card:hover { border-color: var(--border-default); }
```

### 5.4 Badge

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 500;
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.badge-brand { background: var(--brand-subtle); color: var(--brand-text); }
.badge-success { background: var(--success-subtle); color: var(--success); }
.badge-warning { background: var(--warning-subtle); color: var(--warning); }
.badge-danger { background: var(--danger-subtle); color: var(--danger); }
```

### 5.5 SegmentedControl

```css
.segmented {
  display: inline-flex;
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  padding: 2px;
}
.segmented-item {
  height: 26px;
  padding: 0 10px;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.segmented-item:hover { color: var(--text-primary); }
.segmented-item.active {
  background: var(--bg-elevated);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}
```

### 5.6 StatusDot

```css
.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-dot.good { background: var(--success); }
.status-dot.warn { background: var(--warning); }
.status-dot.bad { background: var(--danger); }
.status-dot.idle { background: var(--text-tertiary); }
```

---

## 6. 迁移执行计划

### Phase 1: Token 系统 (1-2 天)
1. 替换 `globals.css` 中所有 CSS 变量为新 Token
2. 更新 `@theme inline` 映射
3. 更新 `shadcn-tailwind.css` 中的变量引用
4. 验证 Dark/Light 切换正常

### Phase 2: Shell 布局 (2-3 天)
1. TitleBar 改造 (32px + 导航合并)
2. Sidebar 改造 (52px 仅图标)
3. StatusBar 融入 Sidebar
4. App.tsx 布局调整 (去掉 max-w 约束)
5. 去掉 CommandPalette

### Phase 3: 逐页面改造 (3-4 天)
1. WorkspacePage
2. ThemesPage
3. WallpaperEnginePage
4. SettingsPage
5. AppsPage
6. StudioPage

### Phase 4: 组件统一 (1-2 天)
1. Button / Input / Card / Badge 样式统一
2. 焦点环样式统一
3. 滚动条样式统一
4. 动画时长统一

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
- [ ] 六款 Agent 注入后视觉和谐
- [ ] Electron 中 60fps 稳定
- [ ] 一眼不像（历史）Swiss、不像暖色 Claude
- [ ] 像 2025-2026 年的主流工具

---

*文档结束 — 待用户审定后进入执行阶段*
