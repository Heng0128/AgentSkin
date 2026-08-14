# AgentSkin UI 风格统一修改清单（UI Unification Plan）

> 生成日期：2026-08-14
> 审计范围：`src/ui/` 全部页面、共享组件、Studio 组件、设计 token（globals.css / workspace-tokens.css / workspace.css / shadcn-tailwind.css）
> 问题定性：**四套风格体系并存**——Notion 系（主导骨架）、Swiss 系（残留排印与 token）、新 globals token（半成品、radius 失效）、Tailwind/shadcn 默认（兜底），视觉混乱由此而来。

---

## 一、执行摘要

### 1.1 现状量化（Grep 实测，src/ui 全量）

| 指标 | 数量 | 说明 |
|------|------|------|
| `rounded-md`（Notion 式 6px 圆角） | **191 处** | 散落所有页面/组件 |
| `font-mono`（Swiss 式等宽排印） | **204 处** | 标题、标签、按钮、徽章全用 mono |
| 任意字号 `text-[Npx]`（9.5~13px） | **297 处** | 未走字号 token |
| 违规间距（gap-2.5/3.5、gap-[Npx]、m-[Npx]、p-[Npx]） | **77 处** | 违反 AGENTS.md 黄金规则 6（仅 4/8/16/24/32/48） |
| Swiss 式 `tracking-[…]` / `uppercase` 宽字距大写排印 | **104 处** | Swiss 国际主义排印特征 |
| 硬编码 `var(--…)` 直引用（绕过语义层） | **400 处** | 含 `var(--glass, …)` 等带 fallback 的不确定引用 |
| 硬编码 hex/rgb 颜色 | **29 处** | 绕开设计 token |
| 注释/命名出现 "Notion" | **27 个文件** | 含 globals.css 本身 |
| 注释/命名出现 "Swiss" | **7 个文件** | 含 schema 默认形态声明 |

### 1.2 一句话结论

**应用外壳（Sidebar / TitleBar / StatusBar）与页面工具条整体是 Notion 复刻（注释自认 "Notion Edition"），Workspace/Studio 体系残留 Swiss 排印与 2px 方角（注释自认 "NotionInternational styling"），而 globals.css 里新写的 "Precision · Depth · Clarity" token 因为 `--radius-base` 从未定义而整体失效——三套语言同时生效，互不统一。**

---

## 二、四套风格体系诊断

### 体系 A — Notion 系（当前主导）

| 载体 | 证据 |
|------|------|
| `components/sidebar.tsx` | 注释 `Notion-style sidebar`；左侧 3px 红色指示条；分组小标题 |
| `components/title-bar.tsx` | 注释 `# TitleBar — Notion Edition`、`Notion-style icon button class`、`Theme mode segmented control — Notion flat style` |
| `components/status-bar.tsx` | 注释 `# StatusBar — Notion Edition` |
| `pages/ThemesPage.tsx` | 注释 `Notion header / Notion Toolbar / Notion segmented / Notion Badge`；全部工具条 `rounded-md` |
| `pages/SettingsPage.tsx` | 注释 `Section rail (Notion)`、`Notion-style back control` |
| `design/colors.ts` | 注释 `Notion rule: only brand red + semantic aliases` |
| 全站 | `rounded-md` 191 处、shadcn/ui 组件库、分段控件、badge |

特征：6px 圆角、柔和灰、扁平分段控件、左指示条导航。

### 体系 B — Swiss 系（残留，被用户点名移除）

| 载体 | 证据 |
|------|------|
| `styles/workspace-tokens.css` | 独立第二套 token：`--bg-0..4`（#0b0b10 蓝黑）、`--r-micro: 2px`、`--space-*`、全 mono 约定 |
| `styles/workspace.css` | 1~2px 方角 14 处（滑块 thumb、开关、dot、swatch）；注释 `Live Tweak slider (native range input, NotionInternational styling)` |
| `components/studio/kicker.tsx` | Kicker = Swiss "kopf/section kicker" 排印元素（注释误标 Notion） |
| `pages/WorkspacePage.tsx` | 页头 `font-mono … uppercase tracking-tight` |
| `pages/ThemesPage.tsx` | `tracking-[.18em]` 宽字距元数据行 |
| `pages/SettingsPage.tsx` | `tracking-[.18em]`、`toUpperCase()` 大写标签 |
| `i18n.ts` | `swissLedRunning` 等 8 组键名带 `swiss*` 前缀 |
| `main/catalog/manifest-v2.schema.json` | 注释 `Engine 默认 2px Swiss 形态` |
| `main/catalog/component-variations.schema.json` | 注释 `标题字距（Swiss: -0.01em）`、`宽字距（Swiss uppercase 装饰用）` |
| `components/logo.tsx` | mono 变体 `rx="2"` 方角 |
| `pages/WallpaperEnginePage.tsx` | Mobile Sheet `rounded-t-[2px]` |

特征：mono 大写 + 大 letter-spacing 排印、1~2px 几何方角、独立蓝黑 token、kicker 段落标签、网格对齐线。

### 体系 C — globals.css 新 token（半成品，核心缺陷）

| 缺陷 | 位置 | 后果 |
|------|------|------|
| `--radius-base` **从未定义** | globals.css L64-68 | `:root` 的 3px 基准圆角体系整体失效（浏览器丢弃无效 `calc()`） |
| `@theme inline` 引用 `var(--radius)` 也未定义 | globals.css L288-290, L365-369 | `--radius-micro/soft/sm/md/lg/xl/2xl` 全部无效 |
| 注释宣称 "Base is 3px (not Swiss 2px … not Notion 6px)" | globals.css L61 | **设计意图与实际渲染（6px）完全脱节** |
| `--font-size-micro/label/body…` 定义了但无人使用 | globals.css L342-348 | 297 处任意字号仍在裸奔 |
| 注释仍自称 "Swiss"（"not Swiss 2px"）与 "Notion"（"not Notion 6px"） | globals.css L61 | 设计语言陈述残留外来词 |
| 深色 `--dot`、`--shadow-*` 已定义但页面内联 fallback | ThemesPage L376-382 | `var(--glass, …)`、`var(--f-mono, …)` 等说明 token 契约不可信 |

### 体系 D — Tailwind / shadcn 默认（兜底）

- 组件库（button/input/select/dialog 等）全部 `rounded-md`（Tailwind 默认 6px）与 `h-*` 固定高度。
- 在 token 体系失效的前提下，**shadcn 默认值成了事实标准**，进一步固化 Notion 观感。

### 依赖割裂（跨体系死代码）

- `StudioApp.tsx` 注释宣称渲染 `ThemeStudioPage`，**实际渲染 `WorkspacePage`**（L25、L97）。
- `components/studio/` 顶层组件（StudioDock/StudioStage/StudioInspector/StudioTitleBar/StudioDrawer/FloatingToolbar）**全部无引用者**，为已下线代码。
- `styles/workspace.css` 依赖它们的 `.ws-*` 类约 90% 为死样式；仅 `ws-dock-card` 系列被 `dock-internals.tsx` 使用。
- 结论：**workspace.css + workspace-tokens.css + studio 组件树应整体走"删除或重接线"路线，而不是继续维护第三套体系。**

---

## 三、风格冲突点总表（按维度）

### 3.1 配色冲突

| # | 冲突 | 位置 | 说明 |
|---|------|------|------|
| C-1 | 品牌红三套并存 | globals `--primary: hsl(4 85% 62%)`；`workspace.css` 硬编码 `rgba(255,69,58)`（#FF453A，14 处）；`logo.tsx` 历史 `#E30613` | 同一次点击/悬停，红色深浅不一致 |
| C-2 | 深色背景色温分裂 | globals `hsl(220 14% 7%)` 冷蓝黑 vs workspace-tokens `#0b0b10/#121218` 偏紫黑 | Workspace 区域与其他页面底色不一致 |
| C-3 | 浅色模式缺失 | workspace-tokens 无 light 变体；workspace.css 硬编码 `background: #fff`（pw__body） | 浅色主题下 Studio 相关区域观感断裂 |
| C-4 | 语义色双命名 | `--cr-success` vs `--cr-ok`、`--cr-warning` vs `--cr-warn`、`--cr-info` 两处定义 | 维护者不知道该用哪个 |
| C-5 | 简写别名滥用 | `var(--bg2)/var(--border2)/var(--card2)/var(--grn)/var(--amb)` 400 处 var() 直引用 | 绕过语义 token，改主题要翻几十个文件 |
| C-6 | 选中态配色不统一 | 分段控件：ThemesPage `bg-card`（白卡）vs WorkspacePage `bg-primary/5`（红 5%）vs WallpaperEngine `bg-card` | 三种"选中"视觉语言 |

### 3.2 字体冲突

| # | 冲突 | 位置 | 说明 |
|---|------|------|------|
| T-1 | mono 滥用（Swiss 特征） | 204 处 `font-mono`：侧栏分组、tab、按钮、徽章、输入框 | 数据/代码场景应保留 mono，**控件与标题不应全 mono** |
| T-2 | 任意字号 297 处 | `text-[9.5px]/[10px]/[10.5px]/[11px]/[11.5px]/[12px]/[12.5px]/[13px]` | 未走 `--font-size-*` token，同一层级多处字号 |
| T-3 | 大写 + 宽字距 104 处 | `tracking-[.18em]`、`uppercase`、`tracking-wider` | Swiss 国际主义排印；中文场景大写无意义且破坏可读性 |
| T-4 | 品牌字体定位模糊 | Space Grotesk（几何无衬线，Swiss 血统）用于 font-display | 见"决策点 D-1"，建议仅保留品牌场景 |
| T-5 | 标题层级不统一 | ThemesPage `text-sm`(14px) vs AppsPage `text-[22px]` vs WorkspacePage `font-mono 12px uppercase` | 三个页面三种页头 |

### 3.3 圆角冲突

| # | 冲突 | 位置 | 说明 |
|---|------|------|------|
| R-1 | token 失效 | globals `--radius-base` / `--radius` 未定义 | 3px 设计意图 0 生效 |
| R-2 | Notion 6px 主导 | `rounded-md` 191 处 | 与品牌"精密"定位不符 |
| R-3 | Swiss 2px 残留 | workspace.css 14 处 1~2px、logo mono `rx="2"`、Mobile Sheet `rounded-t-[2px]` | 方角几何构成 |
| R-4 | 三种圆角语言并存 | 6px（组件）/ 2px（workspace）/ 3px（globals 注释意图） | 同一窗口内卡片 6px、滑块 2px、开关 2px |

### 3.4 间距冲突（违反 AGENTS.md 黄金规则 6）

| 违规示例 | 位置 |
|----------|------|
| `p-[12px_20px_16px]`（20px） | `App.tsx` L103（全局页面容器） |
| `m-[2px_9px]`（9px） | `sidebar.tsx` L35-36（导航按钮） |
| `gap-2.5`（10px）× ~30 | sidebar/title-bar/AppCard/WallpaperEngine/TweakPanel 等 |
| `gap-3.5`（14px）× ~8 | Dashboard 统计卡（archive）、部分页面 |
| `gap-[2px]/[3px]` | SettingsPage rail、WallpaperEngine 分段器 |
| `px-[18px]` | sidebar 分组标签 |

### 3.5 布局结构冲突

| # | 冲突 | 位置 |
|---|------|------|
| L-1 | 页头三种模式 | ThemesPage（14px 标题+计数+分隔线）≠ AppsPage（22px 大标题+副标题）≠ WorkspacePage（mono 大写 12px） |
| L-2 | Settings 无全局侧栏 | App.tsx 对 settings 路由隐藏 Sidebar，Settings 内部用 180px rail——第五种外壳结构 |
| L-3 | 分段控件五套手写实现 | TitleBar（h-6, rounded-sm）≠ ThemesPage（h-[26px], rounded-md）≠ WallpaperEngine（h auto, rounded-md, gap-[2px]）≠ SettingsPage Select |
| L-4 | 卡片栅格密度不一 | AppsPage 6 列网格 vs ThemesPage 虚拟化自适应 vs WallpaperGrid 固定密度 |
| L-5 | Studio 布局系统未接线 | ws-root 五区 grid（topbar/drawer/stage/inspector/status）是死代码；WorkspacePage 实际用 header+200px rail |

### 3.6 组件样式冲突（三套平行组件）

| 组件 | shadcn 系（活跃） | workspace.css 系（残留） | globals 手写（部分活跃） |
|------|------|------|------|
| 按钮 | `Button`（rounded-md） | `.ws-btn`（r-xs + mono） | — |
| 开关 | `Switch`（圆角） | `.ws-dock-toggle`（2px 方角） | `.sw`（pill，全局 CSS） |
| 徽章 | `Badge` | `.ws-badge`（mono 大写） | `.tag`（pill） |
| 滑块 | — | `.ws-range`（方 thumb，NotionInternational 注释） | `input[type=range]`（圆 thumb，globals L524-559） |
| 输入框 | `Input`（rounded-md） | `.ws-input`（mono） | — |

> 同一应用内存在**三套开关、三套徽章、两套滑块**，是"混搭感"的最直接来源。

### 3.7 品牌识别风险

| # | 问题 | 位置 |
|---|------|------|
| B-1 | 品牌红无单一事实源 | 见 C-1；建议以 `--primary` 为唯一品牌色，删除/替换两处硬编码红 |
| B-2 | Logo 品牌资产保持良好 | `logo.tsx` 已用 `var(--primary)`（color 变体）——**保留** |
| B-3 | "Precision · Depth · Clarity" 原则已写但未落地 | globals.css L28-40 的 5 条原则是产品自有的设计语言，**应作为统一后的锚点** |

---

## 四、Swiss 风格元素移除清单（彻底移除）

| # | 文件 | 位置 | 处理方式 |
|---|------|------|----------|
| S-1 | `styles/workspace-tokens.css` | 全文件 | 删除独立 token 体系；需要保留的（dock 布局）映射到 globals token |
| S-2 | `styles/workspace.css` | 1~2px 圆角 14 处（L525/667/767/775/782/880/898/1128/1447/1594-1628） | 对齐统一圆角 token；**删除全部未使用类**（.ws-btn/.ws-badge/.ws-dialog/.ws-input/.ws-range 等无引用者） |
| S-3 | `styles/workspace.css` | L1586 注释 `NotionInternational styling` | 改写为项目自身措辞或删除 |
| S-4 | `components/studio/kicker.tsx` | 全文件（kopf/section kicker） | 若 Studio 确认下线则删除；若保留，用统一 SectionLabel 组件替换 |
| S-5 | `pages/WorkspacePage.tsx` | L74 `font-mono … uppercase tracking-tight`；L142、L150 等 | 改为统一页面标题样式（font-display 或 --font-ui），移除 uppercase/mono |
| S-6 | `pages/ThemesPage.tsx` | L302 `tracking-[.18em]` | 移除宽字距，用统一 label token |
| S-7 | `pages/SettingsPage.tsx` | L224 `tracking-[.18em]`、L225 `toUpperCase()` | 同上 |
| S-8 | `pages/WallpaperEnginePage.tsx` | L210 `rounded-t-[2px]` | 统一圆角 token |
| S-9 | `components/logo.tsx` | L34/37/41/43 `rx="2"`（mono 变体） | 统一为品牌圆角 token（与 color 变体一致） |
| S-10 | `shared/i18n.ts` | `swiss*` 8 组键（L925-932 / L1851-1858） | 重命名为语义键（如 `statusLedRunning`），同步 status-bar.tsx 引用 |
| S-11 | `main/catalog/manifest-v2.schema.json` | L318 注释 `2px Swiss 形态` | 注释改为"Engine 默认形态"，或同步新 token |
| S-12 | `main/catalog/component-variations.schema.json` | L57/59 注释 `Swiss: -0.01em`、`Swiss uppercase 装饰用` | 同上，去 Swiss 措辞 |
| S-13 | `globals.css` | L61 注释 `not Swiss 2px… not Notion 6px` | 改为正面陈述（见 §六设计语言） |
| S-14 | 全站 | `font-mono` 用于**标题/标签/按钮/徽章**的 204 处中的非数据场景 | 收敛为：数据/代码/时间戳用 mono，控件与标题用 --font-ui |
| S-15 | 全站 | `tracking-[…]` + `uppercase` 组合 104 处 | 移除大写化，宽字距仅保留 --tracking-mid(0.05em) 一个档位用于 label |

---

## 五、Notion 风格去除引用清单（不照搬，去其名与形）

| # | 文件 | 位置 | 处理方式 |
|---|------|------|----------|
| N-1 | `components/sidebar.tsx` | L51-61 注释 `Notion-style sidebar` | 改写为 AgentSkin 自身定位注释；**结构可保留**（左指示条是产品级导航隐喻，非 Notion 专利），但统一为 3px token |
| N-2 | `components/title-bar.tsx` | L4 `Notion Edition`、L84/117 注释 | 删注释；分段控件抽成统一 `SegmentedControl` 组件 |
| N-3 | `components/status-bar.tsx` | L13 `Notion Edition` | 删注释 |
| N-4 | `pages/ThemesPage.tsx` | L87/100/108/121/154/198/285/300 注释与样式 | 工具条组件化（PageToolbar），圆角走 token |
| N-5 | `pages/SettingsPage.tsx` | L212/214 注释 | 删注释；rail 激活态统一为 token 化样式 |
| N-6 | `design/colors.ts` | L37 `Notion rule` 注释 | 改写为"AgentSkin brand rule" |
| N-7 | 全站 `rounded-md` 191 处 | — | 替换为统一圆角 token（见 §六 R 档，建议 `rounded-md → var(--radius-md)` 的语义类） |
| N-8 | shadcn 组件默认圆角 | `components/ui/*.tsx` | 通过 globals token 或统一 override 收敛为品牌圆角 |
| N-9 | `components/studio/*` 与 `styles/workspace.css` | 见 §二"依赖割裂" | 删除或重接线（决策点 D-2） |

> 说明：去 Notion 化 ≠ 推倒重来。侧栏+顶栏+状态栏的**三栏框架**是 AgentSkin 的既有布局资产，保留结构、统一细节即可；要移除的是其"复刻式"命名、6px 圆润观感与 flat 分段控件的手写碎片。

---

## 六、项目自身设计语言（统一后的锚点）

### 6.1 品牌识别（保留与强化）

| 资产 | 处置 |
|------|------|
| Logo（A 三角 + 品牌红） | **保留**，mono 变体圆角对齐品牌 token |
| 品牌红 `--primary: hsl(4 85% 62%)`（暗）/ `hsl(4 78% 52%)`（亮） | **唯一品牌色**；删除 #FF453A 与 #E30613 两处历史红 |
| 设计原则（globals.css L28-40） | **保留并作为统一纲领**：Signal over decoration / Layered depth / Monochrome + single accent / Compact data density / Deterministic motion |
| Space Grotesk | 决策点 D-1 |
| 紧凑数据密度（mono 数字、tabular-nums） | 保留于数据/指标场景 |

### 6.2 统一 token 目标规范（修改后）

**圆角（修复失效体系，定一档基准）**

| Token | 值 | 用途 |
|-------|-----|------|
| `--radius-base` | **3px**（修复：在 `:root` 显式定义） | 基准 |
| `--radius-sm` | 2px | 微芯片/角标 |
| `--radius-md` | 3px | 按钮/输入/开关 |
| `--radius-lg` | 5px | 卡片 |
| `--radius-xl` | 8px | 对话框 |
| `--radius-2xl` | 12px | 浮动面板 |
| 全站 | 移除 `rounded-md` 硬编码，改用语义类 `rounded-md` 映射 `var(--radius-md)` | — |

**字体**

| Token | 值 | 用途 |
|-------|-----|------|
| `--font-ui` | Inter + 系统 CJK | 界面正文/控件/标题 |
| `--font-mono` | IBM Plex Mono | 仅数据/代码/时间戳/端口 |
| `--font-display` | Space Grotesk | 仅 Logo 与品牌标题（待 D-1 决策） |
| 字号档位 | 10 / 11.5 / 13 / 15 / 20 / 28px | 全站收敛 297 处任意字号到 6 档 token |

**间距**：严格遵守 4/8/16/24/32/48（AGENTS.md 规则 6），全站清理 77 处违规。

**配色**：只保留 globals 语义 token（--background/--card/--muted/--primary/--cr-* 等），删除 workspace-tokens 蓝黑体系与全部内联 var() 直引用。

---

## 七、逐项修改清单（核心交付）

> 每项含：页面/组件 → 当前问题 → 修改方案 → 预期效果。
> 优先级：P0 = 修复失效体系与死代码（影响全局）；P1 = 统一高频组件（用户天天看）；P2 = 文案/命名清理。

### A. 设计 token 层（P0，一次到位）

| # | 目标 | 当前问题 | 修改方案 | 预期效果 |
|---|------|----------|----------|----------|
| A-1 | `globals.css` | `--radius-base` 未定义 → 3px 体系整体失效；`@theme inline` 引用未定义的 `var(--radius)` | `:root` 显式定义 `--radius-base: 3px`；`@theme inline` 改引用 `--radius-base` 派生；删除重复的 L64-68 与 L365-369 两套定义中的一套 | 圆角 token 真正生效，一处改全局 |
| A-2 | `globals.css` | 设计语言注释残留 "Swiss"/"Notion" 措辞 | 改为正面陈述（如 "3px 精密基准 — 区别于 2px 极端锐角与 6px 圆润"） | 文档与实现一致 |
| A-3 | `styles/workspace-tokens.css` | 独立第二套色板/圆角/间距 token | 合并进 globals：色板映射 `--bg-0..4 → --background/--card/--card2/--popover` 层级，圆角用同一 radius token，间距用 4px 网格 | 消除双 token 源 |
| A-4 | `ui/colors.ts` vs `ui/design/colors.ts` | 两个文件内容完全重复 | 删除其一（建议保留 `ui/design/colors.ts` 或按 INDEX 约定定唯一入口），更新引用 | 消除双源 |
| A-5 | 全局 | `var(--glass, …)`、`var(--f-mono, …)` 等 400 处内联 var() 直引用 | 收敛为 Tailwind 语义类或定义缺失 token | 主题可维护，改色不再翻文件 |

### B. 应用外壳（P1）

| # | 目标 | 当前问题 | 修改方案 | 预期效果 |
|---|------|----------|----------|----------|
| B-1 | `sidebar.tsx` | "Notion-style" 注释；`m-[2px_9px]` 违规间距；激活态 `shadow-[inset_3px_0_0_var(--primary)]` 硬编码 | 注释改写；间距归 4px 网格；激活条用统一 token；NavButton 圆角走 token | 侧栏仍是侧栏，但观感归位品牌 |
| B-2 | `title-bar.tsx` | "Notion Edition" 注释；主题模式分段控件手写 | 抽 `SegmentedControl` 共享组件（见 F-1），替换三处手写分段器 | 顶栏一致，维护单点 |
| B-3 | `status-bar.tsx` | "Notion Edition" 注释；`swiss*` i18n 键 | 注释改写；i18n 键重命名（S-10） | 命名与视觉同步去瑞士化 |

### C. 页面层（P1）

| # | 目标 | 当前问题 | 修改方案 | 预期效果 |
|---|------|----------|----------|----------|
| C-1 | 页面页头统一 | 三种页头：Themes(14px) / Apps(22px) / Workspace(mono 12px) | 定义统一 `PageHeader`（font-display 15px 标题 + 语义分隔线 + label 计数），三页共用 | 六页页头层级一致 |
| C-2 | `ThemesPage.tsx` | 注释通篇 "Notion"；`tracking-[.18em]`；任意字号；`var(--glass)` fallback；内联手写分段器 | 工具条/过滤条抽 `PageToolbar` + `FilterSegmented` 组件；字号走 token；去 fallback | 主题页观感收敛，代码减重 |
| C-3 | `SettingsPage.tsx` | rail 注释 "Notion"；`tracking-[.18em]` + `toUpperCase()`；任意字号 | 统一 label token；激活态 token 化 | 设置页与全局一致 |
| C-4 | `WallpaperEnginePage.tsx` | `rounded-t-[2px]`；分段器第四套手写实现；`text-[10.5px]` | 用 `SegmentedControl`；字号 token；Sheet 圆角走 token | 壁纸页与全局一致 |
| C-5 | `WorkspacePage.tsx` | mono 大写页头；误引入 workspace.css 全量（内含 NotionInternational 注释与死类） | 页头统一；**移除 `import '@/styles/workspace.css'`**，改用 TweakPanel 所需的最小样式 | 工作区脱离第三套体系 |
| C-6 | `AppsPage.tsx` | 22px 页头与全局不符；`var(--grn)/var(--amb)` 直引用 | 页头换 PageHeader；颜色走语义类 `text-cr-success/--cr-warning` | 应用页归位 |

### D. 共享组件（P1）

| # | 目标 | 当前问题 | 修改方案 | 预期效果 |
|---|------|----------|----------|----------|
| D-1 | `ui/button.tsx` | sm/xs/icon 全 `rounded-md`（6px） | 统一走 `--radius-md`（3px）token | 按钮回归精密定位 |
| D-2 | `ui/switch.tsx` + `globals .sw` | 两套开关并存 | 统一到 shadcn Switch，删除 `.sw` 或反向（保留其一） | 一种开关 |
| D-3 | `ui/badge.tsx` + `globals .tag` + `.ws-badge` | 三套徽章 | 保留 Badge（活跃），删除 `.tag`/`.ws-badge` 死样式 | 一种徽章 |
| D-4 | 滑块 | `input[type=range]` 圆 thumb（globals）vs `.ws-range` 方 thumb | 全局 slider 用 globals 圆 thumb 版本，删除 `.ws-range` | 一种滑块 |
| D-5 | `components/ui/*` 全库 | shadcn 默认 6px 圆角 | 通过 globals token 覆盖或按 A-1 后批量替换 | 组件库整体归位 |

### E. 死代码清理（P2，风险低收益高）

| # | 目标 | 处理方式 |
|---|------|----------|
| E-1 | `components/studio/` 顶层 6 组件（StudioDock/StudioStage/StudioInspector/StudioTitleBar/StudioDrawer/FloatingToolbar） | 确认无引用（已核验）后删除；保留被引用叶子（dock-internals、Kicker 的引用方 DockTabFX 等随树删除） |
| E-2 | `styles/workspace.css` 未引用类（.ws-btn/.ws-badge/.ws-dialog/.ws-input/.ws-range/.ws-proposal-card 等约 90%） | 删除；仅保留 ws-dock-card 系列并映射 globals token |
| E-3 | `StudioApp.tsx` 注释 | 改注释为实际行为（渲染 WorkspacePage）或按业务意图修正 |
| E-4 | `pages/archive/`（AgentDashboardPage/AgentsPage/UnifiedWorkspacePage） | 已是归档，保留；其中的 SwissPanel 不再外溢，无需处理 |

### F. 新增统一组件（支撑以上修改）

| # | 组件 | 用途 |
|---|------|------|
| F-1 | `SegmentedControl` | 替换 TitleBar / ThemesPage / WallpaperEngine / Settings 五处手写分段器 |
| F-2 | `PageHeader` | 统一六页页头（标题 + 计数 + 分隔线 + 操作区） |
| F-3 | `SectionLabel` | 替换 Kicker 与各处手写 section 标签（dot + label，token 化） |

### G. 命名与文案清理（P2）

| # | 位置 | 处理 |
|---|------|------|
| G-1 | `shared/i18n.ts` `swiss*` → `status*` | 8 组键重命名 + status-bar.tsx 同步 |
| G-2 | `main/catalog/*.schema.json` Swiss 注释 | 去 Swiss 措辞（S-11/S-12） |
| G-3 | 全站注释 "Notion Edition/Style"（27 文件） | 改写为 AgentSkin 自身措辞 |

---

## 八、统一后设计语言一句话定义

> **AgentSkin 视觉语言 = 精密（3px 圆角基准）+ 纵深（分层表面+受控阴影）+ 单一品牌红 + 紧凑数据密度 + 确定性动效。**
> 不瑞士（无 2px 方角几何、无 mono 大写排印、无宽字距网格），不 Notion（无 6px 圆润、无复刻命名、无 flat 分段碎片）。

---

## 九、实施路线与验证

### 阶段划分

| 阶段 | 内容 | 产出 |
|------|------|------|
| Phase 1（P0） | A 组 token 修复 + workspace 体系并轨/删除（A-1~A-5, E 组） | 单 token 源、无死代码 |
| Phase 2（P1） | B/C/D 组组件与页面统一 + F 组新组件落地 | 六页视觉一致 |
| Phase 3（P2） | G 组命名清理 + 全站文案 | 无 Swiss/Notion 痕迹 |

### 验证方式

1. 每阶段结束执行 `npx tsc --noEmit` + `npm run check`（含 C6 设计 token 合规守卫）。
2. 全局回归 grep：
   - `grep -r "rounded-\[2px\]" src/` → 0
   - `grep -ri "notion\|swiss" src/ui src/shared src/main/catalog` → 仅允许"业务名"残留（如示例应用名）
   - `grep -rE "tracking-\[|uppercase" src/ui/pages src/ui/components` → 收敛到指定档位
3. 暗/亮双主题截图对比，确认无色彩断层。

---

## 十、决策点（需老板拍板）

| # | 决策 | 默认建议 |
|---|------|----------|
| D-1 | Space Grotesk 去留 | **保留**：它已是 Logo/品牌标题资产，限定在 display 场景；若追求彻底去瑞士化可替换为更中性的 Inter 全站化（影响较小，涉及 font-display 引用约 10 处） |
| D-2 | Studio 死代码处置 | **删除**（已核验 0 引用）；若工作室窗口将在近期复活，则改为"重接线 + token 化"路线 |
| D-3 | 圆角基准 | **3px**（globals 注释既有意图，符合"精密"定位，也是与 2px/6px 的差异化锚点） |

---

*本清单基于 2026-08-14 对 src/ui 全量静态审计生成；所有行号引用以当日代码为准。*
